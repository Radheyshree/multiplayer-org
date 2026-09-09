/**
 * Everything the track decided, across every call it has had.
 *
 * The premise: a decision's value is not on the day it is made, it is eighteen
 * months later when someone asks why the system works this way. Today that
 * answer is spread across twenty recordings nobody will reopen, one screen at a
 * time. Here it is one list, and it is searchable.
 *
 * IT COSTS NOTHING EXTRA. `markedItems` already arrived on every row of the
 * listing that drew the sidebar — no per-call fetch, no transcript, no second
 * request. That is the whole reason this view can exist at all: the expensive
 * version (open each call, read its summary, remember what it said) is what the
 * dashboard makes you do.
 *
 * Search is client-side and that is the honest implementation, not a shortcut.
 * The platform's own call index matches titles and attendee names only — a
 * phrase that appears in exactly one call's summary returns nothing from it
 * (verified: SCRIBE-SDK-GAPS.md §2). These strings are already in memory, so
 * matching them here is both the only way and the fast one.
 */
import { useMemo, useState } from 'react';
import {
  isActionSection,
  parseMarked,
  parseSummary,
  plain,
  whenOf,
  type Call,
  type MarkedItem,
} from '../../lib/calls';
import { c, mono } from '../../lib/theme';
import { Empty, Eyebrow, markTone, Stamp, when } from './parts';

type Row = {
  item: MarkedItem;
  call: Call;
  /** True when the item came from the summary's action list rather than from
   *  `markedItems` — it has no offset, so it renders without one. */
  fromSummary: boolean;
};

type Filter = 'all' | 'decision' | 'action';

/**
 * Every decision and commitment on these calls.
 *
 * Two sources, deliberately merged. `markedItems` is the structured one and is
 * stamped with an offset. The summary's action section is prose, but it is
 * present on calls whose `markedItems` is empty — 21 calls here have a summary,
 * far more than have marked items — so dropping it would make the view look
 * empty for exactly the calls people care most about. Duplicates between the
 * two are collapsed on the text itself.
 */
function collect(calls: Call[]): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();
  const key = (callId: string, text: string) => `${callId}::${text.trim().toLowerCase().slice(0, 80)}`;

  for (const call of calls) {
    for (const raw of parseMarked(call.markedItems)) {
      // `plain` here too: extracted items carry the same citation tokens and the
      // same stranded space before the full stop that summary lines do.
      const item = { ...raw, text: plain(raw.text) };
      if (item.type === 'moment' || !item.text) continue;
      const k = key(call.id, item.text);
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push({ item, call, fromSummary: false });
    }
    for (const section of parseSummary(call.aiSummary)) {
      if (!isActionSection(section)) continue;
      for (const line of section.lines) {
        // The citation tokens mean nothing without the call open.
        const text = plain(line);
        if (!text) continue;
        const k = key(call.id, text);
        if (seen.has(k)) continue;
        seen.add(k);
        rows.push({ item: { type: 'action', text, timestampSeconds: 0 }, call, fromSummary: true });
      }
    }
  }
  return rows.sort((a, b) => (whenOf(b.call) ?? 0) - (whenOf(a.call) ?? 0));
}

export interface DecisionsProps {
  calls: Call[];
  scopeLabel: string;
  /** Open the call this row came from. */
  onOpenCall: (call: Call, seconds: number | null) => void;
  onMakeTicket?: (item: MarkedItem, call: Call) => void;
  onRecord?: (item: MarkedItem, call: Call) => void;
  recordLabel?: string;
  pending?: string | null;
}

