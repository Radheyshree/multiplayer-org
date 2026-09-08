/**
 * Everything else that is about this ticket.
 *
 * The unified surface needs two halves. The ticket's conversation is the first
 * — an ordered record of what happened, which every app in this shell writes
 * into. This is the second: the mail, files, calls, channels and other tickets
 * that are *about* the same work but were never posted into that thread.
 *
 * WHY SEARCH RATHER THAN A LINK TABLE.
 *
 * There is no "everything about this ticket" edge table in Xyne, and building
 * one would mean a backend change this app is not allowed to make. But
 * `search.query` already answers the question, because of two properties it has
 * that are easy to miss:
 *
 *   `docType` IS PROVENANCE.  Results come back grouped, and the group value is
 *   the kind of thing — ticket, mail, chat, file, call. That is exactly the
 *   badge the reference UI puts on every row, and it is a field that already
 *   exists rather than one we infer.
 *
 *   `relevanceScore` IS THE CONNECTION.  "What else relates to this?" is a
 *   query, not a graph traversal. Nobody has to maintain the edges, and the
 *   answer stays current as the work moves.
 *
 * So the related set is computed, then curated: search proposes, a person pins.
 *
 * TWO THINGS THIS CANNOT DO, stated so nobody designs around a fiction:
 *
 *   1. Deep-link OUT. Hits carry enough to open the thing inside Xyne
 *      (channelId + conversationId + messageId, or ticketId + xyneId) but the
 *      index field naming the origin system is dropped by the result
 *      transformer, so we cannot link back to the Slack message or the Zoho
 *      ticket it came from.
 *   2. Filter by ticket. Search takes a query string, not a scope, so relevance
 *      is the only filter — which is why the seed matters so much below.
 */
import { xyne } from './xyne';

/** The doc kinds the result transformer actually handles. */
export type DocType = 'ticket' | 'mail' | 'chat' | 'message' | 'file' | 'call' | 'channel' | 'user' | 'project';

export interface RelatedHit {
  id: string;
  docType: DocType | string;
  title: string;
  subtitle?: string;
  /** The matched snippet, when the index returned one. */
  context?: string;
  score: number;
  /** Millis, when the hit carried a timestamp we could parse. */
  at?: number;
  /** Enough to open it inside Xyne. */
  link: {
    channelId?: string;
    conversationId?: string;
    messageId?: string;
    ticketId?: string;
    xyneId?: string;
  };
}

/** How a doc kind is labelled and marked. Only kinds we can render appear. */
export const DOC_LABEL: Record<string, { label: string; glyph: string }> = {
  ticket: { label: 'Ticket', glyph: '▤' },
  mail: { label: 'Email', glyph: '✉' },
  chat: { label: 'Chat', glyph: '◈' },
  message: { label: 'Chat', glyph: '◈' },
  call: { label: 'Call', glyph: '◉' },
  file: { label: 'File', glyph: '▧' },
  attachment: { label: 'File', glyph: '▧' },
  channel: { label: 'Channel', glyph: '#' },
  project: { label: 'Project', glyph: '◫' },
  user: { label: 'Person', glyph: '☺' },
};

type RawHit = {
  id?: string;
  type?: string;
  title?: string;
  subtitle?: string;
  context?: string;
  relevanceScore?: number;
  metadata?: { timestamp?: string; status?: string; channelName?: string };
  searchContext?: Record<string, unknown>;
};

type RawGroup = { groupBy?: string; groupValue?: string; count?: number; results?: RawHit[] };

const s = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/**
 * Strip the index's highlight markup.
 *
 * Hits come back with the matched terms wrapped: "Fix <hi>MoneyFramework</hi>
 * not being used". Rendering that raw shows the tags to the reader, and
 * rendering it as HTML would hand the index a way to inject markup into our
 * page. The terms are dropped rather than styled — the row is a link to the
 * thing, not a search-result page.
 */
const unhighlight = (v: string | undefined): string | undefined =>
  v?.replace(/<\/?hi>/g, '');

function toHit(raw: RawHit, docTypeFromGroup?: string): RelatedHit | null {
  const id = raw.id;
  if (!id) return null;
  const ctx = raw.searchContext ?? {};
  const ts = raw.metadata?.timestamp;
  const at = ts ? Date.parse(ts) : NaN;
  return {
    id,
    docType: raw.type ?? docTypeFromGroup ?? 'unknown',
    title: unhighlight(raw.title) || 'Untitled',
    ...(raw.subtitle ? { subtitle: unhighlight(raw.subtitle) as string } : {}),
    ...(raw.context ? { context: unhighlight(raw.context) as string } : {}),
    score: typeof raw.relevanceScore === 'number' ? raw.relevanceScore : 0,
    ...(Number.isFinite(at) ? { at } : {}),
    link: {
      ...(s(ctx.channelId) ? { channelId: s(ctx.channelId) as string } : {}),
      ...(s(ctx.conversationId) ? { conversationId: s(ctx.conversationId) as string } : {}),
      ...(s(ctx.messageId) ? { messageId: s(ctx.messageId) as string } : {}),
      ...(s(ctx.ticketId) ? { ticketId: s(ctx.ticketId) as string } : {}),
      ...(s(ctx.xyneId) ? { xyneId: s(ctx.xyneId) as string } : {}),
    },
  };
}

