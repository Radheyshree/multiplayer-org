/**
 * Every app you have built, as a list you can actually work through.
 *
 * The home screen is for starting; this is for RETURNING, and the two want
 * different things. Coming back, you know roughly what you made and roughly
 * when — so the list is ordered by recency, searchable by name, and shows both
 * timestamps, because "updated 7 hours ago / created 3 days ago" tells you
 * which of two similar drafts is the live one and a single date does not.
 *
 * Paginated rather than infinite-scrolled: a fixed page with a stated total is
 * the thing you can navigate deliberately, and someone hunting for an app they
 * made last week is navigating, not browsing.
 */
import { useMemo, useState } from 'react';
import { c, eyebrow, mono } from '../../lib/theme';
import { riseIn, Shimmer } from './StudioFx';
import type { StudioProject } from '../../lib/studioStore';

type Sort = 'updated' | 'created' | 'name';
type Scope = 'mine' | 'recent';

const PAGE_SIZES = [10, 25, 50];

export function StudioApps({
  projects,
  loading,
  onOpen,
  onDelete,
  onNew,
}: {
  projects: StudioProject[];
  loading: boolean;
  onOpen: (project: StudioProject) => void;
  onDelete: (project: StudioProject) => void;
  onNew: () => void;
}) {
  const [scope, setScope] = useState<Scope>('mine');
  const [sort, setSort] = useState<Sort>('updated');
  const [query, setQuery] = useState('');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [confirming, setConfirming] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = projects.filter(p =>
      !q || p.title.toLowerCase().includes(q) || p.intent.toLowerCase().includes(q),
    );
    // "Recent" is a window, not a sort — the last two days of work, which is
    // what someone means when they say "the thing I was just doing".
    if (scope === 'recent') {
      const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
      rows = rows.filter(p => p.updatedAt >= cutoff);
    }
    const sorted = [...rows];
    if (sort === 'name') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'created') sorted.sort((a, b) => b.createdAt - a.createdAt);
    else sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    return sorted;
  }, [projects, query, scope, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages - 1);
  const rows = filtered.slice(current * pageSize, current * pageSize + pageSize);
  const from = filtered.length === 0 ? 0 : current * pageSize + 1;
  const to = Math.min(filtered.length, (current + 1) * pageSize);

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: c.text }}>
            Apps
          </h1>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Segmented
              options={[
                { id: 'mine', label: 'By you' },
                { id: 'recent', label: 'Recent' },
              ]}
              value={scope}
              onChange={next => {
                setScope(next as Scope);
                setPage(0);
              }}
            />

            <button
              onClick={onNew}
              className="rounded px-2.5 py-1.5 text-[11.5px]"
              style={{ fontFamily: mono, background: c.signal, color: c.paper }}
              title="Start a new app"
            >
              + New
            </button>

            <input
              value={query}
              onChange={e => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder="Search for an app"
              className="w-52 rounded-md px-2.5 py-1.5 text-[12.5px] outline-none"
              style={{ border: `1px solid ${c.line}`, background: c.card, color: c.text }}
            />
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-lg" style={{ border: `1px solid ${c.line}`, background: c.card }}>
          <div
            className="grid grid-cols-[1fr_170px_90px] items-center gap-3 px-4 py-2"
            style={{ borderBottom: `1px solid ${c.line}`, background: c.paper }}
          >
            <HeaderCell label="Name" active={sort === 'name'} onClick={() => setSort('name')} />
            {/* One column, two dates. Clicking it switches which one orders the
                list, and the header renames itself to say which — a header that
                turned into a sentence ("sorted by created") read as a status
                message rather than a column, which is not what a header is. */}
            <HeaderCell
              label={sort === 'created' ? 'Created' : 'Updated'}
              active={sort === 'updated' || sort === 'created'}
              onClick={() => setSort(sort === 'updated' ? 'created' : 'updated')}
            />
            <span style={{ ...eyebrow, color: c.mute }} className="text-right">
              Actions
            </span>
          </div>

          {loading ? (
            <ul aria-label="Loading">
              {[0, 1, 2, 3].map(i => (
                <li key={i} className="grid grid-cols-[1fr_170px_90px] items-center gap-3 px-4 py-2.5" style={{ borderTop: `1px solid ${c.line}` }}>
                  <span className="flex items-center gap-3">
                    <Shimmer w={30} h={30} r={8} />
                    <span><Shimmer w={180} h={12} /><Shimmer w={120} h={9} style={{ marginTop: 6 }} /></span>
                  </span>
                  <Shimmer w={90} h={10} />
                  <span className="flex justify-end"><Shimmer w={52} h={22} /></span>
                </li>
              ))}
            </ul>
          ) : rows.length === 0 ? (
            <Message
              text={
                query
                  ? `Nothing matches “${query}”.`
                  : scope === 'recent'
                    ? 'Nothing in the last two days. Switch to “By you” for everything.'
                    : 'No apps yet. Describe one on the New app screen and it appears here.'
              }
            />
          ) : (
            <ul>
              {rows.map((project, i) => (
                <li
                  key={project.id}
                  className="sfx-anim grid grid-cols-[1fr_170px_90px] items-center gap-3 px-4 py-2.5 transition-colors"
                  style={{ ...riseIn(i), borderTop: `1px solid ${c.line}` }}
                  onMouseEnter={e => { e.currentTarget.style.background = c.paper; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <button onClick={() => onOpen(project)} className="flex min-w-0 items-center gap-3 text-left">
                    <AppGlyph title={project.title} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium" style={{ color: c.text }}>
                        {project.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px]" style={{ color: c.graphite }}>
                        {summarise(project)}
                      </span>
                    </span>
                  </button>

                  <span>
                    <span className="block text-[12px]" style={{ color: c.text }}>
                      {ago(project.updatedAt)}
                    </span>
                    <span className="block text-[11px]" style={{ color: c.mute }}>
                      Created {ago(project.createdAt)}
                    </span>
                  </span>

                  <span className="flex justify-end">
                    {confirming === project.id ? (
                      <span className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            onDelete(project);
                            setConfirming(null);
                          }}
                          className="rounded px-1.5 py-1 text-[11px]"
                          style={{ fontFamily: mono, background: c.attention, color: c.paper }}
                        >
                          Sure?
                        </button>
                        <button
                          onClick={() => setConfirming(null)}
                          className="rounded px-1.5 py-1 text-[11px]"
                          style={{ fontFamily: mono, color: c.graphite, border: `1px solid ${c.line}` }}
                        >
                          No
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirming(project.id)}
                        className="rounded px-2 py-1 text-[11px]"
                        style={{ fontFamily: mono, color: c.mute, border: `1px solid ${c.line}` }}
                        title="Delete this draft. Only removes it from Studio."
                      >
                        Delete
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5">
            <span className="text-[11.5px]" style={{ color: c.graphite }}>
              Items per page
            </span>
            <select
              value={pageSize}
              onChange={e => {
                setPageSize(Number(e.target.value));
                setPage(0);
              }}
              className="rounded px-1.5 py-1 text-[11.5px] outline-none"
              style={{ fontFamily: mono, border: `1px solid ${c.line}`, background: c.card, color: c.text }}
            >
              {PAGE_SIZES.map(size => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>

          <span className="text-[11.5px]" style={{ fontFamily: mono, color: c.graphite }}>
            {from} – {to} of {filtered.length}
          </span>

          <div className="ml-auto flex items-center gap-1">
            <Pager label="|<" disabled={current === 0} onClick={() => setPage(0)} />
            <Pager label="<" disabled={current === 0} onClick={() => setPage(current - 1)} />
            <Pager label=">" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} />
            <Pager label=">|" disabled={current >= pages - 1} onClick={() => setPage(pages - 1)} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** A small segmented control. Two or three mutually exclusive views, no more. */
function Segmented({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded p-0.5" style={{ background: c.paper }}>
      {options.map(option => (
        <button
          key={option.id}
          onClick={() => onChange(option.id)}
          className="rounded px-2.5 py-1 text-[11.5px] transition-colors"
          style={{
            fontFamily: mono,
            background: value === option.id ? c.card : 'transparent',
            color: value === option.id ? c.text : c.graphite,
            ...(value === option.id ? { border: `1px solid ${c.line}` } : {}),
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function HeaderCell({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-left" aria-label={label}>
      <span style={{ ...eyebrow, color: active ? c.signal : c.mute }}>{label}</span>
      <span className="text-[9px]" style={{ color: active ? c.signal : 'transparent' }} aria-hidden>
        ↓
      </span>
    </button>
  );
}

function Message({ text }: { text: string }) {
  return (
    <p className="px-4 py-8 text-center text-[13px]" style={{ color: c.graphite }}>
      {text}
    </p>
  );
}

function Pager({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded px-1.5 py-1 text-[11px] disabled:opacity-30"
      style={{ fontFamily: mono, color: c.graphite, border: `1px solid ${c.line}`, background: c.card }}
    >
      {label}
    </button>
  );
}

/**
 * A coloured initial, derived from the title.
 *
 * Deterministic so an app keeps the same mark across sessions — the point is
 * that you recognise the row before you have finished reading it. Hashing the
 * title rather than storing a colour means nothing to migrate and no choice to
 * make at creation time.
 */
export function AppGlyph({ title, size = 30 }: { title: string; size?: number }) {
  const palette = ['#4B46E5', '#C8622F', '#35A06B', '#8A45C4', '#2F7FC8', '#C0392B'];
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  const background = palette[hash % palette.length];
  return (
    <span
      className="grid shrink-0 place-items-center rounded-md font-semibold"
      style={{ width: size, height: size, background, color: '#FFFFFF', fontSize: size * 0.42 }}
      aria-hidden
    >
      {(title.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

function summarise(project: StudioProject): string {
  const last = [...project.turns].reverse().find(t => t.summary);
  if (last?.summary) return last.summary;
  return project.intent.split('\n')[0] ?? 'No description yet.';
}

/** "7 hours ago". Coarse on purpose — nobody needs the minute from last week. */
export function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 45) return 'just now';
  const units: Array<[number, string]> = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [604800, 'week'],
  ];
  let value = seconds;
  let name = 'second';
  for (const [size, unit] of units) {
    if (seconds < size) break;
    value = Math.floor(seconds / size);
    name = unit;
  }
  return `${value} ${name}${value === 1 ? '' : 's'} ago`;
}
