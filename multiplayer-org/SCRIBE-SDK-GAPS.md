# What `@xyne/spaces-sdk` cannot do for a calls app

Written while rebuilding **Xyne Scribe** against the SDK alone, and comparing it with the real
Xyne Spaces Recordings feature (`apps/dashboard/src/routes/RecordingsV2Screen`,
`RecordingDetailV2Screen`).

Every claim below was **reproduced live** against `spaces.xyne.juspay.net` through the dev proxy,
or observed in the running app. Where a number is a sample rather than a census, it says so.
Nothing here is inferred from reading types.

The reference for what is reachable is the backend's own allowlist,
`apps/backend/src/api/sdk/v1/mapper.ts` — **468 operations**, of which 25 are `calls.*`. An
operation that is not in that file cannot be called through the SDK, whatever else exists on the
server.

---

## The short version

| | |
|---|---|
| **Reachable, and better than expected** | listings with summaries and marked items attached; a real server-side call search; participants; summary templates; recurring series; join/leave/invite/cancel/mark-moment |
| **Not reachable at all** | the transcript · a single call by id · anything written about a call · label names · recording media · live capture |
| **Reachable but broken as documented** | `orderBy` and date filters on call search · `getRecording`'s parameter · `Call`'s declared shape |

Scribe ships **one** file that leaves the SDK — `lib/callsBeyondSdk.ts`, 2 routes, both reads.
Everything else in the app is `@xyne/spaces-sdk`. Delete that file and the app still compiles and
runs, with the transcript panel replaced by an explanation. That is the boundary this document is
about.

---

## §1 The transcript — the content of a call — has no operation

**This is the gap.** Everything else is a nuisance; this one decides whether a calls app is worth
opening.

The call row *tells you a transcript exists*:

```jsonc
// calls.listRecordings → one row
"transcript": "attachments/1bf83e5c-…-c930ffd06342_formatted.txt",
"metadata": { "transcriptEntryCount": 1, "detailedSummaryCanvasId": "…", "notesCanvasId": "…" }
```

That is a **storage path**, not a URL, and the SDK exposes nothing that reads a storage path.
`attachments.*` in the registry is upload-only (`upload`, `uploadDraft`) — there is no download.
Searching `mapper.ts` for `transcript` returns zero entries.

**What was tried, and what happened**

| attempt | result |
|---|---|
| `attachments.*` ops | upload only; no read operation exists |
| `search.query({ type: 'transcript' })` | returns `type: 'attachment'` hits — uploaded HTML files, not call speech |
| `search.query({ subApp: 'transcript' })` | returns canvas documents |
| `canvases.get(metadata.detailedSummaryCanvasId)` | **200, and `content: []`** — the canvas body is a Yjs document that is never materialised into the `content` column. The row's title confirms the link (`"Detailed Summary - …"`) and carries nothing else. |
| `canvases.get(metadata.notesCanvasId)` | `{}` |

**What the dashboard does instead** — two plain Express routes, neither of which was ever a Zero
catalog operation, which is why they never showed up as a gap in the SDK's own coverage check:

```
GET /api/calls/recordings/:externalId     → { transcript, aiSummary, citationSegments[],
                                              markedItems[], durationMs, hasRecording,
                                              labels[], linkedTicketId, notesCanvasId, … }
GET /api/calls/:externalId/download-transcript  → text/plain, "[MM:SS] Speaker: text" lines
```

Both authenticate with the same bearer token the SDK uses. Verified in the running app: the first
returns the full detail object for headless recordings; the second returns the transcript for
conversation calls, which the first 404s for. Scribe uses exactly these two, in
`lib/callsBeyondSdk.ts`, and marks everything they produce in the UI.

> **The ask.** `calls.getTranscript({ callId })`, or better
> `calls.getRecordingDetail({ externalId })` returning the shape above. The data, the permission
> checks and the route already exist — only the registry entry is missing.

### §1a `citationSegments` is the other half of the same gap

A summary is written with citation tokens in two forms, in the same workspace and sometimes the
same paragraph:

- `[clf-04:18]` — an offset. Self-describing; Scribe renders it as a control that seeks the
  transcript.
- `[clf-87]` — an index into `citationSegments`. **Meaningless without the transcript route**, so
  Scribe renders it as an inert marker rather than a button that lies.

Counted across the 21 summaries in `calls.listHistory({ limit: 25 })`: **135 offset tokens, 63
numeric**. So roughly a third of all citations in this workspace cannot be resolved by an SDK-only
app. The real dashboard resolves the numeric form via `citationSegments`, which arrives on the
detail route in §1 and nowhere else.

---

## §2 Search reaches the title and the attendees — never what was said

`search.query({ type: 'calls' })` is genuinely good (see the wins document) but its index is built
from call metadata, not speech.

**Reproduced.** A phrase that appears in exactly one call's `aiSummary` and in no title:

```
q=indigo bronze  type=calls  groupBy=''   →  0 results
```

The call whose summary contains it is in the index and returns fine for `q=visa`. So the summary
text is not indexed either — not just the transcript.

