import { spaces, xyne } from './xyne';
// `import type`, not `import { type … }`. Both are erased by tsc, but the
// published app is compiled by claw's own transformer, and this is the only
// place any file names an npm package that is not installed in the sandbox —
// the CLI's scaffold says it plainly: "App code imports the bundles by relative
// path, never these packages by name." A statement marked `import type` is
// removed unconditionally by every transformer; one that merely marks each
// specifier relies on the transformer noticing none are used as values.
//
// Aliased because the SDK's `Stage`/`Ticket` are the full 30-field server rows,
// while the narrower shapes this file declares under the same names are what
// every surface actually passes around. Both are needed here now that the
// kanban reader lives alongside them, so the SDK's keep their origin in the name.
import type {
  Board,
  ChannelBoardMapping,
  Stage as SdkStage,
  StageTransition,
  Ticket as SdkTicket,
} from '@xyne/spaces-sdk';

/* ---- from lib/tickets.ts ---------------------------------------------- */
/**
 * Ticket operations — the whole write surface the SDK allows.
 *
 * The one rule worth knowing: moving a card between stages has TWO paths.
 * `update({ stageName })` sets the stage and skips the board's rules;
 * `transitionStage()` runs them, which may demand an approval or a form. A board
 * with rows in `boards.listTransitions` is non-linear and must use the latter,
 * or a drag silently bypasses approvals the team relies on.
 */

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type StatusV2 = 'TODO' | 'STARTED' | 'PAUSED' | 'CANCELLED' | 'COMPLETED';
export type RelationType = 'LINKED' | 'DUPLICATE_CONFIRMED' | 'DUPLICATE_POSSIBLE' | 'MERGED_INTO';

export const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const STATUSES: StatusV2[] = ['TODO', 'STARTED', 'PAUSED', 'CANCELLED', 'COMPLETED'];

export type Ticket = {
  id: string;
  xyneId?: string;
  title?: string;
  description?: string;
  priority?: Priority;
  statusV2?: StatusV2;
  stageName?: string;
  /** Nullable on the wire, not merely absent — an unassigned ticket sends
   *  `null`. Typed to match so SDK rows flow in without a mapping step. */
  assignedTo?: string | null;
  createdBy?: string;
  projectId?: string;
  boardId?: string;
  conversationId?: string;
  channelId?: string;
  eta?: number | null;
  createdAt?: number;
  isArchived?: boolean;
  isStageOverdue?: boolean;
};

export type Stage = { id?: string; name?: string; stageName?: string; sequenceNumber?: number };

/** getDetails returns the whole record in one call — relations included. */
export type TicketDetails = Ticket & {
  ticketType?: string;
  userGroupId?: string;
  updatedAt?: number;
  updatedBy?: string;
  project?: { id?: string; name?: string; code?: string };
  conversation?: { conversationId?: string; channelId?: string };
  tagMappings?: Array<{ id?: string; tagId?: string; tagName?: string }>;
  referencesIn?: Array<{ id?: string; sourceTicketId?: string; relationType?: string }>;
  referencesOut?: Array<{ id?: string; targetTicketId?: string; relationType?: string }>;
  rcas?: unknown[];
};
/**
 * Verified against the live shape: `updatedBy`/`timestamp`, NOT createdBy/
 * createdAt — and `value` is a JSON OBJECT, not a string. Rendering it directly
 * throws "Objects are not valid as a React child". Its keys vary by type:
 *   PRIORITY       { oldValue, newValue }
 *   STATUS         { field, source, oldValue, newValue }
 *   PR             { prId, prUrl, action, repoName, sourceBranch, destinationBranch, authorName }
 *   TICKET_CREATED { field, priority, statusV2, stageName }
 */
export type ActivityValue = Record<string, unknown>;
export type Activity = {
  id: string;
  ticketId?: string;
  activityType?: string;
  value?: ActivityValue | string;
  updatedBy?: string;
  timestamp?: number;
  channelId?: string;
};

