/**
 * Where a line in the thread came from.
 *
 * The product this imitates badges every message with its origin — "Priya ·
 * Marketing · via Slack". The temptation is to invent that. This module refuses
 * to: every source below is derived from a field a real row in this workspace
 * carries, and anything we cannot establish resolves to Xyne rather than to a
 * guess. Inventing a "via Jira" badge would be advertising an integration that
 * does not exist.
 *
 * THREE SIGNALS, in the order the real dashboard trusts them.
 *
 * 1. `channel.type` — the sanctioned one. Xyne's own SupportScreen renders its
 *    desk badge straight off it, and it is the only signal that is right for
 *    slack-desk, whose messages are deliberately transformed into Email rows
 *    and are otherwise indistinguishable from mail. Live vocabulary in this
 *    workspace, counted over all 1078 channels:
 *        DEFAULT 1063 · EMAIL 10 · APP 2 · SDLC 1 · SUPPORT 1 · SLACK 1
 *
 * 2. `message.metadata` — the per-message stamp. The ingestion pipeline writes
 *    `{ externalSource, externalAuthor: {name,email,externalId}, eventType,
 *    webUrl }` on every externally-ingested message, and other producers add
 *    `messageSubtype`, PR-webhook fields, and automation markers. `metadata` is
 *    typed `unknown` in the SDK but is populated on read — it is only forced to
 *    null on WRITE, which is why our own entries carry their marker in the body
 *    instead (see lib/appUpdate.ts).
 *
 * 3. `msgType` — USER | BOT | SYSTEM | FORWARDED. Note what this is NOT: it
 *    says who wrote a line, not where it came from. Every externally-ingested
 *    message is BOT, but so is every automation step and every call summary, so
 *    BOT alone cannot mean "arrived from outside".
 *
 * DELIBERATELY ABSENT: GitHub, Jira, Drive and Notion as ingest sources. The
 * live adapter registry is exactly zoho, slack-webhook-tickets, slack-desk,
 * microsoft, google, ozonetel and google-play-reviews, plus app-desk. Jira and
 * Confluence exist only as one-shot migration importers. A code-host badge IS
 * offered below, but only for messages that carry a real PR webhook payload.
 */

import {
  cleanName,
  counterparty,
  system as systemById,
  systemFromEmail,
  systemFromUrl,
  type ExternalSystem,
} from './origin';

/** Origins we can actually prove. Nothing here is aspirational. */
export type SourceId =
  | 'xyne'
  | 'email'
  | 'slack'
  | 'code'
  | 'call'
  | 'app'
  | 'social'
  | 'automation'
  | 'agent';

export interface Source {
  id: SourceId;
  /** What the badge reads — "via Slack". */
  label: string;
  /** A text mark. No icon fonts, no network, no bundle cost. */
  glyph: string;
  /** Link back to the origin system, when the row carried one. */
  href?: string;
  /** Qualifier — "PR #7600", "release started". */
  detail?: string;
  /**
   * The system this actually came from, when it is one we can name — Zoho Desk
   * rather than the category "email". Absent for rows that originate in Xyne.
   */
  system?: ExternalSystem;
  /** The outside organisation's domain, when the writer was not one of us. */
  org?: string;
  /** The writer as the origin system names them, not as Xyne stored them. */
  actor?: { name: string; email?: string };
}

/** The channel a message lives in, as far as this module cares. */
export interface ChannelLike {
  type?: string | null;
  name?: string | null;
}

/** The subset of a message this reads. Structural, so any row shape fits. */
export interface MessageLike {
  msgType?: string | null;
  senderId?: string;
  content?: string;
  metadata?: unknown;
}

type Meta = Record<string, unknown>;

const asMeta = (m: MessageLike): Meta =>
  m.metadata && typeof m.metadata === 'object' ? (m.metadata as Meta) : {};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/**
 * Name a code host from its URL rather than assuming one.
 *
 * This workspace is on Bitbucket, but the same webhook shape carries GitHub
 * URLs elsewhere, and a badge reading "via Bitbucket" over a github.com link is
 * worse than no badge at all.
 */
function codeHost(url?: string): string {
  const s = systemFromUrl(url);
  return s ? `via ${s.name}` : 'via code host';
}

const CHANNEL_SOURCE: Record<string, { id: SourceId; label: string; glyph: string }> = {
  EMAIL: { id: 'email', label: 'via Email', glyph: '✉' },
  SUPPORT: { id: 'email', label: 'via Support', glyph: '✉' },
  SLACK: { id: 'slack', label: 'via Slack', glyph: '#' },
  APP: { id: 'app', label: 'via App', glyph: '◆' },
  CALL: { id: 'call', label: 'via Call', glyph: '◉' },
  SOCIAL_MEDIA: { id: 'social', label: 'via Social', glyph: '◍' },
  SDLC: { id: 'code', label: 'via SDLC', glyph: '⑂' },
};

