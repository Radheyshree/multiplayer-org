/**
 * The update agent: noticing that a ticket needs something from a person.
 *
 * WHAT THIS IS FOR, in the words it was asked for: "I have lots of stale tickets
 * where I have merged the PRs but never updated the status — if this agent could
 * say 'hey do you want to close this?' that would be a good help."
 *
 * So this file answers three questions, in order, and nothing else:
 *
 *   1. Does this ticket need an update?      → an ordered, deterministic gate
 *   2. From whom?                            → assignee, then creator, then the
 *                                              last person who spoke
 *   3. What could they do about it in one click? → suggestions read off THIS
 *                                              ticket's own board, never invented
 *
 * NOTHING HERE CALLS A MODEL. That is deliberate, and it is the same discipline
 * as lib/watcher.ts: a nudge you cannot predict is a nudge you switch off. The
 * agent's job starts after this file has decided there is something to say —
 * it writes the sentence and does the looking-into, it does not do the noticing.
 *
 * GROUNDED IN THE REAL WORKSPACE. Every rule below was measured against the
 * signed-in user's own 81 tickets before it was written, and any rule the data
 * did not support was dropped rather than kept "just in case". What fires today:
 *
 *     pr-merged     14 tickets   PR merged, ticket still open, merge > 3 days old
 *     pr-declined   16 tickets   PR declined, ticket still open
 *     eta-passed    12 tickets   the ETA is in the past
 *     gone-quiet     2 tickets   Started, silent 14+ days, no PR verdict either way
 *     unanswered     0 tickets   somebody asked something and nobody answered
 *
 * `unanswered` is kept at zero yield on purpose: it is the case the feature was
 * asked for first ("it needs someone's input"), it costs nothing because the
 * ledger already holds the messages, and a rule that has not fired yet is not the
 * same as a rule that cannot.
 *
 * THE TRAP THAT SHAPED THE SUGGESTIONS. Every one of those 14 merged-PR tickets
 * is ALREADY sitting at a stage called MERGED or Merged — the PR bot moved the
 * card and nobody ever moved the ticket. It is tempting to conclude "merged means
 * done, offer Close". Both boards in this workspace say otherwise:
 *
 *     TODO → IN_PROGRESS → IN_REVIEW → READY_TO_MERGE → MERGED → LIVE
 *     To be Picked Up → Dev in Progress → PR Review → QA Testing → Merged → Sandbox → Prod
 *
 * There is life after Merged on both, and the four tickets that ARE completed sit
 * at four different stages. So the primary suggestion is the NEXT STAGE ON THIS
 * TICKET'S OWN BOARD, and closing is offered beside it rather than instead of it.
 * A board with nothing after the current stage gets closing as the primary. That
 * is the difference between a suggestion and a guess.
 */
import { storage, storageReady } from './xyne';
import { actsOf, type MessageLike } from './provenance';
import {
  getDetails,
  listActivities,
  moveToStage,
  stageName as nameOfStage,
  updateTicket,
  type Activity,
  type Priority,
  type Stage,
  type StatusV2,
} from './tickets';
import { xyne } from './xyne';

/** The statuses that mean "this ticket is finished". Nothing is asked of them. */
const CLOSED: StatusV2[] = ['COMPLETED', 'CANCELLED'];

/**
 * How old a PR verdict must be before it is worth asking about.
 *
 * Three days. A PR merged this morning does not need a robot asking whether you
 * meant it; one merged in July does. Measured against the real spread — of the
 * 15 open tickets with a merged PR, 14 are older than this and the one that is
 * not was merged two days ago and is plainly still in flight.
 */
const PR_GRACE_DAYS = 3;

/** Silence, before "Started" stops being believable. */
const QUIET_DAYS = 14;

/** How long a question can go unanswered before somebody is being left hanging. */
const UNANSWERED_DAYS = 1;

const DAY = 86_400_000;

export type NudgeRule =
  | 'unanswered'
  | 'pr-merged'
  | 'pr-declined'
  | 'eta-passed'
  | 'gone-quiet'
  | 'unowned';

/**
 * Rule order IS priority, and it is a judgement about people rather than data:
 * somebody waiting on an answer outranks any amount of bookkeeping, and a
 * verdict from the code host outranks a date passing quietly.
 */
