/**
 * A crash barrier around the app pane.
 *
 * Org apps are the extension point — eventually model-authored — so a bad
 * render in one must not take the shell down with it. Without this, a single
 * undefined property in an app blanks the whole page, including the ticket
 * chat and the navigation needed to get somewhere else.
 *
 * Keyed on the app id by the caller, so switching apps clears a previous
 * crash rather than leaving the pane stuck on an error from a different app.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Shown in the message, so the reader knows which app failed. */
  label: string;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console -- the stack is the only way to debug a crashed app
    console.error(`[org-app] ${this.props.label} crashed`, error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="max-w-xl rounded-lg border border-destructive/30 bg-destructive/5 p-5">
        <h2 className="text-sm font-semibold mb-1">{this.props.label} stopped working</h2>
        <p className="text-[13px] text-muted-foreground mb-3">
          The rest of the workspace is fine — the ticket and its chat are still on the right.
        </p>
        <pre className="text-[11px] font-mono bg-background/60 border border-border rounded p-2.5 overflow-x-auto mb-3 max-h-32">
          {error.message || String(error)}
        </pre>
        <button
          onClick={this.reset}
          className="px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-[12px] font-medium hover:bg-accent transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }
}
