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
import { xyne } from './xyne';

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
}

export async function listAgents(): Promise<AgentOption[]> {
  const { spaces } = await xyne();
  const raw = await spaces.claw.listAgents();
  // Dedupe on slug: this list is not org-scoped (the S2S call carries no user
  // identity, so every `scope: "global"` agent in the deployment comes back),
  // and display names collide across orgs while slugs cannot.
  const bySlug = new Map<string, AgentOption>();
  for (const a of raw) {
    if (!a.slug || bySlug.has(a.slug)) continue;
    bySlug.set(a.slug, {
      slug: a.slug,
      name: a.name || a.slug,
      description: a.description || '',
      isDefault: Boolean(a.isDefault),
      ...(a.color ? { color: a.color } : {}),
    });
  }
  return [...bySlug.values()].sort(
    (x, y) => Number(y.isDefault) - Number(x.isDefault) || x.name.localeCompare(y.name),
  );
}

/**
 * Pick a sensible agent when the user has not chosen one.
 *
 * `isDefault` is how claw-auth itself picks, so it comes first; the name/slug
 * heuristics only run when a deployment has flagged nothing.
 */
export function defaultAgent(agents: AgentOption[]): AgentOption | null {
  return (
    agents.find(a => a.isDefault) ??
    agents.find(a => /^(assistant|ask-ai)$/.test(a.slug)) ??
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
 */
export async function watchRun(
  sessionId: string,
  onUpdate: (run: AgentRun) => void,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<AgentRun> {
  const { signal, timeoutMs = 5 * 60_000 } = options;
  const started = Date.now();
  let delay = 1000;
  let last: AgentRun = { sessionId, status: 'running' };

  for (;;) {
    if (signal?.aborted) return last;
    try {
      last = await readRun(sessionId);
      onUpdate(last);
      if (isTerminal(last.status)) return last;
    } catch {
      // A failed poll is not a failed run — the agent keeps working. Keep the
      // last good state on screen and try again.
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
