import { spaces, token, xyne } from './xyne';
import { type Channel, type ClawAgent, type CurrentUser, type Message, type Project, type Ticket, type User, type Workflow } from '@xyne/spaces-sdk';

/* ---- from lib/org.ts -------------------------------------------------- */
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
  const first = await spaces.messages.listByConversation(conversationId, { limit: 100 });
  const all = [...first.items];
  // Page it. A ticket worked on for a month passes a hundred messages easily,
  // and the single-page read silently dropped the OLDEST — which is exactly the
  // part of the record somebody scrolls back for. Bounded at 600: a ledger is
  // read, not audited, and six pages is already past what anyone scrolls.
  const meta = first as unknown as { hasMore?: boolean; total?: number };
  if (meta.hasMore && (meta.total ?? 0) > all.length) {
    for (let offset = all.length; offset < Math.min(meta.total ?? 0, 600); offset += 100) {
      const next = await spaces.messages.listByConversation(conversationId, { limit: 100, offset });
      if (!next.items.length) break;
      all.push(...next.items);
    }
  }
  return all.sort((a, b) => a.createdAt - b.createdAt);
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

/* ---- from lib/directory.ts -------------------------------------------- */
/**
 * Turning ids into names.
 *
 * The API hands back raw ids almost everywhere a person appears — a message has
 * a `senderId`, a ticket an `assignedTo`, and a DM channel's `name` column is
 * literally a comma-joined list of user ids:
 *
 *   name: 'ccsoqzpidxdqtalfdrpquo4i,cmhkaaw5c0000sosm9tsmt0ek'
 *
 * Two of the rules here are not guessable, so they are written down rather than
 * rediscovered:
 *
 *   1. `displayName` is usually null. Fall back to `name`, then `email`.
 *   2. A DM channel's `name` is participant ids, not a name. It includes the
 *      viewer, who has to be dropped or every DM reads "You, Priya".
 */

export interface Person {
  id: string;
  label: string;
  email: string;
  picture: string | null;
  isBot: boolean;
}

export interface Directory {
  people: Map<string, Person>;
  /** A person's display name, or a short id when they are not in the directory. */
  name: (userId: string | null | undefined) => string;
  /** A channel's human label — DMs resolved to participant names. */
  channelLabel: (channel: Channel) => string;
}

function personFrom(u: User): Person {
  return {
    id: u.id,
    // displayName is usually null; name is usually set; email always is.
    label: u.displayName?.trim() || u.name?.trim() || u.email,
    email: u.email,
    picture: u.picture,
    isBot: u.userType !== 'USER' && u.userType !== 'HUMAN',
  };
}

/**
 * Every user in the workspace, in ONE request.
 *
 * This deliberately calls the SDK's own query endpoint rather than
 * `spaces.users.listBasic()`. The reason is specific, not stylistic: the server
 * returns the entire directory in a single response (4358 users here) and the
 * SDK's `paginate` then windows that array client-side to 100 rows. It does not
 * ask the server for less — so walking the pages would re-download all 4358
 * users 44 times to end up exactly where one call already got us.
 *
 * `users.listBasic` is the same operation id the SDK sends (registry/users.js:24),
 * and this goes through the same auth header and Vite proxy. When a genuinely
 * paged variant appears, delete this and call the resource.
 *
 * `getProfiles` is not an alternative: `UserProfile` carries `displayName` but
 * no `name` and no `email`, and displayName is null for about a third of people,
 * so it cannot produce a label on its own.
 */
