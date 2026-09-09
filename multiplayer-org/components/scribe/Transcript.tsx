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
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TranscriptLine } from '../../lib/callsBeyondSdk';
import { c, mono } from '../../lib/theme';
import { BeyondSdk, Empty } from './parts';

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
