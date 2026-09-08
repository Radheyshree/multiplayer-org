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
    blurb: 'Live, upcoming and past calls with their participants and recordings.',
    group: 'Knowledge',
    status: 'live',
    posts: 'a call linked to the ticket it was about',
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
