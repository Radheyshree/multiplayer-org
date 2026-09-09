/**
 * Run generated code, in this document, right now.
 *
 * Xyne's own app preview is Sandpack: a bundler iframe served from
 * codesandbox.io that npm-installs the project and serves it back. That is the
 * correct choice for the dashboard and the wrong one for us, because we are
 * ALREADY inside that iframe — a published Space app is rendered by exactly
 * that pipeline. Nesting a second bundler inside the first would mean a second
 * npm install and a second cold boot on every keystroke of iteration.
 *
 * So Studio transpiles with Sucrase and evaluates the module graph here. What
 * that buys, and why it is worth the loss of process isolation:
 *
 *  - Refresh is sub-100ms, not seconds. Iteration is the entire product.
 *  - Tailwind already works. `@tailwindcss/browser` is in the sandbox's base
 *    dependencies and compiles classes off DOM mutations, so a class the
 *    generated app invents is styled the moment it mounts. An isolated iframe
 *    would need its own Tailwind and its own copy of the theme.
 *  - One React instance, so no duplicate-copy hook failures.
 *  - The app can reach the real SDK (lib/studioHost.ts) without a bridge.
 *
 * `new Function` is not a new capability being claimed: the CodeSandbox bundler
 * evaluates our own module graph in this same document to run us at all, so
 * eval-class execution is already permitted here. Electron's CSP injector only
 * targets FRONTEND_URL (request-interceptor.ts:248) and never reaches this
 * document.
 *
 * The trade is isolation. Generated code CAN reach into Studio's DOM. That is
 * acceptable for code the viewer just asked an agent to write and is watching
 * run. The store's workspace section (components/WorkspaceApps.tsx) runs
 * OTHER people's published apps through this same runtime, and that is a
 * considered extension rather than drift: publishing to the workspace has
 * always meant members run your code with their own access — the official
 * Library grants a published app the viewer-scoped data bridge too — so the
 * only delta here is DOM reach into this shell, which holds no secret the
 * bridge does not already grant. The stage is contained and error-bounded,
 * and non-owners are only ever served the pinned published version.
 */
import { transform } from 'sucrase';
import { hostReact, joinPath, resolveHostModule } from './studioHost';
import type { StudioFile } from './studioProtocol';

export type RuntimeError = {
  /** Where it broke: a file path, or a phase like "compile" / "render". */
  where: string;
  message: string;
  stack?: string;
};

/** A module under evaluation. Registered before its body runs, so cycles resolve. */
type Module = { exports: Record<string, unknown> };

const EXTENSIONS = ['', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}

/**
 * Give a host module the shape Sucrase's interop expects.
 *
 * A Vite ESM namespace has no `__esModule`, so `_interopRequireDefault` would
 * wrap it as `{ default: namespace }` and `import React from 'react'` would
 * resolve to the namespace rather than React. Copying into a plain object with
 * the flag set — and a `default` that falls back to the namespace itself —
 * makes default and named imports both land correctly.
 */
function interop(mod: unknown): Record<string, unknown> {
  if (!mod || typeof mod !== 'object') return { __esModule: true, default: mod } as Record<string, unknown>;
  const source = mod as Record<string, unknown>;
  const out: Record<string, unknown> = { __esModule: true };
  for (const key of Object.keys(source)) out[key] = source[key];
  if (!('default' in out)) out['default'] = source;
  return out;
}

/** Sucrase → CommonJS. Errors name the file, because "Unexpected token" alone is useless. */
export function compile(file: StudioFile): string {
  try {
    return transform(file.content, {
      transforms: ['typescript', 'jsx', 'imports'],
      jsxRuntime: 'classic',
      production: true,
      filePath: file.path,
    }).code;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw Object.assign(new Error(`${file.path}: ${message}`), { studioWhere: file.path });
  }
}

export type Evaluated = {
  /** The root component from the entry's default export. */
  Component: unknown;
  /** Stylesheet text from any .css files, already concatenated. */
  css: string;
};

/**
 * Build and evaluate the graph, returning the root component.
 *
 * Throws a RuntimeError-shaped Error on the first failure — Studio catches it
 * and offers the agent the message back, which is what turns a broken build
 * into one more turn of conversation rather than a dead end.
 */