async function listAllUsers(): Promise<User[]> {
  const res = await fetch('/api/sdk/v1/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ op: 'users.listBasic', args: {} }),
  });
  if (!res.ok) throw new Error(`directory: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: User[] | { items?: User[] } };
  const data = body.data;
  return Array.isArray(data) ? data : (data?.items ?? []);
}

export async function loadDirectory(viewerId: string | null): Promise<Directory> {
  const users = await listAllUsers().catch(() => [] as User[]);
  const people = new Map<string, Person>();
  for (const u of users) people.set(u.id, personFrom(u));

  const name = (userId: string | null | undefined): string => {
    if (!userId) return 'Unassigned';
    return people.get(userId)?.label ?? `user ${userId.slice(0, 6)}`;
  };

  const channelLabel = (channel: Channel): string => {
    const isDm = channel.scopeType === 'DM' || channel.scopeType === 'GROUP_DM';
    if (!isDm) return channel.name;

    const others = channel.name
      .split(',')
      .map((s) => s.trim())
      .filter((id) => id.length > 0 && id !== viewerId);

    if (others.length === 0) return 'You';
    const labels = others.map((id) => people.get(id)?.label ?? `user ${id.slice(0, 6)}`);
    if (labels.length <= 3) return labels.join(', ');
    return `${labels.slice(0, 3).join(', ')} +${labels.length - 3}`;
  };

  return { people, name, channelLabel };
}

/** An empty directory, so the UI can render before users have loaded. */
export const EMPTY_DIRECTORY: Directory = {
  people: new Map(),
  name: (id) => (id ? `user ${id.slice(0, 6)}` : 'Unassigned'),
  channelLabel: (c) => c.name,
};

/**
 * `IN_PROGRESS` → `In progress`. The API returns SCREAMING_SNAKE enums for
 * status, priority and type; none of them are meant to be read as-is.
 */
export function humanize(code: string | null | undefined): string {
  if (!code) return '—';
  const s = code.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Relative time, for message and ticket timestamps. */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Initials for an avatar, from a resolved display label. */
export function initials(label: string): string {
  const parts = label.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/**
 * Priority and status tones.
 *
 * These read from the semantic tokens in index.css, deliberately not the accent
 * hue: "this is urgent" and "this is the brand colour" must not look alike, and
 * a P0 badge must not look like the agent marker.
 */
export function priorityTone(priority: string | null | undefined): string {
  switch ((priority ?? '').toUpperCase()) {
    case 'P0':
    case 'URGENT':
    case 'CRITICAL':
    case 'HIGHEST':
      return 'bg-crit-soft text-crit border-crit/25';
    case 'P1':
    case 'HIGH':
      return 'bg-warn-soft text-warn border-warn/25';
    case 'P3':
    case 'LOW':
    case 'LOWEST':
      return 'bg-muted text-muted-foreground border-transparent';
    default:
      return 'bg-secondary text-secondary-foreground border-transparent';
  }
}

export function statusTone(status: string | null | undefined): string {
  const s = (status ?? '').toUpperCase();
  if (/(DONE|CLOSED|RESOLVED|COMPLETE)/.test(s)) return 'bg-ok-soft text-ok border-ok/25';
  if (/(BLOCK|HOLD|WAIT)/.test(s)) return 'bg-crit-soft text-crit border-crit/25';
  if (/(PROGRESS|REVIEW|DOING|ACTIVE)/.test(s)) return 'bg-warn-soft text-warn border-warn/25';
  return 'bg-secondary text-secondary-foreground border-transparent';
}

/* ---- from lib/host.ts ------------------------------------------------- */
/**
 * Handing a URL to the Xyne host so it renders the REAL site inside the app.
 *
 * The desktop app already contains a browser: a <webview>-backed panel with its
 * own tabs and address bar. A webview is a separate top-level browsing context,
 * not an iframe, so X-Frame-Options and frame-ancestors do not apply to it —
 * github.com renders there in full, logged in, exactly as in Chrome. That is the
 * thing an embedded iframe can never be.
 *
 * We cannot call that panel directly: it is driven by browserPanelActor in the
 * dashboard, and a Space is a cross-origin sandboxed frame with no channel to it
 * (the artifact bridge carries data and agent messages only). But we do not need
 * one. A plain window.open is intercepted in the main process — see
 * apps/electron/src/window/manager.ts:113-125 — and any non-Xyne origin is
 * denied as a window and re-sent to the renderer as 'open-in-browser-panel',
 * which is precisely the in-app browser. The Sandpack frame we run in is created
 * with allow-popups, so the call is permitted to begin with.
 *
 * WHERE IT LANDS depends on one user preference, `openLinksExternally`, which
 * defaults to TRUE (apps/dashboard/src/types/browserSettings.ts:8):
 *
 *   pref ON  (default)  ->  system browser        modified click -> Xyne panel
 *   pref OFF            ->  Xyne browser panel    modified click -> system browser
 *
 * because the main process computes `wantExternal = prefExternal !== modifier`.
 * So the honest thing is to open the link and tell the reader which of the two
 * they will get, rather than promising an in-app panel we do not control.
 */

/** True when running inside the Xyne desktop shell, where the panel exists. */
export function isDesktop(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /electron|xyne/i.test(navigator.userAgent);
}

/**
 * Ask the host to show a URL. On desktop this reaches the in-app browser panel
 * (subject to the preference above); in a web tab there is no panel and it is a
 * browser tab, which is the best the web can do.
 */
export function openInHost(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** One line of truth about where openInHost will actually put the page. */
export function handoffHint(): string {
  return isDesktop()
    ? 'Opens in Xyne’s own browser panel — the real site, inside the app. Hold ⌘ (or Ctrl) to send it to your system browser instead. If it lands in the wrong one, flip “open links externally” in Xyne’s link settings.'
    : 'Opens in a new browser tab. The in-app browser panel only exists in the Xyne desktop app — a web page cannot embed github.com, which blocks framing outright.';
}

/* ---- from lib/apps.ts ------------------------------------------------- */
/**
 * The workspace's real app registry.
 *
 * `orgApps/catalogue.ts` lists the apps this shell mounts. This file lists the
 * apps the WORKSPACE actually has installed, read through `admin.*` — the same
 * registry the Xyne dashboard reads. The two are shown together in the store
 * because they answer the same question from different sides: what can I open
 * here, and what does this org already run.
 *
 * Nothing here is invented. If a list comes back empty, the store says so.
 */

export type Origin = 'org' | 'marketplace';

export interface RegistryApp {
  id: string;
  name: string;
  description: string;
  origin: Origin;
  version?: string;
  /** Present in this workspace's installed set. */
  installed: boolean;
}

type RawApp = {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  scope?: string;
};

function toApp(a: RawApp, origin: Origin, installed: Set<string>): RegistryApp {
  return {
    id: a.id,
    name: a.name || a.id,
    description: a.description || 'No description provided.',
    origin,
    ...(a.version ? { version: a.version } : {}),
    installed: installed.has(a.id),
  };
}

export interface Registry {
  org: RegistryApp[];
  marketplace: RegistryApp[];
  /** Set when a list failed. The rest still renders — see below. */
  error?: string;
}

/**
 * Read the registry.
 *
 * `allSettled`, not `all`: these are three independent admin endpoints and a
 * permission gap on any one of them is normal. Failing the whole store because
 * the marketplace list 403s would hide the org's own apps, which is the half
 * that matters.
 */
export async function loadRegistry(): Promise<Registry> {
  const { spaces } = await xyne();
  const me = await spaces.users.me();

  const [installedRes, orgRes, marketRes] = await Promise.allSettled([
    spaces.admin.listInstalledApps({ limit: 50 }),
    spaces.admin.listOrgApps(me.orgId, { limit: 50 }),
    spaces.admin.listMarketplaceApps({ limit: 50 }),
  ]);

  const installed = new Set<string>();
  if (installedRes.status === 'fulfilled') {
    for (const i of installedRes.value as unknown as Array<{ appId?: string }>) {
      if (i.appId) installed.add(i.appId);
    }
  }

  const org =
    orgRes.status === 'fulfilled'
      ? (orgRes.value as unknown as RawApp[]).map((a) => toApp(a, 'org', installed))
      : [];
  const marketplace =
    marketRes.status === 'fulfilled'
      ? (marketRes.value as unknown as RawApp[]).map((a) => toApp(a, 'marketplace', installed))
      : [];

  const failed = [orgRes, marketRes].filter((r) => r.status === 'rejected').length;
  return {
    org,
    marketplace,
    ...(failed ? { error: `${failed} registry list${failed > 1 ? 's' : ''} could not be read.` } : {}),
  };
}

/* ---- from lib/history.ts ---------------------------------------------- */
/**
 * Recently viewed conversations.
 *
 * Per-device by design — this is "where was I", not org state, so it lives in
 * localStorage rather than costing a round trip. It stores the labels it needs
 * to render, so the history list draws instantly without refetching tickets
 * from tracks you are no longer standing in.
 *
 * Every read and write is wrapped: localStorage throws outright in some
 * contexts (Safari private mode, blocked site data), and a history sidebar is
 * never worth taking the app down for.
 */

const KEY = 'multiplayer-org:recent-conversations:v1';
const LIMIT = 25;

export interface RecentEntry {
  conversationId: string;
  ticketId: string;
  xyneId: string;
  title: string;
  trackId: string;
  trackName: string;
  projectName: string;
  /** Epoch ms of the most recent visit. */
  at: number;
}

export function readHistory(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as RecentEntry[])
      .filter((e) => e && typeof e.conversationId === 'string' && typeof e.ticketId === 'string')
      .sort((a, b) => b.at - a.at)
      .slice(0, LIMIT);
  } catch {
    return [];
  }
}

/** Record a visit. Re-visiting moves an entry to the top rather than duplicating it. */
export function recordVisit(entry: Omit<RecentEntry, 'at'>): RecentEntry[] {
  const next = [
    { ...entry, at: Date.now() },
    ...readHistory().filter((e) => e.ticketId !== entry.ticketId),
  ].slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota or blocked storage — the in-memory list this returns still works */
  }
  return next;
}

export function clearHistory(): RecentEntry[] {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return [];
}

/* ---- from lib/workitem.ts --------------------------------------------- */
/**
 * The ticket, as an APP hands it back to the shell.
 *
 * Why this type exists rather than reusing `Ticket`:
 *
 * The SDK's `Ticket` is a 30-field row with every field required — including
 * `workspaceId`, `kanbanPosition`, `metadata` and `merchantId`. The shell reads
 * exactly seven of them (see the ledger header and `postToTicket`). Requiring
 * an app to produce all thirty would mean either a full re-read per action or
 * inventing values, and an app that reads its work through a different endpoint
 * (Desk reads support rows, Board reads kanban rows) genuinely does not have
 * them.
 *
 * So the contract asks for the seven the shell actually uses. A real SDK
 * `Ticket` satisfies this structurally with no conversion — the rail keeps
 * passing its rows straight through — while an app with a partial row states
 * what it has via `toWorkItem`.
 *
 * `conversationId` is the load-bearing one: it is how the shell resolves where
 * an update goes, and it is the reason apps never name a target themselves.
 */
export interface WorkItem {
  id: string;
  xyneId: string;
  title: string;
  /** Free-form here on purpose: the SDK's union and the board's stage names are
   *  different vocabularies, and the shell only ever humanises the string. */
  statusV2: string;
  priority: string;
  channelId: string;
  conversationId: string;
}

/** What a partial ticket row must carry before it can be handed to the shell. */
export interface PartialTicket {
  id: string;
  xyneId?: string;
  title?: string;
  statusV2?: string;
  priority?: string;
  stageName?: string;
  channelId?: string;
  conversationId?: string;
}

/**
 * Narrow a ticket row from any surface into the shell's contract.
 *
 * Returns null when the row has no conversation, and that is not a defensive
 * nicety: a ticket without `conversationId` has nowhere for an update to land,
 * so focusing it would open an empty ledger and posting to it would throw. The
 * caller disables the action instead of discovering this at click time.
 */
export function toWorkItem(t: PartialTicket): WorkItem | null {
  if (!t.conversationId) return null;
  return {
    id: t.id,
    xyneId: t.xyneId ?? t.id.slice(0, 8),
    title: t.title ?? 'Untitled',
    // Board rows carry the stage as their live status; the SDK column is a
    // coarser lifecycle value. Prefer the specific one when it is there.
    statusV2: t.statusV2 ?? t.stageName ?? '',
    priority: t.priority ?? '',
    channelId: t.channelId ?? '',
    conversationId: t.conversationId,
  };
}
