# How `@xyne/spaces-sdk` earned its place

The companion to `SCRIBE-SDK-GAPS.md`. That document lists what the SDK could not do for **Xyne
Scribe**; this one is the larger half — what it did, and what the app got to be *because* of it.

The honest summary up front: **Scribe is a better calls app than it would have been with direct
backend access**, and not by accident. Three of its best features exist only because the SDK put
things next to each other that the product keeps apart.

---

## 1. The listings hand over the whole call, not a row

The single most valuable thing the SDK does here is over-deliver. `calls.listHistory`,
`listRecordings` and `listSharedRecordings` return the *post-call summary* and the *extracted
decisions and action items* attached to every row:

```jsonc
{
  "title": "Improving Xyne Spaces search speed with entities, query expansion…",
  "aiSummary": "## Summary:\n…\n## Key outcomes:\n1. …[clf-01:22][clf-03:55]\n## Action Items:\n…",
  "markedItems": [ { "type": "decision", "text": "…", "timestampSeconds": 0 }, … ],
  "startedAt": 1787565112910, "endedAt": 1787565123561,
  "participantPreviewUserIds": "[{\"userId\":\"…\",\"hasJoined\":true}]"
}
```

**What that bought.** The entire **Decisions ledger** — every decision and commitment the org made,
across every call, searchable in one list — costs **zero extra requests**. It is a `useMemo` over
rows that were already fetched to draw the sidebar. In this workspace that is **257 items across 84
calls** (27 decisions, 230 action items), available instantly.

The expensive version of that feature — open each recording, read its summary, remember what it
said — is what the real dashboard makes you do, because its detail screen is one call at a time.
The SDK's listing shape is what made the cheap version possible.

> Caveat carried into the code, not hidden: these fields are absent from the declared `Call` type,
> so the app calls the same ops through `rawOp` to stop the wrapper discarding them
> (`SCRIBE-SDK-GAPS.md §4`).

---

## 2. `search.query({ type: 'calls' })` is a better call index than the calls resource

None of the eleven listing operations takes a channel. The search resource does, and it turned the
app's headline feature from broken to real.

```ts
spaces.search.query({ type: 'calls', in: scope.channelId, groupBy: '', limit: 120 })
```

Server-side, across the whole workspace, and every hit arrives with:

```jsonc
"searchContext": {
  "callId": "…", "externalId": "…", "channelTitle": "xyne-spaces-sdlc",
  "participantNames": ["…", "…"], "participantEmails": ["…"],
  "userIds": ["…"], "hasTranscript": true, "startedAt": 1788781235005,
  "callType": "AUDIO", "status": "ENDED", "roomLink": "…"
}
```

Three wins in one call:

1. **Track scoping that works.** The previous version filtered a 25-row personal listing on
   `channelId` and reported "no calls on this track". The index answers the actual question: on the
   `#euler` track it returns the one call that track has had; on `#xyne-spaces-sdlc`, 38.
2. **Attendee names, already resolved.** `calls.listParticipants` returns `displayName: null` on
   every row. Search returns the names. Two ways to ask about the same people, and the one in a
   different resource is the one that answers.
3. **`hasTranscript`** — the only place in the SDK that says whether a call has anything to read.
   It is what the `✦` in Scribe's list means, and it is the difference between a row and an hour of
   content.

Plus free-text search over titles and attendees, `withUser`, `callType` and `offset` paging, none
of which the calls resource offers. (`orderBy` and the date filters do nothing on calls —
`SCRIBE-SDK-GAPS.md §8`.)

**The general lesson:** the SDK is a flat namespace over resources the product keeps in separate
screens. Looking for a calls feature in the *search* resource is not an obvious move in the
dashboard's world, and it is the obvious move here.

---

## 3. One client, so a calls app can also be a tickets app

This is where the SDK stops being a convenience and becomes the reason the app is interesting.

`spaces.calls`, `spaces.search`, `spaces.tickets`, `spaces.users` and `spaces.messages` are on the
**same client, with the same auth, in the same file**. The dashboard has a Recordings screen and a
Tickets screen and no code path between them. Scribe has one import list — and so it can do things
the product cannot:

| Scribe does | because | the dashboard cannot |
|---|---|---|
| Turn an action item from a call into a **real ticket on the track** | `calls.list*` → `markedItems` + `tickets.create({ projectId, channelId })` | its recording screen has no project, no board, no ticket |
| Write a **decision into the ticket's ledger**, timestamped and attributed | `markedItems` + `messages.send` via the shell | decisions stay on a screen nobody reopens |
| **Quote a line of the call** into the ticket it is about | transcript + `messages.send` | no ticket in scope |
| Show **every call on this track** | `search.query({ type:'calls', in })` | it has no track concept at all — the Recordings screen is a flat personal list |
| Search **"what did we decide about X"** across all calls at once | `markedItems` + `aiSummary`, already in memory | one recording at a time |

The ticket-creation flow is the clearest case. `tickets.create` returns the new ticket's
`conversationId` as part of creation — so the app can create the ticket, post the call it came from
into its thread as the reason it exists, and focus it, **with no follow-up read**. Three moves, one
round trip's worth of latency, because the SDK returns the id the next call needs.

---

## 4. The op gateway is uniform enough to escape from

`/api/sdk/v1/query` and `/api/sdk/v1/mutate` take `{ op, args }` and nothing else. That uniformity
is what makes `rawOp` a *three-line helper* rather than a fork of the SDK:

```ts
export async function rawOp<T>(op: string, args = {}, kind: 'query' | 'mutate' = …) {
  const res = await fetch(`${baseUrl}/api/sdk/v1/${kind}`, { method: 'POST', body: JSON.stringify({ op, args }) })
  …
}
```

