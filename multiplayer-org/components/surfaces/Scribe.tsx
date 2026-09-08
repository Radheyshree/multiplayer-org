/**
 * Xyne Scribe — calls and recordings.
 *
 * Four listings share one row shape, so the tabs are a filter over the same
 * renderer. Participants arrive empty on the list rows, so they're fetched when
 * a call is opened.
 *
 * SCOPE, honestly: a call row carries `channelId`, so narrowing to the open
 * track is a real filter and not a guess. But none of the four list calls takes
 * a channel argument (see SDK-GAPS.md), so the narrowing happens after the
 * read, not instead of it — this is a smaller list, not fewer requests. The
 * toggle says "this track" rather than pretending the whole workspace is gone.
 *
 * What Scribe contributes to a ticket is a LINK. A call is not a ticket and
 * cannot be made into one, but "this was discussed on Tuesday's call, here is
 * the room and who was on it" is exactly the kind of fact that otherwise lives
 * only in someone's memory.
 */
import { useEffect, useMemo, useState } from 'react';
import { initials, nameOf, resolvePeople } from '../../lib/people';
import { c, eyebrow, mono } from '../../lib/theme';
import type { OrgAppProps } from '../../orgApps/registry';
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

export function Scribe({ scope, postUpdate, focused }: OrgAppProps) {
  const [tab, setTab] = useState<Tab>('history');
  const [calls, setCalls] = useState<Call[]>([]);
  const [openId, setOpenId] = useState('');
  const [people, setPeople] = useState<Participant[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [trackOnly, setTrackOnly] = useState(true);
  const [linked, setLinked] = useState<string | null>(null);

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

  /** Calls on the open track. Empty is meaningful: this track has had none. */
  const onTrack = useMemo(
    () => (scope ? calls.filter(ca => ca.channelId === scope.channelId) : []),
    [calls, scope?.channelId],
  );
  const scoped = Boolean(scope) && trackOnly;
  const visible = scoped ? onTrack : calls;

  /**
   * Fall back to the workspace when the track has no calls in this tab.
   *
   * Landing on an empty list because of a filter you did not set is the worst
   * default: it reads as "there are no calls" when there are 25. The toggle
   * stays, and its counter still shows 0/25, so nothing is hidden — the opening
   * view is just the one with something in it.
   */
  useEffect(() => {
    if (scope && !busy && calls.length > 0 && onTrack.length === 0) setTrackOnly(false);
  }, [scope?.channelId, busy, calls.length, onTrack.length]);

  /** A new tab is a new question — re-offer the track filter. */
  useEffect(() => {
    setTrackOnly(true);
  }, [tab, scope?.channelId]);

  /**
   * Record this call against the ticket the shell has focused.
   *
   * A call is not a ticket and there is no join table to write to — so the link
   * is a message in the ticket's own conversation, which is the one place every
   * surface already writes. It carries the room link so it stays useful after
   * the call has ended.
   */
  const link = async (ca: Call): Promise<void> => {
    if (!focused) return;
    setLinked(null);
    setError(null);
    const who = people.map(pp => pp.displayName ?? pp.email).filter(Boolean);
    const body = [
      `Linked call: **${ca.title ?? 'Untitled call'}** (${when(ca)})`,
      ca.roomLink ? `Room: ${ca.roomLink}` : null,
      who.length ? `On the call: ${who.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await postUpdate(focused, body, 'note');
      setLinked(`Linked to ${focused.xyneId}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

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

        {scope && (
          <button
            onClick={() => setTrackOnly(v => !v)}
            className="mx-3 mb-2 rounded-md border px-2 py-1 text-left text-[11.5px]"
            style={{
              borderColor: scoped ? c.signal : c.line,
              color: scoped ? c.signal : c.graphite,
              background: scoped ? c.signalSoft : c.card,
            }}
          >
            {scoped ? `#${scope.trackName} only` : 'All calls'}
            <span className="ml-1.5" style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}>
              {onTrack.length}/{calls.length}
            </span>
          </button>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {busy && <p className="px-3" style={{ fontFamily: mono, fontSize: '11px', color: c.mute }}>loading…</p>}
          {!busy && visible.length === 0 && (
            <p className="px-3 text-[12.5px]" style={{ color: c.graphite }}>
              {scoped && calls.length > 0
                ? `No calls on #${scope?.trackName} here — ${calls.length} elsewhere in the workspace.`
                : tab === 'active'
                  ? 'Nobody is on a call right now.'
                  : 'Nothing here.'}
            </p>
          )}
          {visible.map(ca => (
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
          <p className="m-3 rounded-md px-3 py-2 text-[12.5px]" style={{ background: c.attentionSoft, color: c.attention }}>
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

            {/* The one thing this surface can put into a ticket. Disabled with a
                reason rather than hidden — "why can't I attach this" is a worse
                question than a greyed button that says what is missing. */}
            <div className="mt-4 flex items-center gap-2.5">
              <button
                onClick={() => void link(current)}
                disabled={!focused}
                className="rounded-md border px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-45"
                style={{ borderColor: c.line, color: c.text, background: c.card }}
              >
                {focused ? `Link to ${focused.xyneId}` : 'Link to a ticket'}
              </button>
              <span className="text-[11.5px]" style={{ color: c.mute }}>
                {linked ?? (focused ? 'Records this call in the ticket’s chat.' : 'Focus a ticket first.')}
              </span>
            </div>

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
