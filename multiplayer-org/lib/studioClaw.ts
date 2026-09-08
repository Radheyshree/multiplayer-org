/**
 * Studio's transport to Claw.
 *
 * Not a second copy of lib/chat.ts's wrapper: that one dispatches an agent INTO
 * a Spaces thread and returns when it finishes, which is the right shape for a
 * chat surface and the wrong one here. Studio needs the run's progress while it
 * is happening, a conversation that survives across turns, and the ability to
 * abandon a turn without killing the run. Different job, different module.
 *
 * Three facts this is built on, each verified live against the workspace rather
 * than read off the SDK types:
 *
 *  1. `getRun` returns far more than the SDK declares. The type says
 *     `{ sessionId, status, result?, error? }`; the endpoint actually returns
 *     the whole AgentRun row — `currentToolLabel`, `toolInvocations`,
 *     `reasoning`, `toolsUsed`, token counts, timings. The registry sets no
 *     mapResult on getRun, so the extra fields pass straight through and the
 *     progress UI is free. (Filed for SDK-GAPS.)
 *
 *  2. `result` does NOT stream. It is empty for the whole run and lands whole at
 *     the terminal poll — measured at 0 bytes for 51s, then 4,872 bytes at 66s.
 *     So there is no token-by-token text to show, and a progress UI that
 *     pretends otherwise would be lying. `currentToolLabel` and the invocation
 *     count are the honest signals, and they DO move.
 *
 *  3. Passing our own `conversationId` gives real multi-turn memory. Verified:
 *     a value stated in one run was recalled by a second, separate run carrying
 *     the same id. Nothing in the SDK docs says this. It is what makes followups
 *     a conversation rather than a series of strangers.
 */
import { xyne } from './xyne';

export type StudioAgent = {
  slug: string;
  name: string;
  description: string;
  color?: string;
  isDefault?: boolean;
};

/** One tool call, as the runtime records it. Shape is loose by necessity. */
export type Invocation = { toolName?: string; args?: unknown; result?: unknown; status?: string };

/** What a poll can tell us. Everything optional — a run in flight has almost none of it. */
export type RunProgress = {
  status: string;
  label: string | null;
  invocations: Invocation[];
  reasoning: string;
  result: string;
  error: string | null;
  /** Wall-clock since dispatch, seconds. The only number that always moves. */
  elapsedS: number;
  tokensOut?: number;
};

const TERMINAL = ['completed', 'failed', 'cancelled', 'canceled', 'error'];

export function isTerminal(status: string): boolean {
  return TERMINAL.includes(status);
}

/**
 * The agent roster.
 *
 * 214 agents in this workspace, many of them one-off copies sharing a display
 * name, so dedupe on slug and put the ones that can actually build an app in
 * front. The rest stay reachable — an agent that knows a codebase writes a
 * better app about that codebase than a generalist does.
 */