/** A readable line for one activity, plus a link when the event has one. */
export function describeActivity(a: Activity): { text: string; href?: string } {
  const v = a.value;
  const type = (a.activityType ?? 'CHANGED').toUpperCase();
  if (!v) return { text: type.replace(/_/g, ' ').toLowerCase() };
  if (typeof v === 'string') return { text: `${type.replace(/_/g, ' ').toLowerCase()} — ${v}` };

  const str = (k: string): string | undefined => (typeof v[k] === 'string' ? (v[k] as string) : undefined);
  const oldValue = str('oldValue');
  const newValue = str('newValue');

  if (type === 'PR') {
    const id = v['prId'];
    const action = str('action') ?? 'updated';
    const branches = [str('sourceBranch'), str('destinationBranch')].filter(Boolean).join(' → ');
    const repo = str('repoName');
    return {
      text: `PR #${id ?? '?'} ${action}${repo ? ` in ${repo}` : ''}${branches ? ` · ${branches}` : ''}`,
      ...(str('prUrl') ? { href: str('prUrl') as string } : {}),
    };
  }

  if (type === 'TICKET_CREATED') {
    const parts = [str('priority'), str('statusV2'), str('stageName')].filter(Boolean);
    return { text: `created${parts.length ? ` · ${parts.join(' · ')}` : ''}` };
  }

  const field = str('field') ?? type.toLowerCase();
  if (oldValue || newValue) {
    const source = str('source');
    return {
      text: `${field} ${oldValue ?? '—'} → ${newValue ?? '—'}${source ? ` (${source.toLowerCase()})` : ''}`,
    };
  }

  // Unknown variant: show the fields rather than crashing or hiding the event.
  const pairs = Object.entries(v)
    .filter(([k, val]) => k !== 'field' && (typeof val === 'string' || typeof val === 'number'))
    .slice(0, 3)
    .map(([k, val]) => `${k} ${val}`);
  return { text: `${type.replace(/_/g, ' ').toLowerCase()}${pairs.length ? ` · ${pairs.join(', ')}` : ''}` };
}
export type Tag = { id: string; name?: string; tagName?: string; tagId?: string; mappingId?: string };

export const stageName = (s: Stage): string => s.name ?? s.stageName ?? '';

/** Stages, tickets and whether this board enforces transition rules. */
export async function loadBoard(boardId: string): Promise<{
  stages: Stage[];
  tickets: Ticket[];
  nonLinear: boolean;
}> {
  const { spaces } = await xyne();
  const [stages, tickets, transitions] = await Promise.all([
    spaces.boards.listStages(boardId) as unknown as Promise<Stage[]>,
    spaces.tickets.listKanban({ viewMode: 'board', boardId, limit: 100 }) as unknown as Promise<Ticket[]>,
    (spaces.boards.listTransitions(boardId) as unknown as Promise<unknown[]>).catch(() => []),
  ]);
  return {
    stages: [...stages].sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0)),
    tickets,
    nonLinear: (transitions ?? []).length > 0,
  };
}

export async function myTickets(): Promise<Ticket[]> {
  const { spaces } = await xyne();
  return (await spaces.tickets.listKanban({ viewMode: 'my-tickets', limit: 100 })) as unknown as Ticket[];
}

/**
 * Move a card to another stage.
 *
 * Non-linear boards go through the rules engine; a rejection there is a real
 * answer (approval required, form incomplete) and must reach the user rather
 * than being retried silently through the permissive path.
 */
export async function moveToStage(ticketId: string, toStage: string, nonLinear: boolean): Promise<void> {
  const { spaces } = await xyne();
  if (nonLinear) await spaces.tickets.transitionStage(ticketId, toStage);
  else await spaces.tickets.update(ticketId, { stageName: toStage });
}

export async function updateTicket(
  id: string,
  data: {
    title?: string;
    description?: string;
    statusV2?: StatusV2;
    priority?: Priority;
    stageName?: string;
    assignedTo?: string;
    eta?: number;
    isArchived?: boolean;
  },
): Promise<void> {
  const { spaces } = await xyne();
  await spaces.tickets.update(id, data);
}