const ORDER: NudgeRule[] = [
  'unanswered',
  'pr-merged',
  'pr-declined',
  'eta-passed',
  'gone-quiet',
  'unowned',
];

/** What one click would do. */
export type SuggestionKind = 'stage' | 'status' | 'eta' | 'assign' | 'reply' | 'ask';

export interface Suggestion {
  kind: SuggestionKind;
  /** What the button says, in the ticket's own vocabulary — "Move to LIVE". */
  label: string;
  stageName?: string;
  statusV2?: StatusV2;
  /** Absolute epoch ms, for `eta`. */
  eta?: number;
  /** User id, for `assign`. */
  assignTo?: string;
  /**
   * This one throws work away.
   *
   * Set on cancelling, and read by any surface that promotes a suggestion to a
   * primary button. The ordering inside `suggestions` already puts the gentle
   * option first, but a caller that picks "the first one that changes something"
   * skips straight past it — which is how a queue of sixteen declined pull
   * requests came to render sixteen large buttons offering to cancel the work.
   * Closing a ticket whose code shipped is NOT destructive; abandoning one is.
   */
  destructive?: boolean;
  /**
   * The sentence written into the ticket when this is accepted.
   *
   * Every accepted suggestion leaves a line in the thread saying what changed
   * and that the update agent proposed it. An action a machine suggested and a
   * person took should be legible as exactly that, later, by someone who was
   * not here.
   */
  records: string;
}

/** How the person who owes the update was picked. Shown, because "why me?". */
export type OwnerReason = 'assignee' | 'creator' | 'last-speaker' | 'nobody';

export interface Nudge {
  ticketId: string;
  xyneId: string;
  title: string;
  conversationId: string;
  channelId: string;
  rule: NudgeRule;
  /** Who owes it. Null when the ticket has nobody at all — see `unowned`. */
  ownerId: string | null;
  ownerReason: OwnerReason;
  /** The ask, in one line, checkable against the ticket by eye. */
  ask: string;
  /** The evidence it stands on — "PR #8842 merged 55 days ago". */
  because: string;
  /** Ordered; the first is primary. */
  suggestions: Suggestion[];
  /** Stable across scans, so a dismissal sticks to a finding rather than a run. */
  key: string;
  /**
   * Whether this ticket's board enforces transition rules.
   *
   * Carried on the finding rather than looked up when the button is pressed, so
   * that accepting a suggestion needs no further reads — and so the digest, which
   * acts on tickets it does not have open, takes the same path as the ledger. A
   * non-linear board runs its rules on a move and may refuse; the permissive
   * path would quietly skip an approval the team relies on.
   */
  nonLinear: boolean;
  /** How long this has been true, for ordering the digest. */
  ageDays: number;
}

/** Everything a rule is allowed to look at. Gathering it is somebody else's job. */
export interface TicketFacts {
  id: string;
  xyneId: string;
  title: string;
  conversationId: string;
  channelId: string;
  statusV2: StatusV2 | string;
  stageName: string;
  priority?: Priority | string;
  assignedTo?: string | null;
  createdBy?: string | null;
  eta?: number | null;
  /** The board's stages in sequence, so a suggestion can name the real next one. */
  stages: string[];
  /** Whether the board enforces transition rules — decides which write path. */
  nonLinear: boolean;
  /** The newest PR event on the ticket, from its activity log. */
  pr?: { action: string; number?: number; url?: string; repo?: string; at: number } | null;
  /** When anything last landed in the thread, from any surface. */
  lastMessageAt?: number | null;
  /**
   * When the ticket RECORD last changed, as the server stamps it.
   *
   * The fallback clock for staleness when the thread has not been read — see
   * `scan`. It is a proxy and not a perfect one: measured across all 81 tickets
   * it agrees with the newest message to within three days on 67 of them and
   * disagrees by more on 14. So it is used only when the exact answer is not
   * already in hand, and the nudge says which clock it read.
   */
  updatedAt?: number | null;
  /** When a person last spoke, and who. */
  lastHuman?: { at: number; senderId: string } | null;
  /** A question nobody has answered, if there is one. */
  openQuestion?: { at: number; senderId: string; text: string } | null;
}

const days = (from: number, now: number): number => Math.max(0, (now - from) / DAY);

/** "55 days", "2 days", "today" — the way a person would say it. */
export function sinceWords(ms: number): string {
  const d = Math.round(ms / DAY);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  const m = Math.round(d / 30);
  return m === 1 ? 'a month ago' : `${m} months ago`;
}

