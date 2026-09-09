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
import { Fragment } from 'react';
import {
  isActionSection,
  splitCitations,
  type SummarySection,
} from '../../lib/calls';
import type { CitationSegment } from '../../lib/callsBeyondSdk';
import { segmentAt } from '../../lib/callsBeyondSdk';
import { c, mono } from '../../lib/theme';
import { Eyebrow, Stamp } from './parts';

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