const XYNE: Source = { id: 'xyne', label: 'via Xyne', glyph: '◇' };

/**
 * Resolve one message to its origin.
 *
 * Ordered most-specific first, and the order is load-bearing: a PR webhook is
 * also a SYSTEM message and also a ticket activity, so testing "is it an
 * activity" first would report the single most interesting row in the thread as
 * generic Xyne machinery.
 *
 * `channel` is optional but changes the answer — pass it whenever you have it.
 * It is the only thing that can tell a slack-desk message from an email, and
 * the only signal the real dashboard trusts for that.
 */
/**
 * Which surface an app id speaks for.
 *
 * Our own entries carry `[app:<id>|kind]` in the body rather than in metadata,
 * because the server drops metadata on write. That marker IS provenance: when
 * the code browser records a pull request, the line did not come from Xyne, it
 * came from GitHub, and badging it "via Xyne" throws away the only interesting
 * thing about it.
 *
 * Only apps that genuinely relay another system appear here. `kanban-board` and
 * `xyne-chat` act on Xyne's own data, so they stay unmapped and fall through to
 * the Xyne badge, which is the truth for them.
 */
const APP_SOURCE: Record<string, { id: SourceId; label: string; glyph: string }> = {
  github: { id: 'code', label: 'via code host', glyph: '\u2442' },
  'xyne-scribe': { id: 'call', label: 'via Call', glyph: '\u25c9' },
  'xyne-desk': { id: 'email', label: 'via Email', glyph: '\u2709' },
};