const isOpen = (f: TicketFacts): boolean => !CLOSED.includes(f.statusV2 as StatusV2);

/**
 * The stage after this one, on this ticket's own board.
 *
 * Returns null at the end of the board, and null when the ticket's stage is not
 * on its board's list at all — which happens, because stage names are free text
 * and a ticket can carry one the board has since renamed. Suggesting a move to a
 * stage that does not exist would fail at click time, so it is not suggested.
 */
export function nextStage(f: TicketFacts): string | null {
  const i = f.stages.findIndex(s => s.toLowerCase() === f.stageName.toLowerCase());
  if (i === -1) return null;
  const next = f.stages[i + 1];
  if (!next) return null;
  // Stages that mean "this did not happen" are not a step forward, and offering
  // "Move to REJECTED" as the natural next step after MERGED reads as an insult.
  if (/reject|declin|duplicate|cancel|abandon/i.test(next)) return null;
  return next;
}

const closeSuggestion = (f: TicketFacts, why: string): Suggestion => ({
  kind: 'status',
  label: 'Close it',
  statusV2: 'COMPLETED',
  records: `Closed — ${why}`,
});

const updateSuggestion = (): Suggestion => ({
  kind: 'reply',
  label: 'Say where it stands',
  records: '',
});

const askSuggestion = (): Suggestion => ({
  kind: 'ask',
  label: 'Ask the agent to check',
  records: '',
});

/**
 * Decide whether this ticket needs something from somebody.
 *
 * Ordered and deterministic — the first rule that matches wins, and a person can
 * predict which. Returns null far more often than not: 45 of the 81 tickets this
 * was built against get nothing, and a gate that fires on everything is a gate
 * nobody reads.
 */
export function detect(f: TicketFacts, now: number = Date.now()): Nudge | null {
  if (!isOpen(f)) return null;

  const base = {
    ticketId: f.id,
    xyneId: f.xyneId,
    title: f.title,
    conversationId: f.conversationId,
    channelId: f.channelId,
  };
  const owner = ownerOf(f);

  for (const rule of ORDER) {
    const hit = rules[rule](f, now, owner);
    if (hit) {
      return {
        ...base,
        rule,
        ownerId: owner.id,
        ownerReason: owner.reason,
        key: `${f.id}:${rule}:${hit.stamp}`,
        nonLinear: f.nonLinear,
        ...hit.nudge,
      };
    }
  }
  return null;
}

/** Who owes the update, and how we decided. */
export function ownerOf(f: TicketFacts): { id: string | null; reason: OwnerReason } {
  if (f.assignedTo) return { id: f.assignedTo, reason: 'assignee' };
  // The creator, next. In this workspace 60 of 81 tickets are unassigned, so an
  // assignee-only rule would have nobody to ask on three quarters of the work —
  // and the person who opened a ticket is the person who knows whether it is done.
  if (f.createdBy) return { id: f.createdBy, reason: 'creator' };
  if (f.lastHuman) return { id: f.lastHuman.senderId, reason: 'last-speaker' };
  return { id: null, reason: 'nobody' };
}

/**
 * What a rule returns when it fires.
 *
 * `stamp` is the part of the finding that makes it THIS finding rather than one
 * like it — the merge timestamp, the ETA, the day the thread went quiet. It goes
 * into the key, so dismissing "PR #8842 merged in July" does not also dismiss the
 * next merge on the same ticket.
 */
interface Hit {
  stamp: string | number;
  nudge: Pick<Nudge, 'ask' | 'because' | 'suggestions' | 'ageDays'>;
}

type Rule = (f: TicketFacts, now: number, owner: { id: string | null; reason: OwnerReason }) => Hit | null;

