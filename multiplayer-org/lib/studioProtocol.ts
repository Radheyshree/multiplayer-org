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
                                 import { xyne } from 'xyne';
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
