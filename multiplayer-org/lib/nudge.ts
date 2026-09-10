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
 * did not support was dropped rather than kept "just in case". What fires today,
 * 33 findings over 76 open tickets:
 *
 *     shipped       11 tickets   a release carrying it went out; still open
 *     pr-merged     11 tickets   merged, nothing left in review, ticket never moved
 *     pr-open        1 ticket    raised 14+ days ago and never settled
 *     pr-declined    8 tickets   declined, and nothing on this ticket ever merged
 *     eta-passed     1 ticket    the ETA is in the past
 *     gone-quiet     1 ticket    Started, silent 14+ days, no code either way
 *     unanswered     0 tickets   somebody asked something and nobody answered
 *
 * `unanswered` is kept at zero yield on purpose: it is the case the feature was
 * asked for first ("it needs someone's input"), it costs nothing because the
 * ledger already holds the messages, and a rule that has not fired yet is not the
 * same as a rule that cannot. It is not advertised anywhere in the UI either —
 * only three messages in 514 carry a QUESTION act, and all three were answered.
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
import { parseUpdate } from './origin';
import { personOf } from './people';
import { actsOf, type MessageLike } from './origin';
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
  | 'shipped'
  | 'pr-merged'
  | 'pr-open'
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
  'shipped',
  'pr-merged',
  'pr-open',
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
export type OwnerReason = 'assignee' | 'merged-it' | 'creator' | 'last-speaker' | 'nobody';

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
  /** Every pull request this ticket has, reduced to what a rule needs. */
  prs: PRHistory;
  /**
   * When this ticket went out with a release, if it did.
   *
   * From a message the platform writes into the thread
   * (`metadata.messageSubtype === 'ticket_deployed_with_release'`), so it needs
   * the thread — see `factsFor`. It is the strongest evidence there is that a
   * ticket is finished, and eleven open tickets here carry one.
   */
  deployedAt?: number | null;
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

/**
 * Where a card should go once its pull request has landed.
 *
 * Usually the next stage. But a card can sit several columns behind its code:
 * XYNE-12510's PR merged five months ago while the card is still at PR Review,
 * and on that board the next stage is QA Testing — so "the PR merged, is this
 * QA Testing now?" asks somebody to move a card forward into a step the code
 * has already been through.
 *
 * So if the board has a column literally called Merged and the card is before
 * it, that is the target. Matching a stage name by hand is the thing this file
 * otherwise refuses to do — but the risk runs the right way here: it is the
 * TARGET, not the trigger, an exact case-folded match, and a board that spells
 * it anything else simply falls back to the next stage rather than losing the
 * finding.
 */
function stageAfterMerge(f: TicketFacts): string | null {
  const here = f.stages.findIndex(x => x.toLowerCase() === f.stageName.toLowerCase());
  const merged = f.stages.findIndex(x => x.toLowerCase() === 'merged');
  if (here !== -1 && merged !== -1 && here < merged) return f.stages[merged];
  return nextStage(f);
}

/** The move to the next sensible stage, when this ticket's board has one. */
const stageStep = (f: TicketFacts, why: string): Suggestion[] => {
  const next = stageAfterMerge(f);
  if (!next) return [];
  return [
    {
      kind: 'stage',
      label: `Move to ${next}`,
      stageName: next,
      records: `Moved to ${next} — ${why}.`,
    },
  ];
};

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

/**
 * Who owes the update, and how we decided.
 *
 * Four fallbacks, because no single field is populated often enough to stand
 * alone: only 21 of 81 tickets here have an assignee, and an assignee-only rule
 * would have nobody to ask about three quarters of the work.
 *
 * NEVER A BOT. The person who merged a pull request is usually the right one to
 * ask whether it can be closed — but on four of the merges here that person is
 * "Bitbucket Bot", and an update agent asking a robot for an update is the sort
 * of thing that gets the whole feature deleted. Bots are skipped at every step,
 * not just this one.
 *
 * NEVER `value.authorName` either. It is a display string, and the same human
 * appears in it as "Pradeesh S", "Pradeesh333" and "xyne.spaces@juspay.in".
 * `activity.updatedBy` is a real user id.
 */
