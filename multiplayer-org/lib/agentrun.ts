import { actsOf, isRoutine, type MessageLike } from './origin';
import { storage, storageReady, xyne } from './xyne';

/* ---- from lib/agentrun.ts --------------------------------------------- */
/**
 * Running a Claw agent inside a ticket's thread, and showing its work.
 *
 * THE FINDING THIS FILE IS BUILT ON.
 *
 * `spaces.claw.getRun()` is typed as returning four fields:
 *
 *     interface ClawRun { sessionId: string; status: string; result?: string; error?: string }
 *
 * That type is a lie of omission. The SDK's registry entry for `getRun` sets no
 * `mapResult`, and the transport only transforms a response when one is
 * present — so what actually comes back is the whole `AgentRun` row, roughly
 * thirty-five columns, straight from Postgres via two passthrough hops. Among
 * them:
 *
 *     toolInvocations   the full array of tool calls, each with args and result
 *     currentToolLabel  what it is doing right now
 *     reasoning         its thinking, as text
 *     toolsUsed         the flat list of tool names
 *     tokensIn/Out      cost
 *     totalMs, ttftMs   latency
 *
 * That is the difference between "the agent is working…" and a real, itemised
 * account of what it read and what it changed — which is the entire point of
 * the surface this feeds. We reach it by declaring the wider shape and casting,
 * with every field optional, so if a future SDK version does start narrowing
 * the response the UI degrades to a spinner instead of crashing.
 *
 * WHAT WE DO NOT GET, and why this polls.
 *
 * Xyne has real push streaming — named-event SSE framing `snapshot | delta |
 * reasoning | invocation | label | done` — but it is dashboard-internal. The
 * SDK has no streaming primitive at all, and the one sanctioned way an app gets
 * live agent events is the dashboard's artifact bridge relaying them over
 * postMessage, which only exists when we are embedded. So: poll `getRun`, and
 * accept that our resolution is the poll interval rather than the token.
 */

/** One tool call, as recorded on the run. */
export interface ToolInvocation {
  toolName?: string;
  /** Present while running, absent once finished on some producers. */
  status?: string;
  args?: unknown;
  result?: string;
  isError?: boolean;
  durationMs?: number;
  toolCallId?: string;
  /** Set when the call was made by a delegated subagent rather than the agent. */
  subagentName?: string;
  parentToolCallId?: string;
}

/**
 * The run, as it really arrives.
 *
 * Every field beyond `sessionId` and `status` is optional because this is a
 * wider read of a narrower declared type — see the header. Treat anything here
 * as absent-until-proven.
 */
export interface AgentRun {
  sessionId: string;
  status: string;
  result?: string;
  error?: string;
  agentSlug?: string;
  task?: string;
  conversationId?: string;
  channelId?: string;
  currentToolLabel?: string;
  reasoning?: string;
  toolsUsed?: string[];
  toolInvocations?: ToolInvocation[];
  tokensIn?: number;
  tokensOut?: number;
  totalMs?: number;
  startedAt?: string | number;
  completedAt?: string | number;
  /** "spaces" | "scheduled" | "chat" | "api" | "automation" | "slack" | heartbeat/reflex. */
  triggerSource?: string;
}

/**
 * Statuses that mean "stop polling".
 *
 * The backend only ever writes running / completed / failed / cancelled, but
 * the SDK's own polling loop also accepts `canceled` and `error`. Matching its
 * wider set costs nothing and avoids polling forever against a deployment that
 * spells it differently.
 */
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'canceled', 'error']);

export const isTerminal = (status: string): boolean => TERMINAL.has(status.toLowerCase());
export const isFailure = (status: string): boolean =>
  ['failed', 'error'].includes(status.toLowerCase());