export function sourceOf(
  m: MessageLike,
  channel?: ChannelLike | null,
  /** The app id from the body marker, when the caller already parsed it. */
  appId?: string | null,
): Source {
  const md = asMeta(m);

  // 1. A code host spoke. The only origin that ships a URL, so the only badge
  //    that can be clicked through to the thing itself.
  if (md.prWebhook === true || md.prUrl || md.prId !== undefined) {
    const url = str(md.prUrl);
    const id = md.prId === undefined ? undefined : String(md.prId);
    const event = str(md.prEvent);
    const detail = [id ? `PR #${id}` : null, event && event !== 'CREATED' ? event.toLowerCase() : null]
      .filter(Boolean)
      .join(' · ');
    const sys = systemFromUrl(url);
    return {
      id: 'code',
      label: codeHost(url),
      glyph: '⑂',
      ...(url ? { href: url } : {}),
      ...(detail ? { detail } : {}),
      ...(sys ? { system: sys } : {}),
    };
  }

  // 2. Ingested from an external system — the pipeline's own stamp, and the
  //    single most important row type in this app.
  //
  //    `externalSource` is an ExternalSource ROW ID, not a readable key. Live
  //    value: "c2b90ef1-235a-48ce-867c-0af1f40bd2cc". An earlier version of this
  //    code title-cased its first segment and rendered "via C2b90ef1" — the
  //    name is not in the message, so it has to come from something that is.
  //    In order of how much it proves:
  //      webUrl        → the origin's own URL, so the origin's own host
  //      slack markers → slack-desk, which writes source:'slack'
  //      author email  → mail; the provider when the address gives it away
  if (str(md.externalSource) || md.externalAuthor || md.webUrl) {
    const web = str(md.webUrl);
    const author = externalAuthor(m);
    const org = counterparty(author?.email) ?? undefined;
    const detail = str(md.ticketNumber)
      ? `case ${str(md.ticketNumber)}`
      : str(md.eventType) === 'chunk_continuation'
        ? undefined // "continued" is layout, not provenance
        : str(md.eventType);

    const sys =
      systemFromUrl(web) ??
      (str(md.source) === 'slack' || md.slackChannelId ? systemById('slack') : null) ??
      systemFromEmail(author?.email);

    const kind: SourceId = sys?.id === 'slack' ? 'slack' : 'email';
    return {
      id: kind,
      label: `via ${sys?.name ?? (kind === 'slack' ? 'Slack' : 'Email')}`,
      glyph: sys?.glyph ?? (kind === 'slack' ? '#' : '✉'),
      ...(web ? { href: web } : {}),
      ...(detail ? { detail } : {}),
      ...(sys ? { system: sys } : {}),
      ...(org ? { org } : {}),
      ...(author ? { actor: { ...author, name: cleanName(author.name) } } : {}),
    };
  }

  // 2b. One of our own surfaces recorded this on another system's behalf. A URL
  //     in the body, if there is one, names the host precisely.
  //
  //     The URL decides the name, for every app and not just the code one: when
  //     the desk surface records an email it writes the Zoho case link, and
  //     "via Email" over a desk.zoho.com URL names a category where the row is
  //     carrying the actual system. Only outside hosts override — a link to a
  //     Xyne canvas leaves the app's own label alone.
  const viaApp = appId ? APP_SOURCE[appId] : undefined;
  if (viaApp) {
    const url = /https?:\/\/\S+/.exec(m.content ?? '')?.[0]?.replace(/[)>,.]+$/, '');
    const sys = systemFromUrl(url);
    const named = sys?.external ? { label: `via ${sys.name}`, glyph: sys.glyph, system: sys } : {};
    return { ...viaApp, ...named, ...(url ? { href: url } : {}) };
  }

  // 3. Arrived by email into a chat channel — the channel-email alias flow,
  //    which is a real message rather than a desk row.
  if (str(md.messageSubtype) === 'channel_email') {
    const subject = str(md.subject);
    return { id: 'email', label: 'via Email', glyph: '✉', ...(subject ? { detail: subject } : {}) };
  }

  // 4. Forwarded from elsewhere in Xyne. The attribution is XML inside the
  //    body — see forwardedFrom() below for the details.
  if (m.msgType === 'FORWARDED') {
    const f = forwardedFrom(m.content ?? '');
    return { ...XYNE, detail: f ? `forwarded from ${f.senderName}` : 'forwarded' };
  }

  // 5. A Xyne automation acted on its own. The nearest thing in this workspace
  //    to an agent waking up without being asked.
  if (md.isAutomation === true || md.releaseStatus || md.releaseTicketId) {
    const rs = str(md.releaseStatus);
    return {
      id: 'automation',
      label: 'via Automation',
      glyph: '⚙',
      ...(rs ? { detail: `release ${rs.toLowerCase()}` } : {}),
    };
  }

  // 6. A call.
  if (md.callId || md.roomLink) {
    const room = str(md.roomLink);
    return { id: 'call', label: 'via Call', glyph: '◉', ...(room ? { href: room } : {}) };
  }

  // 7. The channel itself declares an origin. Last of the specific tests
  //    because it is the coarsest, but still ahead of the fallback — and for a
  //    slack-desk row it is the ONLY correct answer.
  const byChannel = channel?.type ? CHANNEL_SOURCE[channel.type] : undefined;
  if (byChannel) return { ...byChannel };

  // 8. Xyne's own ticket machinery — a stage move, an assignment, an archive.
  if (md.isTicketActivity === true || md.activityType) {
    const at = str(md.activityType);
    return { ...XYNE, ...(at ? { detail: at.replace(/_/g, ' ').toLowerCase() } : {}) };
  }

  // 9. A bot or app posted it here.
  if (m.msgType === 'BOT') {
    const subtype = str(md.messageSubtype);
    return {
      id: 'app',
      label: 'via App',
      glyph: '◆',
      ...(subtype ? { detail: subtype.replace(/_/g, ' ') } : {}),
    };
  }

  // 10. Written here, but about something that lives elsewhere. Xyne unfurls
  //     pasted URLs and keeps the result in `metadata.linkPreview`, so a line
  //     referring to a Zoho case or a pull request can still be followed out.
  //     Only outside hosts qualify: a preview of a Xyne canvas is still Xyne.
  const preview = md.linkPreview;
  if (preview && typeof preview === 'object') {
    const url = str((preview as Meta).url);
    const sys = systemFromUrl(url);
    if (sys?.external && url) {
      return { ...XYNE, label: `mentions ${sys.name}`, glyph: sys.glyph, href: url, system: sys };
    }
  }

  // 11. A person typed it, here, in Xyne.
  return XYNE;
}

/** Forwarded-message attribution, recovered from the XML in the body. */
export interface ForwardedRef {
  senderName: string;
  messageId?: string;
  channelId?: string;
  conversationId?: string;
}

/**
 * Xyne serialises a forward as `<ForwardedMessage><OriginalSenderName>…` inside
 * `content`, because there is no column for it. Parsed with DOMParser rather
 * than a regex so a name containing markup cannot break out of its tag.
 */
export function forwardedFrom(content: string): ForwardedRef | null {
  if (!content.includes('<ForwardedMessage')) return null;
  try {
    const doc = new DOMParser().parseFromString(content, 'text/html');
    const el = doc.querySelector('forwardedmessage, ForwardedMessage');
    if (!el) return null;
    const pick = (tag: string): string | undefined =>
      el.querySelector(tag.toLowerCase())?.textContent?.trim() || undefined;
    const senderName = pick('OriginalSenderName');
    if (!senderName) return null;
    return {
      senderName,
      messageId: pick('OriginalMessageId'),
      channelId: pick('OriginalChannelId'),
      conversationId: pick('OriginalConversationId'),
    };
  } catch {
    return null;
  }
}

/**
 * Is this row machinery rather than conversation?
 *
 * Used to decide what collapses. Deliberately NOT "is it a SYSTEM message": a
 * PR webhook is a SYSTEM message and is one of the most interesting lines in
 * the thread.
 */
