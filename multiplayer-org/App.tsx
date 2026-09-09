/**
 * Multiplayer Org — the shell.
 *
 *   rail            centre            right
 *   ────────────    ──────────────    ──────────────
 *   create App      App Pane          T<n> ticket
 *   App Store       (the selected     its one common
 *   Projects        org app runs      chat, humans and
 *    └ P → tracks   against the       agent in the same
 *   DM              selected ticket)  thread
 *   INSIGHTS                          ↑ work updates land here
 *
 * The shell knows nothing about any individual app. It resolves the org spine,
 * mounts whichever app you pick, and owns the one thing an app must never own:
 * where an update goes.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History, ChevronDown } from 'lucide-react';
import {
  askAgent,
  loadAgents,
  pickUpdateAgent,
  loadMyTickets,
  postToTicket,
  staleDays,
  loadInsights,
  loadMe,
  loadProjectTrees,
  loadThread,
  loadTicketPage,
  postUpdate,
  type Channel,
  type ClawAgent,
  type CurrentUser,
  type Insights,
  type Message,
  type ProjectTree,
  type Ticket,
} from './lib/org';
import { hasToken } from './lib/xyne';
import { configureOrigins } from './lib/origin';
import { recallOrigins } from './lib/mailthread';
import { recallCandidates } from './lib/mailbridge';
import { loadRegistry, type Registry } from './lib/apps';
import type { WorkItem } from './lib/workitem';
import { ORG_APPS } from './orgApps/registry';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Ledger } from './components/ledger/Ledger';
import type { LedgerMessage } from './components/ledger/MessageRow';
import { listAgents, type AgentOption } from './lib/agentrun';
import { Store } from './components/Store';
/**
 * Studio, loaded on demand.
 *
 * It carries a TypeScript/JSX transpiler (sucrase) so it can run agent-written
 * code in the preview, which is ~1.5 MB of the bundle on its own. Nobody pays
 * that to look at a board, and it is only ever reached from one rail button.
 */
const Studio = lazy(() =>
  import('./components/surfaces/Studio').then((m) => ({ default: m.Studio })),
);
import { tagUpdate, parseUpdate, matchesLayer, type Layer } from './lib/appUpdate';
import { readHistory, recordVisit, clearHistory, type RecentEntry } from './lib/history';
import { Rail, type RailView } from './components/Rail';
import {
  loadDirectory, EMPTY_DIRECTORY, humanize, ago, initials,
  priorityTone, statusTone, type Directory,
} from './lib/directory';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import { ScrollArea } from './components/ui/scroll-area';
import { Separator } from './components/ui/separator';
import { Skeleton } from './components/ui/skeleton';

/** How often the open thread re-reads itself. Fast enough to feel live in a
 *  conversation, slow enough that a 100-message read is not constant traffic. */
const THREAD_POLL_MS = 5000;
/** Tickets on the track change far less often than messages do. */
const TICKET_POLL_MS = 30000;
/** Tickets per page. Small enough to render instantly, large enough to fill the rail. */
const TICKET_PAGE = 30;

/** Cheap identity for a message list — length plus the last row's id and edit state. */
function signature(msgs: Message[]): string {
  const last = msgs[msgs.length - 1];
  return `${msgs.length}:${last?.messageId ?? ''}:${last?.content.length ?? 0}`;
}

function railButton(active: boolean): string {
  return [
    'w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors',
    active ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-accent/50 text-foreground/80',
  ].join(' ');
}

