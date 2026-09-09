/**
 * Design tokens — a bridge onto the shell's palette, not a second palette.
 *
 * These names were originally a standalone hex palette for a separate shell.
 * That shell is gone: the app now runs inside the org shell, which draws from
 * the token set in index.css (`--background`, `--primary`, `--ok`, …) and
 * flips every one of them under `.dark`. A second hard-coded palette would be
 * two sources of truth, and the hex one would stay light while the rest of the
 * app went dark.
 *
 * So `c` keeps its keys — ~530 call sites, all of them still correct — and its
 * VALUES become `var(--…)` references. One palette, defined once, in the file
 * the shadcn components already read. Dark mode comes free.
 *
 * Colours stay applied as INLINE STYLES rather than Tailwind arbitrary values
 * (`bg-[var(--card)]`), and the reason is not what you would guess: the
 * published sandbox loads Tailwind v4's browser build and compiles classes at
 * runtime off DOM mutations, so a class first seen at runtime DOES get
 * compiled. LOCAL DEV is the strict one — @tailwindcss/vite scans source at
 * build time, so a dynamically constructed class works published and silently
 * fails on localhost. Inline styles sidestep the asymmetry in both directions.
 *
 * Static utilities for layout (`flex`, `px-3`, `rounded-md`) are fine in both
 * modes and are used everywhere; this is only about colour.
 */
export const c = {
  /** Page ground. */
  paper: 'var(--background)',
  /** A raised surface on the ground — cards, panes, rows. */
  card: 'var(--card)',
  /** Every hairline. */
  line: 'var(--border)',
  /** Primary reading colour. */
  text: 'var(--foreground)',
  /** Secondary prose — still meant to be read. */
  graphite: 'var(--secondary-foreground)',
  /** Labels, counts, timestamps — meant to be scanned, not read. */
  mute: 'var(--muted-foreground)',
  /** "This is live / this is selected." The only saturated accent. */
  signal: 'var(--primary)',
  /** Its tint, for selected rows and chips. */
  signalSoft: 'var(--accent)',
  /** Healthy, running, connected. */
  live: 'var(--ok)',
  /** Needs a person. Deliberately not the accent hue. */
  attention: 'var(--warn)',
  /** Something went wrong. */
  danger: 'var(--destructive)',
  /** An agent said this — distinct from both brand and status. */
  agent: 'var(--agent)',

  /**
   * What a message sits in.
   *
   * The reference puts every message in a rounded bubble rather than as text on
   * the page, and it is not decoration: with a badge, a name, a role and a
   * source on every row, the bubble is what tells you where one person's turn
   * ends and the next begins. The agent's is a shade warmer than a person's.
   */
  bubble: 'var(--bubble)',
  bubbleAgent: 'var(--bubble-agent)',

  /** Reads on top of `signal` — a filled primary control. */
  signalText: 'var(--primary-foreground)',
  /**
   * The dim behind a modal. Deliberately NOT theme-linked: a scrim must darken
   * the page in light mode and in dark mode alike, so tying it to
   * `--foreground` (which flips to near-white) would invert it into a flare.
   */
  scrim: 'rgb(0 0 0 / 0.45)',

  /** Tints of the semantic three, for banner and chip backgrounds. */
  liveSoft: 'var(--ok-soft)',
  attentionSoft: 'var(--warn-soft)',
  dangerSoft: 'var(--crit-soft)',
  agentSoft: 'var(--agent-soft)',

  /**
   * Recessed chrome: a strip that should sit BEHIND the content it frames
   * (browser tab bars, code blocks). Was a hard dark ink; as a token it
   * inverts with the theme instead of staying dark on a dark page.
   */
  ink: 'var(--muted)',
  inkSoft: 'var(--secondary)',
  inkLine: 'var(--border)',
} as const;

/** The instrument layer — ids, versions, counts, status. */
export const mono = 'var(--font-mono)';

/** A small-caps tracked label, for section headers and field names. */
export const eyebrow = {
  fontFamily: mono,
  fontSize: '10px',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
} as const;

/**
 * Priority as a colour, drawn from the same semantic tokens the shell's
 * `priorityTone()` uses for its badge classes (lib/directory.ts).
 *
 * Two mechanisms exist because two things are being coloured: a BADGE gets
 * `priorityTone()`'s Tailwind classes (background + text + ring in one), while
 * a bare glyph or a chip border needs a single colour value in an inline
 * style. Both read the same four tokens, so they cannot drift apart.
 */
export function priorityColor(priority: string | null | undefined): string {
  switch ((priority ?? '').toUpperCase()) {
    case 'P0':
    case 'URGENT':
    case 'CRITICAL':
    case 'HIGHEST':
      return c.danger;
    case 'P1':
    case 'HIGH':
      return c.attention;
    case 'P3':
    case 'LOW':
    case 'LOWEST':
      return c.mute;
    default:
      return c.graphite;
  }
}
