/**
 * Track data layer.
 *
 * A Track is the unit of attention: a named thing you're following, holding
 * references to real Spaces entities (a ticket, three emails, a call) plus one
 * real Xyne conversation for its chat.
 *
 * Storage is key-addressed only — no queries over values — so anything we need
 * to filter on is encoded into the key. Tracks live in `global` scope so every
 * viewer in the workspace sees the same set; presence is per-user but also
 * global so viewers can see each other.
 */
import { xyne } from './xyne';

/** A pinned reference to a real Spaces entity. Never a copy — resolved live. */
export type TrackNode = {
  refId: string;
  /** Search's docType — this is also the provenance badge. */
  docType: string;
  title: string;
  subtitle?: string;
  addedBy: string;
  addedByName?: string;
  addedAt: string;
  /** Why it belongs on this track. */
  note?: string;
};

export type Track = {
  id: string;
  title: string;
  description?: string;
  /** Where the track's chat lives — a real Xyne channel + thread. */
  channelId: string;
  channelName?: string;
  conversationId: string;
  nodes: TrackNode[];
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
};

export type Viewer = {
  userId: string;
  name: string;
  trackId: string;
  at: number;
};

const TRACKS = 'tracks';
const PRESENCE = 'presence';

/** Viewers older than this are treated as gone. */
export const PRESENCE_TTL_MS = 30_000;

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/** Keys sort lexicographically, so a reverse-chronological prefix gives newest-first for free. */
function trackKey(id: string): string {
  return id;
}

/** The storage server caps a page at 100 and REJECTS anything larger (400
 *  ValidationError) rather than clamping — so page explicitly. */
const PAGE = 100;

export async function listTracks(): Promise<Track[]> {
  const { storage } = await xyne();
  const shelf = storage.collection<Track>(TRACKS);
  const out: Track[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { records, hasMore } = await shelf.list({ scope: 'any', limit: PAGE, offset });
    out.push(...records.map(r => r.value).filter(t => t && t.id));
    if (!hasMore || records.length === 0 || offset > 2000) break;
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getTrack(id: string): Promise<Track | null> {
  const { storage } = await xyne();
  const rec = await storage.collection<Track>(TRACKS).get(trackKey(id), { scope: 'any' });
  return rec?.value ?? null;
}

async function saveTrack(track: Track): Promise<Track> {
  const { storage } = await xyne();
  const next = { ...track, updatedAt: new Date().toISOString() };
  await storage.collection<Track>(TRACKS).put(trackKey(track.id), next, { scope: 'global' });
  return next;
}

/**
 * Create a track and, with it, a REAL Xyne conversation in the chosen channel.
 * That thread is the track's chat — open Xyne next to the app and the same
 * messages are there.
 */
export async function createTrack(input: {
  title: string;
  description?: string;
  channelId: string;
  channelName?: string;
}): Promise<Track> {
  const { spaces } = await xyne();
  const me = await spaces.users.me();

  // Spaces stores message bodies as HTML and does not render markdown, so
  // asterisks would show up literally. Send markup it understands.
  const opening =
    `<p><strong>Track: ${input.title}</strong></p>` +
    (input.description ? `<p>${input.description}</p>` : '') +
    `<p>Opened from Threadline. Everything pinned to this track lands here.</p>`;

  const { conversationId } = await spaces.conversations.create({
    channelId: input.channelId,
    content: opening,
  });

  const track: Track = {
    id: newId('trk'),
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    channelId: input.channelId,
    ...(input.channelName ? { channelName: input.channelName } : {}),
    conversationId,
    nodes: [],
    createdBy: me.id,
    createdByName: me.displayName || me.name || me.email,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return saveTrack(track);
}

/**
 * Pin an entity to a track and narrate it into the track's chat, so the pin is
 * visible to anyone watching the thread in Xyne itself — not just in this app.
 */
export async function pinNode(
  trackId: string,
  node: Omit<TrackNode, 'addedBy' | 'addedAt' | 'addedByName'>,
): Promise<Track> {
  const { spaces } = await xyne();
  const [track, me] = await Promise.all([getTrack(trackId), spaces.users.me()]);
  if (!track) throw new Error('Track not found');
  if (track.nodes.some(n => n.refId === node.refId)) return track;

  const full: TrackNode = {
    ...node,
    addedBy: me.id,
    addedByName: me.displayName || me.name || me.email,
    addedAt: new Date().toISOString(),
  };
  const next = await saveTrack({ ...track, nodes: [...track.nodes, full] });

  // Best-effort narration — a failed post must not lose the pin.
  try {
    await spaces.messages.send({
      conversationId: track.conversationId,
      content: `<p>\u{1F4CE} Linked <strong>${node.title}</strong> (${node.docType}) to this track.</p>`,
    });
  } catch {
    /* the pin is already saved; the narration is a nicety */
  }
  return next;
}

export async function unpinNode(trackId: string, refId: string): Promise<Track> {
  const track = await getTrack(trackId);
  if (!track) throw new Error('Track not found');
  return saveTrack({ ...track, nodes: track.nodes.filter(n => n.refId !== refId) });
}

export async function deleteTrack(id: string): Promise<void> {
  const { storage } = await xyne();
  await storage.collection<Track>(TRACKS).remove(trackKey(id), { scope: 'global' });
}

/**
 * Presence. There is no push channel in the SDK, so viewers announce themselves
 * on a heartbeat into global storage and everyone polls. Approximate by design —
 * which is fine, because "who is looking at this" is approximate information.
 */
export async function heartbeat(trackId: string): Promise<void> {
  const { spaces, storage } = await xyne();
  const me = await spaces.users.me();
  const viewer: Viewer = {
    userId: me.id,
    name: me.displayName || me.name || me.email,
    trackId,
    at: Date.now(),
  };
  await storage.collection<Viewer>(PRESENCE).put(me.id, viewer, { scope: 'global' });
}

export async function listViewers(trackId: string): Promise<Viewer[]> {
  const { storage } = await xyne();
  const { records } = await storage.collection<Viewer>(PRESENCE).list({ scope: 'any', limit: PAGE });
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  return records
    .map(r => r.value)
    .filter(v => v && v.trackId === trackId && v.at > cutoff)
    .sort((a, b) => b.at - a.at);
}
