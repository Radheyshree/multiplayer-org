# Linking, and what "another surface" actually means

Two corrections to the first draft of this document are marked **CORRECTION**
below. Both were wrong in the same direction — they understated what is already
reachable — and both were settled by reading live rows rather than types.

---

## The thing this app is for

Xyne Spaces already *receives* work from outside itself. The adapter registry in
`apps/backend/src/integrations/adapters` is:

```
zoho   google   microsoft   slack-desk   slack-webhook-tickets   ozonetel   social-media
```

Zoho Desk, Gmail, Outlook, Slack, telephony, app stores. Plus Bitbucket and
GitHub webhooks, which come in by a different door.

What Xyne does **not** do is keep the origin visible. By the time a Zoho case
reaches a thread it is a Xyne message written by a pseudo-user called "Zoho
Test", and the fact that a person at a different company typed it in a different
product is nowhere on the screen. There is no way back to it either.

So the difference between this app and Xyne Spaces is not that it shows more
tickets. It is that **every line says which product it came from, names the
company the writer works for, and opens that product in one click.**

Live, on `XYNE-63024`:

```
ACROSS SURFACES   ⑂ Bitbucket 6 ↗   ✉ Zoho Desk 2 ↗   ⑂ GitHub 1 ↗   ☎ Call 1 ↗   ◇ Xyne 9
```

Four products that are not Xyne, on one ticket, each chip a link out. The icons
are real ones rather than text marks, because a badge on every row is something
people scan rather than read.

And on `XYNE-1371`, an ordinary support ticket that nobody prepared:

```
ACROSS SURFACES   ✉ Zoho Desk 1 payu.in ↗
outside this org  no_reply@payu.in
```

---

## What the row actually carries

Verified by scanning 293 messages across 86 live conversations, not read off a
type definition. `message.metadata` is typed `unknown` in the SDK and is
**populated on read** — it is only forced to `null` on write.

| Field | Real value from this workspace |
|---|---|
| `webUrl` | `https://desk.zoho.com/support/juspay4/ShowHomePage.do#Cases/dv/458844000296724111` |
| `ticketNumber` | `784736` |
| `prUrl` | `https://bitbucket.juspay.net/projects/XYNE/repos/xyne-spaces/pull-requests/3485` |
| `externalAuthor` | `{ name: '"PG Support"', email: 'pgsupport@billdesk.com' }` |
| `externalSource` | `c2b90ef1-235a-48ce-867c-0af1f40bd2cc` |
| `canvasUrl`, `linkPreview.url` | Xyne canvases; unfurled external URLs |

And on the `Email` rows, via `email.listForConversations`:

| Field | Real value |
|---|---|
| `from` / `to` / `cc` | `vamshi.devalapelly-v@adityabirlacapital.com` → `support@juspay.in`, +2 |
| `externalThreadId` | `458844000296724694` — the provider's own id |

> **CORRECTION 1.** The first draft said: *"Deep links back out to a Slack
> message or Zoho ticket. The index stores the origin in a field the result
> transformer drops."*
>
> That is true of **search** and false of **messages**. `transformMail` and
> `transformMessage` (`vespaSearch/resultTransform.ts`) do return ids and no
> permalink — but `transformFile` passes `originalUrl` and `transformCall`
> passes `roomLink`, and more importantly the Zoho case URL is sitting on the
> *message* as `metadata.webUrl`. It needs no SDK change and no backend change.
> We simply were not reading it.

### `externalSource` is a row id, not a name

It looks like it should name the adapter. It does not — it is the primary key of
an `ExternalSource` row, and there is no SDK route that resolves it. An earlier
version of `provenance.ts` title-cased its first segment, which would have put
**"via C2b90ef1"** on screen.

So the system is named from evidence that is actually on the row, in this order:

1. **`webUrl`** → the origin's own host → *Zoho Desk*
2. **slack markers** (`source: 'slack'`, `slackChannelId`) → *Slack*
3. **`Email.externalThreadId` shape** → the three mail adapters mint visibly
   different ids: Zoho is 15–20 digits, Outlook starts `AAMk`, Gmail is hex
4. otherwise → **"via Email"**, which is all we can honestly claim

---

## The six ways data reaches a ticket

### 1. An adapter ingests it — Zoho, Gmail, Outlook, Slack, Ozonetel

