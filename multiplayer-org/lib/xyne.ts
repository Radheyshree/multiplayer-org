/**
 * Xyne data layer.
 *
 * Published, the app runs in a cross-origin sandbox with no cookie, so it can't
 * call the backend directly. Its SDK/storage fetches are tunnelled to the host
 * (the dashboard), which performs the real same-origin fetch as the viewer — so
 * you only ever see your own data and no token lives in the app. Contract (see
 * the dashboard's useArtifactRequestBridge):
 *   app  -> host: { source:'xyne-artifact',      v:1, type:'request',        requestId, method, url, headers?, body? }
 *   host -> app:  { source:'xyne-artifact-host', v:1, type:'request-result', requestId, status, headers, body, error? }
 *
 * Local dev (npm run dev): no host, so fetches hit the network directly with the
 * .env token (values injected by Vite's define block — see vite.config.ts).
 *
 * Usage:
 *   const { spaces, storage } = await xyne();
 *   const channels = await spaces.channels.listAll();
 *   await storage.collection('prefs').put('theme', 'dark');
 */
import { createClient, type SlimSpacesClient } from './vendor/spaces-sdk.js';
import { XyneStorageClient } from './vendor/storage-sdk.js';

// Injected by Vite in local dev; undefined in the sandbox (guarded with typeof).
declare const __XYNE_TOKEN__: string;
declare const __XYNE_APP_ID__: string;

const embedded = window.parent !== window;

if (embedded) {
  // Tunnel backend fetches (/api/*, /claw/*) to the host over postMessage; the
  // host runs them as the viewer. The app never holds a token.
  const realFetch = window.fetch.bind(window);
  const BACKEND = /^\/(api|claw)\//;
  window.fetch = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(raw, location.href);
    const path = u.pathname + u.search; // a same-origin path; the host resolves it
    if (!BACKEND.test(path)) return realFetch(input as RequestInfo, init);

    const requestId = crypto.randomUUID();
    return new Promise<Response>(resolve => {
      const onMessage = (e: MessageEvent): void => {
        const d = e.data;
        if (
          e.source !== window.parent ||
          d?.source !== 'xyne-artifact-host' ||
          d.type !== 'request-result' ||
          d.requestId !== requestId
        ) {
          return;
        }
        window.removeEventListener('message', onMessage);
        resolve(
          new Response(d.error ? (d.error as string) : (d.body as string), {
            status: d.status || (d.error ? 502 : 200),
            headers: (d.headers as Record<string, string>) ?? {},
          }),
        );
      };
      window.addEventListener('message', onMessage);
      const headers = init.headers ? Object.fromEntries(new Headers(init.headers).entries()) : undefined;
      window.parent.postMessage(
        {
          source: 'xyne-artifact',
          v: 1,
          type: 'request',
          requestId,
          method: init.method ?? 'GET',
          url: path,
          ...(headers ? { headers } : {}),
          ...(typeof init.body === 'string' ? { body: init.body } : {}),
        },
        '*',
      );
    });
  };
}

// Published: the SDK's paths are same-origin, and the shim above tunnels them.
// Local dev: same-origin too, and the Vite proxy forwards /api & /claw to
// XYNE_BASE_URL. The typeof check must be INLINE — referencing an injected
// global any other way throws a ReferenceError in the sandbox, where Vite never
// defined it; embedded also short-circuits so the globals are never touched when
// published.
//
// baseUrl must be an ABSOLUTE origin, not ''. The SDK's GET/DELETE path builds
// its URL with `new URL(path, baseUrl)` (core/http.ts buildUrl), and an empty
// base throws "Failed to construct 'URL': Invalid base URL" — so users.me(),
// search.* and claw.listAgents() all fail before fetch is ever called. (POST /
// PUT / PATCH concatenate instead, which is why they work with ''.)
//
// The origin itself is never load-bearing: dev resolves it to this same dev
// server, and embedded the shim rewrites the request down to its pathname before
// tunnelling. A sandboxed iframe without allow-same-origin has an opaque origin
// where location.origin is the string 'null', so fall back to a syntactically
// valid placeholder — nothing is ever fetched from it.
const baseUrl =
  typeof location !== 'undefined' && /^https?:/.test(location.origin)
    ? location.origin
    : 'http://localhost';
const token = embedded ? undefined : typeof __XYNE_TOKEN__ !== 'undefined' ? __XYNE_TOKEN__ : undefined;
const appId = embedded ? '' : typeof __XYNE_APP_ID__ !== 'undefined' ? __XYNE_APP_ID__ : '';

export const spaces: SlimSpacesClient = createClient({ baseUrl, apiKey: token });
export const storage = new XyneStorageClient({ baseUrl, token: token ?? '', appId });

/**
 * Call an SDK operation directly, bypassing the resource wrappers.
 *
 * Needed where the SDK's client-side pagination throws away data the server
 * already sent — users.listBasic returns the whole 4358-user directory in every
 * response and then windows it to 100, so the wrapper pays the full transfer for
 * a fraction of the rows. Same endpoint, same auth: the bearer token locally,
 * and the host's cookie when embedded (the shim above tunnels it).
 */
export async function rawOp<T>(
  op: string,
  args: unknown = {},
  /**
   * Which half of the gateway to post to.
   *
   * The two endpoints are not interchangeable server-side — reads go to the
   * replica pool and writes open a transaction — so posting a mutator to
   * `/query` is a 400, not a silent read. This used to be guessed from the op
   * name (`.send` meant a write), which is right for `messages.send` and wrong
   * for every mutator that is not named like one: `calls.markMoment`,
   * `calls.linkNotesCanvas` and `tickets.create` are all writes whose names end
   * in nothing in particular, so they were unreachable through this path
   * entirely. The default stays 'query' because every existing caller is a read.
   */
  kind: 'query' | 'mutate' = op.endsWith('.send') ? 'mutate' : 'query',
): Promise<T> {
  const res = await fetch(`${baseUrl}/api/sdk/v1/${kind}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ op, args }),
  });
  if (!res.ok) throw new Error(`${op} failed (HTTP ${res.status})`);
  const body: unknown = await res.json();
  return (Array.isArray(body) ? body : ((body as { data?: unknown })?.data ?? body)) as T;
}

/** The authenticated Xyne clients. */
export async function xyne(): Promise<{ spaces: SlimSpacesClient; storage: XyneStorageClient }> {
  return { spaces, storage };
}

// --- Compatibility exports -------------------------------------------------
// main's modules (lib/directory.ts, App.tsx) import these three from here. Our
// version of this file grew a different surface, so re-export them rather than
// let a merge silently drop symbols the other half of the app depends on.
export { token };

/** Whether a bearer token was injected (false when embedded — the host's cookie carries auth). */
export const hasToken = (token ?? '').length > 0;

/** Whether app-scoped storage is usable; false without an appId. */
export const storageReady = appId.length > 0;
