import { CodeHostError, HOST_LABEL, ago, externalUrl, fetchBranches, fetchCommits, fetchPulls, fetchRepoMeta, loadTokens, pageTitle, pageUrl, parsePageUrl, samePage, saveToken, type Branch, type Commit, type FailureKind, type HostId, type Page, type PullRequest, type RepoMeta, type RepoRef, type RepoTab } from '../../lib/codehost';
import { Start } from './Start';
import { c, eyebrow, mono } from '../../lib/theme';
import { handoffHint, isDesktop, openInHost } from '../../lib/shell';
import { type OrgAppProps } from '../../orgApps/registry';
import { useCallback, useEffect, useRef, useState } from 'react';

/* ---- from components/surfaces/Repo.tsx -------------------------------- */
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

/* ---- from components/surfaces/Browser.tsx ----------------------------- */
/**
 * A browser, inside the app.
 *
 * Tabs, an address bar, back / forward / reload — the chrome behaves the way
 * the real thing does, and the address it shows is the real one, so a link
 * copied out of here works when pasted into Chrome and one pasted in from
 * Chrome opens here.
 *
 * What it is NOT is an embedded github.com. Both hosts send
 * `X-Frame-Options: deny` and `frame-ancestors 'none'`, and github.com serves
 * no CORS header, so neither framing the site nor fetching its HTML is possible
 * from a Space — and the Xyne artifact bridge has no window-management channel
 * to ask the desktop shell for a native webview. The pages below are therefore
 * rendered by us from each host's public API. The ↗ control is the honest exit
 * for anything this cannot show.
 */

type Tab = {
  id: string;
  history: Page[];
  /** Index into history — everything after it is the forward stack. */
  index: number;
  /** Bumped by the reload button; the page re-reads when it changes. */
  reloadKey: number;
};

const START: Page = { kind: 'start' };

const newTab = (page: Page = START): Tab => ({
  id: crypto.randomUUID(),
  history: [page],
  index: 0,
  reloadKey: 0,
});

/** A round chrome button. Disabled when the history has nowhere to go. */
function Control({
  label,
  glyph,
  onClick,
  disabled,
}: {
  label: string;
  glyph: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid size-7 shrink-0 place-items-center rounded-full text-[13px] transition-colors disabled:opacity-30"
      style={{ color: c.graphite }}
    >
      {glyph}
    </button>
  );
}

