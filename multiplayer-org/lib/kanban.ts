/**
 * The Kanban read/move contract, verified against @xyne/spaces-sdk@0.1.0.
 *
 * The sequence that is not guessable from the method names:
 *
 *   channelId ─listByChannel→ ChannelBoardMapping[]   (mappings, NOT boards)
 *             ─pick isDefault→ boardId
 *             ─listStages→     Stage[]                (the columns)
 *             ─listKanban→     Ticket[]               (flat array, NOT a Page)
 *
 * And the rule that matters most: `transitionStage` resolves `void`. A resolved
 * promise means the mutate was accepted, NOT that the ticket moved — a board can
 * route the move into an approval instead. So every move is confirmed by
 * re-reading the ticket, and only then reported into the chat.
 */
import { spaces } from './xyne';
import type { Board, ChannelBoardMapping, Stage, StageTransition, Ticket } from '@xyne/spaces-sdk';

export type { Board, Stage, StageTransition, ChannelBoardMapping };

export interface BoardView {
  board: Board | null;
  boardId: string;
  /** Ordered columns. */
  stages: Stage[];
  transitions: StageTransition[];
  /** Tickets per stage name. */
  columns: Map<string, Ticket[]>;
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
        .catch(() => [] as Ticket[]),
    ),
  );

  const columns = new Map<string, Ticket[]>();
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
  from: Stage | undefined,
  stages: Stage[],
  transitions: StageTransition[],
): Stage[] {
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
