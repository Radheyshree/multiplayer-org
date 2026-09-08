/** Small field controls shared by the ticket view. */
import { useEffect, useState } from 'react';
import { allPeople, initials, nameOf, tintFor } from '../../lib/people';
import { c, eyebrow } from '../../lib/theme';
import { listProjectTags, type Tag } from '../../lib/tickets';

const control = { background: c.card, border: `1px solid ${c.line}` } as const;

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-start gap-3 py-2" style={{ borderTop: `1px solid ${c.line}` }}>
      <span className="pt-1" style={{ ...eyebrow, color: c.mute }}>
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function AssigneePicker({ current, onPick }: { current?: string | null; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const hits = q.trim()
    ? allPeople().filter(p => p.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6)
    : [];

  return (
    <div>
      {current ? (
        <span className="flex items-center gap-1.5 text-[13px]">
          <span
            className="grid size-5 place-items-center rounded text-white"
            style={{ background: tintFor(current), fontSize: '8px' }}
          >
            {initials(nameOf(current))}
          </span>
          {nameOf(current)}
        </span>
      ) : (
        <span className="text-[13px]" style={{ color: c.mute }}>
          Unassigned
        </span>
      )}
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Assign — type a name"
        className="mt-1.5 h-8 w-56 rounded-md px-2 text-[12.5px] outline-none"
        style={control}
      />
      {hits.map(p => (
        <button
          key={p.id}
          onClick={() => {
            setQ('');
            onPick(p.id);
          }}
          className="mt-1 block w-56 rounded px-2 py-1 text-left text-[12px] hover:bg-black/5"
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}

export function TagPicker({
  projectId,
  applied,
  onAdd,
}: {
  projectId: string;
  applied: string[];
  onAdd: (name: string) => void;
}) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    void listProjectTags(projectId).then(setTags).catch(() => setTags([]));
  }, [projectId]);

  const hits = q.trim()
    ? tags.filter(t => (t.name ?? t.tagName ?? '').toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8)
    : [];

  return (
    <div>
      {applied.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {applied.map(a => (
            <span
              key={a}
              className="rounded-full px-2 py-0.5 text-[11px]"
              style={{ background: c.signalSoft, color: c.signal }}
            >
              {a}
            </span>
          ))}
        </div>
      )}
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={tags.length ? `Add label — search ${tags.length}` : 'Loading labels…'}
        className="h-8 w-56 rounded-md px-2 text-[12.5px] outline-none"
        style={control}
      />
      {hits.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {hits.map(t => {
            const name = t.name ?? t.tagName ?? '';
            return (
              <button
                key={t.id}
                onClick={() => {
                  setQ('');
                  onAdd(name);
                }}
                className="rounded-full border px-2 py-0.5 text-[11px]"
                style={{ borderColor: c.line, color: c.graphite }}
              >
                + {name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
