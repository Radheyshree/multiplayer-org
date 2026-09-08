/**
 * The app store.
 *
 * Cards are faceplates: a mono strip naming the source and version, then the
 * app. Built-in surfaces and the org's real registered apps sit in the same
 * grid because to whoever is looking for a tool, that distinction is trivia —
 * but the strip still tells you which is which.
 */
import { useEffect, useMemo, useState } from 'react';
import { loadRegistry, SURFACES, type Entry } from '../lib/apps';
import { c, eyebrow, mono } from '../lib/theme';

const ORIGIN_LABEL: Record<Entry['origin'], string> = {
  surface: 'Built in',
  org: 'Your org',
  marketplace: 'Marketplace',
};

function Faceplate({
  app,
  pinned,
  onOpen,
  onPin,
}: {
  app: Entry;
  pinned: boolean;
  onOpen: (e: Entry) => void;
  onPin: (e: Entry) => void;
}) {
  const openable = Boolean(app.surface);
  return (
    <article
      className="flex flex-col rounded-lg transition-shadow hover:shadow-sm"
      style={{ background: c.card, border: `1px solid ${c.line}` }}
    >
      <div
        className="flex items-center justify-between rounded-t-lg px-3 py-1.5"
        style={{ background: '#F5F4F0', borderBottom: `1px solid ${c.line}` }}
      >
        <span style={{ ...eyebrow, color: c.mute }}>{ORIGIN_LABEL[app.origin]}</span>
        <span style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}>
          {app.version ? `v${app.version}` : openable ? 'native' : '—'}
        </span>
      </div>

      <div className="flex flex-1 gap-3 p-3.5">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-md text-[15px]"
          style={{
            background: openable ? c.signalSoft : '#F2F1EC',
            color: openable ? c.signal : c.graphite,
          }}
          aria-hidden
        >
          {app.glyph}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] leading-tight font-semibold">{app.name}</h3>
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug" style={{ color: c.graphite }}>
            {app.description}
          </p>
          {app.limited && (
            <p className="mt-1.5 text-[11.5px] leading-snug" style={{ color: c.attention }}>
              {app.limited}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-3.5 pb-3">
        {openable ? (
          <button
            onClick={() => onOpen(app)}
            className="rounded-md px-2.5 py-1 text-[12px] font-medium text-white"
            style={{ background: c.signal }}
          >
            Open
          </button>
        ) : (
          <span style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}>
            {app.installed ? 'installed' : 'not installed'}
          </span>
        )}
        {openable && (
          <button
            onClick={() => onPin(app)}
            className="text-[12px]"
            style={{ color: pinned ? c.signal : c.mute }}
          >
            {pinned ? 'On rail' : 'Add to rail'}
          </button>
        )}
      </div>
    </article>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 style={{ ...eyebrow, color: c.graphite }}>{title}</h2>
        <span style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}>{count}</span>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(272px, 1fr))' }}>
        {children}
      </div>
    </section>
  );
}

export function AppStore({
  pins,
  onOpen,
  onPin,
}: {
  pins: string[];
  onOpen: (e: Entry) => void;
  onPin: (e: Entry) => void;
}) {
  const [org, setOrg] = useState<Entry[]>([]);
  const [market, setMarket] = useState<Entry[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadRegistry()
      .then(r => {
        setOrg(r.org);
        setMarket(r.marketplace);
        if (r.error) setError(r.error);
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const match = (e: Entry) => {
    const s = q.trim().toLowerCase();
    return !s || e.name.toLowerCase().includes(s) || e.description.toLowerCase().includes(s);
  };

  const surfaces = useMemo(() => SURFACES.filter(match), [q]);
  const orgHits = useMemo(() => org.filter(match), [org, q]);
  const marketHits = useMemo(() => market.filter(match), [market, q]);
  const total = surfaces.length + orgHits.length + marketHits.length;

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] leading-none font-semibold tracking-tight">All apps</h1>
          <p className="mt-2 text-[13.5px]" style={{ color: c.graphite }}>
            Everything your org can open from one place — built-in surfaces and your registered apps.
          </p>
        </div>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Filter apps"
          className="h-9 w-64 rounded-md px-3 text-[13px] outline-none"
          style={{ background: c.card, border: `1px solid ${c.line}` }}
        />
      </header>

      {error && (
        <p className="mb-5 rounded-md px-3 py-2 text-[12.5px]" style={{ background: '#FCF2EC', color: c.attention }}>
          {error}
        </p>
      )}

      {loading && (
        <p style={{ fontFamily: mono, fontSize: '11px', color: c.mute }}>reading registry…</p>
      )}

      {!loading && total === 0 && (
        <p className="py-16 text-center text-[13.5px]" style={{ color: c.graphite }}>
          Nothing matches “{q}”. Try a shorter word.
        </p>
      )}

      {surfaces.length > 0 && (
        <Section title="Built in" count={surfaces.length}>
          {surfaces.map(a => (
            <Faceplate key={a.key} app={a} pinned={pins.includes(a.key)} onOpen={onOpen} onPin={onPin} />
          ))}
        </Section>
      )}
      {orgHits.length > 0 && (
        <Section title="Your org" count={orgHits.length}>
          {orgHits.map(a => (
            <Faceplate key={a.key} app={a} pinned={pins.includes(a.key)} onOpen={onOpen} onPin={onPin} />
          ))}
        </Section>
      )}
      {marketHits.length > 0 && (
        <Section title="Marketplace" count={marketHits.length}>
          {marketHits.map(a => (
            <Faceplate key={a.key} app={a} pinned={pins.includes(a.key)} onOpen={onOpen} onPin={onPin} />
          ))}
        </Section>
      )}
    </div>
  );
}
