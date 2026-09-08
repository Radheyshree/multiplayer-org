/** Track list + creation. Creating a track also opens its real Xyne thread. */
import { useEffect, useMemo, useState } from 'react';
import { createTrack, listTracks, type Track } from '../lib/track';
import { xyne } from '../lib/xyne';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { ProvenanceDot } from './provenance';
import { Skeleton } from './ui/skeleton';

type Channel = { id: string; name?: string };

export function TrackList({ onOpen }: { onOpen: (t: Track) => void }) {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelQuery, setChannelQuery] = useState('');
  const [channelId, setChannelId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listTracks()
      .then(setTracks)
      .catch(e => {
        setError(e instanceof Error ? e.message : String(e));
        setTracks([]); // otherwise the skeletons stay up forever and hide the error
      });
  }, []);

  useEffect(() => {
    if (!creating || channels.length) return;
    void (async () => {
      const { spaces } = await xyne();
      const all = (await spaces.channels.listAll()) as unknown as Channel[];
      setChannels(all);
    })();
  }, [creating, channels.length]);

  const matches = useMemo(() => {
    const q = channelQuery.trim().toLowerCase();
    const pool = q ? channels.filter(c => (c.name ?? '').toLowerCase().includes(q)) : channels;
    return pool.slice(0, 8);
  }, [channels, channelQuery]);

  const submit = async () => {
    if (!title.trim() || !channelId) return;
    setBusy(true);
    setError(null);
    try {
      const chosen = channels.find(c => c.id === channelId);
      const track = await createTrack({
        title: title.trim(),
        channelId,
        ...(chosen?.name ? { channelName: chosen.name } : {}),
      });
      setTitle('');
      setChannelId('');
      setCreating(false);
      setTracks(prev => [track, ...(prev ?? [])]);
      onOpen(track);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Threadline</h1>
          <p className="text-muted-foreground text-sm">
            One surface per thing you're following — tickets, mail, calls and files in a single thread.
          </p>
        </div>
        <Button onClick={() => setCreating(v => !v)}>{creating ? 'Cancel' : 'New track'}</Button>
      </div>

      {creating && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New track</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="What are you following?" value={title} onChange={e => setTitle(e.target.value)} />
            <div className="space-y-2">
              <Input
                placeholder="Search a channel for its chat…"
                value={channelQuery}
                onChange={e => setChannelQuery(e.target.value)}
              />
              <div className="flex flex-wrap gap-1.5">
                {matches.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setChannelId(c.id)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition ${
                      channelId === c.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                    }`}
                  >
                    #{c.name ?? c.id.slice(0, 8)}
                  </button>
                ))}
                {channels.length === 0 && <Skeleton className="h-6 w-40" />}
              </div>
            </div>
            <Button onClick={() => void submit()} disabled={busy || !title.trim() || !channelId}>
              {busy ? 'Opening thread…' : 'Create track'}
            </Button>
          </CardContent>
        </Card>
      )}

      {error && (
        <div className="border-destructive/40 bg-destructive/5 rounded-lg border p-3 text-sm">
          <p className="text-destructive font-medium">Couldn't load tracks</p>
          <p className="text-muted-foreground mt-1 text-xs">{error}</p>
        </div>
      )}

      {tracks === null ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : tracks.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center text-sm">
          No tracks yet. Create one — it opens a real thread in the channel you pick.
        </p>
      ) : (
        <div className="space-y-2">
          {tracks.map(t => (
            <button
              key={t.id}
              onClick={() => onOpen(t)}
              className="hover:bg-muted/60 w-full rounded-lg border p-4 text-left transition"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{t.title}</span>
                <span className="text-muted-foreground text-xs">
                  {t.channelName ? `#${t.channelName}` : ''} · {t.nodes.length} linked
                </span>
              </div>
              {t.nodes.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {t.nodes.slice(0, 6).map(n => (
                    <ProvenanceDot key={n.refId} docType={n.docType} />
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
