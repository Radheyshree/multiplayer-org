/**
 * The update agent's turn in the thread.
 *
 * It renders as an agent turn and not as a banner, because that is what it is:
 * the Claw mark, a name, the ask in a bubble, the evidence under it, and buttons.
 * A ticket's thread already holds everything that happened to this ticket from
 * every surface; this is the one participant that reads all of it and says
 * something about it without being asked.
 *
 * TWO ADDRESSEES, TWO DIFFERENT THINGS TO SHOW.
 *
 *   IT IS YOU      — you are reading the ticket it is about, so there is nothing
 *                    to deliver. It asks, and the buttons do the thing.
 *   IT IS SOMEBODY  — you cannot answer for them, so the only useful button is
 *   ELSE             the one that asks them, by name, in the thread, with a real
 *                    mention so the platform notifies them like any other.
 *
 * WHY THE BUTTONS SAY WHAT THEY SAY. "Move to LIVE" and "Move to Sandbox" are not
 * two spellings of one action — they are the next stage on two different boards,
 * read off each ticket's own board. There is life after Merged on both boards in
 * this workspace, so a fixed "Mark as done" would be wrong more often than right.
 * See lib/nudge.ts.
 *
 * NOTHING HERE IS AUTOMATIC. The card appears; nothing changes until somebody
 * presses something. An agent that closed your tickets for you would be a
 * different and much worse product.
 */
import { useState } from 'react';
import { c, eyebrow, mono } from '../../lib/theme';
import { personOf, tintFor, initials } from '../../lib/people';
import { BrandMark } from './BrandMark';
import type { Nudge, Suggestion } from '../../lib/nudge';

/** Rules, in the words that go on the eyebrow. */
const HEADLINE: Record<Nudge['rule'], string> = {
  unanswered: 'waiting on an answer',
  shipped: 'this one shipped',
  'pr-merged': 'the code landed',
  'pr-open': 'still in review',
  'pr-declined': 'the code did not land',
  'eta-passed': 'the date passed',
  'gone-quiet': 'gone quiet',
  unowned: 'nobody owns it',
};

