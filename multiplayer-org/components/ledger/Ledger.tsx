/**
 * The unified surface for one piece of work.
 *
 * Two tabs over the same ticket:
 *
 *   Thread   everything that HAPPENED — people talking, apps recording what
 *            they did, webhooks from the code host, and agents answering, all
 *            in one ordered record, each line badged with where it came from.
 *   Related  everything that EXISTS — the mail, files, calls and other tickets
 *            about the same work, found by search rather than by a link table.
 *
 * The point of the first tab is that you do not have to go anywhere else to
 * find out what happened; the point of the second is that you do not have to
 * remember what else was involved. Between them there is nothing left to copy
 * and paste, which is the whole thesis.
 *
 * AGENTS ARE PARTICIPANTS, NOT A SIDEBAR. Asking one runs it against this
 * ticket's own conversation, and its work appears inline — a live step list of
 * every tool it called, then its answer, in the same column as everyone else's
 * messages. A person reading later sees the agent's turn exactly where it
 * happened, with the same provenance treatment as a human's.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { matchesLayer, parseUpdate, type Layer } from '../../lib/appUpdate';
import {
  defaultAgent,
  dispatch,
  isFailure,
  isTerminal,
  watchRun,
  type AgentOption,
  type AgentRun,
} from '../../lib/agentrun';
import { nameOf, resolveProfiles } from '../../lib/people';
import {
  afterRun,
  afterSkip,
  evaluate,
  IDLE,
  isWake,
  readState,
  wakePrompt,
  writeState,
  type WatchMessage,
  type WatchState,
} from '../../lib/watcher';
import type { ChannelLike } from '../../lib/provenance';
import { c, eyebrow, mono } from '../../lib/theme';
import type { WorkItem } from '../../lib/workitem';
import { AgentActivity } from './AgentActivity';
import { MessageRow, type LedgerMessage } from './MessageRow';
import { Related } from './Related';

const LAYERS: Array<{ id: Layer; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'people', label: 'People' },
  { id: 'apps', label: 'Apps' },
  { id: 'agent', label: 'Agent' },
];

/** A run this session started, kept on screen next to the turn that caused it. */
interface LocalRun {
  sessionId: string;
  agent: AgentOption;
  task: string;
  at: number;
  run: AgentRun;
}

