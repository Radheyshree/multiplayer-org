/**
 * Studio's memory: projects, versions, and the turns that produced them.
 *
 * App storage is key-addressed only — no query language, no filtering on
 * values — so everything we need to look things up by is encoded into the key.
 * It also caps a record at 64KB serialized, which rules out "one record per
 * version holding all its files". So a version is split the way the platform
 * itself splits an app: one record per FILE, under a key that carries the
 * project and version number. The version record holds only the manifest.
 *
 * That split is not overhead — it is what makes restore cheap (read one
 * version's files, not the whole history) and what keeps a large generated app
 * from silently failing to save at the moment it finally worked.
 *
 * Scope is `user`. A Studio project is a draft, and a draft is yours until you
 * deploy it; deploying is what makes something workspace-visible, and that goes
 * through the real app API, not through here.
 */
import { xyne } from './xyne';
import type { StudioFile } from './studioProtocol';

const PROJECTS = 'studio.projects';
const VERSIONS = 'studio.versions';
const FILES = 'studio.files';

/** The storage server rejects a page over 100 rather than clamping it. */
const PAGE = 100;
/** Per-record ceiling the service enforces on the serialized value. */
const MAX_RECORD_BYTES = 64 * 1024;

export type TurnStatus = 'running' | 'ok' | 'failed' | 'empty';

/** One tool the agent ran, reduced to what is worth showing and storing. */
export type TurnAction = { name: string; detail?: string };

/**
 * One exchange.
 *
 * Kept on the project rather than re-read from the run, because a run's record
 * is not durable in a form we can rely on: `getRun` answers for a session id,
 * and a reopened project should show what happened without depending on Claw
 * still knowing. Everything the timeline draws — the tools that ran, how long
 * it took, which files moved — is written here when the turn lands, so it
 * survives a reload rather than living only in the progress stream.
 */
export type Turn = {
  id: string;
  prompt: string;
  summary: string;
  status: TurnStatus;
  /** The version this turn produced, when it produced one. */
  version?: number;
  /** Set while running, and kept after, so a run can be re-attached to. */
  sessionId?: string;
  agentSlug: string;
  at: number;
  /** Prose the agent wrote outside the fences — a question, a refusal, a caveat. */
  note?: string;
  error?: string;
  /** Tools the agent ran. Persisted so they are still there after a reload. */
  actions?: TurnAction[];
  /** Files this turn wrote or removed, for the change summary. */
  wrote?: string[];
  removed?: string[];
  /** Wall-clock for the run, in ms. */
  durationMs?: number;
};

export type StudioProject = {
  id: string;
  title: string;
  /** The first prompt. Kept verbatim — it is what the project IS. */
  intent: string;
  agentSlug: string;
  /** Ours, invented at creation. Passing it to every run is what gives followups memory. */
  conversationId: string;
  entry: string;
  head: number;
  /**
   * Highest version number ever ISSUED, which is not the same as `head`.
   *
   * `head` moves backwards when someone restores. If new versions were numbered
   * `head + 1`, restoring to v1 and then making a change would issue a second
   * "v2" on top of the first one's file records — and because records are keyed
   * by index, a shorter v2 would leave the tail of the old one in place and the
   * project would load a chimera of two builds. Issuing from a counter that only
   * ever goes up makes that unrepresentable. Absent on projects created before
   * this existed; `nextVersion` falls back to head for those.
   */
  seq?: number;
  turns: Turn[];
  createdAt: number;
  updatedAt: number;
  /** Set once deployed, so the surface can offer "update" instead of "create". */
  deployedAppId?: string;
  deployedVersion?: number;
  /** The version id publish() needs. Publishing pins a version, not an app. */
  deployedVersionId?: string;
};

export type VersionMeta = {
  n: number;
  summary: string;
  prompt: string;
  agentSlug: string;
  sessionId?: string;
  paths: string[];
  at: number;
};