export function UpdateAgent({
  nudge,
  meId,
  /** Running an action — one at a time, and the card says which. */
  busy,
  onAccept,
  onAsk,
  onInvestigate,
  onSnooze,
  onDismiss,
  note,
}: {
  nudge: Nudge | null;
  meId?: string;
  busy: string | null;
  /** Take the suggestion. The caller writes the change AND records it. */
  onAccept: (s: Suggestion) => Promise<void>;
  /** Ask the owner for an update, in the thread, by name. */
  onAsk: () => Promise<void>;
  /** Hand the finding to the agent and let it look into it. */
  onInvestigate: () => Promise<void>;
  onSnooze: () => Promise<void>;
  onDismiss: () => Promise<void>;
  note?: string | null;
}) {
  const [open, setOpen] = useState(true);
  if (!nudge) return null;

  const owner = nudge.ownerId ? personOf(nudge.ownerId) : null;
  const mine = Boolean(nudge.ownerId && nudge.ownerId === meId);
  const who = mine ? 'you' : (owner?.name ?? 'nobody in particular');

  if (!open) {
    return (
      <div className="px-4 py-1">
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-[11px]"
          style={{ color: c.mute }}
        >
          <BrandMark system="claw" size={12} />
          {nudge.xyneId} needs an update — show
        </button>
      </div>
    );
  }

  return (
    <article className="flex gap-2 px-4 py-1.5">
      <div className="w-8 shrink-0">
        {/* The Claw mark draws its own disc in the agent tint, so the gutter
            box stays transparent — stacking one on the other made a pale square
            with an almost invisible mark inside it. */}
        <span className="grid size-8 place-items-center" aria-label="Update agent">
          <BrandMark system="claw" size={28} />
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[13.5px] font-semibold" style={{ color: c.agent }}>
            Update agent
          </span>
          <span style={{ ...eyebrow, fontSize: '9px', color: c.attention }}>
            {HEADLINE[nudge.rule]}
          </span>
          {/* Who it is for, with their face — the reference puts a person on
              every row and this row is about a person more than most. */}
          {owner ? (
            <span className="flex items-center gap-1">
              <span
                className="grid size-4 place-items-center rounded-[3px] text-[7px] font-medium text-white"
                style={{ background: tintFor(owner.id) }}
                aria-hidden
              >
                {initials(owner.name)}
              </span>
              <span className="text-[11.5px]" style={{ color: c.mute }}>
                for {mine ? 'you' : owner.name}
              </span>
            </span>
          ) : (
            <span className="text-[11.5px]" style={{ color: c.mute }}>
              nobody assigned
            </span>
          )}
          <button
            onClick={() => setOpen(false)}
            className="ml-auto text-[11px]"
            style={{ color: c.mute }}
            aria-label="Collapse"
          >
            hide
          </button>
        </div>

        <div
          className="mt-1 inline-block max-w-[46rem] break-words rounded-2xl px-3.5 py-2 leading-relaxed"
          style={{
            fontSize: '13.5px',
            color: c.text,
            background: c.bubbleAgent,
            borderTopLeftRadius: '0.35rem',
          }}
        >
          {mine || !owner ? nudge.ask : `${firstName(owner.name)} — ${lowerFirst(nudge.ask)}`}
        </div>

        {/* The evidence, always, and never in the bubble. The ask is the agent
            speaking; this is the row of the ticket it read to say it, and a
            reader must be able to check one against the other. */}
        <p className="mt-1 text-[11px] leading-relaxed" style={{ color: c.mute }}>
          {nudge.because}
          <span style={{ fontFamily: mono, fontSize: '10px' }}>
            {' '}· {ownerNote(nudge.ownerReason, who)}
          </span>
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {/* Somebody else's ticket: the only honest primary action is to ask
              them. Changing the status of work you are not doing, because a
              robot suggested it, is how people learn to distrust the robot. */}
          {!mine && owner ? (
            <button
              onClick={() => void onAsk()}
              disabled={Boolean(busy)}
              className="rounded-md px-2.5 py-1 text-[11.5px] font-medium disabled:opacity-40"
              style={{ background: c.signal, color: c.signalText }}
            >
              {busy === 'ask' ? 'Asking…' : `Ask ${firstName(owner.name)} for an update`}
            </button>
          ) : (
            nudge.suggestions.map((s, i) => (
              <button
                key={`${s.kind}-${s.label}`}
                onClick={() => void onAccept(s)}
                disabled={Boolean(busy)}
                className="rounded-md px-2.5 py-1 text-[11.5px] disabled:opacity-40"
                style={
                  i === 0
                    ? { background: c.signal, color: c.signalText, fontWeight: 500 }
                    : { border: `1px solid ${c.line}`, color: c.text }
                }
              >
                {busy === s.label ? 'Working…' : s.label}
              </button>
            ))
          )}

          <button
            onClick={() => void onInvestigate()}
            disabled={Boolean(busy)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] disabled:opacity-40"
            style={{ background: c.agentSoft, color: c.agent }}
            title="Let the agent read the whole ticket and say whether this is really finished"
          >
            <span aria-hidden>✦</span>
            {busy === 'investigate' ? 'Reading…' : 'Check it'}
          </button>

          <span className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => void onSnooze()}
              disabled={Boolean(busy)}
              className="rounded px-1.5 py-0.5 text-[11px] disabled:opacity-40"
              style={{ color: c.mute }}
              title="Ask me again in three days"
            >
              Later
            </button>
            <button
              onClick={() => void onDismiss()}
              disabled={Boolean(busy)}
              className="rounded px-1.5 py-0.5 text-[11px] disabled:opacity-40"
              style={{ color: c.mute }}
              title="Stop asking about this. Everyone on the ticket stops being asked too."
            >
              Never mind
            </button>
          </span>
        </div>

        {note ? (
          <p className="mt-1 text-[11px]" style={{ color: c.live }}>
            {note}
          </p>
        ) : null}
      </div>
    </article>
  );
}

/**
 * Lower-case the first letter when joining "Om — " to a sentence.
 *
 * Not when the sentence opens on an acronym: the first version of this turned
 * "PR #9420 merged two months ago" into "pR #9420", which is the kind of detail
 * that makes a careful surface look careless.
 */
const lowerFirst = (s: string): string => {
  if (!s) return s;
  if (s[1] && s[1] === s[1].toUpperCase() && /[A-Z]/.test(s[1])) return s;
  return s[0].toLowerCase() + s.slice(1);
};
const firstName = (s: string): string => s.split(/\s+/)[0] ?? s;

/** Why this person. Small, monospaced, and always there — "why me?" is first. */
function ownerNote(reason: Nudge['ownerReason'], who: string): string {
  switch (reason) {
    case 'assignee':
      return `assigned to ${who}`;
    case 'merged-it':
      return `${who} settled the pull request`;
    case 'creator':
      return `${who} opened it`;
    case 'last-speaker':
      return `${who} spoke last`;
    default:
      return 'no assignee, no author on record';
  }
}
