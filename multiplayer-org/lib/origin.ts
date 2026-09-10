

/* ---- from lib/origin.ts ----------------------------------------------- */
/**
 * The way back out.
 *
 * Xyne already receives work from outside itself — Zoho Desk, Gmail, Outlook,
 * Slack, Bitbucket, GitHub, Ozonetel — through the adapters in
 * `apps/backend/src/integrations/adapters`. What it does not do is keep the
 * origin visible: by the time a Zoho ticket reaches a thread it is a Xyne
 * message written by a pseudo-user, and the fact that a person at another
 * company typed it in a completely different product is nowhere on screen.
 *
 * That is the whole difference this app is trying to make, so this module
 * exists to answer two questions about any row:
 *
 *   1. WHICH SYSTEM did this actually come from — not "email", but Zoho Desk.
 *   2. HOW DO I GET BACK THERE — a URL that opens the thing where it lives.
 *
 * WHAT IS ACTUALLY AVAILABLE. Verified against live rows in this workspace,
 * not inferred from types:
 *
 *   metadata.webUrl      "https://desk.zoho.com/support/juspay4/ShowHomePage.do#Cases/dv/458844000296724111"
 *   metadata.ticketNumber "784736"
 *   metadata.prUrl       "https://bitbucket.juspay.net/projects/XYNE/repos/xyne-spaces/pull-requests/3485"
 *   metadata.canvasUrl   "https://spaces.xyne.juspay.net/chat/canvas/…"
 *   metadata.linkPreview { url: … }
 *   metadata.externalAuthor { name: '"PG Support"', email: "pgsupport@billdesk.com" }
 *   Email.externalThreadId / externalMessageId — the provider's own ids
 *
 * So the deep link back into Zoho is already on the row and always has been.
 * An earlier draft of LINKING.md said the origin was dropped by the result
 * transformer; that is true of `search.query` — `transformMail` and
 * `transformMessage` return ids and no permalink — and false of the message
 * path, which is the one that matters. Reading `metadata.webUrl` needs no
 * change to the SDK and no change to the backend.
 *
 * WHAT WE WILL NOT DO. Reconstruct a URL we cannot verify. Gmail and Slack both
 * have well-known permalink shapes and we hold the ids they need, but a Gmail
 * link needs the right authuser and a Slack link needs the workspace domain —
 * neither is on the row. Those are offered only when the caller supplies the
 * missing piece (see `configureOrigins`), and are absent otherwise. A badge
 * that says "↗" and then 404s is worse than a badge that does not.
 */

/** The systems a row can genuinely have come from. */
export type SystemId =
  | 'zoho'
  | 'gmail'
  | 'outlook'
  | 'slack'
  | 'bitbucket'
  | 'github'
  | 'gitlab'
  | 'ozonetel'
  | 'playstore'
  | 'xyne'
  | 'web';

export interface ExternalSystem {
  id: SystemId;
  /** What a person calls it — "Zoho Desk", not "zoho". */
  name: string;
  glyph: string;
  /** False for Xyne itself; true for everything that lives elsewhere. */
  external: boolean;
}

const SYSTEMS: Record<SystemId, ExternalSystem> = {
  zoho: { id: 'zoho', name: 'Zoho Desk', glyph: '✉', external: true },
  gmail: { id: 'gmail', name: 'Gmail', glyph: '✉', external: true },
  outlook: { id: 'outlook', name: 'Outlook', glyph: '✉', external: true },
  slack: { id: 'slack', name: 'Slack', glyph: '#', external: true },
  bitbucket: { id: 'bitbucket', name: 'Bitbucket', glyph: '⑂', external: true },
  github: { id: 'github', name: 'GitHub', glyph: '⑂', external: true },
  gitlab: { id: 'gitlab', name: 'GitLab', glyph: '⑂', external: true },
  ozonetel: { id: 'ozonetel', name: 'Ozonetel', glyph: '◉', external: true },
  playstore: { id: 'playstore', name: 'Play Store', glyph: '◍', external: true },
  xyne: { id: 'xyne', name: 'Xyne', glyph: '◇', external: false },
  web: { id: 'web', name: 'the web', glyph: '↗', external: true },
};

export const system = (id: SystemId): ExternalSystem => SYSTEMS[id];

/**
 * Deployment facts this module cannot derive from a row.
 *
 * `homeDomains` decides who counts as "us" — with it, `pgsupport@billdesk.com`
 * is a counterparty and `support@juspay.in` is not. It is seeded from the
 * signed-in user's own address rather than hardcoded, so this works in any
 * workspace.
 */
interface OriginConfig {
  homeDomains: Set<string>;
  /** e.g. `juspay` for `juspay.slack.com`. Unset until someone supplies it. */
  slackTeam?: string;
  /** Gmail account index, for `mail.google.com/mail/u/<n>`. */
  gmailUser?: number;
  /** Everything in a Zoho case URL before the id. Learned, never assumed. */
  zohoPrefix?: string;
}

