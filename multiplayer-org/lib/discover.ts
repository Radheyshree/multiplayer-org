/**
 * Discovery — the "chain of connections".
 *
 * There is no graph table to traverse, and we don't need one: search already
 * returns results grouped by `docType`, which is simultaneously the provenance
 * badge ('mail' -> via Email, 'chat' -> via Chat) and, through relevanceScore,
 * the strength of the connection. So "what else relates to this?" is a query.
 */
import { xyne } from './xyne';

export type Hit = {
  id: string;
  /** file | ticket | mail | chat | call | user | ... — the provenance badge. */
  docType: string;
  title: string;
  subtitle?: string;
  context?: string;
  score?: number;
};

/** Shape verified live against /api/sdk/v1/search. */
type RawResult = {
  id?: string;
  type?: string;
  title?: string;
  subtitle?: string;
  context?: string;
  relevanceScore?: number;
  searchContext?: string;
};
type RawGroup = { groupBy?: string; groupValue?: string; count?: number; results?: RawResult[] };
type RawResponse = { groups?: RawGroup[]; results?: RawResult[]; totalCount?: number };

function toHit(r: RawResult, docType?: string): Hit {
  return {
    id: String(r.id ?? ''),
    // The group's docType is the provenance dimension; a flat result only
    // carries the narrower singular `type`, so fall back to it.
    docType: docType ?? r.type ?? 'unknown',
    title: r.title || '(untitled)',
    ...(r.subtitle ? { subtitle: r.subtitle } : {}),
    ...(r.context || r.searchContext ? { context: r.context || r.searchContext } : {}),
    ...(typeof r.relevanceScore === 'number' ? { score: r.relevanceScore } : {}),
  };
}

/** Flatten a grouped or flat search response into ranked hits. */
function flatten(res: RawResponse): Hit[] {
  if (res.groups?.length) {
    return res.groups.flatMap(g => (g.results ?? []).map(r => toHit(r, g.groupValue)));
  }
  return (res.results ?? []).map(r => toHit(r));
}

export type DiscoverOptions = {
  /** Restrict to these docTypes, e.g. ['tickets', 'emails'] (request vocabulary is plural). */
  type?: string[];
  limit?: number;
  orderBy?: 'newest' | 'oldest' | 'relevance';
};

export async function discover(q: string, options: DiscoverOptions = {}): Promise<Hit[]> {
  if (!q.trim()) return [];
  const { spaces } = await xyne();
  const res = (await spaces.search.query({
    q,
    limit: options.limit ?? 24,
    ...(options.type?.length ? { type: options.type } : {}),
    ...(options.orderBy ? { orderBy: options.orderBy } : {}),
  } as Parameters<typeof spaces.search.query>[0])) as unknown as RawResponse;

  return flatten(res).filter(h => h.id);
}

/**
 * Connections for one pinned node: search seeded from its own text.
 *
 * Deliberately keyword-seeded rather than id-linked — nothing in the SDK
 * exposes a real edge table, and a good seed finds the email and the PR that a
 * hand-declared edge would have missed anyway.
 */
export async function relatedTo(seed: { title: string; context?: string }, exclude: string[] = []): Promise<Hit[]> {
  const q = [seed.title, seed.context].filter(Boolean).join(' ').slice(0, 240);
  const hits = await discover(q, { limit: 24 });
  const skip = new Set(exclude);
  return hits.filter(h => !skip.has(h.id));
}

/** Group hits by their provenance badge, for a grouped result list. */
export function byDocType(hits: Hit[]): Array<{ docType: string; hits: Hit[] }> {
  const map = new Map<string, Hit[]>();
  for (const h of hits) {
    const list = map.get(h.docType);
    if (list) list.push(h);
    else map.set(h.docType, [h]);
  }
  return [...map.entries()]
    .map(([docType, list]) => ({ docType, hits: list }))
    .sort((a, b) => b.hits.length - a.hits.length);
}
