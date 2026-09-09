/**
 * One line in the unified thread.
 *
 * This is the row the whole product is about:
 *
 *     ┌ Priya  Quality Engineer · Euler   ✉ via Email        2h ago
 *     │ What changed in the pricing PR, and does it match the spec?
 *
 * Everything on that line is real. The name comes from the directory, the title
 * and team from the user's profile, and the badge from a field the row actually
 * carries — a channel type, an ingestion stamp, a PR webhook payload. Nothing
 * here is decoration standing in for an integration we do not have.
 *
 * GEOMETRY is Xyne's, measured off its own MessageBubble: a fixed 32px avatar
 * gutter, `gap-2`, `px-4 py-1`, a semibold 14px name on a baseline row with a
 * 12px muted timestamp, body below. Consecutive messages from the same sender
 * within five minutes drop the avatar and name — the single most recognisable
 * detail of a Slack-shaped thread, and the thing that makes a long ledger
 * readable rather than a wall of repeated faces.
 */
import type { ReactNode } from 'react';
import { parseUpdate, type EntryKind } from '../../lib/appUpdate';
import { initials, personOf, tintFor } from '../../lib/people';
import {
  actsOf,
  contentFormat,
  externalAuthor,
  isRoutine,
  parseBody,
  sourceOf,
  type AppAction,
  type ChannelLike,
  type MessageLike,
} from '../../lib/provenance';
import { c, mono } from '../../lib/theme';
import { RichText } from '../RichText';
import { ActBadge, SourceBadge } from './SourceBadge';

/** A message as the ledger needs it. Structural so any read path fits. */
export interface LedgerMessage extends MessageLike {
  messageId: string;
  senderId: string;
  createdAt: number;
  messageActs?: unknown;
}

/** Five minutes, matching the dashboard's own grouping window. */
const GROUP_MS = 5 * 60 * 1000;

/**
 * Should this row show its avatar and name?
 *
 * A break is forced by a different sender, a gap over the window, or the
 * previous row being machinery — a status change between two of Priya's
 * messages should not make the second one look like a continuation.
 */
export function startsGroup(
  m: LedgerMessage,
  prev: LedgerMessage | undefined,
  channel?: ChannelLike | null,
): boolean {
  if (!prev) return true;
  if (prev.senderId !== m.senderId) return true;
  if (m.createdAt - prev.createdAt > GROUP_MS) return true;
  if (isRoutine(prev) !== isRoutine(m)) return true;
  // A DIFFERENT SOURCE BREAKS THE GROUP, and this is the rule that matters.
  //
  // Slack-style grouping asks "is this the same person still talking", which is
  // right in a chat app and wrong here: an app records a pull request, a call
  // and three tickets in one burst — same sender id, same five minutes. Group
  // those and every badge but the first disappears, leaving five anonymous
  // lines and none of the provenance this surface exists to show.
  //
  // So a row's identity is (sender, source), not sender alone.
  const a = parseUpdate(prev.content ?? '').appId;
  const b = parseUpdate(m.content ?? '').appId;
  if (a !== b) return true;
  return sourceOf(prev, channel, a).label !== sourceOf(m, channel, b).label;
}

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const clock = (at: number): string =>
  new Date(at).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** The Xyne agent mark — a filled disc with a sparkle, in place of an avatar. */
function AgentMark() {
  return (
    <span
      className="grid size-8 shrink-0 place-items-center rounded-md text-[13px]"
      style={{ background: c.agentSoft, color: c.agent }}
      aria-label="Agent"
    >
      ✦
    </span>
  );
}

