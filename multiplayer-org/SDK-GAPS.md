# Xyne Spaces SDK — what it can't do, and what it does wrong

What an app author hits when building against `@xyne/spaces-sdk` alone, compared with what the
dashboard can do. Written while building this app; **every item marked ✅ was reproduced live**
against `spaces.xyne.juspay.net`, the rest come from reading `apps/backend` and are marked accordingly.

> **Calls and recordings have their own pair of documents**, written against the real Spaces
> Recordings feature: [`SCRIBE-SDK-GAPS.md`](./SCRIBE-SDK-GAPS.md) for what is missing, and
> [`SCRIBE-SDK-WINS.md`](./SCRIBE-SDK-WINS.md) for what the SDK made possible there.

---

## 1. Ops that lie about what they return

### 1.1 ✅ `channels.listEmail` returns every channel, not the desks

`channels.listEmail` → query `userVisibleEmailChannels` (`apps/backend/src/zero/queries.ts:2329`):

```ts
zql.channel_user_status
  .where('userId', ctx.userID)
  .related('channel', ch => ch.where('type', 'IN', [EMAIL, SLACK, APP, CALL, SOCIAL_MEDIA]))
```

In Zero, `.related(rel, cb)` shapes **which child rows get attached** — it never removes a parent
row. Filtering the parent needs `.whereExists`. So the op returns *every* `channel_user_status` row
the caller has, with `channel` populated only on the desk ones.

Reproduced: **207 rows returned, 2 with a `channel` object** — `email-support` (deskType `EMAIL`)
and `credit-mail-support` (deskType `DL`).

`channels.list` → `userVisibleChannelsV3` (`queries.ts:2312`) has the exact mirror-image bug with
`NOT IN`, so it also returns 207 rows, 2 of which have no `channel`.

**Workaround (used by this app):** call `channels.listEmail()` and keep the rows where `channel` is
truthy. The bug is load-bearing — it is currently the *only* way to enumerate desks (see §2).

### 1.2 ✅ `conversations.listByChannel`'s cursor type is wrong

The SDK declares:

```ts
interface ConversationCursor { conversationId: string; lastActivityAt: number }
listByChannel(channelId, options?: { limit?, start?, isMember?, direction? })
```

The backend (`channelConversationsPaginatedV3`, `queries.ts:3789`) validates:

```ts
z.object({
  channelId: z.string(),
  isMember: z.boolean(),                              // REQUIRED, optional in the SDK
  limit: z.number(),                                  // REQUIRED, optional in the SDK
  start: z.object({ createdAt: z.number() }).nullable(),  // createdAt — NOT conversationId/lastActivityAt
  direction: z.literal('forward').or(z.literal('backward')),  // REQUIRED
})
```

Calling it as typed returns `400 validation_failed: Validation failed for query
channelConversationsPaginatedV3: Required`. Paging is impossible via the documented shape.

Two further traps once you get past that:
- `direction: 'forward'` orders `createdAt` **DESC** — "forward" walks *back* through history.
- the cursor row is returned again (`{ inclusive: direction === 'forward' }`), so **dedupe** or every
  page repeats one row.

**Workaround (used by this app, `lib/chat.ts`):** cast the options and pass
`{ channelId, isMember: true, limit, start: { createdAt }, direction: 'forward' }`, then drop rows
whose `createdAt` equals the cursor. Verified paging back Sept 8 → Aug 4 over 37 threads.

### 1.3 ✅ Storage rejects `limit > 100` instead of clamping

`storage.collection().list({ limit })` over 100 returns
`400 ValidationError: limit — Too big: expected number to be <=100`.

Note the asymmetry: the **Spaces** SDK clamps `limit` into `[1,100]` client-side, so over-asking is
harmless there. **Storage is a different service** and rejects. Page explicitly with `offset`.

### 1.4 ⚠️ `calls.listScheduled` / `listHistory` look unscoped — they are not. Do not "fix" this.

`userScheduledCallsV2` (`queries.ts:2650`) and `userCallHistoryV2` (`queries.ts:2679`) have **no
`ctx` filter at the top level** — only `.related('participants', p => p.where('userId', ctx.userID))`.
That looks exactly like the §1.1 bug, and a first pass of this analysis wrongly called it a
workspace-wide data leak.

