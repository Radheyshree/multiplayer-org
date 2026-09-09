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
import type { ReactNode } from 'react';
import { c, mono } from '../lib/theme';

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
