/**
 * The mail bridge: a code host's email, and the ticket the work actually lives on.
 *
 * THE PROBLEM, in one real pair of rows from this workspace.
 *
 * Bitbucket emails you when something happens on a pull request. That mail lands
 * in a Desk channel and Xyne turns it into a ticket of its own:
 *
 *   XYNE-63043  "XYNE/xyne-spaces - Pull request #9604: feat: XYNE-63024 …"
 *               from  Juspay Bitbucket <bitbucket-no-reply@juspay.email>
 *               body  …/projects/XYNE/repos/xyne-spaces/pull-requests/9604
 *
 * And the work that pull request is FOR has its own ticket, XYNE-63024, on a
 * different board in a different channel. Two tickets, same piece of work, and
 * nothing joining them. Open either one and half the story is missing: the work
 * ticket never hears that the PR got a comment, and the mail ticket is a dead
 * end that nobody will ever look at twice.
 *
 * WHAT JOINS THEM IS ALREADY IN THE MAIL. The subject names the repository and
 * the PR number, the PR title contains the work ticket's key, and the body
 * carries the PR's URL. So the link does not have to be declared by a person —
 * it can be read off the row. That is the whole idea here: not "let the user
 * link two tickets" but "notice that they are already the same thing".
 *
 * WHAT THIS DOES
 *
 *   1. Reads a desk ticket's mail and decides whether it is a code-host
 *      notification, and which work ticket it is about.  (`readNotification`)
 *   2. Links the two, both as a real `ticket_references` edge Xyne itself
 *      renders and as a line in each thread.               (`bridge`)
 *   3. Mirrors every email on the desk ticket into the work ticket's
 *      conversation, badged and clickable, exactly once.   (`syncMail`)
 *   4. Sends a reply on the mail thread from the work ticket, and mirrors that
 *      reply straight back.                                (`replyByEmail`)
 *
 * WHY MIRRORING RATHER THAN A JOIN VIEW. The work ticket's conversation is the
 * one place every surface writes (see lib/appUpdate.ts). A joined view would be
 * ours alone; a mirrored message is visible in Xyne itself, is read by any agent
 * asked about the ticket, and outlives this app.
 *
 * IDEMPOTENCY IS THE WHOLE DIFFICULTY. Sync runs every time a ticket is opened.
 * Each mirrored line carries the email's `externalMessageId` in its marker
 * (`[app:xyne-desk|note|mail:1a084adf0b1a066c]`), so "already copied" is an
 * exact-match question rather than a guess about subjects and timestamps.
 */
import { xyne } from './xyne';
import { parseUpdate, tagUpdate } from './appUpdate';
import { counterparty, isBounce, systemFromUrl, type ExternalSystem } from './origin';

/**
 * How an email came to be about a ticket.
 *
 * `notification` — a robot announced a repository event. Strong signal: the
 *   sender is a known robot AND the mail carries a pull-request URL, so both the
 *   subject that names the ticket and the link back out are machine-generated.
 *
 * `mention` — a person wrote an email and named a ticket in it. Weaker by
 *   construction: there is no URL, no robot, and no schema — only a string that
 *   looks like a key. Everything that makes this safe is in `readMailLink`.
 */
export type LinkKind = 'notification' | 'mention';

/** What an email turned out to be about. */
export interface MailLink {
  kind: LinkKind;
  /** Bitbucket, GitHub, … — named from the URL in the body, never assumed. */
  system?: ExternalSystem;
  /** `XYNE/xyne-spaces`, `juspay/xyne-spaces`. */
  repo?: string;
  prNumber?: number;
  prUrl?: string;
  /** Work-ticket keys named in the mail, most likely first. */
  ticketKeys: string[];
  /**
   * Where the keys were found. `subject` is somebody putting a key on a mail on
   * purpose; `body` is a key that happened to appear in the text, which on a
   * real inbox is mostly quoted digests and identifiers that merely look alike.
   */
  where: 'subject' | 'body';
}

/** @deprecated The notification-shaped subset. Kept so old call sites read the same. */
export type Notification = MailLink;

/**
 * Enough to re-read a desk thread later, with no index and no extra lookups.
 *
 * Both ids are needed because `email.listForConversations` takes the pair, and
 * both are cuids — lowercase alphanumeric — so they survive the marker's
 * character set and can live in the bridge line's ref. That is what makes a
 * bridged thread SELF-DESCRIBING: sync can run from the work ticket's own
 * messages, without rebuilding the discovery index first.
 */
export interface DeskRef {
  conversationId: string;
  channelId: string;
}

/** The two ends of a bridge. */
export interface Bridge {
  desk: DeskRef & { id: string; xyneId?: string; title?: string };
  work: { id: string; xyneId?: string; conversationId: string; channelId?: string; title?: string };
  notification: Notification;
}

/** A desk ticket that turned out to be a code-host notification. */
export interface Candidate {
  desk: Bridge['desk'];
  notification: Notification;
  /** When the most recent mail on it arrived. */
  at: number;
}

