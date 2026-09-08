/**
 * One repository, in our own chrome.
 *
 * This is a page inside the browser chrome (Browser.tsx), not a screen of its
 * own: the tab strip, address bar and history live above it, so this component
 * owns no back button and does not hold its own tab state. Which of the three
 * views is showing arrives as a prop, because it is part of the address.
 *
 * Everything below is rendered from the host's REST API into this shell's own
 * components — pull requests, commits and branches — so moving between a ticket
 * and the PR that closes it never costs you the app you were in.
 *
 * The failure states are deliberately as designed as the success one. On Xyne
 * desktop the Electron shell applies a closed connect-src allowlist that does
 * not include api.github.com, so a blocked read is not an edge case there — it
 * is the default. A surface that renders a blank panel in that situation would
 * be worse than the tab it replaced, so each failure says which of the four
 * things went wrong and offers the one action that fixes it.
 */
import { useCallback, useEffect, useState } from 'react';
import { c, eyebrow, mono } from '../../lib/theme';
import { handoffHint, isDesktop, openInHost } from '../../lib/host';
import type { RepoTab } from '../../lib/nav';
import {
  ago,
  CodeHostError,
  fetchBranches,
  fetchCommits,
  fetchPulls,
  fetchRepoMeta,
  HOST_LABEL,
  loadTokens,
  saveToken,
  type Branch,
  type Commit,
  type FailureKind,
  type PullRequest,
  type RepoMeta,
  type RepoRef,
} from '../../lib/codehost';

const TABS: Array<{ id: RepoTab; label: string }> = [
  { id: 'pulls', label: 'Pull requests' },
  { id: 'commits', label: 'Commits' },
  { id: 'branches', label: 'Branches' },
];

const PILL: Record<PullRequest['state'], { bg: string; fg: string; label: string }> = {
  open: { bg: c.liveSoft, fg: c.live, label: 'open' },
  merged: { bg: c.signalSoft, fg: c.signal, label: 'merged' },
  closed: { bg: c.ink, fg: c.mute, label: 'closed' },
  draft: { bg: c.ink, fg: c.graphite, label: 'draft' },
};

