# Multiplayer Org

An org's work surfaces in one shell, built entirely on the Xyne Spaces SDK.

The rail holds the org spine — projects, tracks, tickets. The centre runs
whichever app you pick. The right-hand pane holds the one thing that makes it
multiplayer: **the ticket's conversation**, which every app writes into and
nobody owns.

```
   rail            centre                right
   ───────────     ─────────────────     ──────────────────
   Build an app    the app you are       the focused ticket
   All Apps        working in            and its one common
   Projects         (board, desk,        chat — humans, apps
    └ tracks         chat, calls,        and the agent in the
      └ tickets      code)               same thread
   Update Agent
   Insights
```

## Apps

Five are live, and all five write what they did back to the ticket you have
open — never anywhere else, because the shell resolves the target from the
ticket's own row and an app can only name a ticket it was handed.

| App | What it does | What it records |
|---|---|---|
| Tickets Board | the track's kanban — drag to move, open a card to edit it, create tickets in place | moves (including refused and approval-gated ones), edits, assignments, new tickets |
| Xyne Desk | the support inbox — email-driven tickets and their mail threads | replies |
| Xyne Chat | channels and threads, following the track and ticket you have open | nothing — it shows the conversation the others write to |
| Xyne Scribe | live, upcoming and past calls with participants and recordings | a call linked to the ticket it was about |
| GitHub & Bitbucket | a browser inside the shell — repos, pull requests, commits, branches | a repo, PR or commit attached to a ticket |

**Studio** (rail → *Build an app*) is the sixth: describe an app to a Claw agent
and it builds it, previews it live, and versions it.

The store (rail → *All Apps*) lists these alongside what the **workspace**
actually has installed, read from `admin.*` — not a list maintained here.

## Run

```bash
spaces token      # fills XYNE_TOKEN + XYNE_BASE_URL in .env from your browser session
npm install
npm run dev
```

Without a token the shell says so rather than rendering an empty app.

## Ship

```bash
spaces app publish    # first publish creates the app; later ones add a version
```

`push`/`publish` send only what you authored (`App.tsx`, `components/*`,
`lib/*`, `orgApps/*`). The Vite bootstrap, `index.css`, `lib/utils` and
`components/ui/*` are provided by claw at runtime and are never uploaded.

The sandbox caps each uploaded file at **64 KB**.

## Adding an app

Two files, and they are checked against each other:

1. `orgApps/registry.tsx` — mount the component and give it an id.
2. `orgApps/catalogue.ts` — the store entry, under the same id.

`catalogueDrift()` warns in the console if one is edited without the other. The
component receives `OrgAppProps`: the track it is open on, a directory, the
focused ticket, and `postUpdate` — which is the only way it can speak.

## Where things are

| Path | What |
|---|---|
| `App.tsx` | the shell — rail, app pane, ledger, and the single write path |
| `orgApps/` | which apps exist and what the store says about them |
| `components/surfaces/` | the apps themselves |
| `lib/org.ts` `lib/kanban.ts` `lib/tickets.ts` | the SDK layer, with the wire-level surprises documented in place |
| `lib/workitem.ts` | the seam between an app's ticket row and the shell's contract |
| `DESIGN.md` | the unified cross-surface view — what exists, what is missing |
| `SDK-GAPS.md` | what the SDK cannot reach, verified against the real backend |
| `SDK.md` `STUDIO.md` | SDK reference notes and Studio's protocol |