/** Agents this deployment can run, deduped and ordered for a picker. */
export interface AgentOption {
  slug: string;
  name: string;
  description: string;
  isDefault: boolean;
  color?: string;
  /**
   * The agent's user row in Spaces, when it has one.
   *
   * Agents wired into Spaces get a real user (`userType: 'APP'`) that appears
   * in the directory like a person. That id is what makes an agent
   * @-mentionable: a mention span points at a user id, and an automation with a
   * MESSAGE_RECEIVED trigger can filter on it. Absent for agents that were
   * never installed as a Spaces app — they are still dispatchable, just not
   * addressable by name in a sentence.
   *
   * Not in the SDK's `ClawAgent` type; it arrives anyway, like the rest of the
   * response (see the header).
   */
  spacesAppUserId?: string;
}

export async function listAgents(): Promise<AgentOption[]> {
  const { spaces } = await xyne();
  const raw = await spaces.claw.listAgents();
  // Dedupe on slug: this list is not org-scoped (the S2S call carries no user
  // identity, so every `scope: "global"` agent in the deployment comes back),
  // and display names collide across orgs while slugs cannot.
  const bySlug = new Map<string, AgentOption>();
  for (const a of raw as unknown as Array<Record<string, unknown>>) {
    const slug = typeof a.slug === 'string' ? a.slug : '';
    if (!slug || bySlug.has(slug)) continue;
    const appUser = typeof a.spacesAppUserId === 'string' ? a.spacesAppUserId : '';
    bySlug.set(slug, {
      slug,
      name: typeof a.name === 'string' && a.name ? a.name : slug,
      description: typeof a.description === 'string' ? a.description : '',
      isDefault: Boolean(a.isDefault),
      ...(typeof a.color === 'string' && a.color ? { color: a.color } : {}),
      ...(appUser ? { spacesAppUserId: appUser } : {}),
    });
  }
  // ask-ai first for the same reason defaultAgent prefers it — the picker's
  // first row and the default must agree, or the select looks wrong on open.
  const rank = (a: AgentOption): number => (a.slug === 'ask-ai' ? 0 : a.isDefault ? 1 : 2);
  return [...bySlug.values()].sort((x, y) => rank(x) - rank(y) || x.name.localeCompare(y.name));
}

/**
 * Pick an agent when the user has not chosen one.
 *
 * `ask-ai` first, deliberately, ahead of the deployment's own `isDefault` flag
 * (which points at `assistant`). Two reasons, both from watching them work in
 * this workspace: ask-ai is the agent people actually @-mention in Spaces
 * threads, so its answers match what a reader is used to seeing on a ticket;
 * and it follows an output contract cleanly, where `assistant` is a
 * general-purpose chat agent whose replies are looser.
 *
 * The `isDefault` flag remains the fallback, so a deployment without ask-ai
 * still gets whatever it nominated rather than an arbitrary first row.
 */
export function defaultAgent(agents: AgentOption[]): AgentOption | null {
  return (
    agents.find(a => a.slug === 'ask-ai') ??
    agents.find(a => a.isDefault) ??
    agents.find(a => a.slug === 'assistant') ??
    agents[0] ??
    null
  );
}

export interface DispatchInput {
  agent: string;
  task: string;
  /** The ticket's thread. Continues it rather than starting a new one. */
  conversationId?: string;
  /** The channel that thread lives in. */
  channelId?: string;
  context?: string;
}

/** Start a run. Returns immediately with the session to poll. */
export async function dispatch(input: DispatchInput): Promise<string> {
  const { spaces } = await xyne();
  const { sessionId } = await spaces.claw.run(input);
  return sessionId;
}

/** Read a run, widened past the SDK's declared four fields. */
export async function readRun(sessionId: string): Promise<AgentRun> {
  const { spaces } = await xyne();
  return (await spaces.claw.getRun(sessionId)) as unknown as AgentRun;
}

