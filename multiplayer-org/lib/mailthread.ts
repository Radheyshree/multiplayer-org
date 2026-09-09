/**
 * The email side of a ticket.
 *
 * A support ticket in Xyne is not a conversation that happens to mention email
 * — it IS an email thread, ingested. The thread the ledger renders shows the
 * bodies, but three facts that only exist on the `Email` rows never reach the
 * screen, and they are the ones that make a ticket legible:
 *
 *   WHO ELSE IS ON IT.  `to` and `cc` are recipient lists, often a dozen
 *   addresses across two or three companies. The message body says none of this.
 *
 *   WHICH SYSTEM IT CAME THROUGH.  `externalThreadId` is the provider's own id,
 *   and the three mail adapters wired into this workspace mint visibly
 *   different ids — see `mailProviderOf`.
 *
 *   WHERE IT LIVES.  That same id is the Zoho case id, so once a real Zoho URL
 *   has been observed anywhere in the workspace, every email on every ticket
 *   gets a working link back into Zoho.
 *
 * One read per ticket (`email.listForConversations`), and it is the read that
 * turns "a support ticket" into "three companies, eleven people, in Zoho".
 */
import { storage, storageReady, xyne } from './xyne';
import {
  counterparty,
  isOutside,
  learnZohoTemplate,
  mailProviderOf,
  zohoTicketUrl,
  type ExternalSystem,
} from './origin';

export interface MailParticipant {
  address: string;
  /** Their organisation's domain, when they are not one of us. */
  org?: string;
  /** True when they sent at least one message rather than only receiving. */
  wrote: boolean;
}

export interface MailThread {
  /** How many emails are on this ticket. */
  count: number;
  /** The system they arrived through, where the ids say so. */
  provider?: ExternalSystem;
  /** A link back to the case, when one can be built from something observed. */
  href?: string;
  /** Everyone on the thread, senders first, ours last. */
  participants: MailParticipant[];
  /** Distinct outside organisations, in first-seen order. */
  orgs: string[];
  /** The provider's own thread id, for the record. */
  externalThreadId?: string;
  subject?: string;
}

type EmailRow = {
  from?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  externalThreadId?: string;
  createdAt?: number;
};

/**
 * Read the email thread behind a ticket.
 *
 * Returns null rather than an empty shape when the ticket has no mail — most
 * tickets do not, and the caller should render nothing rather than "0 emails".
 */
export async function loadMailThread(item: {
  conversationId?: string;
  channelId?: string;
}): Promise<MailThread | null> {
  if (!item.conversationId || !item.channelId) return null;
  let rows: EmailRow[];
  try {
    const { spaces } = await xyne();
    rows = (await spaces.email.listForConversations(
      [item.conversationId],
      item.channelId,
    )) as unknown as EmailRow[];
  } catch {
    // A ticket on a work channel is not a desk ticket; the server says so with
    // an error, and "this ticket has no mail" is the correct reading of that.
    return null;
  }
  if (!Array.isArray(rows) || rows.length === 0) return null;

  // Senders before recipients: the people who actually wrote are the ones worth
  // seeing first, and a 20-address cc list would otherwise bury them.
  const wrote = new Set<string>();
  const seen = new Map<string, MailParticipant>();
  const add = (raw: string | undefined, sent: boolean): void => {
    const address = normalise(raw);
    if (!address) return;
    if (sent) wrote.add(address);
    const existing = seen.get(address);
    if (existing) {
      existing.wrote ||= sent;
      return;
    }
    const org = counterparty(address);
    seen.set(address, { address, wrote: sent, ...(org ? { org } : {}) });
  };

  let externalThreadId: string | undefined;
  let subject: string | undefined;
  for (const row of rows) {
    add(row.from, true);
    for (const to of row.to ?? []) add(to, false);
    for (const cc of row.cc ?? []) add(cc, false);
    externalThreadId ??= row.externalThreadId;
    if (!subject && row.subject) subject = row.subject;
  }

  const participants = [...seen.values()].sort(
    (a, b) =>
      Number(b.wrote) - Number(a.wrote) ||
      Number(isOutside(b.address)) - Number(isOutside(a.address)) ||
      a.address.localeCompare(b.address),
  );

  const provider = mailProviderOf(externalThreadId);
  const href = provider?.id === 'zoho' ? zohoTicketUrl(externalThreadId) : null;

  return {
    count: rows.length,
    ...(provider ? { provider } : {}),
    ...(href ? { href } : {}),
    participants,
    orgs: [...new Set(participants.flatMap(p => (p.org ? [p.org] : [])))],
    ...(externalThreadId ? { externalThreadId } : {}),
    ...(subject ? { subject } : {}),
  };
}

/**
 * Strip a display name off an address.
 *
 * Rows arrive as `'PG Support' via Credit Support <pgsupport@billdesk.com>` as
 * often as a bare address, and comparing the two forms as strings would list
 * the same person twice.
 */
function normalise(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const angle = /<([^>]+)>/.exec(raw);
  const value = (angle?.[1] ?? raw).trim().toLowerCase();
  return value.includes('@') ? value : undefined;
}

/**
 * Feed every Zoho URL in a thread to the origin module.
 *
 * Cheap and idempotent — it keeps the first real one it sees. Called before
 * rendering so that a ticket carrying a `webUrl` anywhere teaches the app how
 * to link every OTHER ticket's mail back to Zoho.
 */
export function learnFrom(messages: Array<{ metadata?: unknown }>): void {
  for (const m of messages) {
    const md = m.metadata;
    if (!md || typeof md !== 'object') continue;
    const url = (md as Record<string, unknown>).webUrl;
    if (typeof url === 'string' && learnZohoTemplate(url)) void remember(url);
  }
}

/**
 * Remember the Zoho URL shape for everyone, permanently.
 *
 * `webUrl` is on roughly one message in a hundred — three of the 293 sampled
 * while building this — so learning it per session would mean the link almost
 * never appears. It only has to be observed ONCE: the portal segment is a
 * property of the workspace, not of the ticket.
 *
 * Global scope, so the first person to open a ticket carrying a Zoho URL
 * unlocks the link for every other person using this app. Failures are
 * swallowed on purpose: not remembering costs a link, and nothing else.
 */
const CONFIG = 'multiplayer-origins';
const ZOHO_KEY = 'zoho-web-url';

async function remember(webUrl: string): Promise<void> {
  if (!storageReady) return;
  try {
    await storage
      .collection<{ webUrl: string }>(CONFIG)
      .put(ZOHO_KEY, { webUrl }, { scope: 'global' });
  } catch {
    /* a cached link is a nicety, never a requirement */
  }
}

/** Load what a previous session learned. Called once, at boot. */
export async function recallOrigins(): Promise<void> {
  if (!storageReady) return;
  try {
    const rec = await storage
      .collection<{ webUrl: string }>(CONFIG)
      .get(ZOHO_KEY, { scope: 'global' });
    // The storage SDK answers { key, scope, value, createdAt, updatedAt } — the
    // record wraps the payload, so `value` is where what we stored actually is.
    const url = (rec as { value?: { webUrl?: string } } | null)?.value?.webUrl;
    if (url) learnZohoTemplate(url);
  } catch {
    /* nothing learned yet is the normal first-run state */
  }
}
