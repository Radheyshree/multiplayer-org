/**
 * The org spine, read through @xyne/spaces-sdk.
 *
 *   org ─ project ─ track ─ ticket ─ conversation
 *
 * "Track" is a CHANNEL scoped to a project. That is not a new concept bolted on
 * here — `Channel.projectId` and `Ticket.channelId` are columns that already
 * exist, so the hierarchy needs no schema change and no new table. Every ticket
 * row also carries `conversationId` (required, non-optional), which is the one
 * common chat this whole product is built around.
 */
import { spaces } from './xyne';
import type {
  Channel,
  ClawAgent,
  CurrentUser,
  Message,
  Project,
  Ticket,
  Workflow,
} from '@xyne/spaces-sdk';

export type { Channel, ClawAgent, CurrentUser, Message, Project, Ticket, Workflow };

/** A project with its tracks resolved. */
export interface ProjectTree {
  project: Project;
  tracks: Channel[];
}

export async function loadMe(): Promise<CurrentUser> {
  return spaces.users.me();
}

/**
 * The projects you are actually part of.
 *
 * `channels.listWithMyConversations()` is the membership answer: it returns
 * real `Channel` rows (with `projectId`) for the channels this user is in —
 * 173 here, against 907 browsable and 125 projects workspace-wide. Filtering
 * projects down to the ones holding at least one of those channels is what
 * turns an unusable 125-project list into your own working set.
 *
 * `channels.list()` looks like the membership call but returns
 * `ChannelUserStatus` rows (per-user read state) with no `projectId`, so it
 * cannot build this on its own.
 *
 * `includeAll` widens to every browsable channel for a "browse the whole org"
 * mode. It is off by default because that view is the one nobody could use.
 */
