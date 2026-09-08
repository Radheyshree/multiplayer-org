/**
 * The message list, following the dashboard's reading rules: consecutive
 * messages from one sender inside five minutes lose their header, each calendar
 * day gets a separator, and the act tag (DISCUSSION / QUESTION / …) sits beside
 * the timestamp.
 */
import { useEffect, useRef } from 'react';
import { initials, personOf, tintFor } from '../lib/people';
import { c, mono } from '../lib/theme';
import { RichText } from './RichText';

export type Msg = {
  messageId: string;
  senderId: string;
  content: string;
  createdAt: number;
  msgType?: string;
  messageActs?: string | null;
};

const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Act-tag tints. Five acts, five of the shell's semantic hues — so a tag reads
 * as the same KIND of thing here as everywhere else in the app, and inverts
 * with the theme instead of staying a light pastel on a dark page.
 */
const ACT_TINT: Record<string, { bg: string; fg: string }> = {
  DISCUSSION: { bg: c.dangerSoft, fg: c.danger },
  QUESTION: { bg: c.attentionSoft, fg: c.attention },
  REQUEST: { bg: c.agentSoft, fg: c.agent },
  WHAT_IS: { bg: c.signalSoft, fg: c.signal },
  ANSWER: { bg: c.liveSoft, fg: c.live },
};

function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

function dayLabel(t: number): string {
  const now = new Date();
  if (sameDay(t, now.getTime())) return 'Today';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(t, y.getTime())) return 'Yesterday';
  const d = new Date(t);
  return d.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function Avatar({ id, size = 32 }: { id: string; size?: number }) {
  const p = personOf(id);
  if (p.picture) {
    return (
      <img
        src={p.picture}
        alt=""
        className="shrink-0 rounded-md object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-md font-semibold text-white"
      style={{ width: size, height: size, background: tintFor(id), fontSize: size * 0.4 }}
      aria-hidden
    >
      {initials(p.name).slice(0, 1)}
    </span>
  );
}

function ActTag({ act }: { act: string }) {
  const tint = ACT_TINT[act] ?? { bg: c.ink, fg: c.graphite };
  return (
    <span
      className="rounded px-1.5 py-px font-semibold"
      style={{ fontSize: '9.5px', letterSpacing: '0.04em', background: tint.bg, color: tint.fg }}
    >
      {act}
    </span>
  );
}

export function MessageList({ messages, emptyText }: { messages: Msg[]; emptyText: string }) {
  const end = useRef<HTMLDivElement>(null);
  const atStart = useRef(true);

  useEffect(() => {
    atStart.current = true;
  }, [messages[0]?.messageId]);

  // Land on the newest message when a thread opens; afterwards only follow when
  // the reader is already near the bottom, so an arriving message never yanks
  // someone out of the history they are reading.
  useEffect(() => {
    const el = end.current;
    const scroller = el?.parentElement;
    if (!el || !scroller) return;
    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 220;
    if (atStart.current) {
      el.scrollIntoView();
      atStart.current = false;
    } else if (nearBottom) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <p className="py-16 text-center text-[13px]" style={{ color: c.graphite }}>
        {emptyText}
      </p>
    );
  }

  return (
    <>
      {messages.map((m, i) => {
        const prev = i > 0 ? messages[i - 1] : null;
        const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
        const system = m.msgType === 'SYSTEM';
        const grouped =
          !newDay &&
          !system &&
          prev !== null &&
          prev.msgType !== 'SYSTEM' &&
          prev.senderId === m.senderId &&
          m.createdAt - prev.createdAt < GROUP_WINDOW_MS;
        const person = personOf(m.senderId);

        return (
          <div key={m.messageId}>
            {newDay && (
              <div className="my-4 flex items-center gap-3">
                <span className="h-px flex-1" style={{ background: c.line }} />
                <span
                  className="rounded-full border px-2.5 py-0.5 text-[11px]"
                  style={{ borderColor: c.line, background: c.card, color: c.graphite }}
                >
                  {dayLabel(m.createdAt)}
                </span>
                <span className="h-px flex-1" style={{ background: c.line }} />
              </div>
            )}

            <div className={`group flex gap-2.5 ${grouped ? 'pt-0.5' : 'pt-3.5'}`}>
              <div className="w-8 shrink-0">
                {grouped ? (
                  <span
                    className="block pt-1 text-right opacity-0 group-hover:opacity-100"
                    style={{ fontFamily: mono, fontSize: '9px', color: c.mute }}
                  >
                    {clock(m.createdAt)}
                  </span>
                ) : (
                  <Avatar id={m.senderId} />
                )}
              </div>

              <div className="min-w-0 flex-1">
                {!grouped && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[13px] font-semibold">{person.name}</span>
                    <span style={{ fontSize: '11px', color: c.mute }}>{clock(m.createdAt)}</span>
                    {m.messageActs && <ActTag act={m.messageActs} />}
                    {person.isBot && (
                      <span
                        className="rounded px-1 py-px"
                        style={{ fontSize: '9px', background: c.signalSoft, color: c.signal }}
                      >
                        BOT
                      </span>
                    )}
                  </div>
                )}
                <div
                  className="text-[13.5px] leading-relaxed"
                  style={{ marginTop: grouped ? 0 : 3, color: system ? c.graphite : c.text }}
                >
                  <RichText html={m.content} />
                </div>
              </div>
            </div>
          </div>
        );
      })}
      <div ref={end} />
    </>
  );
}
