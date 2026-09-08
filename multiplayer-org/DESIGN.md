# Threadline — an SDK-only unified track surface

**Hackathon build · Xyne Spaces SDK only · no backend changes, no SDLC dependency**

---

## The insight

`search.query` already returns results **grouped by `docType`** — verified live against the workspace:

```
search.query({ q: 'pricing' })  ->  200,  totalCount: 2021
  group docType=file   count 10
  group docType=ticket count 10
  group docType=mail   count  9
```

That grouping is simultaneously the two things this product needs:

- **`docType` is provenance.** `mail` → "via Email". `chat` → "via Chat". `ticket` → "via Ticket". `call` → "via Call". The badges in the mock are a field that already exists.
- **`relevanceScore` is the connection.** "What else relates to this?" is a query, not a graph traversal.

So we don't need `sdlc_entity_links`, and we don't need a backend. **Search is the graph; app storage is the memory.**

---

## The model

A **Track** is a document in app storage, `global` scope — so every viewer in the workspace shares it.

```ts
type Track = {
  id: string;
  title: string;
  channelId: string;        // where its chat lives
  conversationId: string;   // a REAL Xyne thread — created via conversations.create
  nodes: TrackNode[];       // pinned references to real Spaces entities
  createdBy: string;
  createdAt: string;
};

type TrackNode = {
  refId: string;            // the real entity id
  docType: string;          // 'ticket' | 'mail' | 'chat' | 'file' | 'call' — the badge
  title: string;
  subtitle?: string;
  addedBy: string;
  addedAt: string;
  note?: string;            // why it belongs
};
```

Nothing is copied. A node is a **reference** — resolved live through the SDK on every render, so the track never goes stale.

### Why this is better than a ticket

A ticket is a work item with a stage and an assignee. A track is *"the thing I'm following"* — and it can hold a ticket, three emails, a call recording and a doc without any of them being subordinate to the others. The hierarchy stays where it belongs (project → board → ticket); association becomes a flat, user-curated set.

---

## What powers each requirement

Every one of these is a real SDK call. No backend work.

| Requirement | SDK mechanism |
|---|---|
| Unified timeline with provenance | `search.query` grouped by `docType` + pinned nodes resolved live |
| Chain of connections | `search.query` seeded from a node's title/context, ranked by `relevanceScore` |
| One shared chat per track | `conversations.create({ channelId, content })` → a **real Xyne thread**, then `messages.send` / `messages.listByConversation` |
| Agent in the thread | `claw.run({ agent, task, conversationId })` — passing `conversationId` makes the agent reply **into that same thread** |
| Tool-call chips | `claw.runAndWait({ onProgress })` polls `getRun`; render status transitions as chips |
| Live presence | `storage.collection('presence')` heartbeat per viewer, `global` scope, polled |
| Multiplayer state | `global`-scope storage — every viewer reads and writes the same track |
| App store | the app itself ships via `spaces app publish` into the workspace Library |

The chat being a **real conversation** is the point: open Xyne next to the app and the same messages are there. The app isn't a silo — it's a lens.

### Resources used

All ten in the slim vendored bundle, no re-bundling needed:

`search` · `claw` · `conversations` · `messages` · `channels` · `users` · `tickets` · `projects` · `boards` · `activities` — plus the storage SDK.

---

## Screens

**1. Tracks** — list from `global` storage. Create: pick a channel (`channels.listAll`), name it; the app calls `conversations.create` and stores the returned `conversationId`.

**2. Track view** — three panes, modelled on the mock:

- *left*: the track's nodes, each with a `docType` badge and who pinned it
- *center*: the focused node, resolved live (`tickets.get`, `messages.get`, …) — acting on it posts a narrated line into the chat
- *right*: the unified chat — real messages, agent turns with tool chips, presence row, composer

**3. Discover** — `search.query` seeded from the track. Ranked candidates with their `docType` badge and score; one click pins a node. This is the "chain of connections", computed rather than declared.

---

## Plan

| Step | What ships | Status |
|---|---|---|
| 0 | SDK verified live — search returns 2021 grouped results, agents list | **done** |
| 1 | Data layer: track CRUD in storage, presence heartbeat, live entity resolution | |
| 2 | Track list + create (real conversation created on the channel) | |
| 3 | Track view: nodes + provenance badges + unified chat, polled | |
| 4 | Discover: search-driven connection proposals, one-click pin | |
| 5 | Agent: dispatch into the thread, tool chips from `onProgress` | |
| 6 | Presence row + focused-node center panel | |
| 7 | `spaces app publish` | |

---

## Constraints

- Sandbox caps each file at **64 KB** — the vendored SDK is already 32 KB, so keep components small and split early.
- Only `.tsx .ts .jsx .js .css .json` are uploaded; imports must be **relative**; source lives at the root.
- shadcn/ui, Tailwind and `cn()` are injected by the host — never pushed.
- Storage is **key-addressed only**: no queries over values. Encode anything you need to filter on into the key (`track:{id}`, `presence:{userId}`).
- `global` scope is genuinely shared and writable by any viewer — last write wins, so keep writes small and field-scoped.

## Risks

| Risk | Mitigation |
|---|---|
| Search relevance is noisy on short seeds | seed from title + context, show the score, let the human pin |
| No push — chat is polled | 3–5 s poll; acceptable at demo scale, and presence is approximate by nature |
| `global` storage has no locking | one document per track, small field-scoped writes |
| Agent slug availability varies | list at runtime via `claw.listAgents`, let the user choose |
