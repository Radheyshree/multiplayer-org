/**
 * Everything the update agent has noticed, across every ticket.
 *
 * The per-ticket card in the ledger only helps somebody who already opened the
 * ticket — and the problem this feature was asked about is precisely the tickets
 * nobody opens: "I have lots of stale tickets where I have merged the PRs but
 * never updated the status." Those are invisible by definition. This is where
 * they become visible.
 *
 * On the workspace it was built against that is 33 findings over 76 open
 * tickets: eleven that shipped with a release and never closed, eleven whose
 * pull request merged and whose ticket never moved, eight declined with nothing
 * replacing them, one review open since July, one passed ETA and one that has
 * said nothing in a fortnight. All of it read in about nine seconds.
 *
 * THREE THINGS THIS DOES NOT DO, each on purpose.
 *
 *   NO BULK ACCEPT. "Close all 14" is one click away from fourteen wrong
 *   closures and no way to tell which. Every suggestion is taken one at a time,
 *   against a row that says what it is about.
 *   NO ACTING FOR SOMEBODY ELSE. A finding whose owner is not you offers the
 *   button that asks them, not the button that changes their ticket.
 *   NO SILENT TRUNCATION. The scan states how many tickets it read of how many
 *   there are. A queue that quietly examined a third of your work while looking
 *   authoritative is worse than no queue.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  alreadyAsked,
  applySuggestion,
  askRef,
  askText,
  dismiss,
  scan,
  SNOOZE_MS,
  type Nudge,
  type NudgeRule,
  type Suggestion,
  type TicketRow,
} from '../lib/nudge';
import { mentionHtml } from '../lib/mentions';
import { initials, personOf, tintFor } from '../lib/people';
import { c, eyebrow, mono } from '../lib/theme';
import { BrandMark } from './ledger/BrandMark';
import type { WorkItem } from '../lib/workitem';
import { xyne } from '../lib/xyne';

/** One thread, read at click time so "already asked" is checked against truth. */
async function threadOf(conversationId: string): Promise<Array<{ content?: string }>> {
  try {
    const { spaces } = await xyne();
    const page = await spaces.messages.listByConversation(conversationId, { limit: 100 });
    return (page as unknown as { items?: Array<{ content?: string }> }).items ?? [];
  } catch {
    return [];
  }
}

/** Section headings, in the order the rules themselves are ranked. */
const SECTION: Record<NudgeRule, string> = {
  unanswered: 'Waiting on you',
  shipped: 'Shipped, and still open',
  'pr-merged': 'The code landed, the ticket did not move',
  'pr-open': 'Still waiting on a review',
  'pr-declined': 'The code did not land',
  'eta-passed': 'The date has passed',
  'gone-quiet': 'Gone quiet',
  unowned: 'Nobody owns these',
};

const RULE_ORDER: NudgeRule[] = [
  'unanswered',
  'shipped',
  'pr-merged',
  'pr-open',
  'pr-declined',
  'eta-passed',
  'gone-quiet',
  'unowned',
];

/** Rows per section before "show the rest" — 16 declined PRs is a wall. */
const FOLD = 5;