/**
 * Poll a run to completion, reporting every change.
 *
 * Deliberately hand-rolled rather than `claw.runAndWait`, for three reasons:
 * runAndWait starts its own run so it cannot attach to one already in flight;
 * its `onProgress` hands back the narrow `ClawRun` type, which is exactly the
 * information we need and exactly what it drops; and it has no way to stop
 * early other than an AbortSignal it owns.
 *
 * Backs off from 1s to 5s. A short first interval matters because the first
 * tool label appears within about a second and is what makes the surface feel
 * alive; a long ceiling matters because agent runs routinely last minutes.
 *
 * A RUN THAT NEVER EXISTED. Measured over eleven dispatches: one returned HTTP
 * 500 on a body that worked on retry, and TWO returned 200 with a sessionId
 * that `getRun` then 404s on forever — still 404 ten minutes later. The original
 * loop treated every failed poll alike and sat there for the full five-minute
 * timeout on a run that was never going to exist, which reads to the user as a
 * hung agent rather than as a failed dispatch. So a poll that has never once
 * succeeded gives up after GIVE_UP_MS and says so; a poll that fails after the
 * run has been seen keeps retrying, because that is a network blip and the
 * agent is still working.
 */
const GIVE_UP_MS = 30_000;
export async function watchRun(
  sessionId: string,
  onUpdate: (run: AgentRun) => void,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<AgentRun> {
  const { signal, timeoutMs = 5 * 60_000 } = options;
  const started = Date.now();
  let delay = 1000;
  let last: AgentRun = { sessionId, status: 'running' };
  let everRead = false;

  for (;;) {
    if (signal?.aborted) return last;
    try {
      last = await readRun(sessionId);
      everRead = true;
      onUpdate(last);
      if (isTerminal(last.status)) return last;
    } catch {
      // A failed poll is not a failed run — the agent keeps working. Keep the
      // last good state on screen and try again. Unless we have never managed
      // to read it at all, in which case the dispatch itself did not take.
      if (!everRead && Date.now() - started > GIVE_UP_MS) {
        return {
          ...last,
          status: 'failed',
          error: 'The agent did not start. Nothing was run — try again.',
        };
      }
    }
    if (Date.now() - started > timeoutMs) {
      return { ...last, status: 'failed', error: 'Timed out waiting for the agent.' };
    }
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 5000);
  }
}

/**
 * Turn a raw tool id into something a person can read.
 *
 * This is Xyne's own transform, reproduced: strip the MCP server prefix before
 * `__`, strip any namespace before a `:`, split on `-`/`_`, title case.
 *
 *     Xyne_Spaces__spaces-create-ticket  ->  Create Ticket
 *     github:get_pull_request            ->  Get Pull Request
 *
 * Raw ids look terrible in a step list, and matching the dashboard's phrasing
 * means the same tool reads the same way in both products.
 */
export function humanizeTool(raw: string | undefined): string {
  if (!raw) return 'Tool';
  let name = raw;

  // The MCP server prefix, and then the same name AGAIN. Tools are commonly
  // registered as `Xyne_Spaces__spaces-create-ticket`, where the first segment
  // after the separator repeats the server — so stripping only the prefix
  // leaves "Spaces Create Ticket". Drop a leading segment that the server name
  // already contains, and only then.
  const mcp = name.indexOf('__');
  let server = '';
  if (mcp !== -1) {
    server = name.slice(0, mcp).toLowerCase().replace(/[_-]/g, '');
    name = name.slice(mcp + 2);
  }

  const ns = name.lastIndexOf(':');
  if (ns !== -1) name = name.slice(ns + 1);

  const parts = name.split(/[-_]+/).filter(Boolean);
  if (parts.length > 1 && server && server.includes(parts[0].toLowerCase())) parts.shift();

  return parts.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Tool';
}

/**
 * Durations the way the dashboard writes them.
 *
 * Sub-second in milliseconds because "0.8s" reads as slower than "840ms";
 * everything else in the largest unit that stays precise.
 */
