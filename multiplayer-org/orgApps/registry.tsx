import { Board } from '../components/surfaces/Board';
import { Chat } from '../components/surfaces/Chat';
import { Code } from '../components/surfaces/Repo';
import { Desk } from '../components/surfaces/Desk';
import { Scribe } from '../components/surfaces/Scribe';
import { type Directory, type WorkItem } from '../lib/shell';

/* ---- from orgApps/catalogue.ts ---------------------------------------- */
/**
 * The org's work apps.
 *
 * These are the tools people actually do the work in. The shell does not know
 * what any of them do — it hands each one the selected ticket and a single way
 * to speak (`postUpdate`), and the app decides what an "action" means.
 *
 * `status` is honest on purpose: only apps marked `live` are wired to the SDK.
 * The rest are listed so the catalogue reflects the real surface area of the
 * org, and so adding one is visibly a matter of writing a component rather than
 * changing the shell.
 */

export type AppStatus = 'live' | 'planned';

export interface CatalogueEntry {
  id: string;
  name: string;
  blurb: string;
  /** Grouping in All Apps. */
  group: 'Delivery' | 'Engineering' | 'Quality' | 'Knowledge' | 'Operations';
  status: AppStatus;
  /** What this app would post into a ticket's chat when someone acts in it. */
  posts: string;
}

export const CATALOGUE: CatalogueEntry[] = [
  {
    id: 'kanban-board',
    name: 'Tickets Board',
    blurb:
      "The track's board — stages as columns, drag to move, open a card to edit it, and create tickets in place.",
    group: 'Delivery',
    status: 'live',
    posts: 'stage moves, edits, assignments and new tickets',
  },
  {
    id: 'xyne-desk',
    name: 'Xyne Desk',
    blurb: 'The support inbox — email-driven tickets, read the mail thread and reply into it.',
    group: 'Delivery',
    status: 'live',
    posts: 'replies to a support ticket',
  },
  {
    id: 'github',
    name: 'GitHub & Bitbucket',
    blurb:
      'Browse repositories, pull requests, commits and branches inside the shell, and attach any of them to a ticket.',
    group: 'Engineering',
    status: 'live',
    posts: 'links to pull requests, commits and repositories',
  },
  {
    id: 'xyne-code',
    name: 'Xyne Code',
    blurb: 'Read and change the repository from inside the ticket.',
    group: 'Engineering',
    status: 'planned',
    posts: 'commits and sandbox runs',
  },
  {
    id: 'code-architecture-hub',
    name: 'Code Architecture Hub',
    blurb: 'Service maps, dependencies and ownership.',
    group: 'Engineering',
    status: 'planned',
    posts: 'architecture decisions',
  },
  {
    id: 'test-hub',
    name: 'Test Hub',
    blurb: 'Suites, runs and flakes for the change under review.',
    group: 'Quality',
    status: 'planned',
    posts: 'run results and regressions',
  },
  {
    id: 'mettl',
    name: 'Mettl',
    blurb: 'Assessments and scorecards.',
    group: 'Quality',
    status: 'planned',
    posts: 'assessment outcomes',
  },
  {
    id: 'rca-hub',
    name: 'RCA Hub',
    blurb: 'Root cause, impact and corrective actions for an incident.',
    group: 'Operations',
    status: 'planned',
    posts: 'RCA published, actions assigned',
  },
  {
    id: 'infraswitch',
    name: 'InfraSwitch',
    blurb: 'Environments, flags and deploys.',
    group: 'Operations',
    status: 'planned',
    posts: 'deploys and flag flips',
  },
  {
    id: 'xyne-chat',
    name: 'Xyne Chat',
    blurb:
      'The wider conversation around this work — channels and threads, following the track and ticket you have open.',
    group: 'Knowledge',
    status: 'live',
    posts: 'nothing on its own — it shows the conversation the other apps write to',
  },
  {
    id: 'xyne-scribe',
    name: 'Xyne Scribe',
    blurb:
      "Every call the track has had — the summary, what was decided, and what was said. Turn an action item into a ticket, or quote the moment into the one it's about.",
    group: 'Knowledge',
    status: 'live',
    posts: 'calls, decisions and quotes recorded on a ticket — and tickets made from action items',
  },
  {
    id: 'design-hub',
    name: 'Design Hub',
    blurb: 'Specs, mocks and design review.',
    group: 'Knowledge',
    status: 'planned',
    posts: 'design review outcomes',
  },
];

export const GROUPS: CatalogueEntry['group'][] = [
  'Delivery',
  'Engineering',
  'Quality',
  'Operations',
  'Knowledge',
];

export function catalogueEntry(id: string): CatalogueEntry | undefined {
  return CATALOGUE.find((a) => a.id === id);
}

/**
 * Apps listed in the store but not mounted, and vice versa.
 *
 * The catalogue and the registry are two lists joined by a string id, which is
 * exactly the kind of pair that drifts: a rename lands in one and not the
 * other, the store shows an "Open" button for an app that no longer exists, and
 * nobody notices until a demo. This makes the drift visible instead.
 *
 * Takes the mounted ids as an argument rather than importing the registry,
 * because the registry imports this file — a cycle here would be resolved at
 * runtime in an order that depends on the bundler.
 */
