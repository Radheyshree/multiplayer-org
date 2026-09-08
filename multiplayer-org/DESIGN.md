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

## What is missing

Three things stand between the ledger and the unified view.

### 1. Provenance for entries this app did not write

The ledger shows `via Tickets Board` for its own entries because it stamped
them. A message that arrived from Xyne itself, an email that came into a desk
ticket, a PR comment mirrored by a webhook — those carry no marker, and today
they render as plain messages from a person.

`search.query` already answers this, and it was verified live against the
workspace:

```
search.query({ q: 'pricing' })  ->  200,  totalCount: 2021
  group docType=file   count 10
  group docType=ticket count 10
  group docType=mail   count  9
```

**`docType` is provenance.** `mail` → "via Email", `chat` → "via Chat",
`call` → "via Call", `file` → "via Drive". It is a field that already exists;
nothing needs to be inferred.

### 2. The chain of connections

**`relevanceScore` is the connection.** "What else relates to this ticket?" is a
query, not a graph traversal — which is why this needs no `sdlc_entity_links`
table and no backend.

Seed `search.query` from the ticket's title and the distinctive tokens in its
conversation; rank by `relevanceScore`; group by `docType`. That produces the
candidate set for a **Related** pane: the emails, files, calls and other tickets
that plausibly belong to this piece of work, each already badged with where it
came from.

Computed, not declared — so it stays current without anyone maintaining it.

### 3. Curation

Search proposes; a person decides. A one-click **pin** promotes a candidate to a
confirmed relation on this ticket.

Two storage options, and the choice is not obvious:

- `tickets.addReference(...)` — a **real** cross-ticket relation, visible in
  Xyne itself. Ticket-to-ticket only.
- `storage.collection('related').put(...)` at `global` scope — holds any
  `docType`, shared by every viewer, but invisible outside this app.

Use the first where it fits and the second only where it does not, rather than
putting everything in app storage because it is uniform. A relation that shows
up in Xyne is worth more than a relation that is tidy.

Storage is **key-addressed only** — no queries over values — so anything you
need to filter on must be encoded in the key (`related:{ticketId}:{refId}`).
`global` scope has no locking, so keep writes small and field-scoped: one
document per relation, not one document per ticket.

---

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
