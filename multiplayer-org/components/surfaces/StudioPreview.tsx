/**
 * The running app.
 *
 * Generated code shares Studio's React (lib/studioHost.ts), so the preview is
 * not a separate root or a separate frame — it is `<Component/>` rendered in
 * this tree. Two things fall out of that and both matter:
 *
 *  - A React error boundary catches a render fault, which a cross-frame preview
 *    could only report as a message. The stack it catches is the same string the
 *    Fix button hands back to the agent, so a crash becomes the next turn of the
 *    conversation instead of a dead end.
 *  - Tailwind is already compiling in this document, so the app is styled the
 *    moment it mounts.
 *
 * The element picker is the other half of the loop. Describing what you want
 * changed is the slowest part of iterating on a UI; pointing at it is the
 * fastest. Clicking an element writes a description of it into the composer, so
 * the followup starts from the thing rather than from a sentence about it.
 */
import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { c, eyebrow, mono } from '../../lib/theme';
import { evaluateProject, toRuntimeError, type RuntimeError } from '../../lib/studioRuntime';
import type { StudioFile } from '../../lib/studioProtocol';

type Device = 'fit' | 'tablet' | 'phone';

const DEVICES: Array<{ id: Device; label: string; width: number | null }> = [
  { id: 'fit', label: 'Fit', width: null },
  { id: 'tablet', label: '834', width: 834 },
  { id: 'phone', label: '390', width: 390 },
];

