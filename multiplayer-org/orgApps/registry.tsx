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
import type { WorkItem } from '../lib/workitem';
import type { Directory } from '../lib/directory';
import { catalogueDrift } from './catalogue';
import { Board } from '../components/surfaces/Board';
import { Chat } from '../components/surfaces/Chat';
import { Code } from '../components/surfaces/Code';
import { Desk } from '../components/surfaces/Desk';
import { Scribe } from '../components/surfaces/Scribe';

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