The pipeline creates a Xyne message and stamps `externalSource`,
`externalAuthor` and (for Zoho) `webUrl` + `ticketNumber` on it. Long mails are
split into chunks, each carrying the same stamp.

This is where the outside companies come from. On `XYNE-1414`, three
organisations in one thread:

```
vamshi.devalapelly-v@adityabirlacapital.com  →  support@juspay.in
support@juspay.in                            →  vamshi.devalapelly-v@…
pgsupport@billdesk.com                       →  support@juspay.in
```

We badge each with its system and mark the ones who do not work here.

### 2. A code host fires a webhook — Bitbucket, GitHub

A `SYSTEM` message whose metadata carries the event:

```json
{ "prId": 9604, "prUrl": "https://bitbucket.juspay.net/…/pull-requests/9604",
  "prEvent": "CREATED", "prWebhook": true, "activityType": "PR", "isTicketActivity": true }
```

`prUrl` is what makes the chip clickable. We do not create these.

### 3. Xyne's own ticket references

A PR opened against a ticket makes Xyne create a **second ticket for the PR**
and link it back. On `XYNE-62896`:

```
XYNE-62897  "[juspay/xyne-spaces] fix: XYNE-62896 debug panel optimizations (PR #1624)"
            ticketType: DESK     relation: DUPLICATE_POSSIBLE (direction: in)
```

Read via `getDetails(ticketId)` → `referencesIn` / `referencesOut`. There is no
list method; references only come back joined onto `getDetails`.

### 4. Search proposes — the Related tab

`search.query` groups by `docType`, and the group value *is* the badge. Mail hits
carry `senderEmail`, which is enough to mark the counterparty before you click.

### 5. A mail bridge — a notification ticket joined to the work ticket

Bitbucket emails you when something happens on a pull request. On a Desk channel
that mail becomes a ticket of its own, and the work the PR is *for* has a
different ticket on a different board. Two tickets, same work, nothing joining
them. Real pair from this workspace:

```
XYNE-63043  "XYNE/xyne-spaces - Pull request #9604: feat: XYNE-63024 …"
            from  Juspay Bitbucket <bitbucket-no-reply@juspay.email>
            body  …/projects/XYNE/repos/xyne-spaces/pull-requests/9604
XYNE-63024  "Multiplayer demo — one surface for cross-surface work"
```

**Everything needed to join them is already in the mail.** The subject names the
repository and the PR number, the PR title contains the work ticket's key, and
the body carries the PR's URL. So the link is *read off the row* rather than
declared by a person — `lib/mailbridge.ts`.

Once linked, mail flows on its own: every message on that desk thread is mirrored
into the work ticket's conversation, badged **via Bitbucket ↗**, exactly once.
Replies you send from anywhere come back the same way.

Three things that turned out to matter:

- **`search.query` cannot find it.** A desk created minutes ago is not in the
  index, and new mail is the entire point. Searching for the exact key returned
  eight unrelated bounce notifications and not the mail whose subject contains
  it. So the bridge scans desk channels directly — `channels.listAll()` filtered
  to `type === 'EMAIL'`, because `channels.listEmail()` returns 209 read-state
  rows of which 198 are not desks. The scan is 19s cold, so it never blocks:
  results are cached in global storage and a linked ticket does not need it at
  all.
- **Idempotency needs a key on the line.** Each mirrored entry carries the
  email's provider id in its marker (`mail:1a084adf0b1a066c`), so re-syncing is
  an exact-match question. The bridge line carries the desk's conversation and
  channel ids, which makes a linked thread self-describing: sync runs from the
  ticket's own messages, with no index and no cache.
- **`CVE-2024` looks exactly like a ticket key** and appears three times in the
  body of the very mail this was built for, inside Bitbucket's own "JIRA Ticket
  Usage" block.

### Replying from the ticket

`POST /api/email/:conversationId/reply` — the endpoint the Desk UI uses. Not on
the SDK (`email.d.ts`: "Sending mail is not exposed here"), but an ordinary
`/api/` path, so the app's fetch tunnel carries it and the host performs it as
the signed-in viewer. Verified: an empty body returns
`400 Body or at least one attachment is required` — validation, not auth.

