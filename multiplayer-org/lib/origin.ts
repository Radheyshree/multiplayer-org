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
