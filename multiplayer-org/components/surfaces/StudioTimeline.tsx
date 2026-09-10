/**
 * The conversation, and the composer that continues it.
 *
 * THE HONEST-PROGRESS PROBLEM shapes everything here. A Claw run's answer text
 * does NOT stream — `result` is empty for the whole run and lands whole at the
 * end (measured: 0 bytes at 51s, 4,872 at 66s). Every AI builder fills that gap
 * with a typing animation. We can't, and shouldn't. What each poll DOES give us
 * is real: the tool running right now, how many have run, the agent's own
 * reasoning tail, and how long it has been going. Those move, so those are what
 * a running turn shows.
 *
 * THE SECOND PROBLEM is that all of it used to be live-only. Tool calls arrived
 * on the progress stream and vanished the moment the page reloaded, so a turn
 * you watched work and a turn you came back to looked nothing alike. Now the
 * turn record carries its own actions, duration and changed files
 * (lib/studioStore.ts), and this renders from THAT — so a finished turn reads
 * identically whether you saw it happen or opened the project a day later.
 *
 * FOLLOWUPS are read off the project, not off a list. A fixed set of
 * suggestions is wallpaper by the second project; these look at what the app's
 * files actually lack — no SDK import, no dark mode, one oversized file — and
 * suggest the thing that is true of THIS app. The shuffle control deals a
 * different hand from the same reasoning.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { c, eyebrow, mono } from '../../lib/theme';
import type { RunProgress } from '../../lib/studioProtocol';
import type { StudioFile } from '../../lib/studioProtocol';
import type { Turn, TurnAction } from '../../lib/studioRuntime';
import { Ring, riseIn } from './StudioCode';

/** Always-true suggestions, dealt in when the file-derived ones run out. */
const EVERGREEN = [
  'Make it look more polished — better spacing, hierarchy and empty states',
  'Add keyboard shortcuts for the main actions',
  'Add smooth transitions when things appear and change',
  'Persist the state in localStorage so a reload keeps my data',
  'Show loading skeletons instead of blank space while data loads',
  'Make the layout work at phone width',
];

/**
 * Read the project and say what it is missing. Every rule checks the actual
 * source, so a suggestion is only offered while it is still true — the moment
 * the agent adds a dark mode, the dark-mode chip stops appearing.
 */