Same endpoint, same op names, same auth, same error envelope as the typed wrappers. When a wrapper
throws away fields the server sent (§4 of the gaps), the escape hatch is one function and the op
name stays identical — so the typed method is still what *documents* the call, and the code says
which one it is using and why.

An SDK you can step around without leaving is a much better SDK than one you either accept whole or
abandon.

---

## 5. The types are the documentation, including where they are wrong

`@xyne/spaces-sdk` ships ~13,400 lines of `.d.ts` with prose comments that are unusually candid.
Several of them saved real time:

- `CallCursor` is `{ id, startedAt }` — which is also the tell that `startedAt`, undeclared on
  `Call`, is the field the server orders by.
- `SearchResult.type` carries a note that it is a *different vocabulary* from `SearchOptions.type`
  and that feeding one back into the other fails validation. That is exactly the mistake to make.
- `SearchOptions.sortBy` / `sortOrder` are typed `never` and marked "never worked".
- `calls.initiate`'s doc says outright that it records a call against a room that already exists
  and "passing invented values yields a call nobody can join" — which is how we knew, before
  writing anything, that a Record button was not on the table.

Where a type was wrong, it was wrong in a *readable* way. Discovering that `Call` omits `aiSummary`
took one diff of declared fields against a live response; discovering that `organizerId` is never
populated took one live call. Both are now documented in the gaps file with the numbers.

---

## 6. `users.listBasic` in one request

Not calls-specific, but Scribe leans on it hard. The whole 4,358-person directory arrives in a
single response, with display names and avatars. Every face in the call list, every speaker name,
every "called by" is a local map lookup afterwards.

This is what makes the participant fix cheap: `listParticipants` gives ids and nothing else, and
turning ids into people is free because the directory is already there.

(The SDK's own `paginate()` windows that response to 100 rows and discards the rest, so the
directory is read through `rawOp` too — same op, same transfer, none of it thrown away. Noted in
`lib/people.ts`.)

---

## 7. What shipped, and what each thing rests on

| Feature | Built on |
|---|---|
| Track-scoped call list, server-side | `search.query({ type:'calls', in })` |
| Free-text call search | `search.query({ q })` |
| Day-grouped list with faces and durations | `calls.list*` + `participantPreviewUserIds` + `users.listBasic` |
| Structured summary with citation chips | `aiSummary` on the listing row |
| Citation → jumps the transcript to that moment | `aiSummary` offsets + the transcript layer |
| Decisions / actions / moments timeline | `markedItems` on the listing row |
| **Action item → real ticket on the track** | `markedItems` + `tickets.create` |
| **Decision → the ticket's ledger** | `markedItems` + shell `postUpdate` |
| **Quote a spoken line into a ticket** | transcript + shell `postUpdate` |
| **Decisions ledger across all calls** | `aiSummary` + `markedItems`, zero extra requests |
| Participants with real names and time-in-call | `calls.listParticipants` + `users.listBasic` |
| Live / Upcoming / Past / Recordings / Shared | `calls.listActive` / `listScheduled` / `listHistory` / `listRecordings` / `listSharedRecordings` |
| Transcript reader: seek, speaker filter, find-in-call | **not the SDK** — `lib/callsBeyondSdk.ts`, marked in the UI |

Thirteen of fourteen are `@xyne/spaces-sdk`.

---

## 8. Call actions the SDK supports that Scribe deliberately does not fire

Worth stating explicitly, because "not built" and "not possible" are different claims and only one
of them belongs in the gaps document.

These **are** reachable and were verified present in the registry:

```
calls.join   calls.leave   calls.reject   calls.cancel   calls.invite
calls.markMoment   calls.linkNotesCanvas   calls.requestToJoin
calls.cancelJoinRequest   calls.approveLobbyRequest   calls.rejectLobbyRequest
```

Scribe does not call any of them, and the reason is the same for all: **each one has an effect on
other people in a live workspace.** `join` marks you present and can ring participants; `cancel`
cancels a real meeting for everyone invited; `invite` rings people. This app is a reading surface
over calls that already happened, and its only write is into a ticket's own thread — a place where
a mistake is a message someone can read and correct, not a meeting that vanished from a calendar.

The Live and Upcoming tabs therefore link out to the room rather than calling `calls.join`. The
link is what actually puts you in the call; the op only records that you did.

`calls.markMoment` is the one worth revisiting — flagging a moment during a live call is exactly
what this app is about, and it is unreachable from a surface that only reads past calls. It would
belong in a live-call view, which needs the realtime layer the SDK does not reach
(`SCRIBE-SDK-GAPS.md §7`). Note that it was *doubly* unreachable until this pass: `rawOp` routed
every op without a `.send` suffix to `/query`, so no mutator could be called at all
(`SCRIBE-SDK-GAPS.md §5a`).

---

## 9. What we would ask for, ranked

1. **`calls.getTranscript` / `calls.getRecordingDetail`** — the one gap that changes what the app
   *is*. The route, the data and the permission checks already exist.
2. **`calls.get({ callId })`** — eleven ways to list a call, none to fetch one.
3. **Index `aiSummary` for search** — the index already reports `hasTranscript` for calls it will
   not search inside.
4. **Fix `Call`'s declared shape** — the server is already sending these fields; the type is the
   only thing standing between an app and them.
5. **Make `orderBy` work on `type=calls`**, or document that it does not.
6. **A tag-name lookup** — `labels` is unusable as ids, and it is the one real-Spaces feature
   Scribe dropped rather than approximated.

---

## 10. The one-line version

The SDK's weakness is *depth on a single call*; its strength is *breadth across the org*. A calls
app built on it will be worse than the dashboard at playing back one recording, and better than the
dashboard at everything that involves a call and something else — which, for an org, is most of
what a call was for.
