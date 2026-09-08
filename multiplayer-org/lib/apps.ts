/**
 * The app catalogue.
 *
 * Two kinds of entry, deliberately shown side by side:
 *   - SURFACES are built into this shell and render from SDK data (Board, Chat,
 *     Desk, Scribe, Repos, Threadline).
 *   - REGISTERED apps are the real Xyne app registry — the org's own apps and
 *     the workspace marketplace, read through admin.*. Nothing is invented.
 */
import { xyne } from './xyne';

export type SurfaceId = 'threadline' | 'board' | 'chat' | 'desk' | 'scribe' | 'repos' | 'studio';

export type Entry = {
  key: string;
  name: string;
  description: string;
  /** Where it came from — shown as the faceplate's source strip. */
  origin: 'surface' | 'org' | 'marketplace';
  /** Set for built-in surfaces the shell can actually open. */
  surface?: SurfaceId;
  glyph: string;
  version?: string;
  installed?: boolean;
  /** Honest state for surfaces the SDK can only partly support. */
  limited?: string;
};

/** The surfaces this shell renders itself. Order is the rail order. */
export const SURFACES: Entry[] = [
  {
    key: 'surface:threadline',
    surface: 'threadline',
    name: 'Threadline',
    description: 'Follow one thing across tickets, mail and calls in a single thread.',
    origin: 'surface',
    glyph: '⌘',
  },
  {
    key: 'surface:studio',
    surface: 'studio',
    name: 'Studio',
    description: 'Build a Space app by talking to a Claw agent — preview, code, and followups.',
    origin: 'surface',
    glyph: '\u2726',
  },
  {
    key: 'surface:board',
    surface: 'board',
    name: 'Tickets Board',
    description: 'Kanban over a board’s stages. Open a card, reassign, move it on.',
    origin: 'surface',
    glyph: '▤',
  },
  {
    key: 'surface:chat',
    surface: 'chat',
    name: 'Xyne Chat',
    description: 'Channels, threads and replies with unread state.',
    origin: 'surface',
    glyph: '◈',
  },
  {
    key: 'surface:desk',
    surface: 'desk',
    name: 'Xyne Desk',
    description: 'The support inbox — email-driven tickets, read and reply.',
    origin: 'surface',
    glyph: '✉',
  },
  {
    key: 'surface:scribe',
    surface: 'scribe',
    name: 'Xyne Scribe',
    description: 'Live, upcoming and past calls, with participants and recordings.',
    origin: 'surface',
    glyph: '◉',
  },
  {
    key: 'surface:repos',
    surface: 'repos',
    name: 'GitHub & Bitbucket',
    description: 'Browse GitHub and Bitbucket inside the shell — repos, branches, commits and pull requests.',
    origin: 'surface',
    glyph: '⑂',
  },
];

type RawApp = {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  scope?: string;
};

function toEntry(a: RawApp, origin: 'org' | 'marketplace', installed: Set<string>): Entry {
  return {
    key: a.id,
    name: a.name || a.id,
    description: a.description || 'No description provided.',
    origin,
    glyph: (a.name || '?').trim().charAt(0).toUpperCase() || '?',
    ...(a.version ? { version: a.version } : {}),
    installed: installed.has(a.id),
  };
}

/** Read the real registry. Each list is independent — one failing must not blank the store. */
export async function loadRegistry(): Promise<{ org: Entry[]; marketplace: Entry[]; error?: string }> {
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
      ? (orgRes.value as unknown as RawApp[]).map(a => toEntry(a, 'org', installed))
      : [];
  const marketplace =
    marketRes.status === 'fulfilled'
      ? (marketRes.value as unknown as RawApp[]).map(a => toEntry(a, 'marketplace', installed))
      : [];

  const failed = [orgRes, marketRes].filter(r => r.status === 'rejected').length;
  return {
    org,
    marketplace,
    ...(failed ? { error: `${failed} registry list(s) failed to load.` } : {}),
  };
}

/** Which surfaces the user has pinned to the rail. Per-user, so it follows them. */
const PINS = 'pins';

export async function loadPins(): Promise<string[]> {
  const { storage } = await xyne();
  const rec = await storage.collection<{ keys: string[] }>(PINS).get('rail', { scope: 'user' });
  return rec?.value.keys ?? SURFACES.slice(0, 4).map(s => s.key);
}

export async function savePins(keys: string[]): Promise<void> {
  const { storage } = await xyne();
  await storage.collection<{ keys: string[] }>(PINS).put('rail', { keys }, { scope: 'user' });
}
