/**
 * Where a project starts.
 *
 * One job: get someone from an empty screen to a running app without them
 * having to think about the tool first. Everything here serves that.
 *
 *  - The composer is the centre of the screen, not a field in a form. It is the
 *    only thing being asked for, so it should be the only thing you see.
 *  - The starters are not decoration. The hardest thing about a builder is the
 *    blank prompt, and the second hardest is not knowing what it can do — so
 *    they are specific, and most of them lean on the thing only this builder
 *    has: a Studio app can read the viewer's real tickets, channels and search
 *    index, so the first turn produces something true about their workspace
 *    rather than a mock with placeholder rows.
 *  - "Surprise me" exists because the cheapest way to learn what a tool is good
 *    at is to watch it do something without having to decide what.
 *  - Recent work sits at the bottom, so a returning user lands on their own
 *    projects rather than on an invitation to start over.
 */
import { useState } from 'react';
import { c, eyebrow, mono } from '../../lib/theme';
import type { StudioAgent } from '../../lib/studioClaw';
import type { StudioProject } from '../../lib/studioStore';
import { AppGlyph, ago } from './StudioApps';

type Starter = { title: string; blurb: string; prompt: string; live: boolean };

const STARTERS: Starter[] = [
  {
    title: 'My workspace, today',
    blurb: 'Tickets assigned to me, my channels, and what changed — from the real SDK.',
    live: true,
    prompt:
      'Build a personal dashboard for the person using the app. Use the xyne SDK for everything: call spaces.users.me() for identity, spaces.tickets to list tickets, spaces.channels.listAll() for channels, and spaces.activities for recent changes. Lay it out as a few stat cards with real counts and a list of the most relevant items. Handle loading and empty states properly, and greet the person by name.',
  },
  {
    title: 'Search, but nicer',
    blurb: 'A search box over spaces.search.query, grouped by where each result came from.',
    live: true,
    prompt:
      'Build a search app. A single search input at the top, and results from spaces.search.query({ q }) below, grouped by docType (ticket, mail, chat, file, call) with a small badge per group showing the count. Show the relevance score on each result. Debounce the input by 300ms. Empty, loading and no-results states all handled properly.',
  },
  {
    title: 'Ticket triage board',
    blurb: 'A kanban over real tickets, with counts per stage.',
    live: true,
    prompt:
      'Build a triage board. Read boards and tickets through the xyne SDK (spaces.boards, spaces.tickets), render one column per stage with the tickets in it, a count in each column header, and a card per ticket showing title, assignee and age. If the SDK returns nothing, say so clearly rather than rendering an empty grid.',
  },
  {
    title: 'A tiny game',
    blurb: 'No data, all interaction — the fastest way to see the loop work.',
    live: false,
    prompt:
      'Build a polished game of 2048 that plays with the arrow keys. Animated tile merges, a score, a best score kept in state, and a restart button. Make it genuinely nice to look at — this is a showcase piece.',
  },
  {
    title: 'Standup helper',
    blurb: 'What you touched recently, shaped into three bullets you can paste.',
    live: true,
    prompt:
      'Build a standup helper. Use spaces.activities and spaces.tickets through the xyne SDK to find what the current user touched in the last two days, and shape it into three sections — Yesterday, Today, Blockers — with a copy-to-clipboard button for the whole thing. Let the user edit any line before copying.',
  },
  {
    title: 'Colour palette explorer',
    blurb: 'Twelve swatches, a hue slider, click to copy.',
    live: false,
    prompt:
      'Build a colour palette explorer: a grid of 12 swatches, click one to copy its hex, and a range slider that rotates the hue of the whole palette. Show the hex on every swatch. Polished and tactile.',
  },
];

