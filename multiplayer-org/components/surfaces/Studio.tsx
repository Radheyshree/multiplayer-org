/**
 * Studio — build a Space app by talking to a Claw agent.
 *
 * The loop: a prompt becomes a Claw run, the run's text is parsed into files,
 * the files are stored as a version and evaluated in this document, and the next
 * prompt is a followup that carries both the conversation and the current source.
 *
 * WHY THIS SHAPE, given Xyne already generates apps
 *
 * The dashboard's app creation is a chat thread that produces an artifact: you
 * describe an app, an agent calls the `create-app` tool, and a Sandpack frame
 * renders the result. It works, and three things about it are what an AI-Studio
 * class tool fixes:
 *
 *  1. The code is not yours to see or touch. `create-app` returns a manifest —
 *     paths, never contents — so the source is somewhere you are not. Here the
 *     files are the state: readable, diffable, editable, and re-run on save.
 *  2. A version is not a thing you can move between. Here every turn is a
 *     version, restoring one is a read rather than a re-run, and the diff
 *     against the previous turn is one click.
 *  3. Progress is a spinner. A run takes 20-90 seconds and the answer text does
 *     not stream, so the only honest progress is the tool the agent is running
 *     and the clock. Studio shows exactly those, and nothing it cannot know.
 *
 * And one thing it adds: apps built here can read the real workspace while you
 * are still iterating on them, because the preview runs in-process and the
 * generated module graph resolves `xyne` to the live SDK (lib/studioHost.ts).
 *
 * WHAT STUDIO DELIBERATELY DOES NOT DO
 *
 * It does not call `create-app`. It cannot: every run an app starts carries an
 * `app_`-prefixed conversation and the runtime strips that tool from such runs —
 * the self-replication ban (xyne-claw run.ts:3272). Studio's own fenced-file
 * contract is the way around it, and it turns out to be the better mechanism
 * anyway, because it works with all 214 agents rather than the few configured
 * with the tool, and it hands back file contents rather than a manifest.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { c, mono } from '../../lib/theme';
import {
  defaultAgent,
  listStudioAgents,
  resumeRun,
  runTurn,
  type Invocation,
  type RunProgress,
  type StudioAgent,
} from '../../lib/studioClaw';
import {
  applyReply,
  buildCreateTask,
  buildFixTask,
  buildFollowupTask,
  parseReply,
  projectProblems,
  type StudioFile,
} from '../../lib/studioProtocol';
import { ensureRuntimeTailwind, type RuntimeError } from '../../lib/studioRuntime';
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  listVersions,
  makeTurn,
  nextVersion,
  readVersionFiles,
  saveProject,
  titleFrom,
  writeVersion,
  type StudioProject,
  type Turn,
  type TurnAction,
  type VersionMeta,
} from '../../lib/studioStore';
import { buildPayload, createApp, publishApp, pushVersion } from '../../lib/studioDeploy';
import { StudioApps } from './StudioApps';
import { StudioCode } from './StudioCode';
import { AgentPicker, StudioHome } from './StudioHome';
import { StudioPreview } from './StudioPreview';
import { StudioTimeline } from './StudioTimeline';
import { StudioVersions, type DeployIntent } from './StudioVersions';

type Tab = 'preview' | 'code' | 'versions';

/** Which landing screen is showing when no project is open. */
type Lobby = 'new' | 'apps';

