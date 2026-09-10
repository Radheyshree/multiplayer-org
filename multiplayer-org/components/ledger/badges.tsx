import { Bot, Cog, Diamond, ExternalLink, GitPullRequest, Hash, Mail, Megaphone, Phone, Sparkles, Store } from 'lucide-react';
import { c, eyebrow, mono } from '../../lib/theme';
import { parseUpdate, sourceOf, type ChannelLike, type MessageLike, type Source, type SystemId } from '../../lib/origin';
import { type MailThread } from '../../lib/mailbridge';

/* ---- from components/ledger/BrandMark.tsx ----------------------------- */
/**
 * The logo of the product a line came from.
 *
 * The reference design puts a real brand mark beside every "via X", and that is
 * the point: people recognise the Slack hash or the Gmail envelope without
 * reading a word, which is exactly what you want on a surface where every row
 * carries an origin.
 *
 * INLINE SVG, NOT IMAGES. The published app runs in a sandbox with no network
 * for assets — an <img src="https://…/slack.svg"> would simply not load. So each
 * mark is a path drawn here, in the brand's own colours, and costs no request.
 *
 * These are the official marks, used nominatively to identify the integration
 * they name. Where a brand's logo is a wordmark rather than a glyph (Zoho) there
 * is no honest way to draw it at 14px, so those fall back to a coloured envelope
 * in the brand's colour — recognisable as mail, and not pretending to be a logo
 * it is not.
 */

const sizeProps = (s: number) => ({ width: s, height: s, style: { display: 'block', flexShrink: 0 } });

/** Slack — the four-colour mark. */
function Slack({ s }: { s: number }) {
  return (
    <svg {...sizeProps(s)} viewBox="0 0 127 127" aria-hidden>
      <path d="M27.2 80a13.2 13.2 0 1 1-13.2-13.2h13.2V80z" fill="#E01E5A" />
      <path d="M33.8 80a13.2 13.2 0 0 1 26.4 0v33a13.2 13.2 0 0 1-26.4 0V80z" fill="#E01E5A" />
      <path d="M47 27.2A13.2 13.2 0 1 1 60.2 14v13.2H47z" fill="#36C5F0" />
      <path d="M47 33.8a13.2 13.2 0 0 1 0 26.4H14a13.2 13.2 0 0 1 0-26.4h33z" fill="#36C5F0" />
      <path d="M99.8 47a13.2 13.2 0 1 1 13.2 13.2H99.8V47z" fill="#2EB67D" />
      <path d="M93.2 47a13.2 13.2 0 0 1-26.4 0V14a13.2 13.2 0 0 1 26.4 0v33z" fill="#2EB67D" />
      <path d="M80 99.8a13.2 13.2 0 1 1-13.2 13.2V99.8H80z" fill="#ECB22E" />
      <path d="M80 93.2a13.2 13.2 0 0 1 0-26.4h33a13.2 13.2 0 0 1 0 26.4H80z" fill="#ECB22E" />
    </svg>
  );
}

/** Gmail — the envelope with the red M. */
function Gmail({ s }: { s: number }) {
  return (
    <svg {...sizeProps(s)} viewBox="0 0 24 18" aria-hidden>
      <path d="M1.64 18h3.27V9.95L.5 6.68v9.68C.5 17.26 1.01 18 1.64 18z" fill="#4285F4" />
      <path d="M19.09 18h3.27c.63 0 1.14-.74 1.14-1.64V6.68l-4.41 3.27V18z" fill="#34A853" />
      <path d="M19.09 1.64v8.31l4.41-3.27V2.46c0-1.52-1.6-2.38-2.7-1.47l-1.71 1.28z" fill="#FBBC04" />
      <path d="M4.91 9.95V1.64L12 6.95l7.09-5.31v8.31L12 15.27z" fill="#EA4335" />
      <path d="M.5 2.46v4.22l4.41 3.27V1.64L3.2.99C2.1.08.5.94.5 2.46z" fill="#C5221F" />
    </svg>
  );
}

