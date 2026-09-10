# The SDK in multiplayer-org — what it gave, where it stopped

The whole app runs on `@xyne/spaces-sdk` + `@xyne/storage-sdk` against the live Spaces backend.
This is the short version; the detailed evidence lives in
[SDK-GAPS.md](SDK-GAPS.md), [SCRIBE-SDK-WINS.md](SCRIBE-SDK-WINS.md),
[SCRIBE-SDK-GAPS.md](SCRIBE-SDK-GAPS.md) and [SDK.md](SDK.md).

---

## How the SDK was useful

Every surface in the shell is SDK data end to end:

| Surface | Built on | What it enabled |
|---|---|---|
| Tickets / Ledger | `tickets.*` (20+ ops), `boards.listStages/listTransitions` | Full ticket CRUD, kanban, stage moves, sub-tickets, references, activities |
| Chat | `messages.listByConversation/send`, `conversations.listByChannel`, `channels.*` | Real channels and threads, posting as the signed-in user |
| Desk | `email.listForConversations`, `tickets.listEmails` | Real external mail mirrored onto tracks |
| Scribe | `calls.list*` ×6, `search.query({type:'calls'})`, `calls.listParticipants` | Every call with summary + decisions attached; track-scoped call lists |
| Board | `boards.*`, `tickets.listKanban` | Multi-board tracks over live stages |
| Studio | `claw.listAgents/run/getRun` + **storage-sdk** collections | An AI app-builder: agents write files, projects and versions persist server-side with zero backend of ours |
| Update Agent | `claw.run/getRun` | Durable agent turns on real workspace data |
| Directory | `users.listBasic/getProfiles/me` | 4,358 people — every avatar and name in the app — from one request |
| Store | `admin.listOrgApps/listMarketplaceApps/listInstalledApps` | What the workspace actually runs, listed live |

Cross-cutting wins that shaped the app:

- **One client, one auth.** Calls + tickets + search + messages on the same import is why a
  call's action item can become a ticket, a spoken line can be quoted into a thread, and a
  decision ledger can span every surface — things the dashboard can't do across its screens.
- **A uniform gateway.** Every read is `POST /api/sdk/v1/query {op,args}`. That made `rawOp`
  a three-line escape hatch, not a fork: same op names, same auth, same errors as the wrappers.
- **Listings over-deliver.** `calls.list*` attaches the AI summary and extracted decisions to
  every row — the workspace-wide Decisions ledger (257 items / 84 calls) costs zero extra requests.
- **The search index beats its own resource.** `search.query` is the only channel-scoped call
  list, the only resolved attendee names, the only `hasTranscript` flag.
- **Writes return what the next call needs.** `tickets.create` hands back the conversation id,
  so create → post provenance → focus is one round trip.
- **Candid types.** The shipped `.d.ts` admits what never worked (`sortBy: never`), which saved
  real time even where the types were wrong.

---

## Limitations

| Limitation | Consequence | What the app does |
|---|---|---|
| No transcript or recording-detail op (0 of 468) | An SDK-only app knows a transcript exists and can never show it | `lib/callsBeyondSdk.ts` — the one non-SDK file, marked in the UI |
| Declared types discard server fields (`Call` declares 20 of 39; `listBasic` windows 4,358 → 100) | Summaries, decisions, timestamps, the directory — all silently dropped by wrappers | `rawOp` reads the same response whole |
| No `calls.get(id)` — eleven listings, no fetch-one | Detail views must pre-read whole listings and join | 3-listing corpus read once at mount |
| Search never reaches speech or summaries; `orderBy`/date filters are no-ops on calls | "What did we decide about X" is unanswerable server-side | Client-side search over fields already in memory |
| No artifact-app ops — publish/list/fetch the Library is REST-only (`/claw/api/v1/artifact-apps`, cookie auth) | Studio's deploy and the store's "Built in this workspace" work only in the published shell, never on a dev server | Honest gates (`canDeploy`) instead of broken buttons |
| `admin.list*Apps` is a false friend | It reads the bot/integration registry, a different database — a published Studio app never appears there | Documented in SDK-GAPS §4f; REST used instead |
| No realtime over the SDK | Live progress = polling | Studio polls `claw.getRun`; honest progress UI |
| Media is an authenticated byte stream — no URL, no Range | No audio playback in-app | The transcript is the playback surface; audio links out |
| No writes about a call (`linkedTicketId` read-only; mark/link ops dashboard-only) | Can't attach a call to a ticket the platform's way | Provenance posted into the ticket's own thread |
| Labels arrive as unresolvable tag ids | The one dashboard feature dropped rather than faked | — |
| Published sandbox: 64 KB per file, postMessage bridge stringifies bodies | Binary has no path home; big files can't ship | Split files; transcript-not-audio |
| Entity link graph and thread participants unreachable | Some relations can't be read at all | Derived client-side where possible |

---

## Verdict

The SDK's weakness is **depth on a single record** — one call, one recording, one published app.
Its strength is **breadth across the org** — every resource behind one client with one auth. An
app built on it loses to the dashboard at replaying one recording, and beats the dashboard at
everything that connects a thing to another thing — which is most of what a workspace is.