/**
 * Build the query that finds a ticket's neighbourhood.
 *
 * This is the part that decides whether the feature is useful or noise, and the
 * naive version — search the ticket's title — is the noisy one. A title like
 * "Fix MoneyFramework not being used by Merchant Funded EMI" is mostly common
 * words; searching it returns everything that mentions "fix" or "used".
 *
 * So: keep the rare words. Drop anything under four characters and a stoplist
 * of the words that recur in every ticket in a work tracker. What survives is
 * the vocabulary that is specific to THIS piece of work — product names,
 * component names, identifiers — which is what actually co-occurs in the mail
 * and the PR about it.
 *
 * The ticket key (`EULER-80740`) is included verbatim and first, because when
 * anyone has quoted it anywhere that is an exact, unambiguous connection.
 */
const STOP = new Set([
  'fix', 'issue', 'issues', 'bug', 'error', 'errors', 'update', 'updates', 'change', 'changes',
  'support', 'supports', 'added', 'adding', 'create', 'created', 'creating', 'remove', 'removed',
  'enable', 'enabled', 'disable', 'disabled', 'implement', 'implementation', 'please', 'need',
  'needs', 'needed', 'should', 'would', 'could', 'about', 'after', 'before', 'being', 'been',
  'from', 'into', 'with', 'when', 'where', 'which', 'this', 'that', 'these', 'those', 'there',
  'their', 'they', 'them', 'have', 'has', 'not', 'new', 'old', 'and', 'the', 'for', 'are',
  'ticket', 'tickets', 'task', 'tasks', 'page', 'screen', 'test', 'testing',
  // Verbs that describe the work rather than its subject. "used" leaked through
  // the length filter and pulled in every ticket containing the word.
  'used', 'using', 'use', 'make', 'made', 'making', 'work', 'works', 'working',
  'want', 'wants', 'give', 'gives', 'gets', 'getting', 'show', 'shows', 'shown',
]);

export function seedFor(input: { xyneId?: string; title?: string; description?: string }): string {
  const words = `${input.title ?? ''} ${input.description ?? ''}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOP.has(w));

  // Rarity within the seed itself is a decent proxy for rarity overall: a word
  // the ticket repeats is usually its subject.
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  const ranked = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([w]) => w)
    .slice(0, 6);

  return [input.xyneId, ...ranked].filter(Boolean).join(' ');
}

export interface RelatedResult {
  hits: RelatedHit[];
  /** Total the index reported, which is usually far more than we asked for. */
  total: number;
  /** The query we actually sent, shown to the user so the ranking is explicable. */
  seed: string;
}

/**
 * Find what else relates to this ticket.
 *
 * `excludeId` drops the ticket itself, which always ranks first against its own
 * text and is not a useful result.
 */
export async function findRelated(
  input: { xyneId?: string; title?: string; description?: string; id?: string },
  limit = 24,
): Promise<RelatedResult> {
  const seed = seedFor(input);
  if (!seed.trim()) return { hits: [], total: 0, seed };

  const { spaces } = await xyne();
  // `q`, not `query` — and no `ticketId`. That filter exists and is accepted,
  // but measured against a real ticket it constrains only the ticket index:
  // the other buckets came back with ten unrelated users and ten unrelated
  // files. It is not a cross-type scope, so relying on it would quietly fill
  // the pane with noise that looks authoritative.
  const raw = (await spaces.search.query({ q: seed, limit })) as unknown as {
    groups?: RawGroup[];
    results?: RawHit[];
    count?: number;
  };

  // Grouped when more than one app was searched, flat otherwise — so handle
  // both rather than depending on a server-side default that is conditional.
  const hits: RelatedHit[] = [];
  if (Array.isArray(raw.groups) && raw.groups.length) {
    for (const g of raw.groups) {
      for (const r of g.results ?? []) {
        const h = toHit(r, g.groupValue);
        if (h) hits.push(h);
      }
    }
  } else {
    for (const r of raw.results ?? []) {
      const h = toHit(r);
      if (h) hits.push(h);
    }
  }

  const self = input.id;
  return {
    hits: hits
      .filter(h => h.id !== self && h.link.ticketId !== self)
      .sort((a, b) => b.score - a.score),
    total: typeof raw.count === 'number' ? raw.count : hits.length,
    seed,
  };
}

/** Group hits for display, most-relevant kind first. */
export function byDocType(hits: RelatedHit[]): Array<{ docType: string; hits: RelatedHit[] }> {
  const m = new Map<string, RelatedHit[]>();
  for (const h of hits) {
    const k = String(h.docType);
    (m.get(k) ?? m.set(k, []).get(k) ?? []).push(h);
  }
  return [...m.entries()]
    .map(([docType, rows]) => ({ docType, hits: rows }))
    .sort((a, b) => (b.hits[0]?.score ?? 0) - (a.hits[0]?.score ?? 0));
}

/**
 * A one-line description of a hit for the ledger entry that records the pin.
 *
 * The pin is a message in the ticket's own conversation — the same place every
 * other surface writes — so it has to read as a sentence, not as a data dump.
 */
export function describeHit(h: RelatedHit): string {
  const kind = DOC_LABEL[String(h.docType)]?.label ?? 'Item';
  return `Linked ${kind.toLowerCase()}: **${h.title}**${h.subtitle ? ` — ${h.subtitle}` : ''}`;
}
