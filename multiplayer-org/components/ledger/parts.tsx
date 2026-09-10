import { BrandMark } from './badges';
import { activeToken, composeHtml, initials, matchMentionables, personOf, tintFor, type Mentionable } from '../../lib/people';
import { c, eyebrow, mono } from '../../lib/theme';
import { describeArgs, formatDuration, humanizeTool, isFailure, isTerminal, type AgentRun, type ToolInvocation } from '../../lib/agentrun';
import { isNoReply, type Candidate, type DeskRef } from '../../lib/mailbridge';
import { type Nudge, type Suggestion } from '../../lib/nudge';
import { useEffect, useMemo, useRef, useState } from 'react';

/* ---- from components/ledger/AgentActivity.tsx ------------------------- */
/**
 * What the agent actually did.
 *
 * The reference product shows an agent turn as a short answer above a row of
 * chips — "Read PR #482", "Pushed a commit", "Posted in #pricing-launch". That
 * is the difference between trusting an agent and taking its word for it, and
 * it is the reason this file exists at all.
 *
 * Xyne's own dashboard renders the same information as a COLLAPSIBLE STEP LIST
 * rather than chips: one line per tool, with a status glyph, the humanised tool
 * name, a preview of its argument and the time it took, under a one-line header
 * that collapses the whole thing. That shape is copied here rather than the
 * reference's, for two reasons — an agent in this workspace routinely makes a
 * dozen calls and twelve chips wrap into a wall, and matching Xyne means the
 * same tool reads the same way in both products.
 *
 * The palette is deliberately monochrome. The only colours are a check for
 * success and a mark for failure; a run where every step is tinted is a run
 * nobody reads.
 */

function StepIcon({ step }: { step: ToolInvocation }) {
  const running = step.status === 'running' || (!step.status && step.durationMs === undefined);
  if (step.isError) {
    return (
      <span aria-hidden style={{ color: c.danger, fontSize: '11px' }} title="This step failed">
        ✕
      </span>
    );
  }
  if (running) {
    return (
      <span
        aria-hidden
        className="animate-pulse"
        style={{ color: c.mute, fontSize: '11px' }}
        title="Running"
      >
        ◌
      </span>
    );
  }
  return (
    <span aria-hidden style={{ color: c.live, fontSize: '11px' }} title="Done">
      ✓
    </span>
  );
}

function Step({ step }: { step: ToolInvocation }) {
  const [open, setOpen] = useState(false);
  const preview = describeArgs(step.args);
  const detail = step.result?.trim();

  return (
    <li>
      <button
        onClick={() => detail && setOpen(v => !v)}
        className="flex w-full items-center gap-2 py-1 text-left"
        style={{ cursor: detail ? 'pointer' : 'default' }}
      >
        <span
          aria-hidden
          className="shrink-0 transition-transform"
          style={{
            color: c.mute,
            fontSize: '9px',
            width: '10px',
            transform: open ? 'rotate(90deg)' : 'none',
            opacity: detail ? 1 : 0,
          }}
        >
          ▶
        </span>
        <StepIcon step={step} />
        <span className="shrink-0 text-[11.5px]" style={{ color: c.text }}>
          {humanizeTool(step.toolName)}
        </span>
        {step.subagentName ? (
          <span
            className="shrink-0 rounded px-1 leading-none"
            style={{ fontFamily: mono, fontSize: '9px', color: c.mute, border: `1px solid ${c.line}` }}
          >
            {step.subagentName}
          </span>
        ) : null}
        {preview ? (
          <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: c.mute }}>
            {preview}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <span
          className="shrink-0 tabular-nums"
          style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}
        >
          {formatDuration(step.durationMs)}
        </span>
      </button>

      {open && detail ? (
        <pre
          className="mb-1 ml-6 max-h-40 overflow-auto rounded p-2 text-[10.5px] leading-relaxed"
          style={{ fontFamily: mono, background: c.ink, color: c.graphite, whiteSpace: 'pre-wrap' }}
        >
          {detail.length > 2000 ? `${detail.slice(0, 2000)}\n…` : detail}
        </pre>
      ) : null}
    </li>
  );
}

/**
 * One agent run's activity.
 *
 * Collapsed by default once finished — the answer is the point and the working
 * is the evidence — but open while it is still running, because a run in flight
 * with nothing on screen is indistinguishable from a hung one.
 */