`hasTranscript` **is** exposed on every call hit's `searchContext`, which makes this doubly
awkward: the index knows which calls have a transcript and will not search inside any of them.

**Consequence for the app.** Scribe's "what did we decide about X" search is client-side, over the
summaries and marked items already in memory. That is the only implementation available, not a
shortcut — and at this workspace's size (84 calls, 257 extracted items) it is also the fast one.

> **The ask.** Index `aiSummary` at minimum. The `sam_transcript` schema name already exists in
> `SearchSchemaName`; whatever it indexes, it is not these.

---

## §3 There is no way to fetch a single call

The registry has **eleven ways to list calls** and no `calls.get(id)`:

```
listActive  listActiveInChannel  listScheduled  listHistory  listRecordings
listCreatedRecordings  listSharedRecordings  listParticipants  getRecording
getRecurringSeries  getConversation
```

`getRecording` looks like the missing one and is not:

- it takes the **`externalId`** (the realtime room id), while its parameter is named `callId` —
  the same name that means the row id on every other method of the same resource. Passing the row
  id returns `null` with no error.
- the Zero query behind it (`oatsRecordingByExternalId`) only answers for headless recordings.
  Reproduced: `{}` for a conversation call that plainly exists.

**Why this bites.** The track-scoped view is built on the search index (§ wins), and search hits
carry no `aiSummary` and no `markedItems`. With no way to fetch the call the index just named,
those two fields are unobtainable for it. Scribe works around this by reading all three
summary-bearing listings once at mount and keeping them as a corpus to join hits against — three
requests, paid once. It raises the hit rate a long way and cannot reach 100%: a call in a channel
you can see, that you were not on, has a summary the SDK will not return.

> **The ask.** `calls.get({ callId })`, keyed on the row id, returning the listing row shape.

---

## §4 The declared `Call` type is a subset of the row that arrives

`calls.listHistory` returns **39 fields**. `Call` in `types/index.d.ts` declares **20**. The
missing ones are not incidental — they are most of what a call *is*:

| field | what it is | in the SDK's type? |
|---|---|---|
| `aiSummary` | the whole post-call summary, markdown | ✗ |
| `markedItems` | decisions / actions / moments with offsets | ✗ |
| `transcript` | storage path (§1) | ✗ |
| `startedAt` `endedAt` | when the call actually ran | ✗ — only `startsAt`/`endsAt` are declared |
| `participantPreviewUserIds` | `[{userId, hasJoined}]`, **as a JSON string** | ✗ |
| `recordingParticipants` | same, for headless recordings | ✗ |
| `labels` `visibility` `callOrigin` `summaryTemplateId` `recordingUrl` `recordingEnabled` `xyneManaged` `orgName` `description` `timezone` `isRecurring` `recurrenceRule` `instanceDate` `lastActivityAt` `callUpdatesChannel` | | ✗ |

Two declared fields are *never populated*, which is worse than being absent because code written
to the type looks correct and renders nothing:

- **`organizerId` is null on every row observed** — 25/25 in history, 5/5 in recordings. The
  populated field is `createdByUserId`. The previous version of this surface read `organizerId`,
  so "organised by" never appeared once.
- **`CallParticipant.displayName` and `.email` are always null.** `listParticipants` returns
  `userId` and nothing else identifying. The previous version rendered
  `p.displayName || p.email || 'Unknown'` — every attendee on every call showed as **Unknown**.

**Consequence.** `spaces.calls.listHistory()` returns typed rows with the good fields stripped.
Scribe calls the same op through `rawOp` — same endpoint, same op name, same auth — purely so the
fields the server already sent survive the trip. See `lib/calls.ts`.

### §4a Label ids cannot be resolved

`labels` is an array of tag ids (22 of 24 recordings carry 1–4). Nothing in the registry maps a
tag id to a name: `conversations.listLabels` and `email.listLabels` are both channel-scoped
conversation labels, a different vocabulary. The dashboard uses `GET /api/tags/by-ids`, which is
not in `mapper.ts`. **Scribe therefore does not show labels at all** — an unresolvable id is not
worth screen space, and this is the one real-Spaces feature it drops rather than approximates.

---

## §5 Nothing about a call can be written

The mutators that exist are all about *taking part in* a call:

```
initiate  join  leave  reject  cancel  invite  requestToJoin  cancelJoinRequest
approveLobbyRequest  rejectLobbyRequest  markMoment  linkNotesCanvas
```

Every mutator that changes what a recording *is* — rename, delete, set visibility, share with
someone, regenerate the summary, regenerate labels, **link a ticket**, export — is a dashboard
REST route (`POST /api/calls/recordings/:id/sharing`, `…/generate-summary`, `…/generate-labels`,
`PATCH /api/calls/recordings/:id`). None is in `mapper.ts`, and `v1/exclusions.json` has no entry
for any of them — they were never catalog operations, so the SDK's coverage gate never saw them as
a gap to justify.