/**
 * Senders that are a robot announcing a repository event, not a person.
 *
 * Also used to suppress the counterparty chip: `bitbucket-no-reply@juspay.email`
 * is on a different domain from the workspace, so `counterparty()` correctly
 * calls it an outside organisation — but rendering "juspay.email" beside
 * billdesk.com implies a company is involved in this ticket when what is
 * involved is a mail server.
 */
const ROBOTS = [
  /bitbucket[-.]?no-?reply@/i,
  /@juspay\.email$/i,
  /notifications@github\.com$/i,
  /noreply@github\.com$/i,
  /gitlab@/i,
];

/**
 * A ticket key: two-or-more uppercase letters, a dash, digits.
 *
 * Anchored on both sides so `CVE-2024` inside a sentence still matches (it does,
 * and it must be filtered out later — see `readNotification`) while a version
 * string like `v2-1` does not.
 */
const TICKET_KEY = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,7})\b/g;

/**
 * Keys that look like ticket keys and are not.
 *
 * `CVE-2024` appears three times in the body of the very email this was built
 * for, inside Bitbucket's own "JIRA Ticket Usage" block. Linking a ticket to a
 * CVE number would be a confident, visible, wrong answer.
 */
const NOT_A_TICKET = /^(CVE|RFC|ISO|UTF|SHA|MD|HTTP|IPV)$/i;

/** Is this sender a notification robot rather than a person? */
export const isRobot = (from: string | undefined): boolean =>
  ROBOTS.some(r => r.test(from ?? ''));

const codeUrl = (text: string): string | undefined =>
  /https?:\/\/[^\s"'<>)]+\/(?:pull-requests|pull|merge_requests)\/\d+/i.exec(text)?.[0];

/**
 * Read a code-host notification out of an email.
 *
 * Returns null when the mail is not one — most of a personal inbox is
 * newsletters, and this must decline the vast majority of what it sees.
 *
 * `selfKey` is the desk ticket's OWN key, which is excluded: the mail is about
 * some other ticket, never about the row Xyne minted for the mail itself.
 */
export function readNotification(
  mail: { subject?: string; body?: string; from?: string },
  selfKey?: string,
): Notification | null {
  const from = mail.from ?? '';
  const subject = mail.subject ?? '';
  const body = mail.body ?? '';
  if (!isRobot(from)) return null;

  const prUrl = codeUrl(body) ?? codeUrl(subject);
  const system = systemFromUrl(prUrl);
  // No URL means no host, and a badge with no way back is exactly what this app
  // exists to stop shipping. Decline rather than guess from the sender domain.
  if (!prUrl || !system) return null;

  // Bitbucket: "XYNE/xyne-spaces - Pull request #9604: feat: XYNE-63024 …"
  // GitHub:    "[juspay/xyne-spaces] fix: … (PR #1624)"
  const bb = /^([\w.-]+\/[\w.-]+)\s+-\s+Pull request #(\d+)/i.exec(subject);
  const gh = /^(?:Re:\s*)?\[([\w.-]+\/[\w.-]+)\]/i.exec(subject);
  const repo = bb?.[1] ?? gh?.[1];
  const prNumber =
    Number(bb?.[2]) ||
    Number(/\/(?:pull-requests|pull|merge_requests)\/(\d+)/.exec(prUrl)?.[1]) ||
    undefined;

  // Keys from the SUBJECT first: the PR title lives there, and the key in a PR
  // title is the one the author deliberately put on this piece of work. Body
  // keys are a fallback and are far noisier.
  const ticketKeys = [...keysIn(subject), ...keysIn(body)].filter(
    (k, i, all) => all.indexOf(k) === i && k !== selfKey,
  );

  return {
    kind: 'notification',
    system,
    prUrl,
    ...(repo ? { repo } : {}),
    ...(prNumber ? { prNumber } : {}),
    ticketKeys,
    where: keysIn(subject).length ? 'subject' : 'body',
  };
}

/**
 * Read any link between an email and a ticket — robot notification or not.
 *
 * The notification path (above) is the strong one: a known robot, a
 * pull-request URL, and a machine-generated subject. This is the weak one, and
 * the question is how to make "an email that names a ticket" safe when the only
 * evidence is a string that looks like a key.
 *
 * THE SUBJECT ONLY. A key in a subject line is somebody putting it there on
 * purpose. A key in a body is usually not: on a real seven-day inbox the bodies
 * are newsletters, build digests and footers full of identifiers shaped exactly
 * like ticket keys, and the mail this whole feature was built for contains
 * `CVE-2024` three times in Bitbucket's own boilerplate.
 *
 * AND THE MATCH RUNS THE OTHER WAY. This does not resolve the keys it finds —
 * `candidatesFor` compares them against the key of the ticket you have OPEN.
 * That inverts the risk: a spurious key only ever surfaces if it is character-
 * for-character the ticket you are looking at, so a stray `WFH-2026` in some
 * subject line can only appear on a ticket called WFH-2026. It also costs
 * nothing — no lookup per candidate, no resolution pass over the whole desk.
 *
 * What is deliberately NOT required: that the sender be a colleague. A vendor
 * putting your ticket key in a subject is exactly the cross-company case this
 * app exists for, and a same-domain rule would throw it away.
 */
export function readMailLink(
  mail: { subject?: string; body?: string; from?: string },
  selfKey?: string,
): MailLink | null {
  const notification = readNotification(mail, selfKey);
  if (notification) return notification;

  const keys = keysIn(mail.subject ?? '').filter((k, i, all) => all.indexOf(k) === i && k !== selfKey);
  if (keys.length === 0) return null;
  return { kind: 'mention', ticketKeys: keys, where: 'subject' };
}

function keysIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TICKET_KEY)) {
    if (NOT_A_TICKET.test(m[1])) continue;
    out.push(`${m[1]}-${m[2]}`);
  }
  return out;
}

