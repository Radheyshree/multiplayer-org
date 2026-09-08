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
import { storage, storageReady } from './xyne';
import { actsOf, isRoutine, type MessageLike } from './provenance';

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
