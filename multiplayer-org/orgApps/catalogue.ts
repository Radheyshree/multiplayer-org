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
    name: 'Kanban Board',
    blurb: "The track's board — stages as columns, tickets in them, moves that stick.",
    group: 'Delivery',
    status: 'live',
    posts: 'stage moves and assignments',
  },
  {
    id: 'xyne-desk',
    name: 'Xyne Desk',
    blurb: 'Triage a ticket and log the work against it.',
    group: 'Delivery',
    status: 'live',
    posts: 'work notes',
  },
  {
    id: 'github',
    name: 'GitHub',
    blurb: 'Branches, pull requests and reviews attached to the ticket.',
    group: 'Engineering',
    status: 'planned',
    posts: 'PR opened, merged, review left',
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
    blurb: 'The wider conversation around this work.',
    group: 'Knowledge',
    status: 'planned',
    posts: 'linked discussions',
  },
  {
    id: 'xyne-scribe',
    name: 'Xyne Scribe',
    blurb: 'Notes, transcripts and summaries.',
    group: 'Knowledge',
    status: 'planned',
    posts: 'summaries and decisions',
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
