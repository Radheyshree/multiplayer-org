/**
 * GitHub & Bitbucket, read directly from their public REST APIs.
 *
 * Why not the SDK: there is no code-host entity in Spaces at all.
 * workspace.listRepos() returns { id, name, url, baseBranch, prefix } and
 * nothing else — no pull requests, no commits, no branch state. So a code
 * surface that renders anything real has to talk to the host itself.
 *
 * Why not an iframe: github.com and bitbucket.org both send
 * X-Frame-Options: DENY, so embedding the site is impossible no matter what
 * the sandbox allows. Rendering their API from our own components is the only
 * route to an in-app view — and it is the one that actually feels native,
 * because the result is our chrome, not theirs.
 *
 * Origin note: published, this app runs in a cross-origin sandboxed iframe, so
 * these requests carry `Origin: null`. Both APIs answer with
 * `Access-Control-Allow-Origin: *`, which permits that — but only for
 * uncredentialed requests, hence `credentials: 'omit'` everywhere below. A
 * token, when present, travels in the Authorization header, which the wildcard
 * still allows precisely because the request is not credentialed.
 */
import { xyne } from './xyne';

export type HostId = 'github' | 'bitbucket';

export type RepoRef = {
  host: HostId;
  owner: string;
  name: string;
  /** owner/name — the form both APIs and both UIs use. */
  slug: string;
  /** The human page, kept for the one explicit escape hatch we still offer. */
  webUrl: string;
};

export type RepoMeta = {
  description?: string;
  defaultBranch?: string;
  language?: string;
  stars?: number;
  forks?: number;
  openIssues?: number;
  updatedAt?: string;
  isPrivate?: boolean;
};

export type PullRequest = {
  number: number;
  title: string;
  /** open | merged | closed | draft — normalised across both hosts. */
  state: 'open' | 'merged' | 'closed' | 'draft';
  author?: string;
  avatar?: string;
  createdAt?: string;
  updatedAt?: string;
  source?: string;
  target?: string;
  webUrl: string;
};

export type Commit = {
  sha: string;
  shortSha: string;
  /** First line only — the subject. */
  subject: string;
  author?: string;
  avatar?: string;
  authoredAt?: string;
  webUrl: string;
};

export type Branch = {
  name: string;
  isDefault: boolean;
  sha?: string;
};

/** Why a read failed, in terms the UI can speak plainly about. */
export type FailureKind = 'auth' | 'notfound' | 'ratelimit' | 'blocked' | 'unknown';

export class CodeHostError extends Error {
  readonly kind: FailureKind;
  readonly host: HostId;
  constructor(kind: FailureKind, host: HostId, message: string) {
    super(message);
    this.name = 'CodeHostError';
    this.kind = kind;
    this.host = host;
  }
}

/* ---------------------------------------------------------------- refs --- */

const HOST_PATTERNS: Array<{ host: HostId; re: RegExp }> = [
  { host: 'github', re: /(?:^|\.)github\.com$/i },
  { host: 'bitbucket', re: /(?:^|\.)bitbucket\.org$/i },
];

/**
 * Turn a connected-repository URL into something addressable, or null when it
 * points at a host we cannot read (self-hosted GitLab, an internal Gerrit, …).
 * Tolerates the shapes people actually paste: trailing .git, trailing slash,
 * deep links to a branch, and scp-style git@host:owner/name.
 */
export function parseRepoRef(raw?: string): RepoRef | null {
  if (!raw) return null;
  let text = raw.trim();
  if (!text) return null;

  // git@github.com:owner/name.git -> https://github.com/owner/name.git
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(text);
  if (scp) text = `https://${scp[1]}/${scp[2]}`;
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }

  const host = HOST_PATTERNS.find(p => p.re.test(url.hostname))?.host;
  if (!host) return null;

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const name = parts[1].replace(/\.git$/i, '');
  if (!owner || !name) return null;

  const base = host === 'github' ? 'https://github.com' : 'https://bitbucket.org';
  return { host, owner, name, slug: `${owner}/${name}`, webUrl: `${base}/${owner}/${name}` };
}

