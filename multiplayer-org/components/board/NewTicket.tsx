/**
 * Create a ticket.
 *
 * The SDK requires title, description and projectId; everything else is
 * optional but is what makes a ticket useful the moment it lands, so the form
 * offers board, stage, priority and assignee rather than making someone open
 * the ticket again to set them.
 */
import { useEffect, useState } from 'react';
import { allPeople } from '../../lib/people';
import { c, eyebrow, mono } from '../../lib/theme';
import { createTicket, PRIORITIES, stageName, type Priority, type Stage } from '../../lib/tickets';
import { xyne } from '../../lib/xyne';

type Project = { id: string; name?: string; code?: string };
type BoardRow = { id: string; name?: string };
type ChannelRow = { channelId: string; channel?: { name?: string; isArchived?: boolean } };

const control = { background: c.card, border: `1px solid ${c.line}` } as const;

export function NewTicket({
  projects,
  initialProjectId,
  initialBoardId,
  initialStage,
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
  knownTickets: Array<{ boardId?: string; channelId?: string }>;
  onCreated: () => void;
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
  const [channelId, setChannelId] = useState('');
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
    if (!boardId) return;
    const counts = new Map<string, number>();
    for (const t of knownTickets) {
      if (t.boardId === boardId && t.channelId) counts.set(t.channelId, (counts.get(t.channelId) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (best) {
      setChannelId(best);
      setChannelQuery('');
    }
  }, [boardId, knownTickets]);

  const submit = async () => {
    if (!title.trim() || !projectId) return;
    setBusy(true);
    setError(null);
    try {
      await createTicket({
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
      onCreated();
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
      // rgba(20,22,29,0.45) with spaces, so a substring selector on style
      // silently never matches and a test concludes the dialog never opened.
      data-dialog="new-ticket"
      className="fixed inset-0 z-50 grid place-items-center p-6"
      style={{ background: 'rgba(20,22,29,0.45)' }}
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
          <p className="mt-3 rounded-md px-3 py-2 text-[12.5px]" style={{ background: '#FCF2EC', color: c.attention }}>
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
              style={{ background: title.trim() && projectId && channelId && !busy ? c.signal : '#D8D6CF' }}
            >
              {busy ? 'Creating…' : 'Create ticket'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
