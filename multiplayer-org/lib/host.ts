/**
 * Handing a URL to the Xyne host so it renders the REAL site inside the app.
 *
 * The desktop app already contains a browser: a <webview>-backed panel with its
 * own tabs and address bar. A webview is a separate top-level browsing context,
 * not an iframe, so X-Frame-Options and frame-ancestors do not apply to it —
 * github.com renders there in full, logged in, exactly as in Chrome. That is the
 * thing an embedded iframe can never be.
 *
 * We cannot call that panel directly: it is driven by browserPanelActor in the
 * dashboard, and a Space is a cross-origin sandboxed frame with no channel to it
 * (the artifact bridge carries data and agent messages only). But we do not need
 * one. A plain window.open is intercepted in the main process — see
 * apps/electron/src/window/manager.ts:113-125 — and any non-Xyne origin is
 * denied as a window and re-sent to the renderer as 'open-in-browser-panel',
 * which is precisely the in-app browser. The Sandpack frame we run in is created
 * with allow-popups, so the call is permitted to begin with.
 *
 * WHERE IT LANDS depends on one user preference, `openLinksExternally`, which
 * defaults to TRUE (apps/dashboard/src/types/browserSettings.ts:8):
 *
 *   pref ON  (default)  ->  system browser        modified click -> Xyne panel
 *   pref OFF            ->  Xyne browser panel    modified click -> system browser
 *
 * because the main process computes `wantExternal = prefExternal !== modifier`.
 * So the honest thing is to open the link and tell the reader which of the two
 * they will get, rather than promising an in-app panel we do not control.
 */

/** True when running inside the Xyne desktop shell, where the panel exists. */
export function isDesktop(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /electron|xyne/i.test(navigator.userAgent);
}

/**
 * Ask the host to show a URL. On desktop this reaches the in-app browser panel
 * (subject to the preference above); in a web tab there is no panel and it is a
 * browser tab, which is the best the web can do.
 */
export function openInHost(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** One line of truth about where openInHost will actually put the page. */
export function handoffHint(): string {
  return isDesktop()
    ? 'Opens in Xyne’s own browser panel — the real site, inside the app. Hold ⌘ (or Ctrl) to send it to your system browser instead. If it lands in the wrong one, flip “open links externally” in Xyne’s link settings.'
    : 'Opens in a new browser tab. The in-app browser panel only exists in the Xyne desktop app — a web page cannot embed github.com, which blocks framing outright.';
}