const rules: Record<NudgeRule, Rule> = {
  /**
   * Somebody asked something and nobody answered.
   *
   * The question comes from Xyne's own classifier (`messageActs` carries
   * QUESTION), not from a regex of ours — so this is the platform's judgement of
   * what a question is, the same source lib/watcher.ts trusts.
   */
  unanswered: (f, now) => {
    const q = f.openQuestion;
    if (!q) return null;
    const age = days(q.at, now);
    if (age < UNANSWERED_DAYS) return null;
    return {
      stamp: q.at,
      nudge: {
        ask: 'This is waiting on an answer from you.',
        because: `A question has been open since ${sinceWords(now - q.at)} — “${clip(q.text, 90)}”`,
        suggestions: [updateSuggestion(), askSuggestion()],
        ageDays: age,
      },
    };
  },

  /**
   * The PR landed and the ticket never moved. The case this feature exists for.
   */
  'pr-merged': (f, now) => {
    if (f.pr?.action !== 'merged') return null;
    const age = days(f.pr.at, now);
    if (age < PR_GRACE_DAYS) return null;
    const next = nextStage(f);
    const pr = f.pr.number ? `PR #${f.pr.number}` : 'The pull request';
    return {
      stamp: f.pr.at,
      nudge: {
        ask: next
          ? `${pr} merged ${sinceWords(now - f.pr.at)}. Is this ${next} now, or done?`
          : `${pr} merged ${sinceWords(now - f.pr.at)} and this is still open. Close it?`,
        because: `${pr}${f.pr.repo ? ` in ${f.pr.repo}` : ''} merged ${sinceWords(now - f.pr.at)}; the ticket is still ${humanStatus(f.statusV2)} at ${f.stageName}.`,
        suggestions: [
          ...(next
            ? [
                {
                  kind: 'stage' as const,
                  label: `Move to ${next}`,
                  stageName: next,
                  records: `Moved to ${next} — ${pr} merged ${sinceWords(now - f.pr.at)}.`,
                },
              ]
            : []),
          closeSuggestion(f, `${pr} merged ${sinceWords(now - f.pr.at)}.`),
          updateSuggestion(),
        ],
        ageDays: age,
      },
    };
  },

  /**
   * The PR was turned down and the ticket carried on as if it had not been.
   *
   * Deliberately does NOT suggest cancelling first. A declined PR often means a
   * second attempt is coming, and a robot proposing you cancel your own work as
   * its opening move is the kind of thing that gets a feature switched off. It
   * asks; the destructive option is second.
   */
  'pr-declined': (f, now) => {
    if (f.pr?.action !== 'declined') return null;
    const age = days(f.pr.at, now);
    if (age < PR_GRACE_DAYS) return null;
    const pr = f.pr.number ? `PR #${f.pr.number}` : 'The pull request';
    return {
      stamp: f.pr.at,
      nudge: {
        ask: `${pr} was declined ${sinceWords(now - f.pr.at)}. Is this still happening?`,
        because: `${pr}${f.pr.repo ? ` in ${f.pr.repo}` : ''} was declined ${sinceWords(now - f.pr.at)} and the ticket is still ${humanStatus(f.statusV2)}.`,
        suggestions: [
          updateSuggestion(),
          {
            kind: 'status',
            label: 'Drop it',
            statusV2: 'CANCELLED',
            destructive: true,
            records: `Cancelled — ${pr} was declined ${sinceWords(now - f.pr.at)}.`,
          },
          askSuggestion(),
        ],
        ageDays: age,
      },
    };
  },

  /** The date the team was given has passed. */
  'eta-passed': (f, now) => {
    if (!f.eta || f.eta > now) return null;
    const age = days(f.eta, now);
    const when = new Date(f.eta).toLocaleDateString([], { month: 'short', day: 'numeric' });
    return {
      stamp: f.eta,
      nudge: {
        ask: `The ETA was ${when}. Still on for it?`,
        because: `The ETA passed ${sinceWords(now - f.eta)} and the ticket is still ${humanStatus(f.statusV2)}.`,
        suggestions: [
          updateSuggestion(),
          {
            kind: 'eta',
            label: 'Push it a week',
            eta: now + 7 * DAY,
            records: `ETA moved to ${new Date(now + 7 * DAY).toLocaleDateString([], { month: 'short', day: 'numeric' })} — the previous one passed ${sinceWords(now - f.eta)}.`,
          },
          closeSuggestion(f, 'the work is finished.'),
        ],
        ageDays: age,
      },
    };
  },

  /**
   * Marked as being worked on, and silent for a fortnight.
   *
   * Only reaches here when the code host has said nothing either way — a ticket
   * with a merged or declined PR is covered by a better rule above, and firing
   * both would be two robots asking about the same thing.
   */
  'gone-quiet': (f, now) => {
    if (f.statusV2 !== 'STARTED') return null;
    // The thread when we have it, the record's own timestamp when we do not —
    // and the sentence below says which, because "nothing was said" and "nothing
    // was changed" are different claims and only one of them was checked.
    const at = f.lastMessageAt ?? f.updatedAt ?? null;
    const fromThread = f.lastMessageAt != null;
    if (!at) return null;
    const age = days(at, now);
    if (age < QUIET_DAYS) return null;
    return {
      stamp: Math.round(at / DAY),
      nudge: {
        ask: `Nothing has happened here in ${Math.round(age)} days, and it still says Started.`,
        because: fromThread
          ? `The last thing anyone said on this ticket was ${sinceWords(now - at)}.`
          : `Nothing on this ticket has changed since ${sinceWords(now - at)}.`,
        suggestions: [
          updateSuggestion(),
          {
            kind: 'status',
            label: 'Park it',
            statusV2: 'PAUSED',
            records: `Paused — nothing had happened for ${Math.round(age)} days.`,
          },
          askSuggestion(),
        ],
        ageDays: age,
      },
    };
  },

  /**
   * Nobody owns it.
   *
   * Last, because it is the weakest claim on anyone's attention — but it is real:
   * three quarters of the tickets here have no assignee, and a ticket nobody owns
   * is the one that goes stale next.
   */
  unowned: (f, now, owner) => {
    if (owner.id) return null;
    const at = f.lastMessageAt ?? f.updatedAt ?? null;
    if (at && days(at, now) < QUIET_DAYS) return null;
    return {
      stamp: 'unowned',
      nudge: {
        ask: 'Nobody owns this one.',
        because: `No assignee, and ${at ? `nothing since ${sinceWords(now - at)}` : 'nothing on the thread at all'}.`,
        suggestions: [updateSuggestion()],
        ageDays: at ? days(at, now) : 0,
      },
    };
  },
};