export async function assignTicket(ticketId: string, userId: string): Promise<void> {
  const { spaces } = await xyne();
  await spaces.tickets.assign(ticketId, userId);
}

export async function archiveTicket(id: string): Promise<void> {
  const { spaces } = await xyne();
  await spaces.tickets.archive(id);
}

/**
 * Create a ticket.
 *
 * The SDK types channelId as optional, but the server rejects a create with
 * neither channelId nor sourceConversationId (ticketController.ts:605) — and it
 * tests `description` for TRUTHINESS, so an empty string fails the same way a
 * missing one does. Both are required in practice.
 */
export async function createTicket(data: {
  title: string;
  description: string;
  projectId: string;
  /** Required in practice — the ticket's thread is created here. */
  channelId: string;
  boardId?: string;
  stageName?: string;
  priority?: Priority;
  assignedTo?: string;
}): Promise<CreatedTicket> {
  const { spaces } = await xyne();
  return (await spaces.tickets.create(data)) as unknown as CreatedTicket;
}

/**
 * What create hands back.
 *
 * `conversationId` is the useful part and it is not obvious that it is there:
 * the server opens the ticket's thread as part of creation, so the new ticket
 * can be posted into and focused immediately, with no follow-up read.
 */
export type CreatedTicket = {
  id: string;
  xyneId: string;
  conversationId: string;
  title?: string;
  stageName?: string;
  priority?: Priority;
  projectId?: string;
  boardId?: string;
  channelId?: string;
};

export async function getDetails(ticketId: string): Promise<TicketDetails | null> {
  const { spaces } = await xyne();
  return (await spaces.tickets.getDetails(ticketId)) as unknown as TicketDetails | null;
}

/** Resolve the ids referenced by a ticket's relations into titles. */
export async function getMany(ticketIds: string[]): Promise<Ticket[]> {
  if (!ticketIds.length) return [];
  const { spaces } = await xyne();
  return (await spaces.tickets.getMany(ticketIds)) as unknown as Ticket[];
}

export async function listActivities(ticketId: string): Promise<Activity[]> {
  const { spaces } = await xyne();
  const page = await spaces.tickets.listActivities(ticketId, { limit: 50 });
  const items = (page as unknown as { items?: Activity[] }).items ?? [];
  return [...items].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
}

export async function listProjectTags(projectId: string): Promise<Tag[]> {
  const { spaces } = await xyne();
  return (await spaces.tickets.listProjectTags(projectId)) as unknown as Tag[];
}

export async function addTag(ticketId: string, projectId: string, tagName: string): Promise<void> {
  const { spaces } = await xyne();
  await spaces.tickets.addTag(ticketId, projectId, tagName);
}

/** removeTag needs BOTH the tag id and the mapping row id — not just the tag. */
export async function removeTag(tagId: string, mappingId: string): Promise<void> {
  const { spaces } = await xyne();
  await spaces.tickets.removeTag(tagId, mappingId);
}

export type SubTicket = { subTicketId?: string; id?: string; title?: string; assignedTo?: string };

export async function listSubTickets(ticketId: string): Promise<SubTicket[]> {
  const { spaces } = await xyne();
  return (await spaces.tickets.listSubTickets(ticketId)) as unknown as SubTicket[];
}

export async function createSubTicket(ticketId: string, title: string): Promise<void> {
  const { spaces } = await xyne();
  await spaces.tickets.createSubTicket({ ticketId, title });
}

export async function addReference(
  sourceTicketId: string,
  targetTicketId: string,
  relationType: RelationType,
): Promise<void> {
  const { spaces } = await xyne();
  await spaces.tickets.addReference(sourceTicketId, targetTicketId, relationType);
}

export async function searchTickets(search: string): Promise<Ticket[]> {
  const { spaces } = await xyne();
  return (await spaces.tickets.search({ search, limit: 20 })) as unknown as Ticket[];
}