function Pill({ state }: { state: PullRequest['state'] }) {
  const s = PILL[state];
  return (
    <span
      className="rounded-full px-2 py-0.5"
      style={{ ...eyebrow, fontSize: '9px', background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

/**
 * Square-ish rather than GitHub's circles, to match how the rest of the app
 * draws people (components/MessageList.tsx). That component resolves a Xyne
 * person by id; these are GitHub logins with no Xyne user behind them, so the
 * treatment is shared but the component cannot be.
 */
function Avatar({ src, name }: { src?: string; name?: string }) {
  if (src) {
    return <img src={src} alt="" className="size-5 shrink-0 rounded-md object-cover" style={{ background: c.line }} />;
  }
  return (
    <span
      className="grid size-5 shrink-0 place-items-center rounded-md"
      style={{ background: c.line, color: c.graphite, fontFamily: mono, fontSize: '9px' }}
      aria-hidden
    >
      {(name ?? '?').trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

/**
 * A personal access token, held per user. Only shown when a read actually
 * needed one — asking for a credential before anything has failed is how an
 * in-app view starts feeling less trustworthy than the tab it replaced.
 */
function TokenPanel({ ref_, onSaved }: { ref_: RepoRef; onSaved: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const label = HOST_LABEL[ref_.host];

  const submit = (): void => {
    if (!value.trim()) return;
    setBusy(true);
    setErr(null);
    void saveToken(ref_.host, value)
      .then(() => {
        setValue('');
        onSaved();
      })
      .catch(e => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mt-3 rounded-md p-3" style={{ background: c.ink, border: `1px solid ${c.line}` }}>
      <div style={{ ...eyebrow, color: c.graphite }}>{label} access token</div>
      <p className="mt-1.5 text-[12.5px]" style={{ color: c.graphite }}>
        {ref_.host === 'github'
          ? 'A token with the repo scope. Stored against your user only — nobody else in the workspace can read it.'
          : 'An access token, or an app password as username:password. Stored against your user only.'}
      </p>
      <div className="mt-2.5 flex gap-2">
        <input
          type="password"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder={ref_.host === 'github' ? 'ghp_…' : 'token or user:app_password'}
          className="min-w-0 flex-1 rounded px-2.5 py-1.5 outline-none"
          style={{ fontFamily: mono, fontSize: '12px', background: c.card, border: `1px solid ${c.line}` }}
        />
        <button
          onClick={submit}
          disabled={busy || !value.trim()}
          className="shrink-0 rounded px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-40"
          style={{ background: c.signal, color: c.signalText }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {err && (
        <p className="mt-2 text-[12px]" style={{ color: c.attention }}>
          {err}
        </p>
      )}
    </div>
  );
}

/** What went wrong, why, and the single thing worth doing about it. */
function Failure({
  kind,
  message,
  ref_,
  onRetry,
}: {
  kind: FailureKind;
  message: string;
  ref_: RepoRef;
  onRetry: () => void;
}) {
  const label = HOST_LABEL[ref_.host];
  const needsToken = kind === 'auth' || kind === 'notfound';

  return (
    <div className="rounded-lg p-4" style={{ background: c.attentionSoft, border: `1px solid ${c.line}` }}>
      <div className="flex items-baseline gap-2">
        <span style={{ ...eyebrow, color: c.attention }}>
          {kind === 'blocked'
            ? 'Request blocked'
            : kind === 'ratelimit'
              ? 'Rate limited'
              : needsToken
                ? 'Needs access'
                : 'Unavailable'}
        </span>
      </div>
      <p className="mt-1.5 text-[13px]" style={{ color: c.text }}>
        {message}
      </p>

      {kind === 'blocked' && (
        <p className="mt-2 text-[12.5px]" style={{ color: c.graphite }}>
          The Xyne desktop app restricts which hosts a Space may call, and {label} is not on that list. In a
          browser tab this same view loads normally — until the allowlist includes <code style={{ fontFamily: mono }}>
            api.{ref_.host === 'github' ? 'github.com' : 'bitbucket.org'}
          </code>, desktop can only offer the link out.
        </p>
      )}
      {kind === 'ratelimit' && (
        <p className="mt-2 text-[12.5px]" style={{ color: c.graphite }}>
          Unauthenticated reads share a small hourly budget per IP address. Adding a token raises it and makes it
          yours alone.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={onRetry}
          className="rounded px-2.5 py-1 text-[12.5px] font-medium"
          style={{ background: c.card, border: `1px solid ${c.line}`, color: c.text }}
        >
          Try again
        </button>
        <button
          onClick={() => openInHost(ref_.webUrl)}
          title={handoffHint()}
          className="text-[12.5px] font-medium"
          style={{ color: c.signal }}
        >
          {isDesktop() ? `Open the real ${label} page in Xyne ↗` : `Open on ${label} ↗`}
        </button>
      </div>

      {(needsToken || kind === 'ratelimit') && <TokenPanel ref_={ref_} onSaved={onRetry} />}
    </div>
  );
}

function Loading({ what }: { what: string }) {
  return <p style={{ fontFamily: mono, fontSize: '11px', color: c.mute }}>reading {what}…</p>;
}

function Empty({ what }: { what: string }) {
  return (
    <p className="text-[13px]" style={{ color: c.graphite }}>
      No {what} to show.
    </p>
  );
}

export function Repo({
  ref_,
  tab,
  onTab,
  reloadKey,
}: {
  ref_: RepoRef;
  tab: RepoTab;
  onTab: (tab: RepoTab) => void;
  /** Incremented by the chrome's reload button. */
  reloadKey: number;
}) {
  const [token, setToken] = useState<string | undefined>(undefined);
  const [tokenReady, setTokenReady] = useState(false);
  /** Bumped to force every in-flight read to start again after a token save. */
  const [nonce, setNonce] = useState(0);

  const [meta, setMeta] = useState<RepoMeta | null>(null);
  const [pulls, setPulls] = useState<PullRequest[] | null>(null);
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [branches, setBranches] = useState<Branch[] | null>(null);

  const [error, setError] = useState<{ kind: FailureKind; message: string } | null>(null);
  const [busy, setBusy] = useState(true);

  // Reload from the chrome discards everything held and re-reads, which is
  // exactly what the failure states' "Try again" does.
  useEffect(() => {
    if (reloadKey === 0) return;
    setPulls(null);
    setCommits(null);
    setBranches(null);
    setMeta(null);
    setTokenReady(false);
    setNonce(n => n + 1);
  }, [reloadKey]);

  const retry = useCallback(() => {
    setPulls(null);
    setCommits(null);
    setBranches(null);
    setMeta(null);
    setTokenReady(false);
    setNonce(n => n + 1);
  }, []);

  const fail = useCallback((e: unknown) => {
    if (e instanceof CodeHostError) setError({ kind: e.kind, message: e.message });
    else setError({ kind: 'unknown', message: e instanceof Error ? e.message : String(e) });
  }, []);

  // The token has to be in hand before the first read, or an unauthenticated
  // 404 on a private repo would ask for a credential the user already gave.
  useEffect(() => {
    let live = true;
    void loadTokens()
      .then(t => {
        if (!live) return;
        setToken(t[ref_.host]);
      })
      .catch(() => {})
      .finally(() => live && setTokenReady(true));
    return () => {
      live = false;
    };
  }, [ref_.host, nonce]);

  useEffect(() => {
    if (!tokenReady) return;
    let live = true;
    setBusy(true);
    setError(null);
    void fetchRepoMeta(ref_, token)
      .then(m => live && setMeta(m))
      .catch(e => live && fail(e))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [ref_, token, tokenReady, nonce, fail]);

  // Tabs load on first visit and are then held, so switching back is instant
  // and costs nothing against the host's rate limit.
  useEffect(() => {
    if (!tokenReady || error) return;
    let live = true;
    const branch = meta?.defaultBranch;

    if (tab === 'pulls' && pulls === null) {
      void fetchPulls(ref_, token).then(r => live && setPulls(r)).catch(e => live && fail(e));
    }
    if (tab === 'commits' && commits === null) {
      void fetchCommits(ref_, branch, token).then(r => live && setCommits(r)).catch(e => live && fail(e));
    }
    if (tab === 'branches' && branches === null) {
      void fetchBranches(ref_, branch, token).then(r => live && setBranches(r)).catch(e => live && fail(e));
    }
    return () => {
      live = false;
    };
  }, [tab, ref_, token, tokenReady, meta, pulls, commits, branches, error, fail]);

  const rowStyle = { borderBottom: `1px solid ${c.line}` };

  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-[22px] leading-none font-semibold tracking-tight">
            <span style={{ color: c.graphite }}>{ref_.owner}/</span>
            {ref_.name}
          </h1>
          <p className="mt-2 max-w-2xl text-[13.5px]" style={{ color: c.graphite }}>
            {busy && !meta ? 'Reading repository…' : (meta?.description ?? 'No description.')}
          </p>
        </div>
        <button
          onClick={() => openInHost(ref_.webUrl)}
          title={handoffHint()}
          className="shrink-0 rounded px-2.5 py-1 text-[12px] font-medium"
          style={{ background: c.signalSoft, color: c.signal }}
        >
          {isDesktop() ? `Open on ${HOST_LABEL[ref_.host]} in Xyne ↗` : `Open on ${HOST_LABEL[ref_.host]} ↗`}
        </button>
      </div>

      {meta && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1" style={{ fontFamily: mono, fontSize: '11px', color: c.mute }}>
          {meta.isPrivate !== undefined && <span>{meta.isPrivate ? 'private' : 'public'}</span>}
          {meta.defaultBranch && <span>default {meta.defaultBranch}</span>}
          {meta.language && <span>{meta.language}</span>}
          {meta.stars !== undefined && <span>{meta.stars} stars</span>}
          {meta.forks !== undefined && <span>{meta.forks} forks</span>}
          {meta.updatedAt && <span>updated {ago(meta.updatedAt)}</span>}
        </div>
      )}

      <div className="mt-6 flex gap-1 border-b" style={{ borderColor: c.line }}>
        {TABS.map(t => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onTab(t.id)}
              className="-mb-px px-3 py-2 text-[13px]"
              style={{
                color: on ? c.text : c.graphite,
                fontWeight: on ? 600 : 400,
                borderBottom: `2px solid ${on ? c.signal : 'transparent'}`,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {error ? (
          <Failure kind={error.kind} message={error.message} ref_={ref_} onRetry={retry} />
        ) : tab === 'pulls' ? (
          pulls === null ? (
            <Loading what="pull requests" />
          ) : pulls.length === 0 ? (
            <Empty what="pull requests" />
          ) : (
            <ul className="rounded-lg" style={{ background: c.card, border: `1px solid ${c.line}` }}>
              {pulls.map((p, i) => (
                <li key={p.number} className="px-4 py-3" style={i < pulls.length - 1 ? rowStyle : undefined}>
                  <div className="flex items-center gap-2.5">
                    <Pill state={p.state} />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{p.title}</span>
                    <span style={{ fontFamily: mono, fontSize: '10.5px', color: c.mute }}>#{p.number}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Avatar {...(p.avatar ? { src: p.avatar } : {})} {...(p.author ? { name: p.author } : {})} />
                    <span className="text-[12px]" style={{ color: c.graphite }}>
                      {p.author ?? 'unknown'}
                    </span>
                    {p.source && p.target && (
                      <span className="truncate" style={{ fontFamily: mono, fontSize: '10.5px', color: c.mute }}>
                        {p.source} → {p.target}
                      </span>
                    )}
                    <span className="ml-auto shrink-0" style={{ fontFamily: mono, fontSize: '10.5px', color: c.mute }}>
                      {ago(p.updatedAt ?? p.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : tab === 'commits' ? (
          commits === null ? (
            <Loading what="commits" />
          ) : commits.length === 0 ? (
            <Empty what="commits" />
          ) : (
            <ul className="rounded-lg" style={{ background: c.card, border: `1px solid ${c.line}` }}>
              {commits.map((x, i) => (
                <li
                  key={x.sha}
                  className="flex items-center gap-2.5 px-4 py-2.5"
                  style={i < commits.length - 1 ? rowStyle : undefined}
                >
                  <Avatar {...(x.avatar ? { src: x.avatar } : {})} {...(x.author ? { name: x.author } : {})} />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{x.subject}</span>
                  <span className="shrink-0 text-[12px]" style={{ color: c.graphite }}>
                    {x.author ?? ''}
                  </span>
                  <span className="shrink-0" style={{ fontFamily: mono, fontSize: '10.5px', color: c.mute }}>
                    {x.shortSha}
                  </span>
                  <span className="w-16 shrink-0 text-right" style={{ fontFamily: mono, fontSize: '10.5px', color: c.mute }}>
                    {ago(x.authoredAt)}
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : branches === null ? (
          <Loading what="branches" />
        ) : branches.length === 0 ? (
          <Empty what="branches" />
        ) : (
          <ul className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
            {branches.map(b => (
              <li
                key={b.name}
                className="flex items-center gap-2 rounded-md px-3 py-2"
                style={{ background: c.card, border: `1px solid ${b.isDefault ? c.signal : c.line}` }}
              >
                <span className="min-w-0 flex-1 truncate text-[13px]">{b.name}</span>
                {b.isDefault && <span style={{ ...eyebrow, fontSize: '9px', color: c.signal }}>default</span>}
                {b.sha && <span style={{ fontFamily: mono, fontSize: '10.5px', color: c.mute }}>{b.sha}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
