/**
 * The left rail — drill-down, not a tree.
 *
 * WHY NOT A TREE. A tree shows every level at once, which is exactly what fails
 * at org scale: a thousand projects is a thousand rows before you have chosen
 * anything, and expanding two of them buries the third. Drill-down shows one
 * level at a time — projects, then that project's tracks, then that track's
 * tickets — so the rows on screen are bounded by the branching factor, not by
 * the size of the org.
 *
 * The cost of drill-down is losing your place, and that is paid for three ways:
 * a breadcrumb that walks back up, the selection kept highlighted on the way
 * back down, and Recent in the right pane for jumps that skip levels entirely.
 *
 * SCALE. Three rules, because "just render the list" fails at three different
 * points:
 *   1. Filter, don't scroll. Search is the primary control at every level.
 *   2. Render a window — SHOW rows at a time behind an explicit "show more".
 *      A thousand DOM nodes is slow before it is unreadable.
 *   3. Page tickets from the SERVER. Tickets are the unbounded level (millions,
 *      not thousands), so they arrive by cursor and load on demand. Projects and
 *      tracks are bounded per user, so they arrive whole.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Hash, Plus, Store,
  MessageSquare, BarChart3, Search, Folder,
} from 'lucide-react';
import type { ProjectTree, Ticket } from '../lib/org';
import { humanize } from '../lib/directory';
import { Input } from './ui/input';

export type RailView = 'projects' | 'create' | 'store' | 'dm' | 'insights';

/** Rows rendered before "show more" appears. Keeps the DOM small on huge lists. */
const SHOW = 40;

interface RailProps {
  trees: ProjectTree[];
  view: RailView;
  projectId: string | null;
  trackId: string | null;
  tickets: Ticket[];
  ticketId: string | null;
  ticketsLoading: boolean;
  hasMoreTickets: boolean;
  loadingMore: boolean;
  onView: (v: RailView) => void;
  onProject: (projectId: string | null) => void;
  onTrack: (channelId: string | null) => void;
  onTicket: (ticketId: string) => void;
  onLoadMoreTickets: () => void;
  loading: boolean;
}