/**
 * How a mirrored mail reads in the thread.
 *
 * Shaped for scanning, not for completeness. The badge on the row already says
 * "via Bitbucket", so repeating the host in prose is noise; the subject is the
 * thing a reader is looking for, so it goes first and alone.
 *
 * The URL is a markdown LINK rather than bare text. A Bitbucket pull-request URL
 * is 78 characters and wraps to three lines at this width — printed raw it was
 * the largest thing on the row, and it said less than the four words that now
 * replace it.
 */
export function describeMail(
  mail: { from?: string; subject?: string; body?: string; sentByUserId?: string },
  n: Notification | null,
): string {
  const who = address(mail.from) ?? 'unknown sender';
  const org = isRobot(mail.from) ? null : counterparty(who);
  const attribution = mail.sentByUserId ? 'sent by you' : `from ${who}${org ? ` (${org})` : ''}`;
  const link =
    n?.prUrl && n.prNumber && n.system
      ? `[${n.system.name} PR #${n.prNumber}](${n.prUrl})`
      : n?.prUrl && n.system
        ? `[${n.system.name}](${n.prUrl})`
        : '';
  const snippet = summarise(mail.body ?? '');
  return [
    `**${mail.subject ?? '(no subject)'}**`,
    `\n${attribution}${link ? ` · ${link}` : ''}`,
    snippet ? `\n\n> ${snippet}` : '',
  ].join('');
}

/** Bare address out of `Name <a@b>`. */
function address(raw?: string): string | undefined {
  if (!raw) return undefined;
  const m = /<([^>]+)>/.exec(raw);
  const v = (m?.[1] ?? raw).trim().toLowerCase();
  return v.includes('@') ? v : undefined;
}

/**
 * The first readable sentence or two of a mail body.
 *
 * Notification mail is mostly layout — "1 Comment&nbsp; OPEN BRANCHES … Review
 * Now" — so this strips tags and entities and then takes a short window. It is a
 * quote in the thread, not the mail itself: the ↗ goes to the real thing.
 */
export function summarise(html: string, max = 220): string {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;?/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    // Decoding entities can hand back angle brackets that were never markup:
    // a quoted reply carries `&lt;someone@example.com&gt;`, and once decoded it
    // looks exactly like a tag to anything that sniffs for one. The quote is
    // plain text; brackets carry nothing in it.
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return `${cut.slice(0, stop > max * 0.6 ? stop : max)}…`;
}

type EmailRow = {
  id?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  body?: string;
  externalMessageId?: string;
  externalThreadId?: string;
  sentByUserId?: string;
  createdAt?: number;
};

/** `mail:<provider message id>` — the marker ref a mirrored line carries. */
const refFor = (mail: EmailRow): string | null =>
  mail.externalMessageId ? `mail:${mail.externalMessageId.toLowerCase()}` : null;

/**
 * Which mails a conversation has already mirrored.
 *
 * Reads the refs off its own past entries. This is why the marker gained a third
 * field: without it the only options are re-copying everything or guessing.
 */
export function mirroredRefs(messages: Array<{ content?: string }>): Set<string> {
  const seen = new Set<string>();
  for (const m of messages) {
    const ref = parseUpdate(m.content ?? '').ref;
    if (ref?.startsWith('mail:')) seen.add(ref);
  }
  return seen;
}

export interface SyncResult {
  /** Emails copied on this run. */
  copied: number;
  /** Emails that were already there. */
  skipped: number;
  /** Total mails on the desk ticket. */
  total: number;
}

/**
 * Copy the desk ticket's mail into the work ticket's thread.
 *
 * Oldest first, so the thread reads in the order things happened rather than in
 * whatever order the API returned. Every line carries the mail's provider id, so
 * running this on every open is free after the first time.
 */
const running = new Map<string, Promise<SyncResult>>();

