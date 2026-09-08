/**
 * A crash in a surface would otherwise blank the whole app — React unmounts the
 * tree on an unhandled render throw, and with no console to hand that looks
 * exactly like "it opened an empty screen". Show the error instead.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { c, mono } from '../lib/theme';

type Props = { children: ReactNode; label: string };
type State = { error: Error | null; stack?: string };

export class Boundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, ...(info.componentStack ? { stack: info.componentStack } : {}) });
  }

  /** Remount the subtree when the caller switches to a different surface. */
  componentDidUpdate(prev: Props): void {
    if (prev.label !== this.props.label && this.state.error) this.setState({ error: null });
  }

  render(): ReactNode {
    const { error, stack } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto max-w-2xl px-8 py-12">
        <p style={{ fontFamily: mono, fontSize: '10px', color: c.attention }}>SURFACE CRASHED</p>
        <h1 className="mt-2 text-[19px] font-semibold">{this.props.label} hit an error</h1>
        <p className="mt-3 rounded-md px-3 py-2 text-[13px]" style={{ background: '#FCF2EC', color: c.attention }}>
          {error.message || String(error)}
        </p>
        {stack && (
          <pre
            className="mt-3 max-h-64 overflow-auto rounded-md p-3 text-[11px] leading-relaxed"
            style={{ background: '#F2F1EC', color: c.graphite, fontFamily: mono }}
          >
            {stack.trim()}
          </pre>
        )}
        <button
          onClick={() => this.setState({ error: null })}
          className="mt-4 rounded-md px-3 py-1.5 text-[12.5px] font-medium text-white"
          style={{ background: c.signal }}
        >
          Try again
        </button>
      </div>
    );
  }
}