const clip = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;

/** STARTED reads as machinery; "in progress" reads as English. */
export function humanStatus(s: string): string {
  switch (s.toUpperCase()) {
    case 'TODO':
      return 'to do';
    case 'STARTED':
      return 'in progress';
    case 'PAUSED':
      return 'paused';
    case 'COMPLETED':
      return 'done';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return s.toLowerCase().replace(/_/g, ' ');
  }
}

/* ------------------------------------------------------------------ */
/* Gathering the facts                                                 */
/* ------------------------------------------------------------------ */

/** Board stage lists, cached per board — a board's stages do not change per read. */
const boardCache = new Map<string, { stages: string[]; nonLinear: boolean }>();

async function boardShape(boardId?: string | null): Promise<{ stages: string[]; nonLinear: boolean }> {
  if (!boardId) return { stages: [], nonLinear: false };
  const hit = boardCache.get(boardId);
  if (hit) return hit;
  try {
    const { spaces } = await xyne();
    const [stages, transitions] = await Promise.all([
      spaces.boards.listStages(boardId) as unknown as Promise<Stage[]>,
      (spaces.boards.listTransitions(boardId) as unknown as Promise<unknown[]>).catch(() => []),
    ]);
    const shape = {
      stages: [...stages]
        .sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0))
        .map(nameOfStage)
        .filter(Boolean),
      nonLinear: (transitions ?? []).length > 0,
    };
    boardCache.set(boardId, shape);
    return shape;
  } catch {
    // No stages means no stage suggestion, never a missing nudge.
    return { stages: [], nonLinear: false };
  }
}

/**
 * The newest PR event on a ticket.
 *
 * Read off the activity log rather than off the thread, because the activity row
 * is the structured one: `{ prId, prUrl, action, repoName, ... }` with `action`
 * in a closed lowercase vocabulary — measured live as merged, declined, raised,
 * updated, deleted. The thread carries the same events as prose.
 */
export function newestPR(activities: Activity[]): TicketFacts['pr'] {
  const prs = activities
    .filter(a => (a.activityType ?? '').toUpperCase() === 'PR')
    .filter(a => a.value && typeof a.value === 'object')
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  const top = prs[0];
  if (!top) return null;
  const v = top.value as Record<string, unknown>;
  const num = typeof v.prId === 'number' ? v.prId : Number(v.prId);
  return {
    action: String(v.action ?? '').toLowerCase(),
    at: top.timestamp ?? 0,
    ...(Number.isFinite(num) ? { number: num } : {}),
    ...(typeof v.prUrl === 'string' ? { url: v.prUrl } : {}),
    ...(typeof v.repoName === 'string' ? { repo: v.repoName } : {}),
  };
}