export function formatDuration(ms: number | undefined): string {
  if (!ms || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/**
 * A one-line summary of what a tool call was about.
 *
 * `args` is whatever the tool declared, so this reads the handful of keys that
 * actually identify a target across the tools Xyne ships, then falls back to
 * the first short string value rather than dumping JSON at the reader.
 */
export function describeArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const a = args as Record<string, unknown>;
  const preferred = [
    'query', 'q', 'search',
    'ticketId', 'xyneId', 'conversationId', 'channelId',
    'pullNumber', 'prId', 'repo', 'repository', 'owner',
    'path', 'file', 'url', 'title', 'name',
  ];
  for (const k of preferred) {
    const v = a[k];
    if (typeof v === 'string' && v) return v.length > 60 ? `${v.slice(0, 60)}…` : v;
    if (typeof v === 'number') return String(v);
  }
  for (const v of Object.values(a)) {
    if (typeof v === 'string' && v && v.length <= 60) return v;
  }
  return '';
}

/**
 * The collapsed one-line header for a run's activity, in the dashboard's shape:
 * "Read 3 tools · 4.2s". Returns null when there is nothing worth showing yet.
 */
export function summarise(run: AgentRun): string | null {
  const tools = run.toolInvocations?.length ?? run.toolsUsed?.length ?? 0;
  const bits: string[] = [];
  if (tools) bits.push(`${tools} ${tools === 1 ? 'tool' : 'tools'}`);
  const d = formatDuration(run.totalMs);
  if (d) bits.push(d);
  return bits.length ? bits.join(' · ') : null;
}

/* ---- from lib/watcher.ts ---------------------------------------------- */
/**
 * Agents that act without being asked.
 *
 * WHAT XYNE HAS, AND WHY WE CANNOT USE IT.
 *
 * Xyne Claw has a real autonomy feature called Awakening. An agent's config
 * carries an `awakening` block; a tick worker claims due agents with `FOR
 * UPDATE SKIP LOCKED`, collects every message in the channels its bot belongs
 * to inside a sealed time window, runs an ordered gate (mention → escalation →
 * unanswered thread → open question), and dispatches a run carrying the window
 * as files plus an operating contract and a tool-permission map.
 *
 * None of it is reachable from here, and that is not a guess:
 *
 *   - The string "awakening" appears ZERO times in `apps/backend/src` — the
 *     Spaces backend is the only service `@xyne/spaces-sdk` talks to.
 *   - It appears zero times in the SDK's dist.
 *   - `sdk.claw` is exactly four methods, and `ClawAgent` has no `config`, so
 *     we cannot even READ whether an agent is awakening-enabled.
 *   - The only write path is `PUT /agents/:slug` on the claw-auth service,
 *     behind an admin guard that rejects access tokens by construction.
 *   - `POST /api/sdk/v1/claw/runs` validates a closed five-field body, so an
 *     awakening block cannot be smuggled through either.
 *
 * So this file does not wrap Awakening. It reimplements the part of it that an
 * app CAN do, and it says so in the UI rather than showing a toggle that
 * quietly does nothing.
 *
 * WHAT THIS IS.
 *
 * A watcher, armed per ticket, shared by everyone looking at that ticket
 * (`global` scope storage — so arming it is a decision the team makes, not a
 * per-device preference). While armed, the surface that is already polling the
 * ticket's thread hands each new batch of messages to `evaluate()`, which runs
 * a deterministic ordered gate and either returns a reason to wake the agent or
 * returns null. Nothing here calls an LLM to decide whether to call an LLM.
 *
 * Three rules borrowed from Awakening's own design, because they are the ones
 * that make the difference between useful and maddening:
 *
 *   1. NEVER ADVANCE THE WATERMARK TO NOW. Awakening seals its window behind
 *      `now` by a replication-safety margin so the watermark cannot step over
 *      rows that have not replicated yet. Ours holds back too — skipping a
 *      message is invisible until someone notices the agent ignored them.
 *   2. RATE LIMIT. Awakening defaults to four runs an hour per agent. An
 *      autonomous agent with no ceiling is a way to spend money on a loop.
 *   3. THE GATE IS ORDERED AND DETERMINISTIC. A person can predict what will
 *      wake it, which is what makes it something you would leave switched on.
 */

/** How far behind `now` the watermark is held. */
const LAG_MS = 30_000;

/** Ceiling per ticket, matching Awakening's own default. */
const MAX_RUNS_PER_HOUR = 4;

/** How long a question goes unanswered before it counts as unanswered. */
const QUIET_MS = 10 * 60_000;

export interface WatchState {
  armed: boolean;
  /** Which agent wakes. Slug, never id or name. */
  agentSlug: string;
  /** Only messages after this are considered. Held LAG_MS behind now. */
  watermarkAt: number;
  /** Start times of recent runs, for the rate limit. Pruned to the last hour. */
  recentRuns: number[];
  armedBy?: string;
  armedAt?: number;
}

export const IDLE: WatchState = { armed: false, agentSlug: '', watermarkAt: 0, recentRuns: [] };

const COLLECTION = 'ticket-watch';

/**
 * Read a ticket's watch state.
 *
 * Global scope on purpose: a watcher is a property of the ticket, not of the
 * person who armed it. Someone else opening the same ticket should see that an
 * agent is watching it — and should be able to turn it off.
 */
export async function readState(ticketId: string): Promise<WatchState> {
  if (!storageReady) return IDLE;
  try {
    const rec = await storage.collection<WatchState>(COLLECTION).get(ticketId, { scope: 'global' });
    const v = rec?.value;
    if (!v) return IDLE;
    return {
      armed: Boolean(v.armed),
      agentSlug: typeof v.agentSlug === 'string' ? v.agentSlug : '',
      watermarkAt: typeof v.watermarkAt === 'number' ? v.watermarkAt : 0,
      recentRuns: Array.isArray(v.recentRuns) ? v.recentRuns.filter(n => typeof n === 'number') : [],
      ...(v.armedBy ? { armedBy: v.armedBy } : {}),
      ...(v.armedAt ? { armedAt: v.armedAt } : {}),
    };
  } catch {
    // Storage being unavailable must never break the ticket view.
    return IDLE;
  }
}

export async function writeState(ticketId: string, state: WatchState): Promise<void> {
  if (!storageReady) return;
  // `global` has no locking and last write wins, so keep the document small and
  // write the whole of it rather than merging fields.
  await storage.collection<WatchState>(COLLECTION).put(ticketId, state, { scope: 'global' });
}

/** A message as the gate needs to see it. */
export interface WatchMessage extends MessageLike {
  messageId: string;
  senderId: string;
  createdAt: number;
  messageActs?: unknown;
}

export interface WakeDecision {
  /** Why it woke, in words a person can check against the thread. */
  reason: string;
  /** Short machine tag for the ledger entry and telemetry. */
  rule: 'mention' | 'code-event' | 'unanswered-question';
  /** The messages that triggered it, oldest first. */
  window: WatchMessage[];
}

/** Skips are reported, not swallowed — "why didn't it fire" is the first question. */
export interface SkipReason {
  skip: 'not-armed' | 'no-new-messages' | 'rate-limited' | 'nothing-to-do' | 'only-our-own';
  detail?: string;
}

export type Evaluation = WakeDecision | SkipReason;

export const isWake = (e: Evaluation): e is WakeDecision => 'reason' in e;

const isHuman = (m: WatchMessage): boolean => m.msgType === 'USER';

/**
 * Decide whether the agent should wake.
 *
 * Ordered, deterministic, and cheap — no model call, no network. The order is
 * the priority: an explicit mention beats a code event beats a question that
 * has gone quiet, because that is the order in which a person would want to be
 * interrupted on their behalf.
 */
export function evaluate(
  state: WatchState,
  messages: WatchMessage[],
  now: number = Date.now(),
): Evaluation {
  if (!state.armed || !state.agentSlug) return { skip: 'not-armed' };

  // Held back deliberately — see the header. A message that arrived 5s ago is
  // considered on the NEXT pass, not skipped.
  const ceiling = now - LAG_MS;
  const window = messages
    .filter(m => m.createdAt > state.watermarkAt && m.createdAt <= ceiling)
    .sort((a, b) => a.createdAt - b.createdAt);

  if (window.length === 0) return { skip: 'no-new-messages' };

  const recent = state.recentRuns.filter(t => now - t < 3_600_000);
  if (recent.length >= MAX_RUNS_PER_HOUR) {
    return {
      skip: 'rate-limited',
      detail: `${recent.length} runs in the last hour is the ceiling.`,
    };
  }

  // Our own entries must never wake the agent. An agent that replies to its own
  // note, and wakes on that reply, is a loop that bills by the token.
  const fromOthers = window.filter(m => !isRoutine(m) || m.msgType === 'SYSTEM');
  if (fromOthers.length === 0) return { skip: 'only-our-own' };

  // 1. Somebody asked for it by name.
  const mention = window.find(m => /@?\bagent\b|@assistant|@ai\b/i.test(m.content ?? ''));
  if (mention) {
    return { rule: 'mention', reason: 'Somebody asked for the agent in the thread.', window };
  }

  // 2. The code host said something. A PR opening or merging against a ticket
  //    is the single most reliable "state changed, go look" signal here.
  const code = window.find(m => {
    const md = m.metadata && typeof m.metadata === 'object' ? (m.metadata as Record<string, unknown>) : {};
    return md.prWebhook === true || md.prUrl !== undefined;
  });
  if (code) {
    return { rule: 'code-event', reason: 'A pull request event landed on this ticket.', window };
  }

  // 3. A person asked a question and nothing has answered it since.
  //    `messageActs` is Xyne's own classifier, so this is its judgement of what
  //    a question is, not a regex of ours.
  const questions = window.filter(m => isHuman(m) && actsOf(m.messageActs).includes('QUESTION'));
  const lastQuestion = questions[questions.length - 1];
  if (lastQuestion) {
    const answeredSince = messages.some(
      m => m.createdAt > lastQuestion.createdAt && m.senderId !== lastQuestion.senderId,
    );
    if (!answeredSince && now - lastQuestion.createdAt > QUIET_MS) {
      return {
        rule: 'unanswered-question',
        reason: 'A question has been open on this ticket for ten minutes.',
        window,
      };
    }
  }

  return { skip: 'nothing-to-do', detail: `${window.length} new message(s), none actionable.` };
}

/**
 * The prompt an awakened run receives.
 *
 * Awakening hands its agent a collected window as files plus an operating
 * contract. `claw.run` accepts a task string and a context string and nothing
 * else, so the window is rendered into the context — smaller and blunter, but
 * the same idea: the agent is told what changed, not asked to go and look.
 */
export function wakePrompt(decision: WakeDecision, ticketKey: string, nameOf: (id: string) => string): {
  task: string;
  context: string;
} {
  const lines = decision.window
    .slice(-20)
    .map(m => {
      const who = nameOf(m.senderId);
      const when = new Date(m.createdAt).toLocaleString();
      const text = (m.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return `[${when}] ${who}: ${text.slice(0, 400)}`;
    })
    .join('\n');

  return {
    task:
      `You were woken automatically on ${ticketKey}: ${decision.reason}\n\n` +
      'Read the ticket\'s conversation, decide whether anything actually needs doing, and ' +
      'reply in the thread. If nothing needs doing, say so in one line rather than ' +
      'summarising for the sake of it — you were not asked a question by a person, and a ' +
      'long answer nobody wanted is worse than silence.',
    context: `New activity on ${ticketKey} since the agent last looked:\n${lines}`,
  };
}

/**
 * Advance the watermark and record the run.
 *
 * Called after a dispatch, whatever its outcome — a run that failed still
 * consumed the window, and re-firing on the same messages would loop.
 */
export function afterRun(state: WatchState, window: WatchMessage[], now = Date.now()): WatchState {
  const highest = window.reduce((max, m) => Math.max(max, m.createdAt), state.watermarkAt);
  return {
    ...state,
    watermarkAt: highest,
    recentRuns: [...state.recentRuns.filter(t => now - t < 3_600_000), now],
  };
}

/**
 * Advance the watermark past messages we looked at and chose not to act on.
 *
 * Without this, one un-actionable message is re-evaluated on every poll
 * forever. Keeps the rate-limit history untouched — nothing ran.
 */
export function afterSkip(state: WatchState, messages: WatchMessage[], now = Date.now()): WatchState {
  const ceiling = now - LAG_MS;
  const seen = messages.filter(m => m.createdAt <= ceiling).map(m => m.createdAt);
  if (!seen.length) return state;
  return { ...state, watermarkAt: Math.max(state.watermarkAt, ...seen) };
}
