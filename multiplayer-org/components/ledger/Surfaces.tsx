/**
 * Which systems this one piece of work is spread across.
 *
 * The thread already badges each line with its origin, but you have to read the
 * whole thread to learn that a ticket involves Bitbucket, Zoho and a call — and
 * "how many places is this living in" is the question the surface exists to
 * answer. So it is answered once, at the top, in a strip you can take in
 * without scrolling.
 *
 * Two rules keep it honest:
 *
 *   NOTHING IS INVENTED. Every chip is a system some row on this ticket
 *   actually named. A ticket that has only ever been touched inside Xyne shows
 *   one chip, and the strip hides itself rather than implying an integration
 *   that is not there.
 *
 *   THE OUTSIDE IS MARKED. Xyne is a chip like the others but is never counted
 *   as a surface: the point of the strip is the work that ISN'T here. When a
 *   counterparty organisation appears on a row, its domain rides on the chip,
 *   because "a person at billdesk.com wrote on your ticket" is the single most
 *   load-bearing fact this app can show.
 */
import { sourceOf, type ChannelLike, type MessageLike } from '../../lib/provenance';
import { parseUpdate } from '../../lib/appUpdate';
import { c, mono, eyebrow } from '../../lib/theme';
import { SurfaceIcon } from './SurfaceIcon';
import type { MailThread } from '../../lib/mailthread';

export interface Surface {
  key: string;
  label: string;
  glyph: string;
  /** What the icon mapping keys off — the resolved source, not the chip. */
  icon: { id: string; system?: { id: string } };
  count: number;
  external: boolean;
  /** The most recent row that carried a way back out. */
  href?: string;
  orgs: string[];
}

/**
 * Which of `SourceId`'s values mean "this happened somewhere else".
 *
 * `app`, `agent` and `automation` are Xyne actors, not other products — an app
 * in this shell recording a stage move is Xyne doing Xyne things. Counting them
 * as surfaces put "◆ App 5" at the head of the strip, ahead of Bitbucket, and
 * inflated the headline number this whole component exists to make honest.
 */
const OUTSIDE = new Set(['email', 'slack', 'code', 'call', 'social']);