export function Decisions({
  calls,
  scopeLabel,
  onOpenCall,
  onMakeTicket,
  onRecord,
  recordLabel,
  pending,
}: DecisionsProps) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const all = useMemo(() => collect(calls), [calls]);

  const needle = q.trim().toLowerCase();
  const rows = useMemo(
    () =>
      all.filter(
        r =>
          (filter === 'all' || r.item.type === filter) &&
          (!needle ||
            r.item.text.toLowerCase().includes(needle) ||
            (r.call.title ?? '').toLowerCase().includes(needle)),
      ),
    [all, filter, needle],
  );

  const counts = useMemo(
    () => ({
      decision: all.filter(r => r.item.type === 'decision').length,
      action: all.filter(r => r.item.type === 'action').length,
    }),
    [all],
  );

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3" style={{ borderColor: c.line }}>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="What did we decide about…"
          className="h-8 w-64 rounded-md px-2 text-[12.5px] outline-none"
          style={{ background: c.card, border: `1px solid ${c.line}` }}
        />
        <div className="flex rounded-md p-0.5" style={{ background: c.ink, border: `1px solid ${c.line}` }}>
          {([
            { id: 'all' as Filter, label: 'Everything', n: all.length },
            { id: 'decision' as Filter, label: 'Decisions', n: counts.decision },
            { id: 'action' as Filter, label: 'Actions', n: counts.action },
          ]).map(o => (
            <button
              key={o.id}
              onClick={() => setFilter(o.id)}
              aria-pressed={filter === o.id}
              className="rounded px-2.5 py-1 text-[12px] font-medium"
              style={{
                background: filter === o.id ? c.card : 'transparent',
                color: filter === o.id ? c.text : c.graphite,
              }}
            >
              {o.label}
              <span className="ml-1.5" style={{ fontFamily: mono, fontSize: '9.5px', color: c.mute }}>
                {o.n}
              </span>
            </button>
          ))}
        </div>
        <span className="ml-auto text-[11.5px]" style={{ color: c.mute }}>
          across {calls.length} {calls.length === 1 ? 'call' : 'calls'} {scopeLabel}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {rows.length === 0 ? (
          <Empty
            title={
              all.length === 0
                ? 'No decisions or action items on these calls yet.'
                : `Nothing here matches “${q}”.`
            }
            hint={
              all.length === 0
                ? 'They are written by the post-call summariser, so only recorded calls have them.'
                : undefined
            }
          />
        ) : (
          // Held to a readable measure. A decision is a sentence, and a
          // sentence set 180 characters wide is one nobody finishes.
          <ul className="mx-auto max-w-3xl space-y-2.5">
            {rows.map((r, i) => {
              const tone = markTone(r.item.type);
              const busy = pending === r.item.text;
              return (
                <li
                  key={i}
                  className="rounded-lg border px-3.5 py-3"
                  style={{ borderColor: c.line, background: c.card }}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className="rounded px-1.5 py-0.5"
                      style={{ background: tone.bg, color: tone.fg, fontFamily: mono, fontSize: '9px', letterSpacing: '0.1em' }}
                    >
                      {tone.label.toUpperCase()}
                    </span>
                    {r.item.timestampSeconds > 0 && (
                      <Stamp
                        seconds={r.item.timestampSeconds}
                        onSeek={() => onOpenCall(r.call, r.item.timestampSeconds)}
                        title="Open the call at this point"
                      />
                    )}
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed">{r.item.text}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => onOpenCall(r.call, r.item.timestampSeconds || null)}
                      className="text-left text-[11.5px] underline-offset-2 hover:underline"
                      style={{ color: c.graphite }}
                    >
                      {r.call.title ?? 'Untitled call'}
                    </button>
                    <span style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}>
                      {when(whenOf(r.call))}
                    </span>
                    {r.fromSummary && (
                      <span style={{ fontFamily: mono, fontSize: '9.5px', color: c.mute }} title="Read out of the call summary rather than the marked-items list">
                        from summary
                      </span>
                    )}
                    <span className="ml-auto flex gap-1.5">
                      {r.item.type === 'action' && onMakeTicket && (
                        <button
                          onClick={() => onMakeTicket(r.item, r.call)}
                          disabled={busy}
                          className="rounded border px-2 py-0.5 text-[10.5px] font-medium disabled:opacity-50"
                          style={{ borderColor: c.line, color: c.signal, background: c.paper, fontFamily: mono }}
                        >
                          {busy ? 'creating…' : '+ ticket'}
                        </button>
                      )}
                      {onRecord && (
                        <button
                          onClick={() => onRecord(r.item, r.call)}
                          disabled={busy}
                          className="rounded border px-2 py-0.5 text-[10.5px] disabled:opacity-50"
                          style={{ borderColor: c.line, color: c.graphite, background: c.paper, fontFamily: mono }}
                          title={recordLabel}
                        >
                          {recordLabel ?? 'record'}
                        </button>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