/** GitHub — the octocat. */
function GitHub({ s }: { s: number }) {
  return (
    <svg {...sizeProps(s)} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#181717"
        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
      />
    </svg>
  );
}

/** Bitbucket — the bucket. */
function Bitbucket({ s }: { s: number }) {
  return (
    <svg {...sizeProps(s)} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#2684FF"
        d="M.778 1.213a.768.768 0 0 0-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 0 0 .77-.646l3.27-20.03a.768.768 0 0 0-.768-.891zM14.52 15.53H9.522L8.17 8.466h7.561z"
      />
    </svg>
  );
}

/** GitLab — the fox. */
function GitLab({ s }: { s: number }) {
  return (
    <svg {...sizeProps(s)} viewBox="0 0 24 24" aria-hidden>
      <path fill="#FC6D26" d="m12 21.42 3.68-11.33H8.32L12 21.42z" />
      <path fill="#E24329" d="M12 21.42 8.32 10.09H3.16L12 21.42z" />
      <path fill="#FCA326" d="M3.16 10.09 2.04 13.53a.76.76 0 0 0 .28.85L12 21.42 3.16 10.09z" />
      <path fill="#E24329" d="M3.16 10.09h5.16L6.1 3.26a.38.38 0 0 0-.72 0L3.16 10.09z" />
      <path fill="#E24329" d="m12 21.42 3.68-11.33h5.16L12 21.42z" />
      <path fill="#FCA326" d="m20.84 10.09 1.12 3.44a.76.76 0 0 1-.28.85L12 21.42l8.84-11.33z" />
      <path fill="#E24329" d="M20.84 10.09h-5.16l2.22-6.83a.38.38 0 0 1 .72 0l2.22 6.83z" />
    </svg>
  );
}

/**
 * A coloured envelope, for mail systems whose logo is a wordmark.
 *
 * Zoho and Outlook both identify themselves in text rather than with a glyph
 * that survives at this size. An envelope in the brand's colour says "mail from
 * that product" without inventing a logo for them.
 */
