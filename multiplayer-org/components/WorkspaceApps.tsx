/**
 * Published Studio apps, in the store, runnable by anyone in the workspace.
 *
 * The other apps in this store were compiled into this bundle. These were not:
 * they are whatever the workspace's people have built in Studio and published,
 * listed live from the artifact-apps API and evaluated on open with the same
 * runtime Studio's own preview uses (lib/studioRuntime.ts). Publish from
 * Studio's Versions tab and the app appears here for everyone — no new deploy
 * of this shell involved.
 *
 * WHY THIS IS NOT AN SDK FEATURE. None of the gateway's 468 operations touch
 * artifact apps — they live in a different database owned by a different
 * service (claw-auth), and the admin.* app ops read the bot/integration
 * registry, a different "app" concept entirely. So this section talks to
 * /claw/api/v1/artifact-apps directly, the same cookie-auth route Studio's
 * deploy buttons use, which also sets its one limit: it answers only when this
 * shell runs published inside Spaces, where the host tunnels /claw/* as the
 * signed-in viewer. On a dev server the section says so instead of sitting
 * empty (the same honest gate as lib/studioDeploy.ts `canDeploy`).
 *
 * TRUST MODEL, stated rather than implied: opening one of these runs a
 * workspace member's published code as you. That is not a capability this
 * section invents — it is what publishing to the workspace Library has always
 * meant; the official dashboard grants a published app the same viewer-scoped
 * data bridge. The stage below is contained and error-bounded exactly like
 * Studio's preview, and only the PINNED published version is ever served —
 * the API refuses to hand a non-owner anyone's drafts.
 */
import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import { canDeploy, listApps, pullApp, type AppSummary } from '../lib/studioDeploy';
// Type-only, so it is erased: a VALUE import of studioRuntime would drag
// sucrase into the shell's eager bundle (measured: 527 kB → 1.97 MB). The
// runtime is loaded dynamically in `Runner`, when someone actually opens
// an app — the same reason App.tsx lazy-loads Studio itself.
import type { RuntimeError } from '../lib/studioRuntime';
import type { StudioFile } from '../lib/studioProtocol';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';

type Runtime = typeof import('../lib/studioRuntime');

/** Shape an unknown throw for the boundary without importing the runtime. */
function asRuntimeError(err: unknown): RuntimeError {
  if (err instanceof Error) return { where: 'render', message: err.message, ...(err.stack ? { stack: err.stack } : {}) };
  return { where: 'render', message: String(err) };
}