export function UpdateQueue({
  tickets,
  meId,
  /** Open a ticket's thread on the right. */
  onOpen,
  /** Post into a ticket that is NOT the one on screen. */
  onPost,
}: {
  tickets: TicketRow[];
  meId?: string;
  onOpen: (t: WorkItem) => void;
  onPost: (
    ticket: { conversationId: string },
    appId: string,
    text: string,
    kind: 'activity' | 'note',
    ref?: string,
  ) => Promise<void>;
}) {
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [coverage, setCoverage] = useState<{ examined: number; total: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(true);
  const [expanded, setExpanded] = useState<Set<NudgeRule>>(new Set());
  const abort = useRef<AbortController | null>(null);

  const run = useCallback(async (): Promise<void> => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setScanning(true);
    setError(null);
    try {
      const r = await scan(tickets, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setNudges(r.nudges);
      setCoverage({ examined: r.examined, total: r.total });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, [tickets]);

  // Runs when the ticket list arrives, and not on a timer. Findings age in days;
  // re-reading eighty activity logs on an interval would spend a lot to discover
  // that nothing had changed since a minute ago.
  useEffect(() => {
    if (tickets.length) void run();
    return () => abort.current?.abort();
  }, [tickets.length]);

  const visible = useMemo(
    () => (mineOnly && meId ? nudges.filter(n => n.ownerId === meId) : nudges),
    [nudges, mineOnly, meId],
  );

  const bySection = useMemo(() => {
    const m = new Map<NudgeRule, Nudge[]>();
    for (const n of visible) m.set(n.rule, [...(m.get(n.rule) ?? []), n]);
    return m;
  }, [visible]);

  const forget = useCallback(
    async (n: Nudge, forMs: number): Promise<void> => {
      await dismiss(n.ticketId, n.key, forMs, meId);
      setNudges(prev => prev.filter(x => x.key !== n.key));
    },
    [meId],
  );

  const accept = useCallback(
    async (n: Nudge, s: Suggestion): Promise<void> => {
      setBusy(n.key);
      setError(null);
      try {
        if (s.kind === 'reply' || s.kind === 'ask') {
          // Nothing to change from here — these need the ticket's own thread,
          // so open it rather than pretending the button did something.
          onOpen(toWork(n));
          return;
        }
        const recorded = await applySuggestion(n, s);
        if (recorded) {
          await onPost({ conversationId: n.conversationId }, 'update-agent', recorded, 'activity');
        }
        setNudges(prev => prev.filter(x => x.key !== n.key));
      } catch (e) {
        setError(e instanceof Error ? e.message : `Could not update ${n.xyneId}.`);
      } finally {
        setBusy(null);
      }
    },
    [onOpen, onPost],
  );

  const askOwner = useCallback(
    async (n: Nudge): Promise<void> => {
      if (!n.ownerId) return;
      setBusy(n.key);
      setError(null);
      try {
        // The digest does not hold the thread, so it reads it once here rather
        // than trusting its own memory — a colleague may have asked this same
        // question from their own tab five minutes ago.
        const thread = await threadOf(n.conversationId);
        if (alreadyAsked(thread, n.key)) {
          setError(`${n.xyneId} has already been asked about this.`);
          setNudges(prev => prev.filter(x => x.key !== n.key));
          return;
        }
        const person = personOf(n.ownerId);
        await onPost(
          { conversationId: n.conversationId },
          'update-agent',
          `${mentionHtml({ userId: person.id, name: person.name })} ${askText(n)}`,
          'note',
          askRef(n.key),
        );
        setNudges(prev => prev.filter(x => x.key !== n.key));
      } catch (e) {
        setError(e instanceof Error ? e.message : `Could not post to ${n.xyneId}.`);
      } finally {
        setBusy(null);
      }
    },
    [onPost],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span style={{ ...eyebrow, fontSize: '9px', color: c.graphite }}>needs an update</span>
        <span className="text-[12px]" style={{ color: c.mute }}>
          {scanning
            ? 'Reading your tickets…'
            : coverage
              ? `${visible.length} across ${coverage.examined} open ticket${coverage.examined === 1 ? '' : 's'}${
                  coverage.examined < coverage.total ? ` of ${coverage.total}` : ''
                }`
              : 'Nothing read yet.'}
        </span>

        {meId ? (
          <button
            onClick={() => setMineOnly(v => !v)}
            className="rounded px-1.5 py-0.5 text-[11px]"
            style={{
              color: mineOnly ? c.signal : c.mute,
              background: mineOnly ? c.signalSoft : 'transparent',
              border: `1px solid ${mineOnly ? 'transparent' : c.line}`,
            }}
            title="Only the ones that are yours to answer"
          >
            {mineOnly ? 'Yours' : 'Everyone’s'}
          </button>
        ) : null}

        <button
          onClick={() => void run()}
          disabled={scanning}
          className="rounded px-1.5 py-0.5 text-[11px] disabled:opacity-40"
          style={{ color: c.signal }}
        >
          {scanning ? 'Reading…' : 'Read again'}
        </button>
      </div>

      {error ? (
        <p
          className="rounded-md px-2.5 py-1.5 text-[11.5px]"
          style={{ background: c.attentionSoft, color: c.attention }}
        >
          {error}
        </p>
      ) : null}

      {!scanning && visible.length === 0 ? (
        <p className="text-[13px]" style={{ color: c.mute }}>
          {nudges.length > 0
            ? 'Nothing here is yours to answer. Switch to “Everyone’s” to see the rest.'
            : 'Nothing needs an update. Every open ticket is either moving or finished.'}
        </p>
      ) : null}

      {RULE_ORDER.map(rule => {
        const rows = bySection.get(rule);
        if (!rows?.length) return null;
        const open = expanded.has(rule);
        const shown = open ? rows : rows.slice(0, FOLD);
        return (
          <section key={rule} className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2">
              <h3 className="text-[12.5px] font-medium" style={{ color: c.text }}>
                {SECTION[rule]}
              </h3>
              <span style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}>{rows.length}</span>
            </div>

            {shown.map(n => (
              <Row
                key={n.key}
                nudge={n}
                {...(meId ? { meId } : {})}
                busy={busy === n.key}
                onOpen={() => onOpen(toWork(n))}
                onAccept={s => accept(n, s)}
                onAsk={() => askOwner(n)}
                onSnooze={() => forget(n, SNOOZE_MS)}
                onDismiss={() => forget(n, 0)}
              />
            ))}

            {rows.length > FOLD ? (
              <button
                onClick={() =>
                  setExpanded(prev => {
                    const next = new Set(prev);
                    if (next.has(rule)) next.delete(rule);
                    else next.add(rule);
                    return next;
                  })
                }
                className="self-start px-1 text-[11px]"
                style={{ color: c.signal }}
              >
                {open ? 'Show fewer' : `Show the other ${rows.length - FOLD}`}
              </button>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function Row({
  nudge: n,
  meId,
  busy,
  onOpen,
  onAccept,
  onAsk,
  onSnooze,
  onDismiss,
}: {
  nudge: Nudge;
  meId?: string;
  busy: boolean;
  onOpen: () => void;
  onAccept: (s: Suggestion) => Promise<void>;
  onAsk: () => Promise<void>;
  onSnooze: () => Promise<void>;
  onDismiss: () => Promise<void>;
}) {
  const owner = n.ownerId ? personOf(n.ownerId) : null;
  const mine = Boolean(n.ownerId && n.ownerId === meId);
  // The first suggestion that changes something AND is not destructive.
  //
  // Both halves matter. `reply` and `ask` need the ticket open, so they make a
  // poor primary in a list. And a destructive one makes a worse primary still:
  // "the PR was declined" leads with an invitation to talk about it, not with a
  // blue button that cancels the work — a row that offers only that offers
  // nothing here, and sends you to the ticket instead.
  const primary = n.suggestions.find(
    s => !s.destructive && (s.kind === 'stage' || s.kind === 'status' || s.kind === 'eta'),
  );

  return (
    <div
      className="flex flex-col gap-1 rounded-lg px-3 py-2"
      style={{ border: `1px solid ${c.line}`, background: c.card }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <BrandMark system="claw" size={14} />
        <button
          onClick={onOpen}
          className="shrink-0 tabular-nums"
          style={{ fontFamily: mono, fontSize: '10.5px', color: c.signal }}
          title="Open this ticket"
        >
          {n.xyneId}
        </button>
        <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: c.text }}>
          {n.title}
        </span>
        {owner ? (
          <span className="flex shrink-0 items-center gap-1" title={`${owner.name} — ${n.ownerReason}`}>
            <span
              className="grid size-4 place-items-center rounded-[3px] text-[7px] font-medium text-white"
              style={{ background: tintFor(owner.id) }}
              aria-hidden
            >
              {initials(owner.name)}
            </span>
            <span className="text-[11px]" style={{ color: c.mute }}>
              {mine ? 'you' : owner.name}
            </span>
          </span>
        ) : null}
      </div>

      <p className="text-[12px] leading-snug" style={{ color: c.text }}>
        {n.ask}
      </p>
      <p className="text-[11px]" style={{ color: c.mute }}>
        {n.because}
      </p>

      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
        {mine || !owner ? (
          primary ? (
            <button
              onClick={() => void onAccept(primary)}
              disabled={busy}
              className="rounded-md px-2 py-0.5 text-[11.5px] font-medium disabled:opacity-40"
              style={{ background: c.signal, color: c.signalText }}
            >
              {busy ? 'Working…' : primary.label}
            </button>
          ) : (
            <button
              onClick={onOpen}
              className="rounded-md px-2 py-0.5 text-[11.5px] font-medium"
              style={{ background: c.signal, color: c.signalText }}
            >
              Look at it
            </button>
          )
        ) : (
          <button
            onClick={() => void onAsk()}
            disabled={busy}
            className="rounded-md px-2 py-0.5 text-[11.5px] font-medium disabled:opacity-40"
            style={{ background: c.signal, color: c.signalText }}
          >
            {busy ? 'Asking…' : `Ask ${owner.name.split(/\s+/)[0]}`}
          </button>
        )}

        {primary || (!mine && owner) ? (
          <button
            onClick={onOpen}
            className="rounded-md px-2 py-0.5 text-[11.5px]"
            style={{ border: `1px solid ${c.line}`, color: c.text }}
          >
            Open it
          </button>
        ) : null}

        <span className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => void onSnooze()}
            disabled={busy}
            className="text-[11px] disabled:opacity-40"
            style={{ color: c.mute }}
            title="Ask again in three days"
          >
            Later
          </button>
          <button
            onClick={() => void onDismiss()}
            disabled={busy}
            className="text-[11px] disabled:opacity-40"
            style={{ color: c.mute }}
            title="Stop asking about this, for everyone on the ticket"
          >
            Never mind
          </button>
        </span>
      </div>
    </div>
  );
}

/** A finding carries everything the shell needs to focus the ticket it is about. */
const toWork = (n: Nudge): WorkItem => ({
  id: n.ticketId,
  xyneId: n.xyneId,
  title: n.title,
  statusV2: '',
  priority: '',
  channelId: n.channelId,
  conversationId: n.conversationId,
});