It does **not** compute recipients. `type: REPLY_ALL` only decides how the
original is quoted; without a `to` array it answers `400 Recipients required`.
So `replyRecipients()` does that work: the newest inbound message's sender plus
everyone it was addressed to, minus us — and minus bounce daemons, which is not
theoretical. The first real reply went to `bitbucket-no-reply@juspay.email`,
bounced, and `mailer-daemon@googlemail.com` became the newest inbound mail on the
thread. Without that filter the next reply would have been addressed to the
server reporting that the last one failed.

The reply box names its recipients before you send, and says so when the only
one is a no-reply address.

### 6. Our surfaces record — a message in the thread

**Linking writes a message into the ticket's own conversation.** No separate
link table, no hidden app state.

```
[app:xyne-desk|note] Linked email: **Payment debited but showing pending.**
  — from vamshi.devalapelly-v@adityabirlacapital.com (adityabirlacapital.com)
  · https://desk.zoho.com/support/juspay4/ShowHomePage.do#Cases/dv/458844000296724694
```

The marker rides in the body because the server hardcodes `messages.metadata` to
`null` on write. It is written as an **HTML comment** —
`<!--app:xyne-desk|note|mail:1a084adf0b1a066c-->` — so every renderer hides it,
including Xyne's own. The first version used a literal `[app:…]` prefix, which
this app stripped and the Spaces dashboard did not, so anyone reading the ticket
in Xyne saw the machinery in front of the sentence. Both forms still parse:
entries written before the change are in real tickets and keep their badges.

The marker becomes the **via Zoho Desk ↗** chip, and its optional third field is
an idempotency key — the id of the outside thing the entry mirrors.

That is underwhelming until you notice what it buys: the link is visible in Xyne
itself, it outlives this app, any agent asked about the ticket reads it, and it
sits in time order next to the message explaining why.

---

## How a Zoho link is built when the row has no URL

`webUrl` rides on roughly **one ingested message in a hundred** — three of the
293 sampled. So most emails have no URL on them at all. They do have the id.

From `zoho/transformer.ts:60-92`, `externalThreadId` is `getThreadId(...)` which
returns `payload.ticketId ?? payload.id` — the Zoho ticket id — and `webUrl` is a
sibling field on that same Zoho ticket, ending in that same id. So:

1. The **first** time this app sees a real `webUrl` anywhere in the workspace, it
   keeps everything before the id: `…/support/juspay4/ShowHomePage.do#Cases/dv/`.
2. It writes that to **global** app storage, so one observation unlocks the link
   for every person and every session afterwards.
3. Every Zoho email then links out, id by id.

The portal segment (`juspay4`) is **learned, never hardcoded**. Before a real URL
has been seen, `zohoTicketUrl` returns null and rows are labelled without a link.
A chip that says ↗ and then 404s is worse than a chip that does not.

The same is *not* done for Gmail or Slack. Both have well-known permalink shapes
and we hold the ids, but a Gmail link needs the right `authuser` and a Slack link
needs the workspace subdomain — neither is on any row we can read. Those are
offered only if a caller supplies the missing piece (`configureOrigins`).

---

## Your PR comments: why neither one arrived

You commented on GitHub PR #1624 at `#r3963340329`, and on Bitbucket PR #9604 at
`?commentId=2021956`. Neither appeared. Both hosts sent the event.

> **CORRECTION 2.** The first draft said: *"Bitbucket is different — it has
> `pr:comment:added` and a real `handleCommentEvent`. So PR comments flow from
> Bitbucket and not from GitHub."*
>
> Wrong. The handler exists and **writes nothing to the ticket.** In full
> (`bitbucketWebhookService.ts:153-193`), it extracts mentions, and if one
> matches a single hardcoded address it starts a PR-check workflow. Your comment
> mentioned nobody, so it returned success and the comment was gone. Comments
> flow from neither host.

GitHub fails differently. Its router handles exactly two events:

```ts
if (eventType === 'pull_request')  …
if (eventType === 'issue_comment') …
logger.info(`Event ${eventType} acknowledged but not processed`)
```
*(`githubWebhookService.ts:130-152`)*

A comment on a line of the diff — the "Files changed" tab, which is what
`#r3963340329` is — arrives as **`pull_request_review_comment`**. Not in the
router. Neither is `pull_request_review`, which carries approvals. And a plain
`issue_comment` only acts if it mentions `@xynespaces`.

**This cannot be fixed from inside the app.** No route exposes PR comments —
`sdlc.ts` covers repositories, wikis and credentials and nothing else — and the
published app cannot call `bitbucket.juspay.net` directly (cross-origin, and it
holds no credential).