const config: OriginConfig = { homeDomains: new Set() };

/** Teach this module about the deployment. Safe to call repeatedly. */
export function configureOrigins(opts: {
  myEmail?: string | null;
  slackTeam?: string | null;
  gmailUser?: number | null;
}): void {
  const domain = opts.myEmail?.split('@')[1]?.toLowerCase();
  if (domain) config.homeDomains.add(domain);
  if (opts.slackTeam) config.slackTeam = opts.slackTeam;
  if (typeof opts.gmailUser === 'number') config.gmailUser = opts.gmailUser;
}

/** Public-mailbox domains. A person at one of these speaks for nobody. */
const CONSUMER_MAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
  'rediffmail.com',
]);

/** Local parts that mean "a mail server is talking", not "a person is". */
const BOUNCE_SENDERS = new Set(['mailer-daemon', 'postmaster', 'bounce', 'bounces']);

/**
 * Is this address a mail server reporting on delivery?
 *
 * Used for more than the badge: a reply must never be addressed to the daemon
 * that told you the last one failed.
 */
export const isBounce = (address: string | undefined | null): boolean =>
  BOUNCE_SENDERS.has((address ?? '').toLowerCase().split('@')[0] ?? '');

/**
 * Name the system behind a URL.
 *
 * Host-based rather than assumed. This workspace's PRs are on Bitbucket, but
 * the same webhook shape carries GitHub URLs elsewhere, and a chip reading
 * "Bitbucket" over a github.com link is worse than no chip at all.
 */
export function systemFromUrl(url: string | undefined | null): ExternalSystem | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.endsWith('zoho.com') || host.endsWith('zoho.in')) return SYSTEMS.zoho;
  if (host === 'mail.google.com') return SYSTEMS.gmail;
  if (host.endsWith('outlook.com') || host.endsWith('outlook.office.com')) return SYSTEMS.outlook;
  if (host.endsWith('slack.com')) return SYSTEMS.slack;
  if (host.includes('bitbucket')) return SYSTEMS.bitbucket;
  if (host.endsWith('github.com')) return SYSTEMS.github;
  if (host.includes('gitlab')) return SYSTEMS.gitlab;
  if (host.includes('ozonetel')) return SYSTEMS.ozonetel;
  if (host === 'play.google.com') return SYSTEMS.playstore;
  if (host.includes('xyne')) return SYSTEMS.xyne;
  // A real host we have no name for. Say the host — it is more use than "web".
  return { ...SYSTEMS.web, name: host.replace(/^www\./, '') };
}

/** The mail provider behind an address, where the address gives it away. */
export function systemFromEmail(address: string | undefined | null): ExternalSystem | null {
  const domain = address?.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  if (domain === 'gmail.com' || domain === 'googlemail.com') return SYSTEMS.gmail;
  if (domain === 'outlook.com' || domain === 'hotmail.com' || domain === 'live.com') {
    return SYSTEMS.outlook;
  }
  return null;
}

/**
 * The organisation on the other side of a message.
 *
 * Returns the bare domain — `billdesk.com` — rather than a prettified brand.
 * Title-casing it would produce "Billdesk", which is not how they write it, and
 * every such guess is a small lie on screen about a real company. `null` when
 * the address is ours, is a consumer mailbox, or is missing.
 */
export function counterparty(address: string | undefined | null): string | null {
  const [local, domain] = (address ?? '').toLowerCase().split('@');
  if (!domain) return null;
  if (config.homeDomains.has(domain)) return null;
  if (CONSUMER_MAIL.has(domain)) return null;
  // Bounce machinery, not a company. Live rows in this workspace carry
  // `MAILER-DAEMON <mailer-daemon@eu-west-1.amazonses.com>`; badging that as an
  // organisation puts "eu-west-1.amazonses.com" on screen beside BillDesk as
  // though the two were the same kind of thing.
  if (BOUNCE_SENDERS.has(local)) return null;
  return domain;
}

/** Is this address outside the workspace's own organisation? */
export function isOutside(address: string | undefined | null): boolean {
  const domain = address?.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  return !config.homeDomains.has(domain);
}

/**
 * A Slack permalink, if we know the workspace.
 *
 * Slack's shape is `/archives/<channel>/p<ts without the dot>`; the ids are on
 * the row (`metadata.slackChannelId`, and the message's external id IS the ts)
 * but the team subdomain is not, so this returns null until told.
 */
export function slackPermalink(channelId?: string, ts?: string): string | null {
  if (!config.slackTeam || !channelId || !ts) return null;
  return `https://${config.slackTeam}.slack.com/archives/${channelId}/p${ts.replace('.', '')}`;
}

