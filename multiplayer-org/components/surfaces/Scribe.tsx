/**
 * Xyne Scribe — calls, and what came out of them.
 *
 * A call is the only place in an org where the reasoning is said out loud and
 * then thrown away. The recording survives; the reason nobody reopens it is
 * that a recording is an hour long and a decision is one sentence. So this
 * surface is built around the sentences: what was decided, what was promised,
 * and — one press away — the moment in the call where it was said.
 *
 * WHERE THE DATA COMES FROM, and why there are three sources rather than one.
 *
 *   the listings   `calls.listHistory` / `listRecordings` / `listSharedRecordings`
 *                  and friends. These carry the good stuff — `aiSummary` and
 *                  `markedItems` arrive on every row, so the summary and the
 *                  decision ledger cost no extra request. They are also the
 *                  ONLY source for those two fields. What they cannot do is
 *                  take a channel: there is no track-scoped listing.
 *
 *   the search index `search.query({ type: 'calls', in: channelId })`. The only
 *                  way to ask "calls on this track" and get a server-side
 *                  answer, and the only free-text search over calls there is.
 *                  It returns attendee names already resolved, which the
 *                  listings do not. It does not return summaries.
 *
 *   the enrichment `lib/callsBeyondSdk.ts` — the transcript, the citation index
 *                  and the duration, none of which the SDK exposes at all. It
 *                  is one file, one route, and everything it produces is marked
 *                  in the UI so the SDK boundary stays checkable.
 *
 * The three are joined on the call id. None of them is complete on its own, and
 * pretending otherwise is what the previous version of this surface did: it
 * filtered a 25-row personal listing by `channelId` and reported "no calls on
 * this track" — for a track with 38 of them, on rows where `channelId` is null.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  durationOf,
  listCalls,
  nextCursor,
  organiserOf,
  parseMarked,
  parseSummary,
  plain,
  participantsOf,
  previewIdsOf,
  recordingLinkOf,
  roomLinkOf,
  searchCalls,
  sortHits,
  whenOf,
  type Call,
  type CallCursor,
  type CallHit,
  type CallParticipant,
  type Listing,
  type MarkedItem,
} from '../../lib/calls';
import {
  parseTranscript,
  recordingDetail,
  type RecordingDetail,
  type TranscriptLine,
} from '../../lib/calls';
import { loadDirectory, nameOf, resolvePeople } from '../../lib/people';
import { createTicket } from '../../lib/tickets';
import { c, eyebrow, mono } from '../../lib/theme';
import { toWorkItem } from '../../lib/shell';
import type { OrgAppProps } from '../../orgApps/registry';
import { Decisions } from '../scribe/parts';
import { Moments } from '../scribe/parts';
import { Summary } from '../scribe/parts';
import { Transcript } from '../scribe/parts';
import { dayOf, duration, Empty, Eyebrow, Faces, Meta, Person, Segmented, when } from '../scribe/parts';

const TABS: Array<{ id: Listing; label: string }> = [
  { id: 'active', label: 'Live' },
  { id: 'scheduled', label: 'Upcoming' },
  { id: 'history', label: 'Past' },
  { id: 'recordings', label: 'Recordings' },
  { id: 'shared', label: 'Shared' },
];

/** Rows per listing page. Big enough to fill the pane, small enough that the
 *  first screen arrives quickly; `Load more` continues from the cursor. */
const PAGE = 40;

type Pane = 'summary' | 'moments' | 'transcript' | 'people';
type View = 'calls' | 'decisions';

/**
 * One row in the list, from whichever source had it.
 *
 * The listings and the search index describe the same calls with different
 * fields — the listing has the summary and no channel name, the index has the
 * channel name and resolved attendees and no summary. Normalising both into one
 * row is what lets the list render identically whichever source is driving it,
 * and `call` stays attached so the detail pane can use the rich fields when
 * they are there.
 */
interface Row {
  id: string;
  externalId?: string;
  title: string;
  at: number | null;
  callType?: string;
  status?: string;
  channelName?: string;
  /** User ids, for faces. */
  people: string[];
  /** Names, when the index resolved them and the directory has not. */
  names: string[];
  hasTranscript: boolean;
  durationMs: number | null;
  /** The listing row, when this call was in one. */
  call?: Call;
}