/** A message as this module needs to read it. */
export interface ThreadMessage extends MessageLike {
  messageId: string;
  senderId: string;
  createdAt: number;
  messageActs?: unknown;
}

/**
 * The freshest human signal in a thread, and any question left hanging.
 *
 * "Human" means `msgType === 'USER'`: an app recording a stage move and a
 * webhook announcing a build are both real activity, but neither is somebody
 * you can ask, and neither answers a question.
 */
export function readThread(messages: ThreadMessage[]): Pick<TicketFacts, 'lastMessageAt' | 'lastHuman' | 'openQuestion'> {
  const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  const last = sorted[sorted.length - 1];
  const humans = sorted.filter(m => m.msgType === 'USER');
  const lastHumanMsg = humans[humans.length - 1];

  let openQuestion: TicketFacts['openQuestion'] = null;
  for (let i = humans.length - 1; i >= 0; i--) {
    const m = humans[i];
    if (!actsOf(m.messageActs).includes('QUESTION')) continue;
    // Answered means another PERSON said something after it.
    //
    // Two halves, both learned from real threads. The asker adding "anyone?" to
    // their own question is still an unanswered question, so the sender must
    // differ. And machinery does not answer anybody: a PR webhook landing after
    // "what is blocking this?" is not a reply, and counting it would silently
    // close the one rule that exists for people waiting on people.
    const answered = humans.some(o => o.createdAt > m.createdAt && o.senderId !== m.senderId);
    if (!answered) {
      openQuestion = {
        at: m.createdAt,
        senderId: m.senderId,
        text: (m.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      };
    }
    break;
  }

  return {
    lastMessageAt: last?.createdAt ?? null,
    lastHuman: lastHumanMsg ? { at: lastHumanMsg.createdAt, senderId: lastHumanMsg.senderId } : null,
    openQuestion,
  };
}

/** A ticket row, as any surface here already holds it. */
export interface TicketRow {
  id: string;
  xyneId?: string;
  title?: string;
  statusV2?: string;
  stageName?: string;
  priority?: string;
  assignedTo?: string | null;
  createdBy?: string;
  boardId?: string;
  eta?: number | null;
  updatedAt?: number | null;
  conversationId?: string;
  channelId?: string;
}

/**
 * Gather everything a rule needs for one ticket.
 *
 * `messages` is passed in rather than fetched, and that is not only an
 * optimisation — it is what decides how much this can know.
 *
 * The ledger always has the thread already, so it costs nothing there and every
 * rule can run. The digest does NOT, and reading it would be expensive in a way
 * that is easy to miss: `listByConversation` paginates CLIENT-side — the server
 * sends the whole conversation however small a `limit` you ask for — so forty
 * tickets means forty entire threads over the wire. So the digest goes without,
 * and the two rules that need a thread (`unanswered`, and the exact clock for
 * `gone-quiet`) either do not fire or fall back to the record's own timestamp
 * and say so. Guessing quietly would be worse than knowing less out loud.
 */
export async function factsFor(
  t: TicketRow,
  messages?: ThreadMessage[],
): Promise<TicketFacts | null> {
  if (!t.conversationId) return null;
  const [activities, board] = await Promise.all([
    listActivities(t.id).catch(() => [] as Activity[]),
    boardShape(t.boardId),
  ]);
  return {
    id: t.id,
    xyneId: t.xyneId ?? t.id.slice(0, 8),
    title: t.title ?? 'Untitled',
    conversationId: t.conversationId,
    channelId: t.channelId ?? '',
    statusV2: t.statusV2 ?? '',
    stageName: t.stageName ?? '',
    ...(t.priority ? { priority: t.priority } : {}),
    assignedTo: t.assignedTo ?? null,
    createdBy: t.createdBy ?? null,
    eta: t.eta ?? null,
    updatedAt: t.updatedAt ?? null,
    stages: board.stages,
    nonLinear: board.nonLinear,
    pr: newestPR(activities),
    ...readThread(messages ?? []),
  };
}

/**
 * Fill in the fields a ticket row does not carry.
 *
 * Usually nothing to do, and that is worth knowing: a `listKanban` row is the
 * WHOLE ticket — 41 columns including `createdBy`, `updatedAt`, `eta`, `boardId`,
 * `closedAt` and `statusUpdatedAt`, not the handful the SDK's `Ticket` type
 * suggests. So a digest built from kanban rows needs no per-ticket detail read at
 * all, and this returns immediately for them. It exists for the surfaces whose
 * rows come from somewhere thinner (a desk queue, a search result), where
 * `createdBy` decides who gets asked and guessing would name the wrong person.
 */
export async function enrich(t: TicketRow): Promise<TicketRow> {
  if (t.createdBy && t.eta !== undefined && t.updatedAt) return t;
  const d = await getDetails(t.id).catch(() => null);
  if (!d) return t;
  return {
    ...t,
    ...(d.createdBy ? { createdBy: d.createdBy } : {}),
    ...(d.eta !== undefined ? { eta: d.eta } : {}),
    ...(d.updatedAt ? { updatedAt: d.updatedAt } : {}),
    ...(d.boardId ? { boardId: d.boardId } : {}),
    ...(d.stageName ? { stageName: d.stageName } : {}),
    ...(d.statusV2 ? { statusV2: d.statusV2 } : {}),
    ...(d.assignedTo !== undefined ? { assignedTo: d.assignedTo } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Not asking twice                                                    */
/* ------------------------------------------------------------------ */

const COLLECTION = 'ticket-nudge';

export interface Dismissal {
  /** The finding's key — not just the rule, so a NEW merge asks again. */
  key: string;
  /** Epoch ms. Past this, it may be raised again. `0` means never. */
  until: number;
  by?: string;
}

export interface NudgeState {
  dismissed: Dismissal[];
}

export const NO_STATE: NudgeState = { dismissed: [] };

/**
 * Dismissals live at GLOBAL scope, and that is a deliberate difference from the
 * mail bridge's scan index, which is per-user.
 *
 * The test is whose fact it is. "This ticket does not need closing after all" is
 * a fact about the ticket: the next person to open it should not be asked a
 * question a colleague has already answered on everyone's behalf, and they
 * should be able to see who answered it. "These are the desks I can see" was a
 * fact about one person, and storing THAT globally leaked one inbox to the whole
 * workspace and suppressed everybody else's scan — a real bug in this app, fixed
 * in a625ff9. A dismissal record carries a ticket id, a rule name and a
 * timestamp; the ticket is already shared with everyone who can read it.
 */
export async function readNudgeState(ticketId: string): Promise<NudgeState> {
  if (!storageReady) return NO_STATE;
  try {
    const rec = await storage.collection<NudgeState>(COLLECTION).get(ticketId, { scope: 'global' });
    const rows = rec?.value?.dismissed;
    if (!Array.isArray(rows)) return NO_STATE;
    const now = Date.now();
    return {
      dismissed: rows.filter(
        d => d && typeof d.key === 'string' && (d.until === 0 || d.until > now),
      ),
    };
  } catch {
    return NO_STATE;
  }
}

export async function dismiss(
  ticketId: string,
  key: string,
  forMs: number,
  by?: string,
): Promise<void> {
  if (!storageReady) return;
  const state = await readNudgeState(ticketId);
  const next: NudgeState = {
    dismissed: [
      ...state.dismissed.filter(d => d.key !== key),
      { key, until: forMs === 0 ? 0 : Date.now() + forMs, ...(by ? { by } : {}) },
    ].slice(-40),
  };
  await storage.collection<NudgeState>(COLLECTION).put(ticketId, next, { scope: 'global' });
}

export const isDismissed = (state: NudgeState, n: Nudge): boolean =>
  state.dismissed.some(d => d.key === n.key);

/** Snooze lengths offered in the UI. */
export const SNOOZE_MS = 3 * DAY;

/* ------------------------------------------------------------------ */
/* The digest                                                          */
/* ------------------------------------------------------------------ */

/**
 * What a person owes across many tickets.
 *
 * The expensive part is per-ticket, so the shape of this is entirely about not
 * doing too much of it:
 *
 *   - CLOSED TICKETS ARE NEVER READ. Nothing is asked of finished work, so a
 *     ticket that is already done costs zero requests rather than three.
 *   - A HARD `limit`, and the result says how many it got through. A digest that
 *     silently examined twenty of your ninety tickets is telling you something
 *     untrue, so `examined` and `total` come back and the UI prints them.
 *   - NO THREAD READS. See `factsFor` — the digest trades `unanswered` and the
 *     exact staleness clock for not pulling forty whole conversations.
 *   - A SMALL CONCURRENCY WINDOW, so this does not open forty sockets from a
 *     browser tab that is also polling a thread every five seconds.
 */
export async function scan(
  tickets: TicketRow[],
  options: { limit?: number; concurrency?: number; now?: number; signal?: AbortSignal } = {},
): Promise<{ nudges: Nudge[]; examined: number; total: number }> {
  const { limit = 80, concurrency = 6, now = Date.now(), signal } = options;
  const open = tickets.filter(t => !CLOSED.includes((t.statusV2 ?? '') as StatusV2));
  // Oldest first, so a scan that hits the limit spends its budget where staleness
  // actually lives. The list arrives newest-first, and taking the head of that
  // would examine forty tickets from this week and miss the ones from July —
  // which are the entire point of the feature.
  const queue = [...open]
    .sort((a, b) => (a.updatedAt ?? a.eta ?? 0) - (b.updatedAt ?? b.eta ?? 0))
    .slice(0, limit);
  const found: Nudge[] = [];
  let examined = 0;

  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) return;
      const i = cursor++;
      const t = queue[i];
      if (!t) return;
      try {
        const facts = await factsFor(await enrich(t));
        examined++;
        if (!facts) continue;
        const n = detect(facts, now);
        if (!n) continue;
        const state = await readNudgeState(n.ticketId);
        if (!isDismissed(state, n)) found.push(n);
      } catch {
        // One unreadable ticket must not empty the digest.
        examined++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));

  found.sort(
    (a, b) => ORDER.indexOf(a.rule) - ORDER.indexOf(b.rule) || b.ageDays - a.ageDays,
  );
  return { nudges: found, examined, total: open.length };
}

/* ------------------------------------------------------------------ */
/* Handing it to the agent                                             */
/* ------------------------------------------------------------------ */

/**
 * Do what a suggestion says.
 *
 * One implementation, shared by the ticket's own thread and by the cross-ticket
 * queue, because the two must not drift: a queue that closed tickets by a
 * different route than the ledger would eventually close them differently.
 *
 * Returns the line to record, or null for the suggestions that write nothing —
 * `reply` hands the thread back to the person and `ask` hands it to the agent,
 * and neither is a change to the ticket.
 */
export async function applySuggestion(n: Nudge, s: Suggestion): Promise<string | null> {
  switch (s.kind) {
    case 'stage':
      if (!s.stageName) return null;
      await moveToStage(n.ticketId, s.stageName, n.nonLinear);
      return s.records;
    case 'status':
      if (!s.statusV2) return null;
      await updateTicket(n.ticketId, { statusV2: s.statusV2 });
      return s.records;
    case 'eta':
      if (!s.eta) return null;
      await updateTicket(n.ticketId, { eta: s.eta });
      return s.records;
    default:
      return null;
  }
}

/**
 * The task the Claw agent is given when somebody asks it to look into a nudge.
 *
 * The finding is stated as fact and the agent is asked to CHECK it, not to
 * rediscover it. That is the division of labour this whole file is built on:
 * deterministic code notices, the model investigates and writes. It also means
 * the agent cannot invent a different reason for interrupting somebody.
 */
export function investigatePrompt(n: Nudge, ownerName: string): { task: string; context: string } {
  return {
    task:
      `${n.xyneId} looks like it needs an update from ${ownerName}. ${n.because}\n\n` +
      'Read this ticket\'s conversation — it holds the record from every surface that touched ' +
      'this ticket, including mail and pull request events — and answer three things in under ' +
      'eighty words: is the work actually finished, is anything still blocking it, and what ' +
      `should happen to the ticket. If the record does not say, write that it does not say ` +
      'rather than guessing.',
    context: `The update agent raised this because: ${n.because}\nThe suggestion offered was: ${n.suggestions[0]?.label ?? 'none'}.`,
  };
}

/**
 * The line posted into the thread when the agent asks somebody for an update.
 *
 * Written as a request from the agent to a named person, because that is what it
 * is. The mention span is added by the caller (lib/mentions.ts) so the platform
 * routes and notifies it like any other mention — a nudge nobody is told about
 * is a nudge that only works if you were already looking.
 */
export function askText(n: Nudge): string {
  return `${n.ask}\n\n_${n.because}_`;
}