export async function listStudioAgents(): Promise<StudioAgent[]> {
  const { spaces } = await xyne();
  const raw = (await spaces.claw.listAgents()) as unknown as Array<Record<string, unknown>>;
  const seen = new Set<string>();
  const out: StudioAgent[] = [];
  for (const a of raw) {
    const slug = String(a['slug'] ?? a['id'] ?? '');
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({
      slug,
      name: String(a['name'] ?? slug),
      description: String(a['description'] ?? ''),
      ...(typeof a['color'] === 'string' ? { color: a['color'] } : {}),
      ...(a['isDefault'] === true ? { isDefault: true } : {}),
    });
  }
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * Generalists first — they follow a format instruction cleanly, which is what
 * this contract lives or dies on.
 *
 * `ask-ai` leads deliberately. It is the workspace assistant the rest of Xyne
 * already routes through, so it is the one people recognise and the one whose
 * behaviour is best understood here.
 */
const PREFERRED = ['ask-ai', 'assistant', 'dictator', 'frontend-engineer', 'fe-autocoder', 'claw'];
function rank(agent: StudioAgent): number {
  const i = PREFERRED.indexOf(agent.slug);
  if (i !== -1) return i;
  return agent.isDefault ? PREFERRED.length : PREFERRED.length + 1;
}

/** The agent Studio starts on, if the workspace has it. */
export function defaultAgent(agents: StudioAgent[]): string {
  return agents.find(a => PREFERRED.includes(a.slug))?.slug ?? agents[0]?.slug ?? 'assistant';
}

export type StartedRun = { sessionId: string };

/**
 * Dispatch a turn.
 *
 * `channelId` is deliberately never passed: supplying one makes the agent post
 * its reply into a real Spaces channel, and a design iteration is not something
 * anyone wants in their workspace feed.
 */
export async function startRun(input: {
  agent: string;
  task: string;
  conversationId: string;
}): Promise<StartedRun> {
  const { spaces } = await xyne();
  const { sessionId } = await spaces.claw.run({
    agent: input.agent,
    task: input.task,
    conversationId: input.conversationId,
  });
  return { sessionId };
}

/** One poll. Widened from the SDK's narrow type — see the header, note 1. */
export async function pollRun(sessionId: string, startedAt: number): Promise<RunProgress> {
  const { spaces } = await xyne();
  const run = (await spaces.claw.getRun(sessionId)) as unknown as Record<string, unknown>;
  const invocations = Array.isArray(run['toolInvocations']) ? (run['toolInvocations'] as Invocation[]) : [];
  return {
    status: String(run['status'] ?? 'running'),
    label: typeof run['currentToolLabel'] === 'string' ? run['currentToolLabel'] : null,
    invocations,
    reasoning: typeof run['reasoning'] === 'string' ? run['reasoning'] : '',
    result: typeof run['result'] === 'string' ? run['result'] : '',
    error: typeof run['error'] === 'string' ? run['error'] : null,
    elapsedS: Math.round((Date.now() - startedAt) / 1000),
    ...(typeof run['tokensOut'] === 'number' ? { tokensOut: run['tokensOut'] } : {}),
  };
}

/**
 * Dispatch and follow a turn to its end.
 *
 * Not `runAndWait`: that helper swallows everything between dispatch and the
 * terminal poll, and everything Studio shows while an agent works lives in
 * exactly that gap. It also throws on timeout while the run keeps going, which
 * would strand a result the user is waiting on.
 *
 * `abort` stops WATCHING, never the run. A user who navigates away and comes
 * back can be handed the finished result, because the session id outlives the
 * component.
 */
export async function runTurn(input: {
  agent: string;
  task: string;
  conversationId: string;
  onProgress: (progress: RunProgress, sessionId: string) => void;
  signal?: AbortSignal;
  /**
   * When the WATCHER gives up. The run itself continues regardless.
   *
   * Fifteen minutes, not the SDK's five: a measured run that reached for its
   * file tools took over 299s before replying, and abandoning a turn that is
   * still working loses nothing but costs the user the result.
   */
  timeoutMs?: number;
}): Promise<RunProgress> {
  const startedAt = Date.now();
  const { sessionId } = await startRun(input);
  const deadline = startedAt + (input.timeoutMs ?? 900_000);

  // Hand the session id back BEFORE the first poll. The caller persists it on
  // the first progress callback, and if every poll then fails — a flaky
  // network, a tab suspended for minutes — the id is already saved and the run
  // can be re-attached to. Reporting it only via a successful poll means a run
  // that dispatched fine becomes permanently unreachable the moment the first
  // read fails.
  input.onProgress(
    { status: 'starting', label: null, invocations: [], reasoning: '', result: '', error: null, elapsedS: 0 },
    sessionId,
  );

  // Sub-second polling would spend requests to learn nothing: the run's own
  // writes are debounced server-side, so nothing changes faster than this.
  const INTERVAL_MS = 1_500;

  for (;;) {
    if (input.signal?.aborted) {
      throw Object.assign(new Error('Stopped watching this run.'), { sessionId, watcherOnly: true });
    }
    await sleep(INTERVAL_MS);

    let progress: RunProgress;
    try {
      progress = await pollRun(sessionId, startedAt);
    } catch (err) {
      // A dropped poll is not a dropped run. Keep trying until the deadline.
      if (Date.now() > deadline) throw Object.assign(err as Error, { sessionId, watcherOnly: true });
      continue;
    }

    input.onProgress(progress, sessionId);
    if (isTerminal(progress.status)) return progress;

    if (Date.now() > deadline) {
      throw Object.assign(new Error('The agent is taking unusually long.'), { sessionId, watcherOnly: true });
    }
  }
}

/** Re-attach to a run started earlier — after a reload, or a surface switch. */
export async function resumeRun(input: {
  sessionId: string;
  startedAt: number;
  onProgress: (progress: RunProgress, sessionId: string) => void;
  signal?: AbortSignal;
}): Promise<RunProgress> {
  for (;;) {
    if (input.signal?.aborted) {
      throw Object.assign(new Error('Stopped watching this run.'), { watcherOnly: true });
    }
    const progress = await pollRun(input.sessionId, input.startedAt);
    input.onProgress(progress, input.sessionId);
    if (isTerminal(progress.status)) return progress;
    await sleep(1_500);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