It isn't. Row access is enforced in the ACL layer, not the query: `CallsACL.canSelect`
(`packages/shared/src/zero/acl/tables/calls-acl.ts:39`) applies a real top-level `where` with OR
branches for `createdByUserId`, active `shares`, public headless calls, `exists('participants')`, and
channel membership. The server-side `CallsACL.getWhereClause`
(`apps/backend/src/database/acl/tables/calls-acl.ts:61`) mirrors it.

**Consequence for app authors:** a returned call with `participants: []` does **not** mean you have
no access — the relation only ever attaches *your own* participant row, and you may hold access via
channel membership instead. Don't use an empty `participants` array as an access signal.

---

## 2. Get-by-id with no way to enumerate

| Op | Missing | Impact |
|---|---|---|
| `email.getChannelPreference(channelId)` | no `listChannelPreferences()` | ✅ Desks can't be enumerated — you'd need one call per channel (207 here). Only the §1.1 quirk makes it tractable. |
| `conversations.getMyParticipation(id)` | nothing returns *all* participants of a thread | Can't render "who's in this thread" at all |
| `calls.getRecurringSeries(seriesId)` | no `listRecurringSeries()` | Can't discover a series without already holding its id |

---

## 3. Tables no SDK op can reach

From a diff of the 128 tables in `schema.ts` against every mapped op (including `.related()` joins):

`agents` · `models` · `tools` · `agent_tools_mappings` · `guest_access` ·
`notification_preferences` · `proactive_nudges` · `release_changes` · `channel_recaps` ·
`surface_links` · `recurring_call_participants`

Two worth calling out:

- **`surface_links`** — the cross-surface "relates to" graph. Written only by an internal nudge
  handler (`mutators.ts:10923`); its ACL explicitly refuses client writes. An app cannot read *or*
  write the link graph.
- **`release_changes`** — a trap: the op named `incidents.listReleaseChanges` actually reads the
  differently-named `release_change_types` table (`queries.ts:4742`), so the approval fields
  (`approvedBy`/`approvedAt`) on `release_changes` are unreachable despite the matching op name.

No workaround for any of these.

---

## 4. Mutators the dashboard has and the SDK doesn't

| Mutator | What it does |
|---|---|
| `sdlc.createLink` / `sdlc.deleteLink` (`mutators.ts:11427`, `:11478`) | Create/remove an `sdlc_entity_links` edge. **The entity graph is entirely closed to apps** — no mapped query reads it either. |
| `ticket.acknowledgeEtaRisk` (`:6834`) | Dismiss an ETA-risk flag with an optimistic-concurrency fingerprint. `tickets.update({metadata})` could clobber the same blob blind. |
| `viewAccess.grant` / `revoke` (`:15077`, `:15106`) | Share a saved board view with a user/group/channel. The only mutator namespace of 71 with zero SDK coverage. |

---

## 4b. ✅ No code-host entity — and the desktop CSP blocks the obvious workaround

`workspace.listRepos()` is the SDK's *entire* knowledge of code hosting. Verified live (4 repos):

```json
{ "id": "...", "name": "xyne-spaces-private", "url": "https://github.com/juspay/xyne-spaces-private",
  "canonicalUrl": "...", "baseBranch": ["main"], "prefix": "feature",
  "projectId": null, "channelId": "...", "sdlcSetupExecutionId": null, "accessCapabilities": {...} }
```

That is workspace metadata — *which* repos are connected. There is no pull request, commit, branch-state
or file-tree entity anywhere in the SDK, and `search` indexes no code host (`SearchApp` has no code
member). A native code surface therefore **cannot** be SDK-backed; it has to call `api.github.com` /
`api.bitbucket.org` from the browser.

Two constraints on doing that from a published app:

1. **Iframing the host is impossible.** GitHub sends `X-Frame-Options: DENY`, and the Electron shell's
   `frame-src` allowlist doesn't include it either.
