# One surface for one piece of work

**Xyne Spaces SDK only · no backend changes · no SDLC dependency**

This is the design note for the feature the whole app exists for, and the one
still to be built: **seeing everything about a piece of work in one place** —
its tickets, its mail, its pull requests, its calls, its conversations — with
each item saying where it came from.

Everything below the "What already exists" line is built and running. Everything
under "What is missing" is the remaining work.

---

## The reframing that matters

An earlier version of this document proposed a **Track**: a new document in app
storage holding pinned references, with its own list screen, its own chat, and
its own discovery pane. That was built, and then removed. Not because it did not
work — it did — but because it was a *second* place to look, and the entire
premise of this product is that a second place to look is the problem.

The org shell already has the right primitive, and it is not new:

> **A ticket's conversation is the unified surface.**

Every ticket row carries `conversationId` — required, non-optional, already
there. It is a real Xyne thread: open Xyne next to this app and the same
messages are in it. The shell owns that thread, and no app may name a target of
its own (see `orgApps/registry.tsx`). So every surface writing what it did lands
in one ordered record per ticket, readable by a person and by an agent, without
a new table, a new document, or a new screen.

The remaining work is therefore not "build a unified view". It is **get the
rest of the surfaces to write into the one that already exists, and make what is
already in it legible.**

---

## What already exists

### The ledger

`lib/appUpdate.ts` defines the record. An app calls `postUpdate(ticket, text,
kind)`; the shell resolves the target from the ticket's own row and stamps the
attribution. Two layers, because completeness without legibility is noise:

| Kind | Meaning | Rendering |
|---|---|---|
| `activity` | something changed — the audit trail | collapsed, dimmed |
| `note` | somebody wrote something for other people | full |

The marker rides inside `content` because the server hardcodes
`messages.metadata` to `null` on write, so `content` is the only field that
survives the round trip. Move it to metadata the moment that opens up; keep the
parser so old entries still render.

The ledger has a layer filter — **All / People / Apps / Agent** — so a reader
can see people first and the machinery only when they want it, while the agent
always reads everything.

### What writes into it today

| Surface | Writes | Kind |
|---|---|---|
| Tickets Board | stage moves (applied, queued *and* refused), field edits, tags, sub-tickets, new tickets | `activity` |
| Xyne Desk | replies to a support ticket | `note` |
| Xyne Scribe | a call linked to a ticket, with room link and attendees | `note` |
| GitHub & Bitbucket | a repo, pull request or commit attached to a ticket | `note` |
| Xyne Chat | nothing — it *shows* the conversation the others write to | — |

Recording refused and queued moves as well as successful ones is deliberate:
"we tried this and the board said no" is exactly the fact that otherwise lives
only in someone's memory.

### Scope, honestly

The shell hands every app the open track (`projectId` + `channelId`). Not every
app can use it, and pretending otherwise would silently show the wrong thing:

| Surface | Track-scoped? | Why |
|---|---|---|
| Tickets Board | **yes** | `listKanban({ filters: { sourceChannels } })` filters server-side |
| Xyne Chat | **yes** | a track *is* a channel — the same row, read through another surface |
| Xyne Scribe | **partly** | call rows carry `channelId`, so the filter is real — but no list call takes a channel argument, so it narrows after the read, not instead of it |
| Xyne Desk | **no** | a desk is an EMAIL channel and a track is a work channel. No ticket links one to the other, so filtering by `scope.channelId` would reliably return nothing |
| GitHub & Bitbucket | **no** | host-scoped, not track-scoped |

---

## What was missing, and what now exists

All three are built. What follows is what each turned out to be once the code
was read rather than guessed at — the guesses were wrong in interesting ways.

### 1. Provenance — `lib/provenance.ts`

The plan said `docType` would supply it. That is true for the Related pane, and
false for the thread: a message has no `docType`. There is no `source` column on
`messages` either — the row has nineteen columns and not one names an origin.

Three real signals, in the order the dashboard itself trusts them:

- **`channel.type`** — `DEFAULT | EMAIL | SUPPORT | SLACK | APP | CALL |
  SOCIAL_MEDIA | SDLC`. Xyne's own SupportScreen badges from exactly this, and
  it is the only signal that is right for slack-desk, whose messages are
  deliberately transformed into Email rows. Counted live here: DEFAULT 1063,
  EMAIL 10, APP 2, SDLC/SUPPORT/SLACK 1 each.
- **`message.metadata`** — rich on read, forced to null only on WRITE. The
  ingestion pipeline stamps `{ externalSource, externalAuthor, eventType,
  webUrl }`; PR webhooks add `{ prWebhook, prUrl, prId, prEvent }`; automations
  add `{ isAutomation, releaseStatus }`.
- **`msgType`** — `USER | BOT | SYSTEM | FORWARDED`, which says *who* wrote a
  line, never *where it came from*. Every ingested message is BOT, but so is
  every automation and call summary, so BOT alone proves nothing.

The badge vocabulary is closed on purpose. The live adapter registry is zoho,
slack-webhook-tickets, slack-desk, microsoft, google, ozonetel and
google-play-reviews, plus app-desk. **There is no GitHub, Jira, Drive or Notion
ingest** — Jira and Confluence exist only as one-shot importers. A "via Jira"
badge would advertise an integration the product does not have.

