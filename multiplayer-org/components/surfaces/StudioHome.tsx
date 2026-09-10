/**
 * Where a project starts.
 *
 * One job: get someone from an empty screen to a running app without them
 * having to think about the tool first. Everything here serves that.
 *
 *  - The composer is the centre of the screen, not a field in a form. Its
 *    placeholder types out real asks, because an example teaches the register
 *    faster than instructions do.
 *  - The starters are cards with their blurb VISIBLE — a first user should not
 *    have to hover to learn what a button does. Clicking one puts the full
 *    prompt in the composer rather than firing a 60-second run on a curious
 *    click; the prompt is right there to read, edit, and send.
 *  - "Surprise me" shuffles through its ideas where you can see them and lands
 *    on one in the composer. The old version fired a hidden random prompt —
 *    a black box; watching the dice land is the feature.
 *  - Recent work sits at the bottom, so a returning user lands on their own
 *    projects rather than on an invitation to start over.
 */
import { useEffect, useRef, useState } from 'react';
import { c, eyebrow, mono } from '../../lib/theme';
import type { StudioAgent } from '../../lib/studioProtocol';
import type { StudioProject } from '../../lib/studioRuntime';
import { AppGlyph, ago } from './StudioApps';
import { riseIn, Shimmer } from './StudioCode';

type Starter = { glyph: string; title: string; blurb: string; prompt: string; live: boolean };

const STARTERS: Starter[] = [
  {
    glyph: '◐',
    title: 'My workspace, today',
    blurb: 'Tickets assigned to me, my channels, and what changed — from the real SDK.',
    live: true,
    prompt:
      'Build a personal dashboard for the person using the app. Use the xyne SDK for everything: call spaces.users.me() for identity, spaces.tickets to list tickets, spaces.channels.listAll() for channels, and spaces.activities for recent changes. Lay it out as a few stat cards with real counts and a list of the most relevant items. Handle loading and empty states properly, and greet the person by name.',
  },
  {
    glyph: '⌕',
    title: 'Search, but nicer',
    blurb: 'A search box over spaces.search.query, grouped by where each result came from.',
    live: true,
    prompt:
      'Build a search app. A single search input at the top, and results from spaces.search.query({ q }) below, grouped by docType (ticket, mail, chat, file, call) with a small badge per group showing the count. Show the relevance score on each result. Debounce the input by 300ms. Empty, loading and no-results states all handled properly.',
  },
  {
    glyph: '▥',
    title: 'Ticket triage board',
    blurb: 'A kanban over real tickets, with counts per stage.',
    live: true,
    prompt:
      'Build a triage board. Read boards and tickets through the xyne SDK (spaces.boards, spaces.tickets), render one column per stage with the tickets in it, a count in each column header, and a card per ticket showing title, assignee and age. If the SDK returns nothing, say so clearly rather than rendering an empty grid.',
  },
  {
    glyph: '✜',
    title: 'A tiny game',
    blurb: 'No data, all interaction — the fastest way to see the loop work.',
    live: false,
    prompt:
      'Build a polished game of 2048 that plays with the arrow keys. Animated tile merges, a score, a best score kept in state, and a restart button. Make it genuinely nice to look at — this is a showcase piece.',
  },
  {
    glyph: '☴',
    title: 'Standup helper',
    blurb: 'What you touched recently, shaped into three bullets you can paste.',
    live: true,
    prompt:
      'Build a standup helper. Use spaces.activities and spaces.tickets through the xyne SDK to find what the current user touched in the last two days, and shape it into three sections — Yesterday, Today, Blockers — with a copy-to-clipboard button for the whole thing. Let the user edit any line before copying.',
  },
  {
    glyph: '◩',
    title: 'Colour palette explorer',
    blurb: 'Twelve swatches, a hue slider, click to copy.',
    live: false,
    prompt:
      'Build a colour palette explorer: a grid of 12 swatches, click one to copy its hex, and a range slider that rotates the hue of the whole palette. Show the hex on every swatch. Polished and tactile.',
  },
];

/** Shuffled through by "Surprise me" — all self-contained, all quick to render. */
const SURPRISES = [
  'Build a keyboard-driven pomodoro timer with 25/5 modes, a large SVG progress ring, and a session counter.',
  'Build a markdown scratchpad with a live preview pane, word count, and localStorage persistence.',
  'Build a tip calculator with a bill input, a 10/15/20/custom segmented control, a party-size stepper and per-person totals.',
  'Build a habit tracker: seven habits, a 7-day grid of toggleable dots, and a streak count per habit.',
  'Build a unit converter covering length, weight and temperature, with a swap button and live conversion as you type.',
  'Build a flashcard app seeded with 12 capital-city cards, flip on click, and shuffle and progress controls.',
];

/** Typed into the empty composer, one at a time — the register, by example. */
const HINTS = [
  'Build a retro calculator with big tactile keys…',
  'Build a dashboard of my open tickets…',
  'Build a kanban board over the real workspace…',
  'Build a wheel-of-names picker for standup…',
  'Build a search box over everything in Xyne…',
];

