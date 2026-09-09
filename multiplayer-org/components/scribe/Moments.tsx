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
import type { MarkedItem } from '../../lib/calls';
import type { TranscriptLine } from '../../lib/callsBeyondSdk';
import { lineAt } from '../../lib/callsBeyondSdk';
import { c, mono } from '../../lib/theme';
import { Empty, Eyebrow, markTone, Stamp } from './parts';

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