Two facts that shaped the row: `contentFormat` is markdown roughly three times
as often as html, so the renderer handles both; and department is
`user_profiles.team` via `users.getProfiles`, not on the user row at all.

### 2. The chain of connections — `lib/related.ts`

Confirmed live. `search.query({ q })` returns `groups[{ groupBy: 'docType',
groupValue, count, results }]`, and each hit carries `title`, `subtitle`,
`context`, `relevanceScore` and a `searchContext` with the ids to open it.

Two corrections to the plan:

- The parameter is **`q`**, not `query`.
- **`ticketId` is not a usable scope.** The filter is accepted, but measured
  against a real ticket it constrains only the ticket index — the other buckets
  came back with ten unrelated users and ten unrelated files. Relevance is the
  only honest filter, which is why the seed does the work: drop stopwords and
  anything under four characters, keep the rare vocabulary, lead with the ticket
  key. `"EULER-80740 moneyframework merchant funded"` returns the four other
  MoneyFramework tickets at 0.84–0.89.

Hits also arrive with `<hi>` highlight markup, which is stripped rather than
rendered.

### 3. Curation

`Link` writes the connection into the ticket's own conversation, the same place
every app writes. Chosen over app storage because a relation Xyne itself can see
outlives this app.

---

## Agents, and the one thing that is not reachable

**`claw.getRun()` returns far more than its type admits.** `ClawRun` declares
four fields; the registry entry sets no `mapResult` and every hop passes the
object through, so what arrives is the whole `AgentRun` row — including
`toolInvocations`, each with `toolName`, `args`, `result`, `isError`,
`durationMs` and `status`. That is what makes an itemised account of the agent's
work possible instead of a spinner. It is polled: Xyne's real SSE streaming
(`snapshot | delta | reasoning | invocation | label | done`) is
dashboard-internal and the SDK has no streaming primitive.

**Awakening — Xyne's autonomous agent feature — is real and unreachable.** An
agent's config carries an `awakening` block; a tick worker claims due agents
with `FOR UPDATE SKIP LOCKED`, collects a sealed window of channel messages, and
runs an ordered gate before dispatching. But the string "awakening" appears zero
times in `apps/backend/src` (the only service the SDK talks to) and zero times
in the SDK dist; `sdk.claw` is four methods; `ClawAgent` has no `config`; and
`POST /api/sdk/v1/claw/runs` validates a closed five-field body. We cannot
enable it, and cannot even read whether it is on.

So `lib/watcher.ts` reimplements the part an app can do, and the UI says
"while this ticket is open in a browser" rather than claiming otherwise. It
keeps three rules from Awakening's own design: the watermark is held 30s behind
now so it cannot step over unreplicated rows; runs are capped at four an hour;
and the gate is ordered and deterministic — mention, then code event, then a
question left open ten minutes — so a person can predict what will wake it.

The platform-native alternative, if server-side autonomy is ever needed, is
`automations.*` with a `RUN_AGENT` step on `MESSAGE_RECEIVED`. Two traps there:
`configJson` must be `JSON.stringify`'d despite being typed `unknown`, and
nothing runs until a four-step approval lifecycle completes. There is no CRON
trigger implemented, so Awakening's heartbeat has no equivalent.

## The shape it should take

Not a new screen. The shell already has the right three-column layout, and the
right-hand pane is already the ledger. The Related pane belongs **in that pane**,
as a third tab beside the conversation and the layer filter:

```
   rail            centre                right
   ───────────     ─────────────────     ──────────────────
   projects        the app you are       ┌ Chat ─ Related ┐
    └ tracks       working in            │ the ledger,    │
      └ tickets    (board, desk,         │ or the things  │
                    chat, code…)         │ connected to   │
                                         │ this ticket    │
                                         └────────────────┘
```

That keeps the promise the shell already makes: one place per piece of work, and
the app you happen to be in never changes where the record lives.

---

## Why this is not a ticket-shaped problem

A ticket is a work item with a stage and an assignee. "The thing I am following"
is not — it can hold a ticket, three emails, a call recording and a document
without any of them being subordinate to the others.

The resolution is that the ticket stays the *anchor* (it has the conversation,
and the hierarchy project → board → ticket stays where it belongs), while
association becomes a **flat set hanging off it**. The ticket is the id everyone
already shares; the related set is what makes it a surface rather than a row.

---

## Constraints that shaped all of this

- The published sandbox caps each file at **64 KB**, and only
  `.tsx .ts .jsx .js .css .json` are uploaded. Imports must be relative.
- shadcn/ui, Tailwind and `cn()` are injected by the host — never pushed.
- There is no push channel: the ledger is polled at 5 s, paused while the tab is
  hidden and re-synced on focus.
- Agent runs are the only thing that streams (`LiveKind` = snapshot / delta /
  reasoning / invocation / label / done). Nothing else does.
- `spaces.claw.run({ agent, task, conversationId, channelId })` makes an agent
  reply **into the ticket's own thread** — which is what puts the agent in the
  same record as everyone else rather than in a side channel.

## Risks

| Risk | Mitigation |
|---|---|
| Search relevance is noisy on short seeds | seed from title *and* conversation tokens, show the score, let a person pin |
| The ledger gets loud once every surface writes | the `activity` layer already exists for exactly this — default the view to People |
| `global` storage has no locking | one document per relation, small field-scoped writes |
| A pinned entity is deleted in Xyne | nodes are references resolved live, so a dead one is visible as dead rather than silently stale |
