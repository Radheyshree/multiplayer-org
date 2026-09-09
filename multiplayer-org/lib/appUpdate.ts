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

/**
 * The marker, in both shapes.
 *
 * WHAT CHANGED AND WHY. The original form was a literal `[app:github|note]`
 * prefix, which this app strips before rendering — but Xyne's own dashboard does
 * not know to strip it, so anyone reading the ticket in Spaces saw
 *
 *   [app:xyne-desk|note|bridge:cmttq5p944ptj4ic02qez3sxq.cmttq535c3dyf6fs6zi2qu5gx] Mail thread linked — …
 *
 * with the machinery in front of the sentence. Writing it as an HTML comment
 * fixes that everywhere at once: every HTML renderer hides it, including Xyne's,
 * and it survives the round trip byte-for-byte (verified against a live
 * conversation — the server stores `content` untouched, comment and all).
 *
 * BOTH FORMS PARSE. Entries written before this change are still in real
 * tickets, and they must keep their badges.
 */
const MARKER =
  /^(?:<!--\s*app:([a-z0-9-]{1,40})(?:\|(activity|note))?(?:\|([a-z0-9:._-]{1,80}))?(?:\|as:([^|>\s]{1,120}))?\s*-->|\[app:([a-z0-9-]{1,40})(?:\|(activity|note))?(?:\|([a-z0-9:._-]{1,80}))?\])\s*/i;

/**
 * Wrap an app's entry so the ledger can attribute and layer it.
 *
 * `ref` is an OPTIONAL idempotency key — the id of the outside thing this entry
 * mirrors, e.g. `mail:1a084adf0b1a066c` for a specific email. It exists because
 * mirroring is a repeated operation: the mail bridge re-reads a desk thread
 * every time a ticket is opened, and without a stable key on the line it wrote
 * last time it cannot tell "already copied" from "new". Comparing subjects and
 * timestamps instead would double a line the moment either changed.
 *
 * It lives in the marker rather than in metadata for the same reason everything
 * else does — the server hardcodes `messages.metadata` to null on write — and it
 * is stripped along with the marker, so no reader ever sees it.
 */
export function tagUpdate(
  appId: string,
  body: string,
  kind: EntryKind = 'note',
  ref?: string,
  /**
   * Who this entry is really FROM.
   *
   * A mirrored email was written by whoever sent it, but the message record
   * belongs to whoever ran the sync — `messages.send` has no way to post as
   * somebody else. Without this the thread claims you wrote a colleague's mail.
   * An address rather than a user id, because the sender is often not a Xyne
   * user at all; the renderer resolves it to a real person when it can.
   */
  from?: string,
): string {
  return `<!--app:${appId}|${kind}${ref ? `|${ref}` : ''}${from ? `|as:${from}` : ''}-->${body}`;
}

export interface ParsedUpdate {
  /** The app that recorded it, or null when a person typed it. */
  appId: string | null;
  /** Routine change vs something written to be read. People default to 'note'. */
  kind: EntryKind;
  /** The entry with the marker stripped. */
  body: string;
  /** The outside thing this entry mirrors, when it was written with one. */
  ref?: string;
  /** The address this entry is really from, when it is not the sender's own. */
  from?: string;
}

export function parseUpdate(content: string): ParsedUpdate {
  const m = MARKER.exec(content);
  if (!m) return { appId: null, kind: 'note', body: content };
  // Groups 1-3 are the comment form, 4-6 the legacy bracket form.
  const appId = m[1] ?? m[5];
  const kind = m[2] ?? m[6];
  const ref = m[3] ?? m[7];
  const from = m[4];
  if (!appId) return { appId: null, kind: 'note', body: content };
  return {
    appId: appId.toLowerCase(),
    // Entries written before kinds existed are notes, which is the safe default:
    // they show by default rather than hiding in a collapsed layer.
    kind: (kind?.toLowerCase() as EntryKind | undefined) ?? 'note',
    body: content.slice(m[0].length),
    ...(ref ? { ref: ref.toLowerCase() } : {}),
    ...(from ? { from: from.toLowerCase() } : {}),
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