class Boundary extends Component<
  { onError: (e: RuntimeError) => void; build: unknown; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const runtime = toRuntimeError(error);
    this.props.onError({
      ...runtime,
      where: 'render',
      stack: `${runtime.stack ?? runtime.message}\n\nComponent stack:${info.componentStack ?? ''}`,
    });
  }

  /**
   * Reset when a genuinely NEW BUILD arrives.
   *
   * Comparing `children` here would be a crash loop, not a reset: `<Rendered/>`
   * is a fresh element object on every render, and catching an error itself
   * causes one (componentDidCatch -> onError -> setState -> re-render). The
   * boundary would clear `failed`, remount the same broken component, throw
   * again, and never settle. `build` is the compiled component identity, which
   * changes only when evaluateProject actually re-runs.
   */
  componentDidUpdate(prev: { build: unknown }): void {
    if (prev.build !== this.props.build && this.state.failed) this.setState({ failed: false });
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export function StudioPreview({
  files,
  entry,
  busy,
  missingFiles = false,
  onError,
  onPick,
}: {
  files: StudioFile[];
  entry: string;
  busy: boolean;
  /** True when the project has a version but its files could not be read. */
  missingFiles?: boolean;
  onError: (error: RuntimeError | null) => void;
  onPick: (description: string) => void;
}) {
  const [device, setDevice] = useState<Device>('fit');
  const [picking, setPicking] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [failure, setFailure] = useState<RuntimeError | null>(null);
  const stage = useRef<HTMLDivElement | null>(null);

  // Compiling in a memo keeps a syntax error out of render: it is caught here,
  // turned into a failure state, and the tree renders the overlay instead.
  const built = useMemo(() => {
    if (files.length === 0) return { Component: null as unknown, css: '' , error: null as RuntimeError | null };
    try {
      const { Component, css } = evaluateProject(files, entry);
      return { Component, css, error: null };
    } catch (err) {
      return { Component: null as unknown, css: '', error: toRuntimeError(err) };
    }
    // `generation` is the reload button: same files, fresh evaluation.
  }, [files, entry, generation]);

  useEffect(() => {
    const next = built.error ?? null;
    setFailure(next);
    onError(next);
  }, [built, onError]);

  // A crash inside an effect or a promise never reaches the boundary. Without
  // this, an app that fetches on mount and throws would just sit there blank.
  useEffect(() => {
    const onWindowError = (event: ErrorEvent): void => {
      if (!stage.current?.contains(event.target as Node) && event.target !== window) return;
      const next: RuntimeError = { where: 'runtime', message: event.message, ...(event.error?.stack ? { stack: String(event.error.stack) } : {}) };
      setFailure(current => current ?? next);
      onError(next);
    };
    window.addEventListener('error', onWindowError);
    return () => window.removeEventListener('error', onWindowError);
  }, [onError]);

  // Element picking. Listeners live on the stage, in capture phase, so a click
  // is intercepted before the generated app's own handler sees it.
  useEffect(() => {
    const node = stage.current;
    if (!node || !picking) return;

    let highlighted: HTMLElement | null = null;
    const paint = (el: HTMLElement | null): void => {
      if (highlighted) highlighted.style.outline = '';
      highlighted = el;
      if (el) el.style.outline = `2px solid ${c.signal}`;
    };

    const onMove = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && target !== node) paint(target);
    };
    const onClick = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.target as HTMLElement | null;
      if (target) onPick(describe(target));
      paint(null);
      setPicking(false);
    };

    node.addEventListener('mousemove', onMove, true);
    node.addEventListener('click', onClick, true);
    return () => {
      paint(null);
      node.removeEventListener('mousemove', onMove, true);
      node.removeEventListener('click', onClick, true);
    };
  }, [picking, onPick]);

  const Rendered = built.Component as (() => ReactNode) | null;
  const width = DEVICES.find(d => d.id === device)?.width ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex shrink-0 items-center gap-2 px-3 py-2"
        style={{ borderBottom: `1px solid ${c.line}` }}
      >
        <div className="flex items-center gap-1">
          {DEVICES.map(d => (
            <button
              key={d.id}
              onClick={() => setDevice(d.id)}
              className="rounded px-2 py-1 text-[11px] transition-colors"
              style={{
                fontFamily: mono,
                background: device === d.id ? c.signalSoft : 'transparent',
                color: device === d.id ? c.signal : c.graphite,
              }}
            >
              {d.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setPicking(p => !p)}
            disabled={!Rendered}
            className="rounded px-2 py-1 text-[11px] transition-colors disabled:opacity-40"
            style={{
              fontFamily: mono,
              background: picking ? c.signal : 'transparent',
              color: picking ? c.paper : c.graphite,
              border: `1px solid ${picking ? c.signal : c.line}`,
            }}
            title="Click an element in the preview to describe it in the composer"
          >
            {picking ? 'Click a thing…' : 'Point at it'}
          </button>
          <button
            onClick={() => setGeneration(g => g + 1)}
            className="rounded px-2 py-1 text-[11px]"
            style={{ fontFamily: mono, color: c.graphite, border: `1px solid ${c.line}` }}
          >
            Reload
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-auto" style={{ background: c.paper }}>
        {built.css ? <style>{built.css}</style> : null}

        <div
          className="mx-auto min-h-full"
          style={{
            width: width ? `${width}px` : '100%',
            maxWidth: '100%',
            background: c.card,
            ...(width ? { borderLeft: `1px solid ${c.line}`, borderRight: `1px solid ${c.line}` } : {}),
          }}
        >
          <div
            ref={stage}
            data-studio-stage=""
            style={{
              // Contains layout and paint so a generated `position: fixed` or a
              // full-bleed background stays inside the preview rather than
              // painting over Studio's own chrome.
              contain: 'layout paint style',
              isolation: 'isolate',
              cursor: picking ? 'crosshair' : 'auto',
              minHeight: '100%',
            }}
          >
            {Rendered ? (
              <Boundary
                key={generation}
                build={Rendered}
                onError={err => {
                  setFailure(err);
                  onError(err);
                }}
              >
                <Rendered />
              </Boundary>
            ) : null}
          </div>
        </div>

        {!Rendered && !failure ? <Empty busy={busy} missing={missingFiles} /> : null}
        {failure ? <Failure error={failure} /> : null}
      </div>
    </div>
  );
}

function Empty({ busy, missing }: { busy: boolean; missing: boolean }) {
  // A project that HAS a version but whose files did not load is a storage
  // problem, not an empty project — and telling someone with ten turns of work
  // to "describe what you want" is the wrong thing to say to them.
  const title = missing ? 'Files not loaded' : busy ? 'Building' : 'Preview';
  const body = missing
    ? 'This version exists but its files could not be read back from app storage. Reopen the project, or restore an earlier version from the Versions tab.'
    : busy
      ? 'The agent is writing the first version. A turn usually takes under a minute, sometimes several.'
      : 'Describe what you want and the preview appears here, running for real.';
  return (
    <div className="absolute inset-0 grid place-items-center px-8 text-center">
      <div>
        <div style={{ ...eyebrow, color: missing ? c.attention : c.mute }}>{title}</div>
        <p className="mt-2 max-w-sm text-[13px]" style={{ color: c.graphite }}>
          {body}
        </p>
      </div>
    </div>
  );
}

function Failure({ error }: { error: RuntimeError }) {
  return (
    <div className="absolute inset-x-0 bottom-0 max-h-[60%] overflow-auto p-3">
      <div className="rounded-md p-3" style={{ background: '#FFF7F2', border: `1px solid ${c.attention}` }}>
        <div style={{ ...eyebrow, color: c.attention }}>Broke in {error.where}</div>
        <p className="mt-1.5 text-[13px] leading-snug" style={{ color: c.text }}>
          {error.message}
        </p>
        {error.stack ? (
          <pre
            className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed"
            style={{ fontFamily: mono, color: c.graphite }}
          >
            {error.stack.slice(0, 1200)}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Describe a clicked element well enough for an agent to find it in the source.
 *
 * Visible text first, because that is what the model can grep for; the tag and a
 * couple of classes disambiguate when the text repeats. Deliberately not a CSS
 * selector — the agent is editing source, not querying a DOM.
 */
function describe(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const classes = (el.className && typeof el.className === 'string' ? el.className : '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(' ');

  const parts = [`the <${tag}>`];
  if (text) parts.push(`showing "${text}"`);
  if (classes) parts.push(`(classes: ${classes})`);
  return parts.join(' ');
}