export function Browser({
  postUpdate,
  focused,
}: Pick<OrgAppProps, 'postUpdate' | 'focused'>) {
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab()]);
  const [activeId, setActiveId] = useState<string>(() => '');
  const [draft, setDraft] = useState('');
  const [bad, setBad] = useState(false);
  const [attached, setAttached] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The first tab's id is generated in the initialiser, so adopt it on mount
  // rather than duplicating the uuid call.
  const active = tabs.find(t => t.id === activeId) ?? tabs[0];
  useEffect(() => {
    if (active && active.id !== activeId) setActiveId(active.id);
  }, [active, activeId]);

  const page: Page = active.history[active.index];

  // The address bar follows the page, except while it is being typed into.
  const url = pageUrl(page);
  useEffect(() => {
    setDraft(url);
    setBad(false);
  }, [url, active.id]);

  const update = (id: string, fn: (t: Tab) => Tab): void =>
    setTabs(ts => ts.map(t => (t.id === id ? fn(t) : t)));

  const navigate = (next: Page): void => {
    update(active.id, t => {
      const current = t.history[t.index];
      if (current && samePage(current, next)) return t;
      // Going somewhere new discards the forward stack, as a browser does.
      const history = [...t.history.slice(0, t.index + 1), next];
      return { ...t, history, index: history.length - 1 };
    });
  };

  const go = (delta: number): void =>
    update(active.id, t => {
      const index = t.index + delta;
      return index < 0 || index >= t.history.length ? t : { ...t, index };
    });

  const reload = (): void => update(active.id, t => ({ ...t, reloadKey: t.reloadKey + 1 }));

  const open = (page_: Page): void => {
    const t = newTab(page_);
    setTabs(ts => [...ts, t]);
    setActiveId(t.id);
  };

  const close = (id: string): void => {
    // Computed outside the updater: setTabs may be invoked twice, and picking
    // the next active tab is a side effect that must happen exactly once.
    if (tabs.length === 1) {
      const fresh = newTab();
      setTabs([fresh]);
      setActiveId(fresh.id);
      return;
    }
    const i = tabs.findIndex(t => t.id === id);
    const rest = tabs.filter(t => t.id !== id);
    setTabs(rest);
    // Closing the active tab hands focus to its neighbour, as Chrome does.
    if (id === active.id) setActiveId((rest[Math.min(i, rest.length - 1)] as Tab).id);
  };

  const submit = (): void => {
    const next = parsePageUrl(draft);
    if (!next) {
      setBad(true);
      return;
    }
    setBad(false);
    navigate(next);
    inputRef.current?.blur();
  };

  const openRepo = (ref: RepoRef): void => navigate({ kind: 'repo', ref, tab: 'pulls' });
  const openHost = (host: HostId): void => navigate({ kind: 'host', host });
  const setRepoTab = (tab: RepoTab): void => {
    if (page.kind === 'repo') navigate({ kind: 'repo', ref: page.ref, tab });
  };

  /**
   * Record the page on screen against the focused ticket.
   *
   * The link written is `externalUrl(page)` — github.com's own address, not our
   * internal one — because the point is that it still resolves for someone
   * reading the ticket in Xyne, in Slack, or in six months.
   */
  const attach = async (): Promise<void> => {
    if (!focused || page.kind === 'start') return;
    setAttached(null);
    try {
      await postUpdate(focused, `Linked **${pageTitle(page)}** — ${externalUrl(page)}`, 'note');
      setAttached('Attached ✓');
      window.setTimeout(() => setAttached(null), 2500);
    } catch {
      setAttached('Could not attach');
      window.setTimeout(() => setAttached(null), 2500);
    }
  };

  const canBack = active.index > 0;
  const canForward = active.index < active.history.length - 1;

  return (
    <div className="flex h-full flex-col" style={{ background: c.paper }}>
      {/* Tab strip */}
      <div className="flex items-end gap-1 px-2 pt-2" style={{ background: c.ink }}>
        {tabs.map(t => {
          const on = t.id === active.id;
          const title = pageTitle(t.history[t.index]);
          return (
            <div
              key={t.id}
              className="flex min-w-0 max-w-[220px] flex-1 items-center gap-2 rounded-t-md px-3 py-1.5"
              style={{ background: on ? c.paper : c.inkSoft }}
            >
              <button
                onClick={() => setActiveId(t.id)}
                className="min-w-0 flex-1 truncate text-left text-[12.5px]"
                style={{ color: on ? c.text : c.mute }}
                title={title}
              >
                {title}
              </button>
              <button
                onClick={() => close(t.id)}
                aria-label={`Close ${title}`}
                className="shrink-0 rounded-full px-1 text-[12px] leading-none"
                style={{ color: c.mute }}
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          onClick={() => open(START)}
          aria-label="New tab"
          title="New tab"
          className="mb-1 grid size-6 shrink-0 place-items-center rounded text-[14px]"
          style={{ color: c.mute }}
        >
          +
        </button>
      </div>

      {/* Toolbar */}
      <div
        className="flex items-center gap-1.5 px-3 py-2"
        style={{ background: c.paper, borderBottom: `1px solid ${c.line}` }}
      >
        <Control label="Back" glyph="←" onClick={() => go(-1)} disabled={!canBack} />
        <Control label="Forward" glyph="→" onClick={() => go(1)} disabled={!canForward} />
        <Control label="Reload" glyph="⟳" onClick={reload} />

        <div
          className="mx-1 flex min-w-0 flex-1 items-center gap-2 rounded-full px-3 py-1"
          style={{ background: c.card, border: `1px solid ${bad ? c.attention : c.line}` }}
        >
          <span aria-hidden style={{ fontFamily: mono, fontSize: '10px', color: bad ? c.attention : c.mute }}>
            {bad ? '!' : '⌕'}
          </span>
          <input
            ref={inputRef}
            value={draft}
            onChange={e => {
              setDraft(e.target.value);
              setBad(false);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') {
                setDraft(url);
                setBad(false);
                inputRef.current?.blur();
              }
            }}
            spellCheck={false}
            placeholder="github.com/owner/repo — or paste a repository link"
            className="min-w-0 flex-1 bg-transparent outline-none"
            style={{ fontFamily: mono, fontSize: '12px', color: c.text }}
          />
          {bad && (
            <span className="shrink-0" style={{ ...eyebrow, fontSize: '9px', color: c.attention }}>
              not a GitHub or Bitbucket address
            </span>
          )}
        </div>

        {/* Attach before exit: the reason to be in here rather than in Chrome
            is that the page you are reading can be pinned to the work it is
            about. Disabled with the reason showing, never silently absent. */}
        <button
          onClick={() => void attach()}
          disabled={!focused || page.kind === 'start'}
          title={
            !focused
              ? 'Focus a ticket in the sidebar or the board first'
              : page.kind === 'start'
                ? 'Open a repository first'
                : `Record this page on ${focused.xyneId}`
          }
          className="shrink-0 rounded-full px-3 py-1 text-[12px] font-medium disabled:opacity-40"
          style={{ background: c.card, color: c.text, border: `1px solid ${c.line}` }}
        >
          {attached ?? (focused ? `Attach to ${focused.xyneId}` : 'Attach to ticket')}
        </button>

        <button
          onClick={() => openInHost(externalUrl(page))}
          title={handoffHint()}
          className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium"
          style={{ background: c.signalSoft, color: c.signal }}
        >
          {isDesktop() ? 'Open real site in Xyne' : 'Open real site'}
          <span aria-hidden>↗</span>
        </button>
      </div>

      <p
        className="px-3 py-1.5"
        style={{ fontFamily: mono, fontSize: '10px', color: c.mute, borderBottom: `1px solid ${c.line}` }}
      >
        {isDesktop()
          ? 'Rendered from the GitHub API. “Open real site in Xyne” loads github.com itself in Xyne’s browser panel.'
          : 'Rendered from the GitHub API — github.com blocks embedding, so the real site can only open in Xyne desktop’s browser panel or a new tab.'}
      </p>

      {/* Page */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {page.kind === 'repo' ? (
          <Repo
            key={`${active.id}:${page.ref.slug}`}
            ref_={page.ref}
            tab={page.tab}
            onTab={setRepoTab}
            reloadKey={active.reloadKey}
          />
        ) : (
          <Start
            {...(page.kind === 'host' ? { host: page.host } : {})}
            onOpenRepo={openRepo}
            onOpenHost={openHost}
          />
        )}
      </div>
    </div>
  );
}

/* ---- from components/surfaces/Code.tsx -------------------------------- */
/**
 * GitHub & Bitbucket.
 *
 * The surface is a browser: tabs, an address bar and history live in
 * Browser.tsx, the new-tab page in Start.tsx, and a repository's pull requests,
 * commits and branches in Repo.tsx. Nothing here opens a new browser tab any
 * more — the ↗ control in the chrome is the one deliberate way out.
 *
 * Its contribution to a ticket is the ATTACH control in the chrome: whatever
 * page you are on — a repo, a pull request, a commit list — can be recorded
 * against the focused ticket as a real link. That is the whole reason a code
 * host belongs inside this shell rather than in another browser window: the
 * connection between the change and the ticket stops living in someone's head.
 */

export function Code({ postUpdate, focused }: OrgAppProps) {
  return <Browser postUpdate={postUpdate} focused={focused} />;
}
