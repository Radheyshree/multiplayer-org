/**
 * Tickets Board — a working kanban, not a read-only rendering.
 *
 * Cards drag between stages, open into an editable detail pane, and can be
 * created. Moves apply optimistically and roll back if the server refuses,
 * which on a rules-driven board is a real answer rather than a failure.
 *
 * Three scopes, and the default is the shell's:
 *
 *   track      the board mapped to the track you have open. This is what the
 *              shell means by an app — a workspace over the whole track — and
 *              it is what makes a move postable to the right ledger.
 *   board      any board in any project, picked by hand. Kept because the
 *              shell can be opened with nothing selected, and because a board
 *              is a legitimate unit of work on its own.
 *   my tickets everything assigned to you, across boards. Its columns are
 *              whatever stages came back, which is a different vocabulary from
 *              a single board's — hence no drag target validation there.
 *
 * Moves go through the shell's `moveTicket`, not a bare `transitionStage`:
 * transitionStage resolves `void`, so a resolved promise means "accepted", not
 * "moved". An approval-gated board routes the move into a request instead, and
 * a card that advances on resolve is then lying. See lib/kanban.ts.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  allowedTargets,
  describeMoveError,
  loadBoardChoices,
  loadBoardView,
  moveTicket,
  type BoardStage,
  type StageTransition,
} from '../../lib/tickets';
import { initials, loadDirectory, nameOf, resolvePeople, tintFor } from '../../lib/people';
import { c, eyebrow, mono, priorityColor } from '../../lib/theme';
import {
  createTicket,
  loadBoard,
  myTickets,
  PRIORITIES,
  stageName,
  type Priority,
  type Stage,
  type Ticket,
} from '../../lib/tickets';
import { toWorkItem } from '../../lib/shell';
import type { OrgAppProps } from '../../orgApps/registry';
import { xyne } from '../../lib/xyne';
import { NewTicket } from '../board/ticket';
import { TicketView } from '../board/ticket';

type Project = { id: string; name?: string; code?: string };
type BoardRow = { id: string; name?: string };
type Mode = 'track' | 'my-tickets' | 'board';

export function Board({ scope, postUpdate, focusTicket, focusedTicketId }: OrgAppProps) {
  const [mode, setMode] = useState<Mode>(scope ? 'track' : 'my-tickets');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [boards, setBoards] = useState<BoardRow[]>([]);
  const [boardId, setBoardId] = useState('');
  const [stages, setStages] = useState<Stage[]>([]);
  /** Full stage rows for the open board — `moveTicket` needs the id, not the name. */
  const [boardStages, setBoardStages] = useState<BoardStage[]>([]);
  /** The board's transition rules, so a drag can be refused before it is made. */
  const [transitions, setTransitions] = useState<StageTransition[]>([]);
  const [trackBoardId, setTrackBoardId] = useState('');
  /** Every board mapped to the open track, and which one is showing. */
  const [trackBoards, setTrackBoards] = useState<Array<{ boardId: string; name: string; isDefault: boolean }>>([]);
  const [pickedBoardId, setPickedBoardId] = useState('');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [nonLinear, setNonLinear] = useState(false);
  const [openId, setOpenId] = useState('');
  const [dragId, setDragId] = useState('');
  const [overStage, setOverStage] = useState('');
  const [query, setQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<Priority | ''>('');
  const [mineOnly, setMineOnly] = useState(false);
  const [meId, setMeId] = useState('');
  const [composing, setComposing] = useState(false);
  const [composeStage, setComposeStage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Follow the shell: opening a different track puts the board back on it. */
  useEffect(() => {
    if (scope) setMode('track');
  }, [scope?.channelId]);

  useEffect(() => {
    void (async () => {
      const { spaces } = await xyne();
      await loadDirectory();
      const me = await spaces.users.me();
      setMeId(me.id);
      const ps = (await spaces.projects.listLite()) as unknown as Project[];
      setProjects(ps);
      if (ps[0]) setProjectId(ps[0].id);
    })().catch(e => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    void (async () => {
      const { spaces } = await xyne();
      const bs = (await spaces.boards.listByProjectLite(projectId)) as unknown as BoardRow[];
      setBoards(bs);
      setBoardId(bs[0]?.id ?? '');
    })().catch(e => setError(String(e)));
  }, [projectId]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      let rows: Ticket[] = [];
      if (mode === 'my-tickets') {
        rows = await myTickets();
        setStages([]);
        setBoardStages([]);
        setTransitions([]);
        setTrackBoardId('');
        setNonLinear(false);
      } else if (mode === 'track' && scope) {
        // listKanban filtered by sourceChannels — the board rows that belong to
        // THIS track, not every ticket on a board several tracks share.
        const view = await loadBoardView(scope.channelId, pickedBoardId || undefined);
        if (!view) {
          setStages([]);
          setBoardStages([]);
          setTransitions([]);
          setTrackBoardId('');
          setTickets([]);
          setError(`#${scope.trackName} has no board mapped to it.`);
          return;
        }
        setBoardStages(view.stages);
        setStages(view.stages);
        setTransitions(view.transitions);
        setTrackBoardId(view.boardId);
        // A board with no transition rules is unrestricted rather than frozen —
        // same reading as allowedTargets(), so the two cannot disagree.
        setNonLinear(view.transitions.length > 0);
        rows = [...view.columns.values()].flat();
      } else if (boardId) {
        // One read, not two: this used to call loadBoard twice per refresh.
        const b = await loadBoard(boardId);
        setStages(b.stages);
        setBoardStages([]);
        setTransitions([]);
        setTrackBoardId('');
        setNonLinear(b.nonLinear);
        rows = b.tickets;
      }
      setTickets(rows);
      // The directory only holds its first window, so ids outside it (assignees,
      // authors) render raw unless resolved explicitly.
      await resolvePeople(rows.flatMap(t => [t.assignedTo, t.createdBy]));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [mode, boardId, scope?.channelId, scope?.trackName, pickedBoardId]);

  /**
   * The track's boards.
   *
   * Loaded separately from the view because it is the answer to "why can't I
   * see my ticket" — a channel can map to dozens of boards, and without this
   * the surface silently shows one of them.
   */
  useEffect(() => {
    if (!scope) {
      setTrackBoards([]);
      return;
    }
    setPickedBoardId('');
    void loadBoardChoices(scope.channelId).then(setTrackBoards).catch(() => setTrackBoards([]));
  }, [scope?.channelId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Columns: a board declares its stages; "my tickets" spans boards, so its
   *  columns are whatever stages came back (a different vocabulary). */
  const columns = useMemo(
    () =>
      mode === 'my-tickets'
        ? [...new Set(tickets.map(t => t.stageName ?? 'Unstaged'))]
        : stages.map(stageName),
    [mode, stages, tickets],
  );

  const visible = useMemo(
    () =>
      tickets.filter(t => {
        if (priorityFilter && t.priority !== priorityFilter) return false;
        if (mineOnly && t.assignedTo !== meId) return false;
        const q = query.trim().toLowerCase();
        if (q && !(t.title ?? '').toLowerCase().includes(q) && !(t.xyneId ?? '').toLowerCase().includes(q)) {
          return false;
        }
        return true;
      }),
    [tickets, priorityFilter, mineOnly, meId, query],
  );

  /**
   * Optimistic move, then find out what actually happened.
   *
   * Three outcomes, and only one of them is "the card moved":
   *   applied  the ticket's own row now reads the target stage.
   *   queued   the board routed it into an approval. The card goes BACK — it
   *            has not moved — and the person is told why it sprang back,
   *            because a silent snap-back reads as a bug.
   *   refused  the server rejected it; its message is the board's own rule.
   *
   * Whatever happens, nothing is written to the ledger until the server has
   * confirmed it. Posting "moved to Done" for a move that was only requested is
   * exactly the kind of false record this ledger exists to prevent.
   */
  const drop = async (toStage: string) => {
    const id = dragId;
    setDragId('');
    setOverStage('');
    const t = tickets.find(x => x.id === id);
    if (!t || !id || t.stageName === toStage) return;
    const before = t.stageName;
    const target = boardStages.find(st => st.name === toStage);

    setNotice(null);
    setError(null);
    if (legalTargets && !legalTargets.has(toStage)) {
      setNotice(`This board does not allow ${before ?? '—'} → ${toStage}.`);
      return;
    }
    setTickets(prev => prev.map(x => (x.id === id ? { ...x, stageName: toStage } : x)));
    const rollback = () => setTickets(prev => prev.map(x => (x.id === id ? { ...x, stageName: before } : x)));

    try {
      if (!target) {
        // "My tickets" spans boards, so there is no stage row to move against
        // and no transition set to validate with. Refuse rather than guess.
        rollback();
        setError('Open the track or a board to move a card — "My tickets" spans boards.');
        return;
      }
      const { applied, queued } = await moveTicket({ id }, target);
      const key = t.xyneId ?? 'This ticket';

      // Every outcome is recorded, including the ones that did not move the
      // card. "We tried to move this and the board said no" is exactly the kind
      // of thing the next person needs and nobody remembers to write down.
      await report(
        t,
        applied
          ? `Moved ${key} to **${toStage}**.`
          : queued
            ? `Requested a move of ${key} to **${toStage}** — waiting on approval.`
            : `Attempted a move of ${key} to **${toStage}**; the board did not apply it.`,
        'activity',
      );

      if (!applied) {
        rollback();
        setNotice(
          queued
            ? `${key} needs approval to enter ${toStage} — a stage request is open.`
            : `${key} did not move to ${toStage}. Refresh to see where it is.`,
        );
      }
    } catch (e) {
      rollback();
      setError(describeMoveError(e));
    }
  };

  /**
   * Write what the app just did into the ticket's ledger.
   *
   * The shell owns the target — it reads `conversationId` off the item we hand
   * it — so this cannot post to the wrong conversation even if the board is
   * showing several tracks. A ticket with no conversation is skipped silently:
   * the move still happened, and failing the move because its record could not
   * be written would be the wrong trade.
   */
  const report = async (t: Ticket, what: string, kind: 'activity' | 'note') => {
    const item = toWorkItem(t);
    if (!item) return;
    await postUpdate(item, what, kind).catch(() => {
      setNotice('The move landed, but its note could not be posted to the ticket.');
    });
  };

  /**
   * Which columns the dragged card may legally land in.
   *
   * The server is the real authority — this only stops a drag that the board
   * would refuse anyway, so the person finds out while dragging rather than by
   * watching the card spring back. Null means "no opinion": either nothing is
   * being dragged, or we are in a mode with no transition set to consult.
   */
  const legalTargets = useMemo<Set<string> | null>(() => {
    if (!dragId || boardStages.length === 0) return null;
    const card = tickets.find(t => t.id === dragId);
    const from = boardStages.find(st => st.name === card?.stageName);
    if (!from) return null;
    return new Set(allowedTargets(from, boardStages, transitions).map(st => st.name));
  }, [dragId, tickets, boardStages, transitions]);

  const open = tickets.find(t => t.id === openId) ?? null;

  if (open) {
    return (
      <TicketView
        ticket={open}
        // Real stage rows when we have a board (they carry the ids the move
        // path prefers); bare names when "My tickets" spans several.
        stages={mode === 'my-tickets' ? columns.map(n => ({ name: n })) : stages}
        gated={nonLinear}
        // The shell's ledger is already showing this ticket's thread — opening a
        // card focuses it — so the detail view does not draw a second copy.
        showConversation={false}
        onChanged={patch => setTickets(prev => prev.map(t => (t.id === open.id ? { ...t, ...patch } : t)))}
        onReport={what => void report(open, what, 'activity')}
        onBack={() => setOpenId('')}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">

        <header className="flex flex-wrap items-center gap-2 px-6 pt-5 pb-3">
          <h1 className="text-[20px] leading-none font-semibold tracking-tight">Tickets</h1>

          <div className="flex rounded-md p-0.5" style={{ background: c.ink, border: `1px solid ${c.line}` }}>
            {(['track', 'my-tickets', 'board'] as Mode[]).map(m => {
              // "This track" is only offered when there IS one — otherwise the
              // control has a tab that shows an error, which is not a choice.
              if (m === 'track' && !scope) return null;
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className="rounded px-2.5 py-1 text-[12px] font-medium"
                  style={{ background: mode === m ? c.card : 'transparent', color: mode === m ? c.text : c.graphite }}
                >
                  {m === 'track' ? `#${scope?.trackName ?? ''}` : m === 'my-tickets' ? 'My tickets' : 'By board'}
                </button>
              );
            })}
          </div>

          {/* Which of the track's boards. Hidden when there is only one,
              because a select with a single option is furniture. */}
          {mode === 'track' && trackBoards.length > 1 && (
            <select
              value={pickedBoardId || trackBoardId}
              onChange={e => setPickedBoardId(e.target.value)}
              className="h-8 max-w-[15rem] rounded-md px-2 text-[12.5px] outline-none"
              style={{ background: c.card, border: `1px solid ${c.line}` }}
              aria-label="Which board on this track"
              title={`${trackBoards.length} boards are mapped to #${scope?.trackName}`}
            >
              {trackBoards.map(b => (
                <option key={b.boardId} value={b.boardId}>
                  {b.name}
                  {b.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
          )}

          {mode === 'board' && (
            <>
              <select
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                className="h-8 max-w-[13rem] rounded-md px-2 text-[12.5px] outline-none"
                style={{ background: c.card, border: `1px solid ${c.line}` }}
              >
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.code ? `${p.code} — ` : ''}
                    {p.name ?? p.id.slice(0, 8)}
                  </option>
                ))}
              </select>
              <select
                value={boardId}
                onChange={e => setBoardId(e.target.value)}
                className="h-8 max-w-[11rem] rounded-md px-2 text-[12.5px] outline-none"
                style={{ background: c.card, border: `1px solid ${c.line}` }}
              >
                {boards.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name ?? b.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter cards"
              className="h-8 w-40 rounded-md px-2 text-[12.5px] outline-none"
              style={{ background: c.card, border: `1px solid ${c.line}` }}
            />
            <select
              value={priorityFilter}
              onChange={e => setPriorityFilter(e.target.value as Priority | '')}
              className="h-8 rounded-md px-2 text-[12.5px] outline-none"
              style={{ background: c.card, border: `1px solid ${c.line}` }}
            >
              <option value="">Any priority</option>
              {PRIORITIES.map(p => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button
              onClick={() => setMineOnly(v => !v)}
              className="h-8 rounded-md border px-2.5 text-[12px]"
              style={{
                borderColor: mineOnly ? c.signal : c.line,
                color: mineOnly ? c.signal : c.graphite,
                background: mineOnly ? c.signalSoft : c.card,
              }}
            >
              Mine
            </button>
            <button
              onClick={() => void refresh()}
              className="h-8 rounded-md border px-2.5 text-[12px]"
              style={{ borderColor: c.line, color: c.graphite, background: c.card }}
            >
              Refresh
            </button>
            <button
              onClick={() => {
                setComposeStage('');
                setComposing(true);
              }}
              className="h-8 rounded-md px-3 text-[12px] font-medium text-white"
              style={{ background: c.signal }}
            >
              New ticket
            </button>
          </div>
        </header>

        {error && (
          <p className="mx-6 mb-2 rounded-md px-3 py-2 text-[12.5px]" style={{ background: c.attentionSoft, color: c.attention }}>
            {error}
          </p>
        )}

        {/* A move that was accepted but not applied is not an error — the board
            worked as configured. It gets its own, calmer, banner. */}
        {notice && (
          <p
            className="mx-6 mb-2 flex items-start gap-2 rounded-md px-3 py-2 text-[12.5px]"
            style={{ background: c.signalSoft, color: c.text }}
          >
            <span className="flex-1">{notice}</span>
            <button onClick={() => setNotice(null)} className="shrink-0" style={{ color: c.mute }} aria-label="Dismiss">
              ×
            </button>
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-x-auto px-6 pb-6">
          {busy && tickets.length === 0 && (
            <p style={{ fontFamily: mono, fontSize: '11px', color: c.mute }}>loading…</p>
          )}
          {!busy && columns.length === 0 && !error && (
            <p className="py-16 text-center text-[13.5px]" style={{ color: c.graphite }}>
              {mode === 'board' ? 'This board has no stages yet.' : 'No tickets assigned to you.'}
            </p>
          )}

          <div className="flex h-full gap-3">
            {columns.map(name => {
              const cards = visible.filter(t => (t.stageName ?? 'Unstaged') === name);
              const isOver = overStage === name;
              // Dimmed only while a card is actually in flight and this column
              // is not one of its legal destinations.
              const illegal = Boolean(legalTargets) && !legalTargets?.has(name) && dragId !== '';
              return (
                <section
                  key={name}
                  onDragOver={e => {
                    e.preventDefault();
                    if (overStage !== name) setOverStage(name);
                  }}
                  onDragLeave={() => overStage === name && setOverStage('')}
                  onDrop={e => {
                    e.preventDefault();
                    void drop(name);
                  }}
                  className="flex w-64 shrink-0 flex-col rounded-lg transition-colors"
                  style={{
                    background: isOver && !illegal ? c.signalSoft : c.ink,
                    border: `1px solid ${isOver ? (illegal ? c.attention : c.signal) : c.line}`,
                    // Not `display: none` — a column that vanishes mid-drag moves
                    // every other column sideways under the cursor.
                    opacity: illegal ? 0.45 : 1,
                  }}
                >
                  <div className="flex items-center justify-between px-3 py-2">
                    <span style={{ ...eyebrow, color: c.graphite }}>{name}</span>
                    <span style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}>{cards.length}</span>
                  </div>

                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                    {cards.map(t => (
                      <article
                        key={t.id}
                        draggable
                        onDragStart={() => setDragId(t.id)}
                        onDragEnd={() => setDragId('')}
                        // Opening a card does two things on purpose: it shows the
                        // ticket, and it points the shell's chat pane at the same
                        // ticket. The app and the conversation must never disagree
                        // about what you are working on.
                        onClick={() => {
                          setOpenId(t.id);
                          focusTicket(toWorkItem(t));
                        }}
                        className="cursor-pointer rounded-md p-2.5 transition-shadow hover:shadow-sm"
                        style={{
                          background: c.card,
                          border: `1px solid ${focusedTicketId === t.id || openId === t.id ? c.signal : c.line}`,
                          boxShadow: focusedTicketId === t.id ? `0 0 0 1px ${c.signal}` : undefined,
                          opacity: dragId === t.id ? 0.4 : 1,
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span style={{ fontFamily: mono, fontSize: '10px', color: c.signal }}>
                            {t.xyneId ?? t.id.slice(0, 8)}
                          </span>
                          {t.priority && (
                            <span style={{ fontFamily: mono, fontSize: '9px', color: priorityColor(t.priority) }}>
                              {t.priority}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-3 text-[12.5px] leading-snug">{t.title ?? 'Untitled'}</p>
                        <div className="mt-2 flex items-center gap-1.5">
                          {t.assignedTo ? (
                            <>
                              <span
                                className="grid size-4 place-items-center rounded text-white"
                                style={{ background: tintFor(t.assignedTo), fontSize: '7px' }}
                              >
                                {initials(nameOf(t.assignedTo))}
                              </span>
                              <span className="truncate text-[10.5px]" style={{ color: c.mute }}>
                                {nameOf(t.assignedTo)}
                              </span>
                            </>
                          ) : (
                            <span className="text-[10.5px]" style={{ color: c.mute }}>
                              Unassigned
                            </span>
                          )}
                          {t.isStageOverdue && (
                            <span className="ml-auto text-[10px]" style={{ color: c.attention }}>
                              overdue
                            </span>
                          )}
                        </div>
                      </article>
                    ))}

                    {mode !== 'my-tickets' && (
                      <button
                        onClick={() => {
                          setComposeStage(name);
                          setComposing(true);
                        }}
                        className="w-full rounded-md py-1.5 text-[11.5px]"
                        style={{ color: c.mute }}
                      >
                        + New ticket
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>

      {composing && (
        <NewTicket
          projects={projects}
          initialProjectId={mode === 'track' && scope ? scope.projectId : projectId}
          initialBoardId={mode === 'track' ? trackBoardId : boardId}
          initialStage={composeStage}
          {...(mode === 'track' && scope ? { initialChannelId: scope.channelId } : {})}
          knownTickets={tickets}
          onCreated={created => {
            // The create response already carries the new thread, so the ticket
            // can be opened and written to without a follow-up read.
            void report(created, `opened ${created.xyneId}: ${created.title ?? ''}`.trim(), 'activity');
            focusTicket(toWorkItem(created));
            void refresh();
          }}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
