/**
 * The app store.
 *
 * Two lists, side by side, because they answer the same question from two
 * directions: what can I OPEN here (the catalogue — the apps this shell
 * mounts), and what does this workspace actually RUN (the registry, read live
 * through `admin.*`).
 *
 * It lives in its own file for a boring but real reason: the published sandbox
 * caps each uploaded file at 64 KB and App.tsx was within a few kilobytes of
 * it. The store is the natural seam — three props, no shared state.
 */
import { CATALOGUE, GROUPS } from '../orgApps/catalogue';
import { WorkspaceApps } from './WorkspaceApps';
import type { Registry, RegistryApp } from '../lib/apps';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';

/**
 * The workspace's installed apps.
 *
 * Sorted so anything this shell also mounts comes first and says so — seeing
 * "Tickets Board" in both lists without an explanation reads as a duplicate
 * rather than as the same app from two directions.
 */
function RegistryList({ rows, mounted }: { rows: RegistryApp[]; mounted: Set<string> }): JSX.Element {
  if (rows.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground">
        No apps are installed on this workspace yet.
      </p>
    );
  }
  const sorted = [...rows].sort(
    (a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name),
  );
  return (
    <ul className="flex flex-col gap-1.5">
      {sorted.map((a) => (
        <li
          key={`${a.origin}:${a.id}`}
          className="rounded-lg border border-border bg-card px-3 py-2 flex items-center gap-3 min-w-0"
        >
          <span className="h-7 w-7 shrink-0 rounded-md bg-secondary text-secondary-foreground grid place-items-center text-[12px] font-semibold">
            {(a.name.trim()[0] ?? '?').toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="text-[12.5px] font-medium truncate">{a.name}</span>
              {a.installed ? (
                <span className="shrink-0 px-1.5 py-px rounded border border-ok/25 bg-ok-soft text-ok text-[9px] font-medium">
                  installed
                </span>
              ) : null}
              {mounted.has(a.id) ? (
                <span className="shrink-0 px-1.5 py-px rounded border border-border text-muted-foreground text-[9px]">
                  open above
                </span>
              ) : null}
            </span>
            <span className="block text-[11px] text-muted-foreground truncate">{a.description}</span>
          </span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {a.origin}
            {a.version ? ` · v${a.version}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Store({
  registry,
  mountedIds,
  onOpen,
}: {
  /** Null while the workspace registry is still being read. */
  registry: Registry | null;
  mountedIds: string[];
  onOpen: (id: string) => void;
}): JSX.Element {
  const mounted = new Set(mountedIds);
  return (
        <div className="max-w-4xl flex flex-col gap-7">
          <p className="text-[13px] text-muted-foreground max-w-prose">
            The tools the org works in. Opening one puts it in a tab in the centre; anything you do in
            it is written back to the ticket you have open, and nowhere else.
          </p>
          {GROUPS.map((group) => {
            const rows = CATALOGUE.filter((a) => a.group === group);
            if (rows.length === 0) return null;
            return (
              <section key={group}>
                <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2.5">
                  {group}
                </h3>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {rows.map((a) => {
                    const live = a.status === 'live';
                    return (
                      <div
                        key={a.id}
                        className={[
                          'rounded-lg border p-3.5 flex flex-col gap-2 min-w-0',
                          live ? 'border-border bg-card' : 'border-dashed border-border/70',
                        ].join(' ')}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[13px] font-medium truncate">{a.name}</span>
                          {live ? (
                            <span className="shrink-0 px-1.5 py-px rounded border border-ok/25 bg-ok-soft text-ok text-[10px] font-medium">
                              live
                            </span>
                          ) : (
                            <span className="shrink-0 px-1.5 py-px rounded border border-border text-muted-foreground text-[10px]">
                              planned
                            </span>
                          )}
                        </div>
                        <p className="text-[12px] text-muted-foreground flex-1">{a.blurb}</p>
                        <p className="text-[11px] text-muted-foreground/70">
                          Posts: {a.posts}
                        </p>
                        {live ? (
                          <Button size="sm" variant="secondary" className="self-start mt-0.5"
                            onClick={() => onOpen(a.id)}>
                            Open
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {/* Apps the workspace's own people built in Studio and published.
              Unlike the catalogue above these are fetched and evaluated at
              open time, so publishing one requires no new deploy of this
              shell — see components/WorkspaceApps.tsx. */}
          <WorkspaceApps />

          {/* The other half of the answer: what this WORKSPACE has
              installed, read from admin.* rather than from a list we
              maintain. These are not mountable here — they run in Xyne
              itself — so they are shown as inventory, without an Open
              button that would not work. */}
          <section>
            <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2.5">
              Installed in this workspace
            </h3>
            {!registry ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-2/3" />
              </div>
            ) : (
              <>
                {registry.error ? (
                  <p className="text-[12px] text-warn mb-2.5">{registry.error}</p>
                ) : null}
                <RegistryList
                  rows={[...registry.org, ...registry.marketplace]}
                  mounted={mounted}
                />
              </>
            )}
          </section>
        </div>
  );
}