So it is written as a patch instead: **`patches/pr-comments-to-tickets.patch`**.
Three files, one new `recordPRComment()` reusing the existing PR→ticket
resolution, both hosts wired to it, plus the two missing GitHub events. It
applies cleanly to `xyne-spaces@466c7046d` and `tsc --noEmit` on the backend is
clean with it applied. **It is not applied** — see `patches/README.md`.

Once it is, the comment lands with `prEvent: 'COMMENTED'` and `prCommentUrl`, and
this app renders it as **via Bitbucket ↗** with no further change.

---

## What else the SDK gives us

**Reachable and now used**

| Capability | Call | What it gives |
|---|---|---|
| The email thread on a ticket | `email.listForConversations` | recipients, cc, provider ids — `lib/mailthread.ts` |
| Message provenance | `messages.listByConversation` → `metadata` | `webUrl`, `prUrl`, `externalAuthor` — `lib/provenance.ts` |
| Cross-type search | `search.query({ apps: 'mail' \| 'file' \| 'call' \| 'chat' })` | the Related tab |
| Real cross-ticket links | `getDetails` → `referencesIn/Out` | "Linked to this ticket" |
| Shared app state | `storage … { scope: 'global' }` | the learned Zoho URL shape |

**Reachable and still unused**

| Capability | Call | What it would add |
|---|---|---|
| Scope search to a track | `search.query({ in: channelId })` | "related, but only on this track" |
| Search by person or time | `{ from, mentions, after, before }` | "everything Priya touched since the PR opened" |
| Write real reference edges | `tickets.addReference` | promote a search hit to an edge Xyne itself shows |
| Attachments | `messages.getAttachments`, `tickets.listAttachments` | files on the ticket, badged like everything else |
| Sub-tickets, RCA | `tickets.listSubTickets`, `getRca` | breakdown and incident detail |
| Server-side automation | `automations.createProposal` → … → `activate` | autonomy that runs with no browser open |
| Slack identity | `user.metadata.slackId` | link a person to their Slack account |

**Reachable but with a catch**

- `search.query({ ticketId })` is accepted but constrains only the *ticket*
  index; other buckets come back unfiltered. Not a cross-type scope.
- `listByConversation` answers `{ items, hasMore, total, nextOffset }` — **not**
  `{ messages }`. Reading the wrong key fails silently as "no rows".
- `channels.listEmail()` returns status rows carrying only `id`.
- `automations.createProposal` types `configJson` as `unknown` but the server
  requires a JSON **string**. Stringify or it 400s. There is no CRON trigger.

**Not reachable at all**

- **Resolving `externalSource`** to an adapter name. No route lists
  `ExternalSource` rows, so a message with no `webUrl` and no Slack markers
  cannot be attributed more precisely than "Email".
- **PR comments** — the patch above.
- **Agent Awakening.** The string "awakening" appears zero times in
  `apps/backend/src` (the only service the SDK talks to) and zero times in the
  SDK dist.
- **Live agent streaming.** Xyne streams over SSE, but it is dashboard-internal.
  We poll `claw.getRun`, which returns the whole `AgentRun` row including
  `toolInvocations` — far more than its four-field type admits.
- **`workflow.external_messages`**, the authoritative provenance join. Different
  Postgres schema, no SDK surface.

---

## Reading the code

| File | What it does |
|---|---|
| `lib/origin.ts` | names external systems, and builds the way back out; the rules about what will not be guessed |
| `lib/mailthread.ts` | the email side of a ticket — participants, provider, Zoho link, and the learned URL shape |
| `lib/provenance.ts` | resolves a message to its source; the ordering and why each badge is allowed |
| `lib/related.ts` | the seed builder, and `resolveOutbound` — recovering a link the index dropped |
| `lib/mailbridge.ts` | joining a code-host notification ticket to the work ticket, mirroring its mail, and replying to it |
| `components/ledger/Surfaces.tsx` | the "across surfaces" strip and what counts as outside |
| `components/ledger/SurfaceIcon.tsx` | which icon each system gets, and why not brand logos |
| `components/ledger/MessageRow.tsx` | the row, and the grouping rule that keeps badges visible |
| `patches/README.md` | the PR-comment bug, in full, with the fix |