export const HOST_LABEL: Record<HostId, string> = {
  github: 'GitHub',
  bitbucket: 'Bitbucket',
};

/* --------------------------------------------------------------- token --- */

const TOKENS = 'codehost-tokens';
type TokenBag = Partial<Record<HostId, string>>;

/**
 * Personal access tokens, per user. Scope 'user' matters: a workspace-scoped
 * token would be one person's credential handed to everyone in the org.
 * Nothing here is logged, and the token is only ever sent to its own host.
 */
export async function loadTokens(): Promise<TokenBag> {
  const { storage } = await xyne();
  const rec = await storage.collection<TokenBag>(TOKENS).get('me', { scope: 'user' });
  return rec?.value ?? {};
}

export async function saveToken(host: HostId, token: string): Promise<TokenBag> {
  const { storage } = await xyne();
  const next = { ...(await loadTokens()) };
  if (token.trim()) next[host] = token.trim();
  else delete next[host];
  await storage.collection<TokenBag>(TOKENS).put('me', next, { scope: 'user' });
  return next;
}

/**
 * GitHub wants `Bearer <pat>`. Bitbucket accepts the same for access tokens,
 * but an *app password* is Basic auth — and people paste those far more often,
 * so treat a `user:secret` shape as Basic rather than failing mysteriously.
 */
function authHeader(host: HostId, token?: string): Record<string, string> {
  if (!token) return {};
  if (host === 'bitbucket' && token.includes(':')) {
    return { Authorization: `Basic ${btoa(token)}` };
  }
  return { Authorization: `Bearer ${token}` };
}

/* ---------------------------------------------------------------- http --- */

async function api<T>(host: HostId, url: string, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'omit',
      headers: {
        Accept: host === 'github' ? 'application/vnd.github+json' : 'application/json',
        ...(host === 'github' ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}),
        ...authHeader(host, token),
      },
    });
  } catch {
    // A TypeError here is the network layer refusing before any response: a
    // sandbox CSP connect-src, an offline tab, or DNS. It is never a 4xx.
    throw new CodeHostError('blocked', host, `The browser blocked the request to ${HOST_LABEL[host]}.`);
  }

  if (res.ok) return (await res.json()) as T;

  // GitHub spends its rate limit as a 403 with the remaining count at zero.
  const remaining = res.headers.get('x-ratelimit-remaining');
  if (res.status === 403 && remaining === '0') {
    throw new CodeHostError('ratelimit', host, `${HOST_LABEL[host]}'s rate limit for this IP is used up.`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new CodeHostError('auth', host, `${HOST_LABEL[host]} refused the request — this repository needs a token.`);
  }
  if (res.status === 404) {
    // A private repo read without credentials is a 404, not a 403 — GitHub
    // hides existence. So 404 means "missing OR not yours", and saying only
    // "not found" would send people looking for a typo that isn't there.
    throw new CodeHostError('notfound', host, `Not found on ${HOST_LABEL[host]}, or private and not visible to this token.`);
  }
  throw new CodeHostError('unknown', host, `${HOST_LABEL[host]} returned ${res.status}.`);
}

const ghBase = (r: RepoRef): string => `https://api.github.com/repos/${r.owner}/${r.name}`;
const bbBase = (r: RepoRef): string => `https://api.bitbucket.org/2.0/repositories/${r.owner}/${r.name}`;

const subjectOf = (message?: string): string => (message ?? '').split('\n')[0].trim() || '(no message)';

/* -------------------------------------------------------------- reads ---- */

type GhRepo = {
  description?: string | null;
  default_branch?: string;
  language?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  updated_at?: string;
  private?: boolean;
};

type BbRepo = {
  description?: string;
  mainbranch?: { name?: string };
  language?: string;
  updated_on?: string;
  is_private?: boolean;
};