function newId(prefix: string): string {
  return `${prefix}${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/** Zero-padded so a lexicographic key listing is also chronological. */
function pad(n: number): string {
  return String(n).padStart(4, '0');
}

/** Turns count into a compact history cap: keep the shape, drop the middle. */
const MAX_TURNS = 60;

export async function listProjects(): Promise<StudioProject[]> {
  const { storage } = await xyne();
  const shelf = storage.collection<StudioProject>(PROJECTS);
  const out: StudioProject[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { records, hasMore } = await shelf.list({ scope: 'any', limit: PAGE, offset });
    out.push(...records.map(r => r.value).filter(p => p && p.id));
    if (!hasMore || records.length === 0 || offset > 2000) break;
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<StudioProject | null> {
  const { storage } = await xyne();
  const rec = await storage.collection<StudioProject>(PROJECTS).get(id, { scope: 'any' });
  return rec?.value ?? null;
}

export async function saveProject(project: StudioProject): Promise<StudioProject> {
  const { storage } = await xyne();
  const next: StudioProject = {
    ...project,
    turns: project.turns.slice(-MAX_TURNS),
    updatedAt: Date.now(),
  };
  await storage.collection<StudioProject>(PROJECTS).put(next.id, next, { scope: 'user' });
  return next;
}

export async function createProject(input: {
  title: string;
  intent: string;
  agentSlug: string;
}): Promise<StudioProject> {
  const project: StudioProject = {
    id: newId('sp'),
    title: input.title,
    intent: input.intent,
    agentSlug: input.agentSlug,
    // Ours to invent, and the whole reason followups have context. Prefixed so
    // it is identifiable in a claw log as something Studio started.
    conversationId: `studio-${newId('c')}`,
    entry: '/App.tsx',
    head: 0,
    seq: 0,
    turns: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return saveProject(project);
}

/** The next version number to issue. Monotonic — see StudioProject.seq. */
export function nextVersion(project: StudioProject): number {
  return Math.max(project.seq ?? 0, project.head) + 1;
}

export async function deleteProject(id: string): Promise<void> {
  const { storage } = await xyne();
  // Versions and files are keyed by project, so a prefix listing finds every
  // orphan. Storage has no cascade — leaving them would be a slow leak.
  const versions = await listVersions(id);
  for (const version of versions) {
    await removeVersionFiles(id, version.n);
    await storage.collection(VERSIONS).remove(`${id}.${pad(version.n)}`, { scope: 'user' }).catch(() => {});
  }
  await storage.collection(PROJECTS).remove(id, { scope: 'user' }).catch(() => {});
}

export async function listVersions(projectId: string): Promise<VersionMeta[]> {
  const { storage } = await xyne();
  const shelf = storage.collection<VersionMeta>(VERSIONS);
  const out: VersionMeta[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { records, hasMore } = await shelf.list({
      scope: 'any',
      prefix: `${projectId}.`,
      limit: PAGE,
      offset,
    });
    out.push(...records.map(r => r.value).filter(Boolean));
    if (!hasMore || records.length === 0 || offset > 2000) break;
  }
  return out.sort((a, b) => b.n - a.n);
}

export async function readVersionFiles(projectId: string, n: number): Promise<StudioFile[]> {
  const { storage } = await xyne();
  const shelf = storage.collection<StudioFile>(FILES);
  const out: StudioFile[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { records, hasMore } = await shelf.list({
      scope: 'any',
      prefix: `${projectId}.${pad(n)}.`,
      limit: PAGE,
      offset,
    });
    out.push(...records.map(r => r.value).filter(f => f && f.path));
    if (!hasMore || records.length === 0) break;
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Files too big to store, reported rather than dropped. */
export type SaveVersionResult = { version: VersionMeta; rejected: Array<{ path: string; bytes: number }> };

export async function writeVersion(input: {
  projectId: string;
  n: number;
  files: StudioFile[];
  summary: string;
  prompt: string;
  agentSlug: string;
  sessionId?: string;
}): Promise<SaveVersionResult> {
  const { storage } = await xyne();
  const shelf = storage.collection<StudioFile>(FILES);

  // Clear the slot before writing it. Version numbers are monotonic so this
  // should be empty, but a retried or interrupted write is exactly when stale
  // records at the same indices would otherwise survive and be read back as
  // part of this build.
  await removeVersionFiles(input.projectId, input.n);

  const rejected: Array<{ path: string; bytes: number }> = [];
  const kept: StudioFile[] = [];
  for (const file of input.files) {
    const bytes = new TextEncoder().encode(JSON.stringify(file)).length;
    if (bytes > MAX_RECORD_BYTES) rejected.push({ path: file.path, bytes });
    else kept.push(file);
  }

  await Promise.all(
    kept.map((file, i) =>
      shelf.put(`${input.projectId}.${pad(input.n)}.${pad(i)}`, file, { scope: 'user' }),
    ),
  );

  const version: VersionMeta = {
    n: input.n,
    // Both are model- or user-authored and unbounded; the manifest shares the
    // same 64KB record cap as everything else, and a version that cannot be
    // written is a version that vanishes.
    summary: input.summary.slice(0, 400),
    prompt: input.prompt.slice(0, 2000),
    agentSlug: input.agentSlug,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    paths: kept.map(f => f.path),
    at: Date.now(),
  };
  await storage
    .collection<VersionMeta>(VERSIONS)
    .put(`${input.projectId}.${pad(input.n)}`, version, { scope: 'user' });

  return { version, rejected };
}

/**
 * Remove a version's file records.
 *
 * Lists what is actually stored rather than deriving keys from the manifest's
 * `paths.length`. The two disagree whenever a write was partial or a version was
 * rewritten, and deriving from the count leaves exactly the records that would
 * later be read back as part of a different build.
 */
async function removeVersionFiles(projectId: string, n: number): Promise<void> {
  const { storage } = await xyne();
  const shelf = storage.collection(FILES);
  const prefix = `${projectId}.${pad(n)}.`;
  const keys: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { records, hasMore } = await shelf.list({ scope: 'any', prefix, limit: PAGE, offset });
    keys.push(...records.map(r => r.key));
    if (!hasMore || records.length === 0) break;
  }
  await Promise.all(keys.map(key => shelf.remove(key, { scope: 'user' }).catch(() => {})));
}

export function makeTurn(input: { prompt: string; agentSlug: string }): Turn {
  return {
    id: newId('t'),
    prompt: input.prompt,
    summary: '',
    status: 'running',
    agentSlug: input.agentSlug,
    at: Date.now(),
  };
}

/** A title from the first prompt — cheap, and better than "Untitled" every time. */
export function titleFrom(intent: string): string {
  const line = intent.trim().split('\n')[0] ?? '';
  const stripped = line
    .replace(/^(build|make|create|write|design)\s+(me\s+)?(an?\s+)?/i, '')
    .replace(/[.?!]+$/, '')
    .trim();
  const title = stripped || line || 'Untitled app';
  return title.length > 48 ? `${title.slice(0, 47)}…` : title.charAt(0).toUpperCase() + title.slice(1);
}
