import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as accordion from '../components/ui/accordion';
import * as alert from '../components/ui/alert';
import * as avatar from '../components/ui/avatar';
import * as badge from '../components/ui/badge';
import * as button from '../components/ui/button';
import * as card from '../components/ui/card';
import * as checkbox from '../components/ui/checkbox';
import * as dialog from '../components/ui/dialog';
import * as dropdownMenu from '../components/ui/dropdown-menu';
import * as input from '../components/ui/input';
import * as label from '../components/ui/label';
import * as lucide from 'lucide-react';
import * as popover from '../components/ui/popover';
import * as progress from '../components/ui/progress';
import * as scrollArea from '../components/ui/scroll-area';
import * as select from '../components/ui/select';
import * as separator from '../components/ui/separator';
import * as sheet from '../components/ui/sheet';
import * as skeleton from '../components/ui/skeleton';
import * as switchUi from '../components/ui/switch';
import * as table from '../components/ui/table';
import * as tabs from '../components/ui/tabs';
import * as textarea from '../components/ui/textarea';
import * as tooltip from '../components/ui/tooltip';
import { clsx } from 'clsx';
import { cn } from './utils';
import { cva } from 'class-variance-authority';
import { spaces, storage, xyne } from './xyne';
import { twMerge } from 'tailwind-merge';

/* ---- from lib/studioProtocol.ts --------------------------------------- */
/**
 * The contract between Studio and a Claw agent.
 *
 * Claw has a `create-app` tool that writes a real project — and we cannot use
 * it. Every run an app starts carries a conversation id prefixed `app_`
 * (xyne-claw-auth artifact-app-agents.ts:88), and the runtime strips create-app
 * from any run whose id looks like that (xyne-claw run.ts:3272 — the
 * "self-replication ban"). Even if it were reachable, the tool returns only a
 * manifest: the files themselves go to GCS behind an S2S key an app never
 * holds, so we would generate an app we could not read, let alone preview.
 *
 * So Studio imposes its own wire format instead: fenced blocks tagged with a
 * path. It costs one paragraph of prompt, works with ANY of the 214 agents in
 * the workspace rather than the handful configured with create-app, and hands
 * us the file contents — which is what a live preview needs anyway.
 *
 * The format is deliberately the one models already produce unprompted. We are
 * pinning down a habit, not teaching a syntax, which is why a plain agent with
 * no Studio-specific training gets it right first time.
 */

export type StudioFile = { path: string; content: string };

/** Everything a run's text yielded. */
export type ParsedReply = {
  files: StudioFile[];
  /** A short name for the app, when the agent gave one. */
  title?: string;
  /** Paths the agent asked to remove — an update can't express absence otherwise. */
  deleted: string[];
  /** One line describing the turn, shown in the timeline. */
  summary: string;
  /** Prose outside the fences. Kept so a refusal or a question is never swallowed. */
  prose: string;
};

const ALLOWED_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.css', '.json'];

/** The server's own ceilings (react-artifact tools.ts:40-46). Checked here so an
 *  oversized project fails while the user can still ask for a smaller one,
 *  rather than as a raw 400 at deploy time. */
export const MAX_FILE_BYTES = 64 * 1024;
export const MAX_TOTAL_BYTES = 256 * 1024;
export const MAX_FILES = 20;

function bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Publish-blocking problems with a whole project. Empty when it would upload. */
export function projectProblems(files: StudioFile[]): string[] {
  const problems: string[] = [];
  if (files.length > MAX_FILES) problems.push(`${files.length} files; the limit is ${MAX_FILES}.`);
  let total = 0;
  for (const file of files) {
    const size = bytes(file.content);
    total += size;
    if (size > MAX_FILE_BYTES) {
      problems.push(`${file.path} is ${(size / 1024).toFixed(1)} KB; the per-file limit is 64 KB.`);
    }
  }
  if (total > MAX_TOTAL_BYTES) {
    problems.push(`The project is ${(total / 1024).toFixed(0)} KB; the limit is 256 KB.`);
  }
  return problems;
}