export function isRoutine(m: MessageLike): boolean {
  const md = asMeta(m);
  if (str(md.operationType)) return true; // participants joined / left
  if (md.isTicketActivity === true && md.prWebhook !== true) return true;
  return false;
}

/**
 * How the body is encoded.
 *
 * Both appear in the same thread — measured 42 markdown against 14 html across
 * 324 live messages — so treating everything as HTML renders `**bold**` and
 * `[text](url)` to the reader verbatim.
 */
export function contentFormat(m: MessageLike): 'markdown' | 'html' {
  const f = str(asMeta(m).contentFormat);
  if (f === 'markdown' || f === 'html') return f;
  // Unmarked: the composer writes HTML, so markup means HTML, and its absence
  // is safe through the markdown path (plain text is valid markdown).
  return /<[a-z][\s\S]*>/i.test(m.content ?? '') ? 'html' : 'markdown';
}

/**
 * The semantic tags Xyne's classifier already assigned.
 *
 * Arrives as a JSON-encoded array string (`'["QUESTION"]'`), not an array.
 * Observed across this workspace: QUESTION, ANSWER, DECISION, COMMITMENT,
 * RESOLUTION, STATUS_UPDATE.
 *
 * This is NOT provenance — it answers "what kind of thing was said", not "where
 * did it come from" — but it is a legitimate second chip, and it is free.
 */
export function actsOf(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The human behind an ingested message.
 *
 * External messages are sent by a pseudo-bot user (`system-<source>`), so
 * resolving `senderId` through the directory gives you the connector's name
 * rather than the person's. The real author is in the metadata the pipeline
 * stamped.
 */
export function externalAuthor(m: MessageLike): { name: string; email?: string } | null {
  const a = asMeta(m).externalAuthor;
  if (!a || typeof a !== 'object') return null;
  const rec = a as Record<string, unknown>;
  const name = str(rec.name);
  if (!name) return null;
  return { name, ...(str(rec.email) ? { email: str(rec.email) as string } : {}) };
}

/**
 * An actionable button a bot offered in the thread.
 *
 * Bots post YAML frontmatter ahead of the body — this is Xyne's own mechanism,
 * already in use by the PR-check app:
 *
 *   ---
 *   appActions:
 *   - actionId: "27b57ca6-…"
 *     label: "Run PR Check"
 *     type: "button"
 *     actionableUrl: "https://…/api/apps/pr-check/callback"
 *     context:
 *       ticketId: "…"
 *   ---
 */
export interface AppAction {
  actionId: string;
  label: string;
  type?: string;
  color?: string;
  actionableUrl?: string;
  context?: Record<string, string>;
}

export interface ParsedBody {
  actions: AppAction[];
  /** The body with the frontmatter removed. */
  body: string;
}

/**
 * Split a message body into its actions and its prose.
 *
 * Hand-parsed rather than pulled from a YAML library: the block is a fixed
 * two-level shape emitted by one service, and a parser is a large fraction of
 * the 64 KB a published file may be. Anything unrecognised is left in the body,
 * so a shape we do not understand degrades to visible text rather than
 * vanishing silently.
 */
export function parseBody(content: string): ParsedBody {
  if (!content.startsWith('---')) return { actions: [], body: content };
  const end = content.indexOf('\n---', 3);
  if (end === -1) return { actions: [], body: content };

  const front = content.slice(3, end);
  const rest = content.slice(end + 4).replace(/^\s*\n/, '');
  if (!/^\s*appActions:/m.test(front)) return { actions: [], body: content };

  const actions: AppAction[] = [];
  let current: Partial<AppAction> = {};
  let inContext = false;
  const unquote = (v: string): string => v.trim().replace(/^["']|["']$/g, '');
  const close = (): void => {
    if (current.actionId && current.label) actions.push(current as AppAction);
  };

  for (const line of front.split('\n')) {
    if (/^\s*appActions:\s*$/.test(line)) continue;

    const item = /^\s*-\s+(\w+):\s*(.*)$/.exec(line);
    if (item) {
      close();
      current = {};
      inContext = false;
      (current as Record<string, unknown>)[item[1]] = unquote(item[2]);
      continue;
    }

    const pair = /^(\s*)(\w+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const [, indent, key, value] = pair;
    if (key === 'context' && !value.trim()) {
      inContext = true;
      current.context = {};
      continue;
    }
    // The context block is indented one level deeper than the item's own keys.
    if (inContext && indent.length >= 4) {
      (current.context ??= {})[key] = unquote(value);
    } else {
      inContext = false;
      (current as Record<string, unknown>)[key] = unquote(value);
    }
  }
  close();

  return { actions, body: actions.length ? rest : content };
}
