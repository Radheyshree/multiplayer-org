/**
 * Saying something on the ticket — to a person or to an agent.
 *
 * One box, because there is one thread. In Spaces you reach an agent by naming
 * it in a line you were writing anyway (`@Ask AI summarise this`), and that
 * line is an ordinary message: it persists, everyone sees it, and the answer
 * lands underneath. Anything else — a separate "ask the AI" panel whose output
 * disappears on reload — is a different product with a chatbot bolted on.
 *
 * So the composer writes real mention spans (lib/mentions.ts), which is what
 * makes the message routable rather than merely readable, and the caller turns
 * a mentioned agent into a dispatch.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  activeToken,
  composeHtml,
  matchMentionables,
  type Mentionable,
} from '../../lib/mentions';
import { c, mono } from '../../lib/theme';

export function Composer({
  placeholder,
  candidates,
  disabled,
  onSubmit,
}: {
  placeholder: string;
  candidates: Mentionable[];
  disabled: boolean;
  /** Receives the HTML to post plus whoever was named in it. */
  onSubmit: (html: string, text: string, mentioned: Mentionable[]) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [chosen, setChosen] = useState<Mentionable[]>([]);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const token = activeToken(text, caret);
  const matches = useMemo(
    () => (token ? matchMentionables(candidates, token.query) : []),
    [token?.query, candidates],
  );
  const open = Boolean(token) && matches.length > 0;

  useEffect(() => setHighlight(0), [token?.query]);

  const accept = (m: Mentionable): void => {
    if (!token) return;
    const before = text.slice(0, token.start);
    const after = text.slice(caret);
    const next = `${before}@${m.name} ${after}`;
    setText(next);
    // Remember WHICH row this token resolved to. Resolving by name at send time
    // would be ambiguous the moment two people share a first name.
    setChosen(prev => (prev.some(p => p.userId === m.userId) ? prev : [...prev, m]));
    const pos = before.length + m.name.length + 2;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const submit = async (): Promise<void> => {
    const body = text.trim();
    if (!body || disabled) return;
    // Only the names still present in the text count — typing a mention and
    // deleting it must not silently notify anyone.
    const live = chosen.filter(m => body.includes(`@${m.name}`));
    setText('');
    setChosen([]);
    try {
      await onSubmit(composeHtml(body, live), body, live);
    } catch {
      setText(body); // never eat what someone typed
      setChosen(live);
    }
  };

  return (
    <div className="relative">
      {open ? (
        <ul
          className="absolute bottom-full z-20 mb-1 max-h-56 w-full overflow-y-auto rounded-md py-1 shadow-lg"
          style={{ background: c.card, border: `1px solid ${c.line}` }}
        >
          {matches.map((m, i) => (
            <li key={m.userId}>
              <button
                onMouseDown={e => {
                  e.preventDefault(); // keep the caret in the input
                  accept(m);
                }}
                onMouseEnter={() => setHighlight(i)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
                style={{ background: i === highlight ? c.signalSoft : 'transparent' }}
              >
                <span
                  className="grid size-5 shrink-0 place-items-center rounded text-[10px]"
                  style={
                    m.kind === 'agent'
                      ? { background: c.agentSoft, color: c.agent }
                      : { background: c.ink, color: c.graphite }
                  }
                  aria-hidden
                >
                  {m.kind === 'agent' ? '✦' : m.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px]" style={{ color: c.text }}>
                    {m.name}
                  </span>
                  {m.subtitle ? (
                    <span className="block truncate text-[10.5px]" style={{ color: c.mute }}>
                      {m.subtitle}
                    </span>
                  ) : null}
                </span>
                {m.kind === 'agent' ? (
                  <span
                    className="shrink-0 rounded px-1 leading-none"
                    style={{ fontFamily: mono, fontSize: '9px', color: c.agent, background: c.agentSoft }}
                  >
                    agent
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={text}
          onChange={e => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyUp={e => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
          onClick={e => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
          onKeyDown={e => {
            if (open) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlight(h => (h + 1) % matches.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlight(h => (h - 1 + matches.length) % matches.length);
                return;
              }
              // Tab and Enter both accept — Enter because that is what everyone
              // presses, Tab because that is what the menu looks like.
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                const m = matches[highlight];
                if (m) accept(m);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setCaret(0); // closes the menu without touching the text
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="h-8 min-w-0 flex-1 rounded-md px-2.5 text-[12.5px] outline-none"
          style={{ background: c.card, border: `1px solid ${c.line}`, color: c.text }}
        />
        <button
          onClick={() => void submit()}
          disabled={disabled || !text.trim()}
          className="h-8 shrink-0 rounded-md px-3 text-[12px] font-medium disabled:opacity-40"
          style={{ background: c.signal, color: c.signalText }}
        >
          Send
        </button>
      </div>

      <p className="mt-1 text-[10.5px]" style={{ color: c.mute }}>
        {chosen.length
          ? `${chosen.filter(m => m.kind === 'agent').length ? 'The agent will answer in this thread. ' : ''}Mentioning ${chosen.map(m => m.name).join(', ')}.`
          : 'Type @ to mention a person or an agent.'}
      </p>
    </div>
  );
}
