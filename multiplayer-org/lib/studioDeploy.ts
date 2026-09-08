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
import type { StudioFile } from './studioProtocol';

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