/** Roll the thread up into one chip per system. */
export function surfacesOf(messages: MessageLike[], channel?: ChannelLike | null): Surface[] {
  const byKey = new Map<string, Surface>();
  for (const m of messages) {
    const appId = parseUpdate(m.content ?? '').appId;
    const src = sourceOf(m, channel, appId);
    // Key on the resolved system where there is one, so "via Bitbucket" and
    // "via GitHub" never collapse into a single "code" chip — the whole value
    // of the strip is that it names the actual product.
    const key = src.system?.id ?? src.id;
    const existing = byKey.get(key);
    const label = src.system?.name ?? src.label.replace(/^(via|mentions) /, '');
    const entry: Surface = existing ?? {
      key,
      label,
      glyph: src.glyph,
      icon: { id: src.id, ...(src.system ? { system: { id: src.system.id } } : {}) },
      count: 0,
      external: src.system?.external ?? OUTSIDE.has(key),
      orgs: [],
    };
    entry.count += 1;
    // Last write wins: the newest row is the most useful thing to open.
    if (src.href) entry.href = src.href;
    if (src.org && !entry.orgs.includes(src.org)) entry.orgs.push(src.org);
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort(rank);
}

/**
 * Outside first, then by weight, and Xyne dead last whatever its count.
 *
 * Xyne is the floor, not a finding: every ticket has Xyne rows, so letting a
 * large Xyne count sort above a single Bitbucket one would bury the only chip
 * anybody is reading the strip for.
 */
function rank(a: Surface, b: Surface): number {
  if ((a.key === 'xyne') !== (b.key === 'xyne')) return a.key === 'xyne' ? 1 : -1;
  return Number(b.external) - Number(a.external) || b.count - a.count;
}

/**
 * Fold what the email rows know into what the messages said.
 *
 * The thread can only report "via Email" for an ingested message, because the
 * message itself carries no provider. The Email rows do — `externalThreadId` is
 * Zoho's ticket id or Gmail's thread id — so when a mail thread is present it
 * OVERRIDES the generic chip with the real system, keeps the message count, and
 * contributes the counterparties from the recipient lists, which is where most
 * of them are: a cc list is where you find out three companies are on this.
 */
function withMail(surfaces: Surface[], mail: MailThread | null): Surface[] {
  if (!mail) return surfaces;
  const generic = surfaces.findIndex(s => s.key === 'email');
  const named: Surface = {
    key: mail.provider?.id ?? 'email',
    label: mail.provider?.name ?? 'Email',
    glyph: mail.provider?.glyph ?? '✉',
    icon: { id: 'email', ...(mail.provider ? { system: { id: mail.provider.id } } : {}) },
    // The email count is the truth about how much mail there is; the message
    // count double-counts long mails, which the pipeline splits into chunks.
    count: mail.count,
    external: true,
    ...(mail.href ?? (generic >= 0 ? surfaces[generic].href : undefined)
      ? { href: mail.href ?? surfaces[generic]?.href }
      : {}),
    orgs: mail.orgs,
  };
  const rest = surfaces.filter((_, i) => i !== generic);
  return [named, ...rest].sort(rank);
}

export function Surfaces({
  messages,
  channel,
  mail = null,
}: {
  messages: MessageLike[];
  channel?: ChannelLike | null;
  mail?: MailThread | null;
}) {
  const surfaces = withMail(surfacesOf(messages, channel), mail);
  const outside = surfaces.filter(s => s.external);
  // One system is not a spread. Saying "across surfaces: Xyne" would be the
  // app congratulating itself for showing you a Xyne ticket.
  if (outside.length === 0) return null;

  // Who is on the mail that is not one of us. This is the line that answers
  // "why does this ticket matter" faster than any body text does.
  const outsiders = (mail?.participants ?? []).filter(p => p.org);

  return (
    <div
      className="shrink-0 px-3 py-1.5"
      style={{ borderBottom: `1px solid ${c.line}`, background: c.inkSoft }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
      <span style={{ ...eyebrow, fontSize: '9px', color: c.graphite }}>across surfaces</span>
      {surfaces.map(s => {
        const body = (
          <>
            <SurfaceIcon
              source={s.icon as unknown as Parameters<typeof SurfaceIcon>[0]['source']}
              size={11}
            />
            <span>{s.label}</span>
            <span className="tabular-nums" style={{ opacity: 0.6 }}>
              {s.count}
            </span>
            {s.orgs.length ? (
              <span style={{ color: c.attention }}>{s.orgs.join(' · ')}</span>
            ) : null}
            {s.href ? (
              <span aria-hidden style={{ opacity: 0.6 }}>
                ↗
              </span>
            ) : null}
          </>
        );
        const style = {
          fontFamily: mono,
          fontSize: '9.5px',
          color: s.external ? c.text : c.mute,
          border: `1px solid ${s.external ? c.line : 'transparent'}`,
          background: s.external ? c.card : 'transparent',
        } as const;
        const cls = 'inline-flex items-center gap-1 rounded-full px-1.5 py-px leading-none';
        return s.href ? (
          <a
            key={s.key}
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open the most recent ${s.label} item`}
            className={`${cls} hover:underline`}
            style={style}
          >
            {body}
          </a>
        ) : (
          <span key={s.key} className={cls} style={style}>
            {body}
          </span>
        );
      })}
      </div>

      {outsiders.length ? (
        <p
          className="mt-1 truncate"
          style={{ fontFamily: mono, fontSize: '9.5px', color: c.mute }}
          title={outsiders.map(p => p.address).join(', ')}
        >
          <span style={{ color: c.graphite }}>outside this org</span>{' '}
          {outsiders
            .slice(0, 4)
            .map(p => `${p.address}${p.wrote ? '' : ' (cc)'}`)
            .join(' · ')}
          {outsiders.length > 4 ? ` · +${outsiders.length - 4} more` : ''}
        </p>
      ) : null}
    </div>
  );
}
