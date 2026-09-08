/**
 * The source, as the agent left it — and as you can change it.
 *
 * Two things this does that a read-only code tab does not:
 *
 *  - It is EDITABLE. Saving re-evaluates immediately, so a one-character fix
 *    costs a keystroke rather than a round trip to an agent. It also makes the
 *    editor the source of truth, which is exactly the assumption the followup
 *    prompt makes when it replays the current files (lib/studioProtocol.ts).
 *  - It shows a DIFF against the previous version, so "what did that turn
 *    actually change" is answerable without reading the whole file. Followups
 *    are the core loop; being unable to see their effect is what makes an AI
 *    builder feel like a slot machine.
 */
import { useEffect, useMemo, useState } from 'react';
import { c, eyebrow, mono } from '../../lib/theme';
import type { StudioFile } from '../../lib/studioProtocol';

type Row = { kind: ' ' | '+' | '-'; text: string; n: number | null };

export function StudioCode({
  files,
  previous,
  readOnly = false,
  diffSignal = 0,
  inspectingVersion = null,
  headVersion = 0,
  onExitInspect,
  onEdit,
}: {
  files: StudioFile[];
  /** The version before this one, when there is one. Drives the diff. */
  previous: StudioFile[] | null;
  /** True while a turn is in flight: saving then would race the agent's write. */
  readOnly?: boolean;
  /** Bumped by "View changes" to open straight into the diff. */
  diffSignal?: number;
  /** Set when showing a version the preview is NOT running. */
  inspectingVersion?: number | null;
  headVersion?: number;
  onExitInspect?: () => void;
  onEdit: (path: string, content: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<'source' | 'diff'>('source');
  const [draft, setDraft] = useState<string | null>(null);

  // "View changes" means show me the diff, not the file. Keyed on a counter so
  // asking twice for the same version still reopens it.
  useEffect(() => {
    if (diffSignal > 0) {
      setMode('diff');
      setDraft(null);
    }
  }, [diffSignal]);

  // `selected` can name a file a restore removed. Falling back keeps the pane
  // showing something real instead of going blank on a version that dropped it.
  const active = files.find(f => f.path === selected) ?? files[0] ?? null;
  const before = previous?.find(f => f.path === active?.path)?.content ?? null;
  const changed = useMemo(
    () => new Set(files.filter(f => (previous?.find(p => p.path === f.path)?.content ?? null) !== f.content).map(f => f.path)),
    [files, previous],
  );

  const rows = useMemo(() => {
    if (!active) return [];
    if (mode === 'source' || before === null) {
      return active.content.split('\n').map((text, i): Row => ({ kind: ' ', text, n: i + 1 }));
    }
    return diffLines(before, active.content);
  }, [active, before, mode]);

  if (files.length === 0) {
    return (
      <div className="grid h-full place-items-center px-8 text-center">
        <p className="max-w-sm text-[13px]" style={{ color: c.graphite }}>
          No files yet. The first turn writes them.
        </p>
      </div>
    );
  }

  const editing = draft !== null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {inspectingVersion !== null ? (
        <div
          className="flex shrink-0 items-center gap-2 px-3 py-1.5"
          style={{ background: c.signalSoft, borderBottom: `1px solid ${c.line}` }}
        >
          <span className="text-[11.5px]" style={{ color: c.signal }}>
            Showing <strong>v{inspectingVersion}</strong> — the preview is running v{headVersion}.
          </span>
          <button
            onClick={onExitInspect}
            className="ml-auto rounded px-2 py-0.5 text-[11px]"
            style={{ fontFamily: mono, color: c.signal, border: `1px solid ${c.signal}` }}
          >
            Back to v{headVersion}
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
      <div
        className="w-56 shrink-0 overflow-y-auto"
        style={{ borderRight: `1px solid ${c.line}`, background: c.paper }}
      >
        <div className="px-3 pt-3 pb-1.5" style={{ ...eyebrow, color: c.mute }}>
          {files.length} file{files.length === 1 ? '' : 's'}
        </div>
        <ul className="pb-3">
          {files.map(file => {
            const isActive = file.path === active?.path;
            return (
              <li key={file.path}>
                <button
                  onClick={() => {
                    setSelected(file.path);
                    setDraft(null);
                  }}
                  className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left"
                  style={{
                    background: isActive ? c.card : 'transparent',
                    borderLeft: `2px solid ${isActive ? c.signal : 'transparent'}`,
                  }}
                >
                  <span
                    className="truncate text-[12px]"
                    style={{ fontFamily: mono, color: isActive ? c.text : c.graphite }}
                    title={file.path}
                  >
                    {file.path}
                  </span>
                  {changed.has(file.path) ? (
                    <span
                      className="ml-auto size-1.5 shrink-0 rounded-full"
                      style={{ background: c.signal }}
                      title="Changed in this version"
                    />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="flex shrink-0 items-center gap-2 px-3 py-2"
          style={{ borderBottom: `1px solid ${c.line}` }}
        >
          <span className="truncate text-[12px]" style={{ fontFamily: mono, color: c.text }}>
            {active?.path}
          </span>

          <div className="ml-auto flex items-center gap-1">
            {before !== null && !editing ? (
              <button
                onClick={() => setMode(m => (m === 'source' ? 'diff' : 'source'))}
                className="rounded px-2 py-1 text-[11px]"
                style={{
                  fontFamily: mono,
                  background: mode === 'diff' ? c.signalSoft : 'transparent',
                  color: mode === 'diff' ? c.signal : c.graphite,
                  border: `1px solid ${mode === 'diff' ? c.signal : c.line}`,
                }}
              >
                Diff
              </button>
            ) : null}

            {editing ? (
              <>
                <button
                  onClick={() => setDraft(null)}
                  className="rounded px-2 py-1 text-[11px]"
                  style={{ fontFamily: mono, color: c.graphite, border: `1px solid ${c.line}` }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (active) onEdit(active.path, draft);
                    setDraft(null);
                  }}
                  className="rounded px-2 py-1 text-[11px]"
                  style={{ fontFamily: mono, background: c.signal, color: c.paper }}
                >
                  Save & run
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setMode('source');
                  setDraft(active?.content ?? '');
                }}
                disabled={readOnly}
                className="rounded px-2 py-1 text-[11px] disabled:opacity-40"
                style={{ fontFamily: mono, color: c.graphite, border: `1px solid ${c.line}` }}
                title={readOnly ? 'The agent is writing — wait for the turn to finish' : 'Edit this file'}
              >
                Edit
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto" style={{ background: c.card }}>
          {editing ? (
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              spellCheck={false}
              className="h-full w-full resize-none p-3 text-[12px] leading-relaxed outline-none"
              style={{ fontFamily: mono, color: c.text, background: c.card, tabSize: 2 }}
            />
          ) : (
            <pre className="p-3 text-[12px] leading-relaxed" style={{ fontFamily: mono }}>
              {rows.map((row, i) => (
                <div
                  key={i}
                  className="flex"
                  style={{
                    background:
                      row.kind === '+' ? c.liveSoft : row.kind === '-' ? c.dangerSoft : 'transparent',
                  }}
                >
                  <span
                    className="w-10 shrink-0 select-none pr-3 text-right"
                    style={{ color: c.mute }}
                  >
                    {row.n ?? ''}
                  </span>
                  <span className="w-3 shrink-0 select-none" style={{ color: row.kind === '+' ? c.live : c.attention }}>
                    {row.kind === ' ' ? '' : row.kind}
                  </span>
                  <span className="whitespace-pre-wrap break-all" style={{ color: c.text }}>
                    {row.text || ' '}
                  </span>
                </div>
              ))}
            </pre>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

/**
 * Line diff via longest common subsequence.
 *
 * O(n·m) is fine here and a heuristic is not: generated files are a few hundred
 * lines, and a diff that mis-aligns is worse than no diff at all — it tells you
 * a turn changed things it did not touch, which is exactly the question the
 * view exists to answer.
 */
function diffLines(before: string, after: string): Row[] {
  const a = before.split('\n');
  const b = after.split('\n');

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const rows: Row[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ kind: ' ', text: a[i], n: j + 1 });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ kind: '-', text: a[i], n: null });
      i += 1;
    } else {
      rows.push({ kind: '+', text: b[j], n: j + 1 });
      j += 1;
    }
  }
  while (i < a.length) {
    rows.push({ kind: '-', text: a[i], n: null });
    i += 1;
  }
  while (j < b.length) {
    rows.push({ kind: '+', text: b[j], n: j + 1 });
    j += 1;
  }
  return rows;
}
