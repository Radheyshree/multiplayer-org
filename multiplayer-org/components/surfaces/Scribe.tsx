/**
 * Xyne Scribe — calls and recordings.
 *
 * Four listings share one row shape, so the tabs are a filter over the same
 * renderer. Participants arrive empty on the list rows, so they're fetched when
 * a call is opened.
 */
import { useEffect, useState } from 'react';
import { initials, nameOf, resolvePeople } from '../../lib/people';
import { c, eyebrow, mono } from '../../lib/theme';
import { xyne } from '../../lib/xyne';

type Call = {
  id: string;
  externalId?: string;
  title?: string;
  status?: string;
  callType?: string;
  channelId?: string;
  roomLink?: string;
  startsAt?: number;
  endsAt?: number;
  organizerId?: string;
};
type Participant = { id: string; userId?: string; displayName?: string; email?: string; joinedAt?: number };

type Tab = 'active' | 'scheduled' | 'history' | 'recordings';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'active', label: 'Live' },
  { id: 'scheduled', label: 'Upcoming' },
  { id: 'history', label: 'Past' },
  { id: 'recordings', label: 'Recordings' },
];

function when(ca: Call): string {
  const t = ca.startsAt;
  if (!t) return '—';
  return new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function Scribe() {
  const [tab, setTab] = useState<Tab>('history');
  const [calls, setCalls] = useState<Call[]>([]);
  const [openId, setOpenId] = useState('');
  const [people, setPeople] = useState<Participant[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setBusy(true);
    setError(null);
    setOpenId('');
    void (async () => {
      const { spaces } = await xyne();
      const rows = (await (tab === 'active'
        ? spaces.calls.listActive()
        : tab === 'scheduled'
          ? spaces.calls.listScheduled()
          : tab === 'history'
            ? spaces.calls.listHistory({ limit: 25 })
            : spaces.calls.listRecordings({ limit: 25 }))) as unknown as Call[];
      setCalls(rows);
      await resolvePeople(rows.map(r => r.organizerId));
      setTick(t => t + 1);
    })()
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [tab]);

  const open = async (ca: Call) => {
    setOpenId(ca.id);
    setPeople([]);
    try {
      const { spaces } = await xyne();
      // Participants arrive with displayName and email already attached, so
      // there is nothing to resolve.
      setPeople((await spaces.calls.listParticipants(ca.id)) as unknown as Participant[]);
    } catch {
      setPeople([]);
    }
  };

  const current = calls.find(x => x.id === openId);

  return (
    <div className="grid h-full" style={{ gridTemplateColumns: '24rem 1fr' }} data-tick={tick}>
      <aside className="flex min-h-0 flex-col" style={{ borderRight: `1px solid ${c.line}` }}>
        <div className="flex gap-1 p-3">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="rounded-md px-2.5 py-1 text-[12px] font-medium"
              style={{
                background: tab === t.id ? c.signalSoft : 'transparent',
                color: tab === t.id ? c.signal : c.graphite,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {busy && <p className="px-3" style={{ fontFamily: mono, fontSize: '11px', color: c.mute }}>loading…</p>}
          {!busy && calls.length === 0 && (
            <p className="px-3 text-[12.5px]" style={{ color: c.graphite }}>
              {tab === 'active' ? 'Nobody is on a call right now.' : 'Nothing here.'}
            </p>
          )}
          {calls.map(ca => (
            <button
              key={ca.id}
              onClick={() => void open(ca)}
              className="w-full px-3 py-2.5 text-left"
              style={{
                background: openId === ca.id ? c.signalSoft : 'transparent',
                borderBottom: `1px solid ${c.line}`,
              }}
            >
              <div className="flex items-center gap-2">
                {tab === 'active' && (
                  <span className="size-1.5 rounded-full" style={{ background: c.live }} aria-hidden />
                )}
                <p className="line-clamp-2 flex-1 text-[12.5px] leading-snug">{ca.title ?? 'Untitled call'}</p>
              </div>
              <p className="mt-1" style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}>
                {when(ca)}
                {ca.callType ? ` · ${ca.callType}` : ''}
              </p>
            </button>
          ))}
        </div>
      </aside>

      <section className="min-h-0 overflow-y-auto">
        {error && (
          <p className="m-3 rounded-md px-3 py-2 text-[12.5px]" style={{ background: '#FCF2EC', color: c.attention }}>
            {error}
          </p>
        )}
        {!current ? (
          <p className="mt-24 text-center text-[13px]" style={{ color: c.graphite }}>
            Pick a call to see who was on it.
          </p>
        ) : (
          <div className="max-w-2xl px-7 py-7">
            <div style={{ ...eyebrow, color: c.mute }}>{current.status ?? 'call'}</div>
            <h1 className="mt-1.5 text-[21px] leading-snug font-semibold">{current.title ?? 'Untitled call'}</h1>
            <p className="mt-1.5" style={{ fontFamily: mono, fontSize: '10.5px', color: c.mute }}>
              {when(current)}
              {current.organizerId ? ` · organised by ${nameOf(current.organizerId)}` : ''}
            </p>

            {current.roomLink && (
              <a
                href={current.roomLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-block rounded-md px-3 py-1.5 text-[12.5px] font-medium text-white"
                style={{ background: c.signal }}
              >
                {tab === 'active' ? 'Join call' : tab === 'recordings' ? 'Open recording' : 'Open room'}
              </a>
            )}

            <div className="mt-7">
              <div style={{ ...eyebrow, color: c.graphite }}>Participants</div>
              {people.length === 0 ? (
                <p className="mt-2 text-[12.5px]" style={{ color: c.mute }}>
                  No participant records for this call.
                </p>
              ) : (
                <ul className="mt-2.5 flex flex-wrap gap-2">
                  {people.map(p => (
                    <li
                      key={p.id}
                      className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1"
                      style={{ background: c.card, border: `1px solid ${c.line}` }}
                    >
                      <span
                        className="grid size-5 place-items-center rounded-full"
                        style={{ background: c.signalSoft, color: c.signal, fontFamily: mono, fontSize: '8px' }}
                      >
                        {initials(p.displayName || p.email || '?')}
                      </span>
                      <span className="text-[12px]">{p.displayName || p.email || 'Unknown'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
