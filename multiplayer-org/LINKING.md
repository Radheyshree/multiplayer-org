# How linking works

Worked examples from this workspace, using two real tickets:

- **XYNE-62896** — *debug panel optimizations*, on `#vespa-search`, board `search`.
  Has two GitHub PRs and a linked PR ticket.
- **XYNE-63024** — *Multiplayer demo*, created for this write-up on the same
  board, with data deliberately pulled in from four different systems.

---

## The short answer to "what happens when I link something?"

**A message is written into the ticket's own conversation.** That's it. There is
no separate link table of ours, no hidden app state, nothing that only this app
can read.

That sounds underwhelming until you notice what it buys:

- The link is **visible in Xyne itself**. Open XYNE-63024 in the Xyne dashboard
  and the linked call and PR are right there in the thread.
- It **outlives this app**. If this app is deleted tomorrow, the links remain.
- The **agent reads it**. Anything an agent is asked about the ticket, it sees
  the links, because they are in the conversation it reads.
- It is **ordered**. A link is a thing that happened at a time, next to the
  message that explains why.

The line carries a marker so the surface can attribute it:

```
[app:github|note] Linked **[juspay/xyne-spaces] fix: XYNE-62896 …(PR #1624)** — https://github.com/juspay/xyne-spaces/pull/1624
```

`[app:github|note]` is stripped before display and becomes the **via GitHub ↗**
badge plus the `github` chip. The marker rides in the body rather than in
`metadata` because the server hardcodes `messages.metadata` to `null` on write —
we can *read* everyone else's metadata, but not write our own.

> **Not the same thing:** `Linked to this ticket` in the Related tab shows
> `ticket_references` — real edges Xyne stores, written by people and by the
> SDLC integration. Those are covered in mechanism 2 below. Our links are
> messages; those are rows.

---

## The four ways data reaches a ticket

### 1. Webhooks from a code host → activity in the thread

A PR opened against a ticket produces a `SYSTEM` message whose metadata carries
the whole event. Real row from **XYNE-62896**:

```json
{
  "msgType": "SYSTEM",
  "content": "PR #1624 raised, TODO → IN_REVIEW, author: Pradeesh333",
  "metadata": {
    "prId": 1624,
    "prUrl": "https://github.com/juspay/xyne-spaces/pull/1624",
    "prEvent": "CREATED",
    "prWebhook": true,
    "activityType": "PR",
    "isTicketActivity": true
  }
}
```

`prUrl` is what makes the badge clickable — the only origin in the whole system
that hands us a link back out.

**We do not create these.** They arrive because the repo has a Xyne webhook.

### 2. Xyne's own ticket references → the "Linked" section

When a PR is opened, Xyne creates a **second ticket for the PR itself** and links
it back. On XYNE-62896:

```
XYNE-62897  "[juspay/xyne-spaces] fix: XYNE-62896 debug panel optimizations (PR #1624)"
            ticketType: DESK     relation: DUPLICATE_POSSIBLE (direction: in)
```

So "the PR" is a first-class object you can navigate to, and the Related tab
shows it above the search results with an **Open PR ↗** button.

Read via `getDetails(ticketId)` → `referencesIn` / `referencesOut`.

> **SDK asymmetry:** you can `tickets.addReference` / `updateReference` /
> `removeReference`, but there is **no list method** — references only come back
> joined onto `getDetails`.

### 3. Search → the "Possibly related" section

`search.query` groups results by `docType`, and the group value *is* the badge.
For XYNE-62896 the seed and result:

```
matching "XYNE-62896 optimizations debug panel" · 32 in the workspace

TICKET 9
  Gate the Xyne AI debug panel behind capability/…   0.86   XYNE-55038
  fix: Thread panel text pixelated when viewing im…  0.75   XYNE-13763
  Implement auto-scroll for Workflow Panel           0.72   XYNE-5289
```

The seed is built by dropping stopwords and words under four characters and
keeping the rare vocabulary, with the ticket key first. Searching the raw title
returns everything containing "fix" or "used"; searching the rare words returns
the four other MoneyFramework tickets.

The seed is **shown on screen** so a surprising result is explicable.

Clicking **Link** on one of these promotes it from a guess to a record —
mechanism 4.

### 4. Our surfaces → a message in the thread

Every app in the shell writes what it did:

| Surface | Writes | Badge it produces |
|---|---|---|
| Tickets Board | moves, edits, assignments, new tickets | via Xyne |
| Xyne Desk | replies to a support ticket | via Email |
| Xyne Scribe | a call, with room link and attendees | via Call ↗ |
| GitHub & Bitbucket | a repo, PR or commit | via GitHub ↗ |
| Related tab | a search hit you chose to keep | via Xyne |

All of it through one call — the app names the **ticket**, never a conversation,
and the shell resolves the target from the ticket's own row:

```ts
postUpdate(workItem, 'Linked call: **Design sync** — https://…', 'note')
```

---

## Worked example: XYNE-63024

Four systems, one thread. What the ledger renders, top to bottom:

```
You  Xyne     ◇ via Xyne      17m   Ticket created in search: Multiplayer demo…
                                    Kicking this off. Pulling in what already exists…
You  Xyne     ⑂ via GitHub ↗  github       17m   Linked [juspay/xyne-spaces] fix: … (PR #1624)
You  Xyne     ◉ via Call ↗    xyne-scribe  17m   Linked call: Reviewing final Visa portfolio…
You  Xyne     ◇ via Xyne      kanban-board 17m   Linked ticket: Update workflow chat panel…
                                                 Linked ticket: Highlight failed steps…
                                                 Linked ticket: debug panel optimizations
You  Xyne     ◇ via Xyne  Question  16m   @Ask AI what is the current state of this ticket?
AA   Ask AI   ◆ via App             15m   Here's the current picture: …
```

Two details worth pointing at:

**Consecutive rows only group when the source is the same.** Rows 4–6 are three
ticket links from the same app in the same minute, so they share one header.
Rows 2, 3 and 4 do not group despite being the same sender in the same minute,
because their sources differ — and the badge is the entire point.

**The agent's answer is a message.** It survives reload, everyone on the ticket
sees it, and it is in the record the next agent reads.

---

## About your PR comment

You commented at `pull/1624/changes#r3963340329` and it does not appear. That is
correct behaviour, for two independent reasons. Xyne's GitHub webhook router
handles exactly two event types:

```ts
if (eventType === 'pull_request')  return this.handlePullRequestEvent(…)
if (eventType === 'issue_comment') return this.handleIssueCommentEvent(…)
logger.info(`Event ${eventType} acknowledged but not processed`)
```
*(`apps/backend/src/services/githubWebhookService.ts:137-152`)*

1. A review comment on a diff is **`pull_request_review_comment`**, which is not
   in that router at all — it falls through to "acknowledged but not processed".
2. Even a plain PR comment (`issue_comment`) is only acted on if it **mentions
   Xyne**:

```ts
const isXyneMentioned = mentions.some(m =>
  m.toLowerCase() === XYNE_MENTION_EMAIL || m.toLowerCase() === XYNE_MENTION_USERNAME)
// XYNE_MENTION_USERNAME = 'xynespaces'
```

**Bitbucket is different** — it has `pr:comment:added` and a real
`handleCommentEvent`. So PR comments flow from Bitbucket and not from GitHub.

### What you can do about it

| Option | Effort | Result |
|---|---|---|
| Comment `@xynespaces …` on the PR | none | that one comment reaches Xyne |
| Add `pull_request_review_comment` to the webhook's event list, and a branch in the router | small backend change | all review comments flow, like Bitbucket |
| Read comments from the GitHub API in the Code surface | app-side only | comments visible in the shell, not in the ticket's record |

The middle one is the right fix and it is a handful of lines next to code that
already does it for Bitbucket.

---

## What else the SDK can give us

Verified against the typings and, where noted, against live data.

**Reachable and not yet used**

| Capability | Call | What it would add |
|---|---|---|
| Scope search to a channel | `search.query({ in: channelId })` | "related, but only on this track" |
| Search by person | `search.query({ from, mentions })` | "everything Priya touched on this work" |
| Time-boxed search | `search.query({ after, before, range })` | "what changed since the PR opened" |
| Real cross-ticket links | `tickets.addReference(...)` | promote a search hit to an edge Xyne itself shows |
| Ticket attachments | `messages.getAttachments`, `listChannelAttachments` | files on the ticket, badged like everything else |
| Sub-tickets | `tickets.listSubTickets` / `createSubTicket` | breakdown inside the unified view |
| RCA | `tickets.getRca` | incident detail, when populated |
| Stage approvals | `tickets.listStageRequests` | already read for moves; could be shown |
| Server-side automation | `automations.createProposal` → `submitForApproval` → `approve` → `activate` | autonomy that runs without a browser open |
| Presence-ish | `users.listBasic` → `lastActiveAt`, `statusContent` | "Priya is looking at this" from real data |
| Slack identity | `user.metadata.slackId` | link a person to their Slack account |

**Reachable but with a catch**

- `search.query({ ticketId })` is accepted but only constrains the *ticket*
  index — the other buckets come back unfiltered. Not a cross-type scope.
- `automations.createProposal` types `configJson` as `unknown` and passes it
  through, but the server requires a JSON **string**. Stringify or it 400s.
- There is **no CRON trigger** implemented, so no recurring automation.

**Not reachable at all**

- **Agent Awakening.** Real, fully built, and invisible to us: the string
  "awakening" appears zero times in `apps/backend/src` — the only service the
  SDK talks to — and zero times in the SDK dist. We cannot enable it, and cannot
  read whether it is on.
- **Live agent streaming.** Xyne streams `snapshot | delta | reasoning |
  invocation | label | done` over SSE, but it is dashboard-internal. We poll
  `claw.getRun`, which returns the whole `AgentRun` row including
  `toolInvocations` — far more than its four-field type admits.
- **`workflow.external_messages`**, the authoritative provenance join. Different
  Postgres schema, no SDK surface.
- **Deep links back out** to a Slack message or Zoho ticket. The index stores
  the origin in a field the result transformer drops.

---

## Reading the code

| File | What it does |
|---|---|
| `lib/provenance.ts` | resolves a message to its source; the vocabulary and why each badge is allowed |
| `lib/related.ts` | the seed builder, the search read, and `linksFrom()` for real references |
| `lib/agentrun.ts` | dispatch and poll, and the note on what `getRun` really returns |
| `lib/mentions.ts` | the mention span format and why we write the real one |
| `lib/watcher.ts` | the autonomy gate, and the full argument for why Awakening is out of reach |
| `components/ledger/MessageRow.tsx` | the row, and the grouping rule that keeps badges visible |