export function Studio() {
  const [agents, setAgents] = useState<StudioAgent[]>([]);
  const [agentsNote, setAgentsNote] = useState<string | null>(null);
  const [agentSlug, setAgentSlug] = useState('assistant');
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [lobby, setLobby] = useState<Lobby>('new');

  const [project, setProject] = useState<StudioProject | null>(null);
  const [files, setFiles] = useState<StudioFile[]>([]);
  const [previousFiles, setPreviousFiles] = useState<StudioFile[] | null>(null);
  const [missingFiles, setMissingFiles] = useState(false);
  /**
   * A version being INSPECTED in the code pane, which need not be the one the
   * preview is running. "View changes" on an old turn should not silently move
   * head — looking is not the same as going back — so the comparison lives here
   * and the pane says plainly which version it is showing.
   */
  const [inspecting, setInspecting] = useState<{ n: number; files: StudioFile[]; previous: StudioFile[] | null } | null>(null);
  const [diffSignal, setDiffSignal] = useState(0);
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [tab, setTab] = useState<Tab>('preview');
  const [draft, setDraft] = useState('');
  const [running, setRunning] = useState<RunProgress | null>(null);
  const [failure, setFailure] = useState<RuntimeError | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployNote, setDeployNote] = useState<string | null>(null);

  // Aborts the WATCHER, never the run — a Claw run outlives whatever is
  // watching it, and its session id is kept on the turn so it can be picked
  // back up rather than lost.
  const watcher = useRef<AbortController | null>(null);
  // The live project, readable from inside an async turn without re-subscribing.
  const projectRef = useRef<StudioProject | null>(null);
  projectRef.current = project;
  /** Read by guards that must not be re-created every time progress ticks. */
  const runningRef = useRef(false);
  runningRef.current = Boolean(running);

  useEffect(() => {
    ensureRuntimeTailwind();
    void (async () => {
      try {
        const list = await listStudioAgents();
        setAgents(list);
        setAgentSlug(defaultAgent(list));
      } catch (err) {
        // Not fatal — 'assistant' exists in every deployment, so the surface
        // still works. But swallowing it silently leaves a one-entry picker
        // with no explanation, which reads as a broken app rather than a
        // degraded one.
        setAgentsNote(`Could not load the agent list (${describe(err)}). Falling back to "assistant".`);
      }
    })();
    void (async () => {
      try {
        setProjects(await listProjects());
      } catch (err) {
        setHomeError(describe(err));
      } finally {
        setLoadingProjects(false);
      }
    })();
    return () => watcher.current?.abort();
  }, []);


  /**
   * Fold a finished run into the project.
   *
   * Shared by a turn we watched from dispatch and a turn we re-attached to
   * after the fact, because the two must produce identical state — a result
   * that lands while Studio is closed has to be absorbed exactly as if it had
   * landed while we were looking at it.
   *
   * The project is re-read from storage rather than taken from the caller's
   * closure: a turn takes minutes, and whatever the caller captured at dispatch
   * may be several writes stale by the time this runs.
   */
  const absorb = useCallback(
    async (projectId: string, turnId: string, prompt: string, final: RunProgress): Promise<void> => {
      const fresh = await getProject(projectId);
      if (!fresh) return;

      const patch = async (fields: Partial<Turn>, head?: number): Promise<StudioProject> => {
        const next = await saveProject({
          ...fresh,
          // `seq` only ever goes up, so a restore followed by a change cannot
          // re-issue a version number that already owns file records.
          ...(head === undefined ? {} : { head, seq: Math.max(fresh.seq ?? 0, head) }),
          turns: fresh.turns.map(t => (t.id === turnId ? { ...t, ...fields } : t)),
        });
        setProject(next);
        setProjects(await listProjects().catch(() => []));
        return next;
      };

      // Everything the timeline will draw is captured HERE, at the one moment
      // we hold it. `final.invocations` lives in the progress stream and is gone
      // on reload; the turn record is what survives.
      const record = {
        actions: summariseActions(final.invocations),
        durationMs: final.elapsedS * 1000,
      };

      if (final.status !== 'completed') {
        await patch({ ...record, status: 'failed', error: final.error ?? `The run ${final.status}.` });
        return;
      }

      const reply = parseReply(final.result);
      if (reply.files.length === 0 && reply.deleted.length === 0) {
        // Not a failure. An agent that asks a question or declines has said
        // something worth reading, and swallowing it would be the worst
        // possible outcome of a turn.
        await patch({
          ...record,
          status: 'empty',
          summary: 'No files in this reply.',
          ...(reply.prose ? { note: reply.prose } : {}),
        });
        return;
      }

      const base = fresh.head > 0 ? await readVersionFiles(fresh.id, fresh.head) : [];
      const nextFiles = applyReply(base, reply, fresh.entry);

      // A FIRST build with no entry is almost always an agent illustrating the
      // output format inside a clarifying question rather than shipping a
      // project. Treating that as v1 would bury the question under a version
      // that cannot render, so the prose is surfaced instead.
      if (base.length === 0 && !nextFiles.some(f => f.path === fresh.entry)) {
        await patch({
          ...record,
          status: 'empty',
          summary: `No ${fresh.entry} in this reply.`,
          ...(reply.prose ? { note: reply.prose } : {}),
        });
        return;
      }

      const n = nextVersion(fresh);
      const { rejected } = await writeVersion({
        projectId: fresh.id,
        n,
        files: nextFiles,
        summary: reply.summary,
        prompt,
        agentSlug: fresh.agentSlug,
      });

      // Rename on the FIRST build only. The agent's title names the app; a
      // followup that mentions something else must not quietly rename the
      // project out from under someone who has learned to find it by name.
      if (fresh.head === 0 && reply.title) fresh.title = reply.title;

      await patch(
        {
          ...record,
          status: 'ok',
          summary: reply.summary,
          version: n,
          wrote: reply.files.map(f => f.path),
          ...(reply.deleted.length ? { removed: reply.deleted } : {}),
          ...(reply.prose ? { note: reply.prose } : {}),
          ...(rejected.length
            ? { error: `${rejected.length} file(s) too large to store: ${rejected.map(r => r.path).join(', ')}` }
            : {}),
        },
        n,
      );

      setPreviousFiles(base.length ? base : null);
      setFiles(nextFiles);
      setInspecting(null);
      setMissingFiles(false);
      setVersions(await listVersions(fresh.id));
      setFailure(null);
      setTab('preview');
    },
    [],
  );

  /**
   * One turn, start to finish.
   *
   * State is written as it happens rather than at the end, so a reload mid-run
   * finds a project whose history is accurate and whose last turn is honestly
   * marked running. The session id in particular is persisted the moment Claw
   * hands it over — that single write is what makes a mid-run reload
   * recoverable, because without it a reopened project has a running turn and
   * no way to find the run again.
   */
  const runOneTurn = useCallback(
    async (current: StudioProject, prompt: string, task: string) => {
      const turn: Turn = makeTurn({ prompt, agentSlug: current.agentSlug });
      const seeded = await saveProject({ ...current, turns: [...current.turns, turn] });
      setProject(seeded);
      setRunning({ status: 'starting', label: null, invocations: [], reasoning: '', result: '', error: null, elapsedS: 0 });

      const controller = new AbortController();
      watcher.current?.abort();
      watcher.current = controller;

      let recorded = false;
      try {
        const final = await runTurn({
          agent: current.agentSlug,
          task,
          conversationId: current.conversationId,
          signal: controller.signal,
          onProgress: (progress, sessionId) => {
            setRunning(progress);
            if (recorded) return;
            recorded = true;
            void (async () => {
              const fresh = await getProject(current.id);
              if (!fresh) return;
              setProject(
                await saveProject({
                  ...fresh,
                  turns: fresh.turns.map(t => (t.id === turn.id ? { ...t, sessionId } : t)),
                }),
              );
            })();
          },
        });
        await absorb(current.id, turn.id, prompt, final);
      } catch (err) {
        const watcherOnly = (err as { watcherOnly?: boolean }).watcherOnly === true;
        const fresh = await getProject(current.id);
        if (fresh) {
          setProject(
            await saveProject({
              ...fresh,
              turns: fresh.turns.map(t =>
                t.id === turn.id
                  ? {
                      ...t,
                      status: watcherOnly ? 'running' : 'failed',
                      ...(watcherOnly ? {} : { error: describe(err) }),
                    }
                  : t,
              ),
            }),
          );
        }
      } finally {
        setRunning(null);
      }
    },
    [absorb],
  );

  /**
   * Pick a run back up.
   *
   * A Claw run outlives whatever is watching it — closing Studio aborts the
   * watcher, never the run. So a project whose last turn is still marked
   * running usually has a session that finished in the meantime, and
   * re-attaching is what makes "reopen to pick it up" true rather than a
   * sentence in the UI.
   */
  const reattach = useCallback(
    async (target: StudioProject) => {
      const last = target.turns[target.turns.length - 1];
      if (!last || last.status !== 'running' || !last.sessionId) return;

      const controller = new AbortController();
      watcher.current?.abort();
      watcher.current = controller;
      setRunning({ status: 'running', label: 'Reattaching', invocations: [], reasoning: '', result: '', error: null, elapsedS: 0 });

      try {
        const final = await resumeRun({
          sessionId: last.sessionId,
          startedAt: last.at,
          signal: controller.signal,
          onProgress: setRunning,
        });
        await absorb(target.id, last.id, last.prompt, final);
      } catch {
        // Unreachable or abandoned. Leave the turn as it is rather than marking
        // a run failed on the strength of our own lost connection.
      } finally {
        setRunning(null);
      }
    },
    [absorb],
  );

  const openProject = useCallback(
    async (cached: StudioProject) => {
      // Re-read rather than trusting the row from the list. A turn started in
      // another tab — or in this one before a reload — may have advanced the
      // project since that list was fetched, and opening a stale copy would
      // show an older version and miss a run that is still in flight.
      const next = (await getProject(cached.id)) ?? cached;
      setProject(next);
      setAgentSlug(next.agentSlug);
      setTab('preview');
      setFailure(null);
      setDraft('');
      setVersions(await listVersions(next.id));

      if (next.head > 0) {
        const current = await readVersionFiles(next.id, next.head);
        setFiles(current);
        setMissingFiles(current.length === 0);
        const order = (await listVersions(next.id)).map(v => v.n).sort((a, b) => a - b);
        const before = order.filter(n => n < next.head).pop();
        setPreviousFiles(before ? await readVersionFiles(next.id, before) : null);
      } else {
        setFiles([]);
        setPreviousFiles(null);
        setMissingFiles(false);
      }
      void reattach(next);
    },
    [reattach],
  );

  const start = useCallback(
    async (intent: string) => {
      setHomeError(null);
      try {
        const created = await createProject({ title: titleFrom(intent), intent, agentSlug });
        await openProject(created);
        void runOneTurn(created, intent, buildCreateTask(intent));
      } catch (err) {
        setHomeError(describe(err));
      }
    },
    [agentSlug, openProject, runOneTurn],
  );

  const send = useCallback(() => {
    const text = draft.trim();
    const current = projectRef.current;
    if (!text || !current || running) return;
    setDraft('');
    void runOneTurn(current, text, files.length ? buildFollowupTask(text, files) : buildCreateTask(text));
  }, [draft, files, running, runOneTurn]);

  const fixIt = useCallback(() => {
    const current = projectRef.current;
    if (!current || !failure || running) return;
    const detail = `${failure.where}: ${failure.message}\n${failure.stack ?? ''}`;
    void runOneTurn(current, `Fix the error in ${failure.where}`, buildFixTask(detail, files));
  }, [failure, files, running, runOneTurn]);

  const restore = useCallback(
    async (n: number) => {
      const current = projectRef.current;
      // A turn in flight will write head and files when it lands. Letting a
      // restore interleave means whichever finishes last wins and the other
      // silently disappears — so the controls are disabled while running and
      // this is the backstop.
      if (!current || runningRef.current) return;
      const restored = await readVersionFiles(current.id, n);
      setInspecting(null);
      setFiles(restored);
      setMissingFiles(restored.length === 0);
      const order = versions.map(v => v.n).sort((a, b) => a - b);
      const before = order.filter(v => v < n).pop();
      setPreviousFiles(before ? await readVersionFiles(current.id, before) : null);
      const next = await saveProject({ ...current, head: n });
      setProject(next);
      setFailure(null);
      setTab('preview');
    },
    [versions],
  );

  /** A hand edit is a version like any other — history stays true. */
  const editFile = useCallback(
    async (path: string, content: string) => {
      const current = projectRef.current;
      if (!current || runningRef.current) return;
      const nextFiles = files.map(f => (f.path === path ? { ...f, content } : f));
      const n = nextVersion(current);
      setPreviousFiles(files);
      setFiles(nextFiles);
      await writeVersion({
        projectId: current.id,
        n,
        files: nextFiles,
        summary: `Edited ${path} by hand.`,
        prompt: `(hand edit) ${path}`,
        agentSlug: current.agentSlug,
      });
      const next = await saveProject({ ...current, head: n, seq: n });
      setProject(next);
      setVersions(await listVersions(current.id));
      setFailure(null);
    },
    [files],
  );

  const deploy = useCallback(
    async (intent: DeployIntent) => {
      const current = projectRef.current;
      if (!current) return;
      setDeploying(true);
      setDeployNote(null);
      try {
        if (intent === 'publish') {
          const versionId = current.deployedVersionId;
          if (!current.deployedAppId || !versionId) throw new Error('Create the app first.');
          await publishApp(current.deployedAppId, versionId);
          setDeployNote('Published. It is in the workspace Library now.');
          return;
        }
        const blocking = projectProblems(files);
        if (blocking.length) throw new Error(blocking.join(' '));
        const payload = buildPayload({ title: current.title, entry: current.entry, files });
        const result = current.deployedAppId && intent === 'version'
          ? await pushVersion(current.deployedAppId, payload)
          : await createApp(payload);
        const next = await saveProject({
          ...current,
          deployedAppId: result.appId,
          deployedVersion: result.versionNumber,
          deployedVersionId: result.versionId,
        });
        setProject(next);
        setDeployNote(
          intent === 'version'
            ? `Pushed v${result.versionNumber}. Still private until you publish.`
            : `Created, private. Publish it to put it in the Library.`,
        );
      } catch (err) {
        setDeployNote(`Deploy failed: ${describe(err)}`);
      } finally {
        setDeploying(false);
      }
    },
    [files],
  );

  const viewChanges = useCallback(
    async (n: number) => {
      const current = projectRef.current;
      if (!current) return;
      const order = versions.map(v => v.n).sort((a, b) => a - b);
      const before = order.filter(v => v < n).pop();
      setInspecting({
        n,
        files: await readVersionFiles(current.id, n),
        previous: before ? await readVersionFiles(current.id, before) : null,
      });
      setDiffSignal(x => x + 1);
      setTab('code');
    },
    [versions],
  );

  const onPreviewError = useCallback((error: RuntimeError | null) => setFailure(error), []);
  const onPick = useCallback((description: string) => {
    setDraft(current => (current ? `${current} ${description}` : `Change ${description}: `));
    setTab('preview');
  }, []);

  const removeProject = useCallback(async (target: StudioProject) => {
    await deleteProject(target.id).catch(() => {});
    setProjects(await listProjects().catch(() => []));
  }, []);

  const agentName = useMemo(
    () => agents.find(a => a.slug === agentSlug)?.name ?? agentSlug,
    [agents, agentSlug],
  );

  if (!project) {
    return (
      <div className="grid h-full min-h-0 grid-rows-[auto_1fr]">
        <header
          className="flex shrink-0 items-center gap-3 px-3 py-2"
          style={{ borderBottom: `1px solid ${c.line}`, background: c.card }}
        >
          <span className="flex items-center gap-1.5">
            <span style={{ color: c.signal }} aria-hidden>
              ✦
            </span>
            <span className="text-[13px] font-medium" style={{ color: c.text }}>
              Studio
            </span>
          </span>

          <nav className="ml-3 flex items-center gap-0.5 rounded p-0.5" style={{ background: c.paper }}>
            {([
              ['new', 'New app'],
              ['apps', 'My apps'],
            ] as Array<[Lobby, string]>).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setLobby(id)}
                className="rounded px-2.5 py-1 text-[11.5px] transition-colors"
                style={{
                  fontFamily: mono,
                  background: lobby === id ? c.card : 'transparent',
                  color: lobby === id ? c.text : c.graphite,
                  ...(lobby === id ? { border: `1px solid ${c.line}` } : {}),
                }}
              >
                {label}
              </button>
            ))}
          </nav>

          {projects.length > 0 ? (
            <span className="ml-auto text-[11px]" style={{ fontFamily: mono, color: c.mute }}>
              {projects.length} app{projects.length === 1 ? '' : 's'}
            </span>
          ) : null}
        </header>

        <div className="min-h-0">
          {lobby === 'new' ? (
            <StudioHome
              projects={projects}
              agents={agents}
              agentSlug={agentSlug}
              onAgent={setAgentSlug}
              onStart={intent => void start(intent)}
              onOpen={p => void openProject(p)}
              onSeeAll={() => setLobby('apps')}
              loading={loadingProjects}
              error={homeError ?? agentsNote}
            />
          ) : (
            <StudioApps
              projects={projects}
              loading={loadingProjects}
              onOpen={p => void openProject(p)}
              onDelete={p => void removeProject(p)}
              onNew={() => setLobby('new')}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr]">
      <header
        className="flex shrink-0 items-center gap-3 px-3 py-2"
        style={{ borderBottom: `1px solid ${c.line}`, background: c.card }}
      >
        <button
          onClick={() => {
            watcher.current?.abort();
            setProject(null);
            setRunning(null);
          }}
          className="rounded px-2 py-1 text-[11px]"
          style={{ fontFamily: mono, color: c.graphite, border: `1px solid ${c.line}` }}
        >
          ← Projects
        </button>

        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium" style={{ color: c.text }}>
            {project.title}
          </div>
          <div className="text-[10.5px]" style={{ fontFamily: mono, color: c.mute }}>
            v{project.head} · {files.length} file{files.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {failure && !running ? (
            <button
              onClick={fixIt}
              className="rounded px-2.5 py-1.5 text-[11.5px]"
              style={{ fontFamily: mono, background: c.attention, color: c.paper }}
            >
              Ask {agentName} to fix it
            </button>
          ) : null}

          <AgentPicker
            agents={agents}
            value={agentSlug}
            onChange={slug => {
              setAgentSlug(slug);
              void saveProject({ ...project, agentSlug: slug }).then(setProject);
            }}
          />

          <nav className="flex items-center gap-0.5 rounded p-0.5" style={{ background: c.paper }}>
            {(['preview', 'code', 'versions'] as Tab[]).map(id => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className="rounded px-2.5 py-1 text-[11px] capitalize transition-colors"
                style={{
                  fontFamily: mono,
                  background: tab === id ? c.card : 'transparent',
                  color: tab === id ? c.text : c.graphite,
                  ...(tab === id ? { border: `1px solid ${c.line}` } : {}),
                }}
              >
                {id}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[360px_1fr]">
        <div className="min-h-0" style={{ borderRight: `1px solid ${c.line}` }}>
          <StudioTimeline
            turns={project.turns}
            running={running}
            agentName={agentName}
            draft={draft}
            onDraft={setDraft}
            onSend={send}
            onStop={() => watcher.current?.abort()}
            canRestore={!running}
            onRestore={n => void restore(n)}
            onViewChanges={n => void viewChanges(n)}
          />
        </div>

        <div className="relative min-h-0" style={{ background: c.card }}>
          {/*
            Every pane stays MOUNTED; only visibility changes. Unmounting the
            preview would restart the generated app on every glance at its code
            — losing whatever state the user was in the middle of demonstrating
            — and would stop it reporting whether the current build even runs,
            which is what the "fix it" button keys off.
          */}
          <Pane show={tab === 'preview'}>
            <StudioPreview
              files={files}
              entry={project.entry}
              busy={Boolean(running)}
              missingFiles={missingFiles}
              onError={onPreviewError}
              onPick={onPick}
            />
          </Pane>
          <Pane show={tab === 'code'}>
            <StudioCode
              files={inspecting ? inspecting.files : files}
              previous={inspecting ? inspecting.previous : previousFiles}
              // Editing an old version would write it forward as a new head,
              // which is not what "view changes" asked for.
              readOnly={Boolean(running) || Boolean(inspecting)}
              diffSignal={diffSignal}
              inspectingVersion={inspecting && inspecting.n !== project.head ? inspecting.n : null}
              headVersion={project.head}
              onExitInspect={() => setInspecting(null)}
              onEdit={(path, content) => void editFile(path, content)}
            />
          </Pane>
          <Pane show={tab === 'versions'}>
            <StudioVersions
              project={project}
              versions={versions}
              files={files}
              head={project.head}
              busy={Boolean(running)}
              problems={projectProblems(files)}
              onRestore={n => void restore(n)}
              onDeploy={intent => void deploy(intent)}
              deploying={deploying}
              deployNote={deployNote}
            />
          </Pane>
        </div>
      </div>
    </div>
  );
}

/** Hidden rather than unmounted — see the comment at the call site. */
function Pane({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <div className="absolute inset-0 min-h-0" style={{ visibility: show ? 'visible' : 'hidden' }} aria-hidden={!show}>
      {children}
    </div>
  );
}

/**
 * Reduce a run's tool invocations to what is worth keeping.
 *
 * Consecutive calls to the same tool are collapsed with a count: an agent that
 * writes four files makes four `write` calls, and four identical chips say less
 * than one chip reading "write ×4". The raw invocations also carry whole tool
 * results, which have no place in a record we write to a 64KB row.
 */
function summariseActions(invocations: Invocation[]): TurnAction[] {
  const out: TurnAction[] = [];
  for (const invocation of invocations) {
    const name = String(invocation.toolName ?? 'tool');
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

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
