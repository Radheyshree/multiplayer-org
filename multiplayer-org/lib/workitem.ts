/**
 * The ticket, as an APP hands it back to the shell.
 *
 * Why this type exists rather than reusing `Ticket`:
 *
 * The SDK's `Ticket` is a 30-field row with every field required — including
 * `workspaceId`, `kanbanPosition`, `metadata` and `merchantId`. The shell reads
 * exactly seven of them (see the ledger header and `postToTicket`). Requiring
 * an app to produce all thirty would mean either a full re-read per action or
 * inventing values, and an app that reads its work through a different endpoint
 * (Desk reads support rows, Board reads kanban rows) genuinely does not have
 * them.
 *
 * So the contract asks for the seven the shell actually uses. A real SDK
 * `Ticket` satisfies this structurally with no conversion — the rail keeps
 * passing its rows straight through — while an app with a partial row states
 * what it has via `toWorkItem`.
 *
 * `conversationId` is the load-bearing one: it is how the shell resolves where
 * an update goes, and it is the reason apps never name a target themselves.
 */
export interface WorkItem {
  id: string;
  xyneId: string;
  title: string;
  /** Free-form here on purpose: the SDK's union and the board's stage names are
   *  different vocabularies, and the shell only ever humanises the string. */
  statusV2: string;
  priority: string;
  channelId: string;
  conversationId: string;
}

/** What a partial ticket row must carry before it can be handed to the shell. */
export interface PartialTicket {
  id: string;
  xyneId?: string;
  title?: string;
  statusV2?: string;
  priority?: string;
  stageName?: string;
  channelId?: string;
  conversationId?: string;
}

/**
 * Narrow a ticket row from any surface into the shell's contract.
 *
 * Returns null when the row has no conversation, and that is not a defensive
 * nicety: a ticket without `conversationId` has nowhere for an update to land,
 * so focusing it would open an empty ledger and posting to it would throw. The
 * caller disables the action instead of discovering this at click time.
 */
export function toWorkItem(t: PartialTicket): WorkItem | null {
  if (!t.conversationId) return null;
  return {
    id: t.id,
    xyneId: t.xyneId ?? t.id.slice(0, 8),
    title: t.title ?? 'Untitled',
    // Board rows carry the stage as their live status; the SDK column is a
    // coarser lifecycle value. Prefer the specific one when it is there.
    statusV2: t.statusV2 ?? t.stageName ?? '',
    priority: t.priority ?? '',
    channelId: t.channelId ?? '',
    conversationId: t.conversationId,
  };
}