export function StudioHome({
  projects,
  agents,
  agentSlug,
  onAgent,
  onStart,
  onOpen,
  onSeeAll,
  loading,
  error,
}: {
  projects: StudioProject[];
  agents: StudioAgent[];
  agentSlug: string;
  onAgent: (slug: string) => void;
  onStart: (intent: string) => void;
  onOpen: (project: StudioProject) => void;
  onSeeAll: () => void;
  loading: boolean;
  error: string | null;
}) {
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  /** True briefly after a starter or the dice fills the composer — the Build
   *  button breathes so the next step is unmissable. */
  const [armed, setArmed] = useState(false);
  const [shuffling, setShuffling] = useState(false);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const timers = useRef<number[]>([]);
  const recent = projects.slice(0, 3);
  const hint = useTypedHint(draft === '' && !shuffling);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const submit = (): void => {
    if (draft.trim() && !shuffling) onStart(draft.trim());
  };

  /** Put a prompt where the user can read it, and light the way to Build. */
  const propose = (prompt: string): void => {
    setDraft(prompt);
    setArmed(true);
    box.current?.focus();
    timers.current.push(window.setTimeout(() => setArmed(false), 3200));
  };

  /** Roll visibly: flick through the ideas in the composer, land on one. */
  const surprise = (): void => {
    if (shuffling) return;
    setShuffling(true);
    const order = [...SURPRISES].sort(() => Math.random() - 0.5);
    order.forEach((idea, i) => {
      timers.current.push(
        window.setTimeout(() => {
          setDraft(idea);
          if (i === order.length - 1) {
            setShuffling(false);
            setArmed(true);
            box.current?.focus();
            timers.current.push(window.setTimeout(() => setArmed(false), 3200));
          }
        }, i * 90 + (i === order.length - 1 ? 140 : 0)),
      );
    });
  };

  return (
    <div className="sfx-anim h-full min-h-0 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-6 py-10">
        <div className="flex flex-col items-center pt-4 text-center" style={riseIn(0)}>
          <h1
            className="flex items-center gap-3 text-[30px] font-semibold tracking-tight"
            style={{ color: c.text }}
          >
            Build your ideas with Claw
            <span style={{ color: c.signal, fontSize: 26 }} aria-hidden>
              ✦
            </span>
          </h1>
          <p className="mt-2 max-w-lg text-[13.5px] leading-relaxed" style={{ color: c.graphite }}>
            Describe an app. An agent writes the files, they run here for real, and everything after
            that is a followup.
          </p>
        </div>

        {/* A 1px gradient frame that lights up on focus — the only ornament on the
            screen, and it is on the one thing the screen is asking you to use. */}
        <div
          className="mt-7 rounded-xl p-px transition-all duration-300"
          style={{
            ...riseIn(1),
            background: focused
              ? `linear-gradient(120deg, ${c.signal}, ${c.agent}, ${c.live})`
              : c.line,
            boxShadow: focused ? `0 8px 30px color-mix(in srgb, ${c.signal} 12%, transparent)` : 'none',
          }}
        >
          <div className="rounded-[11px] p-3" style={{ background: c.card }}>
            <textarea
              ref={box}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={3}
              placeholder={hint}
              className="w-full resize-none bg-transparent px-1 py-1 text-[14.5px] leading-relaxed outline-none"
              style={{ color: shuffling ? c.graphite : c.text }}
            />

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <AgentPicker agents={agents} value={agentSlug} onChange={onAgent} />

              <div className="ml-auto flex items-center gap-1.5">
                <button
                  onClick={surprise}
                  disabled={shuffling}
                  className="rounded-full px-3 py-1.5 text-[11.5px] transition-transform hover:scale-[1.03] active:scale-95"
                  style={{ fontFamily: mono, color: c.signal, border: `1px solid ${c.signal}`, background: c.card }}
                  title="Shuffle through the ideas and land on one — you send it"
                >
                  <span
                    className="mr-1 inline-block"
                    aria-hidden
                    style={shuffling ? { animation: 'sfx-spin 0.5s linear infinite' } : undefined}
                  >
                    ✦
                  </span>
                  {shuffling ? 'Rolling…' : 'Surprise me'}
                </button>
                <button
                  onClick={submit}
                  disabled={!draft.trim() || shuffling}
                  className="rounded-full px-4 py-1.5 text-[11.5px] transition-all disabled:opacity-40"
                  style={{
                    fontFamily: mono,
                    background: c.signal,
                    color: c.signalText,
                    ...(armed && draft.trim() ? { animation: 'sfx-breathe 1.4s ease-out 2' } : {}),
                  }}
                >
                  Build it
                </button>
              </div>
            </div>
          </div>
        </div>

        {error ? (
          <p className="mt-3 text-center text-[12.5px]" style={{ color: c.attention }}>
            {error}
          </p>
        ) : null}

        {/* Cards, not pills: the blurb is the pitch and it is readable without a
            hover. Clicking loads the prompt into the composer — on a screen for
            first users, a curious click must never cost a 60-second run. */}
        <ul className="mt-6 grid gap-2 sm:grid-cols-3">
          {STARTERS.map((starter, i) => (
            <li key={starter.title} style={riseIn(i + 2)}>
              <button
                onClick={() => propose(starter.prompt)}
                className="group h-full w-full rounded-lg p-3 text-left transition-all duration-150 hover:-translate-y-0.5"
                style={{ border: `1px solid ${c.line}`, background: c.card }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = c.signal; e.currentTarget.style.boxShadow = `0 6px 18px color-mix(in srgb, ${c.signal} 8%, transparent)`; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = c.line; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden className="text-[15px] leading-none" style={{ color: c.signal }}>
                    {starter.glyph}
                  </span>
                  <span className="truncate text-[12.5px] font-medium" style={{ color: c.text }}>
                    {starter.title}
                  </span>
                  {starter.live ? (
                    <span
                      className="ml-auto size-1.5 shrink-0 rounded-full"
                      style={{ background: c.live }}
                      aria-hidden
                      title="Uses live workspace data"
                    />
                  ) : null}
                </div>
                <p className="mt-1.5 text-[11px] leading-snug" style={{ color: c.mute }}>
                  {starter.blurb}
                </p>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2.5 text-center text-[11px]" style={{ color: c.mute }}>
          <span className="inline-block size-1.5 rounded-full align-middle" style={{ background: c.live }} />{' '}
          reads your real workspace · a card loads its prompt here for you to edit and send
        </p>

        <div className="mt-10" style={riseIn(8)}>
          <div className="flex items-baseline gap-3">
            <div style={{ ...eyebrow, color: c.mute }}>Pick up where you left off</div>
            {projects.length > 0 ? (
              <button
                onClick={onSeeAll}
                className="ml-auto text-[11.5px] underline-offset-2 hover:underline"
                style={{ fontFamily: mono, color: c.signal }}
              >
                All {projects.length} apps →
              </button>
            ) : null}
          </div>

          {loading ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {[0, 1, 2].map(i => (
                <div key={i} className="rounded-lg p-3" style={{ border: `1px solid ${c.line}`, background: c.card }}>
                  <Shimmer w={26} h={26} r={7} />
                  <Shimmer w="70%" h={12} style={{ marginTop: 10 }} />
                  <Shimmer w="40%" h={9} style={{ marginTop: 6 }} />
                </div>
              ))}
            </div>
          ) : projects.length === 0 ? (
            <p className="mt-2 text-[13px]" style={{ color: c.graphite }}>
              Nothing yet. Whatever you build lands here.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2 sm:grid-cols-3">
              {recent.map((project, i) => (
                <li key={project.id} style={riseIn(i + 9)}>
                  <button
                    onClick={() => onOpen(project)}
                    className="group h-full w-full rounded-lg p-3 text-left transition-all duration-150 hover:-translate-y-0.5"
                    style={{ background: c.card, border: `1px solid ${c.line}` }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = c.signal; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = c.line; }}
                  >
                    <AppGlyph title={project.title} size={26} />
                    <div className="mt-2 truncate text-[12.5px] font-medium" style={{ color: c.text }}>
                      {project.title}
                    </div>
                    <div className="mt-0.5 flex items-baseline gap-1 text-[10.5px]" style={{ fontFamily: mono, color: c.mute }}>
                      v{project.head} · {ago(project.updatedAt)}
                      <span className="ml-auto opacity-0 transition-opacity group-hover:opacity-100" style={{ color: c.signal }}>
                        open →
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The typing placeholder. Returns the placeholder string; types a hint out,
 * holds it, wipes it, moves to the next. Runs only while `active` — the moment
 * the user has text of their own, the stage is theirs.
 */
function useTypedHint(active: boolean): string {
  const [text, setText] = useState(HINTS[0]);
  useEffect(() => {
    if (!active) return;
    let hint = Math.floor(Math.random() * HINTS.length);
    let len = 0;
    let hold = 0;
    const id = window.setInterval(() => {
      const full = HINTS[hint];
      if (len < full.length) {
        len += 2; // two chars a tick reads as typing without taking all day
        setText(full.slice(0, len));
      } else if (hold < 28) {
        hold += 1;
      } else {
        hint = (hint + 1) % HINTS.length;
        len = 0;
        hold = 0;
      }
    }, 55);
    return () => clearInterval(id);
  }, [active]);
  return active ? text : 'Describe an app and let the agent do the rest';
}

/**
 * 214 agents in this workspace, most of them specialists. The list is ordered so
 * the ones that reliably follow a format instruction come first, but a
 * codebase-specific agent writing an app about that codebase is the interesting
 * case, so none of them are hidden.
 */
export function AgentPicker({
  agents,
  value,
  onChange,
}: {
  agents: StudioAgent[];
  value: string;
  onChange: (slug: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span style={{ ...eyebrow, color: c.mute }}>Agent</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="max-w-44 rounded px-1.5 py-1 text-[11.5px] outline-none"
        style={{ fontFamily: mono, border: `1px solid ${c.line}`, background: c.paper, color: c.text }}
      >
        {agents.length === 0 ? <option value={value}>{value}</option> : null}
        {agents.map(agent => (
          <option key={agent.slug} value={agent.slug}>
            {agent.name}
          </option>
        ))}
      </select>
    </label>
  );
}
