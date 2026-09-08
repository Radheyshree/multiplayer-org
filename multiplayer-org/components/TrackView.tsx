/**
 * The unified surface: pinned work on the left, the workbench in the middle,
 * the shared thread on the right. One screen for a whole track — which is the
 * entire point, since the alternative is four browser tabs.
 */
import { useState } from 'react';
import { unpinNode, type Track, type TrackNode } from '../lib/track';
import { Chat } from './Chat';
import { Discover } from './Discover';
import { Provenance, ProvenanceDot } from './provenance';
import { Button } from './ui/button';
import { Separator } from './ui/separator';

function NodeDetail({ node, track, onUnpinned }: { node: TrackNode; track: Track; onUnpinned: (t: Track) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4 p-5">
      <div className="space-y-1.5">
        <Provenance docType={node.docType} />
        <h2 className="text-lg leading-snug font-semibold">{node.title}</h2>
        {node.subtitle && <p className="text-muted-foreground text-sm">{node.subtitle}</p>}
      </div>
      <Separator />
      <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted-foreground">Pinned by</dt>
        <dd>{node.addedByName ?? node.addedBy.slice(0, 8)}</dd>
        <dt className="text-muted-foreground">Pinned</dt>
        <dd>{new Date(node.addedAt).toLocaleString()}</dd>
        <dt className="text-muted-foreground">Reference</dt>
        <dd className="font-mono text-xs break-all">{node.refId}</dd>
      </dl>
      <Separator />
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void unpinNode(track.id, node.refId)
            .then(onUnpinned)
            .finally(() => setBusy(false));
        }}
      >
        Unpin from track
      </Button>
    </div>
  );
}

export function TrackView({ track, onChange, onBack }: { track: Track; onChange: (t: Track) => void; onBack: () => void }) {
  const [focused, setFocused] = useState<string | null>(null);
  const node = track.nodes.find(n => n.refId === focused) ?? null;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Tracks
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{track.title}</h1>
          <p className="text-muted-foreground text-xs">
            {track.channelName ? `#${track.channelName}` : 'thread'} · {track.nodes.length} linked
          </p>
        </div>
      </header>

      <Separator />

      <div className="grid min-h-0 flex-1 grid-cols-[15rem_1fr_24rem]">
        {/* Linked work */}
        <aside className="min-h-0 overflow-y-auto border-r">
          <p className="text-muted-foreground px-3 pt-3 pb-1.5 text-[11px] font-medium tracking-wider uppercase">
            Linked
          </p>
          {track.nodes.length === 0 && (
            <p className="text-muted-foreground px-3 py-2 text-xs">
              Nothing pinned. Use the middle pane to find related work.
            </p>
          )}
          {track.nodes.map(n => (
            <button
              key={n.refId}
              onClick={() => setFocused(f => (f === n.refId ? null : n.refId))}
              className={`hover:bg-muted/60 w-full border-b px-3 py-2.5 text-left transition ${
                focused === n.refId ? 'bg-muted' : ''
              }`}
            >
              <ProvenanceDot docType={n.docType} />
              <p className="mt-0.5 line-clamp-2 text-xs font-medium">{n.title}</p>
            </button>
          ))}
        </aside>

        {/* Workbench — the focused item, or discovery when nothing is focused */}
        <main className="min-h-0 overflow-y-auto">
          {node ? (
            <NodeDetail node={node} track={track} onUnpinned={t => { onChange(t); setFocused(null); }} />
          ) : (
            <Discover track={track} onPinned={onChange} />
          )}
        </main>

        {/* The shared thread */}
        <aside className="min-h-0 border-l">
          <Chat track={track} />
        </aside>
      </div>
    </div>
  );
}
