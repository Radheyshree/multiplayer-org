/**
 * Design tokens.
 *
 * Colours are applied as INLINE STYLES rather than Tailwind arbitrary values
 * (`bg-[#14161D]`). Note the reason is NOT that the sandbox can't compile them:
 * it loads Tailwind v4's browser build and compiles `text/tailwindcss` at
 * runtime off DOM mutations, so a class first seen at runtime does get compiled
 * (ReactArtifact.utils.ts:14-27). The catch is the other way round — LOCAL DEV
 * uses @tailwindcss/vite, which scans source at build time, so a dynamically
 * constructed class works published and silently fails on localhost.
 *
 * Inline styles sidestep that asymmetry entirely and keep one palette in one
 * place. Standard static utilities for layout are fine in both modes.
 *
 * Direction: a patch bay. An ink rail of ports down the left, paper canvas, and
 * a mono utility layer for the things an operator reads rather than prose —
 * ids, versions, counts, status. Indigo is the only saturated colour and it is
 * reserved for "this is live / this is selected"; amber means attention.
 */
export const c = {
  ink: '#14161D',
  inkSoft: '#1D212B',
  inkLine: '#2B3040',
  paper: '#FAFAF8',
  card: '#FFFFFF',
  line: '#E4E2DB',
  text: '#14161D',
  graphite: '#575E6C',
  mute: '#8A909E',
  signal: '#4B46E5',
  signalSoft: '#EEEDFD',
  live: '#35A06B',
  attention: '#C8622F',
} as const;

/** The instrument layer — ids, versions, counts, status. Always available. */
export const mono =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/** A small-caps tracked label, used for section headers and port names. */
export const eyebrow = {
  fontFamily: mono,
  fontSize: '10px',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
} as const;
