/**
 * The track's chat, and the agent that participates in it.
 *
 * The thread is a REAL Xyne conversation, not app state — so the same messages
 * appear in Xyne itself. The agent is dispatched with that conversationId,
 * which makes its reply land in the same thread rather than somewhere private.
 */
import { xyne } from './xyne';

export type ChatMessage = {
  messageId: string;
  senderId: string;
  content: string;
  createdAt: number;
  msgType?: string;
};

export async function listMessages(conversationId: string, limit = 100): Promise<ChatMessage[]> {
  const { spaces } = await xyne();
  const page = await spaces.messages.listByConversation(conversationId, { limit });
  const items = (page as unknown as { items?: ChatMessage[] }).items ?? [];
  return [...items].sort((a, b) => a.createdAt - b.createdAt);
}

export async function postMessage(conversationId: string, content: string): Promise<void> {
  const { spaces } = await xyne();
  await spaces.messages.send({ conversationId, content });
}

export type AgentOption = { slug: string; name: string };

export async function listAgents(): Promise<AgentOption[]> {
  const { spaces } = await xyne();
  const agents = (await spaces.claw.listAgents()) as unknown as Array<Record<string, string>>;
  const seen = new Set<string>();
  const out: AgentOption[] = [];
  for (const a of agents) {
    const slug = a.slug ?? a.id ?? a.name;
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, name: a.name ?? slug });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** A run's progress, rendered as the tool chips in the thread. */
export type RunStep = { label: string; status: string; at: number };

/**
 * getRun returns the whole AgentRun row, not the four fields ClawRun declares —
 * the registry sets no mapResult and the backend returns the service result
 * verbatim. That matters because `result` does NOT stream (measured: nothing for
 * 51s, then the full body at once), so status alone can only drive a spinner.
 * `currentToolLabel` and `toolInvocations` do move during a run and are the only
 * honest progress signals a polling client has. See SDK-GAPS.md §4e.
 */
type RunProgress = {
  status?: string;
  currentToolLabel?: string;
  toolInvocations?: Array<{ name?: string; label?: string; toolName?: string }>;
};

/** The most informative label a poll can offer, best first. */
function progressLabel(run: unknown): string {
  const r = run as RunProgress;
  if (r.currentToolLabel) return r.currentToolLabel;
  const last = r.toolInvocations?.[r.toolInvocations.length - 1];
  const tool = last?.label ?? last?.name ?? last?.toolName;
  return tool ?? r.status ?? 'working';
}

/**
 * Dispatch an agent into the track's thread.
 *
 * `conversationId` is what makes the reply land in the shared thread. We poll
 * rather than stream because the SDK has no push channel; each status change
 * becomes a chip so the user sees the run progressing.
 */
export async function runAgent(input: {
  agent: string;
  task: string;
  conversationId: string;
  context?: string;
  onStep?: (step: RunStep) => void;
}): Promise<{ result?: string; error?: string; status: string }> {
  const { spaces } = await xyne();
  let last = '';
  const run = await spaces.claw.runAndWait({
    agent: input.agent,
    task: input.task,
    conversationId: input.conversationId,
    ...(input.context ? { context: input.context } : {}),
    timeoutMs: 180_000,
    onProgress: r => {
      // Label off the tool the agent is actually running, not just the status.
      const label = progressLabel(r);
      if (label && label !== last) {
        last = label;
        input.onStep?.({ label, status: r.status ?? 'running', at: Date.now() });
      }
    },
  });
  return {
    status: run.status,
    ...(run.result ? { result: run.result } : {}),
    ...(run.error ? { error: run.error } : {}),
  };
}

/**
 * Thread history paging.
 *
 * The SDK's ConversationCursor type is WRONG: it declares
 * `{ conversationId, lastActivityAt }`, but the backend query
 * (channelConversationsPaginatedV3) validates `start: { createdAt }` and
 * requires isMember, limit and direction — all optional in the SDK's types.
 * Calling it the documented way returns 400 validation_failed. See SDK-GAPS.md.
 *
 * `direction: 'forward'` orders createdAt DESC, i.e. newest first, so paging
 * "forward" walks BACK through history. The cursor row is returned again
 * (inclusive), so callers must dedupe.
 */
export type ThreadRow = {
  conversationId: string;
  initialMessageId?: string;
  replyCount?: number;
  lastActivityAt?: number;
  createdAt: number;
};

export async function listThreads(
  channelId: string,
  cursor: { createdAt: number } | null,
  limit = 20,
): Promise<{ threads: ThreadRow[]; next: { createdAt: number } | null }> {
  const { spaces } = await xyne();
  const args = { channelId, isMember: true, limit, start: cursor, direction: 'forward' };
  const rows = (await spaces.conversations.listByChannel(
    channelId,
    args as unknown as Parameters<typeof spaces.conversations.listByChannel>[1],
  )) as unknown as ThreadRow[];

  // The cursor row comes back again; drop it so pages don't overlap.
  const fresh = cursor ? rows.filter(r => r.createdAt !== cursor.createdAt) : rows;
  const oldest = rows.at(-1);
  return {
    threads: fresh,
    next: rows.length >= limit && oldest ? { createdAt: oldest.createdAt } : null,
  };
}

/**
 * Every message in a thread.
 *
 * listByConversation paginates CLIENT-side — the server always sends the whole
 * thread and the SDK windows it — so one call with the maximum window gives the
 * full history for all but the longest threads, and paging further costs a
 * repeat transfer rather than saving one.
 */
export async function listAllMessages(conversationId: string): Promise<ChatMessage[]> {
  const { spaces } = await xyne();
  const first = await spaces.messages.listByConversation(conversationId, { limit: 100 });
  const page = first as unknown as { items?: ChatMessage[]; hasMore?: boolean; total?: number };
  const all = [...(page.items ?? [])];

  if (page.hasMore && (page.total ?? 0) > all.length) {
    for (let offset = all.length; offset < Math.min(page.total ?? 0, 600); offset += 100) {
      const next = (await spaces.messages.listByConversation(conversationId, {
        limit: 100,
        offset,
      })) as unknown as { items?: ChatMessage[] };
      if (!next.items?.length) break;
      all.push(...next.items);
    }
  }
  return all.sort((a, b) => a.createdAt - b.createdAt);
}
