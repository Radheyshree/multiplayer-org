/**
 * The org's app store.
 *
 * An org app receives the selected ticket and one way to speak: `postUpdate`.
 * It never chooses where its update goes — the shell supplies the
 * `conversationId` from the ticket it already had. That is the same shape a
 * published app would need (there the boundary is a postMessage bridge rather
 * than a prop), so building against it locally does not paint us into a corner.
 *
 * Locally an "app" is a component in this registry. Published, each of these
 * would be an ArtifactApp payload the agent generated — the contract below is
 * what stays the same across that move.
 */
import { useEffect, useState } from 'react';
import type { Ticket } from '../lib/org';
import { loadTicketPage } from '../lib/org';
import { humanize, type Directory } from '../lib/directory';
import { Textarea } from '../components/ui/textarea';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Label } from '../components/ui/label';
import { KanbanBoard } from './KanbanBoard';

/**
 * What a work app is given.
 *
 * THE INVERSION THAT MATTERS: an app is NOT scoped to one ticket. A Kanban
 * board shows a whole board; a desk shows a queue; GitHub shows the repo. So
 * the app receives a SCOPE (the track it is open on) and finds its own work
 * inside it. The ticket id travels with the ACTION, not with the app.
 *
 * That is why `postUpdate` takes the ticket as its first argument: the app is
 * the only thing that knows which of the many tickets on screen an action was
 * about. The shell still owns the target resolution — it reads
 * `ticket.conversationId` — so an app can only ever post to a ticket it was
 * legitimately handed, never to a conversation it names itself.
 */
export interface OrgAppProps {
  /** The track the app is open on. Null when nothing is selected yet. */
  scope: AppScope | null;
  /** Resolves user ids to names — the API returns ids almost everywhere. */
  dir: Directory;
  /** Post an update ABOUT a specific ticket. The app names which one. */
  postUpdate: (ticket: Ticket, content: string, kind?: 'activity' | 'note') => Promise<string>;
  /** Ask the shell to show this ticket's chat on the right. */
  focusTicket: (ticket: Ticket | null) => void;
  /** Which ticket the chat pane is currently showing, if any. */
  focusedTicketId: string | null;
  busy: boolean;
}

export interface AppScope {
  projectId: string;
  projectName: string;
  channelId: string;
  trackName: string;
}

export interface OrgApp {
  id: string;
  name: string;
  blurb: string;
  Component: (props: OrgAppProps) => JSX.Element;
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-1.5 border-b border-border/60 last:border-0">
      <span className="text-xs uppercase tracking-wide text-muted-foreground pt-0.5">{label}</span>
      <span className="text-sm break-words min-w-0 overflow-wrap-anywhere">{value || '—'}</span>
    </div>
  );
}

/**
 * Xyne Desk — a queue, not a single ticket.
 *
 * Shows every ticket on the track, lets you pick one to work, and logs the note
 * against THAT ticket. Which ticket the note lands on is decided here, in the
 * app, at the moment of acting — never by whatever the shell had selected.
 */
function XyneDesk({ scope, dir, postUpdate, focusTicket, focusedTicketId, busy }: OrgAppProps): JSX.Element {
  const [queue, setQueue] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    if (!scope) {
      setQueue([]);
      return;
    }
    setLoading(true);
    void loadTicketPage(scope.projectId, scope.channelId, 50, null)
      .then((p) => setQueue(p.items))
      .catch(() => setQueue([]))
      .finally(() => setLoading(false));
  }, [scope]);

  const working = queue.find((t) => t.id === focusedTicketId) ?? null;

  const send = async (): Promise<void> => {
    const text = note.trim();
    if (!working || !text) return;
    const id = await postUpdate(working, text);
    setSent(id);
    setNote('');
  };

  if (!scope) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Pick a track in the sidebar to see its desk.
      </p>
    );
  }

  return (
    <div className="flex gap-5 min-w-0 h-full">
      {/* The queue. Picking one focuses it — the chat on the right follows. */}
      <div className="w-72 shrink-0 flex flex-col gap-2 min-h-0">
        <h2 className="text-[13px] font-semibold shrink-0">
          Queue <span className="text-muted-foreground font-normal">({queue.length})</span>
        </h2>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 pr-1">
          {loading ? (
            <p className="text-[12px] text-muted-foreground">Loading…</p>
          ) : queue.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">No tickets on this track.</p>
          ) : (
            queue.map((t) => {
              const on = t.id === focusedTicketId;
              return (
                <button
                  key={t.id}
                  onClick={() => focusTicket(t)}
                  className={[
                    'w-full text-left rounded-md px-2 py-1.5 transition-colors min-w-0',
                    on ? 'bg-primary/10' : 'hover:bg-accent/50',
                  ].join(' ')}
                >
                  <span className="flex items-baseline gap-1.5 min-w-0">
                    <span className="font-mono text-[10px] text-muted-foreground shrink-0">{t.xyneId}</span>
                    <span className={`text-[12px] truncate ${on ? 'font-medium' : 'text-foreground/75'}`}>
                      {t.title}
                    </span>
                  </span>
                  <span className="block text-[10px] text-muted-foreground truncate">
                    {humanize(t.stageName)} · {dir.name(t.assignedTo)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* The one being worked. */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {!working ? (
          <p className="text-[13px] text-muted-foreground">
            Pick a ticket from the queue to work it.
          </p>
        ) : (
          <div className="flex flex-col gap-5 max-w-2xl min-w-0">
            <div>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <Badge variant="secondary">{working.xyneId}</Badge>
                <Badge variant="outline">{humanize(working.statusV2)}</Badge>
                <Badge variant="outline">{humanize(working.priority)}</Badge>
              </div>
              <h2 className="text-lg font-semibold leading-snug break-words">{working.title}</h2>
            </div>

            <div className="rounded-md border border-border p-4">
              <Field label="Stage" value={humanize(working.stageName)} />
              <Field label="Assigned to" value={dir.name(working.assignedTo)} />
              <Field label="Type" value={humanize(working.ticketType)} />
              <Field label="Description" value={working.description} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="desk-note">Log a work update on {working.xyneId}</Label>
              <Textarea
                id="desk-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Reproduced on staging. Root cause is the retry loop in the webhook handler."
                rows={3}
              />
              <div className="flex items-center gap-3">
                <Button onClick={() => void send()} disabled={busy || note.trim().length === 0}>
                  {busy ? 'Posting…' : `Post to ${working.xyneId}`}
                </Button>
                {sent ? <span className="text-xs text-muted-foreground">Posted.</span> : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const ORG_APPS: OrgApp[] = [
  {
    id: 'kanban-board',
    name: 'Kanban Board',
    blurb: "The track's board — stages as columns, tickets in them, moves that stick.",
    Component: KanbanBoard,
  },
  { id: 'xyne-desk', name: 'Xyne Desk', blurb: 'Work the track queue and log against a ticket', Component: XyneDesk },
];
