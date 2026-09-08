import { useEffect, useState } from 'react';
import { loadPins, savePins, SURFACES, type Entry, type SurfaceId } from './lib/apps';
import { xyne } from './lib/xyne';
import { AppStore } from './components/AppStore';
import { Boundary } from './components/Boundary';
import { Shell } from './components/Shell';
import { Board } from './components/surfaces/Board';
import { Chat } from './components/surfaces/Chat';
import { Code } from './components/surfaces/Code';
import { Desk } from './components/surfaces/Desk';
import { Scribe } from './components/surfaces/Scribe';
import { Studio } from './components/surfaces/Studio';
import { TrackList } from './components/TrackList';
import { TrackView } from './components/TrackView';
import type { Track } from './lib/track';

function Threadline() {
  const [open, setOpen] = useState<Track | null>(null);
  return open ? (
    <TrackView track={open} onChange={setOpen} onBack={() => setOpen(null)} />
  ) : (
    <TrackList onOpen={setOpen} />
  );
}

function Surface({ id }: { id: SurfaceId }) {
  switch (id) {
    case 'threadline':
      return <Threadline />;
    case 'board':
      return <Board />;
    case 'chat':
      return <Chat />;
    case 'desk':
      return <Desk />;
    case 'scribe':
      return <Scribe />;
    case 'repos':
      return <Code />;
    case 'studio':
      return <Studio />;
  }
}

export default function App() {
  const [pins, setPins] = useState<string[]>([]);
  const [active, setActive] = useState<Entry | null>(null);
  const [identity, setIdentity] = useState<{ name: string; workspace: string } | null>(null);

  useEffect(() => {
    void loadPins().then(setPins).catch(() => setPins(SURFACES.slice(0, 4).map(s => s.key)));
    void (async () => {
      const { spaces } = await xyne();
      const me = await spaces.users.me();
      setIdentity({ name: me.displayName || me.name || me.email, workspace: me.workspaceId });
    })().catch(() => {});
  }, []);

  const togglePin = (e: Entry) => {
    const next = pins.includes(e.key) ? pins.filter(k => k !== e.key) : [...pins, e.key];
    setPins(next);
    void savePins(next).catch(() => {});
  };

  const pinned = pins
    .map(k => SURFACES.find(s => s.key === k))
    .filter((s): s is Entry => Boolean(s));

  return (
    <Shell
      pinned={pinned}
      activeKey={active?.key ?? null}
      onOpen={e => e.surface && setActive(e)}
      onStore={() => setActive(null)}
      identity={identity}
    >
      <Boundary label={active?.name ?? 'The app store'}>
        {active?.surface ? (
          <Surface id={active.surface} />
        ) : (
          <AppStore pins={pins} onOpen={e => e.surface && setActive(e)} onPin={togglePin} />
        )}
      </Boundary>
    </Shell>
  );
}
