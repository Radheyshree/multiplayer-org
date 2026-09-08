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
        style={{ fontFamily: mono, fontSize: '11.5px', background: '#F2F1EC' }}
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

export function RichText({ html }: { html: string }) {
  if (!html) return null;
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
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
