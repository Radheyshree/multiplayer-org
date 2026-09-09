/**
 * Studio's motion vocabulary, defined once.
 *
 * Everything animated in Studio pulls from these five keyframes rather than
 * declaring its own, so the surface moves with one accent instead of six. The
 * names are prefixed `sfx-` because generated apps render into THIS document
 * (lib/studioRuntime.ts) — an unprefixed `fade-in` here would collide with the
 * first generated app that declares its own.
 *
 * Colours come through `color-mix` on the theme vars, not rgba literals, so a
 * glow is the accent colour in dark mode too.
 */
import type { CSSProperties } from 'react';
import { c } from '../../lib/theme';

export function StudioFx() {
  return (
    <style>{`
      @keyframes sfx-up { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      @keyframes sfx-pop { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
      @keyframes sfx-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
      @keyframes sfx-spin { to { transform: rotate(360deg); } }
      @keyframes sfx-breathe {
        0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, ${c.signal} 40%, transparent); }
        70% { box-shadow: 0 0 0 7px color-mix(in srgb, ${c.signal} 0%, transparent); }
      }
      @keyframes sfx-ellipsis { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75% { content: '...'; } }
      .sfx-dots::after { display: inline-block; width: 1.2em; text-align: left; content: '…'; animation: sfx-ellipsis 1.4s steps(1) infinite; }
      @media (prefers-reduced-motion: reduce) {
        .sfx-anim, .sfx-anim * { animation: none !important; transition: none !important; }
      }
    `}</style>
  );
}

/** Staggered entrance for the i-th item of a list. */
export function riseIn(i: number): CSSProperties {
  return { animation: `sfx-up 0.35s ${Math.min(i, 8) * 45}ms cubic-bezier(0.2, 0.7, 0.2, 1) both` };
}

/** A shimmering placeholder block — the loading state that admits it is one. */
export function Shimmer({ w, h, r = 6, style }: { w: number | string; h: number; r?: number; style?: CSSProperties }) {
  return (
    <div
      aria-hidden
      style={{
        width: w,
        height: h,
        borderRadius: r,
        background: `linear-gradient(100deg, ${c.line} 40%, color-mix(in srgb, ${c.line} 35%, transparent) 50%, ${c.line} 60%)`,
        backgroundSize: '200% 100%',
        animation: 'sfx-shimmer 1.6s linear infinite',
        ...style,
      }}
    />
  );
}

/** The indeterminate ring shown beside a live clock — motion that promises nothing. */
export function Ring({ size = 13 }: { size?: number }) {
  const r = (size - 3) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden style={{ animation: 'sfx-spin 0.9s linear infinite' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c.line} strokeWidth={1.8} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={c.signal} strokeWidth={1.8} strokeLinecap="round"
        strokeDasharray={`${circ * 0.28} ${circ}`}
      />
    </svg>
  );
}