export function syncMail(
  link: { desk: DeskRef; workConversationId: string },
  options: { limit?: number } = {},
): Promise<SyncResult> {
  // ONE sync per pair at a time.
  //
  // Two syncs that overlap both read the thread before either writes, both
  // conclude the same mail is missing, and both copy it. That is not
  // hypothetical: it happened the first time this ran while a ledger was open on
  // the same ticket, and produced two identical lines for two of three mails.
  // Duplicates are also filtered on the way to the screen (see the ledger),
  // because a second browser tab is outside this lock's reach.
  const key = `${link.desk.conversationId}->${link.workConversationId}`;
  const existing = running.get(key);
  if (existing) return existing;
  const work = runSyncMail(link, options).finally(() => running.delete(key));
  running.set(key, work);
  return work;
}

async function runSyncMail(
  link: { desk: DeskRef; workConversationId: string },
  options: { limit?: number },
): Promise<SyncResult> {
  const { spaces } = await xyne();
  const mails = ((await spaces.email.listForConversations(
    [link.desk.conversationId],
    link.desk.channelId,
  )) ?? []) as unknown as EmailRow[];

  const existing = await listThread(link.workConversationId);
  const seen = mirroredRefs(existing);

  const ordered = [...mails].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  // The PR this whole thread is about, taken from whichever mail on it is a
  // robot notification. A reply YOU send is not one — it comes from you — so
  // without this fallback your own message mirrors as "on the mail thread"
  // while the notification right above it names the pull request.
  const threadNote = ordered.map(m => readNotification(m)).find(Boolean) ?? null;
  const budget = options.limit ?? 25;
  let copied = 0;
  let skipped = 0;

  for (const mail of ordered) {
    const ref = refFor(mail);
    // A mail with no provider id cannot be mirrored safely: with nothing stable
    // to key on, the next sync would copy it again. Skipping is the honest
    // failure — the mail is still one click away on the desk ticket.
    if (!ref) {
      skipped += 1;
      continue;
    }
    if (seen.has(ref)) {
      skipped += 1;
      continue;
    }
    if (copied >= budget) break;
    // Per mail, not per bridge: a desk thread can carry notifications about more
    // than one pull request, and the link on each line should be the one that
    // mail is actually about.
    const note = readNotification(mail) ?? threadNote;
    // Stamp who actually wrote it. `messages.send` posts as the signed-in user,
    // so without this a colleague's email appears in the thread under your name
    // and face. An outbound reply is genuinely ours, so it carries nothing.
    const author = mail.sentByUserId ? undefined : address(mail.from);
    await spaces.messages.send({
      conversationId: link.workConversationId,
      content: tagUpdate('xyne-desk', describeMail(mail, note), 'note', ref, author),
    });
    seen.add(ref);
    copied += 1;
  }
  return { copied, skipped, total: mails.length };
}

/** Every message on a conversation. Paged — a desk thread outgrows one page. */
async function listThread(conversationId: string): Promise<Array<{ content?: string }>> {
  const { spaces } = await xyne();
  const out: Array<{ content?: string }> = [];
  for (let offset = 0; offset < 600; offset += 100) {
    const page = (await spaces.messages.listByConversation(conversationId, {
      limit: 100,
      offset,
    })) as unknown as { items?: Array<{ content?: string }>; hasMore?: boolean };
    const items = page?.items ?? [];
    out.push(...items);
    if (!page?.hasMore || items.length === 0) break;
  }
  return out;
}

/**
 * Record the link itself, in both directions and in both vocabularies.
 *
 * A `ticket_references` edge is what Xyne's own UI renders, so the link survives
 * this app being deleted. The two messages are what a person reading either
 * thread actually sees. Doing only one of the two would mean the link exists but
 * is invisible, or is visible but only to us.
 *
 * Safe to call twice: the reference is attempted and its failure swallowed (the
 * server rejects a duplicate), and each note carries a ref so `syncMail`-style
 * dedupe applies to it too.
 */
export async function bridge(b: Bridge): Promise<{ referenced: boolean; noted: boolean }> {
  const { spaces } = await xyne();
  const n = b.notification;
  let referenced = false;
  try {
    await spaces.tickets.addReference(b.work.id, b.desk.id, 'LINKED');
    referenced = true;
  } catch {
    // Already linked, or the relation is not permitted between these two. The
    // messages below still carry the link, so this is a degradation not a stop.
  }

  const ref = bridgeRef(b.desk);
  const existing = await listThread(b.work.conversationId);
  if (mirroredRefsFor(existing, ref)) return { referenced, noted: false };

  const where = n.prNumber && n.system ? `${n.system.name} PR #${n.prNumber}` : (n.system?.name ?? 'Email');
  await spaces.messages.send({
    conversationId: b.work.conversationId,
    content: tagUpdate(
      'xyne-desk',
      `Mail thread linked — **${b.desk.title ?? 'notification'}**\n` +
        `${n.prUrl ? `[${where}](${n.prUrl})` : where}${b.desk.xyneId ? ` · desk ticket ${b.desk.xyneId}` : ''}` +
        `\nNew mail on this thread now appears here.`,
      'note',
      ref,
    ),
  });
  // And the other way, so the desk ticket is not a dead end either.
  await spaces.messages
    .send({
      conversationId: b.desk.conversationId,
      content: tagUpdate(
        'kanban-board',
        `This mail is about **${b.work.xyneId ?? b.work.id}**${b.work.title ? ` — ${b.work.title}` : ''}.`,
        'note',
        `bridge:${b.work.conversationId}`,
      ),
    })
    .catch(() => {
      /* the desk side is a courtesy; the work side is the one that matters */
    });
  return { referenced, noted: true };
}