export function WorkspaceApps(): JSX.Element {
  // null = still loading; 'dev' = the API is unreachable from a dev server.
  const [apps, setApps] = useState<AppSummary[] | 'dev' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<AppSummary | null>(null);

  useEffect(() => {
    if (!canDeploy()) {
      setApps('dev');
      return;
    }
    let cancelled = false;
    void listApps('workspace')
      .then(rows => { if (!cancelled) setApps(rows); })
      .catch(err => { if (!cancelled) { setApps([]); setError(err instanceof Error ? err.message : String(err)); } });
    return () => { cancelled = true; };
  }, []);

  return (
    <section>
      <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2.5">
        Built in this workspace
      </h3>

      {apps === 'dev' ? (
        <p className="text-[12px] text-muted-foreground max-w-prose">
          Apps published from Studio appear here for everyone — when this shell runs inside Spaces.
          The app API authenticates with the viewer's session, and a dev server only has a bearer
          token, so this list cannot load here.
        </p>
      ) : apps === null ? (
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <>
          {error ? <p className="text-[12px] text-warn mb-2.5">Could not read the list: {error}</p> : null}
          {apps.length === 0 && !error ? (
            <p className="text-[12px] text-muted-foreground max-w-prose">
              Nothing published yet. Build something in Studio, then use its Versions tab —
              “Publish to the workspace” — and it lands here for everyone.
            </p>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {apps.map(app => (
                <div
                  key={app.id}
                  className="rounded-lg border border-border bg-card p-3.5 flex items-center gap-3 min-w-0"
                >
                  <span className="h-8 w-8 shrink-0 rounded-md bg-secondary text-secondary-foreground grid place-items-center text-[13px] font-semibold">
                    {(app.title.trim()[0] ?? '?').toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium truncate">{app.title}</span>
                    <span className="block text-[11px] text-muted-foreground truncate">
                      {app.ownerName ? `by ${app.ownerName}` : 'published to this workspace'}
                    </span>
                  </span>
                  <Button size="sm" variant="secondary" className="shrink-0" onClick={() => setViewing(app)}>
                    Open
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {viewing ? <Runner app={viewing} onBack={() => setViewing(null)} /> : null}
    </section>
  );
}

/**
 * The open app, full-screen over the store.
 *
 * A fixed overlay rather than a route: the store stays mounted underneath with
 * its list intact, and closing is one click with nothing to reload. The stage
 * is `contain`-ed so a guest app's fixed positioning or full-bleed background
 * stays inside its own frame instead of painting over the shell.
 */
function Runner({ app, onBack }: { app: AppSummary; onBack: () => void }): JSX.Element {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [payload, setPayload] = useState<{ entry: string; files: StudioFile[] } | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [failure, setFailure] = useState<RuntimeError | null>(null);

  // The runtime chunk and the app's files load in parallel; the stage renders
  // when both have landed.
  useEffect(() => {
    let cancelled = false;
    void import('../lib/studioRuntime').then(mod => {
      if (cancelled) return;
      mod.ensureRuntimeTailwind();
      setRuntime(mod);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setFetchError(null);
    setFailure(null);
    void pullApp(app.id)
      .then(body => { if (!cancelled) setPayload({ entry: body.entry || '/App.tsx', files: body.files ?? [] }); })
      .catch(err => { if (!cancelled) setFetchError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [app.id]);

  const built = useMemo(() => {
    if (!payload || !runtime) return null;
    try {
      return { Component: runtime.evaluateProject(payload.files, payload.entry).Component, error: null as RuntimeError | null };
    } catch (err) {
      return { Component: null, error: runtime.toRuntimeError(err) };
    }
  }, [payload, runtime]);

  const runtimeError = failure ?? built?.error ?? null;
  const Rendered = built?.Component as (() => ReactNode) | null | undefined;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 py-2">
        <Button size="sm" variant="secondary" onClick={onBack}>
          ← All apps
        </Button>
        <span className="min-w-0">
          <span className="block text-[13px] font-medium truncate">{app.title}</span>
          <span className="block text-[10.5px] text-muted-foreground truncate">
            {app.ownerName ? `built by ${app.ownerName} · ` : ''}published version · runs with your access
          </span>
        </span>
      </header>

      <div className="relative min-h-0 flex-1 overflow-auto">
        {fetchError ? (
          <Notice title="Could not load this app">
            {fetchError} — reopen it to retry, or find it in the Spaces Library.
          </Notice>
        ) : !built ? (
          <div className="p-6">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="mt-3 h-40 w-full max-w-2xl" />
          </div>
        ) : runtimeError ? (
          <Notice title={`This app broke in ${runtimeError.where}`}>
            {runtimeError.message}
            {app.ownerName ? ` — it is ${app.ownerName}'s build; they can push a fix from Studio.` : ''}
          </Notice>
        ) : null}

        {Rendered && !runtimeError ? (
          <div style={{ contain: 'layout paint style', isolation: 'isolate', minHeight: '100%' }}>
            <Boundary build={Rendered} onError={setFailure}>
              <Rendered />
            </Boundary>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="p-6">
      <div className="max-w-xl rounded-lg border border-warn/40 bg-warn-soft p-4">
        <p className="text-[13px] font-medium">{title}</p>
        <p className="mt-1 text-[12.5px] text-muted-foreground leading-relaxed">{children}</p>
      </div>
    </div>
  );
}

/** Same reset-on-new-build shape as Studio's preview boundary — see
 *  StudioPreview.tsx for why comparing children instead would crash-loop. */
class Boundary extends Component<
  { onError: (e: RuntimeError) => void; build: unknown; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const shaped = asRuntimeError(error);
    this.props.onError({
      ...shaped,
      stack: `${shaped.stack ?? shaped.message}\n\nComponent stack:${info.componentStack ?? ''}`,
    });
  }

  override componentDidUpdate(prev: { build: unknown }): void {
    if (prev.build !== this.props.build && this.state.failed) this.setState({ failed: false });
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
