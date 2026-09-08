/**
 * Discovery pane — the chain of connections.
 *
 * Seeded from the track itself, so opening it already proposes the mail and the
 * ticket that belong here; typing narrows it. Every hit carries the docType it
 * was indexed under, which is what the badge shows.
 */
import { useCallback, useEffect, useState } from 'react';
import { byDocType, discover, relatedTo, type Hit } from '../lib/discover';
import { pinNode, type Track } from '../lib/track';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Provenance } from './provenance';
import { Skeleton } from './ui/skeleton';

export function Discover({ track, onPinned }: { track: Track; onPinned: (t: Track) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [pinning, setPinning] = useState<string | null>(null);

  const pinnedIds = track.nodes.map(n => n.refId);

  const seed = useCallback(async () => {
    setBusy(true);
    try {
      const found = await relatedTo({ title: track.title, ...(track.description ? { context: track.description } : {}) }, pinnedIds);
      setHits(found);
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.title, track.description, pinnedIds.join(',')]);

  useEffect(() => {
    void seed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id]);

  const search = async () => {
    if (!q.trim()) return void seed();
    setBusy(true);
    try {
      const found = await discover(q, { limit: 30 });
      setHits(found.filter(h => !pinnedIds.includes(h.id)));
    } finally {
      setBusy(false);
    }
  };

  const pin = async (h: Hit) => {
    setPinning(h.id);
    try {
      const next = await pinNode(track.id, {
        refId: h.id,
        docType: h.docType,
        title: h.title,
        ...(h.subtitle ? { subtitle: h.subtitle } : {}),
      });
      onPinned(next);
      setHits(prev => (prev ?? []).filter(x => x.id !== h.id));
    } finally {
      setPinning(null);
    }
  };

  const groups = byDocType(hits ?? []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 p-3">
        <Input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void search()}
          placeholder="Find related work…"
          className="h-9"
        />
        <Button size="sm" variant="outline" onClick={() => void search()} disabled={busy}>
          Search
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {busy && !hits && (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        )}

        {hits?.length === 0 && (
          <p className="text-muted-foreground py-8 text-center text-sm">Nothing related found.</p>
        )}

        {groups.map(g => (
          <section key={g.docType} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Provenance docType={g.docType} />
              <span className="text-muted-foreground text-[11px]">{g.hits.length}</span>
            </div>
            {g.hits.map(h => (
              <div key={h.id} className="hover:bg-muted/50 group rounded-md border p-2.5 transition">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{h.title}</p>
                    {h.subtitle && <p className="text-muted-foreground truncate text-xs">{h.subtitle}</p>}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 text-xs opacity-0 transition group-hover:opacity-100"
                    onClick={() => void pin(h)}
                    disabled={pinning === h.id}
                  >
                    {pinning === h.id ? '…' : 'Pin'}
                  </Button>
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