/* ---- from lib/kanban.ts ----------------------------------------------- */
/**
 * The Kanban read/move contract, verified against @xyne/spaces-sdk@0.1.0.
 *
 * The sequence that is not guessable from the method names:
 *
 *   channelId ─listByChannel→ ChannelBoardMapping[]   (mappings, NOT boards)
 *             ─pick isDefault→ boardId
 *             ─listStages→     SdkStage[]                (the columns)
 *             ─listKanban→     SdkTicket[]               (flat array, NOT a Page)
 *
 * And the rule that matters most: `transitionStage` resolves `void`. A resolved
 * promise means the mutate was accepted, NOT that the ticket moved — a board can
 * route the move into an approval instead. So every move is confirmed by
 * re-reading the ticket, and only then reported into the chat.
 */

export type { Board, SdkStage as BoardStage, StageTransition, ChannelBoardMapping };

export interface BoardView {
  board: Board | null;
  boardId: string;
  /** Ordered columns. */
  stages: SdkStage[];
  transitions: StageTransition[];
  /** Tickets per stage name. */
  columns: Map<string, SdkTicket[]>;
  /** Every board this channel maps to — often far more than one. */
  mappings: ChannelBoardMapping[];
}

/**
 * `boards.get` declares `Board | null` but its registry entry has no
 * `firstOrNull` mapper, unlike the ticket ops that do — so it can hand back a
 * one-element ARRAY typed as an object, where every field reads `undefined`.
 * Normalising here is cheaper than debugging a board with no name.
 */
function firstOrNull(raw: unknown): Board | null {
  if (Array.isArray(raw)) return (raw[0] as Board | undefined) ?? null;
  return (raw as Board | null) ?? null;
}

/** Resolve the track's board and load every column. */
export async function loadBoardView(
  channelId: string,
  /**
   * Which board to open. Omit for the channel's default.
   *
   * Not a nicety. `vespa-search` maps to TWENTY-EIGHT boards: the default is a
   * general work board, while the tickets carrying pull requests live on a
   * separate SDLC board (TODO -> IN_REVIEW -> MERGED -> LIVE). Showing only the
   * default meant a ticket could be on the open track, be linked to a PR, and
   * still be invisible here — exactly the failure this surface exists to stop.
   */
  boardIdOverride?: string,
): Promise<BoardView | null> {
  // Mapping rows, not boards. A channel may map to several; ordering is by when
  // the mapping was made, so isDefault is NOT reliably index 0.
  const mappings: ChannelBoardMapping[] = await spaces.boards.listByChannel(channelId);
  const mapping =
    (boardIdOverride ? mappings.find((m) => m.boardId === boardIdOverride) : undefined) ??
    mappings.find((m) => m.isDefault) ??
    mappings[0];
  if (!mapping) return null;

  const boardId = mapping.boardId;
  const [stagesRaw, transitions, boardRaw] = await Promise.all([
    spaces.boards.listStages(boardId),
    spaces.boards.listTransitions(boardId).catch(() => [] as StageTransition[]),
    spaces.boards.get(boardId).catch(() => null as unknown),
  ]);

  // Documented as "in sequence order", but sorting costs nothing and the
  // sibling listStagesForBoards makes no such promise.
  const stages = [...stagesRaw].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  // One call per column. listKanban has NO declared default limit and no clamp
  // — it is a bare pass-through, so an explicit limit is mandatory.
  const perStage = await Promise.all(
    stages.map((s) =>
      spaces.tickets
        .listKanban({
          viewMode: 'board',
          boardId,
          stageName: s.name,
          limit: 100,
          filters: { sourceChannels: [channelId] },
        })
        .catch(() => [] as SdkTicket[]),
    ),
  );

  const columns = new Map<string, SdkTicket[]>();
  stages.forEach((s, i) => {
    columns.set(
      s.name,
      (perStage[i] ?? []).filter((t) => !t.isArchived),
    );
  });

  return { board: firstOrNull(boardRaw), boardId, stages, transitions, columns, mappings };
}

/**
 * Every board this track is mapped to, named.
 *
 * `listByChannel` returns mapping rows carrying only ids, so names need a
 * second read. `allSettled` because a mapping can point at a deleted board and
 * one 404 must not blank the picker.
 */