export function ownerOf(f: TicketFacts): { id: string | null; reason: OwnerReason } {
  const human = (id: string | null | undefined): string | null =>
    id && !personOf(id).isBot ? id : null;

  const assignee = human(f.assignedTo);
  if (assignee) return { id: assignee, reason: 'assignee' };

  // Whoever settled the code. Closest to knowing whether it is actually done.
  const actor = human(f.prs.merged?.by) ?? human(f.prs.declined?.by) ?? human(f.prs.open[0]?.by);
  if (actor) return { id: actor, reason: 'merged-it' };

  const creator = human(f.createdBy);
  if (creator) return { id: creator, reason: 'creator' };

  const spoke = human(f.lastHuman?.senderId);
  if (spoke) return { id: spoke, reason: 'last-speaker' };

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
   * It went out with a release.
   *
   * The strongest evidence a ticket is finished, and it is not ours: the
   * platform writes a `ticket_deployed_with_release` message into the thread
   * when a release carrying this ticket ships. Eleven open tickets here have
   * one, the oldest 96 days ago.
   *
   * Because of it, closing is the PRIMARY suggestion rather than the second
   * one — everywhere else this file refuses to assume that merged means done,
   * and here the platform has said it does.
   */
  shipped: (f, now) => {
    const at = f.deployedAt;
    if (!at) return null;
    const age = days(at, now);
    if (age < PR_GRACE_DAYS) return null;
    return {
      stamp: at,
      nudge: {
        ask: `This went out with a release ${sinceWords(now - at)} and is still open. Close it?`,
        because: `A release carrying this ticket shipped ${sinceWords(now - at)}; it is still ${humanStatus(f.statusV2)} at ${f.stageName}.`,
        suggestions: [
          closeSuggestion(f, `it shipped with a release ${sinceWords(now - at)}.`),
          ...stageStep(f, `it shipped ${sinceWords(now - at)}`),
          updateSuggestion(),
        ],
        ageDays: age,
      },
    };
  },

  /**
   * The PR landed and the ticket never moved. The case this feature exists for.
   *
   * Guarded by `open.length === 0`: a ticket can have one pull request merged
   * and another still in review, and asking whether to close that is asking
   * somebody to close work they are in the middle of.
   */
  'pr-merged': (f, now) => {
    const m = f.prs.merged;
    if (!m || f.prs.open.length > 0) return null;
    const age = days(m.at, now);
    if (age < PR_GRACE_DAYS) return null;
    const next = stageAfterMerge(f);
    const pr = m.number ? `PR #${m.number}` : 'The pull request';
    return {
      stamp: m.at,
      nudge: {
        ask: next
          ? `${pr} merged ${sinceWords(now - m.at)}. Is this ${next} now, or done?`
          : `${pr} merged ${sinceWords(now - m.at)} and this is still open. Close it?`,
        because: `${pr}${m.repo ? ` in ${m.repo}` : ''} merged ${sinceWords(now - m.at)}; the ticket is still ${humanStatus(f.statusV2)} at ${f.stageName}.`,
        suggestions: [
          ...stageStep(f, `${pr} merged ${sinceWords(now - m.at)}`),
          closeSuggestion(f, `${pr} merged ${sinceWords(now - m.at)}.`),
          updateSuggestion(),
        ],
        ageDays: age,
      },
    };
  },

  /**
   * A pull request has been open a long time and nothing has settled it.
   *
   * The only rule here about work that is still live rather than finished, so it
   * offers NO status change at all — the answer is a person saying where the
   * review has got to, not a ticket field.
   */
  'pr-open': (f, now) => {
    const oldest = f.prs.open[0];
    if (!oldest) return null;
    const age = days(oldest.at, now);
    if (age < QUIET_DAYS) return null;
    const pr = oldest.number ? `PR #${oldest.number}` : 'A pull request';
    return {
      stamp: oldest.at,
      nudge: {
        ask: `${pr} has been open since ${sinceWords(now - oldest.at)}. Where has the review got to?`,
        because: `${pr}${oldest.repo ? ` in ${oldest.repo}` : ''} was raised ${sinceWords(now - oldest.at)} and has not been merged or declined.`,
        suggestions: [updateSuggestion(), askSuggestion()],
        ageDays: age,
      },
    };
  },

  /**
   * The PR was turned down and nothing replaced it.
   *
   * Requires that NO pull request on this ticket ever merged. Eight tickets here
   * merged one attempt and declined a later one months afterwards; treating
   * those as abandoned would ask whether shipped code is still happening.
   *
   * Deliberately does NOT suggest cancelling first. A declined PR often means a
   * second attempt is coming, and a robot proposing you cancel your own work as
   * its opening move is the kind of thing that gets a feature switched off. It
   * asks; the destructive option is second and marked as such.
   */
  'pr-declined': (f, now) => {
    const d = f.prs.declined;
    if (!d || f.prs.merged || f.prs.open.length > 0) return null;
    const age = days(d.at, now);
    if (age < PR_GRACE_DAYS) return null;
    const pr = d.number ? `PR #${d.number}` : 'The pull request';
    return {
      stamp: d.at,
      nudge: {
        ask: `${pr} was declined ${sinceWords(now - d.at)} and nothing replaced it. Is this still happening?`,
        because: `${pr}${d.repo ? ` in ${d.repo}` : ''} was declined ${sinceWords(now - d.at)}, no pull request on this ticket ever merged, and it is still ${humanStatus(f.statusV2)}.`,
        suggestions: [
          updateSuggestion(),
          {
            kind: 'status',
            label: 'Drop it',
            statusV2: 'CANCELLED',
            destructive: true,
            records: `Cancelled — ${pr} was declined ${sinceWords(now - d.at)} and nothing replaced it.`,
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

/** One pull-request event, as the activity log records it. */
export interface PREvent {
  action: string;
  at: number;
  number?: number;
  url?: string;
  repo?: string;
  /** The Xyne user who did it — a real id, unlike `value.authorName`. */
  by?: string;
}

/**
 * Every pull request on a ticket, reduced to the three things a rule needs.
 *
 * THIS REPLACED A REAL BUG, and it is worth saying what it was. The first
 * version read only the NEWEST PR activity and keyed off its action. That is
 * wrong twice over on live data:
 *
 *   - `updated` is 80 of the 235 PR activities here and is a STAGE MOVE, not a
 *     code event. It sits on top of the merge and hides it — which is why the
 *     first version found 15 merged-and-open tickets where there are 23.
 *   - Eight tickets have a merge FOLLOWED by a decline, months apart, because a
 *     second attempt was opened and dropped after the first one shipped. Newest
 *     -event logic asks "the PR was declined — is this still happening?" about
 *     a ticket whose code went out in June. Confidently wrong is worse than
 *     quiet.
 *
 * So: scan them all, keep the newest of each kind, and track which pull requests
 * are still open by set-difference — `raised` minus everything terminal. That
 * last one reproduces the server's own `remainingOpenPRs` counter exactly (both
 * agree on the four tickets that have live code review), and it is what stops
 * "close this?" being asked about work somebody is still reviewing.
 */
export interface PRHistory {
  /** Newest merge, if this ticket ever had one. */
  merged: PREvent | null;
  /** Newest decline. */
  declined: PREvent | null;
  /** Newest event of any kind, for evidence. */
  newest: PREvent | null;
  /** Pull requests raised and never merged, declined or deleted. */
  open: PREvent[];
}

export const NO_PRS: PRHistory = { merged: null, declined: null, newest: null, open: [] };

/** Terminal verdicts. Anything else leaves a pull request open. */
const SETTLED = new Set(['merged', 'declined', 'deleted']);

export function prHistory(activities: Activity[]): PRHistory {
  const events: PREvent[] = [];
  for (const a of activities) {
    if ((a.activityType ?? '').toUpperCase() !== 'PR') continue;
    if (!a.value || typeof a.value !== 'object') continue;
    const v = a.value as Record<string, unknown>;
    const num = Number(v.prId);
    events.push({
      // Lowercase deliberately. `value.action` is already lowercase in every one
      // of the 235 live rows (raised · updated · merged · declined · deleted),
      // but the SAME event arrives UPPERCASE on a message as `metadata.prEvent`
      // with a different verb for opening (CREATED, not raised). Two vocabularies
      // for one fact; this module speaks the activity one, and folds case so a
      // deployment that differs cannot silently match nothing.
      action: String(v.action ?? '').toLowerCase(),
      at: a.timestamp ?? 0,
      ...(Number.isFinite(num) ? { number: num } : {}),
      ...(typeof v.prUrl === 'string' ? { url: v.prUrl } : {}),
      ...(typeof v.repoName === 'string' ? { repo: v.repoName } : {}),
      ...(a.updatedBy ? { by: a.updatedBy } : {}),
    });
  }
  events.sort((a, b) => b.at - a.at);

  const newestWhere = (test: (e: PREvent) => boolean): PREvent | null =>
    events.find(test) ?? null;

  const settled = new Set(
    events.filter(e => SETTLED.has(e.action)).map(e => String(e.number)),
  );
  const openById = new Map<string, PREvent>();
  for (const e of events) {
    if (e.action !== 'raised') continue;
    const id = String(e.number);
    if (settled.has(id) || openById.has(id)) continue;
    openById.set(id, e);
  }

  return {
    merged: newestWhere(e => e.action === 'merged'),
    declined: newestWhere(e => e.action === 'declined'),
    newest: events[0] ?? null,
    open: [...openById.values()].sort((a, b) => a.at - b.at),
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
export function readThread(
  messages: ThreadMessage[],
): Pick<TicketFacts, 'lastMessageAt' | 'lastHuman' | 'openQuestion' | 'deployedAt'> {
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

  // The platform's own "this shipped" stamp. Newest wins: a ticket can go out
  // in more than one release, and the question is whether it has gone out at
  // all, not when it first did.
  let deployedAt: number | null = null;
  for (const m of sorted) {
    const md = m.metadata && typeof m.metadata === 'object' ? (m.metadata as Record<string, unknown>) : {};
    if (md.messageSubtype === 'ticket_deployed_with_release') deployedAt = m.createdAt;
  }

  return {
    lastMessageAt: last?.createdAt ?? null,
    lastHuman: lastHumanMsg ? { at: lastHumanMsg.createdAt, senderId: lastHumanMsg.senderId } : null,
    openQuestion,
    deployedAt,
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
    prs: prHistory(activities),
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
  options: { limit?: number; concurrency?: number; deepen?: number; now?: number; signal?: AbortSignal } = {},
): Promise<{ nudges: Nudge[]; examined: number; total: number; deepened: number }> {
  const { limit = 150, concurrency = 6, deepen = 60, now = Date.now(), signal } = options;
  const open = tickets.filter(t => !CLOSED.includes((t.statusV2 ?? '') as StatusV2));
  // Oldest first, so a scan that hits the limit spends its budget where staleness
  // actually lives. The list arrives newest-first, and taking the head of that
  // would examine forty tickets from this week and miss the ones from July —
  // which are the entire point of the feature.
  const queue = [...open]
    .sort((a, b) => (a.updatedAt ?? a.eta ?? 0) - (b.updatedAt ?? b.eta ?? 0))
    .slice(0, limit);

  const work = async <T,>(items: T[], each: (item: T) => Promise<void>): Promise<void> => {
    let cursor = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        if (signal?.aborted) return;
        const item = items[cursor++];
        if (item === undefined) return;
        await each(item).catch(() => {});
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  };

  // PASS ONE — cheap. One activity read per ticket, no threads.
  const facts = new Map<string, TicketFacts>();
  let examined = 0;
  await work(queue, async t => {
    const f = await factsFor(await enrich(t));
    examined++;
    if (f) facts.set(t.id, f);
  });

  // PASS TWO — the thread, but only where it can change the answer.
  //
  // `deployedAt` is the strongest signal there is and it lives in the thread, so
  // skipping threads entirely would throw it away. Reading all of them instead
  // would pull eighty whole conversations (listByConversation pages CLIENT-side,
  // so `limit` saves nothing). The middle is to read only the tickets whose code
  // has actually landed — twenty-three here, a couple of seconds — because those
  // are the only ones a release note could change the answer for.
  const candidates = [...facts.values()]
    .filter(f => f.prs.merged !== null)
    .sort((a, b) => (a.prs.merged?.at ?? 0) - (b.prs.merged?.at ?? 0))
    .slice(0, deepen);
  let deepened = 0;
  await work(candidates, async f => {
    const messages = await threadOf(f.conversationId);
    if (!messages.length) return;
    deepened++;
    facts.set(f.id, { ...f, ...readThread(messages) });
  });

  const found: Nudge[] = [];
  for (const f of facts.values()) {
    if (signal?.aborted) break;
    const n = detect(f, now);
    if (!n) continue;
    const state = await readNudgeState(n.ticketId);
    if (!isDismissed(state, n)) found.push(n);
  }

  found.sort((a, b) => ORDER.indexOf(a.rule) - ORDER.indexOf(b.rule) || b.ageDays - a.ageDays);
  return { nudges: found, examined, total: open.length, deepened };
}

async function threadOf(conversationId?: string): Promise<ThreadMessage[]> {
  if (!conversationId) return [];
  try {
    const { spaces } = await xyne();
    const page = await spaces.messages.listByConversation(conversationId, { limit: 100 });
    return (page as unknown as { items?: ThreadMessage[] }).items ?? [];
  } catch {
    return [];
  }
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
 * The idempotency key for an ask, carried in the message's own marker.
 *
 * Storage would be the obvious place to remember "we already asked about this",
 * and it is the wrong one: a second device, a second viewer, or a cleared
 * bucket all forget. The ticket does not. `tagUpdate` writes the ref into the
 * message body as an HTML comment, `parseUpdate` reads it back, and the round
 * trip is byte-for-byte — so the thread itself is the record of what has been
 * asked, which is exactly where a reader would look for it anyway.
 */
export const askRef = (key: string): string => `nudge:${key.replace(/[^a-z0-9:._-]/gi, '')}`;

/**
 * Has this exact finding already been put to somebody in this thread?
 *
 * Keyed on the finding, not the rule — so a NEW merge on the same ticket asks
 * again, while the same one does not.
 */
export function alreadyAsked(messages: Array<{ content?: string }>, key: string): boolean {
  const ref = askRef(key).toLowerCase();
  return messages.some(m => parseUpdate(m.content ?? '').ref === ref);
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