const mirroredRefsFor = (messages: Array<{ content?: string }>, ref: string): boolean =>
  messages.some(m => parseUpdate(m.content ?? '').ref === ref);

/** `bridge:<deskConversationId>.<deskChannelId>` — see DeskRef. */
export const bridgeRef = (d: DeskRef): string =>
  `bridge:${d.conversationId.toLowerCase()}.${d.channelId.toLowerCase()}`;

/**
 * The desk threads a work ticket is already bridged to, read off its own thread.
 *
 * This is the reason the ref carries both ids rather than a short hash. A ticket
 * that was linked once stays synced forever after with no discovery scan, no
 * cache to invalidate, and no state anywhere but the conversation itself.
 */
export function bridgesInThread(messages: Array<{ content?: string }>): DeskRef[] {
  const out: DeskRef[] = [];
  for (const m of messages) {
    const ref = parseUpdate(m.content ?? '').ref;
    if (!ref?.startsWith('bridge:')) continue;
    const [conversationId, channelId] = ref.slice('bridge:'.length).split('.');
    // The reverse note on the desk side carries only a conversation id; it is
    // not a desk pointer and must not be treated as one.
    if (!conversationId || !channelId) continue;
    if (!out.some(d => d.conversationId === conversationId)) out.push({ conversationId, channelId });
  }
  return out;
}

/**
 * Every code-host notification sitting in the desks this person can see.
 *
 * WHY A SCAN AND NOT A SEARCH. `search.query({ apps: 'mail' })` is the obvious
 * way to find "the mail that mentions XYNE-63024", and it does not work: a desk
 * created minutes ago is not in the index yet, and the whole point of this
 * feature is mail that just arrived. Measured against the live workspace,
 * searching for the exact key returned eight unrelated bounce notifications and
 * not the mail whose subject literally contains it.
 *
 * So it reads the desks directly. `supportTickets.list` joins each ticket's
 * emails, so one call per desk is enough — no per-ticket follow-up. Eleven desks
 * in parallel measured 6.8s, dominated by one busy support inbox, which is why
 * the result is cached and refreshed rather than fetched per ticket.
 *
 * `channels.listAll()` filtered on `type === 'EMAIL'`, NOT `channels.listEmail()`
 * — that returns 209 per-user read-state rows, of which 198 are not desks at all
 * and answer every query with nothing.
 */
async function scanDesks(): Promise<Candidate[]> {
  const { spaces } = await xyne();
  const channels = (await spaces.channels.listAll()) as unknown as Array<{
    id: string;
    name?: string;
    type?: string;
    isArchived?: boolean;
  }>;
  const desks = (Array.isArray(channels) ? channels : []).filter(
    c => c.type === 'EMAIL' && !c.isArchived,
  );

  const found = await Promise.all(
    desks.map(async ch => {
      const rows: Candidate[] = [];
      try {
        // A per-desk bound. One busy support inbox took 6.7s of a 6.8s scan; a
        // desk slower than this contributes nothing rather than holding up
        // every other desk's answer.
        const tickets = (await withTimeout(spaces.supportTickets.list(ch.id), DESK_TIMEOUT_MS)) as unknown as Array<{
          id: string;
          xyneId?: string;
          title?: string;
          conversationId?: string;
          emails?: EmailRow[];
        }>;
        for (const tk of Array.isArray(tickets) ? tickets : []) {
          if (!tk.conversationId) continue;
          for (const mail of tk.emails ?? []) {
            const notification = readMailLink(mail, tk.xyneId);
            if (!notification) continue;
            rows.push({
              desk: {
                id: tk.id,
                conversationId: tk.conversationId,
                channelId: ch.id,
                ...(tk.xyneId ? { xyneId: tk.xyneId } : {}),
                ...(tk.title ? { title: tk.title } : {}),
              },
              notification,
              at: mail.createdAt ?? 0,
            });
            break; // one candidate per desk ticket; syncMail copies every mail
          }
        }
      } catch {
        // A desk we cannot read is a desk with no candidates, not a failure.
      }
      return rows;
    }),
  );
  return found.flat().sort((a, b) => b.at - a.at);
}

const DESK_TIMEOUT_MS = 8000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('desk timeout')), ms)),
  ]);
}

/** How long a scan is reused before another one is worth its cost. */
const INDEX_TTL_MS = 5 * 60_000;
let cached: { at: number; rows: Candidate[] } | null = null;
let inflight: Promise<Candidate[]> | null = null;

const INDEX_COLLECTION = 'multiplayer-mailbridge';
const INDEX_KEY = 'notification-index';

