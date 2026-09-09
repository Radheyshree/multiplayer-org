/**
 * The "via Slack" chip.
 *
 * Small, quiet, and never invented — every badge this renders came out of a
 * field on the row (see lib/provenance.ts). When the origin shipped a URL the
 * chip becomes a link to it, which is the whole promise of the surface: you can
 * see that a line came from a pull request AND go to that pull request, without
 * leaving the ticket.
 *
 * Deliberately NOT colour-coded per source. Eight hues in a message list reads
 * as a legend to memorise; the badge is a label, and the only colour in the
 * thread is reserved for state that changes.
 */
import type { Source } from '../../lib/provenance';
import { c, mono } from '../../lib/theme';

export function SourceBadge({ source, title }: { source: Source; title?: string }) {
  const inner = (
    <>
      <span aria-hidden style={{ opacity: 0.75 }}>
        {source.glyph}
      </span>
      <span>{source.label}</span>
      {source.detail ? (
        <span className="truncate" style={{ color: c.mute, maxWidth: '11rem' }}>
          {source.detail}
        </span>
      ) : null}
    </>
  );

  // The counterparty rides OUTSIDE the chip, in its own mark. Someone at
  // another company writing on your ticket is the whole point of this surface,
  // and burying their domain among the other qualifiers reads as one more
  // machine field rather than as "this is not us".
  const org = source.org ? (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-1.5 py-px leading-none"
      style={{
        fontFamily: mono,
        fontSize: '9.5px',
        color: c.attention,
        background: c.attentionSoft,
      }}
      title={`Outside your organisation — ${source.org}`}
    >
      {source.org}
    </span>
  ) : null;

  const style = {
    fontFamily: mono,
    fontSize: '9.5px',
    letterSpacing: '0.02em',
    color: c.mute,
    border: `1px solid ${c.line}`,
  } as const;

  const className = 'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px leading-none';

  // A badge that links somewhere must look like it does — the underline on
  // hover is the only affordance distinguishing the two, since colouring it
  // would make every ingested row shout.
  const chip = source.href ? (
    <a
      href={source.href}
      target="_blank"
      rel="noopener noreferrer"
      title={title ?? `Open in ${source.label.replace(/^via /, '')}`}
      className={`${className} hover:underline`}
      style={style}
      onClick={e => e.stopPropagation()}
    >
      {inner}
      <span aria-hidden style={{ opacity: 0.6 }}>
        ↗
      </span>
    </a>
  ) : (
    <span className={className} style={style} title={title}>
      {inner}
    </span>
  );

  if (!org) return chip;
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {chip}
      {org}
    </span>
  );
}

/**
 * The semantic tag Xyne's classifier assigned — QUESTION, DECISION, and so on.
 *
 * A second chip rather than part of the source badge, because they answer
 * different questions: one is where it came from, the other is what kind of
 * thing was said. Only the acts worth surfacing are rendered; STATUS_UPDATE on
 * a status-update message is noise.
 */
const ACT_LABEL: Record<string, string> = {
  QUESTION: 'Question',
  ANSWER: 'Answer',
  DECISION: 'Decision',
  COMMITMENT: 'Commitment',
  RESOLUTION: 'Resolution',
};

export function ActBadge({ act }: { act: string }) {
  const label = ACT_LABEL[act];
  if (!label) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-1.5 py-px leading-none"
      style={{
        fontFamily: mono,
        fontSize: '9.5px',
        color: c.signal,
        background: c.signalSoft,
      }}
    >
      {label}
    </span>
  );
}