export async function fetchRepoMeta(ref: RepoRef, token?: string): Promise<RepoMeta> {
  if (ref.host === 'github') {
    const r = await api<GhRepo>('github', ghBase(ref), token);
    return {
      ...(r.description ? { description: r.description } : {}),
      ...(r.default_branch ? { defaultBranch: r.default_branch } : {}),
      ...(r.language ? { language: r.language } : {}),
      stars: r.stargazers_count ?? 0,
      forks: r.forks_count ?? 0,
      openIssues: r.open_issues_count ?? 0,
      ...(r.updated_at ? { updatedAt: r.updated_at } : {}),
      isPrivate: Boolean(r.private),
    };
  }
  const r = await api<BbRepo>('bitbucket', bbBase(ref), token);
  return {
    ...(r.description ? { description: r.description } : {}),
    ...(r.mainbranch?.name ? { defaultBranch: r.mainbranch.name } : {}),
    ...(r.language ? { language: r.language } : {}),
    ...(r.updated_on ? { updatedAt: r.updated_on } : {}),
    isPrivate: Boolean(r.is_private),
  };
}

type GhPull = {
  number: number;
  title: string;
  state: string;
  draft?: boolean;
  merged_at?: string | null;
  user?: { login?: string; avatar_url?: string };
  created_at?: string;
  updated_at?: string;
  head?: { ref?: string };
  base?: { ref?: string };
  html_url: string;
};

type BbPull = {
  id: number;
  title: string;
  state: string;
  author?: { display_name?: string; links?: { avatar?: { href?: string } } };
  created_on?: string;
  updated_on?: string;
  source?: { branch?: { name?: string } };
  destination?: { branch?: { name?: string } };
  links?: { html?: { href?: string } };
};

export async function fetchPulls(ref: RepoRef, token?: string): Promise<PullRequest[]> {
  if (ref.host === 'github') {
    const rows = await api<GhPull[]>(
      'github',
      `${ghBase(ref)}/pulls?state=all&sort=updated&direction=desc&per_page=25`,
      token,
    );
    return rows.map(p => ({
      number: p.number,
      title: p.title,
      state: p.merged_at ? 'merged' : p.draft ? 'draft' : p.state === 'closed' ? 'closed' : 'open',
      ...(p.user?.login ? { author: p.user.login } : {}),
      ...(p.user?.avatar_url ? { avatar: p.user.avatar_url } : {}),
      ...(p.created_at ? { createdAt: p.created_at } : {}),
      ...(p.updated_at ? { updatedAt: p.updated_at } : {}),
      ...(p.head?.ref ? { source: p.head.ref } : {}),
      ...(p.base?.ref ? { target: p.base.ref } : {}),
      webUrl: p.html_url,
    }));
  }

  // Bitbucket defaults to OPEN only; ask for the closed states explicitly so
  // the tab is a history rather than a snapshot.
  const q = ['OPEN', 'MERGED', 'DECLINED'].map(s => `state=${s}`).join('&');
  const page = await api<{ values?: BbPull[] }>('bitbucket', `${bbBase(ref)}/pullrequests?${q}&pagelen=25`, token);
  return (page.values ?? []).map(p => ({
    number: p.id,
    title: p.title,
    state: p.state === 'MERGED' ? 'merged' : p.state === 'DECLINED' ? 'closed' : 'open',
    ...(p.author?.display_name ? { author: p.author.display_name } : {}),
    ...(p.author?.links?.avatar?.href ? { avatar: p.author.links.avatar.href } : {}),
    ...(p.created_on ? { createdAt: p.created_on } : {}),
    ...(p.updated_on ? { updatedAt: p.updated_on } : {}),
    ...(p.source?.branch?.name ? { source: p.source.branch.name } : {}),
    ...(p.destination?.branch?.name ? { target: p.destination.branch.name } : {}),
    webUrl: p.links?.html?.href ?? `${ref.webUrl}/pull-requests/${p.id}`,
  }));
}