export async function loadProjectTrees(includeAll = false): Promise<ProjectTree[]> {
  const [projects, mine, browsable] = await Promise.all([
    spaces.projects.list(),
    spaces.channels.listWithMyConversations(),
    includeAll ? listAllBrowsableChannels() : Promise.resolve([] as Channel[]),
  ]);

  const byId = new Map<string, Channel>();
  for (const c of [...mine, ...browsable]) byId.set(c.id, c);
  const channels = [...byId.values()].filter((c) => !c.isArchived);

  // Only channels scoped to a project are tracks. DMs carry a projectId too in
  // some workspaces, so exclude them explicitly rather than by omission.
  const isTrack = (c: Channel): boolean =>
    Boolean(c.projectId) && c.scopeType !== 'DM' && c.scopeType !== 'GROUP_DM';

  const trees = projects
    .map((project) => ({
      project,
      tracks: channels
        .filter((c) => isTrack(c) && c.projectId === project.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((t) => t.tracks.length > 0)
    .sort((a, b) => a.project.name.localeCompare(b.project.name));

  return trees;
}

/**
 * Every browsable channel — only used by the "all projects" toggle.
 *
 * `listBrowsable` clamps its limit to 100 (DEFAULT_LIMIT and MAX_LIMIT are both
 * 100), but the server sends every row and the SDK windows it client-side, so
 * `total` is truthful and an extra page costs another full fetch regardless of
 * window size. Hence: read page one, learn the total, fire the rest together.
 */
async function listAllBrowsableChannels(): Promise<Channel[]> {
  const first = await spaces.channels.listBrowsable({ limit: 100, offset: 0 });
  if (!first.hasMore) return first.items;
  const pages = Math.min(Math.ceil(first.total / 100), 20);
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) =>
      spaces.channels.listBrowsable({ limit: 100, offset: (i + 1) * 100 }),
    ),
  );
  return [...first.items, ...rest.flatMap((p) => p.items)];
}

/**
 * Tickets on one track.
 *
 * There is no `tickets.listByChannel`, so we read the project's page and filter
 * by `channelId` client-side. Worth knowing: this is one full page fetch, and
 * the SDK's `Page` helper windows an already-fetched array rather than asking
 * the server for less — paging it costs another full fetch, it does not save one.
 */
export async function loadTickets(projectId: string, channelId: string): Promise<Ticket[]> {
  const page = await spaces.tickets.listByProject(projectId, { limit: 100 });
  return page.items
    .filter((t) => t.channelId === channelId && !t.isArchived)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The ticket's one common chat, oldest first. */
export async function loadThread(conversationId: string): Promise<Message[]> {
  const page = await spaces.messages.listByConversation(conversationId, { limit: 100 });
  return [...page.items].sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Post into the ticket's chat.
 *
 * NOTE, and this matters if any of this ever ships: running locally the app
 * holds a real full-identity token, so it can post anywhere the user can post.
 * In a PUBLISHED app that is exactly the hole to avoid — there the post must be
 * host-mediated, with the app sending no target and the host supplying
 * `conversationId` from context it already delivered.
 */
export async function postUpdate(conversationId: string, content: string): Promise<string> {
  const { messageId } = await spaces.messages.send({ conversationId, content });
  return messageId;
}

/** Agents this deployment can run. Dispatch by `slug`, never by id or name. */
export async function loadAgents(): Promise<ClawAgent[]> {
  return spaces.claw.listAgents();
}

/**
 * Ask an agent to work on this ticket and reply into its thread.
 *
 * `conversationId` continues the existing thread and `channelId` posts the
 * agent's reply into that Spaces channel — the one place the two services meet.
 * We use `run` (fire-and-forget) rather than `runAndWait` deliberately:
 * runAndWait polls with a 5-minute default and its first poll is a GET, so it
 * blocks the UI for as long as the agent takes.
 */
export async function askAgent(input: {
  agent: string;
  task: string;
  conversationId: string;
  channelId: string;
}): Promise<string> {
  const { sessionId } = await spaces.claw.run(input);
  return sessionId;
}

/**
 * Pick the agent that answers "what is happening on this ticket".
 *
 * Prefers one whose slug or name mentions updates/status, then the deployment's
 * default, then whatever is enabled. Returns null rather than guessing at an
 * empty list — the caller shows "no agent available" instead of dispatching to
 * a slug that does not exist.
 */
export function pickUpdateAgent(agents: ClawAgent[]): ClawAgent | null {
  const enabled = agents.filter((a) => a.enabled);
  const named = enabled.find((a) => /update|status|standup|recap|brief/i.test(`${a.slug} ${a.name}`));
  return named ?? enabled.find((a) => a.isDefault) ?? enabled[0] ?? null;
}

export interface Insights {
  topChats: Array<{ channel: Channel; lastActivityAt: number; participantCount: number }>;
  topWorkflows: Workflow[];
  topAgents: ClawAgent[];
}

/**
 * INSIGHTS, built only from data the SDK actually returns.
 *
 * "Top" here means most-recently-active and best-populated, because that is what
 * `ChannelStats` carries — there is no message-count or run-count metric on any
 * of these resources, so a genuine leaderboard would need a new endpoint. Stated
 * plainly rather than faked with a random sort.
 */
export async function loadInsights(trackIds: string[], channelsById: Map<string, Channel>): Promise<Insights> {
  const [stats, workflows, agents] = await Promise.all([
    trackIds.length ? spaces.channels.getStatsForChannels(trackIds.slice(0, 100)) : Promise.resolve([]),
    spaces.automations.list().catch(() => [] as Workflow[]),
    spaces.claw.listAgents().catch(() => [] as ClawAgent[]),
  ]);

  const topChats = stats
    .map((s) => ({
      channel: channelsById.get(s.channelId),
      lastActivityAt: s.lastActivityAt,
      participantCount: s.participantCount,
    }))
    .filter((r): r is { channel: Channel; lastActivityAt: number; participantCount: number } =>
      r.channel !== undefined,
    )
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    .slice(0, 8);

  return {
    topChats,
    topWorkflows: workflows.slice(0, 8),
    topAgents: agents.filter((a) => a.enabled).slice(0, 8),
  };
}

/**
 * Tickets assigned to me across the tracks I am in — the "you owe an update"
 * list the Update Agent nudges on.
 *
 * There is no `tickets.listAssignedToMe`, so this reads each project's page and
 * filters on `assignedTo`. Bounded to the projects passed in (your own tracks),
 * because the workspace has 125 of them and reading all is neither fast nor
 * useful.
 */
export async function loadMyTickets(projectIds: string[], userId: string): Promise<Ticket[]> {
  const pages = await Promise.all(
    projectIds.slice(0, 12).map((id) =>
      spaces.tickets.listByProject(id, { limit: 100 }).catch(() => null),
    ),
  );
  return pages
    .flatMap((p) => p?.items ?? [])
    .filter((t) => t.assignedTo === userId && !t.isArchived)
    .sort((a, b) => a.updatedAt - b.updatedAt);
}

/** Roughly how stale a ticket looks, for ordering the nudge list. */
export function staleDays(t: Ticket): number {
  return Math.floor((Date.now() - t.updatedAt) / 86_400_000);
}

/** One page of a track's tickets, plus the cursor for the next. */
export interface TicketPage {
  items: Ticket[];
  /** Pass back as `cursor` to fetch the next page. Null when exhausted. */
  next: { id: string; createdAt: number } | null;
}

/**
 * Tickets on a track, PAGED BY THE SERVER.
 *
 * `tickets.listByProject` cannot be used at scale: it takes no cursor, fetches
 * the project's entire ticket set in one response, and windows it client-side —
 * so `limit` never reaches the server and a project with a million tickets sends
 * all of them to render twenty.
 *
 * `listKanban` is the only ticket read in the SDK with a real cursor. Two things
 * about it are unusual and both matter:
 *   • it returns a FLAT `Ticket[]`, never a `Page<T>` — there is no `hasMore`,
 *     no `total` and no returned cursor;
 *   • its `limit` has no default and no clamp (a bare pass-through), so it must
 *     always be passed explicitly.
 * So "is there more" is inferred by asking for `limit` and getting `limit` back,
 * and the next cursor is built by hand from the last row.
 */
export async function loadTicketPage(
  projectId: string,
  channelId: string,
  limit: number,
  cursor: { id: string; createdAt: number } | null,
): Promise<TicketPage> {
  const items = await spaces.tickets.listKanban({
    viewMode: 'project',
    projectId,
    limit,
    dir: 'forward',
    ...(cursor ? { start: cursor } : {}),
    filters: { sourceChannels: [channelId] },
  });

  const live = items.filter((t) => !t.isArchived);
  const last = items[items.length - 1];
  // A short page means the server had nothing more to give.
  const next = items.length >= limit && last ? { id: last.id, createdAt: last.createdAt } : null;
  return { items: live, next };
}

/**
 * Post into a ticket's chat without making it the open ticket.
 *
 * The shell normally supplies `conversationId` from whatever is selected, which
 * is what stops an app posting to the wrong place. This is the deliberate
 * exception: answering the Update Agent about three tickets should not mean
 * navigating to each one and losing what you were doing. The target still comes
 * from a ticket the caller already holds, never from free text.
 */
export async function postToTicket(
  ticket: { conversationId: string },
  content: string,
): Promise<string> {
  const { messageId } = await spaces.messages.send({
    conversationId: ticket.conversationId,
    content,
  });
  return messageId;
}
