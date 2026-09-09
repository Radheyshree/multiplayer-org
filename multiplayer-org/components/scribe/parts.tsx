/**
 * The small pieces Scribe repeats.
 *
 * Kept together because each one encodes a decision that should be made once:
 * how a time is written, what a marked item's colour means, how a group of
 * people is shown when there is no room for names. Spreading them across the
 * files that use them is how two dates end up formatted differently on the same
 * screen.
 */
import type { ReactNode } from 'react';
import { initials, nameOf, personOf, tintFor } from '../../lib/people';
import { c, eyebrow, mono } from '../../lib/theme';
import { clock, type MarkedItem } from '../../lib/calls';

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