2. **Direct API calls work in the browser but are CSP-blocked in the desktop app.** The web dashboard
   sets no CSP on the artifact frame, and GitHub returns `Access-Control-Allow-Origin: *`, so an
   `Origin: null` request from the sandbox succeeds. But the Electron shell injects its own CSP
   (`apps/electron/src/services/request-interceptor.ts:263-270`) whose `connect-src` is a closed
   allowlist — `'self'`, the Xyne hosts, the Xyne websocket, Sentry, Google, and the Sandpack bundler.
   `api.github.com` is **not** on it, so the same code silently fails there.

**Consequence:** a code surface built this way works on web and degrades in the desktop app until that
allowlist is extended. Design for the error state.

---

## 4c. An artifact app can never build another artifact app

A named, deliberate ban — the "self-replication ban" — enforced in two places.
`apps/xyne-claw/src/routes/run.ts:3272-3289`:

```ts
const isArtifactAppRun =
  eventType === "artifact_app" || (conversationId?.startsWith("app_") ?? false);
if (isArtifactAppRun) {
  allTools = allTools.filter(
    t => t.name !== "create-app" && t.name !== "read-app-file" && t.name !== "schedule-task",
  );
}
```

The rationale is that an app whose agent can build an app produces a chain nothing outside can kill —
the same reason `schedule-task` goes. `read-app-file` goes too, so an app cannot read its own source
back. claw-auth also strips both slugs at dispatch, because an agent with no tools config gets every
tool by default.

The trigger is the conversation id prefix, which app-initiated runs cannot avoid
(`apps/xyne-claw-auth/backend/src/routes/artifact-app-agents.ts:88` mints `app_{owner}_{who}_{runKey}`).

**The apparent loophole is not one.** An SDK run via `spaces.claw.run` sets no `eventType` and lets you
choose the `conversationId`, so a non-`app_` id would leave `create-app` unfiltered. But the tool writes
its payload to GCS and returns only a manifest; reading it back needs an internal S2S route behind
`requireStrictS2S` with a key no app holds. You would generate an app you cannot read.

*(Verified from source by the parallel session building the Studio surface.)*

### But the upload API itself is cookie-authenticated

Distinct mechanism, distinct door: everything under `/claw/api/v1/artifact-apps/*` is mounted
`requireAuth` (`main.ts:224`) — the same cookie auth our tunnel already speaks — not S2S. The CLI's own
comment calls these "one of the few claw-auth routers mounted WITHOUT the access-token barrier". So a
published Space can in principle create, version, publish and pull app payloads **as its viewer**,
with no new credential.

The ban stops an app's *agent* from calling `create-app`. It does not stop the *app* from calling the
upload API as a human who clicked a button.

**⚠️ One-way door.** There is no delete anywhere: the CLI exposes `init/push/publish/unpublish/
versions/restore/list/pull` and `claw.js` exports no delete route. `unpublish` only makes an app
private again. **Every app created this way is permanent in the workspace.** Anything built on this
should create unpublished by default, name rows unmistakably, and say plainly in the UI that apps
cannot be removed.

---

## 4d. What a published app already has installed (and what that costs)

Two assumptions worth correcting, because both are natural and both are wrong.

**lucide-react and all of shadcn's deps are pre-installed.** `BASE_DEPENDENCIES`
(`ReactArtifact.utils.ts:115-120`) is `SHADCN_DEPENDENCIES` plus `@tailwindcss/browser`, and
`SHADCN_DEPENDENCIES` (`shadcnPreamble.generated.ts:74`) contains `lucide-react`, `clsx`,
`tailwind-merge`, `class-variance-authority` and sixteen `@radix-ui/*` packages. They resolve in a
published app with **no manifest entry at all**. The natural assumption — that a bare npm import
can't work because `node_modules` isn't uploaded — is wrong for exactly this set.

**Anything else on npm is allowed too**, via the manifest's `dependencies` map, which the CLI
forwards into the upload body. `ENFORCE_DEPENDENCY_ALLOWLIST` is `false`
(`tools.ts:89`) — deliberately, so an agent isn't blocked by a list nobody maintains. A dependency
costs **nothing** against the 64 KB-per-file cap, because it never enters the source tree.