function Avatar({ id, name }: { id: string; name: string }) {
  const p = personOf(id);
  if (p.picture) {
    return (
      <img
        src={p.picture.startsWith('http') ? p.picture : `/api/v1/files/${p.picture}`}
        alt=""
        className="size-8 shrink-0 rounded-md object-cover"
        // A broken avatar URL must not leave a torn image icon in the gutter.
        onError={e => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }
  return (
    <span
      className="grid size-8 shrink-0 place-items-center rounded-md text-[10px] font-medium text-white"
      style={{ background: tintFor(id) }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/**
 * A button a bot offered in the thread.
 *
 * These are Xyne's own `appActions` — the PR-check app posts them today. They
 * open the action's URL rather than calling it from here: the callback expects
 * the platform's own signed context, and firing it from an app would either
 * fail authentication or, worse, half-succeed.
 */
function ActionButton({ action }: { action: AppAction }) {
  const href = action.actionableUrl;
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium"
      style={{ background: c.signalSoft, color: c.signal }}
    >
      {action.label}
      <span aria-hidden style={{ opacity: 0.6 }}>
        ↗
      </span>
    </a>
  );
}

export function MessageRow({
  message,
  previous,
  channel,
  meId,
  children,
}: {
  message: LedgerMessage;
  previous?: LedgerMessage;
  /** The channel the thread lives in — the primary provenance signal. */
  channel?: ChannelLike | null;
  meId?: string;
  /** Rendered under the body — the agent's activity block goes here. */
  children?: ReactNode;
}) {
  const m = message;

  // Our own entries carry their attribution in the body, because the server
  // drops metadata on write. Strip the marker before anything reads the text.
  const { appId, kind, body: tagged } = parseUpdate(m.content ?? '');
  const { actions, body } = parseBody(tagged);

  // BOT covers two different things and they should not look alike: a Claw
  // agent answering, and an APP posting (a PR bot, an automation, a call
  // summary). Xyne's own dashboard gives app users their normal avatar and
  // reserves the sparkle for the assistant, so the test is whether the sender
  // resolves to somebody with a name — an app does, an agent run does not,
  // because it posts as a synthetic sender the directory has never seen.
  const person = personOf(m.senderId);
  const named = person.name !== m.senderId.slice(0, 8);
  const isAgent = m.msgType === 'BOT' && !appId && !named;
  const routine = isRoutine(m) || kind === 'activity';
  const source = sourceOf(m, channel, appId);
  const acts = actsOf(m.messageActs);

  // An ingested message is sent by a pseudo-bot user, so the directory resolves
  // it to the connector's name. The human is in the ingestion stamp.
  const ext = externalAuthor(m);
  const name = ext?.name ?? (m.senderId === meId ? 'You' : person.name);
  // Team before title: the reference reads "Priya · Marketing", and which team
  // someone is on is what tells you why they are on this ticket. The job title
  // is the more precise fact and the less useful one, so it becomes the
  // tooltip rather than competing for the same 13rem.
  const subtitle = ext ? ext.email : person.team || person.title || '';
  const subtitleTitle = ext ? undefined : [person.title, person.team].filter(Boolean).join(' · ');

  const grouped = !startsGroup(m, previous, channel);

  return (
    <article
      className="group flex gap-2 px-4 py-1"
      style={{ opacity: routine ? 0.62 : 1 }}
      data-message-id={m.messageId}
    >
      {/* Fixed gutter. Grouped rows keep the width and reveal the time on hover
          — losing the indent instead would make the column ragged. */}
      <div className="w-8 shrink-0">
        {grouped ? (
          <span
            className="hidden pt-1 text-right opacity-0 group-hover:inline-block group-hover:opacity-100"
            style={{ fontFamily: mono, fontSize: '9px', color: c.mute }}
          >
            {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        ) : isAgent ? (
          <AgentMark />
        ) : (
          <Avatar id={m.senderId} name={name} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className="text-[13.5px] font-semibold"
              style={{ color: isAgent ? c.agent : c.text }}
            >
              {name}
            </span>
            {subtitle ? (
              <span
                className="truncate text-[11.5px]"
                style={{ color: c.mute, maxWidth: '13rem' }}
                {...(subtitleTitle ? { title: subtitleTitle } : {})}
              >
                {subtitle}
              </span>
            ) : null}
            <SourceBadge source={source} />
            {appId ? (
              <span
                className="rounded-full px-1.5 py-px leading-none"
                style={{
                  fontFamily: mono,
                  fontSize: '9.5px',
                  color: c.signal,
                  border: `1px solid ${c.signalSoft}`,
                  background: c.signalSoft,
                }}
                title="Recorded by an app in this workspace"
              >
                {appId}
              </span>
            ) : null}
            {acts.map(a => (
              <ActBadge key={a} act={a} />
            ))}
            <span
              className="tabular-nums"
              style={{ fontFamily: mono, fontSize: '10px', color: c.mute }}
              title={clock(m.createdAt)}
            >
              {ago(m.createdAt)}
            </span>
          </div>
        )}

        <div
          className="break-words leading-relaxed"
          style={{ fontSize: routine ? '12px' : '13px', color: routine ? c.graphite : c.text }}
        >
          <RichText html={body} format={contentFormat(m)} />
        </div>

        {actions.length ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {actions.map(a => (
              <ActionButton key={a.actionId} action={a} />
            ))}
          </div>
        ) : null}

        {children ? <div className="mt-1.5">{children}</div> : null}
      </div>
    </article>
  );
}

export type { EntryKind };