export async function loadBoardChoices(
  channelId: string,
): Promise<Array<{ boardId: string; name: string; isDefault: boolean }>> {
  const mappings: ChannelBoardMapping[] = await spaces.boards.listByChannel(channelId);
  const named = await Promise.allSettled(
    mappings.map(async (m) => {
      const b = firstOrNull(await spaces.boards.get(m.boardId));
      return { boardId: m.boardId, name: b?.name || m.boardId.slice(0, 8), isDefault: m.isDefault };
    }),
  );
  return named
    .flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

/** Stages this ticket may legally move to, per the board's transition set. */
export function allowedTargets(
  from: SdkStage | undefined,
  stages: SdkStage[],
  transitions: StageTransition[],
): SdkStage[] {
  if (!from) return stages;
  // With no transitions configured the board is unrestricted; the server is the
  // real authority either way, so an empty set must not mean "nothing allowed".
  if (transitions.length === 0) return stages.filter((s) => s.id !== from.id);
  const targetIds = new Set(
    transitions.filter((t) => t.fromStageId === from.id).map((t) => t.toStageId),
  );
  const allowed = stages.filter((s) => targetIds.has(s.id));
  return allowed.length > 0 ? allowed : stages.filter((s) => s.id !== from.id);
}

export interface MoveOutcome {
  /** True when the ticket's own row now reads the target stage. */
  applied: boolean;
  /** Set when the board routed the move into an approval instead. */
  queued: boolean;
}

/**
 * Move a ticket, then find out what actually happened.
 *
 * `transitionStage` resolves `void` — no result object, no status. Advancing the
 * card on resolve is wrong on every approval-gated board, so this re-reads the
 * ticket and, if it did not move, looks for an outstanding stage request.
 *
 * Note `StageRequestStatus` has no `'PENDING'` member — the outstanding states
 * are `'SUBMITTED'` and `'DRAFT'`. And `listOpenStageRequests` is keyed by stage
 * and never defines "open", so `listStageRequests(ticketId)` is the safe read.
 */
export async function moveTicket(
  // Only the id is used. Typed narrowly so an app holding a partial row — a
  // kanban card, a desk row — can move a ticket without re-reading all 30
  // fields of it first.
  ticket: { id: string },
  // The id is optional because not every caller has the stage ROW: a detail
  // pane offers stage names in a select. Without it the queued check widens
  // from "a request for this stage" to "a request at all", which is the honest
  // reading — the move did not apply and something is outstanding.
  toStage: { id?: string; name: string },
): Promise<MoveOutcome> {
  await spaces.tickets.transitionStage(ticket.id, toStage.name);

  const after = await spaces.tickets.getRow(ticket.id).catch(() => null);
  if (after?.stageName === toStage.name) return { applied: true, queued: false };

  const requests = await spaces.tickets.listStageRequests(ticket.id).catch(() => []);
  const outstanding = requests.filter((r) => r.status === 'SUBMITTED' || r.status === 'DRAFT');
  const queued = toStage.id
    ? outstanding.some((r) => r.stageId === toStage.id)
    : outstanding.length > 0;
  return { applied: false, queued };
}

/**
 * Turn a failed move into something worth showing a person.
 *
 * A 400 carries the board rule that refused the move, verbatim from the server,
 * and that text is the single most useful thing to display. Timeouts and network
 * errors are ambiguous — the write may have committed — so they must never read
 * as "failed".
 */
export function describeMoveError(err: unknown): string {
  const e = err as { name?: string; code?: string; message?: string; requestId?: string };
  switch (e?.name) {
    case 'AuthError':
      return 'Your session has expired. Fetch a fresh token and reload.';
    case 'NotFoundError':
      return 'That ticket no longer exists. Refresh the board.';
    default:
      break;
  }
  switch (e?.code) {
    case 'validation_error':
    case 'forbidden':
      return e.message || 'The board refused that move.';
    case 'timeout':
    case 'network_error':
      return 'Could not confirm the move — refresh the board to see whether it landed.';
    default:
      return e?.requestId
        ? `Something went wrong (ref ${e.requestId}).`
        : e?.message || 'Could not move the ticket.';
  }
}