Notably `linkedTicketId` is **readable** on the detail route (§1) and not writable by any SDK op.

**Consequence, and it turned out fine.** Everything Scribe contributes goes into a ticket's own
conversation through the shell's `postUpdate` — the one write path an org app has. A thread entry
is durable, provenance-badged and readable by the agent, which a join-table row would not be. The
app is a *reader* of recordings and a *writer* of tickets, and says so.

### §5a `rawOp` could not reach any mutator (fixed here)

Not an SDK gap but worth recording, since it blocks two SDK ops that do exist. `lib/xyne.ts`
routed an op to `/mutate` only when its name ended in `.send`:

```ts
`${baseUrl}/api/sdk/v1/${op.endsWith('.send') ? 'mutate' : 'query'}`
```

`calls.markMoment` and `calls.linkNotesCanvas` are mutators whose names end in neither, so they
were unreachable through that path — posting a mutator to `/query` is a 400, by design. `rawOp`
now takes an explicit `kind`.

---

## §6 Recording media

`recordingUrl` is declared, and is **null on every row observed** — including rows with
`recordingEnabled: true` and `hasRecording: true`. There is no media operation in the registry.

The dashboard streams bytes from `GET /api/calls/:externalId/download-recording`. Two things make
that unusable here even setting the SDK boundary aside, and both are structural:

1. **It is an authenticated byte stream, never a URL.** An `<audio src>` cannot carry an
   `Authorization` header. Fetching it in JS means holding the whole file — 68 MB for a one-hour
   call — before the first second plays, because the route ignores `Range` requests and returns
   200 with the full body.
2. **Published, this app's fetches are tunnelled to the host over `postMessage`**, and that bridge
   resolves every response body as a string (`lib/xyne.ts`). Binary has no path home.

**What Scribe does instead.** It treats the **transcript as the playback surface** — it seeks (a
citation or a marked moment scrolls to that line and marks it), it filters by speaker, it searches
within, and any line can be quoted into a ticket, attributed and timestamped. Audio itself links
out to Spaces. Text is arguably the better surface for what people open a recording to do; it is
certainly the honest one here.

> **The ask.** A short-lived signed media URL. `hasRecording` already tells us it exists.

---

## §7 Live capture is out of scope, and should be said plainly

There is no operation that provisions a room or starts a recording. `calls.initiate` is explicit
that it records a call against a room *that already exists on the realtime server*, and the live
transcript in the dashboard is a WebRTC stream read from an in-memory client store, not from REST.

So an SDK-only app cannot start, record or live-transcribe a call. Scribe does not ship a Record
button, because a button that cannot work is worse than an absent one.

---

## §8 Smaller traps, all reproduced

**Call search ignores its own ordering and date filters.** `SearchOptions` accepts `orderBy`,
`before`, `after`, `on`, `range` and the server accepts them without complaint. On `type=calls`
none of them does anything:

```
type=calls limit=30 orderBy=newest      → unordered (neither ascending nor descending)
type=calls limit=30 after=2026-09-01    → identical 30 rows, oldest from 2025-12-30
```

Scribe sorts and narrows client-side. `in`, `q`, `withUser`, `callType`, `limit` and `offset` all
work; `limit=200` returns 200.

**`searchContext.metadata.timestamp` is documented as ISO 8601 and arrives as an epoch-milliseconds
string** for call hits. Parse both.

**Search echoes the query back wrapped in `<hi>` tags** — in `title`, in `participantNames`, in
`searchContext.title`. Nothing renders them; strip at the boundary.

**`channelId` is null on most recordings.** Sampled directly: 3 of 5 recordings had one, 2 did
not; across the fuller set the recon pass found 23 of 24 null. A headless recording is not
attached to a channel. Filtering a recordings list on `channelId` therefore matches nothing, which
is exactly what the previous version of this surface did — it showed `0/25` and the message "no
calls on this track" for a track with calls. The working primitive is
`search.query({ type: 'calls', in: channelId })`.

**`calls.listParticipants` returns `[]` for headless recordings.** They have no participant rows
at all; the people are in `recordingParticipants` on the call, as a JSON string.

**`calls.getConversation` returned `{}`** for a recording whose `metadata.conversationId` is set.

**`calls.listHistory` embeds a full `participants` array on each row**, while `listRecordings` does
not. Worth checking before spending a request per row.

---

## §9 One thing to look at

`calls.getRecording` → `oatsRecordingByExternalId` scopes by workspace and `externalId` only — no
participant, creator or share check — and returns the full `aiSummary` and the transcript's
storage path. Its sibling queries `createdOatsRecordings` and `sharedOatsRecordings` do encode
creator/share scoping. Flagging it as a question for whoever owns that query, not as a finding:
the surrounding routes may add the check the query does not.

---

## What this list is not

The SDK is not thin here. 25 call operations, a real search index, participants, summary
templates, recurring series and the full lobby flow are all reachable, and several of them return
*more* than the types admit. `SCRIBE-SDK-WINS.md` is the other half of this document, and it is
the longer one.
