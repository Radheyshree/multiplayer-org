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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { nameOf, personOf, resolveProfiles } from '../../lib/people';
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
import { agentsMentioned, mentionables, type Mentionable } from '../../lib/mentions';
import { AgentActivity } from './AgentActivity';
import { Composer } from './Composer';
import { MessageRow, type LedgerMessage } from './MessageRow';
import { Related } from './Related';
import { Surfaces } from './Surfaces';
import { learnFrom, loadMailThread, type MailThread } from '../../lib/mailthread';
import { MailBridge } from './MailBridge';
import { UpdateAgent } from './UpdateAgent';
import {
  applySuggestion,
  askText,
  detect,
  dismiss,
  enrich,
  factsFor,
  investigatePrompt,
  isDismissed,
  readNudgeState,
  SNOOZE_MS,
  type Nudge,
  type Suggestion,
  type ThreadMessage,
  type TicketRow,
} from '../../lib/nudge';
import { mentionHtml } from '../../lib/mentions';
import {
  bridge as makeBridge,
  bridgesInThread,
  candidatesFor,
  channelEmailAlias,
  channelMailFor,
  previewRecipients,
  replyByEmail,
  syncChannelMail,
  syncMail,
  type Candidate,
  type DeskRef,
} from '../../lib/mailbridge';

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
  meEmail,
  agents,
  busy,
  description,
  onSend,
  onRecord,
  onRecordFrom,
  onRefresh,
}: {
  item: WorkItem | null;
  messages: LedgerMessage[];
  /** The channel this thread lives in — the primary provenance signal. */
  channel?: ChannelLike | null;
  meId?: string;
  /** The signed-in address, so a reply-all can exclude it. */
  meEmail?: string;
  agents: AgentOption[];
  busy: boolean;
  description?: string;
  onSend: (text: string) => Promise<void>;
  /**
   * Record something attributed to this app rather than to the person typing.
   *
   * The agent's answer goes through here, so the ledger shows it as coming
   * from a surface rather than from whoever asked. Without it an agent reply
   * would appear under the asker's name, which is worse than not showing it.
   */
  onRecord?: (text: string, kind: 'activity' | 'note') => Promise<void>;
  /**
   * Record something attributed to a NAMED surface rather than to whichever app
   * tab happens to be open.
   *
   * `onRecord` stamps the open app, which is right for "the board moved a card"
   * and wrong for the update agent — its entries are the shell's, not the Kanban
   * board's, and a ledger that credits them to whatever tab was open would be
   * lying about where they came from. The shell still owns the target; only the
   * attribution is named here.
   */
  onRecordFrom?: (appId: string, text: string, kind: 'activity' | 'note') => Promise<void>;
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
  /**
   * The email thread behind this ticket, when there is one.
   *
   * Loaded separately because it is a separate read and most tickets have no
   * mail: `loadMailThread` returns null and the strip renders nothing rather
   * than a row of zeroes.
   */
  const [mail, setMail] = useState<MailThread | null>(null);
  /**
   * The mail bridge.
   *
   * `linked` comes off THIS ticket's own messages — free, exact, and available
   * the moment the thread loads. `offered` comes from the desk scan, which is
   * slow (19s cold) and therefore never blocks anything: it arrives late and
   * only adds a row.
   */
  const [offered, setOffered] = useState<Candidate[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  /** The address anyone can email to reach this track. */
  const [alias, setAlias] = useState<string | null>(null);
  /**
   * What the update agent has noticed about this ticket, if anything.
   *
   * Recomputed when the thread changes, because the thread is half the evidence
   * — answering the question the agent is nagging about should make the nag go
   * away without a reload.
   */
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const [nudgeBusy, setNudgeBusy] = useState<string | null>(null);
  const [nudgeNote, setNudgeNote] = useState<string | null>(null);
  /** Desk threads already synced this mount, so the poll does not re-sync. */
  const synced = useRef(new Set<string>());
  const endRef = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  /** Guards against a second evaluation starting while one is mid-dispatch. */
  const waking = useRef(false);
  /** The freshest thread, for reads inside async work that outlives a render. */
  const latest = useRef<LedgerMessage[]>([]);
  /** The open ticket's full row, read once so the poll does not re-read it. */
  const ticketRow = useRef<TicketRow | null>(null);

  const agent = agents.find(a => a.slug === agentSlug) ?? defaultAgent(agents);

  /**
   * Who can be @-mentioned here.
   *
   * Recomputed when the agent list changes, not on every keystroke — the
   * directory is four thousand rows and rebuilding it per character is the
   * difference between a menu that appears and one that stutters.
   */
  const candidates = useMemo(
    () => mentionables(agents, new Map(agents.filter(a => a.spacesAppUserId).map(a => [a.slug, a.spacesAppUserId as string]))),
    [agents],
  );

  // Titles and teams are not on the user row — they need a second call, made
  // only for the people actually on screen. See lib/people.ts.
  useEffect(() => {
    if (!messages.length) return;
    void resolveProfiles(messages.map(m => m.senderId)).then(changed => {
      if (changed) setRuns(r => [...r]); // cheap re-render; the map is module state
    });
  }, [messages]);

  useEffect(() => {
    latest.current = messages;
  }, [messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
    // `nudge?.key` is in here on purpose: the update agent's turn renders after
    // the last message, so a card that appears without this sits below the fold
    // on any thread long enough to scroll — which is every thread it has
    // something to say about.
  }, [messages.length, runs.length, nudge?.key]);

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
   * Run an agent on this ticket and leave a durable record of it.
   *
   * The bug this replaces: the run lived in component state, so the answer
   * vanished on reload and nobody else ever saw it. A conversation you cannot
   * come back to is not a record, and this whole surface is a record.
   *
   * So three things are written, in order:
   *   1. the QUESTION, as an ordinary message, before dispatching — if the run
   *      fails, the thread still shows that somebody asked;
   *   2. the ANSWER, attributed to this surface, when the run finishes;
   *   3. nothing at all if the platform already answered — see the guard.
   *
   * THE DOUBLE-ANSWER GUARD. `claw.run({channelId})` may post the reply itself,
   * and a `MESSAGE_RECEIVED` automation on the channel may run the same agent
   * off our mention. Either would land a real message in the thread, and then
   * posting ours too gives the reader the same answer twice. So before writing
   * we re-read the thread and look for a BOT message that arrived after we
   * dispatched. If one did, the platform got there first and we stay quiet.
   */
  const runAgent = useCallback(
    async (slug: string, agentName: string, task: string) => {
      if (!item) return;
      const chosen = agents.find(a => a.slug === slug);
      if (!chosen) return;
      setAsking(true);
      setError(null);
      const controller = new AbortController();
      abort.current = controller;
      const dispatchedAt = Date.now();
      try {
        const sessionId = await dispatch({
          agent: slug,
          task,
          conversationId: item.conversationId,
          ...(item.channelId ? { channelId: item.channelId } : {}),
        });
        setRuns(prev => [
          ...prev,
          { sessionId, agent: chosen, task, at: dispatchedAt, run: { sessionId, status: 'running' } },
        ]);

        const finished = await watchRun(
          sessionId,
          run => setRuns(prev => prev.map(r => (r.sessionId === sessionId ? { ...r, run } : r))),
          { signal: controller.signal },
        );
        setRuns(prev => prev.map(r => (r.sessionId === sessionId ? { ...r, run: finished } : r)));

        await onRefresh();
        const answer = finished.result?.trim();
        if (answer && onRecord) {
          const alreadyAnswered = latest.current.some(
            m => m.msgType === 'BOT' && m.createdAt > dispatchedAt,
          );
          if (!alreadyAnswered) {
            await onRecord(`**${agentName}**\n\n${answer}`, 'note');
            await onRefresh();
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setAsking(false);
      }
    },
    [item, agents, onRefresh, onRecord],
  );

  /**
   * Send what was typed, and dispatch anyone named in it.
   *
   * The message is posted either way — a mention of an agent is still something
   * a person said, and it belongs in the thread whether or not the agent
   * answers. Only then is the agent run, with the line as its task.
   */
  const submit = useCallback(
    async (html: string, text: string, mentioned: Mentionable[]) => {
      if (!item) return;
      await onSend(html);
      await onRefresh();
      const named = agentsMentioned(mentioned);
      for (const a of named) {
        if (!a.slug) continue;
        // Strip the @Name so the agent gets the request, not its own address.
        const task = text.replace(new RegExp(`@${a.name}\\s*`, 'g'), '').trim();
        await runAgent(a.slug, a.name, task || `Look at ${item.xyneId} and say where it stands.`);
      }
    },
    [item, onSend, onRefresh, runAgent],
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
        // Record WHY it woke before it runs. An agent that speaks in a thread
        // unprompted is alarming; one that says "I woke because a PR landed"
        // first is a colleague.
        await onRecord?.(`Woke automatically — ${decision.reason}`, 'activity').catch(() => {});
        // Same durable path as a person asking, so an autonomous answer is as
        // permanent as a requested one.
        await runAgent(chosen.slug, chosen.name, `${task}\n\n${context}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        waking.current = false;
      }
    })();
  }, [item, watch, messages, agents, agent, asking, onRefresh, onRecord, runAgent]);

  /**
   * The update agent's pass over this ticket.
   *
   * Deliberately runs on the THREAD changing rather than only on open: the whole
   * point of a nudge is that it goes away when it has been answered, and having
   * to reload to stop being asked would be worse than not being asked at all.
   *
   * It is also cheap enough to do that. The thread is already in memory, the
   * board's stages are cached per board, and the only new request is the ticket's
   * activity log — which is where the pull-request verdict lives and is the one
   * thing the ledger does not already hold.
   */
  useEffect(() => {
    if (!item) {
      setNudge(null);
      return;
    }
    let live = true;
    void (async () => {
      try {
        // The board id, creator and ETA are not on a WorkItem, so the ticket has
        // to be read once — but only once per ticket, not once per poll. The
        // thread changing is what re-runs the rules; the ticket record changing
        // is not something this effect is watching for.
        if (ticketRow.current?.id !== item.id) {
          ticketRow.current = await enrich({
            id: item.id,
            xyneId: item.xyneId,
            title: item.title,
            statusV2: item.statusV2,
            channelId: item.channelId,
            conversationId: item.conversationId,
          });
        }
        const facts = await factsFor(ticketRow.current, messages as unknown as ThreadMessage[]);
        if (!live) return;
        const found = facts ? detect(facts) : null;
        // A finding somebody has already waved away must not come back on the
        // next poll. Checked here rather than inside `detect` so the rules stay
        // pure and testable without storage.
        if (found) {
          const state = await readNudgeState(found.ticketId);
          if (live) setNudge(isDismissed(state, found) ? null : found);
        } else {
          setNudge(null);
        }
      } catch {
        // A ticket whose activity log will not load is a ticket with no nudge,
        // never a ticket that fails to open.
        if (live) setNudge(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [item?.id, messages]);

  /** Hand the finding to the agent and let it read the ticket properly. */
  const investigate = useCallback(async (): Promise<void> => {
    if (!item || !nudge || !agent) return;
    setNudgeBusy('investigate');
    try {
      const ownerName = nudge.ownerId ? personOf(nudge.ownerId).name : 'whoever owns it';
      const { task, context } = investigatePrompt(nudge, ownerName);
      await runAgent(agent.slug, agent.name, `${task}\n\n${context}`);
    } finally {
      setNudgeBusy(null);
    }
  }, [item, nudge, agent, runAgent]);

  /**
   * Take the suggestion.
   *
   * Two writes, in this order and never one without the other: the change
   * itself, then a line in the thread saying what changed and that the update
   * agent proposed it. The record is the part that matters in three months —
   * a ticket that silently became Completed tells the next reader nothing about
   * why, and "an agent suggested it and a person agreed" is exactly the thing
   * they will want to know.
   */
  const accept = useCallback(
    async (s: Suggestion): Promise<void> => {
      if (!item || !nudge) return;
      setNudgeBusy(s.label);
      setNudgeNote(null);
      try {
        // `reply` and `ask` change nothing on the ticket, so they short-circuit
        // before the shared write path rather than passing through it doing
        // nothing — the record line below must only ever describe a real change.
        if (s.kind === 'reply') {
          setNudgeNote('Say it in the box below — it goes on the ticket.');
          setNudgeBusy(null);
          return;
        }
        if (s.kind === 'ask') {
          setNudgeBusy(null);
          await investigate();
          return;
        }
        const recorded = await applySuggestion(nudge, s);
        if (!recorded) {
          setNudgeBusy(null);
          return;
        }
        await onRecordFrom?.('update-agent', recorded, 'activity');
        await onRefresh();
        setNudge(null);
        setNudgeNote(`${s.label} — done.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setNudgeBusy(null);
      }
    },
    [item, nudge, onRecordFrom, onRefresh, investigate],
  );

  /**
   * Ask the person who owes the update, by name, in the thread.
   *
   * A REAL mention span, not the text "@Name" — the backend parses these out of
   * `content` on send, adds the person to the conversation and notifies them.
   * That is the whole delivery mechanism: without it the nudge only works on
   * somebody who was already looking at the ticket, which is precisely the
   * person who does not need it.
   */
  const askOwner = useCallback(async (): Promise<void> => {
    if (!item || !nudge?.ownerId) return;
    setNudgeBusy('ask');
    setNudgeNote(null);
    try {
      const person = personOf(nudge.ownerId);
      const mention = mentionHtml({ userId: person.id, name: person.name });
      await onRecordFrom?.('update-agent', `${mention} ${askText(nudge)}`, 'note');
      await onRefresh();
      setNudgeNote(`Asked ${person.name} on the ticket.`);
      setNudge(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setNudgeBusy(null);
    }
  }, [item, nudge, onRecordFrom, onRefresh]);

  /**
   * Learn how this deployment writes Zoho URLs, from any message that carries
   * one. Done on every thread rather than once at boot because the URL only
   * appears on ingested rows — whichever ticket is open first teaches the app,
   * and every ticket after it can link its mail back out.
   */
  useEffect(() => {
    learnFrom(messages);
  }, [messages]);

  const linked: DeskRef[] = useMemo(() => bridgesInThread(messages), [messages]);

  /**
   * Copy anything new off the linked mail threads.
   *
   * Runs when a ticket opens and whenever a new bridge appears — not on every
   * poll: `syncMail` reads the desk's mail and this ticket's whole thread, and
   * doing that every five seconds to discover nothing would be the most
   * expensive no-op in the app. New mail arrives in minutes, not seconds, and
   * "Sync now" is there for impatience.
   */
  const runSync = useCallback(
    async (refs: DeskRef[], announce: boolean): Promise<void> => {
      if (!item || refs.length === 0) return;
      setSyncing(true);
      try {
        let copied = 0;
        for (const desk of refs) {
          const r = await syncMail({ desk, workConversationId: item.conversationId });
          copied += r.copied;
          synced.current.add(desk.conversationId);
        }
        if (copied > 0) {
          setSyncNote(`${copied} mail${copied === 1 ? '' : 's'} copied.`);
          await onRefresh();
        } else if (announce) {
          setSyncNote('Up to date.');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSyncing(false);
      }
    },
    [item, onRefresh],
  );

  useEffect(() => {
    const fresh = linked.filter(d => !synced.current.has(d.conversationId));
    if (fresh.length) void runSync(fresh, false);
  }, [linked, runSync]);

  useEffect(() => {
    synced.current = new Set();
    setOffered([]);
    setSyncNote(null);
    setAlias(null);
    void channelEmailAlias(item?.channelId).then(a => setAlias(a));
    if (!item?.xyneId) return;
    let live = true;
    // Track-addressed mail: cheap and scoped to this one channel, so unlike the
    // desk scan it can run per ticket. Mirrored straight away — the sender chose
    // to address this track, which is consent enough.
    void channelMailFor(item.channelId, item.xyneId).then(async mails => {
      if (!live || mails.length === 0) return;
      const r = await syncChannelMail(mails, item.conversationId);
      if (live && r.copied > 0) {
        setSyncNote(`${r.copied} emailed to this track.`);
        await onRefresh();
      }
    });
    // Deliberately not awaited into the render path — see `loadCandidates`.
    void candidatesFor(item.xyneId).then(rows => {
      if (live) setOffered(rows);
    });
    return () => {
      live = false;
    };
  }, [item?.id, item?.xyneId]);

  useEffect(() => {
    let live = true;
    setMail(null);
    if (!item) return;
    void loadMailThread(item).then(m => {
      if (live) setMail(m);
    });
    return () => {
      live = false;
    };
  }, [item?.id, item?.conversationId, item?.channelId, messages.length]);

  /**
   * The thread, minus anything mirrored twice.
   *
   * A mirrored line carries the id of the thing it mirrors, so a duplicate is
   * exactly detectable rather than guessed at. `syncMail` holds a lock that
   * stops one page racing itself; this covers the case it cannot — a second
   * browser tab on the same ticket, both syncing, both writing. The first copy
   * wins because it is the one already in the record.
   */
  const visible = messages
    .filter(m => matchesLayer(layer, parseUpdate(m.content ?? ''), m.msgType === 'BOT'))
    .filter((m, i, all) => {
      const ref = parseUpdate(m.content ?? '').ref;
      if (!ref) return true;
      return all.findIndex(o => parseUpdate(o.content ?? '').ref === ref) === i;
    });

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
          {/* Which systems this work is spread across. Computed from the same
              rows the thread badges, so the two can never disagree. */}
          <Surfaces messages={messages} channel={channel} mail={mail} />

          {/* The mail thread the PR is being discussed on, if there is one. */}
          <MailBridge
            linked={linked}
            offered={offered.filter(o => !linked.some(l => l.conversationId === o.desk.conversationId))}
            syncing={syncing}
            note={syncNote}
            onLink={async cand => {
              if (!item) return;
              setSyncing(true);
              try {
                await makeBridge({
                  desk: cand.desk,
                  work: {
                    id: item.id,
                    conversationId: item.conversationId,
                    ...(item.xyneId ? { xyneId: item.xyneId } : {}),
                    ...(item.title ? { title: item.title } : {}),
                  },
                  notification: cand.notification,
                });
                await syncMail({ desk: cand.desk, workConversationId: item.conversationId });
                synced.current.add(cand.desk.conversationId);
                setOffered(prev => prev.filter(o => o.desk.id !== cand.desk.id));
                await onRefresh();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setSyncing(false);
              }
            }}
            {...(linked[0] && meEmail
              ? {
                  previewRecipients: async () =>
                    (await previewRecipients(linked[0] as DeskRef, [meEmail])).to,
                }
              : {})}
            {...(alias ? { alias } : {})}
            onSync={() => runSync(linked, true)}
            onReply={async body => {
              const desk = linked[0];
              if (!desk) return;
              const { to } = await replyByEmail({
                desk,
                body,
                // Our own addresses, so a reply-all does not mail us a copy that
                // would come back in as a new inbound message.
                self: [meEmail, ...(meEmail ? [] : [])].filter(Boolean) as string[],
              });
              setSyncNote(`Sent to ${to.join(', ')}.`);
              // The sent mail becomes an Email row on the desk thread; copying it
              // back is what puts the reply in this conversation.
              synced.current.delete(desk.conversationId);
              await runSync([desk], true);
            }}
          />

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

            {/* The update agent's turn.
                Last in the thread, above the composer, because it is the most
                recent thing anyone said about this ticket and because the reply
                to it is the box directly below. */}
            <UpdateAgent
              nudge={nudge}
              {...(meId ? { meId } : {})}
              busy={nudgeBusy}
              note={nudgeNote}
              onAccept={accept}
              onAsk={askOwner}
              onInvestigate={investigate}
              onSnooze={async () => {
                if (!nudge) return;
                await dismiss(nudge.ticketId, nudge.key, SNOOZE_MS, meId);
                setNudge(null);
              }}
              onDismiss={async () => {
                if (!nudge) return;
                await dismiss(nudge.ticketId, nudge.key, 0, meId);
                setNudge(null);
              }}
            />

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

            <Composer
              placeholder={`Message ${item.xyneId} — or @mention an agent`}
              candidates={candidates}
              disabled={busy || asking}
              onSubmit={submit}
            />

            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() =>
                  agent &&
                  void runAgent(
                    agent.slug,
                    agent.name,
                    `Read the full conversation on ${item.xyneId} — it holds the record from every surface that touched this ticket — and summarise where it stands and what is blocking it.`,
                  )
                }
                disabled={asking || !agent}
                className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] disabled:opacity-40"
                style={{ background: c.agentSoft, color: c.agent }}
                title="Ask the agent where this ticket stands"
              >
                <span aria-hidden>✦</span>
                {asking ? 'Working…' : 'Ask about this ticket'}
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
