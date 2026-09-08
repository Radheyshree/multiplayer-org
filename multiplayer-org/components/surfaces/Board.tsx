/**
 * Tickets Board — a working kanban, not a read-only rendering.
 *
 * Cards drag between stages, open into an editable detail pane, and can be
 * created. Moves apply optimistically and roll back if the server refuses,
 * which on a rules-driven board is a real answer rather than a failure.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { initials, loadDirectory, nameOf, resolvePeople, tintFor } from '../../lib/people';
import { c, eyebrow, mono } from '../../lib/theme';
import {
  createTicket,
  loadBoard,
  moveToStage,
  myTickets,
  PRIORITIES,
  stageName,
  type Priority,
  type Stage,
  type Ticket,
} from '../../lib/tickets';
import { xyne } from '../../lib/xyne';
import { NewTicket } from '../board/NewTicket';
import { TicketView } from '../board/TicketView';

type Project = { id: string; name?: string; code?: string };
type BoardRow = { id: string; name?: string };
type Mode = 'my-tickets' | 'board';

const PRIORITY_TINT: Record<string, string> = {
  CRITICAL: '#C0392B',
  HIGH: '#C8622F',
  MEDIUM: '#8A6A00',
  LOW: '#7A8090',
};

export function Board() {
  const [mode, setMode] = useState<Mode>('my-tickets');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [boards, setBoards] = useState<BoardRow[]>([]);
  const [boardId, setBoardId] = useState('');
  const [stages, setStages] = useState<Stage[]>([]);
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
      const rows = mode === 'my-tickets' ? await myTickets() : boardId ? (await loadBoard(boardId)).tickets : [];
      if (mode === 'my-tickets') {
        setStages([]);
        setNonLinear(false);
      } else if (boardId) {
        const b = await loadBoard(boardId);
        setStages(b.stages);
        setNonLinear(b.nonLinear);
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
  }, [mode, boardId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Columns: a board declares its stages; "my tickets" spans boards, so its
   *  columns are whatever stages came back (a different vocabulary). */
  const columns = useMemo(
    () =>
      mode === 'board'
        ? stages.map(stageName)
        : [...new Set(tickets.map(t => t.stageName ?? 'Unstaged'))],
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

  /** Optimistic move; the server's refusal is authoritative, so roll back. */
  const drop = async (toStage: string) => {
    const id = dragId;
    setDragId('');
    setOverStage('');
    const t = tickets.find(x => x.id === id);
    if (!t || !id || t.stageName === toStage) return;
    const before = t.stageName;
    setTickets(prev => prev.map(x => (x.id === id ? { ...x, stageName: toStage } : x)));
    try {
      await moveToStage(id, toStage, nonLinear);
    } catch (e) {
      setTickets(prev => prev.map(x => (x.id === id ? { ...x, stageName: before } : x)));
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const open = tickets.find(t => t.id === openId) ?? null;

  if (open) {
    return (
      <TicketView
        ticket={open}
        stages={mode === 'board' ? stages : columns.map(n => ({ name: n }))}
        nonLinear={nonLinear}
        onChanged={patch => setTickets(prev => prev.map(t => (t.id === open.id ? { ...t, ...patch } : t)))}
        onBack={() => setOpenId('')}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">

        <header className="flex flex-wrap items-center gap-2 px-6 pt-5 pb-3">
          <h1 className="text-[20px] leading-none font-semibold tracking-tight">Tickets</h1>

          <div className="flex rounded-md p-0.5" style={{ background: '#EFEEE9', border: `1px solid ${c.line}` }}>
            {(['my-tickets', 'board'] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="rounded px-2.5 py-1 text-[12px] font-medium"
                style={{ background: mode === m ? c.card : 'transparent', color: mode === m ? c.text : c.graphite }}
              >
                {m === 'my-tickets' ? 'My tickets' : 'By board'}
              </button>
            ))}
          </div>

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
          <p className="mx-6 mb-2 rounded-md px-3 py-2 text-[12.5px]" style={{ background: '#FCF2EC', color: c.attention }}>
            {error}
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
                    background: isOver ? c.signalSoft : '#F5F4F0',
                    border: `1px solid ${isOver ? c.signal : c.line}`,
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
                        onClick={() => setOpenId(t.id)}
                        className="cursor-pointer rounded-md p-2.5 transition-shadow hover:shadow-sm"
                        style={{
                          background: c.card,
                          border: `1px solid ${openId === t.id ? c.signal : c.line}`,
                          opacity: dragId === t.id ? 0.4 : 1,
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span style={{ fontFamily: mono, fontSize: '10px', color: c.signal }}>
                            {t.xyneId ?? t.id.slice(0, 8)}
                          </span>
                          {t.priority && (
                            <span style={{ fontFamily: mono, fontSize: '9px', color: PRIORITY_TINT[t.priority] }}>
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

                    {mode === 'board' && (
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
          initialProjectId={projectId}
          initialBoardId={boardId}
          initialStage={composeStage}
          knownTickets={tickets}
          onCreated={() => void refresh()}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
