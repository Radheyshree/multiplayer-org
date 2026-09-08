/**
 * The full ticket view — detail on the left, its conversation on the right,
 * mirroring what Spaces itself shows when you open a ticket. Opening replaces
 * the board rather than squeezing into a drawer, which is what the real app
 * does and what the field list needs to be readable.
 */
import { useCallback, useEffect, useState } from 'react';
import { listAllMessages, postMessage } from '../../lib/chat';
import { initials, nameOf, resolvePeople, tintFor } from '../../lib/people';
import { c, eyebrow, mono } from '../../lib/theme';
import {
  archiveTicket,
  assignTicket,
  createSubTicket,
  describeActivity,
  getDetails,
  getMany,
  listActivities,
  listSubTickets,
  moveToStage,
  PRIORITIES,
  stageName,
  STATUSES,
  updateTicket,
  type Activity,
  type Priority,
  type Stage,
  type StatusV2,
  type SubTicket,
  type Ticket,
  type TicketDetails,
} from '../../lib/tickets';
import { MessageList, type Msg } from '../MessageList';
import { AssigneePicker, Row, TagPicker } from './fields';

const PRIORITY_TINT: Record<string, string> = {
  CRITICAL: '#C0392B',
  HIGH: '#C8622F',
  MEDIUM: '#8A6A00',
  LOW: '#7A8090',
};

const control = { background: c.card, border: `1px solid ${c.line}` } as const;
const date = (t?: number) => (t ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

export function TicketView({
  ticket,
  stages,
  nonLinear,
  onChanged,
  onBack,
}: {
  ticket: Ticket;
  stages: Stage[];
  nonLinear: boolean;
  onChanged: (patch: Partial<Ticket>) => void;
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

  const run = async (fn: () => Promise<void>, patch: Partial<Ticket>) => {
    setError(null);
    try {
      await fn();
      onChanged(patch);
      setFull(prev => (prev ? { ...prev, ...patch } : prev));
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
        <header className="flex items-center gap-2 px-6 pt-5 pb-3">
          <button onClick={onBack} className="text-[13px]" style={{ color: c.graphite }}>
            ‹ Board
          </button>
          <span style={{ fontFamily: mono, fontSize: '11px', color: c.signal }}>
            {t.xyneId ?? t.id.slice(0, 8)}
          </span>
        </header>

        <div className="max-w-2xl px-6 pb-10">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={() => title !== t.title && void run(() => updateTicket(t.id, { title }), { title })}
            className="w-full bg-transparent text-[24px] leading-tight font-semibold outline-none"
          />
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            onBlur={() => desc !== t.description && void run(() => updateTicket(t.id, { description: desc }), { description: desc })}
            rows={2}
            placeholder="Add a description"
            className="mt-2 w-full resize-y bg-transparent text-[13.5px] leading-relaxed outline-none"
            style={{ color: c.graphite }}
          />

          {error && (
            <p className="my-3 rounded-md px-3 py-2 text-[12.5px]" style={{ background: '#FCF2EC', color: c.attention }}>
              {error}
            </p>
          )}

          <div className="mt-5">
            <Row label="Assignee">
              <AssigneePicker
                current={t.assignedTo}
                onPick={id => void run(() => assignTicket(t.id, id), { assignedTo: id })}
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
                onChange={e => void run(() => moveToStage(t.id, e.target.value, nonLinear), { stageName: e.target.value })}
                className="h-8 w-56 rounded-md px-2 text-[12.5px] outline-none"
                style={control}
              >
                {stages.map(s => (
                  <option key={stageName(s)} value={stageName(s)}>
                    {stageName(s)}
                  </option>
                ))}
              </select>
              {nonLinear && (
                <p className="mt-1 text-[11px]" style={{ color: c.mute }}>
                  This board runs transition rules — a move may need approval.
                </p>
              )}
            </Row>
            <Row label="Status">
              <select
                value={t.statusV2 ?? 'TODO'}
                onChange={e => void run(() => updateTicket(t.id, { statusV2: e.target.value as StatusV2 }), { statusV2: e.target.value as StatusV2 })}
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
                    onClick={() => void run(() => updateTicket(t.id, { priority: p }), { priority: p })}
                    className="rounded-full border px-2 py-0.5 text-[11px] font-medium"
                    style={{
                      borderColor: t.priority === p ? PRIORITY_TINT[p] : c.line,
                      color: t.priority === p ? PRIORITY_TINT[p] : c.graphite,
                      background: t.priority === p ? '#FFF' : 'transparent',
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
                  }, {})}
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
                  void run(() => createSubTicket(t.id, v), {}).then(() =>
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
            onClick={() => void run(() => archiveTicket(t.id), { isArchived: true }).then(onBack)}
            className="mt-8 rounded-md border px-2.5 py-1 text-[12px]"
            style={{ borderColor: c.line, color: c.attention }}
          >
            Archive ticket
          </button>
        </div>
      </div>

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
                style={{ background: draft.trim() && conversationId ? c.signal : '#D8D6CF' }}
                aria-label="Send"
              >
                ↑
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