/**
 * An opening fence.
 *
 * `path=` may sit anywhere in the info string and be followed by other tokens:
 * models write ```tsx path=/App.tsx showLineNumbers as readily as the bare
 * form, and requiring the path to be the last thing on the line meant the whole
 * file was silently treated as prose and dropped. Captures the fence run so the
 * closing fence can be matched at the same length or longer.
 */
const OPEN_FENCE = /^\s*(`{3,})\s*([A-Za-z0-9+#-]*)[^\n]*?\bpath\s*=\s*["']?([^\s"'`]+)["']?/;

/** A deletion line. Trailing text is tolerated for the same reason. */
const DELETE_LINE = /^\s*(?:DELETE|REMOVE)\s*:\s*(\S+)/;

/** Mirrors the server validator, so a file we accept is one that could publish. */
export function validatePath(path: string): string | null {
  if (!path.startsWith('/')) return 'must start with "/"';
  if (path.includes('..') || path.includes('//') || path.includes('\\')) return 'has an illegal segment';
  if (!/^\/[\w./-]+$/.test(path)) return 'has characters outside letters, digits, _ - . /';
  // Prefix tests need a boundary. A bare startsWith('/lib/utils') also rejects
  // a perfectly legal /lib/utilsFormat.ts, which the server would have accepted.
  const reserved = ['/components/ui/', '/public/'];
  const reservedFiles = ['/lib/utils', '/lib/xyne-data'];
  if (reserved.some(prefix => path.startsWith(prefix))) return 'is reserved — the host provides it';
  if (reservedFiles.some(base => path === base || path.startsWith(`${base}.`))) {
    return 'is reserved — the host provides it';
  }
  if (!ALLOWED_EXTENSIONS.some(ext => path.toLowerCase().endsWith(ext))) {
    return `must end with one of ${ALLOWED_EXTENSIONS.join(', ')}`;
  }
  return null;
}

/**
 * Pull files out of an agent's reply.
 *
 * Line-based rather than one regex over the whole body: generated code contains
 * backticks (template literals, markdown in strings) often enough that a lazy
 * `[\s\S]*?` fence match truncates real files mid-way. Scanning line by line and
 * closing only on a line that is nothing but a fence is what makes this hold up
 * on real output.
 */
export function parseReply(text: string): ParsedReply {
  const files: StudioFile[] = [];
  const deleted: string[] = [];
  const prose: string[] = [];
  // Normalise CRLF here rather than per-file: a reply with Windows endings
  // would otherwise bake a \r into the end of every stored line, which then
  // shows up in the editor and in anything the code emits.
  const lines = (text ?? '').replace(/\r\n?/g, '\n').split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const open = OPEN_FENCE.exec(line);
    if (!open) {
      const del = DELETE_LINE.exec(line);
      if (del) deleted.push(normalizePath(del[1]));
      else prose.push(line);
      i += 1;
      continue;
    }

    // The closing fence must be AT LEAST as long as the opening one. Without
    // this, a file containing a bare ``` line — a template literal holding
    // markdown, a code sample in a string — closes early and the rest of the
    // file is silently dropped. Models emit exactly that often enough that it
    // is the single most damaging thing this parser can get wrong.
    const fenceLength = open[1].length;
    const closes = (candidate: string): boolean => {
      const match = /^\s*(`{3,})\s*$/.exec(candidate);
      return match !== null && match[1].length >= fenceLength;
    };

    const path = normalizePath(open[3]);
    const body: string[] = [];
    i += 1;
    while (i < lines.length && !closes(lines[i])) {
      body.push(lines[i]);
      i += 1;
    }
    i += 1; // consume the closing fence

    const problem = validatePath(path);
    if (problem) prose.push(`(skipped ${path}: ${problem})`);
    else files.push({ path, content: body.join('\n') });
  }

  const outside = prose.join('\n').trim();
  const summaryLine = /^\s*SUMMARY\s*:\s*(.+\S)\s*$/im.exec(outside);
  const summary = summaryLine
    ? summaryLine[1].trim()
    : firstSentence(outside) || describeChange(files, deleted);

  // A name the agent chose beats one derived from the prompt. "Tip Calculator"
  // is what someone scans a list for; "tip calculator: a bill amount input, a
  // tip perc…" is the request they typed, truncated, and it makes two similar
  // drafts indistinguishable at a glance.
  const titleLine = /^\s*TITLE\s*:\s*(.+\S)\s*$/im.exec(outside);
  const title = titleLine ? titleLine[1].trim().replace(/^["']|["']$/g, '').slice(0, 48) : undefined;

  return {
    files,
    deleted,
    summary,
    ...(title ? { title } : {}),
    prose: outside.replace(/^\s*(SUMMARY|TITLE)\s*:.*$/gim, '').trim(),
  };
}

function normalizePath(raw: string): string {
  const clean = raw.trim().replace(/^\.\//, '/');
  return clean.startsWith('/') ? clean : `/${clean}`;
}

function firstSentence(text: string): string {
  const trimmed = text.split('\n').map(l => l.trim()).filter(Boolean)[0] ?? '';
  if (!trimmed || trimmed.length > 160) return '';
  return trimmed.replace(/^[#*\-\s]+/, '');
}

function describeChange(files: StudioFile[], deleted: string[]): string {
  const parts: string[] = [];
  if (files.length) parts.push(`${files.length} file${files.length === 1 ? '' : 's'}`);
  if (deleted.length) parts.push(`${deleted.length} removed`);
  return parts.length ? `Updated ${parts.join(', ')}.` : 'No files in this reply.';
}

/**
 * Apply a reply onto the current file set. Replace by path, then delete.
 *
 * A deletion that would remove the entry is refused rather than honoured: the
 * result would be a project that cannot render, reported as a runtime error
 * pointing at a file that no longer exists. An agent that genuinely means to
 * replace the entry sends it as a file in the same reply, which is applied
 * after the deletions and therefore survives.
 */
export function applyReply(base: StudioFile[], reply: ParsedReply, entry = '/App.tsx'): StudioFile[] {
  const byPath = new Map(base.map(f => [f.path, f]));
  for (const path of reply.deleted) byPath.delete(path);
  for (const file of reply.files) byPath.set(file.path, file);
  if (!byPath.has(entry) && base.some(f => f.path === entry)) {
    const original = base.find(f => f.path === entry);
    if (original) byPath.set(entry, original);
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * What the runtime gives generated code.
 *
 * Every entry here is real: shadcn and `cn` are injected by the host into any
 * published app, `lucide-react` and the radix packages are in the sandbox's
 * BASE_DEPENDENCIES (shadcnPreamble.generated.ts:74) so they need no manifest
 * entry, and `xyne` is Studio's own data layer handed through. Nothing in this
 * list is aspirational — the module registry in lib/studioRuntime.ts resolves
 * each one, and anything outside it fails with a named error rather than a
 * blank screen.
 */
export const RUNTIME_NOTES = `AVAILABLE IMPORTS (nothing else resolves):
  react                        — hooks, all of React 18
  lucide-react                 — icons, e.g. import { Search } from 'lucide-react'
  ./components/ui/<name>       — shadcn/ui, already installed. Available:
                                 accordion alert avatar badge button card checkbox dialog
                                 dropdown-menu input label popover progress scroll-area select
                                 separator sheet skeleton switch table tabs textarea tooltip
  ./lib/utils                  — { cn } for class merging
  clsx · tailwind-merge · class-variance-authority
  xyne                         — LIVE WORKSPACE DATA, in the Studio preview.
                                 const { spaces, storage } = await xyne();
                                 spaces.search.query · spaces.tickets · spaces.channels ·
                                 spaces.conversations · spaces.messages · spaces.users ·
                                 spaces.projects · spaces.boards · spaces.activities ·
                                 spaces.workspace · spaces.claw
                                 storage.collection('name').put/get/list  (per-app KV)
                                 Every call runs as the person using the app, under their
                                 own permissions. Use it — an app showing real tickets beats
                                 an app showing placeholder ones. Note: this module exists in
                                 the Studio preview. An app meant to be DEPLOYED should seed
                                 its own data instead.

STYLING: Tailwind utility classes, compiled at runtime. Any class works.
NO OTHER PACKAGES. No react-router, no framer-motion, no recharts, no axios.
NO shadcn component outside the list above — there is no slider, no toast, no sonner, no form, no chart.
  Build those from plain elements: a range slider is <input type="range">.

NEVER USE TOP-LEVEL AWAIT. Each file is evaluated as a synchronous module, so
  \`const { spaces } = await xyne();\` at the top of a file is a syntax error.
  Always await inside an effect or a handler:
    useEffect(() => { (async () => { const { spaces } = await xyne(); ... })(); }, []);

DO NOT USE TOOLS. Do not read, write, or list files, and do not open a sandbox.
  Your REPLY is the deliverable — the code goes in the fenced blocks and nowhere
  else. Writing files to a workspace produces nothing the user can see and turns
  a 30-second turn into a five-minute one.`;

const FORMAT = `OUTPUT FORMAT — this is not optional, and prose outside it is ignored.

Emit each file as a fenced block whose info string is the language, a space, then path=<absolute path>:

\`\`\`tsx path=/App.tsx
export default function App() { return <div>hi</div>; }
\`\`\`

RULES
- Paths are absolute from the app root: /App.tsx, /components/Board.tsx, /lib/data.ts.
- /App.tsx must exist and must have a DEFAULT export — it is the root component.
- Imports between your own files are RELATIVE: import { Board } from './components/Board'.
- Allowed extensions: .tsx .ts .jsx .js .css .json
- Never write /components/ui/*, /lib/utils or /public/* — the host provides those.
- Close every fence with a line containing only backticks.
- End with exactly two lines:
    TITLE: <the app's name, 2-4 words, title case — e.g. "Tip Calculator">
    SUMMARY: <what you changed, one sentence>`;

/** The task string for the first turn of a project. */
export function buildCreateTask(intent: string): string {
  return `You are the build agent for Xyne Studio. You write small React apps that run inside Xyne Spaces.

${FORMAT}

${RUNTIME_NOTES}

QUALITY BAR
- Ship something that looks considered, not a wireframe: real spacing, a clear hierarchy, states for empty and loading.
- Keep each file under 60KB and the project under 12 files.
- No placeholder TODOs. If you seed data, seed it plausibly.

BUILD THIS:
${intent}`;
}

/**
 * The task string for a followup.
 *
 * The current files are replayed in full every turn even though the agent has
 * real conversational memory (verified: a value set in one run is recalled in
 * the next when both carry the same conversationId). Memory alone is not enough
 * here — the user can restore an old version, or edit code by hand, and then
 * what the agent remembers writing is no longer what is on screen. Sending the
 * files makes the code in the editor the single source of truth, and a wrong
 * followup impossible rather than merely unlikely.
 */
export function buildFollowupTask(intent: string, files: StudioFile[]): string {
  const current = files
    .map(f => `\`\`\`${langFor(f.path)} path=${f.path}\n${f.content}\n\`\`\``)
    .join('\n\n');

  return `Continue building this Xyne Studio app.

THE APP AS IT STANDS RIGHT NOW — this is the truth, ahead of anything you remember writing:

${current}

${FORMAT}

Emit ONLY the files you changed or added. To remove a file, put \`DELETE: /path/to/file.tsx\` on its own line.

${RUNTIME_NOTES}

THE CHANGE:
${intent}`;
}

/** A repair turn: the preview threw, and the agent gets the stack back. */
export function buildFixTask(error: string, files: StudioFile[]): string {
  return buildFollowupTask(
    `The app failed to run. Fix it.

ERROR:
${error.slice(0, 3000)}

Change as little as possible — repair the fault, don't redesign. If the cause is an import of something not in the AVAILABLE IMPORTS list, replace it with something that is.`,
    files,
  );
}

export function langFor(path: string): string {
  if (path.endsWith('.tsx')) return 'tsx';
  if (path.endsWith('.ts')) return 'ts';
  if (path.endsWith('.jsx')) return 'jsx';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.json')) return 'json';
  return 'js';
}

/* ---- from lib/studioHost.ts ------------------------------------------- */
/**
 * The module graph a generated app is allowed to import.
 *
 * A generated app is not bundled — it is transpiled and evaluated inside this
 * document (see lib/studioRuntime.ts), so `import` has to resolve against
 * something we hold in hand. This is that something: real module objects, the
 * same ones Studio itself renders with.
 *
 * Two consequences worth stating, because they are the point rather than a
 * side effect:
 *
 *  - Generated code shares OUR React. There is no second copy, so hooks work
 *    and a preview can hand components back across the boundary.
 *  - `xyne` is the live data layer. An app generated here can read the viewer's
 *    real tickets, channels and search results in the preview, before it has
 *    been saved anywhere. That is the difference between a mockup and a thing.
 *
 * Everything here already exists in a published Space: shadcn/ui and `cn` are
 * injected by the host, and lucide/clsx/cva/tailwind-merge are in the sandbox's
 * BASE_DEPENDENCIES, so none of it needs a manifest entry.
 */



/** Bare specifiers. */
const PACKAGES: Record<string, unknown> = {
  react: React,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
  'lucide-react': lucide,
  clsx: { clsx, default: clsx },
  'tailwind-merge': { twMerge, default: twMerge },
  'class-variance-authority': { cva },
  xyne: { xyne, spaces, storage, default: xyne },
};

/** Host-provided paths. Keyed without extension; the resolver strips them. */
const PROVIDED: Record<string, unknown> = {
  '/lib/utils': { cn },
  '/components/ui/accordion': accordion,
  '/components/ui/alert': alert,
  '/components/ui/avatar': avatar,
  '/components/ui/badge': badge,
  '/components/ui/button': button,
  '/components/ui/card': card,
  '/components/ui/checkbox': checkbox,
  '/components/ui/dialog': dialog,
  '/components/ui/dropdown-menu': dropdownMenu,
  '/components/ui/input': input,
  '/components/ui/label': label,
  '/components/ui/popover': popover,
  '/components/ui/progress': progress,
  '/components/ui/scroll-area': scrollArea,
  '/components/ui/select': select,
  '/components/ui/separator': separator,
  '/components/ui/sheet': sheet,
  '/components/ui/skeleton': skeleton,
  '/components/ui/switch': switchUi,
  '/components/ui/table': table,
  '/components/ui/tabs': tabs,
  '/components/ui/textarea': textarea,
  '/components/ui/tooltip': tooltip,
};

/** React itself, injected into every evaluated module for the classic JSX transform. */
export const hostReact = React;

/** Resolve a specifier the host owns, or undefined if the app must provide it. */
export function resolveHostModule(specifier: string, fromDir: string): unknown {
  if (specifier in PACKAGES) return PACKAGES[specifier];

  const absolute = specifier.startsWith('.') ? joinPath(fromDir, specifier) : specifier;
  const bare = absolute.replace(/\.[jt]sx?$/, '');
  return PROVIDED[bare];
}

/** POSIX-ish join for the virtual file tree. No `..` beyond the root. */
export function joinPath(fromDir: string, specifier: string): string {
  const parts = `${fromDir}/${specifier}`.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return `/${out.join('/')}`;
}

/** Names offered to the model, and shown in the UI so the contract is visible. */
export const HOST_MODULE_NAMES = [...Object.keys(PACKAGES), ...Object.keys(PROVIDED)];

/* ---- from lib/studioClaw.ts ------------------------------------------- */
/**
 * Studio's transport to Claw.
 *
 * Not a second copy of lib/chat.ts's wrapper: that one dispatches an agent INTO
 * a Spaces thread and returns when it finishes, which is the right shape for a
 * chat surface and the wrong one here. Studio needs the run's progress while it
 * is happening, a conversation that survives across turns, and the ability to
 * abandon a turn without killing the run. Different job, different module.
 *
 * Three facts this is built on, each verified live against the workspace rather
 * than read off the SDK types:
 *
 *  1. `getRun` returns far more than the SDK declares. The type says
 *     `{ sessionId, status, result?, error? }`; the endpoint actually returns
 *     the whole AgentRun row — `currentToolLabel`, `toolInvocations`,
 *     `reasoning`, `toolsUsed`, token counts, timings. The registry sets no
 *     mapResult on getRun, so the extra fields pass straight through and the
 *     progress UI is free. (Filed for SDK-GAPS.)
 *
 *  2. `result` does NOT stream. It is empty for the whole run and lands whole at
 *     the terminal poll — measured at 0 bytes for 51s, then 4,872 bytes at 66s.
 *     So there is no token-by-token text to show, and a progress UI that
 *     pretends otherwise would be lying. `currentToolLabel` and the invocation
 *     count are the honest signals, and they DO move.
 *
 *  3. Passing our own `conversationId` gives real multi-turn memory. Verified:
 *     a value stated in one run was recalled by a second, separate run carrying
 *     the same id. Nothing in the SDK docs says this. It is what makes followups
 *     a conversation rather than a series of strangers.
 */

export type StudioAgent = {
  slug: string;
  name: string;
  description: string;
  color?: string;
  isDefault?: boolean;
};

/** One tool call, as the runtime records it. Shape is loose by necessity. */
export type Invocation = { toolName?: string; args?: unknown; result?: unknown; status?: string };

/** What a poll can tell us. Everything optional — a run in flight has almost none of it. */
export type RunProgress = {
  status: string;
  label: string | null;
  invocations: Invocation[];
  reasoning: string;
  result: string;
  error: string | null;
  /** Wall-clock since dispatch, seconds. The only number that always moves. */
  elapsedS: number;
  tokensOut?: number;
};

const TERMINAL = ['completed', 'failed', 'cancelled', 'canceled', 'error'];

export function isTerminal(status: string): boolean {
  return TERMINAL.includes(status);
}

/**
 * The agent roster.
 *
 * 214 agents in this workspace, many of them one-off copies sharing a display
 * name, so dedupe on slug and put the ones that can actually build an app in
 * front. The rest stay reachable — an agent that knows a codebase writes a
 * better app about that codebase than a generalist does.
 */
export async function listStudioAgents(): Promise<StudioAgent[]> {
  const { spaces } = await xyne();
  const raw = (await spaces.claw.listAgents()) as unknown as Array<Record<string, unknown>>;
  const seen = new Set<string>();
  const out: StudioAgent[] = [];
  for (const a of raw) {
    const slug = String(a['slug'] ?? a['id'] ?? '');
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({
      slug,
      name: String(a['name'] ?? slug),
      description: String(a['description'] ?? ''),
      ...(typeof a['color'] === 'string' ? { color: a['color'] } : {}),
      ...(a['isDefault'] === true ? { isDefault: true } : {}),
    });
  }
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/**
 * Generalists first — they follow a format instruction cleanly, which is what
 * this contract lives or dies on.
 *
 * `ask-ai` leads deliberately. It is the workspace assistant the rest of Xyne
 * already routes through, so it is the one people recognise and the one whose
 * behaviour is best understood here.
 */
const PREFERRED = ['ask-ai', 'assistant', 'dictator', 'frontend-engineer', 'fe-autocoder', 'claw'];
function rank(agent: StudioAgent): number {
  const i = PREFERRED.indexOf(agent.slug);
  if (i !== -1) return i;
  return agent.isDefault ? PREFERRED.length : PREFERRED.length + 1;
}

/** The agent Studio starts on, if the workspace has it. */
export function defaultAgent(agents: StudioAgent[]): string {
  return agents.find(a => PREFERRED.includes(a.slug))?.slug ?? agents[0]?.slug ?? 'assistant';
}

export type StartedRun = { sessionId: string };

/**
 * Dispatch a turn.
 *
 * `channelId` is deliberately never passed: supplying one makes the agent post
 * its reply into a real Spaces channel, and a design iteration is not something
 * anyone wants in their workspace feed.
 */
export async function startRun(input: {
  agent: string;
  task: string;
  conversationId: string;
}): Promise<StartedRun> {
  const { spaces } = await xyne();
  const { sessionId } = await spaces.claw.run({
    agent: input.agent,
    task: input.task,
    conversationId: input.conversationId,
  });
  return { sessionId };
}

/** One poll. Widened from the SDK's narrow type — see the header, note 1. */
export async function pollRun(sessionId: string, startedAt: number): Promise<RunProgress> {
  const { spaces } = await xyne();
  const run = (await spaces.claw.getRun(sessionId)) as unknown as Record<string, unknown>;
  const invocations = Array.isArray(run['toolInvocations']) ? (run['toolInvocations'] as Invocation[]) : [];
  return {
    status: String(run['status'] ?? 'running'),
    label: typeof run['currentToolLabel'] === 'string' ? run['currentToolLabel'] : null,
    invocations,
    reasoning: typeof run['reasoning'] === 'string' ? run['reasoning'] : '',
    result: typeof run['result'] === 'string' ? run['result'] : '',
    error: typeof run['error'] === 'string' ? run['error'] : null,
    elapsedS: Math.round((Date.now() - startedAt) / 1000),
    ...(typeof run['tokensOut'] === 'number' ? { tokensOut: run['tokensOut'] } : {}),
  };
}

/**
 * Dispatch and follow a turn to its end.
 *
 * Not `runAndWait`: that helper swallows everything between dispatch and the
 * terminal poll, and everything Studio shows while an agent works lives in
 * exactly that gap. It also throws on timeout while the run keeps going, which
 * would strand a result the user is waiting on.
 *
 * `abort` stops WATCHING, never the run. A user who navigates away and comes
 * back can be handed the finished result, because the session id outlives the
 * component.
 */
export async function runTurn(input: {
  agent: string;
  task: string;
  conversationId: string;
  onProgress: (progress: RunProgress, sessionId: string) => void;
  signal?: AbortSignal;
  /**
   * When the WATCHER gives up. The run itself continues regardless.
   *
   * Fifteen minutes, not the SDK's five: a measured run that reached for its
   * file tools took over 299s before replying, and abandoning a turn that is
   * still working loses nothing but costs the user the result.
   */
  timeoutMs?: number;
}): Promise<RunProgress> {
  const startedAt = Date.now();
  const { sessionId } = await startRun(input);
  const deadline = startedAt + (input.timeoutMs ?? 900_000);

  // Hand the session id back BEFORE the first poll. The caller persists it on
  // the first progress callback, and if every poll then fails — a flaky
  // network, a tab suspended for minutes — the id is already saved and the run
  // can be re-attached to. Reporting it only via a successful poll means a run
  // that dispatched fine becomes permanently unreachable the moment the first
  // read fails.
  input.onProgress(
    { status: 'starting', label: null, invocations: [], reasoning: '', result: '', error: null, elapsedS: 0 },
    sessionId,
  );

  // Sub-second polling would spend requests to learn nothing: the run's own
  // writes are debounced server-side, so nothing changes faster than this.
  const INTERVAL_MS = 1_500;

  for (;;) {
    if (input.signal?.aborted) {
      throw Object.assign(new Error('Stopped watching this run.'), { sessionId, watcherOnly: true });
    }
    await sleep(INTERVAL_MS);

    let progress: RunProgress;
    try {
      progress = await pollRun(sessionId, startedAt);
    } catch (err) {
      // A dropped poll is not a dropped run. Keep trying until the deadline.
      if (Date.now() > deadline) throw Object.assign(err as Error, { sessionId, watcherOnly: true });
      continue;
    }

    input.onProgress(progress, sessionId);
    if (isTerminal(progress.status)) return progress;

    if (Date.now() > deadline) {
      throw Object.assign(new Error('The agent is taking unusually long.'), { sessionId, watcherOnly: true });
    }
  }
}

/** Re-attach to a run started earlier — after a reload, or a surface switch. */
export async function resumeRun(input: {
  sessionId: string;
  startedAt: number;
  onProgress: (progress: RunProgress, sessionId: string) => void;
  signal?: AbortSignal;
}): Promise<RunProgress> {
  for (;;) {
    if (input.signal?.aborted) {
      throw Object.assign(new Error('Stopped watching this run.'), { watcherOnly: true });
    }
    const progress = await pollRun(input.sessionId, input.startedAt);
    input.onProgress(progress, input.sessionId);
    if (isTerminal(progress.status)) return progress;
    await sleep(1_500);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ---- from lib/studioDeploy.ts ----------------------------------------- */
/**
 * Turning a Studio project into a real Xyne app.
 *
 * The route is the same one `spaces app publish` uses. The CLI's own module
 * (@xyne/spaces-cli/dist/claw.js) notes that artifact-apps is "one of the few
 * claw-auth routers mounted WITHOUT the access-token barrier" — it takes plain
 * cookie auth, forwarded to Spaces /api/auth/me. Published, our fetch shim
 * tunnels /claw/* to the host, which performs it same-origin as the signed-in
 * viewer. So an app can create an app, with no new credential.
 *
 * That is NOT the self-replication ban being circumvented. The ban stops an
 * app's AGENT from calling the create-app tool, because an agent that can spawn
 * an agent is an unkillable chain. This is a person clicking a button. Different
 * mechanism, different risk, and the ban's own comment scopes itself to the
 * former.
 *
 * TWO PROPERTIES THAT SHAPE THE UI, both load-bearing:
 *
 *  1. THERE IS NO DELETE. The router exposes create, version, publish,
 *     unpublish and restore — and nothing that removes an app. `unpublish` only
 *     makes a published app private again; the row survives forever. So Studio
 *     creates UNPUBLISHED and never publishes without a second, explicit act,
 *     and says so in the UI rather than only in a comment.
 *
 *  2. IT RUNS AS THE VIEWER. Anyone who opens Studio and deploys creates a row
 *     under their own identity, in their own workspace.
 *
 * Local dev cannot reach any of this: claw-auth wants a session cookie, and a
 * dev server has only a bearer token — verified, /artifact-apps answers 401
 * there. `canDeploy()` is that check, not a feature flag.
 */

const API = '/claw/api/v1/artifact-apps';

export type DeployPayload = {
  title: string;
  entry: string;
  files: StudioFile[];
  dependencies?: Record<string, string>;
};

export type DeployedApp = { appId: string; versionId: string; versionNumber: number };

/** Only published, where the host tunnels /claw/* with the viewer's cookies. */
export function canDeploy(): boolean {
  return typeof window !== 'undefined' && window.parent !== window;
}

/**
 * Exactly what a deploy would send.
 *
 * Exposed so the UI can show the payload without creating anything — the safe
 * half of the button, and the one to reach for when you want to demonstrate the
 * capability rather than exercise it.
 */
export function buildPayload(input: {
  title: string;
  entry: string;
  files: StudioFile[];
  dependencies?: Record<string, string>;
}): DeployPayload {
  return {
    title: input.title.slice(0, 120),
    entry: input.entry,
    files: input.files,
    ...(input.dependencies && Object.keys(input.dependencies).length
      ? { dependencies: input.dependencies }
      : {}),
  };
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    const error = (body as { error?: string })?.error ?? `HTTP ${res.status}`;
    throw new Error(error);
  }
  return body as T;
}

/** Create the app. Private to the caller until `publish` is called separately. */
export async function createApp(payload: DeployPayload): Promise<DeployedApp> {
  const body = await call<{ app: { id: string; versions: Array<{ id: string; versionNumber: number }> } }>(
    '',
    { method: 'POST', body: JSON.stringify(payload) },
  );
  const version = body.app.versions[0];
  return { appId: body.app.id, versionId: version.id, versionNumber: version.versionNumber };
}

/** Append a version to an app this viewer owns. */
export async function pushVersion(appId: string, payload: DeployPayload): Promise<DeployedApp> {
  const body = await call<{ version: { id: string; versionNumber: number } }>(
    `/${encodeURIComponent(appId)}/versions`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return { appId, versionId: body.version.id, versionNumber: body.version.versionNumber };
}

/** Pin a version and make the app visible to the workspace. Reversible via unpublish. */
export async function publishApp(appId: string, versionId: string): Promise<void> {
  await call(`/${encodeURIComponent(appId)}/publish`, {
    method: 'POST',
    body: JSON.stringify({ versionId }),
  });
}

export async function unpublishApp(appId: string): Promise<void> {
  await call(`/${encodeURIComponent(appId)}/unpublish`, { method: 'POST' });
}

/** Pull an existing app's files — the import half, so Studio can remix. */
export async function pullApp(appId: string, versionId?: string): Promise<{ title: string; entry: string; files: StudioFile[] }> {
  const query = versionId ? `?versionId=${encodeURIComponent(versionId)}` : '';
  return call(`/${encodeURIComponent(appId)}/payload${query}`, { method: 'GET' });
}

export type AppSummary = { id: string; title: string; visibility?: string; ownerName?: string | null };

/** Apps this viewer owns, for the import picker. */
export async function listApps(scope: 'mine' | 'workspace' = 'mine'): Promise<AppSummary[]> {
  const body = await call<{ apps: AppSummary[] }>(`?scope=${scope}`, { method: 'GET' });
  return Array.isArray(body.apps) ? body.apps : [];
}
