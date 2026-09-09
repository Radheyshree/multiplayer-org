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
import type { SystemId } from '../../lib/origin';

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