export function Ledger({
  item,
  messages,
  channel,
  meId,
  agents,
  busy,
  description,
  onSend,
  onRefresh,
}: {
  item: WorkItem | null;
  messages: LedgerMessage[];
  /** The channel this thread lives in — the primary provenance signal. */
  channel?: ChannelLike | null;
  meId?: string;
  agents: AgentOption[];
  busy: boolean;
  description?: string;
  onSend: (text: string) => Promise<void>;
  onRefresh: () => void | Promise<void>;
}) {
  const [tab, setTab] = useState<'thread' | 'related'>('thread');
  const [layer, setLayer] = useState<Layer>('all');
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState(false);
  const [agentSlug, setAgentSlug] = useState('');
  const [runs, setRuns] = useState<LocalRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [watch, setWatch] = useState<WatchState>(IDLE);
  const [watchNote, setWatchNote] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  /** Guards against a second evaluation starting while one is mid-dispatch. */
  const waking = useRef(false);

  const agent = agents.find(a => a.slug === agentSlug) ?? defaultAgent(agents);

  // Titles and teams are not on the user row — they need a second call, made
  // only for the people actually on screen. See lib/people.ts.
  useEffect(() => {
    if (!messages.length) return;
    void resolveProfiles(messages.map(m => m.senderId)).then(changed => {
      if (changed) setRuns(r => [...r]); // cheap re-render; the map is module state
    });
  }, [messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, runs.length]);

  // Runs belong to the ticket that started them.
  useEffect(() => {
    abort.current?.abort();
    setRuns([]);
    setError(null);
  }, [item?.id]);

  useEffect(() => () => abort.current?.abort(), []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !item) return;
    setDraft('');
    setError(null);
    try {
      await onSend(text);
    } catch (e) {
      setDraft(text); // never silently eat what someone typed
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [draft, item, onSend]);

  /**
   * Ask the agent about this ticket.
   *
   * The run is bound to the ticket's own conversation, so the agent reads the
   * same record everyone else is reading — which is what makes its answer worth
   * anything. Its progress is polled (`claw.getRun` returns far more than its
   * type admits; see lib/agentrun.ts) and rendered inline as it goes.
   */
  const ask = useCallback(
    async (task: string) => {
      if (!item || !agent) return;
      setAsking(true);
      setError(null);
      const controller = new AbortController();
      abort.current = controller;
      try {
        const sessionId = await dispatch({
          agent: agent.slug,
          task,
          conversationId: item.conversationId,
          ...(item.channelId ? { channelId: item.channelId } : {}),
        });
        const local: LocalRun = {
          sessionId,
          agent,
          task,
          at: Date.now(),
          run: { sessionId, status: 'running' },
        };
        setRuns(prev => [...prev, local]);

        const finished = await watchRun(
          sessionId,
          run => setRuns(prev => prev.map(r => (r.sessionId === sessionId ? { ...r, run } : r))),
          { signal: controller.signal },
        );
        setRuns(prev => prev.map(r => (r.sessionId === sessionId ? { ...r, run: finished } : r)));
        // The agent may have posted into the thread itself; re-read either way,
        // and let the reconciliation below decide what to keep on screen.
        await onRefresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setAsking(false);
      }
    },
    [item, agent, onRefresh],
  );

  /** Load the shared watch state whenever the ticket changes. */
  useEffect(() => {
    if (!item) return;
    let live = true;
    void readState(item.id).then(st => live && setWatch(st));
    return () => {
      live = false;
    };
  }, [item?.id]);

  const toggleWatch = useCallback(async () => {
    if (!item || !agent) return;
    const next: WatchState = watch.armed
      ? { ...watch, armed: false }
      : {
          armed: true,
          agentSlug: agent.slug,
          // Start from now, not from zero: arming a watcher should not make it
          // immediately respond to a conversation that happened last week.
          watermarkAt: Date.now(),
          recentRuns: watch.recentRuns,
          ...(meId ? { armedBy: meId } : {}),
          armedAt: Date.now(),
        };
    setWatch(next);
    setWatchNote(null);
    try {
      await writeState(item.id, next);
    } catch (e) {
      setWatch(watch); // put the switch back if it did not stick
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [item, agent, watch, meId]);

  /**
   * The autonomous pass.
   *
   * Runs whenever the thread changes — the shell is already polling it, so this
   * costs no extra requests. `evaluate` is a pure ordered gate (lib/watcher.ts);
   * nothing here asks a model whether to ask a model.
   *
   * TWO PEOPLE, ONE TICKET. Awakening claims its work with `FOR UPDATE SKIP
   * LOCKED`; we have no lock, so we do the cheap equivalent — write the
   * advanced watermark BEFORE dispatching, then read it back. If someone else's
   * tab won the race their write lands after ours and the read shows a
   * watermark we did not write, so we stand down. It is not airtight — two
   * writes inside the same round trip could both appear to win — but it turns a
   * routine double-fire into a rare one, and the rate limit bounds the damage.
   */
  useEffect(() => {
    if (!item || !watch.armed || waking.current || asking) return;
    const decision = evaluate(watch, messages as unknown as WatchMessage[]);

    if (!isWake(decision)) {
      if (decision.skip === 'nothing-to-do') {
        // Move past what we looked at, or every poll re-judges the same rows.
        const advanced = afterSkip(watch, messages as unknown as WatchMessage[]);
        if (advanced.watermarkAt !== watch.watermarkAt) {
          setWatch(advanced);
          void writeState(item.id, advanced).catch(() => {});
        }
      }
      if (decision.skip === 'rate-limited') setWatchNote(decision.detail ?? 'Rate limited.');
      return;
    }

    const chosen = agents.find(a => a.slug === watch.agentSlug) ?? agent;
    if (!chosen) return;

    waking.current = true;
    void (async () => {
      const claimed = afterRun(watch, decision.window);
      try {
        await writeState(item.id, claimed);
        const confirmed = await readState(item.id);
        if (confirmed.watermarkAt !== claimed.watermarkAt) {
          // Somebody else's tab took this window.
          setWatch(confirmed);
          return;
        }
        setWatch(claimed);
        setWatchNote(decision.reason);

        const { task, context } = wakePrompt(decision, item.xyneId, nameOf);
        const sessionId = await dispatch({
          agent: chosen.slug,
          task,
          context,
          conversationId: item.conversationId,
          ...(item.channelId ? { channelId: item.channelId } : {}),
        });
        setRuns(prev => [
          ...prev,
          { sessionId, agent: chosen, task: decision.reason, at: Date.now(), run: { sessionId, status: 'running' } },
        ]);
        const finished = await watchRun(sessionId, run =>
          setRuns(prev => prev.map(r => (r.sessionId === sessionId ? { ...r, run } : r))),
        );
        setRuns(prev => prev.map(r => (r.sessionId === sessionId ? { ...r, run: finished } : r)));
        await onRefresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        waking.current = false;
      }
    })();
  }, [item, watch, messages, agents, agent, asking, onRefresh]);

  const visible = messages.filter(m =>
    matchesLayer(layer, parseUpdate(m.content ?? ''), m.msgType === 'BOT'),
  );

  if (!item) {
    return (
      <div className="grid flex-1 place-items-center p-6">
        <p className="text-center text-[13px]" style={{ color: c.mute }}>
          Open a ticket to see everything about it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Tabs. Two views of one ticket, never two places to look. */}
      <div className="flex shrink-0 items-center gap-1 px-3 pt-2" style={{ borderBottom: `1px solid ${c.line}` }}>
        {(['thread', 'related'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="rounded-t-md px-2.5 py-1.5 text-[12px] transition-colors"
            style={{
              color: tab === t ? c.text : c.mute,
              borderBottom: `2px solid ${tab === t ? c.signal : 'transparent'}`,
              fontWeight: tab === t ? 500 : 400,
            }}
          >
            {t === 'thread' ? 'Thread' : 'Related'}
          </button>
        ))}
      </div>

      {tab === 'related' ? (
        <Related
          item={item}
          {...(description ? { description } : {})}
          onPin={async text => {
            await onSend(text);
            setTab('thread');
          }}
        />
      ) : (
        <>
          {/* Layers. Completeness for the agent, legibility for people. */}
          <div className="flex shrink-0 items-center gap-1 px-3 py-1.5" style={{ borderBottom: `1px solid ${c.line}` }}>
            {LAYERS.map(l => (
              <button
                key={l.id}
                onClick={() => setLayer(l.id)}
                className="rounded px-1.5 py-0.5 text-[11px]"
                style={{
                  color: layer === l.id ? c.signal : c.mute,
                  background: layer === l.id ? c.signalSoft : 'transparent',
                }}
              >
                {l.label}
              </button>
            ))}
            <span className="ml-auto" style={{ ...eyebrow, fontSize: '9px', color: c.mute }}>
              context ledger
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto py-2">
            {visible.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-[13px]" style={{ color: c.mute }}>
                  {layer === 'all'
                    ? 'Nothing recorded on this ticket yet.'
                    : `Nothing in the ${layer} layer. Try “All”.`}
                </p>
                <p className="mt-1 text-[11px]" style={{ color: c.mute }}>
                  Work done in any app lands here, with its source.
                </p>
              </div>
            ) : (
              visible.map((m, i) => (
                <MessageRow
                  key={m.messageId}
                  message={m}
                  {...(visible[i - 1] ? { previous: visible[i - 1] } : {})}
                  channel={channel}
                  {...(meId ? { meId } : {})}
                />
              ))
            )}

            {/* Runs this session started. They sit after the thread because
                that is when they happened; once the agent's reply lands as a
                real message the activity block stays as the working behind it. */}
            {runs.map(r => (
              <div key={r.sessionId} className="flex gap-2 px-4 py-1.5">
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-md text-[13px]"
                  style={{ background: c.agentSoft, color: c.agent }}
                  aria-hidden
                >
                  ✦
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13.5px] font-semibold" style={{ color: c.agent }}>
                      {r.agent.name}
                    </span>
                    <span style={{ fontFamily: mono, fontSize: '9.5px', color: c.mute }}>
                      asked about {item.xyneId}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px]" style={{ color: c.mute }}>
                    {r.task}
                  </p>
                  <div className="mt-1.5">
                    <AgentActivity run={r.run} />
                  </div>
                  {isTerminal(r.run.status) && r.run.result ? (
                    <div
                      className="mt-1.5 whitespace-pre-wrap rounded-md px-2.5 py-2 text-[13px] leading-relaxed"
                      style={{ background: c.card, border: `1px solid ${c.line}`, color: c.text }}
                    >
                      {r.run.result}
                    </div>
                  ) : null}
                  {isFailure(r.run.status) && !r.run.result ? (
                    <p className="mt-1 text-[12px]" style={{ color: c.danger }}>
                      {r.run.error || 'The agent could not finish.'}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {/* Composer. One box, two ways to speak: to the people on the ticket,
              or to the agent that can act on it. */}
          <div className="shrink-0 px-3 py-2.5" style={{ borderTop: `1px solid ${c.line}` }}>
            {error ? (
              <p
                className="mb-2 flex items-start gap-2 rounded-md px-2.5 py-1.5 text-[11.5px]"
                style={{ background: c.attentionSoft, color: c.attention }}
              >
                <span className="flex-1">{error}</span>
                <button onClick={() => setError(null)} aria-label="Dismiss" style={{ color: c.mute }}>
                  ✕
                </button>
              </p>
            ) : null}

            <div className="flex items-center gap-2">
              <input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && draft.trim()) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={`Message ${item.xyneId}…`}
                disabled={busy}
                className="h-8 min-w-0 flex-1 rounded-md px-2.5 text-[12.5px] outline-none"
                style={{ background: c.card, border: `1px solid ${c.line}`, color: c.text }}
              />
              <button
                onClick={() => void send()}
                disabled={busy || !draft.trim()}
                className="h-8 shrink-0 rounded-md px-3 text-[12px] font-medium disabled:opacity-40"
                style={{ background: c.signal, color: c.signalText }}
              >
                Send
              </button>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() =>
                  void ask(
                    draft.trim() ||
                      `Read the full conversation on ${item.xyneId} — it holds the record from every surface that touched this ticket — and summarise where it stands and what is blocking it.`,
                  )
                }
                disabled={asking || !agent}
                className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] disabled:opacity-40"
                style={{ background: c.agentSoft, color: c.agent }}
                title={
                  draft.trim()
                    ? 'Send what you typed to the agent instead of to the thread'
                    : 'Ask the agent where this ticket stands'
                }
              >
                <span aria-hidden>✦</span>
                {asking ? 'Working…' : draft.trim() ? 'Ask the agent this' : 'Ask about this ticket'}
              </button>

              {agents.length > 1 ? (
                <select
                  value={agent?.slug ?? ''}
                  onChange={e => setAgentSlug(e.target.value)}
                  className="h-6 min-w-0 max-w-[11rem] rounded px-1 text-[11px] outline-none"
                  style={{ background: 'transparent', color: c.mute, border: `1px solid ${c.line}` }}
                  aria-label="Which agent"
                >
                  {agents.map(a => (
                    <option key={a.slug} value={a.slug}>
                      {a.name}
                    </option>
                  ))}
                </select>
              ) : null}

              {!agents.length ? (
                <span className="text-[11px]" style={{ color: c.mute }}>
                  No agents are enabled on this deployment.
                </span>
              ) : null}
            </div>

            {/* Autonomy.
                Labelled "while this is open" rather than "always", because that
                is the truth: Xyne's own Awakening runs server-side on a tick
                worker, and it is not reachable from an app (see lib/watcher.ts).
                This watches from the browser, so it watches while somebody has
                the ticket open. Claiming otherwise would be the one lie in a
                surface whose entire point is that you can trust what it says. */}
            {agents.length ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void toggleWatch()}
                  className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px]"
                  style={{
                    background: watch.armed ? c.liveSoft : 'transparent',
                    color: watch.armed ? c.live : c.mute,
                    border: `1px solid ${watch.armed ? 'transparent' : c.line}`,
                  }}
                  title={
                    watch.armed
                      ? 'The agent wakes on mentions, PR events, and questions left unanswered for ten minutes'
                      : 'Let the agent act on this ticket without being asked'
                  }
                >
                  <span aria-hidden className={watch.armed ? 'animate-pulse' : ''}>
                    {watch.armed ? '◉' : '○'}
                  </span>
                  {watch.armed ? 'Agent is watching' : 'Let the agent watch'}
                </button>

                <span className="min-w-0 flex-1 truncate text-[10.5px]" style={{ color: c.mute }}>
                  {watch.armed
                    ? watchNote ??
                      `wakes on a mention, a PR event, or a question left open · ${
                        watch.recentRuns.filter(t => Date.now() - t < 3_600_000).length
                      }/4 this hour`
                    : 'while this ticket is open in a browser'}
                </span>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
