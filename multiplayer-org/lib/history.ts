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