function NavButton({ active, icon, label, onClick }: {
  active: boolean; icon: JSX.Element; label: string; onClick: () => void;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={[
        'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] transition-colors min-w-0',
        active ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-accent/50',
      ].join(' ')}
    >
      <span className="shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export function Rail({
  trees, view, projectId, trackId, tickets, ticketId, ticketsLoading,
  hasMoreTickets, loadingMore, onView, onProject, onTrack, onTicket,
  onLoadMoreTickets, loading,
}: RailProps): JSX.Element {
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(SHOW);
  const listRef = useRef<HTMLDivElement | null>(null);

  const project = trees.find((t) => t.project.id === projectId) ?? null;
  const track = project?.tracks.find((c) => c.id === trackId) ?? null;
  const level: 0 | 1 | 2 = track ? 2 : project ? 1 : 0;

  // Each level is its own list: reset the filter, the window and the scroll.
  useEffect(() => {
    setQ('');
    setShown(SHOW);
    listRef.current?.scrollTo({ top: 0 });
  }, [level, projectId, trackId]);

  const needle = q.trim().toLowerCase();

  const projects = useMemo(() => {
    if (!needle) return trees;
    return trees.filter((t) =>
      t.project.name.toLowerCase().includes(needle) ||
      t.project.code.toLowerCase().includes(needle));
  }, [trees, needle]);

  const tracks = useMemo(() => {
    const all = project?.tracks ?? [];
    return needle ? all.filter((c) => c.name.toLowerCase().includes(needle)) : all;
  }, [project, needle]);

  // Ticket search filters what has been PAGED IN so far. That is honest only
  // because the count is stated next to it — a real search over millions of
  // rows has to be a server query, which this SDK does not expose per track.
  const visibleTickets = useMemo(() => {
    if (!needle) return tickets;
    return tickets.filter((t) =>
      t.title.toLowerCase().includes(needle) || t.xyneId.toLowerCase().includes(needle));
  }, [tickets, needle]);

  const placeholder =
    level === 0 ? `Filter ${trees.length} projects…`
    : level === 1 ? `Filter ${tracks.length} tracks…`
    : 'Filter loaded tickets…';

  return (
    <nav className="flex-1 min-w-0 min-h-0 flex flex-col">
      {/* Reachable from every level. */}
      <div className="p-2 flex flex-col gap-0.5 border-b border-border">
        <NavButton active={view === 'create'} icon={<Plus />} label="Build an app"
          onClick={() => onView('create')} />
        <NavButton active={view === 'store'} icon={<Store />} label="All Apps"
          onClick={() => onView('store')} />
      </div>

      {/* Breadcrumb — the way back up, and the only thing that spans levels. */}
      <div className="px-2 py-2 border-b border-border flex flex-col gap-1 min-w-0">
        {level > 0 ? (
          <button
            onClick={() => (level === 2 ? onTrack(null) : onProject(null))}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors min-w-0"
          >
            <ChevronLeft className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">
              {level === 2 ? (project?.project.name ?? 'Tracks') : 'All projects'}
            </span>
          </button>
        ) : (
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground px-1">
            Projects
          </span>
        )}

        {level > 0 ? (
          <div className="flex items-center gap-1.5 min-w-0 px-1">
            {level === 2
              ? <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              : <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
            <span className="text-[13px] font-semibold truncate">
              {level === 2 ? track?.name : project?.project.name}
            </span>
          </div>
        ) : null}
      </div>

      <div className="relative min-w-0 px-2 py-2 shrink-0">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
          className="h-7 pl-7 text-xs" />
      </div>

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="p-2 pt-0 flex flex-col gap-px min-w-0">
          {level === 0 ? (
            loading ? (
              <p className="px-2 py-1 text-[11px] text-muted-foreground">Loading your org…</p>
            ) : projects.length === 0 ? (
              <p className="px-2 py-1 text-[11px] text-muted-foreground">
                {trees.length === 0 ? 'You are not in any project yet.' : 'No project matches.'}
              </p>
            ) : (
              <>
                {projects.slice(0, shown).map((t) => (
                  <button key={t.project.id} onClick={() => onProject(t.project.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-accent/50 transition-colors min-w-0">
                    <span className="text-[13px] truncate flex-1 min-w-0">{t.project.name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground shrink-0">{t.project.code}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 w-5 text-right">{t.tracks.length}</span>
                    <ChevronRight className="h-3 w-3 shrink-0 opacity-40" aria-hidden />
                  </button>
                ))}
                {projects.length > shown ? (
                  <button onClick={() => setShown((n) => n + SHOW)}
                    className="mt-1 px-2 py-1.5 rounded-md text-[11px] text-muted-foreground hover:bg-accent/50">
                    Show {Math.min(SHOW, projects.length - shown)} more of {projects.length}
                  </button>
                ) : null}
              </>
            )
          ) : null}

          {level === 1 ? (
            tracks.length === 0 ? (
              <p className="px-2 py-1 text-[11px] text-muted-foreground">
                {project?.tracks.length === 0 ? 'No tracks here.' : 'No track matches.'}
              </p>
            ) : (
              <>
                {tracks.slice(0, shown).map((c) => (
                  <button key={c.id} onClick={() => onTrack(c.id)}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-left hover:bg-accent/50 transition-colors min-w-0">
                    <Hash className="h-3 w-3 shrink-0 opacity-50" aria-hidden />
                    <span className="text-[13px] truncate flex-1 min-w-0">{c.name}</span>
                    <ChevronRight className="h-3 w-3 shrink-0 opacity-40" aria-hidden />
                  </button>
                ))}
                {tracks.length > shown ? (
                  <button onClick={() => setShown((n) => n + SHOW)}
                    className="mt-1 px-2 py-1.5 rounded-md text-[11px] text-muted-foreground hover:bg-accent/50">
                    Show {Math.min(SHOW, tracks.length - shown)} more of {tracks.length}
                  </button>
                ) : null}
              </>
            )
          ) : null}

          {level === 2 ? (
            ticketsLoading && tickets.length === 0 ? (
              <p className="px-2 py-1 text-[11px] text-muted-foreground">Loading tickets…</p>
            ) : visibleTickets.length === 0 ? (
              <p className="px-2 py-1 text-[11px] text-muted-foreground">
                {tickets.length === 0 ? 'No tickets on this track.' : 'No loaded ticket matches.'}
              </p>
            ) : (
              <>
                {visibleTickets.map((t) => {
                  const on = t.id === ticketId;
                  return (
                    <button key={t.id} onClick={() => onTicket(t.id)} title={t.title}
                      className={[
                        'w-full flex items-start gap-1.5 px-2 py-1.5 rounded-md text-left transition-colors min-w-0',
                        on ? 'bg-primary/10' : 'hover:bg-accent/50',
                      ].join(' ')}>
                      <span className={['h-1.5 w-1.5 shrink-0 rounded-full mt-1.5', on ? 'bg-primary' : 'bg-border'].join(' ')} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-1.5 min-w-0">
                          <span className="font-mono text-[10px] text-muted-foreground shrink-0">{t.xyneId}</span>
                          <span className={['text-[12px] truncate', on ? 'font-medium text-foreground' : 'text-foreground/75'].join(' ')}>
                            {t.title}
                          </span>
                        </span>
                        <span className="block text-[10px] text-muted-foreground truncate">{humanize(t.stageName)}</span>
                      </span>
                    </button>
                  );
                })}

                {hasMoreTickets && !needle ? (
                  <button onClick={onLoadMoreTickets} disabled={loadingMore}
                    className="mt-1 px-2 py-1.5 rounded-md text-[11px] text-muted-foreground hover:bg-accent/50 disabled:opacity-50">
                    {loadingMore ? 'Loading…' : 'Load more tickets'}
                  </button>
                ) : null}

                {needle && hasMoreTickets ? (
                  <p className="px-2 py-1.5 text-[10px] text-muted-foreground/80">
                    Filtering the {tickets.length} loaded so far. Load more to widen it.
                  </p>
                ) : null}
              </>
            )
          ) : null}
        </div>
      </div>

      <div className="p-2 border-t border-border flex flex-col gap-0.5 shrink-0">
        <NavButton active={view === 'dm'} icon={<MessageSquare />} label="Update Agent"
          onClick={() => onView('dm')} />
        <NavButton active={view === 'insights'} icon={<BarChart3 />} label="Insights"
          onClick={() => onView('insights')} />
      </div>
    </nav>
  );
}