/**
 * The notification index, scanned at most once every few minutes.
 *
 * Measured cold at 19s against this workspace, so it is NEVER on the path to
 * rendering a ticket. Callers get whatever the last scan found — from memory, or
 * from global storage written by an earlier session — and a fresh scan runs
 * behind them. A ticket that is already bridged does not need this at all: see
 * `bridgesInThread`, which reads the link off the ticket's own messages.
 */
export async function loadCandidates(force = false): Promise<Candidate[]> {
  const now = Date.now();
  if (!force && cached && now - cached.at < INDEX_TTL_MS) return cached.rows;
  if (!force && inflight) return inflight;
  inflight = scanDesks()
    .then(rows => {
      cached = { at: Date.now(), rows };
      void remember(rows);
      return rows;
    })
    .catch(() => cached?.rows ?? [])
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Whatever a previous scan found, without waiting for a new one. */
export function knownCandidates(): Candidate[] {
  return cached?.rows ?? [];
}

/**
 * Persist the index so the next session starts warm.
 *
 * USER SCOPE, NOT GLOBAL — and the reason matters.
 *
 * An earlier version wrote this globally, reasoning that "which desk mails are
 * code-host notifications is a fact about the workspace, so the first colleague
 * to pay for the scan should be the last". Both halves of that are wrong.
 *
 * It is not a fact about the workspace. The scan reads the desks the VIEWER can
 * see, so the index is a fact about one person's access. Sharing it leaks the
 * subject lines and desk ticket ids of every mail in their personal inbox to
 * everyone else using the app.
 *
 * And it breaks the feature it was meant to speed up. A colleague opening a
 * ticket would load somebody else's index, find it inside the TTL, skip their
 * own scan entirely — and never be offered the mail sitting in their own desk,
 * which is exactly the case this is for.
 */
async function remember(rows: Candidate[]): Promise<void> {
  const { storage, storageReady } = await import('./xyne');
  if (!storageReady) return;
  try {
    await storage
      .collection<{ at: number; rows: Candidate[] }>(INDEX_COLLECTION)
      .put(INDEX_KEY, { at: Date.now(), rows: rows.slice(0, 200) });
  } catch {
    /* a warm start is a nicety */
  }
}

/** Load the last scan from storage. Call once, at boot, and do not await it. */
export async function recallCandidates(): Promise<void> {
  if (cached) return;
  const { storage, storageReady } = await import('./xyne');
  if (!storageReady) return;
  try {
    // Default scope is 'user' (private) — see `remember` for why that is
    // load-bearing rather than incidental.
    const rec = (await storage
      .collection(INDEX_COLLECTION)
      .get(INDEX_KEY)) as { value?: { at?: number; rows?: Candidate[] } } | null;
    const rows = rec?.value?.rows;
    // Stamped with the STORED time, not now: a recalled index is already old, so
    // the next request for it triggers a refresh rather than resetting the TTL
    // and serving week-old rows for another five minutes.
    if (Array.isArray(rows) && rows.length) cached = { at: rec?.value?.at ?? 0, rows };
  } catch {
    /* nothing scanned yet is the normal first-run state */
  }
}

/**
 * The notifications that are about this ticket.
 *
 * Matched on the ticket KEY, which is what a PR title carries. Matching on the
 * ticket's title text instead would link every notification whose PR happens to
 * mention a common word.
 */
export async function candidatesFor(xyneId: string | undefined): Promise<Candidate[]> {
  if (!xyneId) return [];
  const rows = await loadCandidates();
  const key = xyneId.toUpperCase();
  return rows.filter(c => c.notification.ticketKeys.includes(key));
}

/**
 * Who a reply goes to.
 *
 * `POST /api/email/:id/reply` does NOT work this out. It takes `type` only to
 * decide how to quote the original, and 400s with "Recipients required" unless
 * the caller supplies `to` — the Desk UI computes the list client-side and so
 * must we. Getting this wrong means mail to the wrong people, so it is a pure
 * function with its own tests rather than a few lines inside a fetch.
 *
 * REPLY      the person who wrote the message being answered.
 * REPLY_ALL  them, plus everyone the message was addressed to, minus us.
 *
 * "Us" is dropped because a reply-all that includes your own address mails you a
 * copy of your own words, and on a desk that means a new inbound email, a new
 * ticket, and a mirrored line in the thread claiming somebody replied.
 */
export function replyRecipients(
  mails: EmailRow[],
  opts: { type: 'REPLY' | 'REPLY_ALL'; self: string[]; replyToEmailId?: string },
): { to: string[]; cc: string[]; target: EmailRow | null } {
  const ordered = [...mails].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  // Answer the newest INBOUND mail: replying to our own last outbound message
  // would address the reply to ourselves and nobody else.
  //
  // And skip bounces. Sending to `bitbucket-no-reply@` produced a delivery
  // failure from `mailer-daemon@googlemail.com`, which then WAS the newest
  // inbound mail — so the next reply would have been addressed to a mail server
  // reporting that the previous one failed. Found by sending a real one.
  const inbound = ordered.filter(m => !m.sentByUserId);
  const target =
    (opts.replyToEmailId ? ordered.find(m => m.id === opts.replyToEmailId) : undefined) ??
    inbound.find(m => !isBounce(address(m.from))) ??
    inbound[0] ??
    ordered[0] ??
    null;
  if (!target) return { to: [], cc: [], target: null };

  const self = new Set(opts.self.map(a => a.toLowerCase()));
  const clean = (list: Array<string | undefined>): string[] => {
    const out: string[] = [];
    for (const raw of list) {
      const a = address(raw);
      if (!a || self.has(a) || out.includes(a) || isBounce(a)) continue;
      out.push(a);
    }
    return out;
  };

  const sender = clean([target.from]);
  if (opts.type === 'REPLY') return { to: sender, cc: [], target };
  const others = clean([...(target.to ?? []), ...(target.cc ?? [])]).filter(
    a => !sender.includes(a),
  );
  return { to: [...sender, ...others], cc: [], target };
}

/** Addresses that discard whatever you send them. */
export const isNoReply = (addr: string): boolean =>
  /(^|[.\-_])(no-?reply|do-?not-?reply)([.\-_@]|$)/i.test(addr);

/**
 * Reply on the mail thread, from the work ticket.
 *
 * `POST /api/email/:conversationId/reply` is the same endpoint the Desk UI uses.
 * It is NOT on the SDK — `email.d.ts` says outright that "sending mail is not
 * exposed here" — but it is an ordinary `/api/` path, which means the published
 * app's fetch tunnel carries it and the host performs it as the signed-in
 * viewer. Verified reachable: posting an empty body returns
 * `400 Body or at least one attachment is required`, which is validation
 * talking, not auth.
 *
 * REPLY_ALL by default: a PR notification is addressed to a list of reviewers,
 * and answering only the robot that sent it reaches nobody.
 */
export async function replyByEmail(params: {
  desk: DeskRef;
  body: string;
  type?: 'REPLY' | 'REPLY_ALL';
  replyToEmailId?: string;
  /** Addresses that are us, so a reply-all does not include them. */
  self?: string[];
}): Promise<{ to: string[] }> {
  const { spaces, token } = await import('./xyne');
  const mails = ((await spaces.email.listForConversations(
    [params.desk.conversationId],
    params.desk.channelId,
  )) ?? []) as unknown as EmailRow[];

  const { to, cc, target } = replyRecipients(mails, {
    type: params.type ?? 'REPLY_ALL',
    self: params.self ?? [],
    ...(params.replyToEmailId ? { replyToEmailId: params.replyToEmailId } : {}),
  });
  if (to.length === 0) {
    throw new Error('Nobody to reply to — this thread has no recipient we are not.');
  }

  const res = await fetch(`/api/email/${params.desk.conversationId}/reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      body: params.body,
      type: params.type ?? 'REPLY_ALL',
      to,
      ...(cc.length ? { cc } : {}),
      ...(target?.id ? { replyToEmailId: target.id } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Reply failed (${res.status}) ${detail.slice(0, 200)}`);
  }
  return { to };
}

