/**
 * Provenance — the "via Slack" / "via Email" badge from the design.
 *
 * The label comes straight from search's `docType`, so a badge is never
 * guesswork: it is the source the record was actually indexed under.
 */
import { cn } from '../lib/utils';

type Look = { label: string; glyph: string; className: string };

const LOOKS: Record<string, Look> = {
  mail: { label: 'via Email', glyph: '✉', className: 'text-rose-600 dark:text-rose-400' },
  email: { label: 'via Email', glyph: '✉', className: 'text-rose-600 dark:text-rose-400' },
  chat: { label: 'via Chat', glyph: '◈', className: 'text-violet-600 dark:text-violet-400' },
  message: { label: 'via Chat', glyph: '◈', className: 'text-violet-600 dark:text-violet-400' },
  conversation: { label: 'via Chat', glyph: '◈', className: 'text-violet-600 dark:text-violet-400' },
  ticket: { label: 'via Ticket', glyph: '⬢', className: 'text-amber-600 dark:text-amber-400' },
  file: { label: 'via File', glyph: '▤', className: 'text-sky-600 dark:text-sky-400' },
  attachment: { label: 'via File', glyph: '▤', className: 'text-sky-600 dark:text-sky-400' },
  call: { label: 'via Call', glyph: '◉', className: 'text-emerald-600 dark:text-emerald-400' },
  user: { label: 'Person', glyph: '☺', className: 'text-slate-600 dark:text-slate-400' },
  channel: { label: 'Channel', glyph: '#', className: 'text-slate-600 dark:text-slate-400' },
};

export function lookFor(docType: string): Look {
  return (
    LOOKS[docType?.toLowerCase()] ?? {
      label: docType || 'unknown',
      glyph: '•',
      className: 'text-muted-foreground',
    }
  );
}

export function Provenance({ docType, className }: { docType: string; className?: string }) {
  const look = lookFor(docType);
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', look.className, className)}>
      <span aria-hidden>{look.glyph}</span>
      {look.label}
    </span>
  );
}

/** Compact form for dense lists — glyph and raw type only. */
export function ProvenanceDot({ docType }: { docType: string }) {
  const look = lookFor(docType);
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px]', look.className)}>
      <span aria-hidden>{look.glyph}</span>
      {docType}
    </span>
  );
}
