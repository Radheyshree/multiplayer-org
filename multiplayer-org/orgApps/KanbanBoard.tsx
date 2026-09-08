/**
 * Kanban Board — the track's board.
 *
 * Scoped to a TRACK, not a ticket: it renders every stage as a column and every
 * ticket on the track as a card. Clicking a card focuses it, which is what the
 * chat pane on the right follows. Moving a card posts into THAT card's own
 * conversation — the ticket id travels with the action, so one board can act on
 * a hundred tickets without ever being "about" one of them.
 */
import { useCallback, useEffect, useState } from 'react';
import type { OrgAppProps } from './registry';
import {
  allowedTargets, describeMoveError, loadBoardView, moveTicket,
  type BoardView, type Stage,
} from '../lib/kanban';
import type { Ticket } from '../lib/org';
import { humanize, priorityTone } from '../lib/directory';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';

export function KanbanBoard({
  scope, dir, postUpdate, focusTicket, focusedTicketId,
}: OrgAppProps): JSX.Element {
  const [view, setView] = useState<BoardView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const channelId = scope?.channelId ?? null;

  const load = useCallback(async (): Promise<void> => {
    if (!channelId) {
      setView(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const v = await loadBoardView(channelId);
      setView(v);
      if (!v) setError('This track has no board mapped to it.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the board.');
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const move = async (card: Ticket, to: Stage): Promise<void> => {
    setMoving(card.id);
    setError(null);
    setNote(null);
    try {
      const outcome = await moveTicket(card, to);

      // Recorded on THIS card's ledger, whichever card it was. Marked
      // 'activity': the agent still reads it, humans see it collapsed.
      await postUpdate(
        card,
        outcome.applied
          ? `Moved ${card.xyneId} to **${to.name}**.`
          : outcome.queued
            ? `Requested a move of ${card.xyneId} to **${to.name}** — waiting on approval.`
            : `Attempted a move of ${card.xyneId} to **${to.name}**; the board did not apply it.`,
        'activity',
      );

      setNote(
        outcome.applied
          ? `${card.xyneId} moved to ${to.name}.`
          : outcome.queued
            ? `${card.xyneId} needs approval before it reaches ${to.name}.`
            : `${card.xyneId} did not move — the board declined it.`,
      );
      focusTicket(card);
      await load();
    } catch (err) {
      setError(describeMoveError(err));
    } finally {
      setMoving(null);
    }
  };

  if (!scope) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Pick a track in the sidebar and its board opens here.
      </p>
    );
  }

  if (loading && !view) {
    return (
      <div className="flex gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="w-64 shrink-0 flex flex-col gap-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (!view) {
    return (
      <div className="max-w-md">
        <p className="text-[13px] text-muted-foreground">
          {error ?? 'No board is mapped to this track.'}
        </p>
        <Button size="sm" variant="secondary" className="mt-3" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  const total = [...view.columns.values()].reduce((n, c) => n + c.length, 0);

  return (
    <div className="flex flex-col gap-3 min-w-0 h-full">
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        <h2 className="text-[15px] font-semibold">{view.board?.name ?? scope.trackName}</h2>
        <span className="text-[11px] text-muted-foreground">
          {view.stages.length} stages · {total} tickets
        </span>
        <Button size="sm" variant="ghost" className="ml-auto text-[12px]" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 shrink-0">
          <p className="text-[12px] text-destructive break-words">{error}</p>
        </div>
      ) : null}
      {note ? (
        <div className="rounded-md border border-ok/25 bg-ok-soft px-3 py-2 shrink-0">
          <p className="text-[12px] text-ok break-words">{note}</p>
        </div>
      ) : null}

      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-3 pb-3 items-start h-full">
          {view.stages.map((stage) => {
            const cards = view.columns.get(stage.name) ?? [];
            return (
              <section key={stage.id} className="w-64 shrink-0 flex flex-col gap-2 max-h-full">
                <header className="flex items-center gap-2 px-1 shrink-0">
                  <span className="text-[12px] font-semibold truncate">{stage.name}</span>
                  <span className="text-[11px] text-muted-foreground tabular-nums ml-auto">
                    {cards.length}
                  </span>
                </header>

                <div className="flex flex-col gap-2 overflow-y-auto min-h-0 pr-1">
                  {cards.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground px-1 py-3">Empty</p>
                  ) : (
                    cards.map((card) => {
                      const focused = card.id === focusedTicketId;
                      const targets = allowedTargets(stage, view.stages, view.transitions);
                      return (
                        <article
                          key={card.id}
                          onClick={() => focusTicket(card)}
                          className={[
                            'rounded-lg border p-2.5 flex flex-col gap-1.5 bg-card min-w-0 cursor-pointer transition-colors',
                            focused ? 'border-primary ring-1 ring-primary/20' : 'border-border hover:border-primary/40',
                          ].join(' ')}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                              {card.xyneId}
                            </span>
                            <span className={`ml-auto shrink-0 px-1.5 py-px rounded border text-[9px] font-medium ${priorityTone(card.priority)}`}>
                              {humanize(card.priority)}
                            </span>
                          </div>

                          <p className="text-[12px] leading-snug break-words">{card.title}</p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {dir.name(card.assignedTo)}
                          </p>

                          <select
                            aria-label={`Move ${card.xyneId}`}
                            disabled={moving === card.id}
                            value=""
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const to = view.stages.find((s) => s.id === e.target.value);
                              if (to) void move(card, to);
                            }}
                            className="mt-0.5 w-full text-[11px] rounded-md border border-border bg-background px-1.5 py-1 disabled:opacity-50"
                          >
                            <option value="">{moving === card.id ? 'Moving…' : 'Move to…'}</option>
                            {targets.map((s) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        </article>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
