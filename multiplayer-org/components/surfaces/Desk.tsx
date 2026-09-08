/**
 * Xyne Desk — the support inbox.
 *
 * supportTickets.list joins the ticket's emails, project and conversation in
 * one call, so the list renders with mail previews without a second round trip.
 * Writes go through tickets.* — supportTickets is read-only by design.
 */
import { useEffect, useState } from 'react';
import { loadDirectory, nameOf, resolvePeople } from '../../lib/people';
import { RichText, toPreview } from '../RichText';
import { c, eyebrow, mono } from '../../lib/theme';
import { xyne } from '../../lib/xyne';

type ChannelRow = {
  channelId: string;
  unreadCount?: number;
  channel?: { name?: string; type?: string; isArchived?: boolean };
};
type Email = {
  id: string;
  subject?: string;
  body?: string;
  from?: string;
  to?: string[];
  createdAt?: number;
  sentAt?: number;
};
type DeskTicket = {
  id: string;
  xyneId?: string;
  title?: string;
  priority?: string;
  stageName?: string;
  assignedTo?: string;
  conversationId?: string;
  emails?: Email[];
};

export function Desk() {
  const [desks, setDesks] = useState<ChannelRow[]>([]);
  const [channelId, setChannelId] = useState('');
  const [tickets, setTickets] = useState<DeskTicket[]>([]);
  const [openId, setOpenId] = useState('');
  const [thread, setThread] = useState<Email[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { spaces } = await xyne();
      // Finding desks relies on a quirk (see SDK-GAPS.md): the backend query
      // behind listEmail filters the RELATED channel row rather than the parent,
      // so it returns every channel_user_status row but only populates `channel`
      // on the desk ones. Keeping the rows that have a channel gives exactly the
      // desks — and it is the only way to enumerate them, since
      // email.getChannelPreference is per-channel with no list variant.
      await loadDirectory();
      const rows = (await spaces.channels.listEmail()) as unknown as ChannelRow[];
      const decks = rows.filter(r => r.channel && !r.channel.isArchived);
      setDesks(decks);
      if (decks[0]) setChannelId(decks[0].channelId);
      if (!decks.length) setError('No support desks are configured on this workspace.');
    })().catch(e => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!channelId) return;
    setBusy(true);
    setOpenId('');
    setThread([]);
    void (async () => {
      const { spaces } = await xyne();
      const ts = (await spaces.supportTickets.list(channelId, { limit: 25 })) as unknown as DeskTicket[];
      setTickets(ts);
      await resolvePeople(ts.map(t => t.assignedTo));
    })()
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [channelId]);

  const open = async (t: DeskTicket) => {
    setOpenId(t.id);
    setSent(null);
    // The list already joins emails; only ask again if it came back empty.
    if (t.emails?.length) return setThread(t.emails);
    if (!t.conversationId) return setThread([]);
    const { spaces } = await xyne();
    const mails = (await spaces.tickets.listEmails(t.conversationId)) as unknown as Email[];
    setThread(mails ?? []);
  };

  const reply = async () => {
    const text = draft.trim();
    const t = tickets.find(x => x.id === openId);
    if (!text || !t?.conversationId) return;
    setDraft('');
    const { spaces } = await xyne();
    await spaces.messages.send({ conversationId: t.conversationId, content: text });
    setSent('Reply posted to the ticket thread.');
  };

  const current = tickets.find(t => t.id === openId);

  return (
    <div className="grid h-full" style={{ gridTemplateColumns: '22rem 1fr' }}>
      <aside className="flex min-h-0 flex-col" style={{ borderRight: `1px solid ${c.line}` }}>
        <div className="p-3">
          <div style={{ ...eyebrow, color: c.graphite }}>Desk</div>
          <select
            value={channelId}
            onChange={e => setChannelId(e.target.value)}
            className="mt-1.5 h-8 w-full rounded-md px-2 text-[12.5px] outline-none"
            style={{ background: c.card, border: `1px solid ${c.line}` }}
          >
            {desks.map(d => (
              <option key={d.channelId} value={d.channelId}>
                {d.channel?.name ?? d.channelId.slice(0, 10)}
              </option>
            ))}
          </select>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {busy && <p className="px-3" style={{ fontFamily: mono, fontSize: '11px', color: c.mute }}>loading…</p>}
          {!busy && tickets.length === 0 && (
            <p className="px-3 text-[12.5px]" style={{ color: c.graphite }}>
              No tickets in this desk.
            </p>
          )}
          {tickets.map(t => (
            <button
              key={t.id}
              onClick={() => void open(t)}
              className="w-full px-3 py-2.5 text-left"
              style={{
                background: openId === t.id ? c.signalSoft : 'transparent',
                borderBottom: `1px solid ${c.line}`,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span style={{ fontFamily: mono, fontSize: '10px', color: c.signal }}>{t.xyneId ?? t.id.slice(0, 8)}</span>
                {t.priority && (
                  <span style={{ fontFamily: mono, fontSize: '9px', color: c.mute }}>{t.priority}</span>
                )}
              </div>
              <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug">{t.title ?? 'Untitled'}</p>
              {t.emails?.length ? (
                <p className="mt-0.5 line-clamp-1 text-[11.5px]" style={{ color: c.mute }}>
                  {toPreview(t.emails[t.emails.length - 1].body ?? '', 90)}
                </p>
              ) : null}
              <p className="mt-1" style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}>
                {t.stageName ?? '—'}
                {t.assignedTo ? ` · ${nameOf(t.assignedTo)}` : ''}
                {t.emails?.length ? ` · ${t.emails.length} mail` : ''}
              </p>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-h-0 flex-col">
        {error && (
          <p className="m-3 rounded-md px-3 py-2 text-[12.5px]" style={{ background: '#FCF2EC', color: c.attention }}>
            {error}
          </p>
        )}
        {!current ? (
          <p className="m-auto text-[13px]" style={{ color: c.graphite }}>
            Pick a ticket to read its mail.
          </p>
        ) : (
          <>
            <header className="px-6 pt-6 pb-3">
              <div style={{ fontFamily: mono, fontSize: '10px', color: c.signal }}>
                {current.xyneId ?? current.id.slice(0, 8)}
              </div>
              <h1 className="mt-1 text-[19px] leading-snug font-semibold">{current.title ?? 'Untitled'}</h1>
              <p className="mt-1.5" style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}>
                {current.stageName ?? '—'}
                {current.assignedTo ? ` · assigned to ${nameOf(current.assignedTo)}` : ' · unassigned'}
              </p>
            </header>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 pb-4">
              {thread.length === 0 && (
                <p className="text-[12.5px]" style={{ color: c.graphite }}>
                  No email on this ticket — it was raised in chat rather than by mail.
                </p>
              )}
              {thread.map(m => (
                <article key={m.id} className="rounded-lg p-3.5" style={{ background: c.card, border: `1px solid ${c.line}` }}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[12.5px] font-semibold">{m.from ?? 'unknown sender'}</span>
                    <span style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}>
                      {m.sentAt || m.createdAt ? new Date(m.sentAt ?? m.createdAt!).toLocaleString() : ''}
                    </span>
                  </div>
                  {m.subject && <p className="mt-0.5 text-[12.5px]" style={{ color: c.graphite }}>{m.subject}</p>}
                  <div className="mt-2 text-[13px] leading-relaxed">
                    <RichText html={m.body ?? ''} />
                  </div>
                </article>
              ))}
            </div>

            <div className="p-4" style={{ borderTop: `1px solid ${c.line}` }}>
              {sent && (
                <p className="mb-2" style={{ fontFamily: mono, fontSize: '10px', color: c.live }}>
                  {sent}
                </p>
              )}
              <div className="flex gap-2">
                <input
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && void reply()}
                  placeholder="Reply on this ticket"
                  className="h-9 flex-1 rounded-md px-3 text-[13px] outline-none"
                  style={{ background: c.card, border: `1px solid ${c.line}` }}
                />
                <button
                  onClick={() => void reply()}
                  disabled={!draft.trim()}
                  className="rounded-md px-3 text-[12.5px] font-medium text-white"
                  style={{ background: draft.trim() ? c.signal : c.mute }}
                >
                  Reply
                </button>
              </div>
              <p className="mt-2 text-[11.5px]" style={{ color: c.mute }}>
                Posts into the ticket thread. It leaves as email only if this desk has send-as-email switched on.
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
