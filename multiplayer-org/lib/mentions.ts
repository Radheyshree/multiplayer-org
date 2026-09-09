/**
 * @-mentions, the way Xyne stores them.
 *
 * A mention is not markup we invent — it is a span with data attributes, and it
 * is what the platform's own machinery reads:
 *
 *     <span data-mention="" data-mention-type="user"
 *           data-user-id="cmg…" data-username="Priya Rao">@Priya Rao</span>
 *
 * The backend's `extractAllMentions` parses exactly this out of `content` on
 * send, adds the mentioned people to the conversation as participants, and —
 * the part that matters here — an automation with a `MESSAGE_RECEIVED` trigger
 * can filter on `mentionedUserIds`. That is how "@Ask AI summarize ticket" in a
 * Spaces thread produces an answer in that thread: a mention of an agent's app
 * user, matched by an automation, running a RUN_AGENT step.
 *
 * WHY WE WRITE THIS FORMAT RATHER THAN PLAIN TEXT. A message reading
 * "@Assistant what's blocking this" is a string; a message carrying the span is
 * a routable event. Writing the real thing means our messages behave like
 * everyone else's — they notify, they subscribe the mentioned person, and any
 * automation already configured on the channel sees them.
 *
 * AGENTS ARE MENTIONABLE because each Claw agent that is wired into Spaces has
 * a `spacesAppUserId` — a real user row with `userType: 'APP'` that appears in
 * the directory like anyone else. Mentioning that id is mentioning the agent.
 */
import { allPeople, personOf, type Person } from './people';
import type { AgentOption } from './agentrun';

/** Somebody (or something) you can mention. */
export interface Mentionable {
  /** The user id that goes in the span. For an agent, its Spaces app user. */
  userId: string;
  name: string;
  /** Agents are dispatchable; people are not. */
  kind: 'agent' | 'person';
  /** Present for agents — the slug `claw.run` needs. */
  slug?: string;
  subtitle?: string;
}

/** Escape a value going into an HTML attribute or text node. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Render one mention span, in Xyne's exact shape. */
export function mentionHtml(m: { userId: string; name: string }): string {
  return (
    `<span data-mention="" data-mention-type="user" ` +
    `data-user-id="${esc(m.userId)}" data-username="${esc(m.name)}">@${esc(m.name)}</span>`
  );
}

/**
 * Turn a composed line into the HTML Xyne stores.
 *
 * The composer holds plain text with `@Name` tokens and a side-table of which
 * token resolved to whom — resolving by name at send time would be ambiguous
 * (two people called Priya) and would silently mention the wrong person.
 */
export function composeHtml(text: string, chosen: Mentionable[]): string {
  let html = esc(text);
  // Longest first, so "@Ask AI" is not half-replaced by a "@Ask" match.
  for (const m of [...chosen].sort((a, b) => b.name.length - a.name.length)) {
    html = html.split(esc(`@${m.name}`)).join(mentionHtml(m));
  }
  return `<p class="m-0 leading-6">${html}</p>`;
}

/**
 * Everyone mentionable, agents first.
 *
 * Agents lead because this composer exists mostly to reach them, and because
 * there are four thousand people in the directory and a dozen agents — putting
 * the agents anywhere else means typing three characters to find one.
 */
export function mentionables(agents: AgentOption[], agentUserIds: Map<string, string>): Mentionable[] {
  const out: Mentionable[] = [];
  // `agents` arrives already ranked (ask-ai first — see listAgents), so the
  // menu's first row is the one Enter would pick.
  for (const a of agents) {
    const userId = agentUserIds.get(a.slug);
    // An agent with no Spaces app user cannot be mentioned — it has no row to
    // point at. It is still dispatchable directly, just not by name in a line.
    if (!userId) continue;
    out.push({
      userId,
      name: personOf(userId).name || a.name,
      kind: 'agent',
      slug: a.slug,
      subtitle: a.description.slice(0, 70),
    });
  }
  const people: Person[] = allPeople();
  for (const p of people) {
    if (p.isBot) continue;
    out.push({
      userId: p.id,
      name: p.name,
      kind: 'person',
      ...(p.team || p.title ? { subtitle: [p.title, p.team].filter(Boolean).join(' · ') } : {}),
    });
  }
  return out;
}

/**
 * The active `@token` under the caret, if there is one.
 *
 * Returns the token and where it starts, so a completion can replace exactly
 * the text typed. A space ends a token only when nothing is matching yet —
 * agent and people names contain spaces ("Ask AI", "Priya Rao"), so a strict
 * no-spaces rule would close the menu on the first one.
 */
export function activeToken(text: string, caret: number): { query: string; start: number } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  // Must start a word — an email address is not a mention.
  if (at > 0 && !/\s/.test(upto[at - 1])) return null;
  const query = upto.slice(at + 1);
  // Two spaces means the writer moved on.
  if (/\s\s|\n/.test(query)) return null;
  return { query, start: at };
}

/** Rank candidates for a token. Prefix beats substring; agents beat people. */
export function matchMentionables(all: Mentionable[], query: string, limit = 8): Mentionable[] {
  const q = query.trim().toLowerCase();
  if (!q) return all.filter(m => m.kind === 'agent').slice(0, limit);
  const scored: Array<{ m: Mentionable; score: number }> = [];
  for (const m of all) {
    const name = m.name.toLowerCase();
    const i = name.indexOf(q);
    if (i === -1) continue;
    scored.push({ m, score: (i === 0 ? 0 : 10) + (m.kind === 'agent' ? 0 : 1) + i * 0.01 });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map(s => s.m);
}

/** The agents named in a composed line, so the caller knows who to dispatch. */
export function agentsMentioned(chosen: Mentionable[]): Mentionable[] {
  return chosen.filter(m => m.kind === 'agent' && m.slug);
}