export function AgentActivity({ run }: { run: AgentRun }) {
  const steps = run.toolInvocations ?? [];
  const done = isTerminal(run.status);
  const [open, setOpen] = useState(!done);

  // Nothing to show yet, and nothing to say beyond "it started".
  if (!steps.length && !run.currentToolLabel && !run.reasoning) {
    return done ? null : (
      <p className="flex items-center gap-1.5 text-[11.5px]" style={{ color: c.mute }}>
        <span className="animate-pulse" aria-hidden>
          ◌
        </span>
        Thinking…
      </p>
    );
  }

  const label = done
    ? [
        steps.length ? `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}` : null,
        formatDuration(run.totalMs),
      ]
        .filter(Boolean)
        .join(' · ')
    : run.currentToolLabel || 'Working…';

  return (
    <div className="rounded-md" style={{ border: `1px solid ${c.line}`, background: c.card }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        {done ? (
          <span
            aria-hidden
            className="shrink-0 transition-transform"
            style={{ color: c.mute, fontSize: '9px', transform: open ? 'rotate(90deg)' : 'none' }}
          >
            ▶
          </span>
        ) : (
          <span aria-hidden className="shrink-0 animate-pulse" style={{ color: c.signal, fontSize: '10px' }}>
            ◌
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: done ? c.graphite : c.text }}>
          {label}
        </span>
        {isFailure(run.status) ? (
          <span className="shrink-0 text-[10px]" style={{ color: c.danger }}>
            failed
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="px-2.5 pb-1.5">
          {run.reasoning ? (
            <p
              className="mb-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed"
              style={{ color: c.mute }}
            >
              {run.reasoning}
            </p>
          ) : null}
          {steps.length ? (
            <ul>
              {steps.map((s, i) => (
                <Step key={s.toolCallId ?? `${s.toolName}-${i}`} step={s} />
              ))}
            </ul>
          ) : null}
          {run.error ? (
            <p className="py-1 text-[11px]" style={{ color: c.danger }}>
              {run.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---- from components/ledger/Composer.tsx ------------------------------ */
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

      {/* The composer, as in the reference: one tall rounded field with a
          circular send button sitting inside it, rather than a small input with
          a rectangular button beside it. It is the only always-visible control
          in the pane, so it is the one that should look like an invitation. */}
      <div
        className="flex items-center gap-2 rounded-full py-1 pr-1 pl-4"
        style={{ background: c.card, border: `1px solid ${c.line}` }}
      >
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
          className="h-9 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none"
          style={{ color: c.text }}
        />
        <button
          onClick={() => void submit()}
          disabled={disabled || !text.trim()}
          aria-label="Send"
          title="Send"
          className="grid size-8 shrink-0 place-items-center rounded-full transition-opacity disabled:opacity-30"
          style={{ background: c.signal, color: c.signalText }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
            <path
              d="M12 19V5M12 5l-6 6M12 5l6 6"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
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

/* ---- from components/ledger/MailBridge.tsx ---------------------------- */
/**
 * The mail thread this ticket's pull request is being discussed on.
 *
 * Three states, and the difference between them is the whole design:
 *
 *   OFFERED   A code-host notification naming this ticket exists on a desk, and
 *             nothing links them yet. One button. Linking writes to two tickets
 *             and adds a reference edge, which is not something to do to someone
 *             because they glanced at a ticket.
 *
 *   LINKED    From then on it is automatic. Every mail on that thread — new
 *             comments, approvals, replies you send from anywhere — appears in
 *             this conversation without being asked for.
 *
 *   REPLYING  Answering the mail from here. `POST /api/email/:id/reply` is the
 *             same endpoint the Desk UI uses, so the reply is a real email to
 *             the real recipients, and the sync copies it straight back.
 */

export function MailBridge({
  linked,
  offered,
  syncing,
  note,
  onLink,
  onSync,
  onReply,
  previewRecipients,
  alias,
}: {
  /** Desk threads this ticket already mirrors. */
  linked: DeskRef[];
  /** Notifications that name this ticket and are not linked yet. */
  offered: Candidate[];
  busyLabel?: string;
  syncing: boolean;
  /** Last thing that happened, e.g. "2 mails copied". */
  note?: string | null;
  onLink: (candidate: Candidate) => Promise<void>;
  onSync: () => Promise<void>;
  onReply: (body: string) => Promise<void>;
  /** Who a reply would go to. Resolved lazily, only when the box opens. */
  previewRecipients?: () => Promise<string[]>;
  /**
   * The address anyone can email so their mail lands on this track.
   *
   * This is the answer to "what if someone ELSE emails about this ticket" —
   * everything else here can only see mail that reached a mailbox this
   * workspace already ingests. Null when the channel has no mail source.
   */
  alias?: string | null;
}) {
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [recipients, setRecipients] = useState<string[] | null>(null);

  // Show who this is going to BEFORE it goes. A reply-all on a thread you did
  // not start is the kind of thing people get wrong once and remember forever.
  useEffect(() => {
    if (!replying || !previewRecipients) return;
    let live = true;
    void previewRecipients().then(to => {
      if (live) setRecipients(to);
    });
    return () => {
      live = false;
    };
  }, [replying, previewRecipients]);

  if (linked.length === 0 && offered.length === 0 && !alias) return null;

  const send = async (): Promise<void> => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      await onReply(body);
      setDraft('');
      setReplying(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="shrink-0 px-3 py-1.5"
      style={{ borderBottom: `1px solid ${c.line}`, background: c.inkSoft }}
    >
      {offered.map(cand => (
        <div key={cand.desk.id} className="flex items-center gap-2 py-0.5">
          <span style={{ ...eyebrow, fontSize: '9px', color: c.attention }}>
            {cand.notification.kind === 'mention' ? 'mail names this' : 'mail found'}
          </span>
          <span className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: c.text }}>
            {/* A robot notification leads with its system and PR — that is the
                interesting part. A person's mail leads with its subject, because
                "who wrote what" is what decides whether you want it linked. */}
            {cand.notification.kind === 'mention'
              ? (cand.desk.title ?? 'Email')
              : `${cand.notification.system?.name ?? 'Email'}${
                  cand.notification.prNumber ? ` PR #${cand.notification.prNumber}` : ''
                }`}
            {cand.desk.xyneId ? ` · ${cand.desk.xyneId}` : ''}
            {cand.notification.repo ? ` · ${cand.notification.repo}` : ''}
          </span>
          <button
            onClick={() => void onLink(cand)}
            disabled={syncing}
            className="shrink-0 rounded px-2 py-0.5 text-[11px] disabled:opacity-50"
            style={{ background: c.signal, color: c.signalText }}
          >
            Link &amp; sync
          </button>
        </div>
      ))}

      {linked.length > 0 ? (
        <div className="flex items-center gap-2 py-0.5">
          <span style={{ ...eyebrow, fontSize: '9px', color: c.graphite }}>mail thread</span>
          {/* Short enough not to truncate. The long version ("4 threads linked
              — new mail appears here on its own.") clipped to "new mail …" in
              this pane, which reads as a broken sentence rather than as
              reassurance. */}
          <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: c.mute }}>
            {note ??
              (linked.length === 1
                ? '1 thread · new mail arrives on its own'
                : `${linked.length} threads · new mail arrives on its own`)}
          </span>
          <button
            onClick={() => void onSync()}
            disabled={syncing}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] disabled:opacity-50"
            style={{ color: c.signal }}
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button
            onClick={() => setReplying(v => !v)}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px]"
            style={{ color: replying ? c.text : c.signal }}
          >
            {replying ? 'Cancel' : 'Reply by email'}
          </button>
        </div>
      ) : null}

      {alias ? (
        <div className="flex items-center gap-2 py-0.5">
          <span style={{ ...eyebrow, fontSize: '9px', color: c.graphite }}>anyone can email</span>
          <code
            className="min-w-0 flex-1 truncate"
            style={{ fontFamily: mono, fontSize: '10.5px', color: c.text }}
            title={`${alias} — mail sent here lands on this track, whoever sends it. Put the ticket key in the subject and it lands on the ticket.`}
          >
            {alias}
          </code>
          <button
            onClick={() => void navigator.clipboard?.writeText(alias).catch(() => {})}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px]"
            style={{ color: c.signal }}
          >
            Copy
          </button>
        </div>
      ) : null}

      {replying ? (
        <div className="flex items-start gap-2 pt-1">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Reply to everyone on the mail thread…"
            className="min-w-0 flex-1 rounded-md px-2 py-1 text-[12px] outline-none"
            style={{ background: c.card, border: `1px solid ${c.line}`, color: c.text }}
          />
          <button
            onClick={() => void send()}
            disabled={sending || !draft.trim()}
            className="shrink-0 rounded-md px-2.5 py-1 text-[12px] disabled:opacity-40"
            style={{ background: c.signal, color: c.signalText }}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      ) : null}

      {replying ? (
        <p className="pt-1 text-[10px]" style={{ fontFamily: mono, color: c.mute }}>
          {recipients === null
            ? 'Working out who this goes to…'
            : recipients.length === 0
              ? 'Nobody to reply to on this thread.'
              : `To ${recipients.join(', ')}`}
          {recipients?.length && recipients.every(isNoReply) ? (
            <span style={{ color: c.attention }}>
              {' '}— that address does not accept replies, so this reaches nobody.
              It is still recorded on the ticket.
            </span>
          ) : null}{' '}
          ⌘↵ to send.
        </p>
      ) : null}
    </div>
  );
}

/* ---- from components/ledger/UpdateAgent.tsx --------------------------- */
/**
 * The update agent's turn in the thread.
 *
 * It renders as an agent turn and not as a banner, because that is what it is:
 * the Claw mark, a name, the ask in a bubble, the evidence under it, and buttons.
 * A ticket's thread already holds everything that happened to this ticket from
 * every surface; this is the one participant that reads all of it and says
 * something about it without being asked.
 *
 * TWO ADDRESSEES, TWO DIFFERENT THINGS TO SHOW.
 *
 *   IT IS YOU      — you are reading the ticket it is about, so there is nothing
 *                    to deliver. It asks, and the buttons do the thing.
 *   IT IS SOMEBODY  — you cannot answer for them, so the only useful button is
 *   ELSE             the one that asks them, by name, in the thread, with a real
 *                    mention so the platform notifies them like any other.
 *
 * WHY THE BUTTONS SAY WHAT THEY SAY. "Move to LIVE" and "Move to Sandbox" are not
 * two spellings of one action — they are the next stage on two different boards,
 * read off each ticket's own board. There is life after Merged on both boards in
 * this workspace, so a fixed "Mark as done" would be wrong more often than right.
 * See lib/nudge.ts.
 *
 * NOTHING HERE IS AUTOMATIC. The card appears; nothing changes until somebody
 * presses something. An agent that closed your tickets for you would be a
 * different and much worse product.
 */

/** Rules, in the words that go on the eyebrow. */
const HEADLINE: Record<Nudge['rule'], string> = {
  unanswered: 'waiting on an answer',
  shipped: 'this one shipped',
  'pr-merged': 'the code landed',
  'pr-open': 'still in review',
  'pr-declined': 'the code did not land',
  'eta-passed': 'the date passed',
  'gone-quiet': 'gone quiet',
  unowned: 'nobody owns it',
};

export function UpdateAgent({
  nudge,
  meId,
  /** Running an action — one at a time, and the card says which. */
  busy,
  onAccept,
  onAsk,
  onInvestigate,
  onSnooze,
  onDismiss,
  note,
}: {
  nudge: Nudge | null;
  meId?: string;
  busy: string | null;
  /** Take the suggestion. The caller writes the change AND records it. */
  onAccept: (s: Suggestion) => Promise<void>;
  /** Ask the owner for an update, in the thread, by name. */
  onAsk: () => Promise<void>;
  /** Hand the finding to the agent and let it look into it. */
  onInvestigate: () => Promise<void>;
  onSnooze: () => Promise<void>;
  onDismiss: () => Promise<void>;
  note?: string | null;
}) {
  const [open, setOpen] = useState(true);
  if (!nudge) return null;

  const owner = nudge.ownerId ? personOf(nudge.ownerId) : null;
  const mine = Boolean(nudge.ownerId && nudge.ownerId === meId);
  const who = mine ? 'you' : (owner?.name ?? 'nobody in particular');

  if (!open) {
    return (
      <div className="px-4 py-1">
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-[11px]"
          style={{ color: c.mute }}
        >
          <BrandMark system="claw" size={12} />
          {nudge.xyneId} needs an update — show
        </button>
      </div>
    );
  }

  return (
    <article className="flex gap-2 px-4 py-1.5">
      <div className="w-8 shrink-0">
        {/* The Claw mark draws its own disc in the agent tint, so the gutter
            box stays transparent — stacking one on the other made a pale square
            with an almost invisible mark inside it. */}
        <span className="grid size-8 place-items-center" aria-label="Update agent">
          <BrandMark system="claw" size={28} />
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[13.5px] font-semibold" style={{ color: c.agent }}>
            Update agent
          </span>
          <span style={{ ...eyebrow, fontSize: '9px', color: c.attention }}>
            {HEADLINE[nudge.rule]}
          </span>
          {/* Who it is for, with their face — the reference puts a person on
              every row and this row is about a person more than most. */}
          {owner ? (
            <span className="flex items-center gap-1">
              <span
                className="grid size-4 place-items-center rounded-[3px] text-[7px] font-medium text-white"
                style={{ background: tintFor(owner.id) }}
                aria-hidden
              >
                {initials(owner.name)}
              </span>
              <span className="text-[11.5px]" style={{ color: c.mute }}>
                for {mine ? 'you' : owner.name}
              </span>
            </span>
          ) : (
            <span className="text-[11.5px]" style={{ color: c.mute }}>
              nobody assigned
            </span>
          )}
          <button
            onClick={() => setOpen(false)}
            className="ml-auto text-[11px]"
            style={{ color: c.mute }}
            aria-label="Collapse"
          >
            hide
          </button>
        </div>

        <div
          className="mt-1 inline-block max-w-[46rem] break-words rounded-2xl px-3.5 py-2 leading-relaxed"
          style={{
            fontSize: '13.5px',
            color: c.text,
            background: c.bubbleAgent,
            borderTopLeftRadius: '0.35rem',
          }}
        >
          {mine || !owner ? nudge.ask : `${firstName(owner.name)} — ${lowerFirst(nudge.ask)}`}
        </div>

        {/* The evidence, always, and never in the bubble. The ask is the agent
            speaking; this is the row of the ticket it read to say it, and a
            reader must be able to check one against the other. */}
        <p className="mt-1 text-[11px] leading-relaxed" style={{ color: c.mute }}>
          {nudge.because}
          <span style={{ fontFamily: mono, fontSize: '10px' }}>
            {' '}· {ownerNote(nudge.ownerReason, who)}
          </span>
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {/* Somebody else's ticket: the only honest primary action is to ask
              them. Changing the status of work you are not doing, because a
              robot suggested it, is how people learn to distrust the robot. */}
          {!mine && owner ? (
            <button
              onClick={() => void onAsk()}
              disabled={Boolean(busy)}
              className="rounded-md px-2.5 py-1 text-[11.5px] font-medium disabled:opacity-40"
              style={{ background: c.signal, color: c.signalText }}
            >
              {busy === 'ask' ? 'Asking…' : `Ask ${firstName(owner.name)} for an update`}
            </button>
          ) : (
            nudge.suggestions.map((s, i) => (
              <button
                key={`${s.kind}-${s.label}`}
                onClick={() => void onAccept(s)}
                disabled={Boolean(busy)}
                className="rounded-md px-2.5 py-1 text-[11.5px] disabled:opacity-40"
                style={
                  i === 0
                    ? { background: c.signal, color: c.signalText, fontWeight: 500 }
                    : { border: `1px solid ${c.line}`, color: c.text }
                }
              >
                {busy === s.label ? 'Working…' : s.label}
              </button>
            ))
          )}

          <button
            onClick={() => void onInvestigate()}
            disabled={Boolean(busy)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] disabled:opacity-40"
            style={{ background: c.agentSoft, color: c.agent }}
            title="Let the agent read the whole ticket and say whether this is really finished"
          >
            <span aria-hidden>✦</span>
            {busy === 'investigate' ? 'Reading…' : 'Check it'}
          </button>

          <span className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => void onSnooze()}
              disabled={Boolean(busy)}
              className="rounded px-1.5 py-0.5 text-[11px] disabled:opacity-40"
              style={{ color: c.mute }}
              title="Ask me again in three days"
            >
              Later
            </button>
            <button
              onClick={() => void onDismiss()}
              disabled={Boolean(busy)}
              className="rounded px-1.5 py-0.5 text-[11px] disabled:opacity-40"
              style={{ color: c.mute }}
              title="Stop asking about this. Everyone on the ticket stops being asked too."
            >
              Never mind
            </button>
          </span>
        </div>

        {note ? (
          <p className="mt-1 text-[11px]" style={{ color: c.live }}>
            {note}
          </p>
        ) : null}
      </div>
    </article>
  );
}

/**
 * Lower-case the first letter when joining "Om — " to a sentence.
 *
 * Not when the sentence opens on an acronym: the first version of this turned
 * "PR #9420 merged two months ago" into "pR #9420", which is the kind of detail
 * that makes a careful surface look careless.
 */
const lowerFirst = (s: string): string => {
  if (!s) return s;
  if (s[1] && s[1] === s[1].toUpperCase() && /[A-Z]/.test(s[1])) return s;
  return s[0].toLowerCase() + s.slice(1);
};
const firstName = (s: string): string => s.split(/\s+/)[0] ?? s;

/** Why this person. Small, monospaced, and always there — "why me?" is first. */
function ownerNote(reason: Nudge['ownerReason'], who: string): string {
  switch (reason) {
    case 'assignee':
      return `assigned to ${who}`;
    case 'merged-it':
      return `${who} settled the pull request`;
    case 'creator':
      return `${who} opened it`;
    case 'last-speaker':
      return `${who} spoke last`;
    default:
      return 'no assignee, no author on record';
  }
}
