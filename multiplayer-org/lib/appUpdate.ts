/**
 * The ticket's context ledger.
 *
 * A ticket's conversation is not a chat that apps occasionally interrupt — it is
 * the one place every surface writes what it did to that ticket. Kanban moves a
 * card, Desk logs a finding, GitHub opens a PR: all of it lands here, so the
 * agent and any viewer can read a single conversation and know everything about
 * this ticket across every app. That completeness is the point, and it is why
 * apps record even routine actions rather than staying quiet.
 *
 * The cost of completeness is noise, and the answer to noise is LAYERING, not
 * silence. Each entry declares what kind of thing it is, so the reader can see
 * people first and the machinery only when they want it — while the agent still
 * gets the full ledger.
 *
 *   activity — something changed. Routine, collapsible, the audit trail.
 *   note     — somebody wrote something for other people to read.
 *
 * The marker rides inside `content` because the server hardcodes
 * `messages.metadata` to null on write, so `content` is the only field that
 * survives the round trip. Move this to metadata the moment that opens up; the
 * parser can stay to keep old entries rendering.
 */

export type EntryKind = 'activity' | 'note';

const MARKER = /^\[app:([a-z0-9-]{1,40})(?:\|(activity|note))?\]\s*/i;

/** Wrap an app's entry so the ledger can attribute and layer it. */
export function tagUpdate(appId: string, body: string, kind: EntryKind = 'note'): string {
  return `[app:${appId}|${kind}] ${body}`;
}

export interface ParsedUpdate {
  /** The app that recorded it, or null when a person typed it. */
  appId: string | null;
  /** Routine change vs something written to be read. People default to 'note'. */
  kind: EntryKind;
  /** The entry with the marker stripped. */
  body: string;
}

export function parseUpdate(content: string): ParsedUpdate {
  const m = MARKER.exec(content);
  if (!m) return { appId: null, kind: 'note', body: content };
  return {
    appId: m[1]!.toLowerCase(),
    // Entries written before kinds existed are notes, which is the safe default:
    // they show by default rather than hiding in a collapsed layer.
    kind: (m[2]?.toLowerCase() as EntryKind | undefined) ?? 'note',
    body: content.slice(m[0].length),
  };
}

/** Which layers the reader wants to see. The agent always reads all of them. */
export type Layer = 'all' | 'people' | 'apps' | 'agent';

export function matchesLayer(
  layer: Layer,
  entry: { appId: string | null; kind: EntryKind },
  isAgent: boolean,
): boolean {
  switch (layer) {
    case 'people':
      // What a human would catch up on: people talking, plus app notes written
      // for people. Routine machinery is exactly what this layer removes.
      return !isAgent && entry.kind === 'note';
    case 'apps':
      return entry.appId !== null;
    case 'agent':
      return isAgent;
    default:
      return true;
  }
}