/**
 * Which mail system an external thread id came from.
 *
 * The three mail adapters wired into this workspace mint visibly different
 * ids, so the shape is evidence rather than a guess:
 *
 *   Zoho Desk  458844000296755555   18–19 digits, the Zoho ticket id
 *   Gmail      18c4f2a91b3d0e77      hex, 16ish
 *   Outlook    AAMkAGI2…             base64-ish, starts AAMk
 *
 * Returns null when the shape says nothing — better an unlabelled row than a
 * confident wrong label.
 */
export function mailProviderOf(externalThreadId?: string | null): ExternalSystem | null {
  const id = externalThreadId?.trim();
  if (!id) return null;
  if (/^\d{15,20}$/.test(id)) return SYSTEMS.zoho;
  if (/^AAMk/.test(id)) return SYSTEMS.outlook;
  if (/^[0-9a-f]{12,20}$/i.test(id)) return SYSTEMS.gmail;
  return null;
}

/**
 * Teach this module how this deployment's Zoho URLs are shaped.
 *
 * Called with a `metadata.webUrl` seen on a real message. Zoho's desk URL ends
 * in the ticket id — live example:
 *
 *   https://desk.zoho.com/support/juspay4/ShowHomePage.do#Cases/dv/458844000296724111
 *
 * and `Email.externalThreadId` holds that same id: the adapter's `getThreadId`
 * returns `payload.ticketId ?? payload.id`, and `webUrl` is a sibling field on
 * that same Zoho ticket (`zoho/transformer.ts:60-92`). So one observed URL
 * yields a correct link for every other Zoho email in the workspace.
 *
 * The portal segment (`juspay4`) is LEARNED, never hardcoded. Until a real URL
 * has been seen, `zohoTicketUrl` returns null and rows are labelled without a
 * link — which is the right failure: this app does not manufacture URLs.
 *
 * Returns true when this call is what taught it, so the caller can persist the
 * URL for every future session (see mailthread.ts).
 */
export function learnZohoTemplate(webUrl: string | undefined | null): boolean {
  if (!webUrl || config.zohoPrefix) return false;
  const at = webUrl.lastIndexOf('/dv/');
  if (at === -1) return false;
  const prefix = webUrl.slice(0, at + 4);
  if (systemFromUrl(prefix)?.id !== 'zoho') return false;
  config.zohoPrefix = prefix;
  return true;
}

/** The Zoho case URL for a ticket id, once a real one has been seen. */
export function zohoTicketUrl(externalThreadId?: string | null): string | null {
  if (!config.zohoPrefix || !externalThreadId) return null;
  if (!/^\d{15,20}$/.test(externalThreadId)) return null;
  return config.zohoPrefix + externalThreadId;
}

/**
 * A Gmail thread link, if we know which account.
 *
 * `Email.externalThreadId` is the provider's thread id. For Gmail that opens
 * directly; for Zoho the same field holds an 18-digit case id, which is why
 * this checks the shape before offering a link.
 */
export function gmailThreadUrl(externalThreadId?: string): string | null {
  if (config.gmailUser === undefined || !externalThreadId) return null;
  if (!/^[0-9a-f]{8,}$/i.test(externalThreadId)) return null; // Gmail ids are hex
  return `https://mail.google.com/mail/u/${config.gmailUser}/#all/${externalThreadId}`;
}

/** Strip Zoho's quoting from an author name: `"PG Support"` → `PG Support`. */
export function cleanName(name: string | undefined | null): string {
  return (name ?? '').trim().replace(/^["']|["']$/g, '').trim();
}

/**
 * Everything worth saying about where one row came from.
 *
 * `href` is present only when a real URL was on the row or could be built from
 * ids plus configuration — never guessed.
 */
export interface Origin {
  system: ExternalSystem;
  href?: string;
  /** The person, as the origin system names them. */
  actor?: { name: string; email?: string };
  /** Their organisation's domain, when they are not one of us. */
  org?: string;
  /** A qualifier: "PR #3485", "case 784736". */
  detail?: string;
}

/* ---- from lib/provenance.ts ------------------------------------------- */
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
      (str(md.source) === 'slack' || md.slackChannelId ? system('slack') : null) ??
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
  // Anything this app wrote is markdown by construction — `tagUpdate` builds it
  // — and saying so beats sniffing our own output. Without this, a mirrored
  // email quoting `<someone@example.com>` was read as HTML and its **bold** and
  // [links](…) rendered to the reader verbatim.
  if (/^<!--\s*app:/i.test(m.content ?? '') || /^\[app:/i.test(m.content ?? '')) return 'markdown';
  // Unmarked: the composer writes HTML, so real markup means HTML. The pattern
  // requires a plausible TAG — `<p>`, `</div>`, `<a href=…>` — because the loose
  // version treated any angle-bracketed address as markup.
  return /<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?>/i.test(m.content ?? '') ? 'html' : 'markdown';
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

/* ---- from lib/appUpdate.ts -------------------------------------------- */
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
