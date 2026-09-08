/**
 * The unified chat — a real Xyne conversation, rendered with provenance.
 *
 * Nothing here is app-local state: every message is a real message in a real
 * thread, so the same conversation is visible in Xyne itself. Polled, because
 * the SDK has no push channel.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { listAgents, listMessages, postMessage, runAgent, type AgentOption, type ChatMessage, type RunStep } from '../lib/chat';
import { heartbeat, listViewers, type Track, type Viewer } from '../lib/track';
import { xyne } from '../lib/xyne';
import { Avatar, AvatarFallback } from './ui/avatar';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Separator } from './ui/separator';

const POLL_MS = 4000;

function initials(name: string): string {
  return name.split(/\s+/).map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
}

export function Chat({ track }: { track: Track }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agent, setAgent] = useState<string>('');
  const [draft, setDraft] = useState('');
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [running, setRunning] = useState(false);
  const [meId, setMeId] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const msgs = await listMessages(track.conversationId);
    setMessages(msgs);

    // Resolve sender names once per unseen id.
    const unknown = [...new Set(msgs.map(m => m.senderId))].filter(id => id && !names[id]);
    if (unknown.length) {
      const { spaces } = await xyne();
      const profiles = (await spaces.users.getProfiles(unknown)) as unknown as Array<Record<string, string>>;
      if (profiles?.length) {
        setNames(prev => {
          const next = { ...prev };
          for (const p of profiles) {
            const id = p.id ?? p.userId;
            if (id) next[id] = p.displayName || p.name || p.email || id.slice(0, 8);
          }
          return next;
        });
      }
    }
  }, [track.conversationId, names]);

  useEffect(() => {
    void (async () => {
      const { spaces } = await xyne();
      const me = await spaces.users.me();
      setMeId(me.id);
      setAgents(await listAgents().catch(() => []));
    })();
  }, []);

  useEffect(() => {
    void refresh();
    void heartbeat(track.id);
    const id = setInterval(() => {
      void refresh();
      void heartbeat(track.id);
      void listViewers(track.id).then(setViewers);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [track.id, refresh]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');

    if (agent) {
      setRunning(true);
      setSteps([]);
      try {
        // The agent replies into this same thread — that's what conversationId does.
        await runAgent({
          agent,
          task: text,
          conversationId: track.conversationId,
          context: `Track "${track.title}". Linked items: ${track.nodes.map(n => `${n.title} (${n.docType})`).join('; ') || 'none yet'}.`,
          onStep: s => setSteps(prev => [...prev, s]),
        });
      } catch (err) {
        setSteps(prev => [...prev, { label: err instanceof Error ? err.message : 'failed', status: 'error', at: Date.now() }]);
      } finally {
        setRunning(false);
        void refresh();
      }
    } else {
      await postMessage(track.conversationId, text);
      void refresh();
    }
  };

  const others = viewers.filter(v => v.userId !== meId);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex -space-x-2">
          {viewers.slice(0, 4).map(v => (
            <Avatar key={v.userId} className="ring-background size-7 ring-2">
              <AvatarFallback className="text-[10px]">{initials(v.name)}</AvatarFallback>
            </Avatar>
          ))}
        </div>
        <span className="text-muted-foreground text-xs font-medium tracking-[0.2em] uppercase">Chat</span>
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          {others.length > 0 ? (
            <>
              <span className="size-2 rounded-full bg-emerald-500" />
              {others[0].name} is looking at this
              {others.length > 1 ? ` +${others.length - 1}` : ''}
            </>
          ) : (
            <>
              <span className="bg-muted-foreground/40 size-2 rounded-full" />
              only you
            </>
          )}
        </span>
      </header>

      <Separator />

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="text-muted-foreground py-8 text-center text-sm">
            No messages yet — this thread is live in Xyne too.
          </p>
        )}

        {messages.map(m => {
          const name = names[m.senderId] ?? m.senderId.slice(0, 8);
          const isBot = m.msgType === 'BOT';
          return (
            <div key={m.messageId} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Avatar className="size-6">
                  <AvatarFallback className="text-[10px]">{initials(name)}</AvatarFallback>
                </Avatar>
                <span className="text-sm font-semibold">{name}</span>
                {isBot && <span className="text-muted-foreground text-xs">agent</span>}
                <span className="text-muted-foreground text-xs">
                  {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="bg-muted/60 ml-8 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
                {m.content}
              </div>
            </div>
          );
        })}

        {running && (
          <div className="ml-8 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {steps.map((s, i) => (
                <span key={i} className="bg-background rounded-full border px-2.5 py-1 text-xs">
                  {s.label}
                </span>
              ))}
              <span className="text-muted-foreground animate-pulse rounded-full border px-2.5 py-1 text-xs">
                working…
              </span>
            </div>
          </div>
        )}
        <div ref={bottom} />
      </div>

      <Separator />

      <div className="space-y-2 p-3">
        <div className="flex items-center gap-2">
          <Select value={agent} onValueChange={setAgent}>
            <SelectTrigger className="h-8 w-[190px] text-xs">
              <SelectValue placeholder="Post as me (no agent)" />
            </SelectTrigger>
            <SelectContent>
              {agents.slice(0, 60).map(a => (
                <SelectItem key={a.slug} value={a.slug} className="text-xs">
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {agent && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setAgent('')}>
              clear
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={agent ? `Ask ${agent}…` : 'Message this track…'}
            disabled={running}
          />
          <Button size="icon" onClick={() => void send()} disabled={running || !draft.trim()}>
            ↑
          </Button>
        </div>
      </div>
    </div>
  );
}
