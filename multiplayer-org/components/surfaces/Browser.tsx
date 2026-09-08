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
import { useEffect, useRef, useState } from 'react';
import { c, eyebrow, mono } from '../../lib/theme';
import type { HostId, RepoRef } from '../../lib/codehost';
import { handoffHint, isDesktop, openInHost } from '../../lib/host';
import { externalUrl, pageTitle, pageUrl, parsePageUrl, samePage, type Page, type RepoTab } from '../../lib/nav';
import { Repo } from './Repo';
import { Start } from './Start';

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

export function Browser() {
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab()]);
  const [activeId, setActiveId] = useState<string>(() => '');
  const [draft, setDraft] = useState('');
  const [bad, setBad] = useState(false);
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
                style={{ color: on ? c.text : '#B9BECC' }}
                title={title}
              >
                {title}
              </button>
              <button
                onClick={() => close(t.id)}
                aria-label={`Close ${title}`}
                className="shrink-0 rounded-full px-1 text-[12px] leading-none"
                style={{ color: on ? c.mute : '#6C7488' }}
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
          style={{ color: '#B9BECC' }}
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
