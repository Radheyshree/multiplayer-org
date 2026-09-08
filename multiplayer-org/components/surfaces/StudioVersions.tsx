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
import { useState } from 'react';
import { c, eyebrow, mono } from '../../lib/theme';
import { canDeploy } from '../../lib/studioDeploy';
import type { StudioFile } from '../../lib/studioProtocol';
import type { StudioProject, VersionMeta } from '../../lib/studioStore';

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
            style={{ fontFamily: mono, background: c.ink, color: '#D7DBE6' }}
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
