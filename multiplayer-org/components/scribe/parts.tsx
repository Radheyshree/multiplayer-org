import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { c, eyebrow, mono } from '../../lib/theme';
import { clock, isActionSection, lineAt, parseMarked, parseSummary, plain, segmentAt, splitCitations, whenOf, type Call, type CitationSegment, type MarkedItem, type SummarySection, type TranscriptLine } from '../../lib/calls';
import { initials, nameOf, personOf, tintFor } from '../../lib/people';

/* ---- from components/scribe/parts.tsx --------------------------------- */
/**
 * The small pieces Scribe repeats.
 *
 * Kept together because each one encodes a decision that should be made once:
 * how a time is written, what a marked item's colour means, how a group of
 * people is shown when there is no room for names. Spreading them across the
 * files that use them is how two dates end up formatted differently on the same
 * screen.
 */

/**
 * A date a person can place without doing arithmetic.
 *
 * Absolute for anything older than a week, relative inside it — "Tuesday,
 * 11:00" locates a meeting in memory far better than "4 days ago", and
 * "yesterday" beats a date for anything recent.
 */
export function when(ms: number | null | undefined): string {
  if (!ms) return 'no date';
  const d = new Date(ms);
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  if (days < 7 && days > 0) return `${d.toLocaleDateString([], { weekday: 'long' })}, ${time}`;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })}, ${time}`;
}

/** The day a call belongs to, for list grouping. */
export function dayOf(ms: number | null | undefined): string {
  if (!ms) return 'Undated';
  const d = new Date(ms);
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7 && days > 0) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

/** `4043871` → `1h 7m`. Short enough to sit in a row of metadata. */
export function duration(ms: number | null | undefined): string | null {
  if (!ms || ms < 1000) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * The instrument line under a title — id-ish facts, scanned not read.
 *
 * Takes its parts as a LIST rather than as children, and inserts the separators
 * itself. Writing `{a}{b ? ' \u00b7 ' + b : ''}` inline looks simpler and is
 * how this line grew a stray trailing "\u00b7" whenever the last part was
 * absent: an empty string is still a flex item, and the separator had already
 * been written by the part before it. Falsy parts are dropped here, so a
 * missing fact leaves no trace.
 */
export function Meta({ parts }: { parts: ReactNode[] }) {
  const kept = parts.filter(x => x !== null && x !== undefined && x !== false && x !== '');
  return (
    <p className="flex flex-wrap items-center gap-x-1 gap-y-0.5" style={{ fontFamily: mono, fontSize: '10.5px', color: c.mute }}>
      {kept.map((part, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span aria-hidden>·</span>}
          {part}
        </span>
      ))}
    </p>
  );
}

export function Eyebrow({ children, tone }: { children: ReactNode; tone?: string }) {
  return <div style={{ ...eyebrow, color: tone ?? c.graphite }}>{children}</div>;
}

/**
 * A row of people as overlapping initials.
 *
 * Names are resolved through the shared directory rather than read off the
 * call: `listParticipants` returns `displayName: null` on every row, so a chip
 * that trusts the payload says "Unknown" for everyone. `title` carries the real
 * name for anyone who hovers, which is what makes the compact form honest.
 */
export function Faces({ ids, max = 5, size = 20 }: { ids: string[]; max?: number; size?: number }) {
  if (!ids.length) return null;
  const shown = ids.slice(0, max);
  const rest = ids.length - shown.length;
  return (
    <span className="flex items-center" aria-label={`${ids.length} on this call`}>
      {shown.map((id, i) => (
        <span
          key={id}
          title={nameOf(id)}
          className="grid shrink-0 place-items-center rounded-full"
          style={{
            width: size,
            height: size,
            marginLeft: i ? -6 : 0,
            background: tintFor(id),
            color: '#fff',
            fontFamily: mono,
            fontSize: size <= 20 ? '8px' : '9px',
            border: `1.5px solid ${c.paper}`,
            zIndex: max - i,
          }}
        >
          {initials(nameOf(id))}
        </span>
      ))}
      {rest > 0 && (
        <span className="ml-1.5" style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}>
          +{rest}
        </span>
      )}
    </span>
  );
}

/** One person, named. */
export function Person({ id, sub }: { id: string; sub?: string | null }) {
  const p = personOf(id);
  return (
    <span
      className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1"
      style={{ background: c.card, border: `1px solid ${c.line}` }}
    >
      <span
        className="grid size-5 shrink-0 place-items-center rounded-full"
        style={{ background: tintFor(id), color: '#fff', fontFamily: mono, fontSize: '8px' }}
      >
        {initials(p.name)}
      </span>
      <span className="text-[12px]">{p.name}</span>
      {sub && (
        <span style={{ fontFamily: mono, fontSize: '9.5px', color: c.mute }}>{sub}</span>
      )}
    </span>
  );
}

/**
 * What a marked item's colour means.
 *
 * Three kinds share one column and they are not the same thing: a DECISION is
 * settled, an ACTION is owed, a MOMENT is someone saying "look at this". They
 * get the three semantic tokens the rest of the app already uses for exactly
 * those senses, so the meaning carries across surfaces.
 */
export function markTone(type: MarkedItem['type']): { fg: string; bg: string; label: string } {
  if (type === 'decision') return { fg: c.signal, bg: c.signalSoft, label: 'Decision' };
  if (type === 'action') return { fg: c.attention, bg: c.attentionSoft, label: 'Action' };
  return { fg: c.agent, bg: c.agentSoft, label: 'Moment' };
}

/**
 * A timestamp you can press.
 *
 * Used for citations and for marked moments alike, because they are the same
 * gesture: "show me where in the call this came from". Rendered as a button
 * only when it can actually go somewhere — an unresolvable citation is a bare
 * marker, not a control that does nothing when pressed.
 */
export function Stamp({
  seconds,
  onSeek,
  title,
  subtle,
}: {
  seconds: number | null;
  onSeek?: (seconds: number) => void;
  title?: string;
  subtle?: boolean;
}) {
  const label = seconds === null ? '·' : clock(seconds);
  const style = {
    fontFamily: mono,
    fontSize: '9.5px',
    background: subtle ? 'transparent' : c.inkSoft,
    color: subtle ? c.mute : c.graphite,
    border: `1px solid ${subtle ? 'transparent' : c.line}`,
    marginInline: '1px',
  };
  if (seconds === null || !onSeek) {
    return (
      <span className="rounded px-1 py-0.5 align-middle" style={style} title={title}>
        {label}
      </span>
    );
  }
  return (
    <button
      onClick={() => onSeek(seconds)}
      className="rounded px-1 py-0.5 align-middle transition-colors hover:brightness-95"
      style={{ ...style, color: c.signal, borderColor: c.line }}
      title={title ?? 'Jump to this point in the transcript'}
    >
      {label}
    </button>
  );
}

/** An empty state that says what would fill it. */
export function Empty({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="px-8 py-16 text-center">
      <p className="text-[13px]" style={{ color: c.graphite }}>
        {title}
      </p>
      {hint && (
        <p className="mx-auto mt-1.5 max-w-sm text-[12px] leading-relaxed" style={{ color: c.mute }}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** The segmented control the rest of the app uses for mode switches. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ id: T; label: string; count?: number }>;
  onChange: (id: T) => void;
}) {
  // `aria-pressed` because the selected state is carried entirely by colour —
  // a background swap and a slightly darker text. That is legible to someone
  // looking at it and invisible to a screen reader, and it is the only signal
  // there is.
  return (
    <div className="flex shrink-0 rounded-md p-0.5" style={{ background: c.ink, border: `1px solid ${c.line}` }}>
      {options.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className="rounded px-2.5 py-1 text-[12px] font-medium whitespace-nowrap"
          style={{
            background: value === o.id ? c.card : 'transparent',
            color: value === o.id ? c.text : c.graphite,
          }}
        >
          {o.label}
          {typeof o.count === 'number' && (
            <span className="ml-1.5" style={{ fontFamily: mono, fontSize: '9.5px', color: c.mute }}>
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * The mark on anything this app got from outside the SDK.
 *
 * Small, and load-bearing. This app's claim is that it is built on
 * `@xyne/spaces-sdk`; the transcript is the one thing it cannot get there. A
 * reader who cannot tell which parts of the screen are SDK-backed cannot check
 * that claim, so the parts that are not say so, once, where they appear.
 */
export function BeyondSdk({ children }: { children?: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5"
      style={{ ...eyebrow, fontSize: '9px', background: c.inkSoft, color: c.mute, border: `1px dashed ${c.line}` }}
      title="Not available through @xyne/spaces-sdk — see SCRIBE-SDK-GAPS.md"
    >
      {children ?? 'beyond the sdk'}
    </span>
  );
}

/* ---- from components/scribe/Decisions.tsx ----------------------------- */
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

/* ---- from components/scribe/Moments.tsx ------------------------------- */
/**
 * What the call produced, on the call's own clock.
 *
 * `markedItems` is the most underused field on a call row: the post-call
 * pipeline extracts every decision and every commitment, stamps each with the
 * offset it happened at, and writes them to an untyped JSON column that the
 * SDK's `Call` type does not declare and nothing outside the dashboard reads.
 * 73 of them across 19 recordings here. They are the answer to "what came out
 * of that meeting" and they were sitting one field away.
 *
 * Two things happen on this panel that the dashboard cannot do, both because it
 * has no idea a ticket exists:
 *   — an ACTION becomes a real ticket on the open track, seeded with the
 *     commitment and the line from the call it came from;
 *   — a DECISION is posted into a ticket's ledger, timestamped, so the reason
 *     for a choice outlives everyone's memory of which call it was made on.
 *
 * `timestampSeconds: 0` means "unplaced", not "at the very start" — the
 * extractor does not always locate what it found, and one older recording here
 * has all five of its items at 0. Unplaced items are grouped apart rather than
 * stacked at the top of the timeline pretending to be the first thing said.
 */

export interface MomentsProps {
  items: MarkedItem[];
  /** For quoting what was said at a moment. Empty when there is no transcript. */
  lines: TranscriptLine[];
  onSeek?: (seconds: number) => void;
  /** Create a ticket from an action item. Absent when there is no track open. */
  onMakeTicket?: (item: MarkedItem) => void;
  /** Record an item in the focused ticket's ledger. Absent when none is focused. */
  onRecord?: (item: MarkedItem) => void;
  /** What `onRecord` will write to, for the button's label. */
  recordLabel?: string;
  pending?: string | null;
}

function Item({
  item,
  lines,
  onSeek,
  onMakeTicket,
  onRecord,
  recordLabel,
  pending,
}: { item: MarkedItem } & Omit<MomentsProps, 'items'>) {
  const tone = markTone(item.type);
  const placed = item.timestampSeconds > 0;
  const said = placed && lines.length ? lineAt(lines, item.timestampSeconds) : null;
  const busy = pending === item.text;
  return (
    <li className="flex gap-3">
      {/* The rail: a coloured node on a hairline, so a column of these reads as
          one timeline rather than as a stack of cards. */}
      <div className="flex w-8 shrink-0 flex-col items-center pt-1">
        <span className="size-2 shrink-0 rounded-full" style={{ background: tone.fg }} aria-hidden />
        <span className="mt-1 w-px flex-1" style={{ background: c.line }} aria-hidden />
      </div>
      <div className="min-w-0 flex-1 pb-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className="rounded px-1.5 py-0.5"
            style={{ background: tone.bg, color: tone.fg, fontFamily: mono, fontSize: '9px', letterSpacing: '0.1em' }}
          >
            {tone.label.toUpperCase()}
          </span>
          {placed ? (
            <Stamp seconds={item.timestampSeconds} onSeek={lines.length ? onSeek : undefined} />
          ) : (
            <span style={{ fontFamily: mono, fontSize: '9.5px', color: c.mute }} title="The extractor did not place this in the call">
              unplaced
            </span>
          )}
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed">{item.text || <em style={{ color: c.mute }}>Marked, with no note.</em>}</p>
        {/* What was actually being said when this was marked. The extracted line
            is a paraphrase; this is the evidence for it. */}
        {said && (
          <p
            className="mt-1.5 border-l-2 pl-2.5 text-[12px] leading-relaxed"
            style={{ borderColor: c.line, color: c.mute }}
          >
            <span style={{ fontFamily: mono, fontSize: '10px' }}>{said.speaker}:</span> “{said.text.slice(0, 220)}
            {said.text.length > 220 ? '…' : ''}”
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.type === 'action' && onMakeTicket && (
            <button
              onClick={() => onMakeTicket(item)}
              disabled={busy}
              className="rounded border px-2 py-0.5 text-[10.5px] font-medium disabled:opacity-50"
              style={{ borderColor: c.line, color: c.signal, background: c.card, fontFamily: mono }}
            >
              {busy ? 'creating…' : '+ ticket on this track'}
            </button>
          )}
          {onRecord && (
            <button
              onClick={() => onRecord(item)}
              disabled={busy}
              className="rounded border px-2 py-0.5 text-[10.5px] disabled:opacity-50"
              style={{ borderColor: c.line, color: c.graphite, background: c.card, fontFamily: mono }}
              title={recordLabel}
            >
              {recordLabel ?? 'record in ticket'}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export function Moments(props: MomentsProps) {
  const { items } = props;
  if (!items.length) {
    return (
      <Empty
        title="Nothing was marked on this call."
        hint="Decisions and action items are extracted after a call is recorded; moments are flagged by whoever is on it."
      />
    );
  }
  const placed = items.filter(i => i.timestampSeconds > 0);
  const unplaced = items.filter(i => i.timestampSeconds === 0);
  return (
    <div>
      {placed.length > 0 && (
        <ul>
          {placed.map((item, i) => (
            <Item key={`p${i}`} item={item} {...props} />
          ))}
        </ul>
      )}
      {unplaced.length > 0 && (
        <div className={placed.length ? 'mt-4' : ''}>
          <Eyebrow tone={c.mute}>Not placed in the call</Eyebrow>
          <ul className="mt-2.5">
            {unplaced.map((item, i) => (
              <Item key={`u${i}`} item={item} {...props} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---- from components/scribe/Summary.tsx ------------------------------- */
/**
 * The post-call summary, with its citations made useful.
 *
 * The summary arrives as markdown on the call row — `aiSummary`, a field the
 * SDK's `Call` type does not declare but the server sends on 21 of 25 calls
 * here. It is rendered as sections rather than as one blob because it is
 * generated from a template with a fixed section list, and a reader looking for
 * "what did we agree" should not have to read the recap first.
 *
 * THE CITATIONS ARE THE POINT. A summary sentence says "merge the Generate and
 * Launch steps" and carries `[clf-01:22][clf-03:55]` — the moments in the call
 * that claim came from. Left as text they are noise, which is why every export
 * path in the real dashboard strips them. Rendered as controls they turn the
 * summary into an index INTO the call: press one and the transcript scrolls to
 * what was actually said.
 *
 * Two token forms exist and only one is self-describing. `[clf-04:18]` is an
 * offset and resolves on its own. `[clf-87]` is a segment number and needs the
 * citation index from the transcript layer — so when that layer has nothing,
 * the numeric ones render as inert markers rather than as buttons that lie.
 */

export interface SummaryProps {
  sections: SummarySection[];
  /** Resolves `[clf-N]` tokens. Absent when the transcript layer had nothing. */
  segments?: CitationSegment[];
  /** Jump the transcript to an offset. Absent when there is no transcript. */
  onSeek?: (seconds: number) => void;
  /** Offered on rows in an action-items section. */
  onMakeTicket?: (text: string) => void;
  /** Which action row is mid-flight, so its button can say so. */
  pendingTicket?: string | null;
}

/** A line of summary text with its citations rendered where they were written. */
function Line({
  text,
  segments,
  onSeek,
}: {
  text: string;
  segments?: CitationSegment[];
  onSeek?: (seconds: number) => void;
}) {
  const parts = splitCitations(text);
  return (
    <>
      {parts.map((part, i) => {
        if ('text' in part) return <Fragment key={i}>{part.text}</Fragment>;
        const { cite } = part;
        // A segment number becomes a time only if the citation index is here.
        const seg = cite.segment !== null ? segmentAt(segments, cite.segment) : null;
        const seconds =
          cite.seconds ??
          (seg ? seg.timestamp.split(':').map(Number).reduce((a, p) => a * 60 + p, 0) : null);
        // No space around the chip: it is punctuation, and a citation that
        // drifts away from the clause it supports stops reading as attached to
        // it. `Stamp` carries its own small margin instead.
        return (
          <Stamp
            key={i}
            seconds={seconds}
            onSeek={seconds !== null ? onSeek : undefined}
            title={seg ? `${seg.speaker}: ${seg.snippet ?? ''}`.trim() : undefined}
          />
        );
      })}
    </>
  );
}

export function Summary({ sections, segments, onSeek, onMakeTicket, pendingTicket }: SummaryProps) {
  return (
    <div className="space-y-6">
      {sections.map((s, si) => {
        const actions = Boolean(onMakeTicket) && isActionSection(s);
        return (
          <section key={si}>
            {s.title && <Eyebrow>{s.title}</Eyebrow>}
            {s.isList ? (
              <ul className="mt-2 space-y-1.5">
                {s.lines.map((line, li) => (
                  <li key={li} className="flex items-start gap-2.5">
                    <span
                      className="mt-[7px] size-1 shrink-0 rounded-full"
                      style={{ background: actions ? c.attention : c.mute }}
                      aria-hidden
                    />
                    <span className="flex-1 text-[13px] leading-relaxed">
                      <Line text={line} segments={segments} onSeek={onSeek} />
                    </span>
                    {/* The one move the dashboard cannot make: an action item
                        that was only ever text becomes a ticket on this track. */}
                    {actions && onMakeTicket && (
                      <button
                        onClick={() => onMakeTicket(line)}
                        disabled={pendingTicket === line}
                        className="mt-px shrink-0 rounded border px-1.5 py-0.5 text-[10.5px] font-medium disabled:opacity-50"
                        style={{ borderColor: c.line, color: c.signal, background: c.card, fontFamily: mono }}
                        title="Create a ticket on this track from this action item"
                      >
                        {pendingTicket === line ? 'creating…' : '+ ticket'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-2 space-y-2">
                {s.lines.map((line, li) => (
                  <p key={li} className="text-[13px] leading-relaxed">
                    <Line text={line} segments={segments} onSeek={onSeek} />
                  </p>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ---- from components/scribe/Transcript.tsx ---------------------------- */
/**
 * The transcript, used as the playback surface.
 *
 * There is no play button and that is a decision, not an omission: the audio is
 * served as an authenticated byte stream with no seekable URL, so an `<audio>`
 * element cannot fetch it and the whole file would have to be downloaded before
 * the first second played (see MEDIA_NOTE in lib/callsBeyondSdk.ts). Text is
 * the better surface anyway for what people come to a recording to do — find
 * the bit where a thing was decided, and quote it somewhere it will be read.
 *
 * So this behaves like a player: it seeks (a citation or a moment scrolls the
 * transcript to that line and holds it), it scrubs (the speaker filter and the
 * search box narrow what you are looking at), and it exports (any line can be
 * quoted straight into the focused ticket, attributed and timestamped).
 */

export interface TranscriptProps {
  lines: TranscriptLine[];
  /**
   * Where to scroll to, wrapped in an object on purpose.
   *
   * A bare `number` cannot express "seek to 4:18 again": React bails out of a
   * state update to the same primitive, and even past that, an unchanged
   * dependency does not re-run the effect. So pressing the same citation a
   * second time — after scrolling away, which is exactly when you would — did
   * nothing at all. A fresh object is a fresh reference every time.
   */
  seekTo: { at: number } | null;
  /** Quote one line into the focused ticket. Absent when nothing is focused. */
  onQuote?: (line: TranscriptLine) => void;
  /** What the quote button should say, e.g. "Quote into EULER-80740". */
  quoteLabel?: string;
}

export function Transcript({ lines, seekTo, onQuote, quoteLabel }: TranscriptProps) {
  const [q, setQ] = useState('');
  const [speaker, setSpeaker] = useState('');
  /** The line a seek landed on. Held so it can be marked — scrolling something
   *  into view without saying which row you meant leaves the reader hunting. */
  const [landed, setLanded] = useState<number | null>(null);
  const rows = useRef(new Map<number, HTMLDivElement>());

  const speakers = useMemo(() => {
    const seen: string[] = [];
    for (const l of lines) if (l.speaker && !seen.includes(l.speaker)) seen.push(l.speaker);
    return seen;
  }, [lines]);

  /** A new call is a new transcript: drop the previous one's landing mark and
   *  its filters, so the panel does not open pre-narrowed to nothing. */
  useEffect(() => {
    setLanded(null);
    setQ('');
    setSpeaker('');
  }, [lines]);

  const needle = q.trim().toLowerCase();
  const visible = useMemo(
    () =>
      lines.filter(
        l => (!speaker || l.speaker === speaker) && (!needle || l.text.toLowerCase().includes(needle)),
      ),
    [lines, speaker, needle],
  );

  /**
   * Seek.
   *
   * The target is the line at or before the offset — a citation at 04:18 lands
   * inside the utterance that was in progress, not on the next one to start.
   * Filters are cleared first: seeking into a filtered view would scroll to a
   * row that is not rendered, which reads as the button being broken.
   */
  useEffect(() => {
    if (seekTo === null || !lines.length) return;
    const to = seekTo.at;
    setQ('');
    setSpeaker('');
    let target = lines[0];
    for (const l of lines) {
      if (l.seconds <= to) target = l;
      else break;
    }
    setLanded(target.seconds);
    // The row may not be mounted yet on the first render after a pane switch.
    const show = () => rows.current.get(target.seconds)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    show();
    const t = setTimeout(show, 80);
    return () => clearTimeout(t);
  }, [seekTo, lines]);

  if (!lines.length) {
    return (
      <Empty
        title="No transcript for this call."
        hint="Only recorded calls are transcribed. Live and scheduled calls have nothing to read yet."
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 pb-3">
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Find in this transcript…"
          className="h-8 w-56 rounded-md px-2 text-[12.5px] outline-none"
          style={{ background: c.card, border: `1px solid ${c.line}` }}
        />
        <select
          value={speaker}
          onChange={e => setSpeaker(e.target.value)}
          className="h-8 max-w-[12rem] rounded-md px-2 text-[12.5px] outline-none"
          style={{ background: c.card, border: `1px solid ${c.line}` }}
        >
          <option value="">Everyone ({speakers.length})</option>
          {speakers.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}>
          {visible.length === lines.length ? `${lines.length} lines` : `${visible.length}/${lines.length}`}
        </span>
        <BeyondSdk />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {visible.length === 0 ? (
          <Empty title={`Nothing in this call matches “${q}”.`} />
        ) : (
          visible.map(l => {
            const hit = Boolean(needle) && l.text.toLowerCase().includes(needle);
            const here = landed === l.seconds;
            return (
              <div
                key={`${l.seconds}-${l.speaker}-${l.text.slice(0, 12)}`}
                // Cleared on unmount as well as set on mount. Without the
                // delete, a row from a previous call stays in the map under the
                // same offset, and a seek scrolls a detached node — which does
                // nothing at all, silently.
                ref={el => {
                  if (el) rows.current.set(l.seconds, el);
                  else rows.current.delete(l.seconds);
                }}
                className="group flex gap-3 rounded-md px-2 py-1.5"
                style={{
                  background: here || hit ? c.signalSoft : 'transparent',
                  boxShadow: here ? `inset 2px 0 0 ${c.signal}` : undefined,
                }}
              >
                <span
                  className="w-11 shrink-0 pt-[3px] text-right"
                  style={{ fontFamily: mono, fontSize: '10px', color: here ? c.signal : c.mute }}
                >
                  {l.stamp}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="text-[12px] font-medium" style={{ color: c.graphite }}>
                    {l.speaker}
                  </span>
                  <p className="text-[13px] leading-relaxed">{l.text}</p>
                </div>
                {onQuote && (
                  <button
                    onClick={() => onQuote(l)}
                    className="mt-px h-5 shrink-0 self-start rounded border px-1.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                    style={{ borderColor: c.line, color: c.signal, background: c.card, fontFamily: mono }}
                    title={quoteLabel ?? 'Quote into the focused ticket'}
                  >
                    quote
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
