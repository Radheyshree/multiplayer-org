/** Ambient shims for Studio's runtime-only imports. Never uploaded (.d.ts is local-only). */
declare module '@tailwindcss/browser';

/**
 * Vite's `import.meta.env`. The app compiles with the bundler resolver but
 * without vite/client in `types`, so this is declared where it is used rather
 * than pulling a whole ambient package in for two fields.
 */
interface ImportMeta {
  readonly env?: { readonly DEV?: boolean; readonly PROD?: boolean };
}