export function catalogueDrift(mountedIds: string[]): { missing: string[]; stale: string[] } {
  const listed = new Set(CATALOGUE.map((a) => a.id));
  const mounted = new Set(mountedIds);
  return {
    // Mounted but not in the store: it works and nobody can find it.
    missing: mountedIds.filter((id) => !listed.has(id)),
    // Marked live in the store but not mounted: the Open button would fail.
    stale: CATALOGUE.filter((a) => a.status === 'live' && !mounted.has(a.id)).map((a) => a.id),
  };
}

/* ---- from orgApps/registry.tsx ---------------------------------------- */
/**
 * The org's app store.
 *
 * An org app receives the selected ticket and one way to speak: `postUpdate`.
 * It never chooses where its update goes — the shell supplies the
 * `conversationId` from the ticket it already had. That is the same shape a
 * published app would need (there the boundary is a postMessage bridge rather
 * than a prop), so building against it locally does not paint us into a corner.
 *
 * Locally an "app" is a component in this registry. Published, each of these
 * would be an ArtifactApp payload the agent generated — the contract below is
 * what stays the same across that move.
 */

/**
 * What a work app is given.
 *
 * THE INVERSION THAT MATTERS: an app is NOT scoped to one ticket. A Kanban
 * board shows a whole board; a desk shows a queue; GitHub shows the repo. So
 * the app receives a SCOPE (the track it is open on) and finds its own work
 * inside it. The ticket id travels with the ACTION, not with the app.
 *
 * That is why `postUpdate` takes the ticket as its first argument: the app is
 * the only thing that knows which of the many tickets on screen an action was
 * about. The shell still owns the target resolution — it reads
 * `ticket.conversationId` — so an app can only ever post to a ticket it was
 * legitimately handed, never to a conversation it names itself.
 */
export interface OrgAppProps {
  /** The track the app is open on. Null when nothing is selected yet. */
  scope: AppScope | null;
  /** Resolves user ids to names — the API returns ids almost everywhere. */
  dir: Directory;
  /** Post an update ABOUT a specific ticket. The app names which one. */
  postUpdate: (ticket: WorkItem, content: string, kind?: 'activity' | 'note') => Promise<string>;
  /** Ask the shell to show this ticket's chat on the right. */
  focusTicket: (ticket: WorkItem | null) => void;
  /** Which ticket the chat pane is currently showing, if any. */
  focusedTicketId: string | null;
  /**
   * The focused ticket itself, not just its id.
   *
   * Both are handed over because they answer different questions. Highlighting
   * a row in a list only needs the id, and comparing ids does not re-render
   * when an unrelated field changes. An app that wants to FOLLOW the focus —
   * open that ticket's conversation, filter itself to that ticket's channel —
   * needs the row, and re-reading it from the server to get back what the shell
   * already holds would be a round trip for nothing.
   */
  focused: WorkItem | null;
  busy: boolean;
}

export interface AppScope {
  projectId: string;
  projectName: string;
  channelId: string;
  trackName: string;
}

export interface OrgApp {
  id: string;
  name: string;
  blurb: string;
  Component: (props: OrgAppProps) => JSX.Element;
  /**
   * Whether the app draws its own scroll containers.
   *
   * The pane is a padded `ScrollArea` by default, which is right for a document
   * and wrong for anything with columns or panes of its own: a kanban board
   * inside a page scroller gets two scrollbars and columns that grow past the
   * viewport instead of scrolling independently. Full-bleed apps are handed a
   * fixed-height box and own everything inside it.
   */
  fullBleed?: boolean;
}

/**
 * The apps this org can open.
 *
 * `id` is the join key: it matches an entry in `catalogue.ts` (which is what
 * the store renders) and it is what `tagUpdate` stamps on every message this
 * app writes. Changing one without the other silently orphans a ledger entry's
 * attribution, so they are checked against each other at the bottom of
 * catalogue.ts.
 *
 * Every app here is `fullBleed`. That is not a coincidence: each one is a
 * workspace with its own columns, panes and toolbars, which is what an app over
 * a whole track looks like. A document-shaped app would leave the flag off and
 * get the pane's padded scroller instead.
 */
export const ORG_APPS: OrgApp[] = [
  {
    id: 'kanban-board',
    name: 'Tickets Board',
    blurb: "The track's board — stages as columns, tickets in them, moves that stick.",
    Component: Board,
    fullBleed: true,
  },
  {
    id: 'xyne-desk',
    name: 'Xyne Desk',
    blurb: 'The support inbox — email-driven tickets, read and reply.',
    Component: Desk,
    fullBleed: true,
  },
  {
    id: 'xyne-chat',
    name: 'Xyne Chat',
    blurb: 'Channels, threads and replies, following the track you have open.',
    Component: Chat,
    fullBleed: true,
  },
  {
    id: 'xyne-scribe',
    name: 'Xyne Scribe',
    blurb: "Calls, what they decided, and what was said — into the ticket it's about.",
    Component: Scribe,
    fullBleed: true,
  },
  {
    id: 'github',
    name: 'GitHub & Bitbucket',
    blurb: 'Browse repositories, pull requests and commits, and attach them to a ticket.',
    Component: Code,
    fullBleed: true,
  },
];

// Fails loudly in dev if the store and the registry have drifted apart. Not a
// throw: a mismatched id should not blank the app during a demo, it should tell
// whoever is looking at the console what to fix.
if (import.meta.env?.DEV) {
  const { missing, stale } = catalogueDrift(ORG_APPS.map((a) => a.id));
  if (missing.length) console.warn('[orgApps] mounted but not in the store:', missing);
  if (stale.length) console.warn('[orgApps] marked live in the store but not mounted:', stale);
}
