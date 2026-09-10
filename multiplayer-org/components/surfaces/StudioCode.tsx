import { c, eyebrow, mono } from '../../lib/theme';
import { canDeploy, type StudioFile } from '../../lib/studioProtocol';
import { type StudioProject, type VersionMeta } from '../../lib/studioRuntime';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';

/* ---- from components/surfaces/StudioCode.tsx -------------------------- */
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

/* ---- from components/surfaces/StudioVersions.tsx ---------------------- */
/**
 * History, and the way out of Studio into a real app.
 *
 * Every turn that produced files is a version, and restoring one is a read of
 * that version's file records — not a re-run. So going back is instant and
 * costs nothing, which is what makes experimenting cheap enough to actually do.
 *
 * Deploy is deliberately the most cautious control in the surface. It calls the
 * same claw-auth route `spaces app publish` calls, as the signed-in viewer, and
 * creates a REAL app in their workspace. There is no delete route — anywhere —
 * so the row it creates is permanent. Hence: "Show what would be sent" first,
 * create UNPUBLISHED, publish only as a second explicit act, and the
 * irreversibility stated on the button rather than buried.
 */

export type DeployIntent = 'create' | 'version' | 'publish';

export function StudioVersions({
  project,
  versions,
  files,
  head,
  busy,
  problems,
  onRestore,
  onDeploy,
  deploying,
  deployNote,
}: {
  project: StudioProject;
  versions: VersionMeta[];
  files: StudioFile[];
  head: number;
  /** A turn is in flight; restoring would race its write. */
  busy: boolean;
  /** Publish-blocking problems with the current files, from projectProblems(). */
  problems: string[];
  onRestore: (n: number) => void;
  onDeploy: (intent: DeployIntent) => void;
  deploying: boolean;
  deployNote: string | null;
}) {
  const [showPayload, setShowPayload] = useState(false);

  const bytes = files.reduce((sum, f) => sum + new TextEncoder().encode(f.content).length, 0);
  const deployable = canDeploy();

  // `xyne` is a virtual module Studio's own preview resolves (lib/studioHost.ts).
  // A deployed app is bundled by the sandbox, where no such package exists — so
  // an app that reads live workspace data runs here and fails to build there.
  // Better to say so plainly than to let someone find out from a bundler error.
  const usesLiveData = files.some(f => /from\s+['"]xyne['"]/.test(f.content));

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <section className="p-4" style={{ borderBottom: `1px solid ${c.line}` }}>
        <div style={{ ...eyebrow, color: c.mute }}>Ship it</div>

        <p className="mt-2 max-w-xl text-[13px] leading-relaxed" style={{ color: c.graphite }}>
          Deploying creates a real Xyne app in your workspace, as you, through the same API{' '}
          <span style={{ fontFamily: mono }}>spaces app publish</span> uses. It is created{' '}
          <strong style={{ color: c.text }}>private</strong> — publishing to the workspace Library is a
          separate step.
        </p>
        <p className="mt-1.5 max-w-xl text-[12.5px] leading-relaxed" style={{ color: c.attention }}>
          There is no delete. Unpublishing makes an app private again, but the app itself is permanent.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowPayload(v => !v)}
            className="rounded px-3 py-1.5 text-[11.5px]"
            style={{ fontFamily: mono, color: c.graphite, border: `1px solid ${c.line}`, background: c.card }}
          >
            {showPayload ? 'Hide payload' : 'Show what would be sent'}
          </button>

          <button
            onClick={() => onDeploy(project.deployedAppId ? 'version' : 'create')}
            disabled={!deployable || deploying || busy || files.length === 0 || problems.length > 0}
            className="rounded px-3 py-1.5 text-[11.5px] disabled:opacity-40"
            style={{ fontFamily: mono, background: c.signal, color: c.paper }}
          >
            {deploying
              ? 'Deploying…'
              : project.deployedAppId
                ? 'Push a new version'
                : 'Create the app (private)'}
          </button>

          {project.deployedAppId ? (
            <button
              onClick={() => onDeploy('publish')}
              disabled={!deployable || deploying}
              className="rounded px-3 py-1.5 text-[11.5px] disabled:opacity-40"
              style={{ fontFamily: mono, color: c.signal, border: `1px solid ${c.signal}`, background: c.card }}
            >
              Publish to the workspace
            </button>
          ) : null}
        </div>

        {!deployable ? (
          <p className="mt-2 text-[12px]" style={{ color: c.mute }}>
            Deploy needs the app to be running inside Spaces — the app API authenticates with the
            viewer's session, and a dev server only has a bearer token. Everything else works here.
          </p>
        ) : null}

        {usesLiveData ? (
          <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed" style={{ color: c.attention }}>
            This app imports <span style={{ fontFamily: mono }}>xyne</span> for live workspace data.
            That module is provided by Studio's preview, not by the published sandbox — so the app runs
            here but will not build once deployed. Deployed apps reach data through the host's own
            runtime instead. Ask the agent to replace the live calls with seeded data before deploying.
          </p>
        ) : null}

        {problems.length ? (
          <ul className="mt-2 space-y-0.5">
            {problems.map(problem => (
              <li key={problem} className="text-[12.5px]" style={{ color: c.attention }}>
                {problem} Ask the agent to split or shrink it.
              </li>
            ))}
          </ul>
        ) : null}

        {deployNote ? (
          <p className="mt-2 text-[12.5px]" style={{ color: c.text }}>
            {deployNote}
          </p>
        ) : null}

        {project.deployedAppId ? (
          <p className="mt-2 text-[11.5px]" style={{ fontFamily: mono, color: c.mute }}>
            app {project.deployedAppId}
            {project.deployedVersion ? ` · v${project.deployedVersion}` : ''}
          </p>
        ) : null}

        {showPayload ? (
          <pre
            className="mt-3 max-h-72 overflow-auto rounded-md p-3 text-[11px] leading-relaxed"
            style={{ fontFamily: mono, background: c.ink, color: c.graphite }}
          >
{JSON.stringify(
  {
    title: project.title,
    entry: project.entry,
    files: files.map(f => ({ path: f.path, content: `<${new TextEncoder().encode(f.content).length} bytes>` })),
  },
  null,
  2,
)}
          </pre>
        ) : null}
      </section>

      <section className="p-4">
        <div className="flex items-baseline gap-3">
          <div style={{ ...eyebrow, color: c.mute }}>History</div>
          <span className="text-[11px]" style={{ fontFamily: mono, color: c.mute }}>
            {versions.length} version{versions.length === 1 ? '' : 's'} · {(bytes / 1024).toFixed(1)} KB
            on head
          </span>
        </div>

        {versions.length === 0 ? (
          <p className="mt-2 text-[13px]" style={{ color: c.graphite }}>
            Nothing yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {versions.map(version => {
              const isHead = version.n === head;
              return (
                <li
                  key={version.n}
                  className="flex items-start gap-3 rounded-md px-3 py-2"
                  style={{
                    background: isHead ? c.signalSoft : c.card,
                    border: `1px solid ${isHead ? c.signal : c.line}`,
                  }}
                >
                  <span
                    className="mt-0.5 shrink-0 text-[11px]"
                    style={{ fontFamily: mono, color: isHead ? c.signal : c.mute }}
                  >
                    v{version.n}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] leading-snug" style={{ color: c.text }}>
                      {version.summary}
                    </p>
                    <p className="mt-0.5 truncate text-[11px]" style={{ color: c.mute }}>
                      {version.prompt}
                    </p>
                    <p className="mt-0.5 text-[10.5px]" style={{ fontFamily: mono, color: c.mute }}>
                      {version.paths.length} file{version.paths.length === 1 ? '' : 's'} ·{' '}
                      {version.agentSlug} · {new Date(version.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  {!isHead ? (
                    <button
                      onClick={() => onRestore(version.n)}
                      disabled={busy}
                      className="shrink-0 rounded px-2 py-1 text-[11px] disabled:opacity-40"
                      style={{ fontFamily: mono, color: c.graphite, border: `1px solid ${c.line}` }}
                      title={busy ? 'Wait for the current turn to finish' : 'Make this version the head'}
                    >
                      Restore
                    </button>
                  ) : (
                    <span className="shrink-0 text-[10.5px]" style={{ ...eyebrow, color: c.signal }}>
                      Head
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ---- from components/surfaces/StudioFx.tsx ---------------------------- */
/**
 * Studio's motion vocabulary, defined once.
 *
 * Everything animated in Studio pulls from these five keyframes rather than
 * declaring its own, so the surface moves with one accent instead of six. The
 * names are prefixed `sfx-` because generated apps render into THIS document
 * (lib/studioRuntime.ts) — an unprefixed `fade-in` here would collide with the
 * first generated app that declares its own.
 *
 * Colours come through `color-mix` on the theme vars, not rgba literals, so a
 * glow is the accent colour in dark mode too.
 */

export function StudioFx() {
  return (
    <style>{`
      @keyframes sfx-up { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      @keyframes sfx-pop { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
      @keyframes sfx-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
      @keyframes sfx-spin { to { transform: rotate(360deg); } }
      @keyframes sfx-breathe {
        0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, ${c.signal} 40%, transparent); }
        70% { box-shadow: 0 0 0 7px color-mix(in srgb, ${c.signal} 0%, transparent); }
      }
      @keyframes sfx-ellipsis { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75% { content: '...'; } }
      .sfx-dots::after { display: inline-block; width: 1.2em; text-align: left; content: '…'; animation: sfx-ellipsis 1.4s steps(1) infinite; }
      @media (prefers-reduced-motion: reduce) {
        .sfx-anim, .sfx-anim * { animation: none !important; transition: none !important; }
      }
    `}</style>
  );
}

/** Staggered entrance for the i-th item of a list. */
export function riseIn(i: number): CSSProperties {
  return { animation: `sfx-up 0.35s ${Math.min(i, 8) * 45}ms cubic-bezier(0.2, 0.7, 0.2, 1) both` };
}

/** A shimmering placeholder block — the loading state that admits it is one. */
export function Shimmer({ w, h, r = 6, style }: { w: number | string; h: number; r?: number; style?: CSSProperties }) {
  return (
    <div
      aria-hidden
      style={{
        width: w,
        height: h,
        borderRadius: r,
        background: `linear-gradient(100deg, ${c.line} 40%, color-mix(in srgb, ${c.line} 35%, transparent) 50%, ${c.line} 60%)`,
        backgroundSize: '200% 100%',
        animation: 'sfx-shimmer 1.6s linear infinite',
        ...style,
      }}
    />
  );
}

/** The indeterminate ring shown beside a live clock — motion that promises nothing. */
export function Ring({ size = 13 }: { size?: number }) {
  const r = (size - 3) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden style={{ animation: 'sfx-spin 0.9s linear infinite' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c.line} strokeWidth={1.8} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={c.signal} strokeWidth={1.8} strokeLinecap="round"
        strokeDasharray={`${circ * 0.28} ${circ}`}
      />
    </svg>
  );
}