type GhCommit = {
  sha: string;
  commit?: { message?: string; author?: { name?: string; date?: string } };
  author?: { login?: string; avatar_url?: string };
  html_url: string;
};

type BbCommit = {
  hash: string;
  message?: string;
  date?: string;
  author?: { raw?: string; user?: { display_name?: string; links?: { avatar?: { href?: string } } } };
  links?: { html?: { href?: string } };
};

export async function fetchCommits(ref: RepoRef, branch?: string, token?: string): Promise<Commit[]> {
  if (ref.host === 'github') {
    const q = branch ? `?sha=${encodeURIComponent(branch)}&per_page=25` : '?per_page=25';
    const rows = await api<GhCommit[]>('github', `${ghBase(ref)}/commits${q}`, token);
    return rows.map(x => ({
      sha: x.sha,
      shortSha: x.sha.slice(0, 7),
      subject: subjectOf(x.commit?.message),
      ...(x.author?.login || x.commit?.author?.name
        ? { author: x.author?.login ?? x.commit?.author?.name ?? '' }
        : {}),
      ...(x.author?.avatar_url ? { avatar: x.author.avatar_url } : {}),
      ...(x.commit?.author?.date ? { authoredAt: x.commit.author.date } : {}),
      webUrl: x.html_url,
    }));
  }

  const q = branch ? `${encodeURIComponent(branch)}?pagelen=25` : '?pagelen=25';
  const page = await api<{ values?: BbCommit[] }>('bitbucket', `${bbBase(ref)}/commits/${q}`, token);
  return (page.values ?? []).map(x => ({
    sha: x.hash,
    shortSha: x.hash.slice(0, 7),
    subject: subjectOf(x.message),
    // Bitbucket only fills `user` for commit emails it can map to an account;
    // for everyone else the raw "Name <email>" line is all there is.
    ...(x.author?.user?.display_name || x.author?.raw
      ? { author: x.author?.user?.display_name ?? (x.author?.raw ?? '').replace(/\s*<[^>]*>\s*$/, '') }
      : {}),
    ...(x.author?.user?.links?.avatar?.href ? { avatar: x.author.user.links.avatar.href } : {}),
    ...(x.date ? { authoredAt: x.date } : {}),
    webUrl: x.links?.html?.href ?? `${ref.webUrl}/commits/${x.hash}`,
  }));
}

export async function fetchBranches(ref: RepoRef, defaultBranch?: string, token?: string): Promise<Branch[]> {
  if (ref.host === 'github') {
    const rows = await api<Array<{ name: string; commit?: { sha?: string } }>>(
      'github',
      `${ghBase(ref)}/branches?per_page=50`,
      token,
    );
    return rows.map(b => ({
      name: b.name,
      isDefault: b.name === defaultBranch,
      ...(b.commit?.sha ? { sha: b.commit.sha.slice(0, 7) } : {}),
    }));
  }
  const page = await api<{ values?: Array<{ name: string; target?: { hash?: string } }> }>(
    'bitbucket',
    `${bbBase(ref)}/refs/branches?pagelen=50`,
    token,
  );
  return (page.values ?? []).map(b => ({
    name: b.name,
    isDefault: b.name === defaultBranch,
    ...(b.target?.hash ? { sha: b.target.hash.slice(0, 7) } : {}),
  }));
}

/* --------------------------------------------------------------- time ---- */

/** Relative time, because a code host reads in "3h ago", not in timestamps. */
export function ago(iso?: string): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, (Date.now() - then) / 1000);
  const steps: Array<[number, string]> = [
    [60, 's'],
    [3600, 'm'],
    [86400, 'h'],
    [2592000, 'd'],
  ];
  if (secs < 60) return 'just now';
  for (let i = 1; i < steps.length; i++) {
    const [limit, unit] = steps[i];
    if (secs < limit) return `${Math.floor(secs / steps[i - 1][0])}${unit} ago`;
  }
  const days = Math.floor(secs / 86400);
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