export default function App(): JSX.Element {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [trees, setTrees] = useState<ProjectTree[]>([]);
  const [bootError, setBootError] = useState<string | null>(null);

  const [view, setView] = useState<RailView>('projects');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [ticketCursor, setTicketCursor] = useState<{ id: string; createdAt: number } | null>(null);
  const [hasMoreTickets, setHasMoreTickets] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);
  /**
   * One tab per work item. The app is chosen inside the tab, not by the tab —
   * see lib/tabs.ts for why that asymmetry is deliberate.
   */
  /**
   * Open apps. An app is a workspace over a whole track, not a view of one
   * ticket — so the tab strip holds apps, and the ticket id travels with each
   * action the app takes.
   */
  const [openApps, setOpenApps] = useState<string[]>(() => (ORG_APPS[0] ? [ORG_APPS[0].id] : []));
  const [appId, setAppId] = useState<string>(ORG_APPS[0]?.id ?? '');
  /**
   * The ticket the chat pane is showing. Set by the app, or by the rail.
   *
   * Typed as WorkItem, not Ticket: an app hands back the seven fields the shell
   * reads, and a full SDK row (what the rail passes) satisfies that
   * structurally. See lib/workitem.ts.
   */
  const [focused, setFocused] = useState<WorkItem | null>(null);
  /** The rail folds away while you are working in an app; this is the override. */
  const [railPinned, setRailPinned] = useState(false);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [thread, setThread] = useState<Message[]>([]);
  const [agents, setAgents] = useState<ClawAgent[]>([]);
  /**
   * The same agents, deduped on slug and ordered for a picker.
   *
   * A separate read from `agents` above rather than a mapping of it: that list
   * is the raw `listAgents()` response, which is not org-scoped and carries
   * duplicate display names across orgs. lib/agentrun.ts collapses it on slug,
   * which is the only identifier that is actually unique.
   */
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([]);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [dir, setDir] = useState<Directory>(EMPTY_DIRECTORY);

  const [busy, setBusy] = useState(false);
  const [composer, setComposer] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [history, setHistory] = useState<RecentEntry[]>(() => readHistory());
  const [showHistory, setShowHistory] = useState(false);
  /** Which layer of the ledger is on screen. The agent always reads all. */
  const [layer, setLayer] = useState<Layer>('all');
  /**
   * Which side the ledger sits on.
   *
   * Right by default, and the reason is the chat being dismissible: a pane that
   * appears and disappears belongs on an EDGE. On the right, closing it widens
   * the app rightward and the app's left edge never moves. In the middle,
   * closing it makes the app slide sideways — the surface you are working in
   * jumps every time you focus a ticket.
   */
  const [ledgerLeft, setLedgerLeft] = useState<boolean>(() => {
    try {
      return localStorage.getItem('multiplayer-org:ledger-left') === '1';
    } catch {
      return false;
    }
  });

  const toggleLedgerSide = useCallback((): void => {
    setLedgerLeft((v) => {
      try {
        localStorage.setItem('multiplayer-org:ledger-left', v ? '0' : '1');
      } catch {
        /* per-device preference; not worth failing over */
      }
      return !v;
    });
  }, []);
  const [actionError, setActionError] = useState<string | null>(null);
  const [updateAsk, setUpdateAsk] = useState('');
  const [updateSent, setUpdateSent] = useState<string | null>(null);
  const [myTickets, setMyTickets] = useState<Ticket[]>([]);
  /** The workspace's own app registry, read lazily when the store is opened. */
  const [registry, setRegistry] = useState<Registry | null>(null);
  /** Inline replies in the Update Agent pane, keyed by ticket id. */
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [replied, setReplied] = useState<Record<string, boolean>>({});
  const [replying, setReplying] = useState<string | null>(null);

  const channelsById = useMemo(() => {
    const m = new Map<string, Channel>();
    for (const t of trees) for (const c of t.tracks) m.set(c.id, c);
    return m;
  }, [trees]);

  const track = trackId ? channelsById.get(trackId) ?? null : null;
  const project = useMemo(
    () => trees.find((t) => t.project.id === projectId)?.project ?? null,
    [trees, projectId],
  );
  /** What the rail has highlighted — used for navigation, never for writes. */
  const ticket = useMemo(() => tickets.find((t) => t.id === ticketId) ?? null, [tickets, ticketId]);
  const orgApp = ORG_APPS.find((a) => a.id === appId) ?? null;
  /** The ticket in focus — what the chat shows and what the composer posts to. */
  const tabTicket = focused;

  /** The track an app is open on. Apps find their own work inside it. */
  const scope = useMemo(
    () =>
      project && track
        ? {
            projectId: project.id,
            projectName: project.name,
            channelId: track.id,
            trackName: track.name,
          }
        : null,
    [project, track],
  );
  const updateAgent = useMemo(() => pickUpdateAgent(agents), [agents]);

  /** Open an app, or focus the tab it already has. */
  const openApp = useCallback((id: string): void => {
    setOpenApps((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setAppId(id);
    setView('projects');
  }, []);

  /** Close an app tab, focusing its neighbour the way a browser does. */
  const closeApp = useCallback((id: string): void => {
    setOpenApps((prev) => {
      const i = prev.indexOf(id);
      const next = prev.filter((t) => t !== id);
      setAppId((cur) => (cur !== id ? cur : (next[Math.max(0, i - 1)] ?? '')));
      return next;
    });
  }, []);

  /**
   * The rail collapses while an app is in front, and comes back whenever you
   * are not working in one — so navigating never needs a click to reveal it.
   */
  const railCollapsed = !railPinned && view === 'projects' && Boolean(scope) && Boolean(orgApp);

  // Boot: identity + the org spine.
  useEffect(() => {
    if (!hasToken) {
      setBootError('No XYNE_TOKEN in .env — run `spaces token` with a workspace open in Chrome.');
      return;
    }
    void (async () => {
      try {
        // Only the org spine is load-bearing. Identity and the agent list are
        // nice-to-have — a 404 on either must not blank the whole app.
        const [user, tree, ag] = await Promise.all([
          loadMe().catch(() => null),
          loadProjectTrees(),
          loadAgents().catch(() => []),
        ]);
        setMe(user);
        // Who counts as "us". Seeded from the signed-in address rather than
        // hardcoded, so a message from another company is marked as one in any
        // workspace this is installed into. See lib/origin.ts.
        configureOrigins({ myEmail: user?.email ?? null });
        // What a previous session learned about this workspace's Zoho URLs.
        void recallOrigins();
        // And which desk mails are code-host notifications, so the first ticket
        // opened does not wait 19 seconds to find out. See lib/mailbridge.ts.
        void recallCandidates();
        setTrees(tree);
        setAgents(ag);
        void listAgents().then(setAgentOptions).catch(() => setAgentOptions([]));
        // Names for every id the UI will render. One request; see lib/directory.ts.
        void loadDirectory(user?.id ?? null).then(setDir).catch(() => setDir(EMPTY_DIRECTORY));
      } catch (err) {
        setBootError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  /**
   * First page of the track's tickets, then more on demand.
   *
   * Server-side cursor paging, not a client-side slice — a track on a busy
   * project can hold far more tickets than anyone will scroll, and the previous
   * call fetched every one of them to render twenty.
   */
  useEffect(() => {
    if (!track || !project) {
      setTickets([]);
      setTicketId(null);
      setTicketCursor(null);
      setHasMoreTickets(false);
      return;
    }
    let live = true;
    setTicketsLoading(true);
    void loadTicketPage(project.id, track.id, TICKET_PAGE, null)
      .then((page) => {
        if (!live) return;
        setTickets(page.items);
        setTicketCursor(page.next);
        setHasMoreTickets(page.next !== null);
        // Do NOT auto-open a ticket: drilling into a track is its own step, and
        // opening one would collapse the rail before the list has been read.
        setTicketId(null);
      })
      .catch(() => {
        if (live) setTickets([]);
      })
      .finally(() => {
        if (live) setTicketsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [track, project]);

  const loadMoreTickets = useCallback((): void => {
    if (!track || !project || !ticketCursor || loadingMore) return;
    setLoadingMore(true);
    void loadTicketPage(project.id, track.id, TICKET_PAGE, ticketCursor)
      .then((page) => {
        setTickets((prev) => {
          const seen = new Set(prev.map((t) => t.id));
          return [...prev, ...page.items.filter((t) => !seen.has(t.id))];
        });
        setTicketCursor(page.next);
        setHasMoreTickets(page.next !== null);
      })
      .catch(() => setHasMoreTickets(false))
      .finally(() => setLoadingMore(false));
  }, [track, project, ticketCursor, loadingMore]);

  /**
   * The open conversation belongs to the ACTIVE TAB, not to the rail.
   *
   * This is the fix for a real bug: the shell used to read the post target from
   * the globally-selected ticket, so an app working in a background tab could
   * finish an async action and write its update into whichever ticket the
   * sidebar happened to be showing. The chat pane follows the tab for the same
   * reason — the app and the conversation must never disagree about the target.
   */
  const conversationId = focused?.conversationId ?? null;

  const refreshThread = useCallback(async (): Promise<void> => {
    if (!conversationId) {
      setThread([]);
      return;
    }
    const msgs = await loadThread(conversationId).catch(() => null);
    if (!msgs) return; // a failed poll keeps what is on screen
    // Only swap state when something actually changed. Without this every poll
    // hands React a brand-new array, remounting each row — the thread flickers
    // and any text selection in it is lost, on a five-second cycle.
    setThread((prev) => (signature(prev) === signature(msgs) ? prev : msgs));
  }, [conversationId]);

  useEffect(() => {
    void refreshThread();
  }, [refreshThread]);

  /**
   * Poll the open thread. This is the multiplayer part: two people on the same
   * ticket, plus an agent posting into it, all converge within one interval.
   *
   * Paused while the tab is hidden — a backgrounded tab polling a 100-message
   * thread forever is pure waste — and re-synced immediately on focus, so
   * coming back to the tab shows current state rather than a stale render.
   */
  useEffect(() => {
    if (!conversationId) return;
    let inFlight = false;
    const tick = async (): Promise<void> => {
      if (inFlight || document.hidden) return; // never let polls pile up
      inFlight = true;
      try {
        await refreshThread();
      } finally {
        inFlight = false;
      }
    };
    const id = window.setInterval(() => void tick(), THREAD_POLL_MS);
    const onVisible = (): void => {
      if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [conversationId, refreshThread]);

  /** Remember where we have been, for the history list. */
  useEffect(() => {
    if (!ticket || !track || !project) return;
    setHistory(
      recordVisit({
        conversationId: ticket.conversationId,
        ticketId: ticket.id,
        xyneId: ticket.xyneId,
        title: ticket.title,
        trackId: track.id,
        trackName: track.name,
        projectName: project.name,
      }),
    );
  }, [ticket, track, project]);

  /** Follow the conversation as it grows, the way a chat pane should. */
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [thread]);

  useEffect(() => {
    if (view === 'dm' && me) {
      void loadMyTickets(trees.map((t) => t.project.id), me.id)
        .then(setMyTickets)
        .catch(() => setMyTickets([]));
    }
    // Read once per session: the registry is workspace configuration, not
    // something that changes while you are looking at the store.
    if (view === 'store' && !registry) {
      void loadRegistry()
        .then(setRegistry)
        .catch(() => setRegistry({ org: [], marketplace: [], error: 'The app registry could not be read.' }));
    }
    if (view === 'insights') {
      void loadInsights([...channelsById.keys()], channelsById)
        .then(setInsights)
        .catch(() => setInsights({ topChats: [], topWorkflows: [], topAgents: [] }));
    }
  }, [view, channelsById, registry]);

  /**
   * The one write path.
   *
   * Apps never name a target and never stamp their own attribution — the shell
   * supplies both from the ticket it already has. That is what keeps an update
   * scoped to the ticket the app is open on, and what stops one app posting as
   * another.
   */
  const postAs = useCallback(
    async (appId: string | null, content: string): Promise<string> => {
      // Bound to the tab that owns the app, not to the sidebar's selection.
      if (!conversationId) throw new Error('No ticket open.');
      setBusy(true);
      try {
        const body = appId ? tagUpdate(appId, content) : content;
        const id = await postUpdate(conversationId, body);
        await refreshThread();
        return id;
      } finally {
        setBusy(false);
      }
    },
    [conversationId, refreshThread],
  );

  /**
   * What an app is handed.
   *
   * The app names the TICKET — it is the only thing that knows which of the
   * many tickets on screen an action was about. The shell still resolves the
   * target from `ticket.conversationId` and stamps the attribution, so an app
   * can only post to a ticket it was legitimately handed, never to a
   * conversation it names itself.
   */
  const postFromApp = useCallback(
    async (t: WorkItem, content: string, kind: 'activity' | 'note' = 'note'): Promise<string> => {
      setBusy(true);
      setActionError(null);
      try {
        const id = await postToTicket(t, tagUpdate(orgApp?.id ?? 'app', content, kind));
        // If that ticket is the one on screen, show it landing immediately.
        if (t.conversationId === conversationId) await refreshThread();
        return id;
      } catch (err) {
        setActionError(err instanceof Error ? err.message : `Could not post to ${t.xyneId}.`);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [orgApp, conversationId, refreshThread],
  );
  /** What the composer uses — a person typing, so no app attribution. */
  const postFromPerson = useCallback(
    (content: string): Promise<string> => postAs(null, content),
    [postAs],
  );

  /**
   * Answer the Update Agent about one ticket, in place.
   *
   * Deliberately does not touch the selection: you can be asked about three
   * tickets while working a fourth and answer all three without moving.
   */
  const answer = useCallback(
    async (t: Ticket): Promise<void> => {
      const text = (replies[t.id] ?? '').trim();
      if (!text) return;
      setReplying(t.id);
      setActionError(null);
      try {
        await postToTicket(t, text);
        setReplied((r) => ({ ...r, [t.id]: true }));
        setReplies((r) => ({ ...r, [t.id]: '' }));
        // If it happens to be the open ticket, show it immediately.
        if (t.conversationId === conversationId) void refreshThread();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : `Could not post to ${t.xyneId}.`);
      } finally {
        setReplying(null);
      }
    },
    [replies, conversationId, refreshThread],
  );

  /** Send from the composer. Keeps the draft if the write fails. */
  const send = useCallback(async (): Promise<void> => {
    const text = composer.trim();
    if (!text) return;
    setActionError(null);
    try {
      await postFromPerson(text);
      setComposer('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Message not sent.');
    }
  }, [composer, postFromPerson]);

  const runAgent = async (): Promise<void> => {
    const agent = agents[0];
    if (!tabTicket || !agent) return;
    setBusy(true);
    setActionError(null);
    try {
      await askAgent({
        agent: agent.slug,
        task:
          `Read the full conversation on ${tabTicket.xyneId} — it holds the record from every ` +
          `surface that touched this ticket — and summarise where it stands and what is blocking it.`,
        conversationId: tabTicket.conversationId,
        channelId: tabTicket.channelId,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not reach the agent.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * The app itself, rendered once and placed by whichever layout fits it.
   *
   * Two layouts, because two kinds of app exist: a document-shaped one wants
   * the pane's padded scroller, and a workspace-shaped one (columns, panes,
   * its own toolbars) wants a fixed-height box and no outer scroll at all.
   * Rendering the element once keeps the props in one place — the earlier
   * version of this duplicated the call and the two copies drifted.
   */
  const appPane = orgApp ? (
    <ErrorBoundary key={orgApp.id} label={orgApp.name}>
      <orgApp.Component
        scope={scope}
        dir={dir}
        postUpdate={postFromApp}
        focusTicket={setFocused}
        focusedTicketId={focused?.id ?? null}
        focused={focused}
        busy={busy}
      />
    </ErrorBoundary>
  ) : (
    <p className="text-[13px] text-muted-foreground">
      No apps installed. Add one to <code className="text-xs">ORG_APPS</code>.
    </p>
  );

  if (bootError) {
    return (
      <div className="min-h-screen grid place-items-center p-8">
        <div className="max-w-lg border border-destructive/40 rounded-lg p-6">
          <h1 className="font-semibold mb-2">Can't reach Spaces</h1>
          <p className="text-sm text-muted-foreground mb-4">{bootError}</p>
          <pre className="text-xs bg-muted rounded p-3 overflow-x-auto">
{`spaces token          # writes XYNE_TOKEN + XYNE_BASE_URL into .env
npm run dev`}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex overflow-hidden text-foreground bg-background">
      {/* ── rail ───────────────────────────────────────────── */}
      <aside
        className={[
          "order-1 shrink-0 border-r border-border flex flex-col min-h-0 overflow-hidden transition-[width] duration-200",
          railCollapsed ? "w-12" : "w-64",
        ].join(" ")}
      >
        <div className="px-2 py-3 border-b border-border flex items-center gap-2.5 min-w-0">
          <button
            onClick={() => setRailPinned((v) => !v)}
            title={railCollapsed ? 'Show the sidebar' : 'Keep the sidebar open'}
            aria-label={railCollapsed ? 'Show the sidebar' : 'Keep the sidebar open'}
            className="h-7 w-7 shrink-0 rounded-md bg-primary text-primary-foreground grid place-items-center text-[11px] font-semibold hover:opacity-90 transition-opacity"
          >
            {railCollapsed ? '»' : 'MO'}
          </button>
          {!railCollapsed ? (
            <div className="min-w-0">
              <div className="text-[13px] font-semibold leading-tight truncate">Multiplayer Org</div>
              {me ? (
                <div className="text-[11px] text-muted-foreground truncate">{me.name || me.email}</div>
              ) : (
                <Skeleton className="h-3 w-20 mt-1" />
              )}
            </div>
          ) : null}
        </div>

        {railCollapsed ? null : (
        <Rail
          trees={trees}
          view={view}
          projectId={projectId}
          trackId={trackId}
          tickets={tickets}
          ticketId={ticketId}
          ticketsLoading={ticketsLoading}
          hasMoreTickets={hasMoreTickets}
          loadingMore={loadingMore}
          loading={trees.length === 0 && !bootError}
          onView={setView}
          onProject={(id) => {
            setView('projects');
            setProjectId(id);
            // Leaving a project must clear what was open beneath it, or the
            // breadcrumb says "All projects" while a ticket is still selected.
            setTrackId(null);
            setTicketId(null);
          }}
          onTrack={(id) => {
            setView('projects');
            setTrackId(id);
            setTicketId(null);
          }}
          onTicket={(id) => {
            setTicketId(id);
            // Focusing shows the chat; it does NOT constrain the app, which is
            // scoped to the whole track and keeps showing everything.
            setFocused(tickets.find((x) => x.id === id) ?? null);
          }}
          onLoadMoreTickets={loadMoreTickets}
        />
        )}
      </aside>

      {/* ── centre: the App Pane ───────────────────────────── */}
      <main className={`flex-1 min-w-0 min-h-0 flex flex-col ${ledgerLeft ? 'order-3' : 'order-2'}`}>
        <header className="px-5 h-[57px] shrink-0 border-b border-border flex items-center gap-4">
          {view === 'projects' ? (
            <>
              {/* Where you are, left to right: project › track › ticket. */}
              <div className="flex items-center gap-1.5 text-[12px] min-w-0">
                <span className="text-muted-foreground truncate max-w-[12rem]">{project?.name ?? '—'}</span>
                <span className="text-border">/</span>
                <span className="truncate max-w-[10rem]">#{track?.name ?? '—'}</span>
                {ticket ? (
                  <>
                    <span className="text-border">/</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{ticket.xyneId}</span>
                  </>
                ) : null}
              </div>

              {/* Browser-style tabs, one per open APP. An app is a workspace
                  over the whole track, so a tab is not tied to any one ticket. */}
              <div className="ml-auto shrink-0 flex items-end gap-1 min-w-0 max-w-[62%] overflow-x-auto">
                {openApps.map((id) => {
                  const a = ORG_APPS.find((x) => x.id === id);
                  if (!a) return null;
                  const on = id === appId;
                  return (
                    <div
                      key={id}
                      className={[
                        'group flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-t-lg border-b-2 transition-colors shrink-0',
                        on
                          ? 'bg-background border-primary text-foreground'
                          : 'border-transparent text-muted-foreground hover:bg-accent/40',
                      ].join(' ')}
                    >
                      <button onClick={() => setAppId(id)} className="text-[12px] whitespace-nowrap">
                        {a.name}
                      </button>
                      {openApps.length > 1 ? (
                        <button
                          onClick={() => closeApp(id)}
                          aria-label={`Close ${a.name}`}
                          className="h-4 w-4 grid place-items-center rounded text-[11px] opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-accent"
                        >
                          ✕
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                <button
                  onClick={() => setView('store')}
                  aria-label="Open another app"
                  className="shrink-0 h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground text-[14px]"
                >
                  +
                </button>
              </div>
            </>
          ) : (
            <div className="text-[13px] font-semibold tracking-tight">
              {view === 'dm' ? 'Direct messages' : view === 'insights' ? 'Insights' : view === 'store' ? 'All apps' : 'Studio'}
            </div>
          )}
        </header>

        {/* Two views own their whole pane: an app that draws its own scrollers,
            and Studio, which is a three-pane workspace of its own. */}
        {view === 'projects' && orgApp?.fullBleed ? (
          <div className="flex-1 min-h-0 min-w-0">{appPane}</div>
        ) : view === 'create' ? (
          <div className="flex-1 min-h-0 min-w-0">
            <ErrorBoundary label="Studio">
              <Suspense
                fallback={
                  <div className="p-6 flex flex-col gap-3 max-w-xl">
                    <Skeleton className="h-8 w-48" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                }
              >
                <Studio />
              </Suspense>
            </ErrorBoundary>
          </div>
        ) : (
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-6 min-w-0 max-w-full">
            {view === 'projects' ? appPane : null}

            {view === 'store' ? (
              <Store
                registry={registry}
                mountedIds={ORG_APPS.map((a) => a.id)}
                onOpen={openApp}
              />
            ) : null}

            {view === 'dm' ? (
              <div className="max-w-2xl flex flex-col gap-5">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 shrink-0 rounded-lg bg-agent-soft text-agent ring-1 ring-agent/25 grid place-items-center text-[15px]">
                    ✦
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold leading-tight">Update Agent</h2>
                    <p className="text-[13px] text-muted-foreground mt-0.5">
                      {updateAgent
                        ? `Running as ${updateAgent.name}.`
                        : 'No agent is enabled on this deployment yet.'}
                    </p>
                  </div>
                </div>

                <p className="text-[13px] text-muted-foreground leading-relaxed">
                  Ask it about a ticket instead of messaging a person. The answer is posted{' '}
                  <strong className="text-foreground font-medium">into that ticket&rsquo;s own chat</strong>, not
                  back to you privately — so everyone on the ticket sees the status once, and nobody has to
                  ask again.
                </p>

                {ticket ? (
                  <div className="rounded-lg border border-border p-4 flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="text-muted-foreground">Asking about</span>
                      <span className="font-mono text-[11px]">{ticket.xyneId}</span>
                      <span className="truncate">{ticket.title}</span>
                    </div>
                    <Textarea
                      value={updateAsk}
                      onChange={(e) => setUpdateAsk(e.target.value)}
                      rows={3}
                      placeholder="Where has this got to, and what is blocking it?"
                    />
                    <div className="flex items-center gap-3">
                      <Button
                        disabled={!updateAgent || busy || updateAsk.trim().length === 0}
                        onClick={() => {
                          const q = updateAsk.trim();
                          if (!updateAgent || !q) return;
                          setBusy(true);
                          setActionError(null);
                          askAgent({
                            agent: updateAgent.slug,
                            task: q,
                            conversationId: ticket.conversationId,
                            channelId: ticket.channelId,
                          })
                            .then(() => {
                              setUpdateAsk('');
                              setUpdateSent(ticket.xyneId);
                            })
                            .catch((err: unknown) =>
                              setActionError(
                                err instanceof Error ? err.message : 'Could not reach the agent.',
                              ),
                            )
                            .finally(() => setBusy(false));
                        }}
                      >
                        {busy ? 'Asking…' : 'Ask, and post to the ticket chat'}
                      </Button>
                      {updateSent ? (
                        <span className="text-[12px] text-muted-foreground">
                          Sent — the reply lands in {updateSent}&rsquo;s chat.
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border p-4 text-[13px] text-muted-foreground">
                    Pick a ticket in the sidebar first — the agent answers into that ticket&rsquo;s chat, so it
                    needs to know which one you mean.
                  </div>
                )}

                {/* The other direction: the agent asking YOU, because you are
                    the assignee and the ticket has gone quiet. */}
                <section className="flex flex-col gap-2">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-[12px] font-semibold">It needs an update from you</h3>
                    <span className="text-[11px] text-muted-foreground">
                      {myTickets.length} assigned to you
                    </span>
                  </div>
                  {myTickets.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground">
                      Nothing assigned to you on your tracks.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {myTickets.slice(0, 8).map((t) => {
                        const days = staleDays(t);
                        const draft = replies[t.id] ?? '';
                        const done = replied[t.id];
                        return (
                          <div key={t.id} className="rounded-lg border border-border p-2.5 flex flex-col gap-2 min-w-0">
                            <div className="flex items-start gap-3 min-w-0">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                                    {t.xyneId}
                                  </span>
                                  <span className="text-[12px] truncate">{t.title}</span>
                                </div>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                  {humanize(t.stageName)} ·{' '}
                                  {days > 0 ? `quiet for ${days}d` : 'updated today'}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="shrink-0 text-[11px]"
                                onClick={() => {
                                  // Full context, if you would rather work it properly.
                                  const owner = trees.find((tr) =>
                                    tr.tracks.some((c) => c.id === t.channelId),
                                  );
                                  setProjectId(owner?.project.id ?? null);
                                  setTrackId(t.channelId);
                                  setTicketId(t.id);
                                  setView('projects');
                                }}
                              >
                                Open
                              </Button>
                            </div>

                            {/* Answer here. Posting from this pane does NOT change
                                what is selected — the whole point is that being
                                asked about three tickets costs no navigation. */}
                            {done ? (
                              <p className="text-[11px] text-ok">Posted to {t.xyneId}&rsquo;s chat.</p>
                            ) : (
                              <div className="flex gap-2">
                                <Input
                                  value={draft}
                                  placeholder={`Update on ${t.xyneId}…`}
                                  className="h-7 text-[12px]"
                                  onChange={(e) =>
                                    setReplies((r) => ({ ...r, [t.id]: e.target.value }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && draft.trim()) void answer(t);
                                  }}
                                />
                                <Button
                                  size="sm"
                                  className="shrink-0 text-[11px]"
                                  disabled={replying === t.id || draft.trim().length === 0}
                                  onClick={() => void answer(t)}
                                >
                                  {replying === t.id ? 'Posting…' : 'Reply'}
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <p className="text-[11px] text-muted-foreground/80">
                  Your direct messages are deliberately not listed here. This pane is one agent, not an inbox.
                </p>
              </div>
            ) : null}

            {view === 'insights' ? (
              <div className="grid gap-6 max-w-4xl md:grid-cols-3">
                <section>
                  <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Top chats</h3>
                  <ul className="flex flex-col gap-1.5">
                    {(insights?.topChats ?? []).map((r) => (
                      <li key={r.channel.id} className="text-sm flex justify-between gap-2">
                        <span className="truncate"># {r.channel.name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                          {r.participantCount}
                        </span>
                      </li>
                    ))}
                    {insights && insights.topChats.length === 0 ? (
                      <li className="text-sm text-muted-foreground">No stats.</li>
                    ) : null}
                  </ul>
                </section>
                <section>
                  <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Top workflow</h3>
                  <ul className="flex flex-col gap-1.5">
                    {(insights?.topWorkflows ?? []).map((w) => (
                      <li key={w.id} className="text-sm flex justify-between gap-2">
                        <span className="truncate">{w.workflowName ?? w.eventType}</span>
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          {w.status}
                        </Badge>
                      </li>
                    ))}
                    {insights && insights.topWorkflows.length === 0 ? (
                      <li className="text-sm text-muted-foreground">No automations.</li>
                    ) : null}
                  </ul>
                </section>
                <section>
                  <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Top agents</h3>
                  <ul className="flex flex-col gap-1.5">
                    {(insights?.topAgents ?? []).map((a) => (
                      <li key={a.id} className="text-sm truncate">
                        {a.name}
                      </li>
                    ))}
                    {insights && insights.topAgents.length === 0 ? (
                      <li className="text-sm text-muted-foreground">No agents.</li>
                    ) : null}
                  </ul>
                </section>
                <p className="md:col-span-3 text-xs text-muted-foreground">
                  Ranked by what the API actually exposes — <code>ChannelStats</code> carries last activity and
                  participant count, not message volume. A real leaderboard needs a new endpoint.
                </p>
              </div>
            ) : null}
          </div>
        </ScrollArea>
        )}
      </main>

      {/* ── right: the ticket and its one common chat ──────── */}
      {focused ? (
      <aside
        className={[
          "w-[26rem] shrink-0 flex flex-col min-h-0 min-w-0",
          ledgerLeft ? "order-2 border-r border-border" : "order-3 border-l border-border",
        ].join(" ")}
      >
        <div className="px-4 h-[57px] shrink-0 border-b border-border flex flex-col justify-center gap-1">
          {tabTicket ? (
            <>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[11px] text-muted-foreground">{tabTicket.xyneId}</span>
                <span className={`px-1.5 py-px rounded border text-[10px] font-medium ${statusTone(tabTicket.statusV2)}`}>
                  {humanize(tabTicket.statusV2)}
                </span>
                <span className={`px-1.5 py-px rounded border text-[10px] font-medium ${priorityTone(tabTicket.priority)}`}>
                  {humanize(tabTicket.priority)}
                </span>
                <span
                  className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground"
                  title="This thread re-reads itself every 5 seconds"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />
                  live
                </span>
                <button
                  onClick={toggleLedgerSide}
                  aria-label={ledgerLeft ? 'Move ledger to the right' : 'Move ledger to the middle'}
                  title={ledgerLeft ? 'Move ledger to the right' : 'Move ledger to the middle'}
                  className="h-4 w-4 grid place-items-center rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent"
                >
                  {ledgerLeft ? '→' : '←'}
                </button>
                <button
                  onClick={() => setFocused(null)}
                  aria-label="Close ledger"
                  title="Close ledger"
                  className="h-4 w-4 grid place-items-center rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent"
                >
                  ✕
                </button>
              </div>
              <div className="text-[13px] font-medium truncate leading-tight">{tabTicket.title}</div>
            </>
          ) : (
            <div className="text-[13px] text-muted-foreground">No ticket selected</div>
          )}
        </div>

        {/* History: where I have been, per device. */}
        <div className="px-3 py-1.5 border-b border-border shrink-0 flex items-center gap-2">
          <button
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
            className="flex items-center gap-1.5 px-2 py-1 -ml-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            <History className="h-3 w-3" aria-hidden />
            Recent
            <span className="tabular-nums opacity-60">{history.length}</span>
            <ChevronDown className={`h-3 w-3 transition-transform ${showHistory ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {showHistory && history.length > 0 ? (
            <button
              onClick={() => setHistory(clearHistory())}
              className="ml-auto text-[11px] text-muted-foreground hover:text-destructive transition-colors"
            >
              Clear
            </button>
          ) : null}
        </div>

        {showHistory ? (
          <div className="border-b border-border shrink-0">
            <ScrollArea className="max-h-56">
              <div className="p-2 flex flex-col gap-px">
                {history.length === 0 ? (
                  <p className="px-2 py-3 text-[11px] text-muted-foreground">
                    Conversations you open show up here.
                  </p>
                ) : (
                  history.map((h) => (
                    <button
                      key={h.ticketId}
                      onClick={() => {
                        // Jumping back may cross tracks, so move the selection too.
                        // A recent ticket may live under a project you are not
                        // standing in, so restore every level of the path.
                        setView('projects');
                        const owner = trees.find((t) =>
                          t.tracks.some((c) => c.id === h.trackId),
                        );
                        setProjectId(owner?.project.id ?? null);
                        setTrackId(h.trackId);
                        setTicketId(h.ticketId);
                        setShowHistory(false);
                      }}
                      className={[
                        'w-full text-left px-2 py-1.5 rounded-md transition-colors min-w-0',
                        h.ticketId === ticketId ? 'bg-accent' : 'hover:bg-accent/50',
                      ].join(' ')}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-[10px] text-muted-foreground shrink-0">{h.xyneId}</span>
                        <span className="text-[12px] truncate flex-1">{h.title}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{ago(h.at)}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {h.projectName} / #{h.trackName}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        ) : null}

        <Ledger
          item={tabTicket}
          messages={thread as unknown as LedgerMessage[]}
          channel={track}
          {...(me?.id ? { meId: me.id } : {})}
          {...(me?.email ? { meEmail: me.email } : {})}
          agents={agentOptions}
          busy={busy}
          {...(ticket?.description ? { description: ticket.description } : {})}
          onSend={async text => void (await postFromPerson(text))}
          onRecord={async (text, kind) => {
            if (tabTicket) await postFromApp(tabTicket, text, kind);
          }}
          onRefresh={refreshThread}
        />
      </aside>
      ) : null}
    </div>
  );
}