**Tailwind in the sandbox is a runtime JIT, not a prebuilt sheet.** The preview loads Tailwind v4's
browser build and injects the theme as `<style type="text/tailwindcss">`, compiling off DOM
mutations — so a class that first appears at runtime *is* compiled. The asymmetry runs the other
way: **local dev** uses `@tailwindcss/vite`, which scans source at build time, so a dynamically
constructed class works published and fails on localhost.

*(Verified from source by the parallel session building the Studio surface.)*

---

## 4e. `claw.getRun`'s type is narrower than the endpoint — and the difference is the whole progress UI

The SDK declares:

```ts
export interface ClawRun { sessionId: string; status: string; result?: string; error?: string }
```

Four fields. But the registry sets **`mapArgs` and no `mapResult`** (`registry/claw.js:38-42`), and the
backend handler returns the service result verbatim — `res.json(await route.service(req, authData))`
with no field selection (`apps/backend/src/api/sdk/direct.ts:271-282`). So the response passes
through whole: `currentToolLabel`, `toolInvocations`, `reasoning`, `toolsUsed`, token counts and
timings all arrive, and TypeScript simply doesn't know about them.

This matters more than a typing nit, because of how a run actually behaves: **`result` does not
stream.** Measured on a live run — zero bytes for 51 seconds, then all 4,872 at once at 66s.
`status` alone gives you a spinner and nothing else. `currentToolLabel` and `toolInvocations` *do*
move during the run, so they are the only honest progress signals available to a polling client.

Cast past the declared type to reach them:

```ts
const run = (await spaces.claw.getRun(id)) as unknown as ClawRun & {
  currentToolLabel?: string;
  toolInvocations?: Array<{ name?: string; label?: string }>;
};
```

*(Measured and reported by the parallel session building the Studio surface.)*

---

## 4f. Artifact apps are invisible to the SDK — publish, list and fetch are REST-only

The workspace Library — user-built apps created in Studio or from chat, published for the whole
workspace — has **no SDK surface at all**. Verified against the mapper's full allowlist: none of the
468 operations creates, versions, publishes, unpublishes, lists or fetches an artifact app.

The trap is that the SDK *looks* like it covers this. `admin.listOrgApps`, `admin.listMarketplaceApps`
and `admin.listInstalledApps` exist and return "apps" — but they read the Spaces `apps` /
`installed_apps` tables, which are the **bot/integration registry** (rows with `webhookUrl`,
`signingSecret`, install/uninstall — the Slack-app concept). Artifact apps live in a different table
(`artifact_apps`), in a different database, owned by a different service
(`apps/xyne-claw-auth/backend`), whose only connection to the Spaces DB is read-only by Postgres
grant. A published artifact app can therefore **never** appear in any `admin.*` listing.

The real surface is `/claw/api/v1/artifact-apps` (cookie-auth, forwarded to Spaces `/api/auth/me`):
create, `POST /:id/versions`, `publish` (pins a version, `visibility=WORKSPACE`), `unpublish`,
`GET /?scope=mine|workspace`, `GET /:id/payload` (non-owners are always served the pinned published
version — drafts stay private). Reachable from a published app because the host tunnels `/claw/*`
as the signed-in viewer; unreachable from a dev server, whose bearer token this router rejects.

**What Scribe/Studio do about it:** `lib/studioDeploy.ts` wraps the REST routes for Studio's deploy
buttons, and `components/WorkspaceApps.tsx` uses the same routes to list every published app in the
store and run it through Studio's own runtime. **The ask:** `apps.listPublished` and
`apps.getPayload` gateway ops — the routes, permission checks and data already exist.

---

## 5. No realtime *over the SDK* — but a published app gets more

**Correction.** An earlier version of this document said flatly "no realtime, poll or do without".
That is true of the SDK over HTTP and true in local dev, and **false for a published app.**

Embedded in the dashboard, a Space talks to a host bridge that is much wider than the fetch tunnel
`lib/xyne.ts` implements. The full message set (`apps/dashboard/src/components/AIScreen/ReactArtifact/*`):

