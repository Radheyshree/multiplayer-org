/**
 * Turning ids into names.
 *
 * The API hands back raw ids almost everywhere a person appears — a message has
 * a `senderId`, a ticket an `assignedTo`, and a DM channel's `name` column is
 * literally a comma-joined list of user ids:
 *
 *   name: 'ccsoqzpidxdqtalfdrpquo4i,cmhkaaw5c0000sosm9tsmt0ek'
 *
 * Two of the rules here are not guessable, so they are written down rather than
 * rediscovered:
 *
 *   1. `displayName` is usually null. Fall back to `name`, then `email`.
 *   2. A DM channel's `name` is participant ids, not a name. It includes the
 *      viewer, who has to be dropped or every DM reads "You, Priya".
 */
import { token } from './xyne';
import type { Channel, User } from '@xyne/spaces-sdk';

export interface Person {
  id: string;
  label: string;
  email: string;
  picture: string | null;
  isBot: boolean;
}

export interface Directory {
  people: Map<string, Person>;
  /** A person's display name, or a short id when they are not in the directory. */
  name: (userId: string | null | undefined) => string;
  /** A channel's human label — DMs resolved to participant names. */
  channelLabel: (channel: Channel) => string;
}

function personFrom(u: User): Person {
  return {
    id: u.id,
    // displayName is usually null; name is usually set; email always is.
    label: u.displayName?.trim() || u.name?.trim() || u.email,
    email: u.email,
    picture: u.picture,
    isBot: u.userType !== 'USER' && u.userType !== 'HUMAN',
  };
}

/**
 * Every user in the workspace, in ONE request.
 *
 * This deliberately calls the SDK's own query endpoint rather than
 * `spaces.users.listBasic()`. The reason is specific, not stylistic: the server
 * returns the entire directory in a single response (4358 users here) and the
 * SDK's `paginate` then windows that array client-side to 100 rows. It does not
 * ask the server for less — so walking the pages would re-download all 4358
 * users 44 times to end up exactly where one call already got us.
 *
 * `users.listBasic` is the same operation id the SDK sends (registry/users.js:24),
 * and this goes through the same auth header and Vite proxy. When a genuinely
 * paged variant appears, delete this and call the resource.
 *
 * `getProfiles` is not an alternative: `UserProfile` carries `displayName` but
 * no `name` and no `email`, and displayName is null for about a third of people,
 * so it cannot produce a label on its own.
 */
async function listAllUsers(): Promise<User[]> {
  const res = await fetch('/api/sdk/v1/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ op: 'users.listBasic', args: {} }),
  });
  if (!res.ok) throw new Error(`directory: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: User[] | { items?: User[] } };
  const data = body.data;
  return Array.isArray(data) ? data : (data?.items ?? []);
}

export async function loadDirectory(viewerId: string | null): Promise<Directory> {
  const users = await listAllUsers().catch(() => [] as User[]);
  const people = new Map<string, Person>();
  for (const u of users) people.set(u.id, personFrom(u));

  const name = (userId: string | null | undefined): string => {
    if (!userId) return 'Unassigned';
    return people.get(userId)?.label ?? `user ${userId.slice(0, 6)}`;
  };

  const channelLabel = (channel: Channel): string => {
    const isDm = channel.scopeType === 'DM' || channel.scopeType === 'GROUP_DM';
    if (!isDm) return channel.name;

    const others = channel.name
      .split(',')
      .map((s) => s.trim())
      .filter((id) => id.length > 0 && id !== viewerId);

    if (others.length === 0) return 'You';
    const labels = others.map((id) => people.get(id)?.label ?? `user ${id.slice(0, 6)}`);
    if (labels.length <= 3) return labels.join(', ');
    return `${labels.slice(0, 3).join(', ')} +${labels.length - 3}`;
  };

  return { people, name, channelLabel };
}

/** An empty directory, so the UI can render before users have loaded. */
export const EMPTY_DIRECTORY: Directory = {
  people: new Map(),
  name: (id) => (id ? `user ${id.slice(0, 6)}` : 'Unassigned'),
  channelLabel: (c) => c.name,
};

/**
 * `IN_PROGRESS` → `In progress`. The API returns SCREAMING_SNAKE enums for
 * status, priority and type; none of them are meant to be read as-is.
 */
export function humanize(code: string | null | undefined): string {
  if (!code) return '—';
  const s = code.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Relative time, for message and ticket timestamps. */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Initials for an avatar, from a resolved display label. */
export function initials(label: string): string {
  const parts = label.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

/**
 * Priority and status tones.
 *
 * These read from the semantic tokens in index.css, deliberately not the accent
 * hue: "this is urgent" and "this is the brand colour" must not look alike, and
 * a P0 badge must not look like the agent marker.
 */
export function priorityTone(priority: string | null | undefined): string {
  switch ((priority ?? '').toUpperCase()) {
    case 'P0':
    case 'URGENT':
    case 'CRITICAL':
    case 'HIGHEST':
      return 'bg-crit-soft text-crit border-crit/25';
    case 'P1':
    case 'HIGH':
      return 'bg-warn-soft text-warn border-warn/25';
    case 'P3':
    case 'LOW':
    case 'LOWEST':
      return 'bg-muted text-muted-foreground border-transparent';
    default:
      return 'bg-secondary text-secondary-foreground border-transparent';
  }
}

export function statusTone(status: string | null | undefined): string {
  const s = (status ?? '').toUpperCase();
  if (/(DONE|CLOSED|RESOLVED|COMPLETE)/.test(s)) return 'bg-ok-soft text-ok border-ok/25';
  if (/(BLOCK|HOLD|WAIT)/.test(s)) return 'bg-crit-soft text-crit border-crit/25';
  if (/(PROGRESS|REVIEW|DOING|ACTIVE)/.test(s)) return 'bg-warn-soft text-warn border-warn/25';
  return 'bg-secondary text-secondary-foreground border-transparent';
}
