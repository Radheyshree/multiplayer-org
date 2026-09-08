/**
 * The workspace directory, loaded once and shared by every surface.
 *
 * Two traps here, both found the hard way:
 *   - users.getProfiles returns UserProfile rows whose `id` is the PROFILE row
 *     id, not the user id — the user id is in `userId`. Keying a cache on `id`
 *     silently never matches a senderId, which is why messages rendered as
 *     'cmgot9f1' instead of 'Pradeesh S'.
 *   - listBasic returns the whole directory (4358 rows here) in ONE call, with
 *     name AND picture AND userType. That is cheaper and richer than resolving
 *     ids piecemeal, so it is the primary path; getProfiles is the fallback.
 */
import { rawOp, xyne } from './xyne';

export type Person = { id: string; name: string; picture?: string; isBot?: boolean };

const people = new Map<string, Person>();
let directory: Promise<void> | null = null;

/** Avatar tints, in the spirit of the Spaces palette — stable per user. */
const TINTS = ['#E8622F', '#D9A400', '#2F6F6B', '#4B46E5', '#B5387C', '#3B7EA1', '#5B7A2E', '#8A4FBF'];

export function tintFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

export function initials(name: string): string {
  return name.split(/\s+/).map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
}

/** Everyone currently resolved — used by pickers that filter as you type. */
export function allPeople(): Person[] {
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function personOf(id: string): Person {
  return people.get(id) ?? { id, name: id.slice(0, 8) };
}

export function nameOf(id: string): string {
  return personOf(id).name;
}

/** Load the directory once. Every surface awaits the same promise. */
export function loadDirectory(): Promise<void> {
  if (!directory) {
    directory = (async () => {
      const { spaces } = await xyne();
      // Through rawOp, not spaces.users.listBasic.
      //
      // Both make the SAME request and the server returns the ENTIRE directory
      // either way — 4358 users, 2.85 MB — but the SDK's paginate() windows it to
      // 100 and discards the rest. So the wrapper pays the full 2.85 MB for 100
      // names, and each further page costs another 2.85 MB. Reading the response
      // whole gets every name, bots included, for the transfer already paid.
      const rows = await rawOp<Array<Record<string, string>>>('users.listBasic', {});
      for (const u of rows) {
        if (!u.id) continue;
        people.set(u.id, {
          id: u.id,
          name: u.displayName || u.name || u.email || u.id.slice(0, 8),
          ...(u.picture ? { picture: u.picture } : {}),
          ...(u.userType === 'BOT' ? { isBot: true } : {}),
        });
      }
    })().catch(() => {
      directory = null; // let a later surface retry
    });
  }
  return directory;
}

/** Fill any ids the directory missed (external or newly created users). */
export async function resolvePeople(ids: Array<string | undefined>): Promise<boolean> {
  await loadDirectory();
  const missing = [...new Set(ids.filter((i): i is string => typeof i === 'string' && i.length > 0 && !people.has(i)))];
  if (missing.length === 0) return false;
  try {
    const { spaces } = await xyne();
    const profiles = (await spaces.users.getProfiles(missing)) as unknown as Array<Record<string, string>>;
    for (const p of profiles ?? []) {
      // `userId` FIRST — `id` is the profile row's own id and will not match.
      const id = p.userId ?? p.id;
      if (id) people.set(id, { id, name: p.displayName || p.name || p.email || id.slice(0, 8) });
    }
  } catch {
    /* fall through to the id-prefix placeholder */
  }
  for (const id of missing) if (!people.has(id)) people.set(id, { id, name: id.slice(0, 8) });
  return true;
}