/** Picked at random by "Surprise me" — all self-contained, all quick to render. */
const SURPRISES = [
  'Build a keyboard-driven pomodoro timer with 25/5 modes, a large SVG progress ring, and a session counter.',
  'Build a markdown scratchpad with a live preview pane, word count, and localStorage persistence.',
  'Build a tip calculator with a bill input, a 10/15/20/custom segmented control, a party-size stepper and per-person totals.',
  'Build a habit tracker: seven habits, a 7-day grid of toggleable dots, and a streak count per habit.',
  'Build a unit converter covering length, weight and temperature, with a swap button and live conversion as you type.',
  'Build a flashcard app seeded with 12 capital-city cards, flip on click, and shuffle and progress controls.',
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
  const recent = projects.slice(0, 3);

  const submit = (): void => {
    if (draft.trim()) onStart(draft.trim());
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-6 py-10">
        <div className="flex flex-col items-center pt-6 text-center">
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
          className="mt-7 rounded-xl p-px transition-all"
          style={{
            background: focused
              ? `linear-gradient(120deg, ${c.signal}, ${c.agent}, ${c.live})`
              : c.line,
            boxShadow: focused ? '0 8px 30px rgba(75,70,229,0.10)' : 'none',
          }}
        >
          <div className="rounded-[11px] p-3" style={{ background: c.card }}>
            <textarea
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
              placeholder="Describe an app and let the agent do the rest"
              className="w-full resize-none bg-transparent px-1 py-1 text-[14.5px] leading-relaxed outline-none"
              style={{ color: c.text }}
            />

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <AgentPicker agents={agents} value={agentSlug} onChange={onAgent} />

              <div className="ml-auto flex items-center gap-1.5">
                <button
                  onClick={() => onStart(SURPRISES[Math.floor(Math.random() * SURPRISES.length)])}
                  className="rounded-full px-3 py-1.5 text-[11.5px]"
                  style={{ fontFamily: mono, color: c.signal, border: `1px solid ${c.signal}`, background: c.card }}
                  title="Build something at random"
                >
                  ✦ Surprise me
                </button>
                <button
                  onClick={submit}
                  disabled={!draft.trim()}
                  className="rounded-full px-4 py-1.5 text-[11.5px] transition-opacity disabled:opacity-40"
                  style={{ fontFamily: mono, background: c.signal, color: c.paper }}
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

        <ul className="mt-5 flex flex-wrap justify-center gap-1.5">
          {STARTERS.map(starter => (
            <li key={starter.title}>
              <button
                onClick={() => onStart(starter.prompt)}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] transition-colors"
                style={{ border: `1px solid ${c.line}`, background: c.card, color: c.text }}
                title={starter.blurb}
              >
                {starter.live ? (
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: c.live }}
                    aria-hidden
                    title="Uses live workspace data"
                  />
                ) : null}
                {starter.title}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-center text-[11px]" style={{ color: c.mute }}>
          <span className="inline-block size-1.5 rounded-full align-middle" style={{ background: c.live }} />{' '}
          reads your real workspace
        </p>

        <div className="mt-10">
          <div className="flex items-baseline gap-3">
            <div style={{ ...eyebrow, color: c.mute }}>Pick up where you left off</div>
            {loading ? (
              <span className="text-[11px]" style={{ fontFamily: mono, color: c.mute }}>
                loading…
              </span>
            ) : null}
            {projects.length > 0 ? (
              <button
                onClick={onSeeAll}
                className="ml-auto text-[11.5px]"
                style={{ fontFamily: mono, color: c.signal }}
              >
                All {projects.length} apps →
              </button>
            ) : null}
          </div>

          {!loading && projects.length === 0 ? (
            <p className="mt-2 text-[13px]" style={{ color: c.graphite }}>
              Nothing yet. Whatever you build lands here.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2 sm:grid-cols-3">
              {recent.map(project => (
                <li key={project.id}>
                  <button
                    onClick={() => onOpen(project)}
                    className="h-full w-full rounded-lg p-3 text-left transition-colors"
                    style={{ background: c.card, border: `1px solid ${c.line}` }}
                  >
                    <AppGlyph title={project.title} size={26} />
                    <div className="mt-2 truncate text-[12.5px] font-medium" style={{ color: c.text }}>
                      {project.title}
                    </div>
                    <div className="mt-0.5 text-[10.5px]" style={{ fontFamily: mono, color: c.mute }}>
                      v{project.head} · {ago(project.updatedAt)}
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
