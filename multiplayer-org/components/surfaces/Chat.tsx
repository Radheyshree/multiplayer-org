/**
 * Xyne Chat — channels, threads, messages.
 *
 * channels.list already joins the channel row and carries unreadCount, so the
 * sidebar is one call rather than a list plus a per-channel read-state query.
 */
import { useEffect, useState } from 'react';
import { listAllMessages, listThreads, type ThreadRow } from '../../lib/chat';
import { Avatar, MessageList } from '../MessageList';
import { toPreview } from '../RichText';
import { loadDirectory, nameOf, resolvePeople } from '../../lib/people';
import { c, eyebrow, mono } from '../../lib/theme';
import { xyne } from '../../lib/xyne';

type ChannelRow = {
  channelId: string;
  unreadCount?: number;
  isStarred?: boolean;
  channel?: { name?: string; type?: string; visibility?: string; isArchived?: boolean };
};
type Message = {
  messageId: string;
  senderId: string;
  content: string;
  createdAt: number;
  msgType?: string;
  messageActs?: string | null;
};

export function Chat() {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [filter, setFilter] = useState('');
  const [channelId, setChannelId] = useState('');
  const [convs, setConvs] = useState<ThreadRow[]>([]);
  const [cursor, setCursor] = useState<{ createdAt: number } | null>(null);
  const [more, setMore] = useState(false);
  const [older, setOlder] = useState(false);
  const [previews, setPreviews] = useState<Record<string, Message>>({});
  const [convId, setConvId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { spaces } = await xyne();
      await loadDirectory();
      const rows = (await spaces.channels.list()) as unknown as ChannelRow[];
      const live = rows.filter(r => !r.channel?.isArchived);
      live.sort((a, b) => (b.unreadCount ?? 0) - (a.unreadCount ?? 0));
      setChannels(live);
      if (live[0]) setChannelId(live[0].channelId);
    })().catch(e => setError(String(e)));
  }, []);

  const addPreviews = async (rows: ThreadRow[]) => {
    const ids = rows.map(x => x.initialMessageId).filter((i): i is string => Boolean(i));
    if (!ids.length) return;
    const { spaces } = await xyne();
    const msgs = (await spaces.messages.getMany(ids)) as unknown as Message[];
    setPreviews(prev => {
      const map = { ...prev };
      for (const m of msgs ?? []) map[m.messageId] = m;
      return map;
    });
    await resolvePeople((msgs ?? []).map(m => m.senderId));
    setTick(t => t + 1);
  };

  useEffect(() => {
    if (!channelId) return;
    setConvId('');
    setMessages([]);
    setConvs([]);
    setCursor(null);
    void (async () => {
      const { threads, next } = await listThreads(channelId, null);
      setConvs(threads);
      setCursor(next);
      setMore(Boolean(next));
      await addPreviews(threads);
      const { spaces } = await xyne();
      void spaces.channels.markAsViewed(channelId).catch(() => {});
    })().catch(e => setError(String(e)));
  }, [channelId]);

  /** Walk further back through the channel's history. */
  const loadOlder = async () => {
    if (!cursor || older) return;
    setOlder(true);
    try {
      const { threads, next } = await listThreads(channelId, cursor);
      const known = new Set(convs.map(c => c.conversationId));
      const fresh = threads.filter(t => !known.has(t.conversationId));
      setConvs(prev => [...prev, ...fresh]);
      setCursor(next);
      setMore(Boolean(next) && fresh.length > 0);
      await addPreviews(fresh);
    } finally {
      setOlder(false);
    }
  };

  useEffect(() => {
    if (!convId) return;
    void (async () => {
      const items = await listAllMessages(convId);
      setMessages(items as unknown as Message[]);
      await resolvePeople(items.map(m => m.senderId));
      setTick(t => t + 1);
    })().catch(e => setError(String(e)));
  }, [convId]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !convId) return;
    setDraft('');
    const { spaces } = await xyne();
    await spaces.messages.send({ conversationId: convId, content: text });
    setMessages((await listAllMessages(convId)) as unknown as Message[]);
  };

  const shown = channels.filter(
    ch => !filter.trim() || (ch.channel?.name ?? '').toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <div className="grid h-full" style={{ gridTemplateColumns: '15rem 19rem 1fr' }} data-tick={tick}>
      <aside className="min-h-0 overflow-y-auto" style={{ borderRight: `1px solid ${c.line}` }}>
        <div className="p-2.5">
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter channels"
            className="h-8 w-full rounded-md px-2 text-[12.5px] outline-none"
            style={{ background: c.card, border: `1px solid ${c.line}` }}
          />
        </div>
        {shown.slice(0, 120).map(ch => (
          <button
            key={ch.channelId}
            onClick={() => setChannelId(ch.channelId)}
            className="mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-left"
            style={{
              width: 'calc(100% - 1rem)',
              background: channelId === ch.channelId ? '#ECEBE5' : 'transparent',
            }}
          >
            <span
              className="flex-1 truncate text-[12.5px]"
              style={{ fontWeight: (ch.unreadCount ?? 0) > 0 ? 700 : 400 }}
            >
              <span style={{ color: c.mute }}>{ch.channel?.visibility === 'PRIVATE' ? '\u25ef' : '#'}</span>{' '}
              {ch.channel?.name ?? ch.channelId.slice(0, 10)}
            </span>
            {(ch.unreadCount ?? 0) > 0 && (
              <span
                className="rounded-full px-1.5 py-0.5 text-white"
                style={{ fontFamily: mono, fontSize: '9px', background: c.signal }}
              >
                {ch.unreadCount}
              </span>
            )}
          </button>
        ))}
      </aside>

      <section
        className="min-h-0 overflow-y-auto"
        style={{ borderRight: `1px solid ${c.line}` }}
        onScroll={e => {
          const el = e.currentTarget;
          if (more && !older && el.scrollHeight - el.scrollTop - el.clientHeight < 240) void loadOlder();
        }}
      >
        <div className="px-3 py-2.5" style={{ ...eyebrow, color: c.graphite }}>
          Threads
        </div>
        {convs.length === 0 && (
          <p className="px-3 text-[12px]" style={{ color: c.mute }}>
            No threads here yet.
          </p>
        )}
        {convs.map(cv => {
          const opening = cv.initialMessageId ? previews[cv.initialMessageId] : undefined;
          return (
            <button
              key={cv.conversationId}
              onClick={() => setConvId(cv.conversationId)}
              className="w-full px-3 py-2 text-left"
              style={{
                background: convId === cv.conversationId ? c.signalSoft : 'transparent',
                borderBottom: `1px solid ${c.line}`,
              }}
            >
              <div className="flex gap-2">
                {opening && <Avatar id={opening.senderId} size={20} />}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[12.5px] leading-snug">
                    {opening ? toPreview(opening.content) || 'Untitled thread' : 'Untitled thread'}
                  </p>
                  <p className="mt-1 text-[10.5px]" style={{ color: c.mute }}>
                    {opening ? nameOf(opening.senderId) : '—'}
                    {(cv.replyCount ?? 0) > 0 ? ` · ${cv.replyCount} ${cv.replyCount === 1 ? 'reply' : 'replies'}` : ''}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
        {more && (
          <button
            onClick={() => void loadOlder()}
            disabled={older}
            className="w-full py-3 text-center"
            style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}
          >
            {older ? 'loading older…' : 'load older threads'}
          </button>
        )}
        {!more && convs.length > 0 && (
          <p className="py-3 text-center" style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}>
            start of history
          </p>
        )}
      </section>

      <section className="flex min-h-0 flex-col">
        <header
          className="flex shrink-0 items-center gap-2 px-5 py-3"
          style={{ borderBottom: `1px solid ${c.line}` }}
        >
          <span className="text-[15px] font-semibold">
            <span style={{ color: c.mute }}>#</span>{' '}
            {channels.find(x => x.channelId === channelId)?.channel?.name ?? 'channel'}
          </span>
          {convId && (
            <span className="rounded-full px-2 py-0.5 text-[10.5px]" style={{ background: '#F2F1EC', color: c.graphite }}>
              thread
            </span>
          )}
          <span className="ml-auto text-[11.5px]" style={{ color: c.mute }}>
            {convs.length} {convs.length === 1 ? 'thread' : 'threads'} loaded
          </span>
        </header>
        {error && (
          <p className="m-3 rounded-md px-3 py-2 text-[12.5px]" style={{ background: '#FCF2EC', color: c.attention }}>
            {error}
          </p>
        )}
        {!convId ? (
          <p className="m-auto text-[13px]" style={{ color: c.graphite }}>
            Pick a thread to read it.
          </p>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              <MessageList messages={messages} emptyText="No messages in this thread yet." />
            </div>
            <div className="p-3">
              <div
                className="rounded-xl px-3 py-2.5"
                style={{ background: c.card, border: `1px solid ${c.line}` }}
              >
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
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px]" style={{ color: c.mute }}>
                    Enter to send · Shift+Enter for a new line
                  </span>
                  <button
                    onClick={() => void send()}
                    disabled={!draft.trim()}
                    className="grid size-7 place-items-center rounded-lg text-white"
                    style={{ background: draft.trim() ? c.signal : '#D8D6CF' }}
                    aria-label="Send"
                  >
                    ↑
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
