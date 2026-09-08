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
import { useState } from 'react';
import {
  describeArgs,
  formatDuration,
  humanizeTool,
  isFailure,
  isTerminal,
  type AgentRun,
  type ToolInvocation,
} from '../../lib/agentrun';
import { c, mono } from '../../lib/theme';

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