/** Who a reply would go to, for showing before anyone presses send. */
export async function previewRecipients(
  desk: DeskRef,
  self: string[],
): Promise<{ to: string[]; noReplyOnly: boolean }> {
  const { spaces } = await xyne();
  const mails = ((await spaces.email.listForConversations([desk.conversationId], desk.channelId)) ??
    []) as unknown as EmailRow[];
  const { to } = replyRecipients(mails, { type: 'REPLY_ALL', self });
  return { to, noReplyOnly: to.length > 0 && to.every(isNoReply) };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Mail that anyone can send, addressed at the TRACK rather than at a mailbox.
 *
 * Everything above starts from a Desk channel, which means it can only see mail
 * that reached a mailbox this workspace ingests. That is a real limit: if a
 * colleague emails a third party with your ticket key in the subject and you are
 * not a recipient, no desk ever sees it and neither do we.
 *
 * Xyne's own answer to that is a channel email alias:
 *
 *     GET /api/channels/<channelId>/email-alias
 *     → { emailAlias: "xyne.test+ch_cmjo0gq8h00p3g8c96jn85j5m@juspay.in",
 *         configured: true, isActive: true, sourceType: "google-…" }
 *
 * Anyone — inside the company or outside it — can send to that address and the
 * mail lands in the channel. No mailbox to share, no desk to join.
 *
 * WHAT ARRIVES IS NOT AN EMAIL ROW. For a desk channel the pipeline calls
 * `addEmailToConversation`; for a work channel it takes the other branch and
 * calls `createConversationWithMessage` (`integrations/core/core.ts:845-859`),
 * so alias mail on a track becomes a NEW CONVERSATION carrying one BOT message
 * whose metadata is `{ messageSubtype: 'channel_email', subject, from, cc }`.
 * It is in the channel, and it is not on the ticket.
 *
 * Which is the same problem as before with a different shape, so it gets the
 * same answer: read the subject, match the key, mirror it onto the ticket.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The channel-email metadata the ingestion pipeline stamps. */
interface ChannelEmailMeta {
  messageSubtype?: unknown;
  subject?: unknown;
  from?: unknown;
  cc?: unknown;
}

/** A track-addressed email found in a channel, and the ticket it names. */
export interface ChannelMail {
  conversationId: string;
  messageId: string;
  subject: string;
  from?: string;
  ticketKeys: string[];
  at: number;
}

/**
 * Is this message an email sent to the channel's alias, and what does it name?
 *
 * Subject only, for the same reason as everywhere else — see `readMailLink`.
 */
export function readChannelMail(message: {
  messageId?: string;
  id?: string;
  metadata?: unknown;
  createdAt?: number;
}): Omit<ChannelMail, 'conversationId'> | null {
  const md = message.metadata;
  if (!md || typeof md !== 'object') return null;
  const meta = md as ChannelEmailMeta;
  if (meta.messageSubtype !== 'channel_email') return null;
  const subject = typeof meta.subject === 'string' ? meta.subject : '';
  const keys = keysIn(subject).filter((k, i, all) => all.indexOf(k) === i);
  if (!keys.length) return null;
  return {
    messageId: message.messageId ?? message.id ?? '',
    subject,
    ...(typeof meta.from === 'string' ? { from: meta.from } : {}),
    ticketKeys: keys,
    at: message.createdAt ?? 0,
  };
}

/**
 * Track-addressed mail naming this ticket, in this ticket's own channel.
 *
 * Far cheaper than the desk scan and scoped to one channel, so unlike
 * `loadCandidates` this one CAN run per ticket.
 */
export async function channelMailFor(
  channelId: string | undefined,
  xyneId: string | undefined,
  limit = 30,
): Promise<ChannelMail[]> {
  if (!channelId || !xyneId) return [];
  const key = xyneId.toUpperCase();
  try {
    const { spaces } = await xyne();
    const raw = (await spaces.conversations.listLatestByChannel(channelId, {
      limit,
    })) as unknown;
    // The row's id is `conversationId`, NOT `id` — `listLatestByChannel` returns
    // a denormalised thread row (conversationId, initialMessageId, replyCount,
    // …). Reading `.id` yielded undefined and this quietly found nothing.
    const convs = (Array.isArray(raw) ? raw : ((raw as { items?: unknown[] })?.items ?? [])) as Array<{
      conversationId?: string;
      id?: string;
    }>;
    const found = await Promise.all(
      convs.map(async cv => {
        const cid = cv.conversationId ?? cv.id;
        if (!cid) return null;
        try {
          const page = (await spaces.messages.listByConversation(cid, { limit: 5 })) as unknown as {
            items?: Array<{ messageId?: string; metadata?: unknown; createdAt?: number }>;
          };
          for (const m of page?.items ?? []) {
            const hit = readChannelMail(m);
            if (hit?.ticketKeys.includes(key)) return { ...hit, conversationId: cid };
          }
        } catch {
          /* a conversation we cannot read names nothing */
        }
        return null;
      }),
    );
    return found.filter((x): x is ChannelMail => x !== null).sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

/** Mirror a track-addressed email onto the ticket. Idempotent, like syncMail. */
export async function syncChannelMail(
  mails: ChannelMail[],
  workConversationId: string,
): Promise<SyncResult> {
  if (mails.length === 0) return { copied: 0, skipped: 0, total: 0 };
  const { spaces } = await xyne();
  const seen = mirroredRefs(await listThread(workConversationId));
  let copied = 0;
  let skipped = 0;
  for (const mail of [...mails].sort((a, b) => a.at - b.at)) {
    const ref = mail.messageId ? `chanmail:${mail.messageId.toLowerCase()}` : null;
    if (!ref || seen.has(ref)) {
      skipped += 1;
      continue;
    }
    const who = address(mail.from) ?? mail.from ?? 'unknown sender';
    const org = counterparty(who);
    await spaces.messages.send({
      conversationId: workConversationId,
      content: tagUpdate(
        'xyne-desk',
        `**${mail.subject}**\nemailed to this track by ${who}${org ? ` (${org})` : ''}`,
        'note',
        ref,
        who,
      ),
    });
    seen.add(ref);
    copied += 1;
  }
  return { copied, skipped, total: mails.length };
}

/**
 * The address anyone can send to so their mail lands on this track.
 *
 * Not on the SDK — an ordinary `/api/` route, so the tunnel carries it. Returns
 * null when the channel has no mail source connected, which is the common case
 * and must read as "there is no address" rather than as an error.
 */
export async function channelEmailAlias(channelId: string | undefined): Promise<string | null> {
  if (!channelId) return null;
  try {
    const { token } = await import('./xyne');
    const res = await fetch(`/api/channels/${channelId}/email-alias`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { emailAlias?: string; isActive?: boolean };
    return body.isActive && body.emailAlias ? body.emailAlias : null;
  } catch {
    return null;
  }
}
