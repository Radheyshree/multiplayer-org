import { MessageList, type Msg } from '../shared';
import { PRIORITIES, STATUSES, archiveTicket, assignTicket, createSubTicket, createTicket, describeActivity, getDetails, getMany, listActivities, listProjectTags, listSubTickets, moveTicket, stageName, updateTicket, type Activity, type CreatedTicket, type Priority, type Stage, type StatusV2, type SubTicket, type Tag, type Ticket, type TicketDetails } from '../../lib/tickets';
import { allPeople, initials, nameOf, resolvePeople, tintFor } from '../../lib/people';
import { c, eyebrow, mono, priorityColor } from '../../lib/theme';
import { listAllMessages, postMessage } from '../../lib/chat';
import { useCallback, useEffect, useState } from 'react';
import { xyne } from '../../lib/xyne';

/* ---- from components/board/TicketView.tsx ----------------------------- */
/**
 * The full ticket view — detail on the left, its conversation on the right,
 * mirroring what Spaces itself shows when you open a ticket. Opening replaces
 * the board rather than squeezing into a drawer, which is what the real app
 * does and what the field list needs to be readable.
 */

const control = { background: c.card, border: `1px solid ${c.line}` } as const;
const date = (t?: number) => (t ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

export function TicketView({
  ticket,
  stages,
  onChanged,
  onReport,
  gated,
  showConversation = true,
  onBack,
}: {
  ticket: Ticket;
  stages: Stage[];
  onChanged: (patch: Partial<Ticket>) => void;
  /**
   * Record what was just changed in the ticket's own conversation.
   *
   * Optional so the view still works outside the shell (a test harness, a
   * standalone route) — there the edit simply is not narrated.
   */
  onReport?: (what: string) => void;
  /** The board runs transition rules, so a move may be routed to an approval. */
  gated?: boolean;
  /**
   * Render this ticket's conversation alongside the fields.
   *
   * Off inside the shell, because the shell already shows that exact thread in
   * its ledger the moment the ticket is focused — two copies of one
   * conversation side by side is not two views, it is a bug that looks like a
   * feature. On for anything mounting this view on its own.
   */
  showConversation?: boolean;
  onBack: () => void;
}) {
  const [full, setFull] = useState<TicketDetails | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [subs, setSubs] = useState<SubTicket[]>([]);
  const [related, setRelated] = useState<Ticket[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [title, setTitle] = useState(ticket.title ?? '');
  const [desc, setDesc] = useState(ticket.description ?? '');
  const [newSub, setNewSub] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    const d = await getDetails(ticket.id);
    setFull(d);
    if (d) {
      setTitle(d.title ?? '');
      setDesc(d.description ?? '');
      await resolvePeople([d.assignedTo, d.createdBy, d.updatedBy as string | undefined]);
      const ids = [
        ...(d.referencesIn ?? []).map(r => r.sourceTicketId),
        ...(d.referencesOut ?? []).map(r => r.targetTicketId),
      ].filter((x): x is string => Boolean(x));
      if (ids.length) setRelated(await getMany(ids).catch(() => []));
      setTick(t => t + 1);
    }
  }, [ticket.id]);

  useEffect(() => {
    setError(null);
    setRelated([]);
    void load().catch(e => setError(String(e)));
    void listActivities(ticket.id)
      .then(async a => {
        setActivities(a);
        await resolvePeople(a.map(x => x.updatedBy));
        setTick(t => t + 1);
      })
      .catch(() => setActivities([]));
    void listSubTickets(ticket.id).then(setSubs).catch(() => setSubs([]));
  }, [ticket.id, load]);

  const conversationId = full?.conversationId ?? ticket.conversationId;
  useEffect(() => {
    if (!conversationId) return;
    void listAllMessages(conversationId)
      .then(async m => {
        setMessages(m as unknown as Msg[]);
        await resolvePeople(m.map(x => x.senderId));
        setTick(t => t + 1);
      })
      .catch(() => setMessages([]));
  }, [conversationId]);

  /**
   * Apply one field change, then narrate it.
   *
   * `describe` is passed rather than derived from the patch because the patch
   * is field-shaped ({assignedTo: 'u_1'}) and the ledger wants a sentence
   * ("assigned to Priya"). Nothing is narrated until the write has resolved —
   * the ledger records what happened, not what was attempted.
   */
  const run = async (fn: () => Promise<void>, patch: Partial<Ticket>, describe?: string) => {
    setError(null);
    try {
      await fn();
      onChanged(patch);
      setFull(prev => (prev ? { ...prev, ...patch } : prev));
      if (describe) onReport?.(describe);
      void listActivities(ticket.id).then(setActivities).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !conversationId) return;
    setDraft('');
    try {
      await postMessage(conversationId, `<p>${text}</p>`);
      setMessages((await listAllMessages(conversationId)) as unknown as Msg[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const t = full ?? (ticket as TicketDetails);

  return (
    <div className="flex h-full min-h-0" data-tick={tick}>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <header className={`flex items-center gap-2 px-6 pt-5 pb-3 ${showConversation ? '' : 'mx-auto w-full max-w-3xl'}`}>
          <button onClick={onBack} className="text-[13px]" style={{ color: c.graphite }}>
            ‹ Board
          </button>
          <span style={{ fontFamily: mono, fontSize: '11px', color: c.signal }}>
            {t.xyneId ?? t.id.slice(0, 8)}
          </span>
        </header>

        {/* Narrow enough to read a form in, and centred rather than left-hugging
            when the conversation pane is gone — a 700px column pinned to the
            left of a 1100px pane reads as a layout that failed to fill. */}
        <div className={`px-6 pb-10 ${showConversation ? 'max-w-2xl' : 'mx-auto w-full max-w-3xl'}`}>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={() => title !== t.title && void run(() => updateTicket(t.id, { title }), { title }, `retitled to "${title}"`)}
            className="w-full bg-transparent text-[24px] leading-tight font-semibold outline-none"
          />
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            onBlur={() => desc !== t.description && void run(() => updateTicket(t.id, { description: desc }), { description: desc }, 'edited the description')}
            rows={2}
            placeholder="Add a description"
            className="mt-2 w-full resize-y bg-transparent text-[13.5px] leading-relaxed outline-none"
            style={{ color: c.graphite }}
          />

          {error && (
            <p className="my-3 rounded-md px-3 py-2 text-[12.5px]" style={{ background: c.attentionSoft, color: c.attention }}>
              {error}
            </p>
          )}

          <div className="mt-5">
            <Row label="Assignee">
              <AssigneePicker
                current={t.assignedTo}
                onPick={id => void run(() => assignTicket(t.id, id), { assignedTo: id }, `assigned to ${nameOf(id)}`)}
              />
            </Row>
            <Row label="Created at">
              <span className="text-[13px]">{date(t.createdAt)}</span>
            </Row>
            <Row label="Created by">
              {t.createdBy ? (
                <span className="flex items-center gap-1.5 text-[13px]">
                  <span
                    className="grid size-5 place-items-center rounded text-white"
                    style={{ background: tintFor(t.createdBy), fontSize: '8px' }}
                  >
                    {initials(nameOf(t.createdBy))}
                  </span>
                  {nameOf(t.createdBy)}
                </span>
              ) : (
                <span className="text-[13px]" style={{ color: c.mute }}>—</span>
              )}
            </Row>
            <Row label="Board">
              <span className="text-[13px]">{t.project?.name ?? t.boardId?.slice(0, 10) ?? '—'}</span>
            </Row>
            <Row label="Stage">
              <select
                value={t.stageName ?? ''}
                onChange={e => {
                  const next = e.target.value;
                  const from = t.stageName ?? '—';
                  void run(
                    async () => {
                      const target = stages.find(st => stageName(st) === next);
                      const { applied, queued } = await moveTicket(
                        { id: t.id },
                        { ...(target?.id ? { id: target.id } : {}), name: next },
                      );
                      // Same rule as the board: a move the server accepted but
                      // did not apply must not repaint the field as though it did.
                      if (!applied) {
                        throw new Error(
                          queued
                            ? `${next} needs approval — a stage request is open.`
                            : `The board did not move this to ${next}.`,
                        );
                      }
                    },
                    { stageName: next },
                    `moved ${from} → ${next}`,
                  );
                }}
                className="h-8 w-56 rounded-md px-2 text-[12.5px] outline-none"
                style={control}
              >
                {stages.map(s => (
                  <option key={stageName(s)} value={stageName(s)}>
                    {stageName(s)}
                  </option>
                ))}
              </select>
              {gated && (
                <p className="mt-1 text-[11px]" style={{ color: c.mute }}>
                  This board runs transition rules — a move may need approval.
                </p>
              )}
            </Row>
            <Row label="Status">
              <select
                value={t.statusV2 ?? 'TODO'}
                onChange={e => void run(() => updateTicket(t.id, { statusV2: e.target.value as StatusV2 }), { statusV2: e.target.value as StatusV2 }, `status → ${e.target.value}`)}
                className="h-8 w-56 rounded-md px-2 text-[12.5px] outline-none"
                style={control}
              >
                {STATUSES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Row>
            <Row label="Priority">
              <div className="flex flex-wrap gap-1">
                {PRIORITIES.map(p => (
                  <button
                    key={p}
                    onClick={() => void run(() => updateTicket(t.id, { priority: p }), { priority: p }, `priority → ${p}`)}
                    className="rounded-full border px-2 py-0.5 text-[11px] font-medium"
                    style={{
                      borderColor: t.priority === p ? priorityColor(p) : c.line,
                      color: t.priority === p ? priorityColor(p) : c.graphite,
                      background: t.priority === p ? c.card : 'transparent',
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Type">
              <span className="text-[13px]">{t.ticketType ?? '—'}</span>
            </Row>
            <Row label="Due date">
              <span className="text-[13px]">{t.eta ? date(t.eta) : 'Not set'}</span>
            </Row>
            <Row label="Labels">
              {t.projectId ? (
                <TagPicker
                  projectId={t.projectId}
                  applied={(t.tagMappings ?? []).map(m => m.tagName ?? '').filter(Boolean)}
                  onAdd={name => void run(async () => {
                    const { addTag } = await import('../../lib/tickets');
                    await addTag(t.id, t.projectId as string, name);
                  }, {}, `tagged ${name}`)}
                />
              ) : (
                <span className="text-[13px]" style={{ color: c.mute }}>—</span>
              )}
            </Row>
          </div>

          <section className="mt-7">
            <p style={{ ...eyebrow, color: c.graphite }}>Sub-tickets ({subs.length})</p>
            {subs.map(s => (
              <p key={s.subTicketId ?? s.id} className="mt-1.5 text-[13px]">{s.title ?? 'Untitled'}</p>
            ))}
            <input
              value={newSub}
              onChange={e => setNewSub(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newSub.trim()) {
                  const v = newSub.trim();
                  setNewSub('');
                  void run(() => createSubTicket(t.id, v), {}, `added sub-ticket "${v}"`).then(() =>
                    listSubTickets(t.id).then(setSubs).catch(() => {}),
                  );
                }
              }}
              placeholder="+ Create sub-ticket"
              className="mt-2 h-8 w-full max-w-md rounded-md px-2 text-[12.5px] outline-none"
              style={control}
            />
          </section>

          <section className="mt-7">
            <p style={{ ...eyebrow, color: c.graphite }}>Related tickets ({related.length})</p>
            {related.length === 0 ? (
              <p className="mt-1.5 text-[13px]" style={{ color: c.mute }}>No related tickets yet.</p>
            ) : (
              related.map(r => (
                <p key={r.id} className="mt-1.5 text-[13px]">
                  <span style={{ fontFamily: mono, fontSize: '10.5px', color: c.signal }}>{r.xyneId ?? r.id.slice(0, 8)}</span>{' '}
                  {r.title}
                </p>
              ))
            )}
          </section>

          <section className="mt-7">
            <p style={{ ...eyebrow, color: c.graphite }}>Activity</p>
            <ol className="mt-2 space-y-2">
              {activities.map(a => {
                const d = describeActivity(a);
                return (
                  <li key={a.id} className="flex gap-2">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: c.line }} aria-hidden />
                    <div className="min-w-0">
                      <p className="text-[12.5px] leading-snug">
                        {d.href ? (
                          <a href={d.href} target="_blank" rel="noopener noreferrer" style={{ color: c.signal, textDecoration: 'underline' }}>
                            {d.text}
                          </a>
                        ) : (
                          d.text
                        )}
                      </p>
                      <p style={{ fontFamily: mono, fontSize: '9.5px', color: c.mute }}>
                        {a.updatedBy ? `${nameOf(a.updatedBy)} · ` : ''}
                        {a.timestamp ? new Date(a.timestamp).toLocaleString() : ''}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <button
            onClick={() => void run(() => archiveTicket(t.id), { isArchived: true }, 'archived this ticket').then(onBack)}
            className="mt-8 rounded-md border px-2.5 py-1 text-[12px]"
            style={{ borderColor: c.line, color: c.attention }}
          >
            Archive ticket
          </button>
        </div>
      </div>

      {showConversation ? (
      <aside className="flex min-h-0 flex-col" style={{ width: '26rem', borderLeft: `1px solid ${c.line}` }}>
        <header className="px-4 py-3" style={{ borderBottom: `1px solid ${c.line}` }}>
          <span style={{ ...eyebrow, color: c.graphite }}>Messages</span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          <MessageList messages={messages} emptyText="No messages on this ticket yet." />
        </div>
        <div className="p-3" style={{ borderTop: `1px solid ${c.line}` }}>
          <div className="rounded-xl px-3 py-2.5" style={control}>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder="Reply to this thread…"
              className="max-h-32 w-full resize-none bg-transparent text-[13.5px] outline-none"
              disabled={!conversationId}
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px]" style={{ color: c.mute }}>
                {conversationId ? 'Enter to send' : 'No thread on this ticket'}
              </span>
              <button
                onClick={() => void send()}
                disabled={!draft.trim() || !conversationId}
                className="grid size-7 place-items-center rounded-lg text-white"
                style={{ background: draft.trim() && conversationId ? c.signal : c.line }}
                aria-label="Send"
              >
                ↑
              </button>
            </div>
          </div>
        </div>
      </aside>
      ) : null}
    </div>
  );
}

/* ---- from components/board/NewTicket.tsx ------------------------------ */
/**
 * Create a ticket.
 *
 * The SDK requires title, description and projectId; everything else is
 * optional but is what makes a ticket useful the moment it lands, so the form
 * offers board, stage, priority and assignee rather than making someone open
 * the ticket again to set them.
 */

type Project = { id: string; name?: string; code?: string };
type BoardRow = { id: string; name?: string };
type ChannelRow = { channelId: string; channel?: { name?: string; isArchived?: boolean } };


export function NewTicket({
  projects,
  initialProjectId,
  initialBoardId,
  initialStage,
  /** The track's channel, when the shell knows it. Beats inference outright. */
  initialChannelId,
  /** Tickets already on screen — used to infer this board's channel. */
  knownTickets,
  onCreated,
  onClose,
}: {
  projects: Project[];
  initialProjectId: string;
  initialBoardId: string;
  /** Preselected column, when opened from one. */
  initialStage: string;
  initialChannelId?: string;
  knownTickets: Array<{ boardId?: string; channelId?: string }>;
  onCreated: (created: CreatedTicket) => void;
  onClose: () => void;
}) {
  const [projectId, setProjectId] = useState(initialProjectId);
  const [boards, setBoards] = useState<BoardRow[]>([]);
  const [boardId, setBoardId] = useState(initialBoardId);
  const [stages, setStages] = useState<Stage[]>([]);
  const [stage, setStage] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [assignee, setAssignee] = useState('');
  const [assignQuery, setAssignQuery] = useState('');
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [channelId, setChannelId] = useState(initialChannelId ?? '');
  const [channelQuery, setChannelQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    void (async () => {
      const { spaces } = await xyne();
      const bs = (await spaces.boards.listByProjectLite(projectId)) as unknown as BoardRow[];
      setBoards(bs);
      setBoardId(prev => (bs.some(b => b.id === prev) ? prev : (bs[0]?.id ?? '')));
    })().catch(e => setError(String(e)));
  }, [projectId]);

  useEffect(() => {
    if (!boardId) return void setStages([]);
    void (async () => {
      const { spaces } = await xyne();
      const st = (await spaces.boards.listStages(boardId)) as unknown as Stage[];
      const ordered = [...st].sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0));
      setStages(ordered);
      // Respect the column the dialog was opened from.
      const preset = ordered.find(x => stageName(x) === initialStage);
      setStage(preset ? stageName(preset) : ordered[0] ? stageName(ordered[0]) : '');
    })().catch(() => setStages([]));
  }, [boardId, initialStage]);

  useEffect(() => {
    void (async () => {
      const { spaces } = await xyne();
      const rows = (await spaces.channels.list()) as unknown as ChannelRow[];
      setChannels(rows.filter(r => r.channel?.name && !r.channel.isArchived));
    })().catch(() => setChannels([]));
  }, []);

  // The server requires channelId (or a source conversation), though the SDK
  // types both optional. There is no board -> channel mapping to read:
  // channel.selectedBoardId is populated on 1 of 207 channels here. What IS
  // reliable is that every existing ticket carries its channel, so infer the
  // board's channel from the tickets already on it, and let the user override.
  useEffect(() => {
    // Opened from a track, the channel is a fact rather than a guess — the
    // shell resolved it. Inference is the fallback for the standalone board.
    if (initialChannelId || !boardId) return;
    const counts = new Map<string, number>();
    for (const t of knownTickets) {
      if (t.boardId === boardId && t.channelId) counts.set(t.channelId, (counts.get(t.channelId) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (best) {
      setChannelId(best);
      setChannelQuery('');
    }
  }, [boardId, knownTickets, initialChannelId]);

  const submit = async () => {
    if (!title.trim() || !projectId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createTicket({
        title: title.trim(),
        // The server rejects an EMPTY description, not just a missing one — it
        // tests truthiness. Xyne's own tickets mirror the title when no body was
        // given, so do the same rather than forcing busywork.
        description: description.trim() || title.trim(),
        projectId,
        channelId,
        ...(boardId ? { boardId } : {}),
        ...(stage ? { stageName: stage } : {}),
        priority,
        ...(assignee ? { assignedTo: assignee } : {}),
      });
      onCreated(created);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const people = assignQuery.trim()
    ? allPeople().filter(p => p.name.toLowerCase().includes(assignQuery.trim().toLowerCase())).slice(0, 5)
    : [];

  return (
    <div
      // An explicit hook, not a style-attribute match: the browser reserialises
      // an rgb()/rgba() value with its own spacing, so a substring selector on
      // style silently never matches and a test concludes the dialog never opened.
      data-dialog="new-ticket"
      className="fixed inset-0 z-50 grid place-items-center p-6"
      style={{ background: c.scrim }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl p-5"
        style={{ background: c.paper, border: `1px solid ${c.line}` }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">New ticket</h2>
          <button onClick={onClose} className="text-[16px]" style={{ color: c.mute }} aria-label="Close">
            ×
          </button>
        </div>

        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && void submit()}
          placeholder="What needs doing?"
          className="mt-4 h-9 w-full rounded-md px-2.5 text-[13.5px] outline-none"
          style={control}
        />
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
          placeholder="Description (optional)"
          className="mt-2 w-full resize-y rounded-md px-2.5 py-2 text-[13px] outline-none"
          style={control}
        />

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block">
            <span style={{ ...eyebrow, color: c.mute }}>Project</span>
            <select
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              className="mt-1 h-8 w-full rounded-md px-2 text-[12.5px] outline-none"
              style={control}
            >
              {projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.code ? `${p.code} — ` : ''}
                  {p.name ?? p.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span style={{ ...eyebrow, color: c.mute }}>Board</span>
            <select
              value={boardId}
              onChange={e => setBoardId(e.target.value)}
              className="mt-1 h-8 w-full rounded-md px-2 text-[12.5px] outline-none"
              style={control}
            >
              {boards.length === 0 && <option value="">No boards</option>}
              {boards.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name ?? b.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span style={{ ...eyebrow, color: c.mute }}>Stage</span>
            <select
              value={stage}
              onChange={e => setStage(e.target.value)}
              className="mt-1 h-8 w-full rounded-md px-2 text-[12.5px] outline-none"
              style={control}
            >
              {stages.length === 0 && <option value="">Default</option>}
              {stages.map(s => (
                <option key={stageName(s)} value={stageName(s)}>
                  {stageName(s)}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span style={{ ...eyebrow, color: c.mute }}>Assignee</span>
            <input
              value={assignQuery}
              onChange={e => setAssignQuery(e.target.value)}
              placeholder={assignee ? 'Assigned' : 'Optional — type a name'}
              className="mt-1 h-8 w-full rounded-md px-2 text-[12.5px] outline-none"
              style={control}
            />
            {people.map(p => (
              <button
                key={p.id}
                onClick={() => {
                  setAssignee(p.id);
                  setAssignQuery(p.name);
                }}
                className="mt-1 block w-full rounded px-2 py-1 text-left text-[12px] hover:bg-black/5"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <span style={{ ...eyebrow, color: c.mute }}>Channel</span>
          <input
            value={channelQuery || (channels.find(ch => ch.channelId === channelId)?.channel?.name ?? '')}
            onChange={e => {
              setChannelQuery(e.target.value);
              setChannelId('');
            }}
            placeholder={channels.length ? 'Required — the ticket’s thread lives here' : 'Loading channels…'}
            className="mt-1 h-8 w-full rounded-md px-2 text-[12.5px] outline-none"
            style={control}
          />
          {channelQuery.trim() && (
            <div className="mt-1 flex flex-wrap gap-1">
              {channels
                .filter(ch => (ch.channel?.name ?? '').toLowerCase().includes(channelQuery.trim().toLowerCase()))
                .slice(0, 6)
                .map(ch => (
                  <button
                    key={ch.channelId}
                    onClick={() => {
                      setChannelId(ch.channelId);
                      setChannelQuery('');
                    }}
                    className="rounded-full border px-2 py-0.5 text-[11px]"
                    style={{ borderColor: c.line, color: c.graphite }}
                  >
                    #{ch.channel?.name}
                  </button>
                ))}
            </div>
          )}
        </div>

        <div className="mt-3">
          <span style={{ ...eyebrow, color: c.mute }}>Priority</span>
          <div className="mt-1 flex gap-1">
            {PRIORITIES.map(p => (
              <button
                key={p}
                onClick={() => setPriority(p)}
                className="rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
                style={{
                  borderColor: priority === p ? c.signal : c.line,
                  color: priority === p ? c.signal : c.graphite,
                  background: priority === p ? c.signalSoft : 'transparent',
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-md px-3 py-2 text-[12.5px]" style={{ background: c.attentionSoft, color: c.attention }}>
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-between">
          <span style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}>
            {channelId
              ? `creates a real ticket in #${channels.find(ch => ch.channelId === channelId)?.channel?.name ?? 'channel'}`
              : 'pick a channel — the server requires one'}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-[12.5px]" style={{ borderColor: c.line }}>
              Cancel
            </button>
            <button
              onClick={() => void submit()}
              disabled={busy || !title.trim() || !projectId || !channelId}
              className="rounded-md px-3 py-1.5 text-[12.5px] font-medium text-white"
              style={{ background: title.trim() && projectId && channelId && !busy ? c.signal : c.line }}
            >
              {busy ? 'Creating…' : 'Create ticket'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- from components/board/fields.tsx --------------------------------- */
/** Small field controls shared by the ticket view. */


export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-start gap-3 py-2" style={{ borderTop: `1px solid ${c.line}` }}>
      <span className="pt-1" style={{ ...eyebrow, color: c.mute }}>
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function AssigneePicker({ current, onPick }: { current?: string | null; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const hits = q.trim()
    ? allPeople().filter(p => p.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6)
    : [];

  return (
    <div>
      {current ? (
        <span className="flex items-center gap-1.5 text-[13px]">
          <span
            className="grid size-5 place-items-center rounded text-white"
            style={{ background: tintFor(current), fontSize: '8px' }}
          >
            {initials(nameOf(current))}
          </span>
          {nameOf(current)}
        </span>
      ) : (
        <span className="text-[13px]" style={{ color: c.mute }}>
          Unassigned
        </span>
      )}
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Assign — type a name"
        className="mt-1.5 h-8 w-56 rounded-md px-2 text-[12.5px] outline-none"
        style={control}
      />
      {hits.map(p => (
        <button
          key={p.id}
          onClick={() => {
            setQ('');
            onPick(p.id);
          }}
          className="mt-1 block w-56 rounded px-2 py-1 text-left text-[12px] hover:bg-black/5"
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}

export function TagPicker({
  projectId,
  applied,
  onAdd,
}: {
  projectId: string;
  applied: string[];
  onAdd: (name: string) => void;
}) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    void listProjectTags(projectId).then(setTags).catch(() => setTags([]));
  }, [projectId]);

  const hits = q.trim()
    ? tags.filter(t => (t.name ?? t.tagName ?? '').toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8)
    : [];

  return (
    <div>
      {applied.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {applied.map(a => (
            <span
              key={a}
              className="rounded-full px-2 py-0.5 text-[11px]"
              style={{ background: c.signalSoft, color: c.signal }}
            >
              {a}
            </span>
          ))}
        </div>
      )}
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={tags.length ? `Add label — search ${tags.length}` : 'Loading labels…'}
        className="h-8 w-56 rounded-md px-2 text-[12.5px] outline-none"
        style={control}
      />
      {hits.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {hits.map(t => {
            const name = t.name ?? t.tagName ?? '';
            return (
              <button
                key={t.id}
                onClick={() => {
                  setQ('');
                  onAdd(name);
                }}
                className="rounded-full border px-2 py-0.5 text-[11px]"
                style={{ borderColor: c.line, color: c.graphite }}
              >
                + {name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
