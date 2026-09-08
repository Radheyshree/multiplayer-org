/**
 * The conversation, and the composer that continues it.
 *
 * THE HONEST-PROGRESS PROBLEM shapes everything here. A Claw run's answer text
 * does NOT stream — `result` is empty for the whole run and lands whole at the
 * end (measured: 0 bytes at 51s, 4,872 at 66s). Every AI builder fills that gap
 * with a typing animation. We can't, and shouldn't. What each poll DOES give us
 * is real: the tool running right now, how many have run, and how long it has
 * been going. Those move, so those are what a running turn shows.
 *
 * THE SECOND PROBLEM is that all of it used to be live-only. Tool calls arrived
 * on the progress stream and vanished the moment the page reloaded, so a turn
 * you watched work and a turn you came back to looked nothing alike. Now the
 * turn record carries its own actions, duration and changed files
 * (lib/studioStore.ts), and this renders from THAT — so a finished turn reads
 * identically whether you saw it happen or opened the project a day later.
 *
 * The shape follows the same idea as AI Studio's action history: what the agent
 * did, collapsible, above what it says about it — and a checkpoint row, because
 * the useful thing to do with a past turn is compare it or go back to it.
 */
import { useEffect, useRef, useState } from 'react';
import { c, eyebrow, mono } from '../../lib/theme';
import type { RunProgress } from '../../lib/studioClaw';
import type { Turn, TurnAction } from '../../lib/studioStore';

const FOLLOWUPS = [
  'Make it look more polished — better spacing, hierarchy and empty states',
  'Add a search box that filters what is shown',
  'Load real data from the workspace with the xyne SDK instead of the seeded values',
  'Add a dark mode toggle',
  'Split the biggest file into smaller components',
];

export function StudioTimeline({
  turns,
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

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns.length, running?.status, running?.label, running?.invocations.length]);

  const busy = Boolean(running);

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: c.paper }}>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {turns.length === 0 && !busy ? (
          <p className="px-1 text-[13px] leading-relaxed" style={{ color: c.graphite }}>
            Say what you want built. {agentName} writes the files, they run in the preview, and
            everything after that is a followup.
          </p>
        ) : null}

        <ul className="space-y-4">
          {turns.map(turn => (
            <li key={turn.id}>
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
          <div className="mt-4 flex flex-wrap gap-1.5">
            {FOLLOWUPS.slice(0, 3).map(text => (
              <button
                key={text}
                onClick={() => onDraft(text)}
                className="rounded-full px-2.5 py-1 text-left text-[11px] transition-colors"
                style={{ border: `1px solid ${c.line}`, color: c.graphite, background: c.card }}
              >
                {text.length > 44 ? `${text.slice(0, 43)}…` : text}
              </button>
            ))}
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
      <div className="rounded-lg px-3 py-2" style={{ background: c.inkSoft }}>
        <p className="whitespace-pre-wrap text-[12.5px] leading-snug" style={{ color: '#E8EAF0' }}>
          {turn.prompt}
        </p>
      </div>

      <div className="mt-2 flex items-baseline gap-2 px-0.5">
        <span className="text-[11px]" style={{ fontFamily: mono, color: c.graphite }}>
          {agentName}
        </span>
        <span style={{ color: c.mute }}>·</span>
        <span className="text-[11px]" style={{ fontFamily: mono, color: c.mute }}>
          {live ? `Running ${seconds}s` : seconds > 0 ? `Ran for ${seconds}s` : 'Done'}
        </span>
        {live ? <Pulse /> : null}
      </div>

      <ActionHistory
        live={live}
        label={running?.label ?? null}
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
  actions,
  wrote,
  removed,
}: {
  live: boolean;
  label: string | null;
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
      >
        <span style={{ ...eyebrow, color: c.mute }}>Actions</span>
        <span className="truncate text-[12px]" style={{ color: c.text }}>
          {headline}
        </span>
        {!live ? (
          <span className="ml-auto text-[10px]" style={{ fontFamily: mono, color: c.mute }}>
            {expanded ? '−' : '+'}
          </span>
        ) : null}
      </button>

      {expanded ? (
        <div className="px-2.5 pb-2">
          {wrote.length ? (
            <ul className="space-y-0.5">
              {wrote.map(path => (
                <FileRow key={path} path={path} kind="wrote" />
              ))}
            </ul>
          ) : null}
          {removed.length ? (
            <ul className="mt-0.5 space-y-0.5">
              {removed.map(path => (
                <FileRow key={path} path={path} kind="removed" />
              ))}
            </ul>
          ) : null}

          {actions.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {actions.map((action, i) => (
                <span
                  key={`${action.name}-${i}`}
                  className="rounded px-1.5 py-0.5 text-[10.5px]"
                  style={{ fontFamily: mono, background: c.signalSoft, color: c.signal }}
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
        </div>
      ) : null}
    </div>
  );
}

function FileRow({ path, kind }: { path: string; kind: 'wrote' | 'removed' }) {
  return (
    <li className="flex items-center gap-1.5">
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
          className="rounded px-2 py-1 text-[11px]"
          style={{ fontFamily: mono, color: c.graphite, border: `1px solid ${c.line}`, background: c.card }}
        >
          View changes
        </button>
        <button
          onClick={() => onRestore(version)}
          disabled={!canRestore}
          className="rounded px-2 py-1 text-[11px] disabled:opacity-40"
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

function Pulse() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setOn(v => !v), 620);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      className="ml-auto size-1.5 shrink-0 rounded-full transition-opacity"
      style={{ background: c.signal, opacity: on ? 1 : 0.25 }}
    />
  );
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
  return (
    <div className="shrink-0 p-2.5" style={{ borderTop: `1px solid ${c.line}`, background: c.card }}>
      <textarea
        value={draft}
        onChange={e => onDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (!busy && draft.trim()) onSend();
          }
        }}
        rows={3}
        placeholder={placeholder}
        className="w-full resize-none rounded-md px-2.5 py-2 text-[13px] leading-snug outline-none"
        style={{ border: `1px solid ${c.line}`, background: c.paper, color: c.text }}
      />
      <div className="mt-1.5 flex items-center gap-2">
        <span className="text-[10.5px]" style={{ fontFamily: mono, color: c.mute }}>
          Cmd + Enter to send
        </span>
        <div className="ml-auto flex gap-1.5">
          {busy ? (
            <button
              onClick={onStop}
              className="rounded px-2.5 py-1.5 text-[11.5px]"
              style={{ fontFamily: mono, color: c.graphite, border: `1px solid ${c.line}` }}
            >
              Stop watching
            </button>
          ) : null}
          <button
            onClick={onSend}
            disabled={busy || !draft.trim()}
            className="rounded px-3 py-1.5 text-[11.5px] transition-opacity disabled:opacity-40"
            style={{ fontFamily: mono, background: c.signal, color: c.paper }}
          >
            {busy ? 'Running' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