export function evaluateProject(files: StudioFile[], entry = '/App.tsx'): Evaluated {
  const byPath = new Map(files.map(f => [f.path, f]));
  const css = files.filter(f => f.path.endsWith('.css')).map(f => f.content).join('\n\n');
  const modules = new Map<string, Module>();

  function resolve(fromDir: string, specifier: string): string | null {
    const base = specifier.startsWith('.') ? joinPath(fromDir, specifier) : specifier;
    for (const ext of EXTENSIONS) {
      if (byPath.has(`${base}${ext}`)) return `${base}${ext}`;
    }
    return null;
  }

  function load(path: string): Record<string, unknown> {
    const existing = modules.get(path);
    if (existing) return existing.exports;

    const file = byPath.get(path);
    if (!file) throw new Error(`Cannot find module "${path}"`);

    const mod: Module = { exports: {} };
    modules.set(path, mod);

    // A stylesheet is collected for injection, never executed. Generated code
    // writes `import './styles.css'` by habit, and compiling CSS as JavaScript
    // fails on the first selector with an error that points at the importing
    // file rather than at the real cause.
    if (path.endsWith('.css')) return mod.exports;

    const code = compile(file);
    const dir = dirname(path);
    const require = (specifier: string): unknown => {
      const host = resolveHostModule(specifier, dir);
      if (host !== undefined) return interop(host);
      const target = resolve(dir, specifier);
      if (target) return load(target);
      throw new Error(
        `"${specifier}" is not available in a Studio app. ` +
          `Imports must be one of the host modules, or a relative path to a file in this project.`,
      );
    };

    try {
      // eslint-disable-next-line no-new-func -- see the file header: this is the mechanism, not a shortcut
      const factory = new Function('require', 'module', 'exports', 'React', code);
      factory(require, mod, mod.exports, hostReact);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Keep the INNERMOST attribution. Without this every module on the way
      // out overwrites `studioWhere`, so a fault three imports deep is reported
      // against the entry file and the fix turn is aimed at the wrong place.
      const already = (err as { studioWhere?: string }).studioWhere;
      throw Object.assign(new Error(topLevelAwaitHint(message, path)), {
        studioWhere: already ?? path,
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
    return mod.exports;
  }

  const entryPath = byPath.has(entry)
    ? entry
    : (files.find(f => f.path === '/App.tsx' || f.path.endsWith('/App.tsx'))?.path ?? files[0]?.path);
  if (!entryPath) throw Object.assign(new Error('The project has no files.'), { studioWhere: 'project' });

  const exported = load(entryPath);
  const Component =
    exported['default'] ??
    Object.values(exported).find(value => typeof value === 'function');

  if (typeof Component !== 'function') {
    throw Object.assign(
      new Error(`${entryPath} has no default export to render. Export the root component as default.`),
      { studioWhere: entryPath },
    );
  }

  return { Component, css };
}

/**
 * Rewrite the one syntax error that is really a contract violation.
 *
 * Each module is evaluated as a synchronous function, so top-level `await` —
 * which is exactly what a model reaches for after being told the data layer is
 * async — fails as a bare "await is only valid in async functions". On its own
 * that sends the fix turn hunting for a missing `async` keyword. Naming the real
 * cause is what makes the repair one turn instead of three.
 */
function topLevelAwaitHint(message: string, path: string): string {
  if (!/await is only valid|Unexpected reserved word/i.test(message)) return message;
  return (
    `${path}: top-level await is not supported — each file is evaluated as a synchronous module. ` +
    `Move the await inside an effect or a handler, e.g. ` +
    `useEffect(() => { (async () => { const { spaces } = await xyne(); })(); }, []).`
  );
}

/** Turn any thrown value into the shape the error pane and the fix button read. */
export function toRuntimeError(err: unknown): RuntimeError {
  if (err instanceof Error) {
    const where = (err as { studioWhere?: string }).studioWhere ?? 'runtime';
    return { where, message: err.message, ...(err.stack ? { stack: err.stack } : {}) };
  }
  return { where: 'runtime', message: String(err) };
}

/**
 * Tailwind, in local dev.
 *
 * Published, `@tailwindcss/browser` is already running in this document — it is
 * in the sandbox's BASE_DEPENDENCIES and compiles classes off DOM mutations, so
 * a generated app's classes just work. Locally, Tailwind is a BUILD step
 * (@tailwindcss/vite scans source at build time), so a class that first exists
 * at runtime has no CSS behind it and the preview renders unstyled. Loading the
 * browser build closes that gap so the preview looks the same in both places.
 */
let tailwindPromise: Promise<unknown> | null = null;
export function ensureRuntimeTailwind(): void {
  if (tailwindPromise || typeof window === 'undefined') return;
  if (window.parent !== window) return; // published: already present
  tailwindPromise = import('@tailwindcss/browser').catch(() => null);
}