function rowFromCall(ca: Call): Row {
  return {
    id: ca.id,
    externalId: ca.externalId,
    title: ca.title?.trim() || 'Untitled call',
    at: whenOf(ca),
    callType: ca.callType,
    status: ca.status,
    people: previewIdsOf(ca),
    names: [],
    hasTranscript: Boolean(ca.transcript),
    durationMs: durationOf(ca),
    call: ca,
  };
}

function rowFromHit(h: CallHit, known?: Call): Row {
  const base = known ? rowFromCall(known) : null;
  return {
    id: h.id,
    externalId: h.externalId ?? base?.externalId,
    title: base?.title ?? h.title,
    at: base?.at ?? h.startedAt ?? null,
    callType: h.callType ?? base?.callType,
    status: h.status ?? base?.status,
    channelName: h.channelName,
    people: h.userIds.length ? h.userIds : (base?.people ?? []),
    names: h.participantNames,
    hasTranscript: h.hasTranscript || Boolean(base?.hasTranscript),
    durationMs:
      base?.durationMs ?? (h.startedAt && h.endedAt && h.endedAt > h.startedAt ? h.endedAt - h.startedAt : null),
    call: known,
  };
}

export function Scribe({ scope, postUpdate, focusTicket, focused }: OrgAppProps) {
  const [view, setView] = useState<View>('calls');
  const [tab, setTab] = useState<Listing>('recordings');
  const [calls, setCalls] = useState<Call[]>([]);
  /**
   * Every call we can get a summary for, regardless of which tab is open.
   *
   * THE GAP THIS WORKS AROUND. There is no `calls.get(id)`. The registry has
   * eleven ways to LIST calls and not one way to fetch a single call by its id
   * (SCRIBE-SDK-GAPS.md §3). So when the search index turns up a call — which
   * is how the track-scoped view works — there is no request that will return
   * its summary or its marked items. The only source for those two fields is a
   * listing that happened to contain the row.
   *
   * So all three summary-bearing listings are read once at mount and kept as a
   * corpus to enrich search hits against. Three requests, paid once, and the
   * difference between a track view that shows what was decided and one that
   * shows a title and a date.
   */
  const [corpus, setCorpus] = useState<Call[]>([]);
  const [hits, setHits] = useState<CallHit[] | null>(null);
  /** Where the open listing continues, or null when it has run out. */
  const [more, setMore] = useState<CallCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState('');
  const [trackOnly, setTrackOnly] = useState(true);

  const [openId, setOpenId] = useState('');
  const [pane, setPane] = useState<Pane>('summary');
  const [detail, setDetail] = useState<RecordingDetail | null>(null);
  const [detailFor, setDetailFor] = useState('');
  const [people, setPeople] = useState<CallParticipant[]>([]);
  /** Wrapped in an object so seeking twice to the same second still moves the
   *  transcript — see the prop's note in Transcript.tsx. */
  const [seekTo, setSeekTo] = useState<{ at: number } | null>(null);

  const [busy, setBusy] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  /** Names resolve into a module-level cache, which React cannot see. */
  const [, bump] = useState(0);
  const redraw = useCallback(() => bump(n => n + 1), []);
  /**
   * The call the panes are for, readable synchronously.
   *
   * Opening a call fires two independent reads (participants, transcript) and
   * either can land after the user has clicked something else — a long
   * transcript takes noticeably longer than the click that abandons it. State
   * cannot be read back inside those callbacks (the closure has the old value),
   * so the current id lives in a ref and every late arrival checks it before
   * writing. Without this, opening B while A is loading fills B's panes with
   * A's transcript.
   */
  const openRef = useRef('');
  /**
   * One in-flight write at a time.
   *
   * Every write here is a message or a ticket in someone's real workspace, and
   * `disabled` does not render until after the click that would be a duplicate.
   * A ref is read synchronously, so it closes the window a state flag leaves
   * open. Shared across all four writes deliberately: two of them firing
   * together produce two ledger entries about the same thing.
   */
  const writing = useRef(false);

  // --- the listing -------------------------------------------------------
  useEffect(() => {
    setBusy(true);
    setError(null);
    // A notice says what the LAST action did ("Created EULER-1234"). It is
    // about a call that is about to leave the screen, so it goes with it —
    // otherwise it reads as a report about whatever the user looks at next.
    setNotice(null);
    // Changing tabs is changing the question, so the pane closes with the list
    // it belonged to. `openRef` goes with it, or a transcript still in flight
    // would write into a pane the user has already left.
    setOpenId('');
    setCurrent(null);
    openRef.current = '';
    void (async () => {
      await loadDirectory();
      const rows = await listCalls(tab, { limit: PAGE });
      setCalls(rows);
      setMore(nextCursor(rows, PAGE));
      // Faces need names, and the directory is already loaded — this only fills
      // in people it missed (external attendees, users created since boot).
      await resolvePeople(rows.flatMap(previewIdsOf));
      redraw();
    })()
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [tab, redraw]);

  /**
   * The search index, which drives the list whenever a question is being asked
   * of it — a typed query, or the track filter.
   *
   * Debounced because it is a real request per keystroke otherwise, and skipped
   * entirely when neither is in play, so the common case stays on the listing
   * and its summaries.
   */
  const scoped = Boolean(scope) && trackOnly;
  const searching = q.trim().length > 0 || scoped;
  useEffect(() => {
    if (!searching) {
      setHits(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      void (async () => {
        const found = await searchCalls({
          ...(q.trim() ? { q: q.trim() } : {}),
          ...(scoped && scope ? { channelId: scope.channelId } : {}),
          limit: 120,
        });
        if (!live) return;
        setHits(found);
        await resolvePeople(found.flatMap(h => h.userIds));
        if (live) redraw();
      })().catch(e => live && setError(e instanceof Error ? e.message : String(e)));
    }, 220);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, scoped, scope?.channelId, searching, redraw]);

  /** A new track is a new question — re-offer the filter. */
  useEffect(() => setTrackOnly(true), [scope?.channelId]);

  /** The corpus, once. Failures are silent: it only ever adds detail to rows
   *  that render fine without it. */
  useEffect(() => {
    void (async () => {
      const pages = await Promise.all(
        (['history', 'recordings', 'shared'] as const).map(k =>
          listCalls(k, { limit: 60 }).catch(() => [] as Call[]),
        ),
      );
      const merged = new Map<string, Call>();
      for (const page of pages) for (const ca of page) if (ca.id) merged.set(ca.id, ca);
      setCorpus([...merged.values()]);
      await resolvePeople([...merged.values()].flatMap(previewIdsOf));
      redraw();
    })();
  }, [redraw]);

  const byId = useMemo(() => {
    const m = new Map<string, Call>();
    for (const ca of corpus) m.set(ca.id, ca);
    // The open tab wins where they overlap — it is the fresher read.
    for (const ca of calls) m.set(ca.id, ca);
    return m;
  }, [corpus, calls]);

  const rows: Row[] = useMemo(() => {
    if (searching) {
      if (!hits) return [];
      return sortHits(hits).map(h => rowFromHit(h, byId.get(h.id)));
    }
    // Upcoming reads forwards — soonest first is the question being asked of
    // it. Every other listing is a history, and reads backwards.
    const dir = tab === 'scheduled' ? 1 : -1;
    return calls.map(rowFromCall).sort((a, b) => dir * ((a.at ?? 0) - (b.at ?? 0)));
  }, [searching, hits, calls, byId, tab]);

  /** Rows grouped into days, so a long list reads as a history. */
  const grouped = useMemo(() => {
    const out: Array<{ day: string; rows: Row[] }> = [];
    for (const r of rows) {
      const day = dayOf(r.at);
      const last = out[out.length - 1];
      if (last && last.day === day) last.rows.push(r);
      else out.push({ day, rows: [r] });
    }
    return out;
  }, [rows]);

  /**
   * The call the detail pane is showing.
   *
   * Held in state rather than looked up in `rows`, because the two are not the
   * same set. The Decisions ledger runs over the whole corpus — 84 calls — and
   * pressing a timestamp there opens a call that is very often not in the tab's
   * own list of 5. Deriving `current` from `rows` meant that press silently did
   * nothing, which is the worst kind of broken: the control looked live.
   */
  const [current, setCurrent] = useState<Row | null>(null);

  /**
   * The next page of the open listing.
   *
   * Only the listings page — the search index takes `offset`, but it also
   * returns 200 rows in one request, so there is nothing to continue.
   */
  const loadMore = useCallback(async () => {
    if (!more || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listCalls(tab, { limit: PAGE, start: more });
      // Dedupe: the cursor row is inclusive on some of these listings, so a
      // straight append shows the same call twice at every page boundary.
      setCalls(prev => {
        const seen = new Set(prev.map(x => x.id));
        return [...prev, ...page.filter(x => x.id && !seen.has(x.id))];
      });
      setMore(nextCursor(page, PAGE));
      await resolvePeople(page.flatMap(previewIdsOf));
      redraw();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  }, [more, loadingMore, tab, redraw]);

  // --- opening one call --------------------------------------------------
  const open = useCallback(
    async (row: Row, at: number | null = null) => {
      openRef.current = row.id;
      setOpenId(row.id);
      setCurrent(row);
      setSeekTo(at === null ? null : { at });
      setPane(at !== null ? 'transcript' : 'summary');
      setPeople([]);
      setDetail(null);
      setDetailFor(row.id);
      setNotice(null);
      setEnriching(false);

      /** Still the call the user is looking at? */
      const current = () => openRef.current === row.id;

      // Participants: the Past listing already embeds them, so only ask when
      // the row did not bring them. `participantsOf` resolves the names, which
      // the payload never carries.
      const inline = row.call?.participants;
      if (inline?.length) {
        setPeople(inline);
        void resolvePeople(inline.map(p => p.userId)).then(() => current() && redraw());
      } else {
        participantsOf(row.id)
          .then(rowsOut => {
            if (!current()) return;
            setPeople(rowsOut);
            redraw();
          })
          .catch(() => current() && setPeople([]));
      }

      // The transcript and the citation index. Null is a normal answer — a
      // scheduled call has nothing to enrich — so it is not an error.
      if (!row.externalId) return;
      setEnriching(true);
      const got = await recordingDetail(row.externalId);
      if (!current()) return; // the user moved on; their call owns the panes now
      setEnriching(false);
      setDetail(got);
    },
    [redraw],
  );

  const lines: TranscriptLine[] = useMemo(
    () => (detailFor === openId ? parseTranscript(detail?.transcript ?? detail?.identifiedTranscript) : []),
    [detail, detailFor, openId],
  );

  /**
   * The summary and the marks, from whichever source has them.
   *
   * The listing row is preferred: it is what we already had when the list drew,
   * so the panel is populated before the enrichment request comes back. The
   * enrichment fills in for calls that came from the search index and were
   * never in a listing.
   */
  const summary = useMemo(
    () => parseSummary(current?.call?.aiSummary ?? (detailFor === openId ? detail?.aiSummary : null)),
    [current, detail, detailFor, openId],
  );
  const marks = useMemo(
    () =>
      parseMarked(
        current?.call?.markedItems?.length
          ? current.call.markedItems
          : detailFor === openId
            ? detail?.markedItems
            : null,
      ),
    [current, detail, detailFor, openId],
  );

  const seek = useCallback((seconds: number) => {
    setPane('transcript');
    // A new object every time. The value alone is not enough: seeking to the
    // second you are already parked on is a legitimate thing to ask for.
    setSeekTo({ at: seconds });
  }, []);

  // --- what Scribe writes ------------------------------------------------

  /** Everything Scribe posts is a message in a ticket's own thread — the one
   *  write path the shell owns. There is no call↔ticket join table an SDK app
   *  can write to (see SCRIBE-SDK-GAPS.md §5), and a thread entry is durable,
   *  attributed and readable by the agent, which a join row would not be. */
  const post = useCallback(
    async (body: string, kind: 'activity' | 'note', done: string) => {
      if (!focused || writing.current) return;
      writing.current = true;
      setError(null);
      setNotice(null);
      try {
        await postUpdate(focused, body, kind);
        setNotice(done);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        writing.current = false;
      }
    },
    [focused, postUpdate],
  );

  const callRef = (row: Row): string => {
    const link = row.hasTranscript ? recordingLinkOf(row) : roomLinkOf(row);
    return link ? `[${row.title}](${link})` : `**${row.title}**`;
  };

  /** Record the call itself against the focused ticket, with what it produced. */
  const linkCall = useCallback(async () => {
    if (!current || !focused) return;
    const attendees = people.length
      ? people.map(p => nameOf(p.userId ?? '')).filter(Boolean)
      : current.names.length
        ? current.names
        : current.people.map(nameOf);
    const outcomes = summary.find(s => /outcome|takeaway|summary/i.test(s.title));
    const body = [
      `Call: ${callRef(current)} — ${when(current.at)}${current.durationMs ? `, ${duration(current.durationMs)}` : ''}`,
      attendees.length ? `On the call: ${attendees.join(', ')}` : null,
      outcomes?.lines.length
        ? `\n${outcomes.lines.map(l => `- ${plain(l)}`).join('\n')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');
    await post(body, 'note', `Recorded on ${focused.xyneId}.`);
  }, [current, focused, people, summary, post]);

  /** Put one decision or action in the ticket's ledger, with its evidence. */
  const recordItem = useCallback(
    async (item: MarkedItem, row: Row = current as Row) => {
      if (!row || !focused) return;
      setPending(item.text);
      const verb = item.type === 'decision' ? 'Decided' : item.type === 'action' ? 'Agreed to' : 'Marked';
      const at = item.timestampSeconds > 0 ? ` at ${Math.floor(item.timestampSeconds / 60)}:${String(item.timestampSeconds % 60).padStart(2, '0')}` : '';
      await post(
        `${verb} on ${callRef(row)}${at}: ${item.text}`,
        item.type === 'decision' ? 'note' : 'activity',
        `Recorded on ${focused.xyneId}.`,
      );
      setPending(null);
    },
    [current, focused, post],
  );

  /** Quote a line of the call into the ticket, attributed. */
  const quote = useCallback(
    async (line: TranscriptLine) => {
      if (!current || !focused) return;
      await post(
        `From ${callRef(current)} at ${line.stamp} — **${line.speaker}**: “${line.text}”`,
        'note',
        `Quoted into ${focused.xyneId}.`,
      );
    },
    [current, focused, post],
  );

  /**
   * An action item becomes a ticket on the open track.
   *
   * The move this whole surface exists for, and the one the dashboard cannot
   * make: it has no project, no board and no ticket anywhere near a recording,
   * so a commitment made on a call can only ever be text there. Here it becomes
   * a row someone is accountable for, the call is written into its thread as
   * the reason it exists, and the shell focuses it so the next thing on screen
   * is the ticket you just made.
   */
  const makeTicket = useCallback(
    async (item: MarkedItem, row: Row = current as Row) => {
      if (!scope || !row || writing.current) return;
      writing.current = true;
      setPending(item.text);
      setError(null);
      setNotice(null);
      try {
        const title = item.text.length > 90 ? `${item.text.slice(0, 88).trimEnd()}…` : item.text;
        const at = item.timestampSeconds > 0 ? ` (at ${Math.floor(item.timestampSeconds / 60)}:${String(item.timestampSeconds % 60).padStart(2, '0')})` : '';
        const created = await createTicket({
          title,
          // `description` is required in practice and tested for truthiness, so
          // it always carries the provenance rather than being left empty.
          description: `${item.text}\n\nAgreed on ${row.title}${at}, ${when(row.at)}.`,
          projectId: scope.projectId,
          channelId: scope.channelId,
        });
        const item2 = toWorkItem({ ...created, title });
        if (item2) {
          await postUpdate(item2, `Created from ${callRef(row)}${at}.`, 'activity');
          focusTicket(item2);
        }
        setNotice(`Created ${created.xyneId} on #${scope.trackName}.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        writing.current = false;
        setPending(null);
      }
    },
    [scope, current, postUpdate, focusTicket],
  );

  // --- render ------------------------------------------------------------

  const scopeLabel = scope ? `#${scope.trackName}` : 'the workspace';
  /**
   * Where the primary button goes, and what it says — decided together.
   *
   * These were two independent conditionals and they disagreed: a live call
   * that already has a transcript said "Join call" and pointed at the recording
   * page. Whether a call is HAPPENING beats whether it has been transcribed,
   * because you cannot join a recording and you cannot listen to a call in
   * progress.
   */
  const action = !current
    ? null
    : current.status === 'ACTIVE'
      ? { href: roomLinkOf(current), label: 'Join call' }
      : current.hasTranscript
        ? { href: recordingLinkOf(current), label: 'Listen in Spaces' }
        : { href: roomLinkOf(current), label: 'Open room' };

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar. The two controls that change what the list is answering sit
          together on the left; the view switch is on the right because it
          changes the shape of the answer rather than its scope. */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5" style={{ borderColor: c.line }}>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={`Search calls in ${scopeLabel}…`}
          className="h-8 w-60 rounded-md px-2 text-[12.5px] outline-none"
          style={{ background: c.card, border: `1px solid ${c.line}` }}
        />
        {scope && (
          <button
            onClick={() => setTrackOnly(v => !v)}
            aria-pressed={scoped}
            className="h-8 rounded-md border px-2.5 text-[12px] font-medium"
            style={{
              borderColor: scoped ? c.signal : c.line,
              color: scoped ? c.signal : c.graphite,
              background: scoped ? c.signalSoft : c.card,
            }}
            title="Scope every call to the track you have open — filtered by the server, not after the fact"
          >
            #{scope.trackName}
          </button>
        )}
        <Segmented
          value={view}
          options={[
            { id: 'calls' as View, label: 'Calls' },
            { id: 'decisions' as View, label: 'Decisions' },
          ]}
          onChange={setView}
        />
        <span className="ml-auto flex items-center gap-2">
          {/* The tabs pick a listing, and a listing is a personal view — so they
              stop meaning anything once the index is driving the list. Saying so
              beats leaving them looking live but inert. */}
          {searching ? (
            <span className="text-[11.5px]" style={{ color: c.mute }}>
              {q.trim() ? 'Matching calls' : 'Every call'} in {scopeLabel}
              {rows.length ? ` · ${rows.length}` : ''}
            </span>
          ) : (
            <Segmented value={tab} options={TABS} onChange={setTab} />
          )}
        </span>
      </div>

      {(error || notice) && (
        <p
          className="mx-4 mt-2 rounded-md px-3 py-2 text-[12.5px]"
          style={
            error
              ? { background: c.dangerSoft, color: c.danger }
              : { background: c.signalSoft, color: c.text }
          }
        >
          {error ?? notice}
        </p>
      )}

      {view === 'decisions' ? (
        /* The ledger runs off whatever rows are on screen — which is the point:
           narrow the track or the query above and the ledger narrows with it. */
        <Decisions
          /* Scoped when a question is being asked of the index, and the whole
             corpus otherwise — a ledger that only covered the open tab would be
             empty on Live and Upcoming, which is where it is least useful. */
          calls={searching ? rows.map(r => r.call).filter((x): x is Call => Boolean(x)) : corpus}
          scopeLabel={searching ? `in ${scopeLabel}` : 'of your own'}
          onOpenCall={(ca, at) => {
            // The ledger's calls come from the corpus, so one of them is often
            // not in the open tab's list. Build the row from the call itself
            // rather than requiring the list to already have it.
            setView('calls');
            void open(rows.find(r => r.id === ca.id) ?? rowFromCall(ca), at);
          }}
          {...(scope ? { onMakeTicket: (i: MarkedItem, ca: Call) => void makeTicket(i, rowFromCall(ca)) } : {})}
          {...(focused
            ? {
                onRecord: (i: MarkedItem, ca: Call) => void recordItem(i, rowFromCall(ca)),
                recordLabel: `record on ${focused.xyneId}`,
              }
            : {})}
          pending={pending}
        />
      ) : (
        <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '22rem 1fr' }}>
          {/* ---- the list ---- */}
          <aside className="min-h-0 overflow-y-auto" style={{ borderRight: `1px solid ${c.line}` }}>
            {busy && !rows.length && (
              <p className="px-4 py-3" style={{ fontFamily: mono, fontSize: '11px', color: c.mute }}>
                loading…
              </p>
            )}
            {!busy && rows.length === 0 && (
              <Empty
                title={
                  searching && q.trim()
                    ? `No calls in ${scopeLabel} match “${q.trim()}”.`
                    : searching
                      ? `${scopeLabel} has had no calls.`
                      : tab === 'active'
                        ? 'Nobody is on a call right now.'
                        : 'Nothing here.'
                }
                hint={
                  searching && q.trim()
                    ? 'Search reaches call titles and who was on them — not what was said. Try a name.'
                    : undefined
                }
              />
            )}
            {grouped.map(g => (
              <div key={g.day}>
                <div
                  className="sticky top-0 z-10 px-4 py-1.5"
                  style={{ ...eyebrow, color: c.mute, background: c.paper, borderBottom: `1px solid ${c.line}` }}
                >
                  {g.day}
                </div>
                {g.rows.map(r => (
                  <button
                    key={r.id}
                    onClick={() => void open(r)}
                    className="w-full px-4 py-2.5 text-left"
                    style={{
                      background: openId === r.id ? c.signalSoft : 'transparent',
                      borderBottom: `1px solid ${c.line}`,
                    }}
                  >
                    <div className="flex items-start gap-2">
                      {r.status === 'ACTIVE' && (
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: c.live }} aria-hidden />
                      )}
                      <p className="line-clamp-2 flex-1 text-[12.5px] leading-snug">{r.title}</p>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Faces ids={r.people} max={4} size={18} />
                      <Meta
                        parts={[
                          r.at
                            ? new Date(r.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                            : '—',
                          duration(r.durationMs),
                          // Before the channel name: it is the one thing that
                          // says whether a row is a line in a list or an hour of
                          // content you can read, and at the end of a long line
                          // it is what gets stranded on its own.
                          r.hasTranscript ? (
                            <span title="This call has a transcript" style={{ color: c.signal }}>
                              ✦
                            </span>
                          ) : null,
                          r.channelName ? `#${r.channelName}` : null,
                        ]}
                      />
                    </div>
                  </button>
                ))}
              </div>
            ))}
            {/* Only on the listings. Search already returns everything it will. */}
            {!searching && more && (
              <button
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="w-full px-4 py-3 text-left text-[12px] disabled:opacity-50"
                style={{ color: c.signal, fontFamily: mono }}
              >
                {loadingMore ? 'loading…' : 'Load more'}
              </button>
            )}
          </aside>

          {/* ---- the call ---- */}
          <section className="flex min-h-0 flex-col">
            {!current ? (
              <Empty
                title="Pick a call."
                hint="Its summary, the decisions and action items it produced, and what was said — with each claim linked to the moment it came from."
              />
            ) : (
              <>
                <header className="border-b px-7 pt-6 pb-4" style={{ borderColor: c.line }}>
                  <Eyebrow tone={c.mute}>
                    {current.status ?? 'call'}
                    {current.callType ? ` · ${current.callType}` : ''}
                  </Eyebrow>
                  <h1 className="mt-1.5 text-[19px] leading-snug font-semibold">{current.title}</h1>
                  <Meta
                    parts={[
                      when(current.at),
                      duration(current.durationMs),
                      current.call && organiserOf(current.call)
                        ? `called by ${nameOf(organiserOf(current.call) as string)}`
                        : null,
                      current.channelName ? `#${current.channelName}` : null,
                    ]}
                  />

                  <div className="mt-3.5 flex flex-wrap items-center gap-2">
                    {action?.href && (
                      <a
                        href={action.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md px-3 py-1.5 text-[12.5px] font-medium"
                        style={{ background: c.signal, color: c.signalText }}
                      >
                        {action.label}
                      </a>
                    )}
                    <button
                      onClick={() => void linkCall()}
                      disabled={!focused}
                      className="rounded-md border px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-45"
                      style={{ borderColor: c.line, color: c.text, background: c.card }}
                      title={focused ? undefined : 'Focus a ticket in the rail first'}
                    >
                      {focused ? `Record on ${focused.xyneId}` : 'Record on a ticket'}
                    </button>
                    {!focused && (
                      <span className="text-[11.5px]" style={{ color: c.mute }}>
                        Focus a ticket to write this call into it.
                      </span>
                    )}
                  </div>
                </header>

                <div className="flex items-center gap-2 px-7 pt-3">
                  <Segmented
                    value={pane}
                    options={[
                      { id: 'summary' as Pane, label: 'Summary', count: summary.length || undefined },
                      { id: 'moments' as Pane, label: 'Moments', count: marks.length || undefined },
                      { id: 'transcript' as Pane, label: 'Transcript', count: lines.length || undefined },
                      { id: 'people' as Pane, label: 'People', count: people.length || current.people.length || undefined },
                    ]}
                    onChange={setPane}
                  />
                  {enriching && (
                    <span style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}>reading transcript…</span>
                  )}
                </div>

                <div className="min-h-0 flex-1 overflow-hidden px-7 py-5">
                  {pane === 'summary' &&
                    (summary.length ? (
                      <div className="h-full overflow-y-auto pr-2">
                        <Summary
                          sections={summary}
                          {...(detailFor === openId && detail?.citationSegments
                            ? { segments: detail.citationSegments }
                            : {})}
                          {...(lines.length ? { onSeek: seek } : {})}
                          {...(scope
                            ? {
                                // `plain` first: the summary line still carries
                                // its [clf-…] tokens, and they would land in the
                                // ticket's title and description as noise.
                                onMakeTicket: (text: string) =>
                                  void makeTicket({ type: 'action', text: plain(text), timestampSeconds: 0 }),
                              }
                            : {})}
                          pendingTicket={pending}
                        />
                      </div>
                    ) : (
                      /* Four different reasons a summary can be absent, and
                         they are not interchangeable. "This one was not
                         recorded" is a lie for a call the index says has a
                         transcript, and the panel should not tell it. */
                      <Empty
                        title="No summary for this call."
                        hint={
                          current.status === 'SCHEDULED'
                            ? 'It has not happened yet.'
                            : !current.call
                              ? 'This call is not in your own call lists, and those are the only place a summary is returned — the search index does not carry one. Everything else here still works.'
                              : current.hasTranscript
                                ? 'It was transcribed, but no summary was written for it.'
                                : 'Summaries are written after a call is recorded. This one was not.'
                        }
                      />
                    ))}

                  {pane === 'moments' && (
                    <div className="h-full overflow-y-auto pr-2">
                      <Moments
                        items={marks}
                        lines={lines}
                        {...(lines.length ? { onSeek: seek } : {})}
                        {...(scope ? { onMakeTicket: (i: MarkedItem) => void makeTicket(i) } : {})}
                        {...(focused
                          ? { onRecord: (i: MarkedItem) => void recordItem(i), recordLabel: `record on ${focused.xyneId}` }
                          : {})}
                        pending={pending}
                      />
                    </div>
                  )}

                  {pane === 'transcript' && (
                    <div className="flex h-full min-h-0 flex-col">
                      <Transcript
                        lines={lines}
                        seekTo={seekTo}
                        {...(focused
                          ? { onQuote: (l: TranscriptLine) => void quote(l), quoteLabel: `Quote into ${focused.xyneId}` }
                          : {})}
                      />
                    </div>
                  )}

                  {pane === 'people' && (
                    <div className="h-full overflow-y-auto pr-2">
                      <PeoplePane row={current} rows={people} />
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/**
 * Who was on the call.
 *
 * Three sources, in order of how much they know: the participant rows (join and
 * leave times, so "joined 20 minutes late" is visible), the search index's
 * resolved names, and the row's own preview ids. The panel says which one it is
 * using rather than silently degrading, because "4 people" from a preview list
 * and "4 people" from participant rows are different claims.
 */
function PeoplePane({ row, rows }: { row: Row; rows: CallParticipant[] }) {
  if (rows.length) {
    return (
      <div>
        <Eyebrow>On the call</Eyebrow>
        <ul className="mt-3 flex flex-wrap gap-2">
          {rows.map(p => {
            const mins =
              p.joinedAt && p.leftAt && p.leftAt > p.joinedAt
                ? `${Math.max(1, Math.round((p.leftAt - p.joinedAt) / 60000))}m`
                : null;
            return (
              <li key={p.id}>
                <Person id={p.userId ?? ''} sub={mins} />
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  if (row.names.length) {
    return (
      <div>
        <Eyebrow>On the call</Eyebrow>
        <ul className="mt-3 flex flex-wrap gap-2">
          {row.names.map(n => (
            <li
              key={n}
              className="rounded-full px-3 py-1 text-[12px]"
              style={{ background: c.card, border: `1px solid ${c.line}` }}
            >
              {n}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11.5px]" style={{ color: c.mute }}>
          From the search index — this call has no participant records of its own.
        </p>
      </div>
    );
  }
  if (row.people.length) {
    return (
      <div>
        <Eyebrow>On the call</Eyebrow>
        <div className="mt-3">
          <Faces ids={row.people} max={20} size={26} />
        </div>
      </div>
    );
  }
  return (
    <Empty
      title="No participant records for this call."
      hint="Headless recordings have none — the recorder is not a participant."
    />
  );
}
