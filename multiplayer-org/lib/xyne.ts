/**
 * Xyne data layer — LOCAL-ONLY build.
 *
 * The scaffold ships a published-mode file: it vendors a SLIM 10-resource SDK
 * bundle (the published sandbox caps files at 64KB and the full SDK is ~70KB)
 * and sets `baseUrl: ''` so the SDK emits relative paths that a host tunnels
 * over postMessage.
 *
 * We are not publishing this app, so both of those constraints are gone and
 * both were costing us real API surface:
 *
 *   1. FULL SDK. We import `@xyne/spaces-sdk` directly, so all 25 resources are
 *      available (canvases, collections, forms, automations, admin, …), not the
 *      slim ten. Nothing needs `npm run bundle:sdk`.
 *
 *   2. ABSOLUTE baseUrl. `HttpClient.buildUrl` does `new URL(path, baseUrl)`
 *      (core/http.js:54), which THROWS on an empty base — so with the scaffold's
 *      `''` every GET-backed method (`users.me`, `search.query`,
 *      `claw.listAgents`, `claw.getRun`, and therefore `claw.runAndWait`) dies
 *      with `TypeError: Invalid URL`. POST-backed methods concatenate strings
 *      and silently work, which is why the bug hides.
 *      Pointing baseUrl at the dev-server origin fixes every GET while still
 *      routing through Vite's proxy, so we keep the CORS workaround.
 *
 * If this app is ever published, revert to `baseUrl: ''` + the vendored slim
 * bundle + the postMessage tunnel.
 */
import { createClient, type SpacesClient } from '@xyne/spaces-sdk';
import { XyneStorageClient } from '@xyne/storage-sdk';

// Injected by Vite's define block (see vite.config.ts). Guarded with `typeof`
// because a bundle that never had them defined throws a ReferenceError on a
// bare read.
declare const __XYNE_TOKEN__: string;
declare const __XYNE_APP_ID__: string;

const token = typeof __XYNE_TOKEN__ !== 'undefined' ? __XYNE_TOKEN__ : '';
const appId = typeof __XYNE_APP_ID__ !== 'undefined' ? __XYNE_APP_ID__ : '';

/** Same-origin: Vite proxies /api and /claw to XYNE_BASE_URL for us. */
const baseUrl = window.location.origin;

export const spaces: SpacesClient = createClient({ baseUrl, apiKey: token });

/**
 * Per-app key-value storage. Records key on the ArtifactApp id, so this only
 * works once `spaces app push` has filled XYNE_APP_ID — an empty id is accepted
 * verbatim by the constructor and then fails server-side, reported as an auth
 * error whose message blames the token. We surface that honestly instead.
 */
export const storage = new XyneStorageClient({ baseUrl, token, appId });
export const storageReady = appId.length > 0;

export const hasToken = token.length > 0;

/** Exposed for the one place that speaks the SDK's wire protocol directly —
 *  see the directory loader's comment for why. */
export { token };
