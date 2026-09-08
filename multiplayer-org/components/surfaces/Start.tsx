/**
 * The new-tab page: the hosts, and every repository this workspace connects.
 *
 * Nothing here touches the network beyond the one SDK call for the connected
 * list, so opening tabs and browsing around costs nothing against a code host's
 * rate limit. The reads only start once you land on a repository.
 */
import { useEffect, useMemo, useState } from 'react';
import { c, eyebrow, mono } from '../../lib/theme';
import { xyne } from '../../lib/xyne';
import { HOST_LABEL, parseRepoRef, type HostId, type RepoRef } from '../../lib/codehost';

/** What workspace.listRepos returns, narrowed to what we render. */
type ConnectedRepo = {
  id: string;
  name?: string;
  url?: string;
  canonicalUrl?: string;
  baseBranch?: string[];
  prefix?: string;
};

type Connected = ConnectedRepo & { ref: RepoRef | null };

const HOSTS: Array<{ id: HostId; glyph: string }> = [
  { id: 'github', glyph: '⑂' },
  { id: 'bitbucket', glyph: '⑃' },
];

function hostOf(url?: string): string {
  if (!url) return 'repository';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'repository';
  }
}

function RepoCard({ repo, onOpen }: { repo: Connected; onOpen: (r: RepoRef) => void }) {
  const href = repo.url || repo.canonicalUrl;
  const openable = Boolean(repo.ref);

  const body = (
    <>
      <div
        className="flex items-center justify-between rounded-t-lg px-3 py-1.5"
        style={{ background: '#F5F4F0', borderBottom: `1px solid ${c.line}` }}
      >
        <span style={{ ...eyebrow, color: c.mute }}>{repo.ref ? HOST_LABEL[repo.ref.host] : hostOf(href)}</span>
        {repo.prefix && <span style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}>{repo.prefix}/</span>}
      </div>
      <div className="p-3.5">
        <h3 className="truncate text-[14px] font-semibold">{repo.name ?? repo.ref?.name ?? 'Unnamed repository'}</h3>
        {repo.ref && (
          <p className="mt-0.5 truncate" style={{ fontFamily: mono, fontSize: '10.5px', color: c.mute }}>
            {repo.ref.slug}
          </p>
        )}
        {repo.baseBranch?.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {repo.baseBranch.map(b => (
              <span
                key={b}
                className="rounded px-1.5 py-0.5"
                style={{ fontFamily: mono, fontSize: '10px', background: '#F2F1EC', color: c.graphite }}
              >
                {b}
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-3 text-[12.5px] font-medium" style={{ color: openable ? c.signal : c.mute }}>
          {openable ? 'Open here →' : 'Host not supported'}
        </div>
      </div>
    </>
  );

  const frame = { background: c.card, border: `1px solid ${c.line}` };

  if (!openable) {
    // Self-hosted GitLab, an internal Gerrit — no API here we can speak to.
    return (
      <article className="rounded-lg opacity-70" style={frame} title={href ?? undefined}>
        {body}
      </article>
    );
  }
  return (
    <button onClick={() => repo.ref && onOpen(repo.ref)} className="rounded-lg text-left transition-shadow hover:shadow-sm" style={frame}>
      {body}
    </button>
  );
}

export function Start({
  host,
  onOpenRepo,
  onOpenHost,
}: {
  /** Set when the tab is pointed at a bare domain — narrows to that host. */
  host?: HostId;
  onOpenRepo: (ref: RepoRef) => void;
  onOpenHost: (host: HostId) => void;
}) {
  const [repos, setRepos] = useState<ConnectedRepo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    void (async () => {
      const { spaces } = await xyne();
      setRepos((await spaces.workspace.listRepos()) as unknown as ConnectedRepo[]);
    })()
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, []);

  const connected: Connected[] = useMemo(
    () => repos.map(r => ({ ...r, ref: parseRepoRef(r.url || r.canonicalUrl) })),
    [repos],
  );

  const shown = host ? connected.filter(r => r.ref?.host === host) : connected;

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <h1 className="text-[22px] leading-none font-semibold tracking-tight">
        {host ? HOST_LABEL[host] : 'GitHub & Bitbucket'}
      </h1>
      <p className="mt-2 max-w-2xl text-[13.5px]" style={{ color: c.graphite }}>
        {host
          ? `The repositories this workspace connects on ${HOST_LABEL[host]}.`
          : 'Your code hosts, read in here rather than in another tab. Type a repository address above, or pick one below.'}
      </p>

      {!host && (
        <div className="mt-6 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
          {HOSTS.map(h => {
            const n = connected.filter(r => r.ref?.host === h.id).length;
            return (
              <button
                key={h.id}
                onClick={() => onOpenHost(h.id)}
                className="flex items-center gap-3 rounded-lg p-4 text-left transition-shadow hover:shadow-sm"
                style={{ background: c.card, border: `1px solid ${c.line}` }}
              >
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-md text-[15px]"
                  style={{ background: c.ink, color: c.paper }}
                  aria-hidden
                >
                  {h.glyph}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold">{HOST_LABEL[h.id]}</span>
                  <span className="block truncate text-[12px]" style={{ color: c.graphite }}>
                    {busy ? 'reading workspace…' : n === 1 ? '1 repository connected' : `${n} repositories connected`}
                  </span>
                </span>
                <span className="ml-auto" style={{ color: c.mute }} aria-hidden>
                  →
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-9">
        <div className="mb-3 flex items-baseline gap-2">
          <h2 style={{ ...eyebrow, color: c.graphite }}>Connected repositories</h2>
          <span style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}>{shown.length}</span>
        </div>

        {busy && <p style={{ fontFamily: mono, fontSize: '11px', color: c.mute }}>reading workspace…</p>}
        {error && (
          <p className="rounded-md px-3 py-2 text-[12.5px]" style={{ background: '#FCF2EC', color: c.attention }}>
            {error}
          </p>
        )}
        {!busy && !error && shown.length === 0 && (
          <p className="text-[13px]" style={{ color: c.graphite }}>
            {host
              ? `No ${HOST_LABEL[host]} repositories are connected to this workspace yet.`
              : 'No repositories connected to this workspace yet.'}
          </p>
        )}

        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {shown.map(r => (
            <RepoCard key={r.id} repo={r} onOpen={onOpenRepo} />
          ))}
        </div>
      </div>
    </div>
  );
}