function Envelope({ s, fill }: { s: number; fill: string }) {
  return (
    <svg {...sizeProps(s)} viewBox="0 0 24 24" aria-hidden>
      <rect x="1.5" y="4" width="21" height="16" rx="2.5" fill={fill} />
      <path d="M3 7.5 12 13.5 21 7.5" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Xyne Claw — the agent.
 *
 * Drawn rather than taken: Claw ships no mark we can embed. Three strokes, which
 * reads as a claw at 14px and is distinct from every logo above.
 */
function Claw({ s }: { s: number }) {
  return (
    <svg {...sizeProps(s)} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="11" fill="var(--agent-soft, #EDE9FE)" />
      <path
        d="M8 6.5c1.2 2.4 1.6 5 1.2 7.6M12 5.5c.9 2.9.9 5.9 0 8.8M16 6.5c-1.2 2.4-1.6 5-1.2 7.6"
        stroke="var(--agent, #7C3AED)"
        strokeWidth="1.7"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M7.5 15.5c1.7 2.2 7.3 2.2 9 0"
        stroke="var(--agent, #7C3AED)"
        strokeWidth="1.7"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** Xyne itself — the diamond the rest of the app already uses. */
function Xyne({ s }: { s: number }) {
  return (
    <svg {...sizeProps(s)} viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2.5 21.5 12 12 21.5 2.5 12z" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/** Every system we can draw. `null` when there is no mark for it. */
export function BrandMark({ system, size = 14 }: { system?: SystemId | 'claw'; size?: number }) {
  switch (system) {
    case 'slack':
      return <Slack s={size} />;
    case 'gmail':
      return <Gmail s={size} />;
    case 'github':
      return <GitHub s={size} />;
    case 'bitbucket':
      return <Bitbucket s={size} />;
    case 'gitlab':
      return <GitLab s={size} />;
    case 'zoho':
      return <Envelope s={size} fill="#E42527" />;
    case 'outlook':
      return <Envelope s={size} fill="#0078D4" />;
    case 'claw':
      return <Claw s={size} />;
    case 'xyne':
      return <Xyne s={size} />;
    default:
      return null;
  }
}

/** Does a system have a real mark? Callers fall back to a generic icon if not. */
export const hasBrandMark = (system?: SystemId | 'claw'): boolean =>
  system !== undefined &&
  ['slack', 'gmail', 'github', 'bitbucket', 'gitlab', 'zoho', 'outlook', 'claw', 'xyne'].includes(
    system,
  );

/* ---- from components/ledger/SourceBadge.tsx --------------------------- */
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

export function SourceBadge({ source, title }: { source: Source; title?: string }) {
  // The product's own logo where we have one, a generic shape where we do not.
  // A brand mark is the thing people actually scan for; the words beside it are
  // for the cases the mark cannot cover.
  const brand = source.system?.id;
  const inner = (
    <>
      {hasBrandMark(brand) ? <BrandMark system={brand} size={13} /> : <SurfaceIcon source={source} size={11} />}
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

  // No pill. In the reference the source sits beside the name as ordinary text
  // next to a logo — boxing it made every row look like a form field, and with
  // a badge on every single line the boxes were most of what you saw.
  const style = {
    fontSize: '11.5px',
    color: c.mute,
  } as const;

  const className = 'inline-flex shrink-0 items-center gap-1 leading-none';

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

/* ---- from components/ledger/SurfaceIcon.tsx --------------------------- */
/**
 * A picture of where a line came from.
 *
 * The badges used to be text marks — ⑂ ✉ ◉ ◇ — chosen because they cost no
 * bundle and no network. They read as decoration. Nobody scanning a thread
 * decodes a glyph; they see a shape and know, or they read the words and are
 * slowed down. When every row carries a badge, that difference is the
 * difference between a thread you skim and a thread you parse.
 *
 * So: real icons, one per system, from lucide (already a dependency, and
 * tree-shaken to the handful named here). Deliberately NOT brand logos —
 * shipping a Bitbucket or Gmail mark would mean bundling someone's trademark
 * as a data URI, and the generic shapes are the ones people already know from
 * every other tool.
 *
 * The mapping is by SYSTEM first and category second, because "which product"
 * is what the reader wants and "which category" is only the fallback: a pull
 * request looks like a pull request whether it is on Bitbucket or GitHub, and
 * mail looks like mail whether it came through Zoho or Gmail.
 */

type Icon = typeof Mail;

const BY_SYSTEM: Partial<Record<SystemId, Icon>> = {
  bitbucket: GitPullRequest,
  github: GitPullRequest,
  gitlab: GitPullRequest,
  zoho: Mail,
  gmail: Mail,
  outlook: Mail,
  slack: Hash,
  ozonetel: Phone,
  playstore: Store,
  xyne: Diamond,
  web: ExternalLink,
};

const BY_CATEGORY: Record<string, Icon> = {
  code: GitPullRequest,
  email: Mail,
  slack: Hash,
  call: Phone,
  social: Megaphone,
  automation: Cog,
  agent: Sparkles,
  app: Bot,
  xyne: Diamond,
};

/** The icon for a resolved source. Never null — every source has a shape. */
export function SurfaceIcon({
  source,
  size = 11,
  className,
}: {
  source: Pick<Source, 'id' | 'system'>;
  size?: number;
  className?: string;
}) {
  const Glyph =
    (source.system ? BY_SYSTEM[source.system.id] : undefined) ??
    BY_CATEGORY[source.id] ??
    Diamond;
  return (
    <Glyph
      size={size}
      strokeWidth={2}
      className={className}
      aria-hidden
      // Icons sit on a text baseline beside 9.5px type; without this they push
      // the row a pixel taller than its neighbours and the badges stop aligning.
      style={{ display: 'block', flexShrink: 0 }}
    />
  );
}

/* ---- from components/ledger/Surfaces.tsx ------------------------------ */
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
