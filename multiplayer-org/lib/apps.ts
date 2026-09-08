/**
 * The workspace's real app registry.
 *
 * `orgApps/catalogue.ts` lists the apps this shell mounts. This file lists the
 * apps the WORKSPACE actually has installed, read through `admin.*` — the same
 * registry the Xyne dashboard reads. The two are shown together in the store
 * because they answer the same question from different sides: what can I open
 * here, and what does this org already run.
 *
 * Nothing here is invented. If a list comes back empty, the store says so.
 */
import { xyne } from './xyne';

export type Origin = 'org' | 'marketplace';

export interface RegistryApp {
  id: string;
  name: string;
  description: string;
  origin: Origin;
  version?: string;
  /** Present in this workspace's installed set. */
  installed: boolean;
}

type RawApp = {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  scope?: string;
};

function toApp(a: RawApp, origin: Origin, installed: Set<string>): RegistryApp {
  return {
    id: a.id,
    name: a.name || a.id,
    description: a.description || 'No description provided.',
    origin,
    ...(a.version ? { version: a.version } : {}),
    installed: installed.has(a.id),
  };
}

export interface Registry {
  org: RegistryApp[];
  marketplace: RegistryApp[];
  /** Set when a list failed. The rest still renders — see below. */
  error?: string;
}

/**
 * Read the registry.
 *
 * `allSettled`, not `all`: these are three independent admin endpoints and a
 * permission gap on any one of them is normal. Failing the whole store because
 * the marketplace list 403s would hide the org's own apps, which is the half
 * that matters.
 */
export async function loadRegistry(): Promise<Registry> {
  const { spaces } = await xyne();
  const me = await spaces.users.me();

  const [installedRes, orgRes, marketRes] = await Promise.allSettled([
    spaces.admin.listInstalledApps({ limit: 50 }),
    spaces.admin.listOrgApps(me.orgId, { limit: 50 }),
    spaces.admin.listMarketplaceApps({ limit: 50 }),
  ]);

  const installed = new Set<string>();
  if (installedRes.status === 'fulfilled') {
    for (const i of installedRes.value as unknown as Array<{ appId?: string }>) {
      if (i.appId) installed.add(i.appId);
    }
  }

  const org =
    orgRes.status === 'fulfilled'
      ? (orgRes.value as unknown as RawApp[]).map((a) => toApp(a, 'org', installed))
      : [];
  const marketplace =
    marketRes.status === 'fulfilled'
      ? (marketRes.value as unknown as RawApp[]).map((a) => toApp(a, 'marketplace', installed))
      : [];

  const failed = [orgRes, marketRes].filter((r) => r.status === 'rejected').length;
  return {
    org,
    marketplace,
    ...(failed ? { error: `${failed} registry list${failed > 1 ? 's' : ''} could not be read.` } : {}),
  };
}
