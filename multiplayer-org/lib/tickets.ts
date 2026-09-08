/**
 * Ticket operations — the whole write surface the SDK allows.
 *
 * The one rule worth knowing: moving a card between stages has TWO paths.
 * `update({ stageName })` sets the stage and skips the board's rules;
 * `transitionStage()` runs them, which may demand an approval or a form. A board
 * with rows in `boards.listTransitions` is non-linear and must use the latter,
 * or a drag silently bypasses approvals the team relies on.
 */
import { xyne } from './xyne';

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
  assignedTo?: string;
  createdBy?: string;
  projectId?: string;
  boardId?: string;
  conversationId?: string;
  channelId?: string;
  eta?: number;
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
}): Promise<{ id?: string }> {
  const { spaces } = await xyne();
  return (await spaces.tickets.create(data)) as unknown as { id?: string };
}

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