| type | direction | what it carries |
|---|---|---|
| `request` / `request-result` | app ↔ host | the tunnelled fetch our `lib/xyne.ts` uses |
| `mutate` / `mutate-result` | app ↔ host | host-executed mutations |
| `directory` | host → app | the workspace directory |
| `agent-run` / `agent-attach` / `agent-cancel` | app → host | start, re-attach to, or stop an agent run |
| **`agent-event`** | **host → app** | **live streamed run events** |
| `agent-state` | host → app | available agents and run state |
| `ready` / `refresh` / `start` / `done` / `error` | both | lifecycle |

**Read the scope narrowly.** This is *not* a general subscribe-to-any-entity mechanism. The watcher
(`useArtifactAgentBridge.ts:188-206`) calls:

```ts
consumeConversationLiveStream({ conversationId, agentSlug, signal, onEvent })
```

— one stream, scoped to **one conversation and one agent slug**, carrying exactly six event kinds:

```ts
type LiveKind = 'snapshot' | 'delta' | 'reasoning' | 'invocation' | 'label' | 'done';
```

That is an agent run's own output — assistant text, reasoning, and `invocation` (the tool calls, i.e.
the chips). Attaching mid-run is the normal case: the server sends a Postgres snapshot first, then
live deltas, which is how a reopened app catches up.

So: **agent runs stream; nothing else does.** You cannot subscribe to ticket updates, new messages
from other people, presence, or unread counts. For every entity other than an agent run, the gap
below is real and total.

What is still genuinely absent, everywhere:

The SDK itself is request/response only — two endpoints, `POST /api/sdk/v1/query` and `/mutate`. There is
no websocket, no subscription, no push. Everything below is dashboard-only:

- **Zero live sync** (`ZeroProvider.tsx:71`) — every dashboard query is a live view that updates
  incrementally. An SDK caller gets one snapshot per call and must re-poll.
- **Socket.IO** (`websocketService.ts:189`) — typing indicators, live presence, live ticket-count
  badges, SOS acknowledgement, notification streams.
- **Canvas CRDT** — when a canvas `isCollaborative`, the realtime server owns the content;
  `canvases.update` is not a safe read-modify-write. Apps can only snapshot/restore.
- **Call signalling** — `calls.initiate` records a row only; media and lobby state live on a separate
  server the SDK never talks to.

**Consequence:** typing, presence, unread badges and co-editing must be polled in every mode, and
*everything* must be polled in local dev, where there is no host to bridge to. This app polls chat
and presence at 3–5 s and fakes presence with storage heartbeats. But an agent run in a **published**
app should use `agent-run` + `agent-event` rather than `claw.runAndWait` polling — that is a real
streaming path and this app does not yet use it.

---

## 6. ✅ External SaaS pages cannot be embedded in a Space

Verified live: `github.com` and `bitbucket.org` both send **`X-Frame-Options: deny`** *and*
**`Content-Security-Policy: frame-ancestors 'none'`**, and serve no `Access-Control-Allow-Origin` on
their HTML. So neither framing nor fetch-and-render works from any iframe — independent of Xyne's own
CSP. Adding a host to Xyne's `frame-src` allowlist would still yield a blank "refused to connect".

One nuance worth recording, because it changes *whose* problem this is: an Electron `<webview>` is a
separate top-level browsing context, so those headers do **not** apply to it, and the desktop shell
already wires webviews up (`apps/electron/src/app/main.ts:260-272`, `webview-preload.js`). The shell
*could* host such a page.

But a Space has no way to ask for one. The artifact bridge carries only data and agent message types
— `request`, `mutate`, `directory`, `agent-*`, and lifecycle — with **no window-management channel**.

**Conclusion:** embedding an external SaaS surface is a host feature (dashboard + Electron), not
something a Space can implement. Re-rendering from the vendor's API is the only route available today.
*(Credit: verified by the parallel session building the code-host surface.)*

---

## Summary

| Area | Severity for an app author |
|---|---|
| `.related` instead of `.whereExists` on channel ops | Ops return the opposite of their name; workaroundable, but only if you know |
| `conversations.listByChannel` cursor type | Documented usage returns 400 — history paging is impossible until you read the backend |
| Desk enumeration | Only reachable through a bug |
| Entity link graph (`sdlc_entity_links`, `surface_links`) | Completely closed — no read, no write |
| Thread participants | Cannot be listed under any circumstance |
| Realtime | Absent; poll or do without |
