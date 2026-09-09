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

export type Person = {
  id: string;
  name: string;
  picture?: string;
  isBot?: boolean;
  /**
   * Their address. Kept, not just used as a name fallback, because it is the
   * only join between a Xyne user and an email that arrived from outside —
   * see `personByEmail`, which is how a mirrored mail gets its real author.
   */
  email?: string;
  /**
   * Job title and team, e.g. "Product Engineer - I" of "Infosec".
   *
   * These are the second line of a message row — the reference product shows
   * "Priya · Marketing" — and they are NOT on the user row. `users.listBasic`
   * returns the workspace User, whose `role` is a permission level (MEMBER /
   * ADMIN), not a job. The job title and the team live on the separate
   * UserProfile row and only `users.getProfiles` returns them, so they are
   * filled lazily by `resolveProfiles` for the handful of people actually on
   * screen rather than for all 4358.
   */
  title?: string;
  team?: string;
};

const people = new Map<string, Person>();
/** Ids we have already asked getProfiles about — including ones it had nothing for. */
const profiled = new Set<string>();
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

/**
 * The person behind an email address, when the workspace knows one.
 *
 * Built by scanning the directory rather than kept as a second index: it is
 * called once per mirrored row, the directory is already in memory, and a stale
 * index would be worse than a linear pass over a map we already hold.
 *
 * Returns null for an address belonging to nobody here — a vendor, a robot —
 * which the caller must render as the address itself rather than as a stranger.
 */
export function personByEmail(email: string | undefined | null): Person | null {
  const target = email?.trim().toLowerCase();
  if (!target) return null;
  for (const p of people.values()) {
    if (p.email?.toLowerCase() === target) return p;
  }
  return null;
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
          ...(u.email ? { email: u.email } : {}),
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

/**
 * Fill in job title and team for the people on screen.
 *
 * Separate from `resolvePeople` on purpose: that one is about NAMES and stops
 * as soon as a name is known, which is the common case for everyone in the
 * directory. This one always has to call `getProfiles`, because the directory
 * never carried a title in the first place. Callers that do not render the
 * second line should not pay for it.
 *
 * Returns true when something changed, so a caller can re-render.
 */
export async function resolveProfiles(ids: Array<string | null | undefined>): Promise<boolean> {
  await loadDirectory();
  const wanted = [...new Set(ids.filter((i): i is string => typeof i === 'string' && i.length > 0))]
    .filter(id => !profiled.has(id));
  if (wanted.length === 0) return false;
  // Mark before the call, not after: two surfaces mounting together would
  // otherwise both fetch the same ids.
  for (const id of wanted) profiled.add(id);
  try {
    const { spaces } = await xyne();
    const rows = (await spaces.users.getProfiles(wanted)) as unknown as Array<Record<string, string>>;
    let changed = false;
    for (const p of rows ?? []) {
      const id = p.userId ?? p.id;
      if (!id) continue;
      const prev = people.get(id) ?? { id, name: p.displayName || id.slice(0, 8) };
      people.set(id, {
        ...prev,
        ...(p.displayName ? { name: p.displayName } : {}),
        ...(p.role ? { title: p.role } : {}),
        ...(p.team ? { team: p.team } : {}),
      });
      changed = true;
    }
    return changed;
  } catch {
    // A missing title is a missing subtitle, never a missing message.
    return false;
  }
}

/** Fill any ids the directory missed (external or newly created users). */
export async function resolvePeople(ids: Array<string | null | undefined>): Promise<boolean> {
  await loadDirectory();
  const missing = [...new Set(ids.filter((i): i is string => typeof i === 'string' && i.length > 0 && !people.has(i)))];
  if (missing.length === 0) return false;
  try {
    const { spaces } = await xyne();
    const profiles = (await spaces.users.getProfiles(missing)) as unknown as Array<Record<string, string>>;
    for (const p of profiles ?? []) {
      // `userId` FIRST — `id` is the profile row's own id and will not match.
      const id = p.userId ?? p.id;
      if (id) {
        people.set(id, {
          id,
          name: p.displayName || p.name || p.email || id.slice(0, 8),
          ...(p.email ? { email: p.email } : {}),
        });
      }
    }
  } catch {
    /* fall through to the id-prefix placeholder */
  }
  for (const id of missing) if (!people.has(id)) people.set(id, { id, name: id.slice(0, 8) });
  return true;
}