function suggestFollowups(files: StudioFile[], deal: number): string[] {
  const source = files.map(f => f.content).join('\n');
  const derived: string[] = [];

  if (files.length > 0) {
    if (!/from\s+['"]xyne['"]|spaces\./.test(source))
      derived.push('Load real data from the workspace with the xyne SDK instead of the seeded values');
    if (!/dark/i.test(source)) derived.push('Add a dark mode toggle');
    const biggest = files.reduce((a, b) => (b.content.length > a.content.length ? b : a), files[0]);
    if (biggest.content.split('\n').length > 150)
      derived.push(`Split ${biggest.path} into smaller components`);
    if (!/<input|<select|<textarea/i.test(source))
      derived.push('Add a search box that filters what is shown');
    if (!/aria-|<label/i.test(source))
      derived.push('Add labels and aria attributes so it works with a screen reader');
  }

  // Rotate the evergreen pool by the deal so the shuffle control always has
  // somewhere new to go, then top the hand up to three.
  const pool = [...EVERGREEN.slice(deal % EVERGREEN.length), ...EVERGREEN.slice(0, deal % EVERGREEN.length)];
  const start = deal % Math.max(derived.length, 1);
  const hand = [...derived.slice(start), ...derived.slice(0, start)];
  for (const idea of pool) {
    if (hand.length >= 3) break;
    if (!hand.includes(idea)) hand.push(idea);
  }
  return hand.slice(0, 3);
}

export function StudioTimeline({
  turns,
  files,
  running,
  agentName,
  draft,
  onDraft,
  onSend,
  onStop,
  canRestore,
  onRestore,
  onViewChanges,
}: {
  turns: Turn[];
  /** The current head's files — read (never written) to suggest followups. */
  files: StudioFile[];
  running: RunProgress | null;
  agentName: string;
  draft: string;
  onDraft: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  /** False while a turn is in flight — restoring then would race its write. */
  canRestore: boolean;
  onRestore: (version: number) => void;
  onViewChanges: (version: number) => void;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [deal, setDeal] = useState(0);
  const followups = useMemo(() => suggestFollowups(files, deal), [files, deal]);

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns.length, running?.status, running?.label, running?.invocations.length]);

  const busy = Boolean(running);

  return (
    <div className="sfx-anim flex h-full min-h-0 flex-col" style={{ background: c.paper }}>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {turns.length === 0 && !busy ? (
          <p className="px-1 text-[13px] leading-relaxed" style={{ color: c.graphite }}>
            Say what you want built. {agentName} writes the files, they run in the preview, and
            everything after that is a followup.
          </p>
        ) : null}

        <ul className="space-y-4">
          {turns.map(turn => (
            <li key={turn.id} style={{ animation: 'sfx-up 0.3s cubic-bezier(0.2, 0.7, 0.2, 1) both' }}>
              <TurnCard
                turn={turn}
                agentName={agentName}
                running={turn.status === 'running' ? running : null}
                canRestore={canRestore}
                onRestore={onRestore}
                onViewChanges={onViewChanges}
              />
            </li>
          ))}
        </ul>

        {turns.length > 0 && !busy ? (
          <div className="mt-4">
            <div className="flex items-center gap-1.5 px-0.5">
              <span style={{ ...eyebrow, color: c.mute }}>Try next</span>
              <button
                onClick={() => setDeal(d => d + 1)}
                className="rounded px-1 text-[12px] leading-none transition-transform active:rotate-180"
                style={{ color: c.mute }}
                title="Deal different suggestions"
                aria-label="Shuffle the suggestions"
              >
                ⟳
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {followups.map((text, i) => (
                <button
                  key={text}
                  onClick={() => onDraft(text)}
                  className="rounded-full px-2.5 py-1 text-left text-[11px] transition-all duration-150"
                  style={{ ...riseIn(i), border: `1px solid ${c.line}`, color: c.graphite, background: c.card }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = c.signal; e.currentTarget.style.color = c.signal; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = c.line; e.currentTarget.style.color = c.graphite; }}
                  title={text}
                >
                  {text.length > 44 ? `${text.slice(0, 43)}…` : text}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <Composer
        draft={draft}
        busy={busy}
        onDraft={onDraft}
        onSend={onSend}
        onStop={onStop}
        placeholder={turns.length === 0 ? 'Build me a…' : 'What should change?'}
      />
    </div>
  );
}

function TurnCard({
  turn,
  agentName,
  running,
  canRestore,
  onRestore,
  onViewChanges,
}: {
  turn: Turn;
  agentName: string;
  running: RunProgress | null;
  canRestore: boolean;
  onRestore: (version: number) => void;
  onViewChanges: (version: number) => void;
}) {
  const live = turn.status === 'running';
  const failed = turn.status === 'failed';

  // Live actions come off the poll; a settled turn reads its own record. Same
  // component either way, so the card does not reshuffle when a run lands.
  const actions: TurnAction[] = live
    ? collapse((running?.invocations ?? []).map(i => String(i.toolName ?? 'tool')))
    : (turn.actions ?? []);

  const seconds = live ? (running?.elapsedS ?? 0) : Math.round((turn.durationMs ?? 0) / 1000);

  return (
    <div>
      <div className="rounded-lg px-3 py-2" style={{ background: c.signalSoft }}>
        <p className="whitespace-pre-wrap text-[12.5px] leading-snug" style={{ color: c.text }}>
          {turn.prompt}
        </p>
      </div>

      <div className="mt-2 flex items-center gap-2 px-0.5">
        <span className="text-[11px]" style={{ fontFamily: mono, color: c.graphite }}>
          {agentName}
        </span>
        <span style={{ color: c.mute }}>·</span>
        <span className="text-[11px] tabular-nums" style={{ fontFamily: mono, color: c.mute }}>
          {live ? `${seconds}s` : seconds > 0 ? `Ran for ${seconds}s` : 'Done'}
        </span>
        {live ? (
          <span className="ml-auto">
            <Ring />
          </span>
        ) : null}
      </div>

      <ActionHistory
        live={live}
        label={running?.label ?? null}
        reasoning={live ? (running?.reasoning ?? '') : ''}
        actions={actions}
        wrote={turn.wrote ?? []}
        removed={turn.removed ?? []}
      />

      {live ? (
        seconds > 45 ? (
          <p className="mt-1.5 px-0.5 text-[11px]" style={{ color: c.mute }}>
            Longer runs are normal — the agent writes the whole project before it replies.
          </p>
        ) : null
      ) : (
        <>
          <p
            className="mt-2 px-0.5 text-[12.5px] leading-snug"
            style={{ color: failed ? c.attention : c.text }}
          >
            {turn.error ?? turn.summary}
          </p>

          {turn.note ? (
            <p
              className="mt-1.5 rounded-md px-2.5 py-2 text-[12px] leading-snug"
              style={{ background: c.card, border: `1px solid ${c.line}`, color: c.graphite }}
            >
              {turn.note.length > 500 ? `${turn.note.slice(0, 500)}…` : turn.note}
            </p>
          ) : null}

          {turn.version ? (
            <Checkpoint
              version={turn.version}
              canRestore={canRestore}
              onRestore={onRestore}
              onViewChanges={onViewChanges}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * What the agent did, as opposed to what it says it did.
 *
 * Open by default: the file list answers "what changed", which is the question
 * a finished turn is usually being asked. Collapsible for when a project has
 * grown a long history. Always open while running, because then it is the only
 * thing on screen that moves.
 */
function ActionHistory({
  live,
  label,
  reasoning,
  actions,
  wrote,
  removed,
}: {
  live: boolean;
  label: string | null;
  /** The agent's own thinking tail, straight off the poll. Live only. */
  reasoning: string;
  actions: TurnAction[];
  wrote: string[];
  removed: string[];
}) {
  // Open by default. The file list is the answer to "what changed", which is
  // the question a finished turn is usually being asked; collapsing it by
  // default would hide the most useful line in the card to save four pixels.
  const [open, setOpen] = useState(true);
  const touched = wrote.length + removed.length;
  const hasBody = actions.length > 0 || touched > 0;
  if (!hasBody && !live) return null;

  const expanded = live || open;
  const headline = live
    ? (label ?? 'Working')
    : touched > 0
      ? `${touched} file${touched === 1 ? '' : 's'} changed`
      : `${actions.length} action${actions.length === 1 ? '' : 's'}`;

  return (
    <div className="mt-2 overflow-hidden rounded-md" style={{ border: `1px solid ${c.line}`, background: c.card }}>
      <button
        onClick={() => !live && setOpen(v => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
        style={{ cursor: live ? 'default' : 'pointer' }}
        aria-expanded={expanded}
      >
        <span style={{ ...eyebrow, color: live ? c.signal : c.mute }}>Actions</span>
        <span className={`truncate text-[12px]${live ? ' sfx-dots' : ''}`} style={{ color: c.text }}>
          {headline}
        </span>
        {!live ? (
          <span className="ml-auto text-[10px]" style={{ fontFamily: mono, color: c.mute }}>
            {expanded ? '−' : '+'}
          </span>
        ) : null}
      </button>

      {/* The only honest progress bar: it promises motion, not a percentage. */}
      {live ? (
        <div
          aria-hidden
          style={{
            height: 2,
            background: `linear-gradient(90deg, transparent, ${c.signal}, transparent)`,
            backgroundSize: '200% 100%',
            animation: 'sfx-shimmer 1.4s linear infinite',
          }}
        />
      ) : null}

      {expanded ? (
        <div className="px-2.5 pb-2 pt-1">
          {wrote.length ? (
            <ul className="space-y-0.5">
              {wrote.map((path, i) => (
                <FileRow key={path} path={path} kind="wrote" i={i} />
              ))}
            </ul>
          ) : null}
          {removed.length ? (
            <ul className="mt-0.5 space-y-0.5">
              {removed.map((path, i) => (
                <FileRow key={path} path={path} kind="removed" i={i} />
              ))}
            </ul>
          ) : null}

          {actions.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {actions.map((action, i) => (
                <span
                  key={`${action.name}-${i}`}
                  className="rounded px-1.5 py-0.5 text-[10.5px]"
                  style={{
                    fontFamily: mono,
                    background: c.signalSoft,
                    color: c.signal,
                    animation: 'sfx-pop 0.25s ease-out both',
                  }}
                >
                  {action.name}
                  {action.detail ? ` ${action.detail}` : ''}
                </span>
              ))}
            </div>
          ) : live && !wrote.length ? (
            <p className="text-[11.5px]" style={{ color: c.mute }}>
              No tool calls yet — the agent is composing its reply.
            </p>
          ) : null}

          {live && reasoning ? (
            <p
              className="mt-1.5 border-t pt-1.5 text-[11px] italic leading-snug"
              style={{ borderColor: c.line, color: c.mute }}
              title="The agent's reasoning, as it streams"
            >
              {reasoning.length > 180 ? `…${reasoning.slice(-180)}` : reasoning}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FileRow({ path, kind, i }: { path: string; kind: 'wrote' | 'removed'; i: number }) {
  return (
    <li className="flex items-center gap-1.5" style={riseIn(i)}>
      <span
        className="text-[11px]"
        style={{ fontFamily: mono, color: kind === 'wrote' ? c.live : c.attention }}
        aria-hidden
      >
        {kind === 'wrote' ? '✓' : '−'}
      </span>
      <span className="truncate text-[11.5px]" style={{ fontFamily: mono, color: c.graphite }} title={path}>
        {path}
      </span>
    </li>
  );
}

/** The two useful things to do with a past turn: compare it, or go back to it. */
function Checkpoint({
  version,
  canRestore,
  onRestore,
  onViewChanges,
}: {
  version: number;
  canRestore: boolean;
  onRestore: (version: number) => void;
  onViewChanges: (version: number) => void;
}) {
  return (
    <div className="mt-2 flex items-center gap-2 px-0.5">
      <span
        className="rounded px-1.5 py-0.5 text-[10.5px]"
        style={{ fontFamily: mono, background: c.signalSoft, color: c.signal }}
      >
        v{version}
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        <button
          onClick={() => onViewChanges(version)}
          className="rounded px-2 py-1 text-[11px] transition-colors"
          style={{ fontFamily: mono, color: c.graphite, border: `1px solid ${c.line}`, background: c.card }}
        >
          View changes
        </button>
        <button
          onClick={() => onRestore(version)}
          disabled={!canRestore}
          className="rounded px-2 py-1 text-[11px] transition-colors disabled:opacity-40"
          style={{ fontFamily: mono, color: c.graphite, border: `1px solid ${c.line}`, background: c.card }}
          title={canRestore ? 'Make this version the head' : 'Wait for the current turn to finish'}
        >
          Restore
        </button>
      </div>
    </div>
  );
}

/** Collapse consecutive repeats: four writes read better as one chip, "write ×4". */
function collapse(names: string[]): TurnAction[] {
  const out: TurnAction[] = [];
  for (const name of names) {
    const last = out[out.length - 1];
    if (last && last.name === name) {
      const n = Number(last.detail?.replace(/^×/, '') ?? '1') + 1;
      last.detail = `×${n}`;
      continue;
    }
    out.push({ name });
    if (out.length >= 24) break;
  }
  return out;
}

function Composer({
  draft,
  busy,
  onDraft,
  onSend,
  onStop,
  placeholder,
}: {
  draft: string;
  busy: boolean;
  onDraft: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  placeholder: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="shrink-0 p-2.5" style={{ borderTop: `1px solid ${c.line}`, background: c.card }}>
      <div
        className="rounded-lg p-px transition-all duration-200"
        style={{
          background: focused ? `linear-gradient(120deg, ${c.signal}, ${c.agent})` : c.line,
        }}
      >
        <textarea
          value={draft}
          onChange={e => onDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (!busy && draft.trim()) onSend();
            }
          }}
          rows={3}
          placeholder={placeholder}
          className="w-full resize-none rounded-[7px] px-2.5 py-2 text-[13px] leading-snug outline-none"
          style={{ background: c.paper, color: c.text, display: 'block' }}
        />
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="text-[10.5px]" style={{ fontFamily: mono, color: c.mute }}>
          ⌘↵ to send
        </span>
        <div className="ml-auto flex gap-1.5">
          {busy ? (
            <button
              onClick={onStop}
              className="rounded px-2.5 py-1.5 text-[11.5px]"
              style={{ fontFamily: mono, color: c.graphite, border: `1px solid ${c.line}` }}
              title="Stop watching this run — it keeps going, and reopening the project picks it back up"
            >
              Stop watching
            </button>
          ) : null}
          <button
            onClick={onSend}
            disabled={busy || !draft.trim()}
            className="rounded-full px-3 py-1.5 text-[11.5px] transition-all disabled:opacity-40"
            style={{ fontFamily: mono, background: c.signal, color: c.signalText }}
          >
            {busy ? 'Running' : 'Send ↑'}
          </button>
        </div>
      </div>
    </div>
  );
}
