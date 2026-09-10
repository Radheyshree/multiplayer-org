import { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from 'react';
import { c, mono } from '../lib/theme';
import { initials, personOf, tintFor } from '../lib/people';

/* ---- from components/ErrorBoundary.tsx -------------------------------- */
/**
 * A crash barrier around the app pane.
 *
 * Org apps are the extension point — eventually model-authored — so a bad
 * render in one must not take the shell down with it. Without this, a single
 * undefined property in an app blanks the whole page, including the ticket
 * chat and the navigation needed to get somewhere else.
 *
 * Keyed on the app id by the caller, so switching apps clears a previous
 * crash rather than leaving the pane stuck on an error from a different app.
 */

interface Props {
  children: ReactNode;
  /** Shown in the message, so the reader knows which app failed. */
  label: string;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console -- the stack is the only way to debug a crashed app
    console.error(`[org-app] ${this.props.label} crashed`, error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="max-w-xl rounded-lg border border-destructive/30 bg-destructive/5 p-5">
        <h2 className="text-sm font-semibold mb-1">{this.props.label} stopped working</h2>
        <p className="text-[13px] text-muted-foreground mb-3">
          The rest of the workspace is fine — the ticket and its chat are still on the right.
        </p>
        <pre className="text-[11px] font-mono bg-background/60 border border-border rounded p-2.5 overflow-x-auto mb-3 max-h-32">
          {error.message || String(error)}
        </pre>
        <button
          onClick={this.reset}
          className="px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-[12px] font-medium hover:bg-accent transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }
}

/* ---- from components/MessageList.tsx ---------------------------------- */
/**
 * The message list, following the dashboard's reading rules: consecutive
 * messages from one sender inside five minutes lose their header, each calendar
 * day gets a separator, and the act tag (DISCUSSION / QUESTION / …) sits beside
 * the timestamp.
 */

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

/* ---- from components/RichText.tsx ------------------------------------- */
/**
 * Message bodies are HTML, not plain text — the composer stores things like
 * `<p class="m-0 leading-6"><span data-mention data-username="Radheshree">…`.
 * Rendering the raw string showed markup to the reader; rendering it with
 * dangerouslySetInnerHTML would hand every message author an XSS.
 *
 * So parse it and walk the tree, emitting React for the handful of nodes that
 * carry meaning — text, line breaks, mentions, links — and the text content of
 * anything else. Nothing from the document is ever executed or injected.
 */

const BLOCK = new Set(['P', 'DIV', 'BR', 'LI', 'H1', 'H2', 'H3', 'BLOCKQUOTE']);

function Mention({ label }: { label: string }) {
  return (
    <span
      className="rounded px-1 py-px font-medium"
      style={{ background: c.signalSoft, color: c.signal }}
    >
      {label.startsWith('@') ? label : `@${label}`}
    </span>
  );
}

function walk(node: Node, out: ReactNode[], key: { n: number }): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.textContent ?? '';
    if (t) out.push(t);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node as Element;
  const tag = el.tagName.toUpperCase();

  if (tag === 'BR') {
    out.push(<br key={`b${key.n++}`} />);
    return;
  }

  if (el.hasAttribute('data-mention') || el.classList.contains('chat-input-mention')) {
    const label = el.getAttribute('data-username') || el.textContent || 'someone';
    out.push(<Mention key={`m${key.n++}`} label={label} />);
    return;
  }

  if (tag === 'A') {
    const href = el.getAttribute('href') ?? '';
    const safe = /^https?:\/\//i.test(href); // never render javascript: or data:
    const text = el.textContent || href;
    out.push(
      safe ? (
        <a
          key={`a${key.n++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: c.signal, textDecoration: 'underline' }}
        >
          {text}
        </a>
      ) : (
        <span key={`a${key.n++}`}>{text}</span>
      ),
    );
    return;
  }

  if (tag === 'CODE' || tag === 'PRE') {
    out.push(
      <code
        key={`c${key.n++}`}
        className="rounded px-1 py-px"
        style={{ fontFamily: mono, fontSize: '11.5px', background: c.ink }}
      >
        {el.textContent}
      </code>,
    );
    return;
  }

  const before = out.length;
  el.childNodes.forEach(child => walk(child, out, key));
  // Block elements separate lines; a trailing break would add dead space.
  if (BLOCK.has(tag) && out.length > before && el.nextSibling) {
    out.push(<br key={`n${key.n++}`} />);
  }
}

/** True when the string carries markup worth parsing. */
function looksLikeHtml(s: string): boolean {
  return /<[a-z][\s\S]*>/i.test(s);
}

/**
 * Inline markdown: `**bold**`, `*em*`, `` `code` ``, `[text](url)`, bare URLs.
 *
 * Hand-rolled rather than a library, and the reason is the publish cap: the
 * smallest credible markdown renderer is larger than the 64 KB a single file
 * may be. This covers what messages in this workspace actually contain — it is
 * deliberately not a spec-complete implementation, and anything it does not
 * recognise passes through as the literal text the author typed, which is the
 * correct failure for a chat message.
 */
function inlineMd(text: string, out: ReactNode[], key: { n: number }): void {
  // One pass, alternation ordered so `**` is tried before `*`.
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(`+)([^`]+)\3|\*\*([^*]+)\*\*|\*([^*\n]+)\*|(https?:\/\/[^\s<>()]+)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [, linkText, linkHref, , code, bold, em, bareUrl] = m;
    if (linkHref) {
      out.push(<Link key={`l${key.n++}`} href={linkHref} text={linkText} />);
    } else if (code) {
      out.push(
        <code
          key={`c${key.n++}`}
          className="rounded px-1 py-px"
          style={{ fontFamily: mono, fontSize: '11.5px', background: c.ink }}
        >
          {code}
        </code>,
      );
    } else if (bold) {
      out.push(<strong key={`s${key.n++}`} className="font-semibold">{bold}</strong>);
    } else if (em) {
      out.push(<em key={`e${key.n++}`}>{em}</em>);
    } else if (bareUrl) {
      out.push(<Link key={`u${key.n++}`} href={bareUrl} text={bareUrl} />);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
}

function Link({ href, text }: { href: string; text: string }) {
  // Same rule as the HTML path: only http(s) is ever made clickable.
  if (!/^https?:\/\//i.test(href)) return <span>{text}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: c.signal, textDecoration: 'underline' }}>
      {text}
    </a>
  );
}

function renderMarkdown(src: string): ReactNode[] {
  const out: ReactNode[] = [];
  const key = { n: 0 };
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    // A pipe-table separator (`|---|---|`) carries no information for a reader
    // and looks like a bug. Agents emit tables constantly, so this is not an
    // edge case — drop the rule row and render the cells as a spaced line.
    if (/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('|')) return;
    const row = /^\s*\|(.+)\|\s*$/.exec(line);
    if (row) {
      const cells = row[1].split('|').map(x => x.trim());
      const inner: ReactNode[] = [];
      cells.forEach((cell, ci) => {
        if (ci) out.push(<span key={`sep${key.n++}`} style={{ color: c.mute }}>{' · '}</span>);
        inlineMd(cell, inner, key);
        out.push(...inner.splice(0));
      });
      if (i < lines.length - 1) out.push(<br key={`tbr${key.n++}`} />);
      return;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (heading) {
      const inner: ReactNode[] = [];
      inlineMd(heading[2], inner, key);
      out.push(
        <span key={`h${key.n++}`} className="block font-semibold" style={{ marginTop: i ? '0.5em' : 0 }}>
          {inner}
        </span>,
      );
      return;
    }
    if (bullet) {
      const inner: ReactNode[] = [];
      inlineMd(bullet[1], inner, key);
      out.push(
        <span key={`li${key.n++}`} className="block" style={{ paddingLeft: '1em', textIndent: '-1em' }}>
          {'• '}
          {inner}
        </span>,
      );
      return;
    }
    inlineMd(line, out, key);
    if (i < lines.length - 1) out.push(<br key={`br${key.n++}`} />);
  });
  return out;
}

/**
 * Render a message body.
 *
 * `format` matters: messages in this workspace are markdown roughly three times
 * as often as they are HTML (`metadata.contentFormat`), and running markdown
 * through the HTML path shows the reader `**PR Check Available**` verbatim.
 * Left unset it sniffs, which is right for callers that never had the metadata.
 */
export function RichText({ html, format }: { html: string; format?: 'markdown' | 'html' }) {
  if (!html) return null;

  const mode = format ?? (looksLikeHtml(html) ? 'html' : 'markdown');
  if (mode === 'markdown') return <>{renderMarkdown(html)}</>;
  if (!looksLikeHtml(html)) return <>{html}</>;

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const out: ReactNode[] = [];
    const key = { n: 0 };
    doc.body.childNodes.forEach(n => walk(n, out, key));
    return <>{out}</>;
  } catch {
    // Malformed markup: show the text, never the tags.
    return <>{html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}</>;
  }
}

/** One-line plain-text form, for previews in list rows. */
export function toPreview(html: string, max = 160): string {
  if (!html) return '';
  let text = html;
  if (looksLikeHtml(html)) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('[data-mention], .chat-input-mention').forEach(el => {
        el.textContent = `@${el.getAttribute('data-username') || el.textContent || ''}`;
      });
      text = doc.body.textContent ?? '';
    } catch {
      text = html.replace(/<[^>]+>/g, ' ');
    }
  }
  const clean = text
    // Markdown leaks into previews the same way it leaked into bodies.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
    .replace(/(\*\*|`)/g, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
