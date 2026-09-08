/**
 * Everything else about this ticket, from every surface at once.
 *
 * The thread on the other tab records what happened. This records what EXISTS
 * — the mail, the files, the calls, the other tickets that are about the same
 * work but were never posted into it. It is the half of "no more copy-pasting"
 * that a conversation cannot cover, because nobody pastes a file into a ticket
 * just so it can be found later.
 *
 * Every row is badged with its kind, which is not a guess: the search index
 * groups by `docType` and the group value IS the badge. Ranking is
 * `relevanceScore`, shown on the row, so a surprising result is explicable
 * rather than mysterious.
 *
 * Pinning writes a line into the ticket's own conversation — the same place
 * every app in this shell writes — rather than into private app storage. That
 * is deliberate: a connection recorded where Xyne itself can see it outlives
 * this app, and shows up for someone reading the ticket in the dashboard.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  byDocType,
  describeHit,
  DOC_LABEL,
  findRelated,
  type RelatedHit,
} from '../../lib/related';
import { c, eyebrow, mono } from '../../lib/theme';
import type { WorkItem } from '../../lib/workitem';

function Row({
  hit,
  onPin,
  pinned,
  busy,
}: {
  hit: RelatedHit;
  onPin: (h: RelatedHit) => void;
  pinned: boolean;
  busy: boolean;
}) {
  const kind = DOC_LABEL[String(hit.docType)] ?? { label: String(hit.docType), glyph: '·' };
  return (
    <li
      className="group flex items-start gap-2 rounded-md px-2 py-1.5"
      style={{ borderBottom: `1px solid ${c.line}` }}
    >
      <span
        className="mt-0.5 grid size-5 shrink-0 place-items-center rounded"
        style={{ background: c.ink, color: c.graphite, fontSize: '10px' }}
        title={kind.label}
        aria-hidden
      >
        {kind.glyph}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-[12.5px]" style={{ color: c.text }}>
            {hit.title}
          </span>
          <span
            className="shrink-0 tabular-nums"
            style={{ fontFamily: mono, fontSize: '9px', color: c.mute }}
            title="Relevance to this ticket"
          >
            {hit.score.toFixed(2)}
          </span>
        </span>
        {hit.subtitle ? (
          <span className="block truncate text-[11px]" style={{ color: c.mute }}>
            {hit.subtitle}
          </span>
        ) : null}
        {hit.context && hit.context !== hit.title ? (
          // A `block` class would override line-clamp's `display: -webkit-box`
          // and the snippet would run to a dozen lines — index context is long.
          <span
            className="mt-0.5 text-[11px]"
            style={{
              color: c.graphite,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {hit.context}
          </span>
        ) : null}
      </span>

      <button
        onClick={() => onPin(hit)}
        disabled={pinned || busy}
        className="shrink-0 rounded px-1.5 py-0.5 text-[10.5px] opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-100"
        style={{
          color: pinned ? c.live : c.signal,
          border: `1px solid ${pinned ? c.line : c.signalSoft}`,
          background: pinned ? 'transparent' : c.signalSoft,
        }}
        title={pinned ? 'Already recorded on this ticket' : 'Record this on the ticket'}
      >
        {pinned ? 'linked ✓' : 'Link'}
      </button>
    </li>
  );
}

export function Related({
  item,
  description,
  onPin,
}: {
  item: WorkItem;
  /** The ticket body, when the caller has it — it sharpens the seed a lot. */
  description?: string;
  /** Records the link in the ticket's conversation. Returns when it lands. */
  onPin: (text: string) => Promise<void>;
}) {
  const [hits, setHits] = useState<RelatedHit[] | null>(null);
  const [seed, setSeed] = useState('');
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setHits(null);
    setError(null);
    try {
      const r = await findRelated({
        id: item.id,
        xyneId: item.xyneId,
        title: item.title,
        ...(description ? { description } : {}),
      });
      setHits(r.hits);
      setSeed(r.seed);
      setTotal(r.total);
    } catch (e) {
      setHits([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [item.id, item.xyneId, item.title, description]);

  useEffect(() => {
    void load();
    // Pins are per-ticket; carrying them across would mark the wrong rows.
    setPinned(new Set());
  }, [load]);

  const pin = async (h: RelatedHit) => {
    setBusy(true);
    try {
      await onPin(describeHit(h));
      setPinned(prev => new Set(prev).add(h.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const groups = hits ? byDocType(hits) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-baseline gap-2 px-4 pt-3 pb-2">
        <span style={{ ...eyebrow, color: c.graphite }}>Related</span>
        <button
          onClick={() => void load()}
          className="ml-auto text-[11px]"
          style={{ color: c.signal }}
        >
          Refresh
        </button>
      </div>

      {/* The query is shown, not hidden. A ranked list nobody can interrogate
          is a list nobody trusts — and the seed explains every surprise in it. */}
      {seed ? (
        <p className="px-4 pb-2 text-[10.5px]" style={{ fontFamily: mono, color: c.mute }}>
          matching “{seed}” · {total} in the workspace
        </p>
      ) : null}

      {error ? (
        <p
          className="mx-4 mb-2 rounded-md px-3 py-2 text-[12px]"
          style={{ background: c.attentionSoft, color: c.attention }}
        >
          {error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {hits === null ? (
          <p className="px-2 py-6 text-[12px]" style={{ color: c.mute }}>
            Looking across tickets, mail, files and calls…
          </p>
        ) : hits.length === 0 ? (
          <p className="px-2 py-6 text-[12.5px]" style={{ color: c.graphite }}>
            Nothing else in the workspace matches this ticket yet.
          </p>
        ) : (
          groups.map(g => {
            const label = DOC_LABEL[g.docType]?.label ?? g.docType;
            return (
              <section key={g.docType} className="mb-3">
                <div className="flex items-baseline gap-1.5 px-2 py-1">
                  <span style={{ ...eyebrow, color: c.mute }}>{label}</span>
                  <span style={{ fontFamily: mono, fontSize: '9px', color: c.mute }}>
                    {g.hits.length}
                  </span>
                </div>
                <ul>
                  {g.hits.map(h => (
                    <Row
                      key={h.id}
                      hit={h}
                      onPin={h2 => void pin(h2)}
                      pinned={pinned.has(h.id)}
                      busy={busy}
                    />
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
