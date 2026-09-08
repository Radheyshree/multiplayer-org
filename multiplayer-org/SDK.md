# Xyne Spaces SDK — API reference

Generated from the installed `@xyne/spaces-sdk` + `@xyne/storage-sdk` in `node_modules/`.
Signatures are copied from the shipped `.d.ts`; routes from the shipped `.js`.

> This file is documentation only. `.md` is not in the CLI's allowed extensions, so `spaces app push` never uploads it.

## How a call is made

Almost every method posts an **operation id** to a single endpoint:

```
POST /api/sdk/v1/query    { op: "channels.listAll", args: {...} }   # reads
POST /api/sdk/v1/mutate   { op: "messages.send",    args: {...} }   # writes
```
A handful use direct REST routes (`GET /api/sdk/v1/me`, `POST /api/sdk/v1/channels`, the `claw` and `search` routes).
Both go through the same `fetch`, which `lib/xyne.ts` tunnels to the host when the app is embedded in Spaces.

---

## Resources in your vendored bundle

These 10 are compiled into `lib/vendor/spaces-sdk.js` and available as `spaces.<name>` right now.

| resource | what it is |
|---|---|
| [`activities`](#activities) | The authenticated user's own activity feed (mentions, thread replies, reactions, missed calls, nudges, bookmarks) and the read-state mutations that cl |
| [`boards`](#boards) | Boards, their stages, stage transitions, SLA policies, saved views, flow plans and board↔channel/form/complexity mappings — exposed on SpacesClient as |
| [`channels`](#channels) | Channel membership, settings, participants, DMs, per-user read/star state, and sidebar sections — exposed on SpacesClient as `sdk |
| [`claw`](#claw) | Dispatch and poll Xyne Claw remote agents through the Spaces backend (which relays with its own service credential, so the Spaces API key is the only  |
| [`conversations`](#conversations) | Threads (conversations) inside a channel: listing/reading threads, thread-level membership (subscribe, participation, unread), pinning, labels/tags, a |
| [`messages`](#messages) | Reading and writing individual messages inside existing threads/channels, plus reactions, attachments, saved drafts, and scheduled (delayed) sends — n |
| [`projects`](#projects) | Workspace projects — the container that groups boards, tickets, tags, canvases and applications; a project's `code` prefixes its ticket keys (PLAT → P |
| [`search`](#search) | Full-text and filtered search across the workspace (messages, tickets, files, channels, calls, users), backed by Vespa via direct REST endpoints rathe |
| [`tickets`](#tickets) | Work-tracking tickets and everything hanging off one — sub-tickets, project tags, cross-ticket references, stage-approval requests/transitions, and pe |
| [`users`](#users) | The workspace directory, user profiles, and the identity the client's credential acts as (exposed on SpacesClient as `client |

## Resources available but NOT bundled

The full SDK ships 15 more resources. They are in `node_modules/@xyne/spaces-sdk` but excluded from the slim bundle to stay under the sandbox's 64 KB per-file cap. To add one, see [Adding a resource](#adding-a-resource).

| resource | what it is |
|---|---|
| [`admin`](#admin) | Workspace and organization administration: workspaces, orgs and org members, workspace user roles, invitations, custom roles and their members, resour |
| [`attachments`](#attachments) | Uploads raw file bytes over multipart/form-data and returns attachment ids that other operations (messages |
| [`automations`](#automations) | Event-triggered automations and their approval lifecycle (createProposal → submitForApproval → approve → activate), plus a paginated listing of workfl |
| [`calls`](#calls) | Manages call records around rooms provisioned on a separate realtime server: active/scheduled/history listings, participants, recurring series, summar |
| [`canvases`](#canvases) | Collaborative BlockNote documents ("canvases") plus their folders, sharing grants (users/groups/channels), inline comment threads, and saved version s |
| [`collections`](#collections) | Knowledge-base collections: nested folders of already-uploaded files (versioned, latest-version reads) plus the user/group/channel permission grants t |
| [`dashboards`](#dashboards) | Dashboards, their saved queries, and tile layout — a query is defined once and then *placed* on a dashboard, and the placement (mappingId) is what reo |
| [`email`](#email) | Support-desk email surface exposed as `sdk |
| [`forms`](#forms) | Custom forms, their fields, the context mappings that decide where a form applies (board / stage / release change), and the field values submitted aga |
| [`incidents`](#incidents) | Root-cause analyses (RCAs) plus everything hanging off them — recorded impacts and their attachments, corrective actions (CoE), release tickets/change |
| [`preferences`](#preferences) | The calling user's own settings — notification levels and keywords, per-channel notification overrides, interface/sidebar behaviour, profile card, pre |
| [`recaps`](#recaps) | Daily AI-generated channel and project recaps — reading them by day, managing subscriptions/custom prompts/read state, plus entity-level nudge queries |
| [`supportTickets`](#supporttickets) | Read-only support-desk view of ticket rows: email-driven tickets in a desk channel, ordered by most recent email, with desk-specific filters (assignee |
| [`userGroups`](#usergroups) | Teams (user groups): their membership and the assignment-routing configuration — on-call state, board weights, expertise, and auto rotation — exposed  |
| [`workspace`](#workspace) | Workspace-level shared items on `SpacesClient |

---

# Bundled resources

## activities

The authenticated user's own activity feed (mentions, thread replies, reactions, missed calls, nudges, bookmarks) and the read-state mutations that clear it — every method is implicitly scoped to the caller, there is no user id parameter.

| method | signature | route |
|---|---|---|
| `list` | `list(): Promise<Activity[]>` | `POST /api/sdk/v1/query` |
| `listPaginated` | `listPaginated(options?: { limit?: number; start?: ActivityCursor; types?: string[] }): Promise<Activity[]>` | `POST /api/sdk/v1/query` |
| `listUnread` | `listUnread(): Promise<Activity[]>` | `POST /api/sdk/v1/query` |
| `listUnreadThreads` | `listUnreadThreads(): Promise<Activity[]>` | `POST /api/sdk/v1/query` |
| `listMissedCalls` | `listMissedCalls(): Promise<Activity[]>` | `POST /api/sdk/v1/query` |
| `listBookmarks` | `listBookmarks(): Promise<Bookmark[]>` | `POST /api/sdk/v1/query` |
| `markAsRead` | `markAsRead(activityId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `markAsUnread` | `markAsUnread(activityId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `markThreadAsRead` | `markThreadAsRead(conversationId: string, options?: { draftMessage?: string }): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `markMissedCallsAsRead` | `markMissedCallsAsRead(): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `markSeenByMessage` | `markSeenByMessage(messageId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `dismissNudge` | `dismissNudge(nudgeId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `actOnNudge` | `actOnNudge(nudgeId: string, actionResult?: unknown): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `markAsReadByFilter` | `markAsReadByFilter(filter: { actorAction?: string; classification?: string }): Promise<void>` | `POST /api/sdk/v1/mutate` |

<details><summary>Notes (14)</summary>

- **`list`** — No params. Returns the entire feed, read and unread, in one response — no server-side cursor, so use listPaginated for windowed reads.
- **`listPaginated`** — The only genuinely paginated read on this resource. options is optional and defaults to {} in the implementation. start is an ActivityCursor { id: string; updatedAt: number } taken from the last item of the previous page; types restricts to given activity types (omit for all). Returns one page, newest first. Note this is true cursor pagination handled server-side — it does NOT use the client-side core/paginate.js window helper (DEFAULT_LIMIT/MAX_LIMIT = 100), which this resource never imports.
- **`listUnread`** — No params. Unread activities only; unpaginated full result.
- **`listUnreadThreads`** — No params. Unread activities scoped to threads the caller is subscribed to; unpaginated.
- **`listMissedCalls`** — No params. Missed-call activities; unpaginated. Pair with markMissedCallsAsRead to clear the badge.
- **`listBookmarks`** — No params. Returns Bookmark[] (saved references to messages, threads, tickets and canvases), not Activity[]. Unpaginated. This resource is read-only for bookmarks — there is no create/delete bookmark method here.
- **`markAsRead`** — Required: activityId. Mutating side effect — flips one activity's read state. Returns void (transport returns response.generated ?? response for mutators).
- **`markAsUnread`** — Required: activityId. Inverse of markAsRead; mutating side effect.
- **`markThreadAsRead`** — Required: conversationId. options is spread flat into the args alongside conversationId (not nested). draftMessage preserves an unsent draft while marking the thread read. Bulk side effect — clears every activity in the thread.
- **`markMissedCallsAsRead`** — No params. Clears the caller's missed-call badge wholesale.
- **`markSeenByMessage`** — Required: messageId. Marks activities seen up to and including that message — a range side effect, not a single row.
- **`dismissNudge`** — Required: nudgeId. Dismisses a nudge without acting on it.
- **`actOnNudge`** — Required: nudgeId. actionResult is optional and typed unknown — an arbitrary payload recording what the action produced, e.g. { ticketId: 'ticket-9' }. Always sent as a key (undefined when omitted).
- **`markAsReadByFilter`** — filter is a REQUIRED argument even though both of its fields are optional — passing {} is legal at the type level and would clear everything matching no filter, so treat it as a wide bulk mutation. actorAction restricts to one kind of action (e.g. 'REACTION'); classification restricts to one classification.

</details>

## boards

Boards, their stages, stage transitions, SLA policies, saved views, flow plans and board↔channel/form/complexity mappings — exposed on SpacesClient as `sdk.boards` (BoardsResource); every call is an SDK operation id posted to the versioned API, not a REST route.

| method | signature | route |
|---|---|---|
| `list` | `list(): Promise<Board[]>` | `POST /api/sdk/v1/query` |
| `listByProject` | `listByProject(projectId: string): Promise<Board[]>` | `POST /api/sdk/v1/query (op: "boards.listByProject", args: { projectId })` |
| `listByChannel` | `listByChannel(channelId: string): Promise<ChannelBoardMapping[]>` | `POST /api/sdk/v1/query (op: "boards.listByChannel", args: { channelId })` |
| `listByProjectLite` | `listByProjectLite(projectId: string): Promise<Board[]>` | `POST /api/sdk/v1/query (op: "boards.listByProjectLite", args: { projectId })` |
| `getMany` | `getMany(boardIds: string[]): Promise<Board[]>` | `POST /api/sdk/v1/query (op: "boards.getMany", args: { boardIds })` |
| `get` | `get(boardId: string): Promise<Board \| null>` | `POST /api/sdk/v1/query (op: "boards.get", args: { boardId })` |
| `getDetail` | `getDetail(boardId: string): Promise<Board \| null>` | `POST /api/sdk/v1/query (op: "boards.getDetail", args: { boardId })` |
| `getFullDetail` | `getFullDetail(boardId: string): Promise<Board \| null>` | `POST /api/sdk/v1/query (op: "boards.getFullDetail", args: { boardId })` |
| `listStages` | `listStages(boardId: string): Promise<Stage[]>` | `POST /api/sdk/v1/query (op: "boards.listStages", args: { boardId })` |
| `listStagesForBoards` | `listStagesForBoards(boardIds: string[]): Promise<Stage[]>` | `POST /api/sdk/v1/query (op: "boards.listStagesForBoards", args: { boardIds })` |
| `listStagesByProject` | `listStagesByProject(projectId: string, options?: { boardType?: string; }): Promise<Stage[]>` | `POST /api/sdk/v1/query (op: "boards.listStagesByProject", args: { projectId, ...options })` |
| `listTransitions` | `listTransitions(boardId: string): Promise<StageTransition[]>` | `POST /api/sdk/v1/query (op: "boards.listTransitions", args: { boardId })` |
| `listTransitionsForBoards` | `listTransitionsForBoards(boardIds: string[]): Promise<StageTransition[]>` | `POST /api/sdk/v1/query (op: "boards.listTransitionsForBoards", args: { boardIds })` |
| `listSlaPolicies` | `listSlaPolicies(boardId: string): Promise<BoardSlaPolicy[]>` | `POST /api/sdk/v1/query (op: "boards.listSlaPolicies", args: { boardId })` |
| `listSlaPoliciesForBoards` | `listSlaPoliciesForBoards(boardIds: string[]): Promise<BoardSlaPolicy[]>` | `POST /api/sdk/v1/query (op: "boards.listSlaPoliciesForBoards", args: { boardIds })` |
| `listComplexityScores` | `listComplexityScores(userGroupId: string): Promise<BoardComplexityScore[]>` | `POST /api/sdk/v1/query (op: "boards.listComplexityScores", args: { userGroupId })` |
| `listSavedViews` | `listSavedViews(boardId: string): Promise<SavedView[]>` | `POST /api/sdk/v1/query (op: "boards.listSavedViews", args: { boardId })` |
| `listFormMappings` | `listFormMappings(boardIds: string[]): Promise<FormContextMapping[]>` | `POST /api/sdk/v1/query (op: "boards.listFormMappings", args: { boardIds })` |
| `update` | `update(boardId: string, data: { name?: string; description?: string; projectId?: string; boardType?: string; metadata?: unknown; stages?: StageInput[]; }): Promise<void>` | `POST /api/sdk/v1/mutate (op: "boards.update", args: { boardId, ...data })` |
| `delete` | `delete(boardId: string): Promise<void>` | `POST /api/sdk/v1/mutate (op: "boards.delete", args: { boardId })` |
| `upsertSlaPolicy` | `upsertSlaPolicy(data: { id?: string; boardId: string; priority: TicketPriority; responseHours: number; resolutionHours: number; businessHoursOnly: boolean; timezone: string; workdayStart: number; workdayEnd: number; isActive: boolean; }): Promise<{ id: string; }>` | `POST /api/sdk/v1/mutate (op: "boards.upsertSlaPolicy", args: { ...data, id })` |
| `deleteSlaPolicy` | `deleteSlaPolicy(id: string): Promise<void>` | `POST /api/sdk/v1/mutate (op: "boards.deleteSlaPolicy", args: { id })` |
| `syncTransitions` | `syncTransitions(boardId: string, transitions: StageTransitionInput[]): Promise<void>` | `POST /api/sdk/v1/mutate (op: "boards.syncTransitions", args: { boardId, transitions })` |
| `updateFlowPlan` | `updateFlowPlan(boardId: string, plan: FlowPlan): Promise<void>` | `POST /api/sdk/v1/mutate (op: "boards.updateFlowPlan", args: { boardId, plan })` |

<details><summary>Notes (24)</summary>

- **`list`** — No params. Returns every board in the workspace, WITHOUT stages. No pagination — the full array comes back in one response; there is no listAll variant and no limit/offset accepted (core/paginate.js `paginate()` exists but boards never uses it, so window client-side yourself if needed).
- **`listByProject`** — `projectId` required. Full board rows, no stages. Unpaginated.
- **`listByChannel`** — `channelId` required. Reads `channel_board_mappings`, NOT `boards` — each row is the mapping with the board hanging off its `board` relation, so you must unwrap `.board`. A channel can map to several boards; ordered by when the mapping was made. Use listByProject when you hold a project id instead.
- **`listByProjectLite`** — `projectId` required. Same declared type as listByProject but the server returns identifying fields only (id/name) — for pickers. Do not rely on other Board fields being populated.
- **`getMany`** — `boardIds` required. Batch fetch; unknown ids are silently skipped, so the result length may be shorter than the input and order should not be assumed to match.
- **`get`** — `boardId` required. Returns null when the board does not exist (no throw). No stages included.
- **`getDetail`** — `boardId` required. Board with its stages resolved; null if missing.
- **`getFullDetail`** — `boardId` required. Fullest read: stages + transitions + approvers joined. Intended for rendering a non-linear board's configuration; null if missing.
- **`listStages`** — `boardId` required. Returned in sequence order. Call this before `update({ stages })` — that write replaces the whole stage list. Note tickets reference a stage by `stageName`, not stage id, so renaming a stage is a semantic change.
- **`listStagesForBoards`** — `boardIds` required. One flat array of stages across all named boards — group by `boardId` yourself.
- **`listStagesByProject`** — `projectId` required; `options` optional. Implementation spreads options into the args object, so the wire args are `{ projectId, boardType? }`. `boardType` restricts to boards of one type. Flat array across the project's boards.
- **`listTransitions`** — `boardId` required. Permitted stage moves on a non-linear board, including approval and SLA behaviour. Read this before syncTransitions, which is a wholesale replace.
- **`listTransitionsForBoards`** — `boardIds` required. Flat array of transitions across all named boards.
- **`listSlaPolicies`** — `boardId` required. One policy per TicketPriority, each carrying responseHours/resolutionHours/businessHoursOnly/timezone/workdayStart/workdayEnd/isActive.
- **`listSlaPoliciesForBoards`** — `boardIds` required. Flat array of policies across all named boards.
- **`listComplexityScores`** — Keyed by USER GROUP, not by board — `userGroupId` is required. Returns one score per board the group works; used for capacity-aware routing (a heavier board consumes more of a member's capacity). There is no write counterpart on this resource.
- **`listSavedViews`** — `boardId` required. Saved filter views scoped to that board. Read-only here — creating/updating saved views is not on this resource.
- **`listFormMappings`** — Takes an ARRAY even for a single board. Returns FormContextMapping rows bound to any of those boards.
- **`update`** — Mutator. `boardId` required; every field of `data` optional and omitted fields are left alone — EXCEPT `stages`, which is a wholesale replace: any stage not present in the array is DELETED. Send the complete set with existing ids (read listStages first). Passing `projectId` moves the board to another project. `metadata` is free-form JSON. StageInput = { id?: string; name: string; sequenceNumber: number; eta?: number; defaultTicketStatusV2?: TicketStatusV2; formId?: string; requestApprovalOnEntry?: boolean; approverIds?: string[]; approvers?: Array<{ approverId: string; approverType: 'USER' | 'ROLE' }> } — omit `id` to create a stage. Resolves void.
- **`delete`** — Mutator, destructive: deletes the board AND its stages. `boardId` required. No confirmation, no soft-delete flag, returns void.
- **`upsertSlaPolicy`** — Mutator. Only `id` is optional — every other field is REQUIRED, including booleans and the working-day fields. The client mints the id: `const id = data.id ?? newId()` (core/ids.js) and always sends a concrete `id` on the wire, then returns `{ id }`. Omit `id` to create, pass an existing id to update. `workdayStart` 0-23, `workdayEnd` 1-24, `timezone` is an IANA zone, `businessHoursOnly` gates whether the clock runs only inside that window, `isActive` decides whether it is enforced.
- **`deleteSlaPolicy`** — Mutator. Takes the POLICY id (not boardId). Destructive, returns void.
- **`syncTransitions`** — Mutator, wholesale REPLACE of a non-linear board's transition graph: any transition absent from the array is removed. Read listTransitions first and send everything you want to keep with its existing `id`. StageTransitionInput = { id: string (required); fromStageId?: string | null (null = entry transition); toStageId: string; formId?: string | null; requiresApproval?: boolean; bypassApprovalForAutomation?: boolean; requestApprovalOnEntry?: boolean; visitSlaMode?: VisitSlaMode; fixedEtaHours?: number | null; onReenter?: ReenterMode; approvers?: StageTransitionApproverInput[] }.
- **`updateFlowPlan`** — Mutator for flow boards, whole-plan REPLACE not a patch: any node absent from `plan.nodes` is removed along with the decision routing pointing at it. Read the current plan, edit, write it all back. FlowPlan = { version: 2 (literal, pinned — v1 plans are migrated on read); nodes: FlowPlanNode[]; groups?: FlowPlanGroup[]; decisions?: FlowPlanDecision[]; updatedAt: number }. FlowPlanNode = { id; title; description?; assignedTo?: string | null; parentIds: string[]; order: number; gate?: FlowStepGate; groupId?: string | null }.

</details>

## channels

Channel membership, settings, participants, DMs, per-user read/star state, and sidebar sections — exposed on SpacesClient as `sdk.channels` (ChannelsResource).

| method | signature | route |
|---|---|---|
| `list` | `list(): Promise<ChannelUserStatus[]>` | `POST /api/sdk/v1/query` |
| `listAll` | `listAll(options?: { updatedAt?: number; }): Promise<Channel[]>` | `POST /api/sdk/v1/query` |
| `listEmail` | `listEmail(): Promise<ChannelUserStatus[]>` | `POST /api/sdk/v1/query` |
| `listBrowsable` | `listBrowsable(options?: PageOptions): Promise<Page<Channel>>` | `POST /api/sdk/v1/query` |
| `getStats` | `getStats(channelId: string): Promise<ChannelStats \| null>` | `POST /api/sdk/v1/query` |
| `getUserStatus` | `getUserStatus(channelId: string): Promise<ChannelUserStatus \| null>` | `POST /api/sdk/v1/query` |
| `listParticipants` | `listParticipants(channelId: string): Promise<ChannelParticipant[]>` | `POST /api/sdk/v1/query` |
| `searchParticipants` | `searchParticipants(channelId: string, searchQuery: string): Promise<ChannelParticipant[]>` | `POST /api/sdk/v1/query` |
| `getMyParticipations` | `getMyParticipations(channelIds: string[]): Promise<ChannelParticipant[]>` | `POST /api/sdk/v1/query` |
| `listLinks` | `listLinks(channelId: string): Promise<Link[]>` | `POST /api/sdk/v1/query` |
| `create` | `create(data: CreateChannelInput): Promise<{ id: string; }>` | `POST /api/sdk/v1/channels` |
| `checkDuplicate` | `checkDuplicate(name: string, projectId: string): Promise<CheckDuplicateChannelResponse>` | `POST /api/sdk/v1/channels/check-duplicate` |
| `join` | `join(channelId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `leave` | `leave(channelId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `addParticipants` | `addParticipants(channelId: string, userIds: string[]): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `removeParticipant` | `removeParticipant(channelId: string, userId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `updateParticipantRole` | `updateParticipantRole(channelId: string, userId: string, role: ChannelRole): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `rename` | `rename(channelId: string, name: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `updateDescription` | `updateDescription(channelId: string, description: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `archive` | `archive(channelId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `unarchive` | `unarchive(channelId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `makePublic` | `makePublic(channelId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `toggleStarred` | `toggleStarred(channelId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `markAsViewed` | `markAsViewed(channelId: string, options?: { conversationId?: string; draftMessage?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `moveToSection` | `moveToSection(channelId: string, sectionId: string \| null, position: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `listSections` | `listSections(): Promise<ChannelSection[]>` | `POST /api/sdk/v1/query` |
| `createSection` | `createSection(data: { name: string; position: string; emoji?: string \| null; }): Promise<{ id: string; }>` | `POST /api/sdk/v1/mutate` |
| `updateSection` | `updateSection(id: string, data: { name?: string; emoji?: string \| null; isCollapsed?: boolean; position?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `removeSection` | `removeSection(id: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `closeDm` | `closeDm(channelId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `reopenDm` | `reopenDm(channelId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `promoteToChannel` | `promoteToChannel(data: { channelId: string; name: string; projectId: string; visibility: 'PUBLIC' \| 'PRIVATE'; description?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `markUnreadFrom` | `markUnreadFrom(channelId: string, messageId: string, options?: { conversationId?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `setAddUserPolicy` | `setAddUserPolicy(channelId: string, policy: ChannelAddUserPolicy): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `setCallSummaryPrompt` | `setCallSummaryPrompt(channelId: string, prompt: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `setSelectedBoard` | `setSelectedBoard(channelId: string, boardId: string \| null): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `setShowTicketsInChat` | `setShowTicketsInChat(channelId: string, show: boolean): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `getStatsForChannels` | `getStatsForChannels(channelIds: string[]): Promise<ChannelStats[]>` | `POST /api/sdk/v1/query` |
| `listParticipantsPaginated` | `listParticipantsPaginated(channelId: string, options?: { limit?: number; start?: { role: string; userId: string; }; }): Promise<ChannelParticipant[]>` | `POST /api/sdk/v1/query` |
| `listUserStatuses` | `listUserStatuses(channelId: string): Promise<ChannelUserStatus[]>` | `POST /api/sdk/v1/query` |
| `listWithMyConversations` | `listWithMyConversations(): Promise<Channel[]>` | `POST /api/sdk/v1/query` |

<details><summary>Notes (41)</summary>

- **`list`** — No params. Returns one per-user status row per visible channel, each with its `channel` relation joined — this is the sidebar shape (includes read state and starring). Not paginated.
- **`listAll`** — Returns raw Channel rows (no per-user read state), including closed channels. `updatedAt` is an epoch-ms filter: only channels changed after it. Differs from list(): list() returns ChannelUserStatus rows for visible channels; listAll() returns Channel objects for every channel the caller belongs to.
- **`listEmail`** — No params. Email-type (support desk) channels only, as status rows.
- **`listBrowsable`** — Public channels the user may join but has not. CLIENT-SIDE pagination only: the server has no cursor and returns every match in one response; the SDK fetches all and calls paginate() on it, so the full network cost is still paid. PageOptions = { limit?: number; offset?: number }; limit is clamped into [1, 100] (DEFAULT_LIMIT=MAX_LIMIT=100), offset floored at 0. Page<Channel> = { items, hasMore, total, nextOffset } — pass nextOffset back as offset for the next page.
- **`getStats`** — channelId required. Participant count and last-activity time. Returns null if the channel has no stats row yet.
- **`getUserStatus`** — channelId required. Caller's own read/star state row; null if the caller is not in the channel. Read `isStarred` from here before calling toggleStarred if you need a specific end state.
- **`listParticipants`** — channelId required. Unpaginated — returns every participant. For large channels prefer listParticipantsPaginated(), which has a real server-side cursor.
- **`searchParticipants`** — Both params required. Matches the text against participant names and email addresses.
- **`getMyParticipations`** — Batch read. Returns the caller's own participant row for each of the given channels they belong to (channels they aren't in are simply absent).
- **`listLinks`** — channelId required. Links shared in the channel. Not paginated.
- **`create`** — Direct REST route (not the query/mutate envelope). `data` is sent as the request body. Server-side transaction: creates the channel plus its stats row, creator membership and desk configuration. The registry's mapResult normalises the response to { id: raw.channelId ?? raw.id }. CreateChannelInput carries at least name / projectId / visibility ('PUBLIC' | 'PRIVATE') per the doc example.
- **`checkDuplicate`** — Direct REST route; both params required and sent as { name, projectId } in the body. Read-only despite being a POST. Returns whether the name is free plus the clashing channel if not — call before offering a create action.
- **`join`** — Mutator; returns void. Only valid for public channels.
- **`leave`** — Mutator; returns void. Removes the caller's own membership.
- **`addParticipants`** — Mutator; returns void. Batch add. The backend mutator also needs a participant id and a user-status id per user (Zero optimistic-write model); those id maps are generated inside the registry/mapArgs layer so SDK callers never supply them. Subject to the channel's add-user policy (see setAddUserPolicy).
- **`removeParticipant`** — Mutator; returns void. Removes one user (singular — unlike addParticipants, which is batch).
- **`updateParticipantRole`** — Mutator; returns void. SIDE EFFECT: posts a system message into the channel (the conversation/message ids for it are generated in the registry layer). role is the ChannelRole union, e.g. 'ADMIN'.
- **`rename`** — Mutator; returns void. Name must be 2-80 characters. The backend posts a system message for the rename (its ids are generated in the registry layer).
- **`updateDescription`** — Mutator; returns void. SIDE EFFECT: posts a system message into the channel.
- **`archive`** — Mutator; returns void. Hides the channel from default listings; reversible via unarchive().
- **`unarchive`** — Mutator; returns void. Restores an archived channel.
- **`makePublic`** — Mutator; returns void. ONE-WAY: there is no 'make private' operation in this API, so the visibility change is not reversible through the SDK.
- **`toggleStarred`** — Mutator; returns void. TOGGLE, not a setter — it flips the current value. To reach a specific end state, read `isStarred` from getUserStatus() first.
- **`markAsViewed`** — Mutator; returns void. Options are spread flat into the args alongside channelId. Marks read as of now; `conversationId` narrows it to a single thread, `draftMessage` preserves an unsent draft while marking read.
- **`moveToSection`** — Mutator; returns void. All three params are REQUIRED positionally — `position` is a required sort key even though the JSDoc only documents channelId and sectionId. Pass sectionId: null to ungroup the channel.
- **`listSections`** — No params. The caller's own sidebar sections, in display order.
- **`createSection`** — name and position are required. CLIENT-MINTED ID: the resource generates the id with newId() and sends it in the args, then returns { id } itself — mutators return nothing, so the id cannot come from the server. `position` is the sort key deciding placement.
- **`updateSection`** — Mutator; returns void. Partial update — omitted fields are left alone. `data` is spread flat next to `id` in the args.
- **`removeSection`** — Mutator; returns void. SIDE EFFECT: channels in the deleted section become ungrouped (they are not deleted).
- **`closeDm`** — Mutator; returns void. Hides a DM from the sidebar without losing its history; reversible via reopenDm().
- **`reopenDm`** — Mutator; returns void. Reopens a closed DM.
- **`promoteToChannel`** — Mutator; returns void (no new id is returned — the existing group DM's channelId is reused). channelId, name, projectId and visibility are all required; description optional. SIDE EFFECT: posts a system message announcing the conversion.
- **`markUnreadFrom`** — Mutator; returns void. channelId and messageId required; options spread flat into args. Marks the channel unread from `messageId` onwards; `conversationId` narrows it to one thread. Inverse of markAsViewed().
- **`setAddUserPolicy`** — Mutator; returns void. policy is the ChannelAddUserPolicy union — everyone vs admins only (e.g. 'ADMINS_ONLY'). Governs who may call addParticipants.
- **`setCallSummaryPrompt`** — Mutator; returns void. Sets the instruction applied when calls held in this channel are summarised.
- **`setSelectedBoard`** — Mutator; returns void. Pins a board to the channel's tickets tab; pass boardId: null to unpin.
- **`setShowTicketsInChat`** — Mutator; returns void. Explicit boolean setter (not a toggle) for whether ticket activity appears inline in chat.
- **`getStatsForChannels`** — Batch version of getStats(). Returns one row per channel that HAS a stats row — channels without one are omitted, so the result array may be shorter than the input and is not index-aligned.
- **`listParticipantsPaginated`** — REAL server-side cursor — preferred over listParticipants() for large channels. options are spread flat into args. `start` is a composite cursor { role, userId } taken from the last row of the previous page. Returns a bare ChannelParticipant[], NOT a Page<T>: there is no hasMore/total/nextOffset, so you page until you get fewer rows than `limit`. Contrast listBrowsable(), which returns Page<T> but paginates client-side.
- **`listUserStatuses`** — channelId required. Every member's status row for one channel (who has it open, starred, muted) — the per-channel counterpart to list(), which returns the caller's rows across channels.
- **`listWithMyConversations`** — No params. Channels in which the caller has an active thread/conversation. Returns Channel rows, not status rows. Not paginated.

</details>

## claw

Dispatch and poll Xyne Claw remote agents through the Spaces backend (which relays with its own service credential, so the Spaces API key is the only credential involved); optionally posts an agent's reply into a Spaces channel/DM.

| method | signature | route |
|---|---|---|
| `listAgents` | `listAgents(): Promise<ClawAgent[]>` | `GET /api/sdk/v1/claw/agents` |
| `run` | `run(input: ClawRunInput): Promise<{ sessionId: string; }>` | `POST /api/sdk/v1/claw/runs` |
| `getRun` | `getRun(sessionId: string): Promise<ClawRun>` | `GET /api/sdk/v1/claw/runs/{sessionId}` |
| `runAndWait` | `runAndWait(input: ClawRunAndWaitInput): Promise<ClawRun>` | `POST /api/sdk/v1/claw/runs then repeated GET /api/sdk/v1/claw/runs/{sessionId}` |

<details><summary>Notes (4)</summary>

- **`listAgents`** — No params. Direct API call (not a Zero catalog op). Registry mapResult coerces a non-array response to [], so it never returns null/undefined. ClawAgent = { id: string; slug: string; name: string; description: string; enabled: boolean; isDefault: boolean; color: string }. Use an agent's `slug` as the `agent` field for run()/runAndWait(). No pagination.
- **`run`** — ClawRunInput = { agent: string; task: string; conversationId?: string; channelId?: string; context?: string }. Required: `agent` (slug from listAgents) and `task`. Returns as soon as the run is queued — poll getRun() for the result. Side effects: passing `channelId` also posts the agent's reply into that Spaces channel or DM; `conversationId` continues an existing thread; `context` is prepended to the task. Input is sent verbatim as the POST body (no mapArgs).
- **`getRun`** — sessionId is required and URL-encoded into the path; registry mapArgs returns undefined so it is NOT also repeated as a query param. ClawRun = { sessionId: string; status: string; result?: string; error?: string }. `result` is set once `status` is terminal — terminal statuses are TERMINAL_RUN_STATUSES = ['completed','failed','cancelled','canceled','error'] (exported from dist/registry/claw.js). Throws NotFoundError if the session id is unknown. No pagination.
- **`runAndWait`** — Convenience wrapper, not a distinct endpoint. ClawRunAndWaitInput extends ClawRunInput with { timeoutMs?: number; onProgress?: (run: ClawRun) => void | Promise<void>; signal?: AbortSignal }. Those three fields are stripped before POSTing; the rest is passed to run(). Polls with exponential backoff: sleeps first (1000ms), then intervalMs = min(intervalMs * 1.5, 10000) per iteration; returns the run as soon as run.status is in TERMINAL_RUN_STATUSES, otherwise awaits onProgress(run). timeoutMs defaults to 300_000 (5 min); on expiry throws SdkError with code 'timeout' and a message containing the sessionId — the run itself keeps going, so getRun(sessionId) still works. If `signal` is already aborted at the top of a loop iteration it throws SdkError with code 'api_error' (message: `Stopped waiting for Claw run <sessionId>.`) — note the docs say 'timeout' only for the deadline case; abort uses 'api_error'. The abort is checked only between polls, not mid-request.

</details>

## conversations

Threads (conversations) inside a channel: listing/reading threads, thread-level membership (subscribe, participation, unread), pinning, labels/tags, and starting or forwarding a thread — individual messages live on sdk.messages.

| method | signature | route |
|---|---|---|
| `listByChannel` | `listByChannel(channelId: string, options?: { limit?: number; start?: ConversationCursor; isMember?: boolean; direction?: 'forward' \| 'backward'; }): Promise<Conversation[]>` | `POST /api/sdk/v1/query (body { op: "conversations.listByChannel", args })` |
| `listLatestByChannel` | `listLatestByChannel(channelId: string, options?: { limit?: number; isMember?: boolean; }): Promise<Conversation[]>` | `POST /api/sdk/v1/query (body { op: "conversations.listLatestByChannel", args })` |
| `get` | `get(conversationId: string): Promise<Conversation \| null>` | `POST /api/sdk/v1/query (body { op: "conversations.get", args })` |
| `getWithChannel` | `getWithChannel(conversationId: string, channelId: string, options?: { isMember?: boolean; }): Promise<Conversation \| null>` | `POST /api/sdk/v1/query (body { op: "conversations.getWithChannel", args })` |
| `getThread` | `getThread(conversationId: string, options?: { channelId?: string; isMember?: boolean; }): Promise<Conversation \| null>` | `POST /api/sdk/v1/query (body { op: "conversations.getThread", args })` |
| `getByCallId` | `getByCallId(callId: string): Promise<Conversation \| null>` | `POST /api/sdk/v1/query (body { op: "conversations.getByCallId", args })` |
| `getLatest` | `getLatest(channelId: string, options?: { isMember?: boolean; }): Promise<Conversation \| null>` | `POST /api/sdk/v1/query (body { op: "conversations.getLatest", args })` |
| `getMyParticipation` | `getMyParticipation(conversationId: string): Promise<ConversationParticipant \| null>` | `POST /api/sdk/v1/query (body { op: "conversations.getMyParticipation", args })` |
| `listPinned` | `listPinned(channelId: string, options?: { isMember?: boolean; }): Promise<Conversation[]>` | `POST /api/sdk/v1/query (body { op: "conversations.listPinned", args })` |
| `listLabels` | `listLabels(channelId: string): Promise<ConversationLabel[]>` | `POST /api/sdk/v1/query (body { op: "conversations.listLabels", args })` |
| `listAppliedLabels` | `listAppliedLabels(conversationId: string, channelId: string): Promise<ConversationLabelMapping[]>` | `POST /api/sdk/v1/query (body { op: "conversations.listAppliedLabels", args })` |
| `getByTimestamp` | `getByTimestamp(channelId: string, timestamp: number, options?: { isMember?: boolean; }): Promise<Conversation \| null>` | `POST /api/sdk/v1/query (body { op: "conversations.getByTimestamp", args })` |
| `listForUser` | `listForUser(userId: string, options?: { limit?: number; start?: { lastReplyAt: number; id: string; }; }): Promise<Conversation[]>` | `POST /api/sdk/v1/query (body { op: "conversations.listForUser", args })` |
| `create` | `create(data: { channelId: string; content: string; type?: MessageType; attachmentIds?: string[]; }): Promise<{ conversationId: string; messageId: string; }>` | `POST /api/sdk/v1/mutate (body { op: "conversations.create", args })` |
| `createWithAttachments` | `createWithAttachments(data: CreateConversationWithAttachmentsInput): Promise<{ conversationId: string; messageId: string; }>` | `POST /api/sdk/v1/channels/{channelId}/conversations (direct REST, multipart/form-data)` |
| `forwardMessage` | `forwardMessage(data: { targetChannelId: string; originalMessageId: string; optionalMessage?: string; }): Promise<{ conversationId: string; messageId: string; }>` | `POST /api/sdk/v1/mutate (body { op: "conversations.forwardMessage", args })` |
| `togglePin` | `togglePin(conversationId: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "conversations.togglePin", args })` |
| `subscribe` | `subscribe(conversationId: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "conversations.subscribe", args })` |
| `unsubscribe` | `unsubscribe(conversationId: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "conversations.unsubscribe", args })` |
| `markUnreadFrom` | `markUnreadFrom(conversationId: string, messageId: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "conversations.markUnreadFrom", args })` |
| `setTagTypes` | `setTagTypes(conversationId: string, types: string[], options?: { note?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "conversations.setTagTypes", args })` |

<details><summary>Notes (21)</summary>

- **`listByChannel`** — Server-side cursor pagination. `channelId` required; `start` is a ConversationCursor = { conversationId: string; lastActivityAt: number } taken from the last item of the previous page. `direction` is required server-side (registry comment) though optional in the TS type. `isMember` is an ACL hint, not a filter — it selects a cheaper ACL path and defaults to true server-side; leave unset unless you know otherwise. Returns one page, most recently active first. No listAll variant exists.
- **`listLatestByChannel`** — No paging — returns the most recent threads in one shot. `channelId` required. `isMember` is the same ACL hint as listByChannel.
- **`get`** — Returns null if the thread does not exist or is not visible. Useful to recover a thread's channelId, which listAppliedLabels requires.
- **`getWithChannel`** — Both conversationId and channelId are required positional params. Returns the thread with its channel attached (for rendering a thread view cold), or null.
- **`getThread`** — Returns the thread with its replies resolved, or null. channelId is optional here (pass it when known); isMember is the ACL hint.
- **`getByCallId`** — Looks up the thread attached to a call; null if the call has none.
- **`getLatest`** — Single most recent thread in a channel, or null when the channel has none.
- **`getMyParticipation`** — Despite the underlying query name, this returns ONE row scoped to the authenticated caller (filters on ctx.userID, ends in .one()) — not the thread's participant list; there is no catalog operation that returns all participants. Do not iterate the result. Carries subscription state, lastReadAt and lastReplyAt.
- **`listPinned`** — Unpaginated. Read this first if you need a specific pin end-state, since togglePin only flips.
- **`listLabels`** — Labels are per-channel and not shared across channels. The schema's isMember hint is supplied by the SDK, so callers do not pass it. Unpaginated.
- **`listAppliedLabels`** — channelId is REQUIRED (second positional param) as an ACL hint for the V2 query — get(conversationId) returns it if you only hold the thread id. Each mapping carries the label name. Unpaginated.
- **`getByTimestamp`** — timestamp is epoch milliseconds; finds the thread nearest that moment (jump-to-date). Null if the channel has no threads.
- **`listForUser`** — Cross-channel: threads the given user participates in, most recent reply first. Cursor shape here is { lastReplyAt: number; id: string } — different from ConversationCursor used by listByChannel. Get userId via sdk.users.me(). One page only; no listAll.
- **`create`** — Write / side effect: starts a new thread by posting its first message. channelId and content are required. The SDK mints both conversationId and messageId client-side (core/ids newId()) and passes them in args, then returns them — the ids exist even though the mutator returns void. attachmentIds come from sdk.attachments.uploadDraft; use createWithAttachments when bytes are not yet uploaded.
- **`createWithAttachments`** — Write / side effect. The only non-op (direct API) method on this resource: channelId is URL-encoded into the path and the body is a FormData carrying optional content, msgType, visibleTo plus the files (thumbnails included). Input type CreateConversationWithAttachmentsInput = { channelId: string; files: UploadFileInput[]; content?: string; msgType?: 'USER' | 'BOT'; visibleTo?: string | null } — channelId and files are required. Result is mapped from raw.initialMessage.messageId ?? raw.messageId and THROWS Error('Conversation response did not include a message id') if neither is present.
- **`forwardMessage`** — Write / side effect: creates a NEW thread in targetChannelId containing the forwarded message. targetChannelId and originalMessageId required. Like create, the SDK mints conversationId and messageId client-side and returns them.
- **`togglePin`** — Write / side effect. Toggles rather than sets — there is no explicit target state, so read listPinned first if you need a deterministic end state. Calling twice is a no-op net effect.
- **`subscribe`** — Write / side effect: follows the thread so its replies land in the caller's activity feed.
- **`unsubscribe`** — Write / side effect: stops following the thread.
- **`markUnreadFrom`** — Write / side effect: marks the thread unread starting at messageId (that message and everything after). Both params required.
- **`setTagTypes`** — Write / side effect and DESTRUCTIVE: replaces the thread's entire tag set, so send every tag you want to keep. Tags are free-form (projects define vocabulary beyond the built-in one), each up to 40 characters. `note` explains a newly invented tag and is stored against the vocabulary candidate, not on the thread.

</details>

## messages

Reading and writing individual messages inside existing threads/channels, plus reactions, attachments, saved drafts, and scheduled (delayed) sends — new threads are started with sdk.conversations.create, not here.

| method | signature | route |
|---|---|---|
| `listByConversation` | `listByConversation(conversationId: string, options?: PageOptions): Promise<Page<Message>>` | `POST /api/sdk/v1/query (body { op: "messages.listByConversation", args: { conversationId } })` |
| `getMany` | `getMany(messageIds: string[]): Promise<Message[]>` | `POST /api/sdk/v1/query (op "messages.getMany", args { messageIds })` |
| `get` | `get(messageId: string): Promise<Message \| null>` | `POST /api/sdk/v1/query (op "messages.get", args { messageId })` |
| `listByChannel` | `listByChannel(channelId: string, options?: PageOptions): Promise<Page<Message>>` | `POST /api/sdk/v1/query (op "messages.listByChannel", args { channelId })` |
| `listMine` | `listMine(options?: { limit?: number; start?: MessageCursor; }): Promise<Message[]>` | `POST /api/sdk/v1/query (op "messages.listMine", args = options ?? {})` |
| `listByUser` | `listByUser(options: { userId: string; limit?: number; offset?: number; /** Inclusive epoch-ms lower bound. */ after?: number; /** Inclusive epoch-ms upper bound. */ before?: number; }): Promise<Message[]>` | `GET /api/sdk/v1/search (the only ApiOperation on this resource — bypasses /query)` |
| `getLatestInChannel` | `getLatestInChannel(channelId: string): Promise<Message \| null>` | `POST /api/sdk/v1/query (op "messages.getLatestInChannel", args { channelId })` |
| `listNudges` | `listNudges(messageId: string, states?: NudgeState[]): Promise<Nudge[]>` | `POST /api/sdk/v1/query (op "messages.listNudges", args { messageId, ...(states ? { states } : {}) })` |
| `send` | `send(data: { conversationId: string; content: string; type?: MessageType; showInChannel?: boolean; attachmentIds?: string[]; }): Promise<{ messageId: string; }>` | `POST /api/sdk/v1/mutate (op "messages.send", args { messageId, ...data })` |
| `update` | `update(messageId: string, content: string): Promise<void>` | `POST /api/sdk/v1/mutate (op "messages.update", args { messageId, content })` |
| `delete` | `delete(messageId: string): Promise<void>` | `POST /api/sdk/v1/mutate (op "messages.delete", args { messageId })` |
| `addReaction` | `addReaction(messageId: string, emojiName: string): Promise<void>` | `POST /api/sdk/v1/mutate (op "messages.react", args { messageId, emojiName, action: 'add' })` |
| `removeReaction` | `removeReaction(messageId: string, emojiName: string): Promise<void>` | `POST /api/sdk/v1/mutate (op "messages.react", args { messageId, emojiName, action: 'remove' })` |
| `setShowInChannel` | `setShowInChannel(messageId: string, showInChannel: boolean): Promise<void>` | `POST /api/sdk/v1/mutate (op "messages.setShowInChannel", args { messageId, showInChannel })` |
| `closeSlashCommandArtifact` | `closeSlashCommandArtifact(messageId: string): Promise<void>` | `POST /api/sdk/v1/mutate (op "messages.closeSlashCommandArtifact", args { messageId })` |
| `deleteAttachment` | `deleteAttachment(attachmentId: string): Promise<void>` | `POST /api/sdk/v1/mutate (op "messages.deleteAttachment", args { attachmentId })` |
| `deleteAttachments` | `deleteAttachments(attachmentIds: string[]): Promise<void>` | `POST /api/sdk/v1/mutate (op "messages.deleteAttachments", args { attachmentIds })` |
| `listDrafts` | `listDrafts(options?: { limit?: number; }): Promise<DraftMessage[]>` | `POST /api/sdk/v1/query (op "messages.listDrafts", args = options ?? {})` |
| `editDraft` | `editDraft(id: string, content: string): Promise<void>` | `POST /api/sdk/v1/mutate (op "messages.editDraft", args { id, content })` |
| `sendDraft` | `sendDraft(id: string): Promise<void>` | `POST /api/sdk/v1/mutate (op "messages.sendDraft", args { id })` |
| `deleteDraft` | `deleteDraft(id: string): Promise<void>` | `POST /api/sdk/v1/mutate (op "messages.deleteDraft", args { id })` |
| `listScheduled` | `listScheduled(): Promise<DelayedMessage[]>` | `POST /api/sdk/v1/query (op "messages.listScheduled", args: undefined)` |
| `schedule` | `schedule(data: { channelId: string; content: string; scheduledFor: number; conversationId?: string; }): Promise<{ id: string; }>` | `POST /api/sdk/v1/mutate (op "messages.schedule", args { id, ...data })` |
| `cancelScheduled` | `cancelScheduled(id: string): Promise<void>` | `POST /api/sdk/v1/mutate (op "messages.cancelScheduled", args { id })` |
| `reschedule` | `reschedule(id: string, scheduledFor: number): Promise<void>` | `POST /api/sdk/v1/mutate (op "messages.reschedule", args { id, scheduledFor })` |
| `editScheduled` | `editScheduled(id: string, content: string): Promise<void>` | `POST /api/sdk/v1/mutate (op "messages.editScheduled", args { id, content })` |
| `sendScheduledNow` | `sendScheduledNow(id: string): Promise<void>` | `POST /api/sdk/v1/mutate (op "messages.sendScheduledNow", args { id })` |
| `scheduledToDraft` | `scheduledToDraft(id: string): Promise<void>` | `POST /api/sdk/v1/mutate (op "messages.scheduledToDraft", args { id })` |
| `getAttachments` | `getAttachments(attachmentIds: string[]): Promise<MessageAttachment[]>` | `POST /api/sdk/v1/query (op "messages.getAttachments", args { attachmentIds })` |
| `listAttachmentsForThread` | `listAttachmentsForThread(initialMessageId: string): Promise<MessageAttachment[]>` | `POST /api/sdk/v1/query (op "messages.listAttachmentsForThread", args { initialMessageId })` |
| `listChannelAttachments` | `listChannelAttachments(channelId: string, options?: { limit?: number; start?: { attachementId: string; createdAt: number; }; direction?: 'forward' \| 'backward'; }): Promise<MessageAttachment[]>` | `POST /api/sdk/v1/query (op "messages.listChannelAttachments", args { channelId, ...options })` |
| `listScheduledPaginated` | `listScheduledPaginated(options?: { limit?: number; statuses?: DelayedMessageStatus[]; start?: { id: string; scheduledFor: number; }; }): Promise<DelayedMessage[]>` | `POST /api/sdk/v1/query (op "messages.listScheduledPaginated", args = options ?? {})` |
| `addDraftAttachments` | `addDraftAttachments(data: { draftMessageId: string; channelId: string; attachments: Array<{ attachmentId: string; originalFilename: string; mimetype: string; size: number; width?: number; height?: number; }>; conversationId?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate (op "messages.addDraftAttachments", args = data verbatim)` |
| `clearDraft` | `clearDraft(channelId: string, options?: { conversationId?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate (op "messages.clearDraft", args { channelId, ...options })` |
| `handleNonParticipants` | `handleNonParticipants(data: { messageId: string; channelId: string; userIds: string[]; action: 'add' \| 'add_all' \| 'ignore' \| 'ignore_all'; }): Promise<void>` | `POST /api/sdk/v1/mutate (op "messages.handleNonParticipants", args = data verbatim)` |

<details><summary>Notes (35)</summary>

- **`listByConversation`** — conversationId required. NO server-side cursor: the server returns the ENTIRE thread in one response and the SDK windows it client-side via paginate(all, options). Network cost is the full thread regardless of limit. options.limit defaults to 100 (DEFAULT_LIMIT) and is clamped into [1, 100] (MAX_LIMIT) rather than rejected; options.offset floored at 0. Returns Page<Message> = { items, hasMore, total, nextOffset }; paginate for the next page with { offset: page.nextOffset }. Oldest first.
- **`getMany`** — Batch fetch by id. Unknown or non-visible ids are silently skipped, so the result array may be shorter than the input and is not index-aligned.
- **`get`** — Returns null (not a throw) when the message does not exist or is not visible to the caller.
- **`listByChannel`** — Top-level channel messages plus thread replies promoted into the channel via 'also send to channel'. Same client-side windowing as listByConversation: full history is fetched then paginate()d; limit defaults to 100 and is clamped to a max of 100. Returns Page<Message>.
- **`listMine`** — Caller's own sent messages, newest first. TRUE server-side cursor pagination: MessageCursor = { messageId: string; createdAt: number } from registry/messages.d.ts; pass the last row's cursor as options.start for the next page. Returns a bare array, not a Page.
- **`listByUser`** — options.userId required; options itself is required (no default). Backed by Vespa search, equivalent to cmd+k's `from:@xyz` filter. mapArgs sends q:'' , from:userId, type:'messages', orderBy:'newest', limit (default 50), offset (default 0), and converts after/before from epoch-ms to ISO YYYY-MM-DD via toISOString().split('T')[0] — so the bounds are day-granular, not ms-granular, despite the ms input. Offset-based pagination (limit/offset), newest first. Read ACL still applies. IMPORTANT: mapResult synthesizes Message objects from search hits, so many fields are placeholders — workspaceId '', childConversationId null, hasAttachment false, edited false, isDeleted false, showInChannel false, visibleTo null, isSent true, nudgeCount null, metadata {}, and conversationId/senderId fall back to '' and content to '' when searchContext is missing. Do not trust these fields; re-fetch via get/getMany if you need real values.
- **`getLatestInChannel`** — Returns null when the channel has no messages.
- **`listNudges`** — messageId required. `states` is omitted from the payload entirely when not supplied, letting the server apply its default of active nudges only.
- **`send`** — WRITE. Replies into an EXISTING thread — use sdk.conversations.create to start a new one. conversationId and content are required. The SDK mints the messageId client-side with newId() (crypto.randomUUID) before the call and returns it, so the id is known even though the mutator returns void. attachmentIds come from sdk.attachments.uploadDraft. showInChannel also surfaces the reply in the parent channel (server generates a child conversation id for that case).
- **`update`** — WRITE. Replaces the message body wholesale; both params required. Resolves to void.
- **`delete`** — WRITE / destructive. Resolves to void.
- **`addReaction`** — WRITE. Shares the single `messages.react` operation with removeReaction, differing only in the injected action field. emojiName is the short name WITHOUT colons, e.g. 'thumbsup'.
- **`removeReaction`** — WRITE. Removes only the caller's own reaction. emojiName without colons.
- **`setShowInChannel`** — WRITE. Toggles whether a thread reply is also visible in the parent channel. Both params required (boolean is explicit, not optional).
- **`closeSlashCommandArtifact`** — WRITE. Closes the incident artifact on a slash-command message. NOT idempotent: author-only, and only while the artifact is still ACTIVE — a second call on an already-closed artifact is refused by the server. The close timestamp is stamped server/registry-side.
- **`deleteAttachment`** — WRITE / destructive. Takes the attachment id, not the message id.
- **`deleteAttachments`** — WRITE / destructive. Batch form of deleteAttachment; one round trip for many ids.
- **`listDrafts`** — Caller's own unsent drafts. Only `limit` is supported — there is no cursor or offset, so this cannot page beyond the first `limit` rows.
- **`editDraft`** — WRITE. `id` is the draft id.
- **`sendDraft`** — WRITE / side effect: posts the draft as a real message immediately and consumes the draft. Returns void — the resulting message id is not surfaced (unlike send).
- **`deleteDraft`** — WRITE / destructive. Discards the draft without sending.
- **`listScheduled`** — No params at all — the args field is literally undefined (registry types it as SdkOperation<void, DelayedMessage[]>). Returns every scheduled message for the caller, unpaged. Use listScheduledPaginated when you need paging or a status filter.
- **`schedule`** — WRITE. channelId, content and scheduledFor are required; scheduledFor is epoch MILLISECONDS (e.g. Date.now() + 60_000). conversationId only when the scheduled message is a thread reply. Like send, the SDK mints the row id client-side with newId() and returns { id } even though the mutator itself returns void.
- **`cancelScheduled`** — WRITE. `id` is the scheduled/delayed message id returned by schedule().
- **`reschedule`** — WRITE. scheduledFor is epoch milliseconds.
- **`editScheduled`** — WRITE. Changes only the body; use reschedule to change the send time.
- **`sendScheduledNow`** — WRITE / side effect: sends immediately instead of waiting for scheduledFor, consuming the scheduled row.
- **`scheduledToDraft`** — WRITE / side effect: converts a scheduled message back into an editable draft, so it will no longer auto-send. Returns void — the new draft's id is not surfaced; re-read with listDrafts.
- **`getAttachments`** — Batch fetch by attachment id; only attachments that exist come back, so the array may be shorter than the input.
- **`listAttachmentsForThread`** — Takes the thread's FIRST message id, not the conversation id. Returns only the files attached to that initial message.
- **`listChannelAttachments`** — channelId required; newest first. Cursor pagination via options.start — note the cursor key is misspelled `attachementId` (sic) in both the .d.ts and the registry, so it must be spelled that way. `direction` ('forward' | 'backward') is optional in the types but the registry doc says it is REQUIRED server-side and that omitting it previously made every call fail validation — pass it explicitly. The doc comment mentions an `options.isMember` ACL hint that does not exist in the actual signature.
- **`listScheduledPaginated`** — Server-side cursor variant of listScheduled: page with start = { id, scheduledFor } from the previous page's last row, and optionally filter by DelayedMessageStatus[] (e.g. ['PENDING']). Returns a bare array, not a Page.
- **`addDraftAttachments`** — WRITE. draftMessageId, channelId and attachments are required; conversationId only for thread drafts. Files must already be uploaded — the caller supplies the full metadata per attachment (attachmentId, originalFilename, mimetype, size, with width/height optional for images). The whole `data` object is passed through unmodified.
- **`clearDraft`** — WRITE. Clears the draft body for a channel, or for a thread within it when conversationId is supplied. Distinct from deleteDraft, which takes a draft id.
- **`handleNonParticipants`** — WRITE / side effect: 'add' or 'add_all' actually admits the mentioned users into the channel; 'ignore' / 'ignore_all' only dismisses the prompt. All four fields required; data is passed through unmodified.

</details>

## projects

Workspace projects — the container that groups boards, tickets, tags, canvases and applications; a project's `code` prefixes its ticket keys (PLAT → PLAT-1234). Read/update/delete only: projects are provisioned outside this API, so there is no create method.

| method | signature | route |
|---|---|---|
| `list` | `list(): Promise<Project[]>` | `POST /api/sdk/v1/query` |
| `listLite` | `listLite(): Promise<Project[]>` | `POST /api/sdk/v1/query` |
| `get` | `get(projectId: string): Promise<Project \| null>` | `POST /api/sdk/v1/query` |
| `getMany` | `getMany(projectIds: string[]): Promise<Project[]>` | `POST /api/sdk/v1/query` |
| `listTags` | `listTags(projectId: string): Promise<ProjectTag[]>` | `POST /api/sdk/v1/query` |
| `listFieldDefinitions` | `listFieldDefinitions(projectId: string): Promise<TicketFieldDefinition[]>` | `POST /api/sdk/v1/query` |
| `listCanvasFolders` | `listCanvasFolders(projectId: string): Promise<CanvasFolder[]>` | `POST /api/sdk/v1/query` |
| `listApplications` | `listApplications(projectId: string): Promise<Application[]>` | `POST /api/sdk/v1/query` |
| `listReleaseTickets` | `listReleaseTickets(projectId: string): Promise<Ticket[]>` | `POST /api/sdk/v1/query` |
| `listRecaps` | `listRecaps(recapDate: number): Promise<Recap[]>` | `POST /api/sdk/v1/query` |
| `update` | `update(projectId: string, data: { name?: string; description?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `delete` | `delete(projectId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `saveReleaseBoardConfig` | `saveReleaseBoardConfig(data: { projectId: string; mainBoardId: string; mainBoardName: string; vcsProvider: string; releaseTrackingMode: string; channelId: string; applications: unknown[]; }): Promise<void>` | `POST /api/sdk/v1/mutate` |

<details><summary>Notes (13)</summary>

- **`list`** — No params. Returns every project the caller can see, with all fields, in one response. No server-side pagination and no listAll variant — the full array always comes back; window it client-side with `paginate()` from dist/core/paginate.js if needed (DEFAULT_LIMIT 100, MAX_LIMIT 100).
- **`listLite`** — No params. Same Project[] type as list() but the server returns only identifying fields — cheaper; intended for pickers/dropdowns. Callers must not rely on non-identifying fields being populated. Unpaginated.
- **`get`** — `projectId` required. Resolves to null (not an error/throw) when the project does not exist or is not visible to the caller.
- **`getMany`** — `projectIds` required. Unknown or invisible ids are silently skipped rather than erroring, so the result may be shorter than the input. Order is not guaranteed to match the input array.
- **`listTags`** — `projectId` required. Tags belong to exactly one project and are never shared across projects, so this is the only way to enumerate them.
- **`listFieldDefinitions`** — `projectId` required. Returns the custom-field definitions available to that project's tickets; each definition names a merchant or gateway.
- **`listCanvasFolders`** — `projectId` required. Project-level folders only — canvas folders owned by a channel are excluded. Returned ordered by name.
- **`listApplications`** — `projectId` required. Applications registered against the project for release tracking, including their deployed version. Pairs with saveReleaseBoardConfig, which registers them.
- **`listReleaseTickets`** — `projectId` required. Filtered server-side to unarchived tickets of type `Release`; archived releases are never returned. Unpaginated.
- **`listRecaps`** — `recapDate` required, as epoch **milliseconds** (e.g. Date.now()) — not seconds and not an ISO string. Scoped to the caller: returns only project recaps written for the authenticated user on that day. Note this method takes no projectId — it spans the caller's projects.
- **`update`** — Mutation. `projectId` required; both `data` fields optional and merged — omitted fields are left unchanged (partial update, not a replace). The client flattens data into the args object: { projectId, name?, description? }. Returns void; the transport still unwraps `response.generated ?? response` for mutators.
- **`delete`** — Destructive mutation, no confirmation flag and no soft-delete/archive variant on this resource. `projectId` required. Deletes the project that groups boards, tickets, tags and canvases — confirm intent before calling.
- **`saveReleaseBoardConfig`** — Mutation; configures release tracking for a project. ALL seven fields are required — none is optional, including `applications` (pass [] for none). `data` is sent as the args object unchanged. `vcsProvider` e.g. 'github'; `releaseTrackingMode` e.g. 'tag'; `channelId` is the channel that receives release notifications; `applications` is typed `unknown[]` and passed through to the provider unchanged (no client-side validation). Side effect: wires up release notifications and determines what listApplications/listReleaseTickets subsequently return.

</details>

## search

Full-text and filtered search across the workspace (messages, tickets, files, channels, calls, users), backed by Vespa via direct REST endpoints rather than Zero query ops; exposed on SpacesClient as `client.search` (readonly search: SearchResource).

| method | signature | route |
|---|---|---|
| `query` | `query(options?: SearchOptions): Promise<SearchResponse>` | `GET /api/sdk/v1/search` |
| `getSchema` | `getSchema(schema: SearchSchemaName): Promise<string>` | `GET /api/sdk/v1/search/schema` |

<details><summary>Notes (2)</summary>

- **`query`** — All params optional; defaults to `{}` in the implementation, so `q` may be omitted to search by filters alone. Registry `mapArgs` whitelists exactly the keys the server's `searchQuerySchema` accepts — unknown query params are REJECTED (validation_failed), not ignored. Array-valued filters (type, apps, from, withUser, fromEmail, toEmail, in, mentions, channelMentions, projectId, status, ticketId) are joined into comma-separated strings by an internal `csv()` helper; `undefined`/`null` values are dropped by HttpClient.buildUrl so nothing empty is sent. `in` is the channel filter; deprecated `channelId` is mapped as a fallback alias (`in: csv(args.in) ?? args.channelId`). `sortBy`/`sortOrder` are typed `never` — they never worked; use `orderBy: 'newest' | 'oldest' | 'relevance'` (default is relevance). Pagination is server-side via `limit`/`offset` (NOT the client-side `paginate()` helper — there is no listAll variant on this resource); the response echoes `offset`, `limit`, and `totalCount`. Results are grouped by default (`grouped: true`, `groups: SearchGroup[]`); pass `groupBy: ''` to get one flat ranked `results: SearchResult[]`. Note the two vocabularies: request-side `SearchType` is plural ('messages' | 'attachments' | 'calls' | 'channels' | 'tickets' | 'users' | 'files' | 'canvas' | 'transcript' | 'rca' | 'people' | 'emails') while `SearchResult.type` is singular ('user' | 'conversation' | 'channel' | 'ticket' | 'attachment' | 'collection' | 'call') — feeding a result type back into `options.type` fails validation. `SearchApp` = 'chat' | 'ticket' | 'user' | 'file' | 'collection' | 'mail' | 'xyneapp' | 'call'. Full SearchOptions fields: q, type, apps, subApp ('canvas'|'transcript'|'recording'|'rca'|'collections'), limit, offset, orderBy, groupBy, from, withUser, fromEmail, toEmail, in, mentions, channelMentions, projectId, status, ticketId, priority, board, tags, stage, assignee, before, after, on, range, created, callStatus, callType, callStartsAt, callEndsAt, includeBotMessages, onlyMyChannels, channelId (deprecated), sortBy/sortOrder (never). Read-only, no side effects.
- **`getSchema`** — `schema` is REQUIRED and is a positional argument; the implementation wraps it as `{ schema }` and, because the registry op has no `mapArgs`, it is sent verbatim as the query string — i.e. GET /api/sdk/v1/search/schema?schema=<name>. Returns the index definition as raw text in Vespa's schema format (a plain string, not JSON). `SearchSchemaName` = 'chat_message' | 'chat_attachment' | 'chat_container' | 'ticket' | 'user' | 'file' | 'sam_transcript' | 'mail' | 'mail_attachment' | 'project' | 'memory' | 'call' — an index-name vocabulary distinct from `SearchOptions.type`. Use it to discover supported fields before building a field-specific query. Read-only, no pagination, no side effects.

</details>

## tickets

Work-tracking tickets and everything hanging off one — sub-tickets, project tags, cross-ticket references, stage-approval requests/transitions, and per-user desk mailbox state (the support-desk email view of the same rows lives on sdk.supportTickets).

| method | signature | route |
|---|---|---|
| `create` | `create(data: CreateTicketInput): Promise<CreateTicketResponse>` | `POST /api/sdk/v1/tickets` |
| `list` | `list(options: { viewMode: TicketViewMode; projectId?: string; boardId?: string; userId?: string; groupId?: string; formEntityValueFieldIds?: string[]; }): Promise<Ticket[]>` | `POST /api/sdk/v1/query (body { op: "tickets.list", args })` |
| `listKanban` | `listKanban(options: { viewMode: TicketViewMode; stageName?: string; columnType?: KanbanColumnType; limit?: number; start?: TicketCursor \| null; dir?: 'forward' \| 'backward'; projectId?: string; boardId?: string; userId?: string; groupId?: string; filters?: KanbanTicketFilters; formEntityValueFieldIds?: string[]; showOverdueOnly?: boolean; overdueReferenceTime?: number; excludeFlowSteps?: boolean; }): Promise<Ticket[]>` | `POST /api/sdk/v1/query (body { op: "tickets.listKanban", args })` |
| `listByChannelInWindow` | `listByChannelInWindow(options: { channelId: string; createdAtStart: number; createdAtEnd: number; isMember?: boolean; }): Promise<Ticket[]>` | `POST /api/sdk/v1/query (body { op: "tickets.listByChannelInWindow", args })` |
| `get` | `get(ticketId: string): Promise<Ticket \| null>` | `POST /api/sdk/v1/query (body { op: "tickets.get", args: { ticketId } })` |
| `getDetails` | `getDetails(ticketId: string): Promise<Ticket \| null>` | `POST /api/sdk/v1/query (body { op: "tickets.getDetails", args: { ticketId } })` |
| `getByKey` | `getByKey(xyneId: string, workspaceId: string): Promise<Ticket \| null>` | `POST /api/sdk/v1/query (body { op: "tickets.getByKey", args: { xyneId, workspaceId } })` |
| `getRow` | `getRow(ticketId: string): Promise<Ticket \| null>` | `POST /api/sdk/v1/query (body { op: "tickets.getRow", args: { ticketId } })` |
| `getMany` | `getMany(ticketIds: string[]): Promise<Ticket[]>` | `POST /api/sdk/v1/query (body { op: "tickets.getMany", args: { ticketIds } })` |
| `search` | `search(options?: { search?: string; limit?: number; }): Promise<Ticket[]>` | `POST /api/sdk/v1/query (body { op: "tickets.search", args })` |
| `listByProject` | `listByProject(projectId: string, options?: PageOptions): Promise<Page<Ticket>>` | `POST /api/sdk/v1/query (body { op: "tickets.listByProject", args: { projectId } })` |
| `listExports` | `listExports(): Promise<TicketExport[]>` | `POST /api/sdk/v1/query (body { op: "tickets.listExports", args: undefined })` |
| `listActivities` | `listActivities(ticketId: string, options?: PageOptions): Promise<Page<TicketActivity>>` | `POST /api/sdk/v1/query (body { op: "tickets.listActivities", args: { ticketId } })` |
| `listActivitiesForTickets` | `listActivitiesForTickets(options: { ticketIds: string[]; limit?: number; start?: TicketActivityCursor; }): Promise<TicketActivity[]>` | `POST /api/sdk/v1/query (body { op: "tickets.listActivitiesForTickets", args })` |
| `listAssignments` | `listAssignments(ticketId: string): Promise<TicketAssignment[]>` | `POST /api/sdk/v1/query (body { op: "tickets.listAssignments", args: { ticketId } })` |
| `getWorkflow` | `getWorkflow(ticketId: string): Promise<Workflow \| null>` | `POST /api/sdk/v1/query (body { op: "tickets.getWorkflow", args: { ticketId } })` |
| `listAttachments` | `listAttachments(ticketId: string): Promise<MessageAttachment[]>` | `POST /api/sdk/v1/query (body { op: "tickets.listAttachments", args: { ticketId } })` |
| `listEmails` | `listEmails(conversationId: string): Promise<Email[]>` | `POST /api/sdk/v1/query (body { op: "tickets.listEmails", args: { conversationId } })` |
| `getMailbox` | `getMailbox(ticketId: string, channelId: string): Promise<TicketMailbox \| null>` | `POST /api/sdk/v1/query (body { op: "tickets.getMailbox", args: { ticketId, channelId } })` |
| `getRca` | `getRca(ticketId: string): Promise<Rca \| null>` | `POST /api/sdk/v1/query (body { op: "tickets.getRca", args: { ticketId } })` |
| `listReleaseAttributions` | `listReleaseAttributions(ticketId: string): Promise<ReleaseAttribution[]>` | `POST /api/sdk/v1/query (body { op: "tickets.listReleaseAttributions", args: { ticketId } })` |
| `listFieldValues` | `listFieldValues(ticketId: string): Promise<TicketFieldDefinition[]>` | `POST /api/sdk/v1/query (body { op: "tickets.listFieldValues", args: { ticketId } })` |
| `update` | `update(id: string, data: { title?: string; description?: string; statusV2?: TicketStatusV2; priority?: TicketPriority; stageName?: string; assignedTo?: string; ticketType?: string; userGroupId?: string; boardId?: string; eta?: number; isArchived?: boolean; kanbanPosition?: string; metadata?: unknown; }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "tickets.update", args: { id, ...data } })` |
| `assign` | `assign(ticketId: string, assignedTo: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "tickets.assign", args: { ticketId, assignedTo } })` |
| `archive` | `archive(id: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "tickets.archive", args: { id } })` |
| `setStageEta` | `setStageEta(id: string, stageEta: number, options?: { ticketId?: string; stageId?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "tickets.setStageEta", args: { id, stageEta, ...options } })` |
| `listSubTickets` | `listSubTickets(ticketId: string): Promise<SubTicket[]>` | `POST /api/sdk/v1/query (body { op: "tickets.listSubTickets", args: { ticketId } })` |
| `listSubTicketMappings` | `listSubTicketMappings(ticketIds: string[]): Promise<SubTicketMapping[]>` | `POST /api/sdk/v1/query (body { op: "tickets.listSubTicketMappings", args: { ticketIds } })` |
| `getSubTickets` | `getSubTickets(subTicketIds: string[]): Promise<SubTicket[]>` | `POST /api/sdk/v1/query (body { op: "tickets.getSubTickets", args: { subTicketIds } })` |
| `createSubTicket` | `createSubTicket(data: { ticketId: string; title: string; description?: string; conversationId?: string; }): Promise<{ subTicketId: string; mappingId: string; }>` | `POST /api/sdk/v1/mutate (body { op: "tickets.createSubTicket", args: { subTicketId, mappingId, ...data } })` |
| `updateSubTicket` | `updateSubTicket(subTicketId: string, data: { assignedTo?: string; mappedTicketId?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "tickets.updateSubTicket", args: { subTicketId, ...data } })` |
| `listProjectTags` | `listProjectTags(projectId: string): Promise<ProjectTag[]>` | `POST /api/sdk/v1/query (body { op: "tickets.listProjectTags", args: { projectId } })` |
| `addTag` | `addTag(ticketId: string, projectId: string, tagName: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "tickets.addTag", args: { ticketId, projectId, tagName } })` |
| `removeTag` | `removeTag(tagId: string, mappingId: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "tickets.removeTag", args: { tagId, mappingId } })` |
| `addReference` | `addReference(sourceTicketId: string, targetTicketId: string, relationType: TicketReferenceRelation): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "tickets.addReference", args: { sourceTicketId, targetTicketId, relationType } })` |
| `updateReference` | `updateReference(id: string, relationType: TicketReferenceRelation): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "tickets.updateReference", args: { id, relationType } })` |
| `removeReference` | `removeReference(id: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "tickets.removeReference", args: { id } })` |
| `listStageRequests` | `listStageRequests(ticketId: string): Promise<TicketStageRequest[]>` | `POST /api/sdk/v1/query (body { op: "tickets.listStageRequests", args: { ticketId } })` |
| `listOpenStageRequests` | `listOpenStageRequests(stageId: string): Promise<TicketStageRequest[]>` | `POST /api/sdk/v1/query (body { op: "tickets.listOpenStageRequests", args: { stageId } })` |
| `upsertStageRequest` | `upsertStageRequest(data: { id?: string; ticketId: string; stageId: string; status: StageRequestStatus; updatedBy: string; formId?: string; reviewedBy?: string; comment?: string; }): Promise<{ id: string; }>` | `POST /api/sdk/v1/mutate (body { op: "tickets.upsertStageRequest", args: { ...data, id } })` |
| `deleteStageRequests` | `deleteStageRequests(ticketId: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "tickets.deleteStageRequests", args: { ticketId } })` |
| `transitionStage` | `transitionStage(ticketId: string, toStageName: string, options?: { formValuesJson?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "tickets.transitionStage", args: { ticketId, toStageName, ...options } })` |
| `setMailboxState` | `setMailboxState(data: { id: string; ticketId: string; channelId: string; state: MailboxState; }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "tickets.setMailboxState", args: data })` |
| `setMailboxStarred` | `setMailboxStarred(data: { id: string; ticketId: string; channelId: string; starred: boolean; }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "tickets.setMailboxStarred", args: data })` |
| `listSubTicketsByMapped` | `listSubTicketsByMapped(mappedTicketId: string): Promise<SubTicket[]>` | `POST /api/sdk/v1/query (body { op: "tickets.listSubTicketsByMapped", args: { mappedTicketId } })` |
| `getSubTicketByMapped` | `getSubTicketByMapped(mappedTicketId: string): Promise<SubTicket \| null>` | `POST /api/sdk/v1/query (body { op: "tickets.getSubTicketByMapped", args: { mappedTicketId } })` |

<details><summary>Notes (46)</summary>

- **`create`** — The only direct REST route on this resource (all other methods go through /query or /mutate). title, description and projectId are required. If data.files is non-empty, mapArgs builds a multipart FormData (scalars via appendOptional; tags, excludedChatAttachmentIds, draftAttachmentIds via appendArray; files via appendFiles) and uploads in the same request; otherwise the plain JSON fields are sent. Result is passed through unnarrowed so server-decided stageName and status survive. Side effect: allocates the ticket key via the server-side sequence allocator and starts the ticket workflow.
- **`list`** — viewMode is required and selects both the scope and which id is read: 'project'->projectId, 'board'->boardId, 'user-tickets'->userId, 'group-tickets'->groupId, 'my-tickets'->none. No pagination — returns the whole view. Unlike listKanban, rows include the stageEtaEntries relation.
- **`listKanban`** — Real server-side cursor pagination: pass the previous page's last item as start ({ id, createdAt }: TicketCursor), with dir 'forward' | 'backward' and limit. viewMode required; stageName narrows to one board column, '' (the default sentinel) means every stage. All filtering belongs inside filters (KanbanTicketFilters: priority, assignee, userGroups, createdBy, prReviewers, qaAssigned, dueDateStart/End, createdDateStart/End, boards, tags, assigned, created, stages, ticketTypes, sourceChannels, roleAssignments). Rows carry a precomputed isStageOverdue and omit the stageEtaEntries relation. Top-level searchQuery/statusFilter/assignedToFilter/createdByFilter/workflowTypeFilter are not accepted — the server strips them silently.
- **`listByChannelInWindow`** — channelId, createdAtStart and createdAtEnd required; timestamps are epoch ms and both ends inclusive. The server rejects createdAtStart > createdAtEnd rather than returning an empty list. isMember is an ACL hint required by the schema but unread by the query body — leave unset. Newest first, no pagination.
- **`get`** — Common relations resolved (project, tags, assignments, references, stage data). Returns null when missing or not visible. Use getRow for a cheaper bare-row read, getDetails for the fullest read.
- **`getDetails`** — Fullest read: project, board, tags, assignments, references and stage data all resolved. Returns null if absent.
- **`getByKey`** — Both args required. xyneId is the human-readable key (e.g. 'PLAT-1234'); workspaceId comes from sdk.users.me(). Returns null for an unknown key.
- **`getRow`** — Bare ticket row, no relations resolved — cheaper than get. Returns null if absent.
- **`getMany`** — Batch read by id. Unknown or invisible ids are silently skipped, so the result may be shorter than the input.
- **`search`** — Free-text match against ticket titles only. options is optional; the resource sends `options ?? {}`. limit caps results; no cursor.
- **`listByProject`** — Client-side pagination only: the SDK fetches every ticket in the project in one response and windows it with paginate(). PageOptions = { limit?, offset? }; limit defaults to 100 and is clamped to [1, 100]. Returns Page<Ticket> = { items, hasMore, total, nextOffset } — pass nextOffset back as offset. The full network cost is paid on every page; for filtered, view-scoped listing use list() or listKanban() instead.
- **`listExports`** — No arguments (args is sent as undefined). Returns the calling user's own export requests with each one's status, newest first; the server caps the list at 100.
- **`listActivities`** — Client-side pagination only: the ticket's whole history returns in one response and the SDK windows it with paginate(). limit defaults to 100, clamped to [1, 100]; newest first. Returns Page<TicketActivity> = { items, hasMore, total, nextOffset }. For several tickets with a real server-side cursor use listActivitiesForTickets.
- **`listActivitiesForTickets`** — Batch counterpart to listActivities with true server-side cursor paging: pass the last row's { timestamp, id } (TicketActivityCursor) back as start. ticketIds required. Newest first. start is nullable rather than optional server-side, so it is always sent — null on the first page.
- **`listAssignments`** — Full assignment history including past assignments; one row per assignment with the assignee's responsibility.
- **`getWorkflow`** — The server query omits .one(), so the registry applies mapResult: firstOrNull — the SDK returns the first row or null rather than an array.
- **`listAttachments`** — Files attached to the ticket. No pagination.
- **`listEmails`** — Takes the desk ticket's conversation/thread id, not a ticketId. Emails come back oldest first.
- **`getMailbox`** — Both args required — the V2 query takes channelId as an ACL hint for Zero (every ticket read returns it); isMember is supplied by the registry. mapResult: firstOrNull, so a single row or null. Returns null when the ticket is not in the caller's mailbox.
- **`getRca`** — Root-cause analysis linked to the ticket, or null if none is linked.
- **`listReleaseAttributions`** — Releases the ticket has been attributed to, each row carrying a confidence.
- **`listFieldValues`** — Custom-field values set on the ticket, each naming a merchant or gateway.
- **`update`** — The single broad write path for tickets — title, description, statusV2, priority, stage, assignee, ticketType, owning group, board, eta (epoch ms), archive state, kanban sort key and metadata all go through it. Omitted fields are left alone. id is merged into the args alongside data.
- **`assign`** — Both args required; assignedTo is a user id. Overlaps update({ assignedTo }) but is the dedicated reassignment mutator.
- **`archive`** — Hides the ticket from default listings. Registry describes it as archiving a desk ticket; to restore, use update(id, { isArchived: false }).
- **`setStageEta`** — id is the id of the stage-ETA row (not the ticket); stageEta is epoch ms. ticketId/stageId are optional and spread into the args.
- **`listSubTickets`** — Sub-tickets of one parent ticket. For many parents at once use listSubTicketMappings.
- **`listSubTicketMappings`** — Batch version of listSubTickets. Returns the mapping rows (each carrying its sub-ticket) rather than bare sub-tickets, so a caller batching many parents can tell which parent each sub-ticket belongs to.
- **`getSubTickets`** — Batch read of sub-tickets by their own ids. Unknown ids are silently skipped.
- **`createSubTicket`** — ticketId (parent) and title required. Client-generated ids: the resource mints subTicketId and mappingId with newId() before the call and returns them, so the mutator itself resolves to void. Creates both the sub-ticket row and its mapping to the parent.
- **`updateSubTicket`** — Only assignedTo and mappedTicketId can be changed; omitted fields are left alone.
- **`listProjectTags`** — Tags defined on a project and therefore available to its tickets.
- **`addTag`** — All three args required. Side effect: creates the project tag if tagName is new — the tag, project-tag and mapping row ids are all generated server-side inside the mutator, so none are returned.
- **`removeTag`** — Needs both the project tag id and the row linking it to this ticket; read mappingId from the ticket's tagMappings.
- **`addReference`** — Directional link from source to target (e.g. 'DUPLICATE_CONFIRMED', 'LINKED'). All three args required; the new reference id is not returned.
- **`updateReference`** — id is the reference row's id, not a ticket id.
- **`removeReference`** — Deletes the link between two tickets; id is the reference row's id.
- **`listStageRequests`** — All stage-approval requests raised for the ticket, both decided and outstanding.
- **`listOpenStageRequests`** — Scoped by stage id (not ticket id); returns only requests still waiting on that stage.
- **`upsertStageRequest`** — Raise (omit id) or decide (pass an existing id) a stage-approval request. ticketId, stageId, status and updatedBy are required; updatedBy must be the acting user's id (from sdk.users.me()) because the mutator records it as an argument instead of reading the session. The resource fills a client-generated id via newId() when none is supplied and returns { id }; the underlying mutator returns void.
- **`deleteStageRequests`** — Destructive: clears every stage-approval request on the ticket, not just open ones.
- **`transitionStage`** — For non-linear boards: runs the board's transition rules, which may demand an approval or a completed form — pass serialised form values as formValuesJson when required. Distinct from update(id, { stageName }), which sets the stage without running the rules.
- **`setMailboxState`** — All four fields required; id is the existing mailbox row's id (read it via getMailbox), channelId is the desk channel. Affects only the calling user's mailbox (inbox / archived / spam).
- **`setMailboxStarred`** — All four fields required; id is the mailbox row's id. Per-caller state only.
- **`listSubTicketsByMapped`** — Looks up by the mapped ticket (the ticket sub-tickets are linked to), not the parent — different axis from listSubTickets.
- **`getSubTicketByMapped`** — Singular counterpart to listSubTicketsByMapped; returns null when nothing is linked.

</details>

## users

The workspace directory, user profiles, and the identity the client's credential acts as (exposed on SpacesClient as `client.users`, class `UsersResource`).

| method | signature | route |
|---|---|---|
| `me` | `me(): Promise<CurrentUser>` | `GET /api/sdk/v1/me` |
| `list` | `list(options?: { updatedAt?: number; } & PageOptions): Promise<Page<User>>` | `POST /api/sdk/v1/query` |
| `listBasic` | `listBasic(options?: { updatedAt?: number; } & PageOptions): Promise<Page<User>>` | `POST /api/sdk/v1/query` |
| `getProfiles` | `getProfiles(userIds: string[]): Promise<UserProfile[]>` | `POST /api/sdk/v1/query` |
| `getProfile` | `getProfile(userId: string): Promise<UserProfile \| null>` | `POST /api/sdk/v1/query` |

<details><summary>Notes (5)</summary>

- **`me`** — The only direct REST route on this resource (registry: `api('GET', '/api/sdk/v1/me')`); every other method goes through the op-id query endpoint. No params. Server-side lookup, not a local token decode: `role`/`orgRole` are read from the DB on each call so they reflect current permissions - cache it yourself if called often, since the identity behind a credential does not change. Returns `{ id, email, name, displayName, workspaceId, orgId, memberId, role, orgRole, keyExpiresAt }`; `keyExpiresAt` (ISO 8601) lets a long-running process rotate before expiry. `id` is what every `userId` argument elsewhere in the API expects; `memberId` is required by some operations such as ticket stage approvals.
- **`list`** — All params optional. `updatedAt` is an epoch-ms timestamp filtered server-side (only users changed after it). Pagination is CLIENT-SIDE only: the server returns the entire workspace directory in one response and `paginate()` windows it locally, so a page does NOT save a round trip or network cost. There is no `listAll` on this resource - `list()` with no options already fetches everything and just hands back the first window. `limit` defaults to 100 and is clamped to [1, 100] (MAX_LIMIT) rather than rejected; `offset` defaults to 0 and is floored at 0. Returns `Page<User>` = `{ items, hasMore, total, nextOffset }`; pass `nextOffset` back as `offset` to walk on. Includes presence data - use `listBasic` if you don't need it.
- **`listBasic`** — Identical signature, args and client-side windowing to `list` (same `paginate()` call, same 100 default/max limit, same `Page<User>` shape), but the server omits presence data - cheaper when presence status is not needed. Same caveat: the full directory is fetched on every call regardless of `limit`/`offset`.
- **`getProfiles`** — `userIds` is REQUIRED (positional array, wrapped into `{ userIds }` before the call). Unknown ids are silently skipped, so the returned array may be shorter than the input and is not index-aligned with it - match results back by `id`. Not paginated.
- **`getProfile`** — `userId` is REQUIRED. Resolves to `null` (not a throw) when the user has no profile, so callers must null-check before reading fields such as `bio`. Registry declares result type `UserProfile | null`.

</details>

---

# Unbundled resources (full SDK)

## admin

Workspace and organization administration: workspaces, orgs and org members, workspace user roles, invitations, custom roles and their members, resource-level access grants, and installed/marketplace apps — exposed on SpacesClient as `sdk.admin` (client.d.ts:117, `readonly admin: AdminResource`).

| method | signature | route |
|---|---|---|
| `getWorkspace` | `getWorkspace(workspaceId: string): Promise<Workspace \| null>` | `POST /api/sdk/v1/query` |
| `updateWorkspace` | `updateWorkspace(workspaceId: string, updates: WorkspaceUpdate): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `listWorkspaceOrgs` | `listWorkspaceOrgs(workspaceId: string): Promise<WorkspaceOrganization[]>` | `POST /api/sdk/v1/query` |
| `listAvailableOrgs` | `listAvailableOrgs(): Promise<Organization[]>` | `POST /api/sdk/v1/query` |
| `createOrg` | `createOrg(data: { orgName: string; workspaceId: string; orgDescription?: string; }): Promise<{ orgId: string; workspaceOrgId: string; memberId: string; }>` | `POST /api/sdk/v1/mutate` |
| `addOrgToWorkspace` | `addOrgToWorkspace(workspaceId: string, orgId: string): Promise<{ id: string; }>` | `POST /api/sdk/v1/mutate` |
| `removeOrgFromWorkspace` | `removeOrgFromWorkspace(workspaceId: string, orgId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `listOrgMembers` | `listOrgMembers(orgId: string): Promise<OrgMember[]>` | `POST /api/sdk/v1/query` |
| `getOrgMember` | `getOrgMember(memberId: string): Promise<OrgMember \| null>` | `POST /api/sdk/v1/query` |
| `addOrgMember` | `addOrgMember(data: { orgId: string; email: string; role: OrgRole; }): Promise<{ memberId: string; }>` | `POST /api/sdk/v1/mutate` |
| `updateOrgMemberRole` | `updateOrgMemberRole(memberId: string, role: 'OWNER' \| 'ADMIN' \| 'MEMBER' \| 'VIEWER'): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `removeOrgMember` | `removeOrgMember(memberId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `updateUserRole` | `updateUserRole(workspaceId: string, userId: string, updates: WorkspaceUserUpdate): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `removeUser` | `removeUser(workspaceId: string, userId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `listInvitations` | `listInvitations(): Promise<Invitation[]>` | `POST /api/sdk/v1/query` |
| `revokeInvitation` | `revokeInvitation(invitationId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `listRoles` | `listRoles(options?: { limit?: number; start?: RoleCursor; }): Promise<Role[]>` | `POST /api/sdk/v1/query` |
| `getRole` | `getRole(id: string): Promise<Role \| null>` | `POST /api/sdk/v1/query` |
| `createRole` | `createRole(data: { name: string; description?: string; }): Promise<{ id: string; }>` | `POST /api/sdk/v1/mutate` |
| `updateRole` | `updateRole(id: string, data: { name?: string; description?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `addRoleMembers` | `addRoleMembers(roleId: string, userIds: string[]): Promise<{ mappingIds: Record<string, string>; }>` | `POST /api/sdk/v1/mutate` |
| `removeRoleMembers` | `removeRoleMembers(mappingIds: string[]): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `listResources` | `listResources(): Promise<AccessResource[]>` | `POST /api/sdk/v1/query` |
| `listUserAccess` | `listUserAccess(userId: string): Promise<ResourceAccess[]>` | `POST /api/sdk/v1/query` |
| `grantAccess` | `grantAccess(grants: ResourceAccessGrant[]): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `updateAccess` | `updateAccess(updates: ResourceAccessUpdate[]): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `revokeAccess` | `revokeAccess(ids: string[]): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `listInstalledApps` | `listInstalledApps(options?: { limit?: number; start?: AppCursor; }): Promise<InstalledApp[]>` | `POST /api/sdk/v1/query` |
| `listOrgApps` | `listOrgApps(orgId: string, options?: { limit?: number; start?: AppCursor; }): Promise<App[]>` | `POST /api/sdk/v1/query` |
| `listMarketplaceApps` | `listMarketplaceApps(options?: { limit?: number; start?: AppCursor; }): Promise<App[]>` | `POST /api/sdk/v1/query` |
| `updateApp` | `updateApp(appId: string, data: { name?: string; description?: string; webhookUrl?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate` |

<details><summary>Notes (31)</summary>

- **`getWorkspace`** — Required: workspaceId. Every admin method is an SdkOperation (registry/admin.js uses op(id, kind)), so there is no per-method REST path: Transport.executeV1 posts kind 'query' to /api/sdk/v1/query and returns response.data; kind 'mutator' posts to /api/sdk/v1/mutate and returns response.generated ?? response. Returns null when the workspace does not exist.
- **`updateWorkspace`** — Side effect: renames workspace / changes description. WorkspaceUpdate = { name?: string; description?: string } — omitted fields are left alone. Note the args nest the patch under `updates` (not spread).
- **`listWorkspaceOrgs`** — Required: workspaceId. Unpaginated — returns every attachment in one response, one per organisation with its role. No limit/start accepted and no listAll variant.
- **`listAvailableOrgs`** — No params (the resource passes `undefined` as args). Returns every ACTIVE organisation that can be attached to a workspace. Unpaginated.
- **`createOrg`** — Required: orgName, workspaceId. Client-generated ids: the method mints orgId, workspaceOrgId and memberId via newId() (crypto.randomUUID) BEFORE the call and returns them — the server does not choose them. Three side effects in one call: creates the org, attaches it to the workspace, and seeds its first member.
- **`addOrgToWorkspace`** — Both params required. The returned attachment `id` is client-generated with newId() before the request, not read from the response.
- **`removeOrgFromWorkspace`** — Both params required. Detaches the org from the workspace; addressed by (workspaceId, orgId), not by the attachment id.
- **`listOrgMembers`** — Required: orgId. Unpaginated. Includes members who have left (removeOrgMember is a soft delete), so filter on leftAt if you only want active members.
- **`getOrgMember`** — Required: memberId (the membership id, which follows a person across workspaces — not a userId). Returns null if it does not exist.
- **`addOrgMember`** — All three fields required. OrgRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | 'COMMUNITY_MEMBER' | 'GUEST' (wider than updateOrgMemberRole's four). memberId is client-generated via newId() and returned. Idempotent-ish: a previously-departed member is reactivated rather than duplicated, in which case the returned memberId may not be the surviving row's id.
- **`updateOrgMemberRole`** — Both required. Only these four roles can be set this way — COMMUNITY_MEMBER and GUEST are in OrgRole but not settable here.
- **`removeOrgMember`** — Required: memberId. Soft delete — the server stamps `leftAt`; the member drops out of active queries but history is preserved and the row still appears in listOrgMembers.
- **`updateUserRole`** — All three required. WorkspaceUserUpdate = { role?: 'ADMIN' | 'MEMBER' } — only those two are settable here, even though WorkspaceRole also has OWNER/GUEST/COMMUNITY_MEMBER. Patch is nested under `updates`.
- **`removeUser`** — Both required. Removes a user's workspace membership (distinct from removeOrgMember, which acts on an org membership id).
- **`listInvitations`** — No params (args passed as `undefined`); scoped to the token's workspace. Unpaginated, and includes invitations already accepted or expired — filter by status for genuinely outstanding ones.
- **`revokeInvitation`** — Required: invitationId. Only meaningful before the invitation is accepted.
- **`listRoles`** — Server-side cursor pagination: RoleCursor = { id: string; createdAt: number } (registry/admin.d.ts), ordered by creation. Returns a bare Role[] with no envelope — no hasMore/nextCursor — so to page you pass the last row's { id, createdAt } back as `start` and stop when a page comes back short. There is NO listAll helper on this resource, and core/paginate.ts (DEFAULT_LIMIT/MAX_LIMIT = 100) is not used by admin at all.
- **`getRole`** — Required: id. Returns null if the role does not exist.
- **`createRole`** — Required: name. The returned `id` is client-generated with newId() before the request and spread into the args ahead of `data`.
- **`updateRole`** — Required: id. Fields are spread flat into args here (unlike updateWorkspace/updateUserRole, which nest under `updates`); omitted fields are left alone.
- **`addRoleMembers`** — Batch assign. mappingIds is built client-side by newIdMap(userIds) — one fresh uuid per userId, keyed by user id — and sent with the request, then returned. Keep them: removeRoleMembers takes mapping ids, not user ids, and there is no method to look a mapping id up afterwards.
- **`removeRoleMembers`** — Batch. Takes the mapping ids returned by addRoleMembers — passing user ids here silently removes nothing.
- **`listResources`** — No params (args `undefined`). Unpaginated: every resource that access can be granted on.
- **`listUserAccess`** — Required: userId. Unpaginated; one entry per grant, each naming a resource and access level.
- **`grantAccess`** — Batch create. ResourceAccessGrant = { id: string; userId: string; resourceId: string; accessType: AccessType } where AccessType = 'ADMIN' | 'READ' | 'WRITE'. Unlike the other create methods, `id` is NOT generated by the SDK — the caller must supply each grant id (and must keep it, since revokeAccess/updateAccess address grants by that id).
- **`updateAccess`** — Batch change. ResourceAccessUpdate = { id: string; accessType: AccessType } — id is the existing grant's id; the only mutable field is accessType.
- **`revokeAccess`** — Batch delete by grant id (not user id or resource id).
- **`listInstalledApps`** — Scoped to the token's workspace. Cursor pagination: AppCursor = { id: string; createdAt: number }, ordered by creation. Returns a bare InstalledApp[] with no hasMore flag; page by feeding the last row's { id, createdAt } as `start`. No listAll variant.
- **`listOrgApps`** — Required: orgId. Same AppCursor { id, createdAt } pagination as listInstalledApps; options are spread flat alongside orgId. Returns apps published by that org. No listAll variant.
- **`listMarketplaceApps`** — No required params. Apps available to install. Same AppCursor { id, createdAt } pagination; bare array return, no listAll variant.
- **`updateApp`** — Required: appId. Fields spread flat into args; omitted fields are left alone. Changing webhookUrl re-points where the app's events are delivered.

</details>

## attachments

Uploads raw file bytes over multipart/form-data and returns attachment ids that other operations (messages.send, conversations.create, tickets.create, impacts, form entity values) reference.

| method | signature | route |
|---|---|---|
| `upload` | `upload(data: { entityId: string; entityType: 'IMPACT' \| 'FORM_ENTITY_VALUE'; files: UploadFileInput[] }): Promise<AttachmentUploadResponse>` | `POST /api/sdk/v1/attachments` |
| `uploadDraft` | `uploadDraft(data: { channelId: string; conversationId?: string; files: UploadFileInput[] }): Promise<DraftAttachmentUploadResponse>` | `POST /api/sdk/v1/draft-attachments` |

<details><summary>Notes (2)</summary>

- **`upload`** — All three params required. Bypasses the Zero query/mutate catalog — this is a direct REST call issued by transport.executeApi. mapArgs builds a FormData: fields `entityId`, `entityType`, repeated `files` parts, plus a `fileMetadata` JSON array (one entry per file: fileIndex, hasThumbnail, and optional width/height/duration). Thumbnails are NOT sent for this route (appendFiles called without includeThumbnails), so `thumbnail`/`thumbnailFilename` on a UploadFileInput are ignored here. UploadFileInput = Blob | { file: Blob; filename?: string; thumbnail?: Blob; thumbnailFilename?: string; width?: number; height?: number; duration?: number } — a browser File can be passed bare and its `.name` is used as the multipart filename when no explicit filename is given. Response: AttachmentUploadResponse { success: boolean; count: number; attachments: UploadedAttachment[] } where UploadedAttachment = { id: string; originalFilename: string; mimetype: string; size: number; url: string; thumbnailUrl?: string | null }. Side effect: persists files against the named entity. No pagination. (The registry JSDoc says 'Maps to: POST /api/sdk/attachments' but the code path is the v1-prefixed '/api/sdk/v1/attachments'.)
- **`uploadDraft`** — `channelId` and `files` required; `conversationId` optional (only when replying into an existing thread). Use this when composing something that does not exist yet — upload first, then pass the returned ids as `attachmentIds` to messages.send / conversations.create / tickets.create. Side effect beyond the HTTP call: the method generates client-side ids before sending — `draftMessageId: newId()` and one `attachmentIds` entry per file via newId() (crypto.randomUUID) — so the caller never supplies them and repeated calls with the same files create distinct drafts. mapArgs FormData fields: `attachmentIds` (JSON string array), `draftMessageId`, `channelId`, optional `conversationId` (omitted when undefined/null), repeated `files`, and `fileMetadata` JSON. Unlike `upload`, this route is called with includeThumbnails: true, so a descriptor's `thumbnail` Blob is appended as a `thumbnails` part (filename defaults to `thumb_<n>.jpg`) and its metadata entry gets hasThumbnail/thumbnailIndex. Response: DraftAttachmentUploadResponse { success: boolean; uploadedAttachments: DraftAttachmentUploadResult[]; totalCount: number; successCount: number; failureCount: number } with DraftAttachmentUploadResult = { attachmentId: string; fileUrl?: string; success: boolean; error?: string } — per-file partial failure is reported in the body, not thrown, so check failureCount. No pagination. (Registry JSDoc says '/api/sdk/draft-attachments'; actual path is '/api/sdk/v1/draft-attachments'.)

</details>

## automations

Event-triggered automations and their approval lifecycle (createProposal → submitForApproval → approve → activate), plus a paginated listing of workflow runs.

| method | signature | route |
|---|---|---|
| `list` | `list(): Promise<Workflow[]>` | `POST /api/sdk/v1/query` |
| `get` | `get(id: string): Promise<Workflow \| null>` | `POST /api/sdk/v1/query` |
| `listWorkflows` | `listWorkflows(options?: { limit?: number; start?: WorkflowCursor; }): Promise<Workflow[]>` | `POST /api/sdk/v1/query` |
| `createProposal` | `createProposal(data: { name: string; configJson: unknown; metadataJson: unknown; eventType: string; automationSeriesId?: string; }): Promise<{ id: string; }>` | `POST /api/sdk/v1/mutate` |
| `update` | `update(id: string, data: { name?: string; configJson?: unknown; metadataJson?: unknown; eventType?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `delete` | `delete(id: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `submitForApproval` | `submitForApproval(id: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `revoke` | `revoke(id: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `approve` | `approve(id: string, options?: { note?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `reject` | `reject(id: string, note: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `activate` | `activate(id: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `disable` | `disable(id: string, cancelQueued?: boolean): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `archive` | `archive(id: string): Promise<void>` | `POST /api/sdk/v1/mutate` |

<details><summary>Notes (13)</summary>

- **`list`** — No params, no pagination — returns every automation in the workspace at any lifecycle stage. Registry op automations.list, kind 'query'. There is no listAll variant on this resource; list() is already the unbounded read. Result rows are Workflow objects whose configuration/metadata are serialised JSON strings.
- **`get`** — id required. Resolves to null when the automation does not exist (no throw).
- **`listWorkflows`** — The only genuinely paginated method here — server-side cursor pagination, not the client-side core/paginate.ts windowing. Returns one page of workflow runs, newest first; automations are one workflow type among several so this listing is broader than list(). WorkflowCursor is exported from ../registry/automations.js as `{ id: string; createdAt: number }`; pass the cursor from the previous page as `start`. Omitting options sends `{}`.
- **`createProposal`** — Side effect: the SDK mints the row id client-side via newId() (crypto.randomUUID) BEFORE the call and sends it as args.id; the returned { id } is that generated id, not a server value. name, configJson, metadataJson and eventType are all required; automationSeriesId optional (recurring series). Creates the automation as a draft — it does not run until submitForApproval → approve → activate have all been called.
- **`update`** — Partial update — every field in data is optional and omitted fields are left unchanged. id required. Returns void.
- **`delete`** — Destructive: removes the automation outright. Use archive() instead to retire one while keeping its history.
- **`submitForApproval`** — Lifecycle step 2: moves a draft into the submitted/pending-approval state. Each transition is a distinct mutator so the lifecycle stays auditable.
- **`revoke`** — Withdraws a submission before it has been approved or rejected — the undo for submitForApproval.
- **`approve`** — Lifecycle step 3. note is optional and is recorded with the approval. Approving alone does not start the automation — activate() is still required.
- **`reject`** — note is a REQUIRED positional argument (unlike approve, where it is optional and passed inside an options object) — it records why the submission was rejected.
- **`activate`** — Lifecycle step 4 and the point at which the automation actually starts running. Only valid on an approved automation.
- **`disable`** — Stops the automation running without deleting it. cancelQueued is only included in the request body when explicitly passed (`...(cancelQueued !== undefined ? { cancelQueued } : {})`), so the server default applies otherwise; the default behaviour is to LEAVE already-scheduled runs in place. Pass true to also cancel queued runs.
- **`archive`** — Retires the automation while preserving its history — the non-destructive counterpart to delete().

</details>

## calls

Manages call records around rooms provisioned on a separate realtime server: active/scheduled/history listings, participants, recurring series, summary templates, call threads, recordings, lifecycle (initiate/join/leave/reject/cancel/invite), moment bookmarks, and lobby admission — it never handles live audio/video itself.

| method | signature | route |
|---|---|---|
| `listActive` | `listActive(): Promise<Call[]>` | `POST /api/sdk/v1/query (body { op: 'calls.listActive', args: undefined })` |
| `listActiveInChannel` | `listActiveInChannel(channelId: string): Promise<Call[]>` | `POST /api/sdk/v1/query (body { op: 'calls.listActiveInChannel', args: { channelId } })` |
| `listScheduled` | `listScheduled(): Promise<Call[]>` | `POST /api/sdk/v1/query (body { op: 'calls.listScheduled', args: undefined })` |
| `listHistory` | `listHistory(options?: { limit?: number; start?: CallCursor; }): Promise<Call[]>` | `POST /api/sdk/v1/query (body { op: 'calls.listHistory', args: options ?? {} })` |
| `listParticipants` | `listParticipants(callId: string): Promise<CallParticipant[]>` | `POST /api/sdk/v1/query (body { op: 'calls.listParticipants', args: { callId } })` |
| `getRecurringSeries` | `getRecurringSeries(seriesId: string): Promise<RecurringCallSeries \| null>` | `POST /api/sdk/v1/query (body { op: 'calls.getRecurringSeries', args: { seriesId } })` |
| `getSummaryTemplate` | `getSummaryTemplate(templateId: string): Promise<SummaryTemplate \| null>` | `POST /api/sdk/v1/query (body { op: 'calls.getSummaryTemplate', args: { templateId } })` |
| `listSummaryTemplates` | `listSummaryTemplates(): Promise<SummaryTemplate[]>` | `POST /api/sdk/v1/query (body { op: 'calls.listSummaryTemplates', args: undefined })` |
| `getConversation` | `getConversation(callId: string): Promise<Conversation \| null>` | `POST /api/sdk/v1/query (body { op: 'calls.getConversation', args: { callId } })` |
| `listRecordings` | `listRecordings(options?: { limit?: number; start?: CallCursor; }): Promise<Call[]>` | `POST /api/sdk/v1/query (body { op: 'calls.listRecordings', args: options ?? {} })` |
| `listCreatedRecordings` | `listCreatedRecordings(options?: { limit?: number; start?: CallCursor; }): Promise<Call[]>` | `POST /api/sdk/v1/query (body { op: 'calls.listCreatedRecordings', args: options ?? {} })` |
| `listSharedRecordings` | `listSharedRecordings(options?: { limit?: number; start?: CallCursor; }): Promise<Call[]>` | `POST /api/sdk/v1/query (body { op: 'calls.listSharedRecordings', args: options ?? {} })` |
| `getRecording` | `getRecording(callId: string): Promise<Call \| null>` | `POST /api/sdk/v1/query (body { op: 'calls.getRecording', args: { callId } })` |
| `initiate` | `initiate(data: { channelId: string; callType: CallType; externalId: string; roomLink: string; targetUserIds?: string[]; }): Promise<{ callId: string; }>` | `POST /api/sdk/v1/mutate (body { op: 'calls.initiate', args: { callId, ...data } })` |
| `join` | `join(callId: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: 'calls.join', args: { callId } })` |
| `leave` | `leave(callId: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: 'calls.leave', args: { callId } })` |
| `reject` | `reject(callId: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: 'calls.reject', args: { callId } })` |
| `cancel` | `cancel(callId: string, options?: { cancelEntireSeries?: boolean; }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: 'calls.cancel', args: { callId, ...options } })` |
| `invite` | `invite(callId: string, userIds: string[]): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: 'calls.invite', args: { callId, userIds } })` |
| `linkNotesCanvas` | `linkNotesCanvas(callId: string, notesCanvasId: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: 'calls.linkNotesCanvas', args: { callId, notesCanvasId } })` |
| `markMoment` | `markMoment(data: { callId: string; type: string; timestampSeconds: number; text: string; }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: 'calls.markMoment', args: data })` |
| `requestToJoin` | `requestToJoin(callId: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: 'calls.requestToJoin', args: { callId } })` |
| `cancelJoinRequest` | `cancelJoinRequest(callId: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: 'calls.cancelJoinRequest', args: { callId } })` |
| `approveLobbyRequest` | `approveLobbyRequest(callId: string, participantId: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: 'calls.approveLobbyRequest', args: { callId, participantId } })` |
| `rejectLobbyRequest` | `rejectLobbyRequest(callId: string, participantId: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: 'calls.rejectLobbyRequest', args: { callId, participantId } })` |

<details><summary>Notes (25)</summary>

- **`listActive`** — No params. Returns every in-progress call visible to the caller. No pagination — full array in one response; no listAll variant exists on this resource.
- **`listActiveInChannel`** — channelId required. Unpaginated — returns all calls live in that channel.
- **`listScheduled`** — No params. Only calls the caller is invited to that have not started yet. Unpaginated.
- **`listHistory`** — Server-side cursor pagination. CallCursor = { id: string; startedAt: number } (from dist/registry/calls.d.ts), ordered by start time; pass the cursor built from the last item of the previous page as `start`. Past calls, most recent first. Options object is optional and defaults to {}.
- **`listParticipants`** — callId required. Returns everyone who joined with their join/leave times. Unpaginated.
- **`getRecurringSeries`** — seriesId required. Returns null when the series does not exist rather than throwing.
- **`getSummaryTemplate`** — templateId required. Returns null when the template does not exist.
- **`listSummaryTemplates`** — No params. Templates the caller may use for call notes. Unpaginated.
- **`getConversation`** — callId required. Returns the thread attached to the call, or null if it has none.
- **`listRecordings`** — Cursor pagination via limit/start (CallCursor = { id, startedAt }). Recordings from the caller's own calls, newest first.
- **`listCreatedRecordings`** — Standalone recordings the caller created, newest first, cursor-paginated. Gotcha: the JSDoc documents options.participantId and the registry operation accepts { limit?, start?, participantId? }, but the public .d.ts signature omits participantId — TypeScript callers cannot pass it without a cast.
- **`listSharedRecordings`** — Standalone recordings shared with the caller, newest first, cursor-paginated. Same gotcha as listCreatedRecordings: registry accepts participantId, the exported signature does not expose it.
- **`getRecording`** — The callId here is the realtime room's EXTERNAL id (the `externalId`/room id), not the SDK call row id. Returns null if there is no recording.
- **`initiate`** — Side effects: mints the call id client-side with newId() (crypto.randomUUID) before the request and returns it as { callId }; the registry op itself returns void. channelId, callType, externalId and roomLink are required; targetUserIds optional (omit for an open call — supplying it rings those users). externalId/roomLink must point at a room already provisioned on the realtime server — this only records the call row, it does not create media, so invented values produce a call nobody can join.
- **`join`** — callId required. Mutation — adds the caller as a participant.
- **`leave`** — callId required. Mutation — records the caller's leave.
- **`reject`** — callId required. Declines an incoming call for the caller.
- **`cancel`** — callId required. Destructive: cancelEntireSeries: true cancels every future occurrence when the call belongs to a recurring series, not just this one.
- **`invite`** — Both params required. Adds people to a call already in progress.
- **`linkNotesCanvas`** — Both params required. Attaches an existing canvas to the call for shared notes.
- **`markMoment`** — All four fields required; data is passed straight through untouched. timestampSeconds is an OFFSET in seconds from the start of the call, not a clock/epoch time. `type` is a loose string (e.g. 'DECISION'); bookmarks land on the recording timeline.
- **`requestToJoin`** — callId required. Lobby: asks to be admitted to a call the caller was not invited to.
- **`cancelJoinRequest`** — callId required. Lobby: withdraws the caller's own pending join request.
- **`approveLobbyRequest`** — Both params required; participantId is the waiting participant's id (from the lobby/participant record, not a user id). Host-side action.
- **`rejectLobbyRequest`** — Both params required; participantId is the waiting participant's id. Host-side action — turns the person away.

</details>

## canvases

Collaborative BlockNote documents ("canvases") plus their folders, sharing grants (users/groups/channels), inline comment threads, and saved version snapshots — exposed on SpacesClient as `sdk.canvases` (CanvasesResource).

| method | signature | route |
|---|---|---|
| `list` | `list(options?: { limit?: number; start?: CanvasCursor; includeQuartoDocs?: boolean; direction?: 'forward' \| 'backward' }): Promise<Canvas[]>` | `POST /api/sdk/v1/query` |
| `listQuartoDocs` | `listQuartoDocs(options?: { limit?: number; start?: CanvasCursor; direction?: 'forward' \| 'backward' }): Promise<Canvas[]>` | `POST /api/sdk/v1/query` |
| `listByChannel` | `listByChannel(channelId: string, options?: { limit?: number; start?: CanvasCursor; includeQuartoDocs?: boolean }): Promise<Canvas[]>` | `POST /api/sdk/v1/query` |
| `listQuartoDocsByChannel` | `listQuartoDocsByChannel(channelId: string, options?: { limit?: number; start?: CanvasCursor }): Promise<Canvas[]>` | `POST /api/sdk/v1/query` |
| `listByFolder` | `listByFolder(folderId: string, projectId: string, options?: { includeQuartoDocs?: boolean }): Promise<Canvas[]>` | `POST /api/sdk/v1/query` |
| `listHierarchy` | `listHierarchy(options: { scope?: CanvasScope; channelId?: string; folderId?: string; projectId?: string; includeQuartoDocs?: boolean }): Promise<Canvas[]>` | `POST /api/sdk/v1/query` |
| `get` | `get(canvasId: string): Promise<Canvas \| null>` | `POST /api/sdk/v1/query` |
| `listParticipants` | `listParticipants(canvasId: string): Promise<CanvasParticipant[]>` | `POST /api/sdk/v1/query` |
| `listVersions` | `listVersions(canvasId: string): Promise<CanvasVersion[]>` | `POST /api/sdk/v1/query` |
| `create` | `create(data: { title: string; content?: unknown; channelId?: string; folderId?: string; projectId?: string; visibility?: CanvasVisibility }): Promise<{ id: string }>` | `POST /api/sdk/v1/mutate` |
| `update` | `update(id: string, data: { title?: string; content?: unknown; visibility?: CanvasVisibility; isCollaborative?: boolean; folderId?: string; projectId?: string; channelId?: string }): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `delete` | `delete(id: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `toggleStarred` | `toggleStarred(id: string, canvasId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `addParticipants` | `addParticipants(canvasId: string, userIds: string[], role: CanvasRole): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `addGroupParticipant` | `addGroupParticipant(canvasId: string, userGroupId: string, role: CanvasRole): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `addChannelParticipant` | `addChannelParticipant(canvasId: string, channelId: string, role: CanvasRole): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `removeParticipant` | `removeParticipant(canvasId: string, userId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `removeGroupParticipant` | `removeGroupParticipant(canvasId: string, userGroupId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `removeChannelParticipant` | `removeChannelParticipant(canvasId: string, channelId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `updateParticipantRole` | `updateParticipantRole(canvasId: string, userId: string, role: CanvasRole): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `updateGroupParticipantRole` | `updateGroupParticipantRole(canvasId: string, userGroupId: string, role: CanvasRole): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `updateChannelParticipantRole` | `updateChannelParticipantRole(canvasId: string, channelId: string, role: CanvasRole): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `listCommentThreads` | `listCommentThreads(canvasId: string): Promise<CanvasCommentThread[]>` | `POST /api/sdk/v1/query` |
| `listThreadComments` | `listThreadComments(threadId: string): Promise<CanvasComment[]>` | `POST /api/sdk/v1/query` |
| `createCommentThread` | `createCommentThread(data: { canvasId: string; blockId: string; body: string; anchorText?: string; mentionedUserIds?: string[] }): Promise<{ threadId: string; commentId: string }>` | `POST /api/sdk/v1/mutate` |
| `replyToThread` | `replyToThread(data: { threadId: string; canvasId: string; body: string; mentionedUserIds?: string[] }): Promise<{ commentId: string }>` | `POST /api/sdk/v1/mutate` |
| `updateComment` | `updateComment(commentId: string, body: string, options?: { mentionedUserIds?: string[] }): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `deleteComment` | `deleteComment(commentId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `setThreadStatus` | `setThreadStatus(threadId: string, status: CanvasCommentThreadStatus): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `saveVersion` | `saveVersion(data: { canvasId: string; name: string; content: unknown; contentHash: string }): Promise<{ id: string }>` | `POST /api/sdk/v1/mutate` |
| `renameVersion` | `renameVersion(id: string, name: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `restoreVersion` | `restoreVersion(id: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `listPersonalFolders` | `listPersonalFolders(): Promise<CanvasFolder[]>` | `POST /api/sdk/v1/query` |
| `listChannelFolders` | `listChannelFolders(channelId: string): Promise<CanvasFolder[]>` | `POST /api/sdk/v1/query` |
| `listProjectFolders` | `listProjectFolders(projectId: string): Promise<CanvasFolder[]>` | `POST /api/sdk/v1/query` |
| `createFolder` | `createFolder(data: { name: string; projectId?: string; channelId?: string }): Promise<{ id: string }>` | `POST /api/sdk/v1/mutate` |
| `updateFolder` | `updateFolder(id: string, name: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `deleteFolder` | `deleteFolder(id: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `archive` | `archive(canvasId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `unarchive` | `unarchive(canvasId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |

<details><summary>Notes (40)</summary>

- **`list`** — All params optional; omitted options are sent as {}. Cursor pagination: `start` is a CanvasCursor { id: string; updatedAt: number } taken from the previous page's last row, `direction` pages forward/backward. Newest first. There is no listAll helper on this resource — you must loop on the cursor yourself. Quarto docs are excluded unless includeQuartoDocs is true.
- **`listQuartoDocs`** — Same cursor pagination as list (limit / start: CanvasCursor / direction). Returns only Quarto documents; no includeQuartoDocs flag.
- **`listByChannel`** — channelId required (merged into args as { channelId, ...options }). Cursor pagination via limit/start only — no `direction` param here.
- **`listQuartoDocsByChannel`** — channelId required. limit/start cursor pagination only; no direction, no includeQuartoDocs.
- **`listByFolder`** — Both folderId and projectId are required positional params. Not paginated — returns the folder's full set in one response.
- **`listHierarchy`** — `options` is required (passed straight through, unlike list). CanvasScope = 'channel' | 'channel_root' | 'folder' | 'personal_root'. The scope dictates the required id: 'folder' needs folderId, 'channel' and 'channel_root' need channelId, 'personal_root' needs neither; supplying both or the wrong one is rejected server-side. Not paginated.
- **`get`** — Returns the canvas including its content, or null when it does not exist or is not visible to the caller (does not throw for a missing/forbidden canvas).
- **`listParticipants`** — One row per access grant — user, group and channel grants all appear here, each with its CanvasRole. Not paginated.
- **`listVersions`** — Saved version snapshots, newest first. Not paginated.
- **`create`** — Only `title` is required. The SDK mints the canvas id client-side with newId() (crypto.randomUUID) and sends it as args.id, then returns { id } — the returned id is the locally generated one, not a server echo. `content` is a BlockNote block array, NOT markdown. Side effects: the creator becomes the first participant and share-link tokens are minted immediately.
- **`update`** — Partial update — omitted fields are left alone. Args are { id, ...data }. WARNING: when the canvas has isCollaborative set, the realtime CRDT server owns the content, so writing `content` here is not a safe read-modify-write against concurrent editors — take a saveVersion snapshot first or use the realtime editor. Also doubles as the move operation (folderId/projectId/channelId).
- **`delete`** — Hard delete of the canvas. Compare with archive(), which only hides it.
- **`toggleStarred`** — Two ids required: `id` is the star row's id, `canvasId` is the canvas being starred. FLIPS the current state rather than setting it — not idempotent. The SDK does not generate the star id for you.
- **`addParticipants`** — All three params required. Batch: grants the same role to every user in userIds.
- **`addGroupParticipant`** — All params required. Grants a user group access; every member inherits the role.
- **`addChannelParticipant`** — All params required. Grants a whole channel's membership access at the given role.
- **`removeParticipant`** — Revokes one user's direct grant. Does not touch access inherited via a group or channel grant.
- **`removeGroupParticipant`** — Revokes a group's grant.
- **`removeChannelParticipant`** — Revokes a channel's grant.
- **`updateParticipantRole`** — All params required. Changes an existing user grant's role (e.g. 'EDITOR' -> 'VIEWER').
- **`updateGroupParticipantRole`** — All params required. Changes an existing group grant's role.
- **`updateChannelParticipantRole`** — All params required. Changes an existing channel grant's role.
- **`listCommentThreads`** — Returns both open and resolved threads; filter on status client-side. Not paginated.
- **`listThreadComments`** — Comments in one thread, oldest first. Takes threadId (not canvasId). Not paginated.
- **`createCommentThread`** — canvasId, blockId and body are required; blockId is the BlockNote block the thread anchors to. The SDK mints BOTH ids client-side (newId() for threadId and commentId) and sends them as args before returning them. mentionedUserIds triggers notifications.
- **`replyToThread`** — threadId, canvasId and body all required (canvasId is not inferred from the thread). The SDK mints commentId client-side and returns it. mentionedUserIds triggers notifications.
- **`updateComment`** — commentId and body required; body fully replaces the previous text. mentionedUserIds is passed via the third options arg (the JSDoc documents it as a bare param, but the actual signature takes it inside `options`).
- **`deleteComment`** — Deletes a single comment (not the whole thread).
- **`setThreadStatus`** — Resolves or reopens a thread; status is an explicit CanvasCommentThreadStatus (e.g. 'RESOLVED'), so unlike toggleStarred this is a set, not a toggle.
- **`saveVersion`** — ALL four fields are required — including contentHash, which the caller computes and the server uses to skip duplicate saves. `content` is a BlockNote block array supplied by the caller (the server does not snapshot current content for you). The SDK mints the version id client-side and returns it. Use this before an update() on a collaborative canvas to get a restore point.
- **`renameVersion`** — `id` is the version id, not the canvas id.
- **`restoreVersion`** — `id` is the version id; the canvas is inferred from it. Destructive — overwrites the canvas's current content with the snapshot.
- **`listPersonalFolders`** — No params — the implementation calls this.call(op, undefined), so args is undefined in the request body. Returns only the caller's own folders, excluding channel- and project-owned ones. Not paginated.
- **`listChannelFolders`** — Not paginated.
- **`listProjectFolders`** — Not paginated.
- **`createFolder`** — Only `name` is required; omit both projectId and channelId to create a personal folder. The SDK mints the folder id client-side (newId()) and returns it.
- **`updateFolder`** — Rename only — the resource signature requires `name` even though the underlying registry op types it as optional ({ id: string; name?: string }).
- **`deleteFolder`** — Deletes the folder; the SDK surface says nothing about what happens to canvases inside it.
- **`archive`** — Hides the canvas from the default listings without deleting it. Takes canvasId (note: delete/update/toggleStarred take `id` instead).
- **`unarchive`** — Reverses archive(), returning the canvas to the default listings.

</details>

## collections

Knowledge-base collections: nested folders of already-uploaded files (versioned, latest-version reads) plus the user/group/channel permission grants that control who can see them; file upload itself is not part of this resource.

| method | signature | route |
|---|---|---|
| `list` | `list(options?: { scopeType?: string; scopeId?: string; }): Promise<Collection[]>` | `POST /api/sdk/v1/query` |
| `listSubfolders` | `listSubfolders(rootCollectionId: string): Promise<Collection[]>` | `POST /api/sdk/v1/query` |
| `listPermissions` | `listPermissions(collectionId: string): Promise<CollectionPermission[]>` | `POST /api/sdk/v1/query` |
| `listItems` | `listItems(collectionId: string): Promise<CollectionItem[]>` | `POST /api/sdk/v1/query` |
| `get` | `get(id: string): Promise<Collection \| null>` | `POST /api/sdk/v1/query` |
| `listFilesByRoot` | `listFilesByRoot(rootCollectionId: string): Promise<CollectionItem[]>` | `POST /api/sdk/v1/query` |
| `listWithItems` | `listWithItems(options?: { scopeType?: string; scopeId?: string; }): Promise<Collection[]>` | `POST /api/sdk/v1/query` |
| `create` | `create(data: { name: string; scopeType: string; scopeId: string; description?: string; isPrivate?: boolean; }): Promise<{ id: string; permissionId: string; }>` | `POST /api/sdk/v1/mutate` |
| `update` | `update(id: string, data: { name?: string; description?: string; isPrivate?: boolean; }): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `delete` | `delete(id: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `createFolder` | `createFolder(parentId: string, name: string): Promise<{ id: string; }>` | `POST /api/sdk/v1/mutate` |
| `renameItem` | `renameItem(id: string, collectionId: string, name: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `deleteItem` | `deleteItem(id: string, collectionId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `grantPermission` | `grantPermission(data: { collectionId: string; role: CollectionRole; userId?: string; userGroupId?: string; channelId?: string; }): Promise<{ id: string; }>` | `POST /api/sdk/v1/mutate` |
| `revokePermission` | `revokePermission(id: string, collectionId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |

<details><summary>Notes (15)</summary>

- **`list`** — All args optional; omit entirely for every root collection the caller can reach. Returns root collections only, WITHOUT their files — use listWithItems to get files joined in one round trip. No pagination: the server returns the full set and the SDK does not window it (core/paginate.ts is unused by this resource, so there is no list/listAll split here).
- **`listSubfolders`** — rootCollectionId required. Returns the sub-collections beneath a root collection. Unpaginated full result.
- **`listPermissions`** — collectionId required. One grant row per user, user group or channel with access. The grant ids returned here are what revokePermission takes. Unpaginated.
- **`listItems`** — collectionId required. Latest versions only (files are versioned, isLatest marks the current revision). Returns that one collection's own files, NOT those of its sub-collections — use listFilesByRoot to walk the tree. Unpaginated.
- **`get`** — id required. Returns null if the collection does not exist or was soft-deleted. The underlying query is not `.one()`, so the wire shape is a list; the registry entry attaches mapResult: (rows) => rows[0] ?? null to unwrap it client-side.
- **`listFilesByRoot`** — rootCollectionId required. Walks the whole tree under the root and returns every latest-version file across all subfolders, with each file's attachment joined in. Potentially large — no pagination or limit is available.
- **`listWithItems`** — Same optional scoping as list (omit both for everything reachable), but each root collection comes back with its files already joined — one round trip instead of list followed by a listItems per collection. Unpaginated.
- **`create`** — name, scopeType and scopeId are required; description and isPrivate optional. Side effects: the SDK generates BOTH ids client-side via crypto.randomUUID (core/ids.ts newId) before the call and returns them — id is the new root collection, permissionId is the creator's own permission grant row, created together with the collection. Creates a ROOT collection only; use createFolder for sub-collections. isPrivate restricts it to explicitly granted members.
- **`update`** — id required; every field in data is optional and omitted fields are left alone. Returns void.
- **`delete`** — id required. Destructive: deletes the collection and everything under it (sub-collections and items). Returns void.
- **`createFolder`** — Both params required. Creates a sub-collection nested under parentId. The SDK mints the new id client-side (newId/crypto.randomUUID) and returns it; the registry op itself declares void.
- **`renameItem`** — All three params required — collectionId is the owning collection, not optional. Renames a file or a sub-collection. Returns void.
- **`deleteItem`** — Both params required. Removes a file or sub-collection from the collection. Returns void.
- **`grantPermission`** — collectionId and role required; set EXACTLY ONE of userId, userGroupId or channelId. CollectionRole = 'OWNER' | 'EDITOR' | 'VIEWER'. Authorization: any role holder may share, but only up to their own role — only an OWNER can grant OWNER, a VIEWER can grant only VIEWER; a channel grant is restricted to VIEWER. Side effect: also re-indexes the collection's files so search reflects the new access. The SDK generates the grant id client-side (newId) and returns it — keep it for revokePermission.
- **`revokePermission`** — Both params required — id is the grant id (from listPermissions or the return of grantPermission), NOT a user id; collectionId is the collection the grant sits on. Returns void.

</details>

## dashboards

Dashboards, their saved queries, and tile layout — a query is defined once and then *placed* on a dashboard, and the placement (mappingId) is what reordering and removal operate on, so one query can appear on multiple dashboards.

| method | signature | route |
|---|---|---|
| `list` | `list(): Promise<Dashboard[]>` | `POST /api/sdk/v1/query` |
| `get` | `get(dashboardId: string): Promise<Dashboard \| null>` | `POST /api/sdk/v1/query` |
| `upsert` | `upsert(data: { id?: string; name: string; createdBy: string; description?: string; }): Promise<{ id: string; }>` | `POST /api/sdk/v1/mutate` |
| `delete` | `delete(id: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `updateLayout` | `updateLayout(updates: DashboardLayoutUpdate[]): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `upsertQuery` | `upsertQuery(data: { id?: string; title: string; queryJson: unknown; createdBy: string; dashboardId?: string; mappingId?: string; entityType?: string; targetEntity?: string; visualType?: string; }): Promise<{ id: string; mappingId?: string; }>` | `POST /api/sdk/v1/mutate` |
| `deleteQuery` | `deleteQuery(id: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `reorderQueries` | `reorderQueries(orderedMappingIds: string[]): Promise<void>` | `POST /api/sdk/v1/mutate` |

<details><summary>Notes (8)</summary>

- **`list`** — No params. Returns every dashboard in the workspace, most recently updated first. Dashboards come back WITHOUT their tiles — `queryMappings` is only populated by get(). No pagination: there is no listAll variant and the resource never calls core/paginate.js, so the full array is returned in one response.
- **`get`** — `dashboardId` required. Returns the dashboard with its tile placements resolved (`queryMappings?: DashboardQueryMapping[]`), or null when not found. Registry type: SdkOperation<{ dashboardId: string }, Dashboard | null>.
- **`upsert`** — Create-or-update. Required: `name`, `createdBy` (the acting user's id — take it from sdk.users.me(), it is NOT derived from the session). Omit `id` to create: the SDK generates it client-side via newId() (crypto.randomUUID) BEFORE the call and returns it, so the returned id is client-minted, not server-minted. Pass an existing `id` to update. Async wrapper: awaits the mutate then returns { id }. Registry arg type has `id: string` (required) because the resource always fills it in.
- **`delete`** — `id` required — the dashboard id. Destructive; returns void. Note this shadows nothing but is a reserved-ish word, so call it as sdk.dashboards.delete('dash-1').
- **`updateLayout`** — Moves tiles around a dashboard. `DashboardLayoutUpdate = { id: string; sequence: number }` where `id` is the PLACEMENT id (mappingId), not the query id, and `sequence` is the new ascending position. Takes a bare array; the resource wraps it as { updates }. No dashboardId param — placements are addressed globally by their own ids.
- **`upsertQuery`** — Create-or-update a saved query, optionally placing it on a dashboard. Required: `title`, `queryJson` (the query definition, typed `unknown`), `createdBy` (from sdk.users.me()). Omit `id` to create — generated client-side with newId(). Placement logic: `mappingId = data.mappingId ?? (data.dashboardId ? newId() : undefined)` — so a placement id is minted ONLY when `dashboardId` is supplied, and `mappingId` is only included in the request body when it exists. Return is conditional: `{ id, mappingId }` when placed, `{ id }` when saved unplaced. KEEP the returned mappingId — updateLayout, reorderQueries and removal all address placements, not queries. `visualType` is how the tile renders (e.g. 'bar'); `entityType` is the entity the query reads; `targetEntity` is the entity the results point at.
- **`deleteQuery`** — `id` is the QUERY id, not a placement id. Deletes the saved query itself (which by the resource's own model can be placed on more than one dashboard), so this is broader than removing a tile.
- **`reorderQueries`** — Takes PLACEMENT ids (mappingIds) in their new display order; the array position is the new order. No dashboardId param. Overlaps with updateLayout — reorderQueries takes the whole ordered list, updateLayout sets explicit sequence numbers per placement.

</details>

## email

Support-desk email surface exposed as `sdk.email` (EmailResource): reading thread/sent mail, reply + compose drafts, read state, signatures, per-channel desk configuration (incl. AI classification), and conversation labels — sending mail is NOT part of this resource.

| method | signature | route |
|---|---|---|
| `listForConversations` | `listForConversations(conversationIds: string[], channelId: string, isMember?: boolean): Promise<Email[]>` | `POST /api/sdk/v1/query — body { op: "email.listForConversations", args: { conversationIds, channelId, isMember? } }` |
| `listSent` | `listSent(channelId: string, options?: { limit?: number; start?: EmailCursor; scope?: string; }): Promise<Email[]>` | `POST /api/sdk/v1/query — body { op: "email.listSent", args: { channelId, limit?, start?, scope? } }` |
| `listDrafts` | `listDrafts(channelId: string, options?: { limit?: number; start?: EmailDraftCursor; }): Promise<EmailDraft[]>` | `POST /api/sdk/v1/query — body { op: "email.listDrafts", args: { channelId, limit?, start? } }` |
| `getDraftForConversation` | `getDraftForConversation(conversationId: string, channelId: string, isMember?: boolean): Promise<EmailDraft \| null>` | `POST /api/sdk/v1/query — body { op: "email.getDraftForConversation", args: { conversationId, channelId, isMember? } }` |
| `listComposeDrafts` | `listComposeDrafts(channelId: string): Promise<EmailDraft[]>` | `POST /api/sdk/v1/query — body { op: "email.listComposeDrafts", args: { channelId } }` |
| `saveDraft` | `saveDraft(data: { id?: string; conversationId: string; channelId: string; draftContent?: string; toRecipients?: string[]; ccRecipients?: string[]; bccRecipients?: string[]; attachmentIds?: string[]; }): Promise<{ id: string; }>` | `POST /api/sdk/v1/mutate — body { op: "email.saveDraft", args: { ...data, id } }` |
| `deleteDraft` | `deleteDraft(conversationId: string): Promise<void>` | `POST /api/sdk/v1/mutate — body { op: "email.deleteDraft", args: { conversationId } }` |
| `saveComposeDraft` | `saveComposeDraft(data: { id?: string; channelId: string; subject?: string; fromAddress?: string; draftContent?: string; toRecipients?: string[]; ccRecipients?: string[]; bccRecipients?: string[]; attachmentIds?: string[]; }): Promise<{ id: string; }>` | `POST /api/sdk/v1/mutate — body { op: "email.saveComposeDraft", args: { ...data, id } }` |
| `deleteComposeDraft` | `deleteComposeDraft(id: string): Promise<void>` | `POST /api/sdk/v1/mutate — body { op: "email.deleteComposeDraft", args: { id } }` |
| `markAsRead` | `markAsRead(data: { id?: string; ticketId: string; lastReadEmailId: string; }): Promise<void>` | `POST /api/sdk/v1/mutate — body { op: "email.markAsRead", args: { ...data, id: data.id ?? newId() } }` |
| `bulkMarkAsRead` | `bulkMarkAsRead(items: EmailReadMarker[]): Promise<void>` | `POST /api/sdk/v1/mutate — body { op: "email.bulkMarkAsRead", args: { items } }` |
| `bulkMarkAsUnread` | `bulkMarkAsUnread(ticketIds: string[]): Promise<void>` | `POST /api/sdk/v1/mutate — body { op: "email.bulkMarkAsUnread", args: { ticketIds } }` |
| `listSignatures` | `listSignatures(): Promise<EmailSignature[]>` | `POST /api/sdk/v1/query — body { op: "email.listSignatures", args: undefined }` |
| `createSignature` | `createSignature(data: { name: string; content: string; }): Promise<{ id: string; }>` | `POST /api/sdk/v1/mutate — body { op: "email.createSignature", args: { id, ...data } }` |
| `updateSignature` | `updateSignature(id: string, data: { name: string; content: string; }): Promise<void>` | `POST /api/sdk/v1/mutate — body { op: "email.updateSignature", args: { id, ...data } }` |
| `deleteSignature` | `deleteSignature(id: string): Promise<void>` | `POST /api/sdk/v1/mutate — body { op: "email.deleteSignature", args: { id } }` |
| `setDefaultSignature` | `setDefaultSignature(id: string): Promise<void>` | `POST /api/sdk/v1/mutate — body { op: "email.setDefaultSignature", args: { id } }` |
| `getChannelPreference` | `getChannelPreference(channelId: string): Promise<EmailChannelPreference \| null>` | `POST /api/sdk/v1/query — body { op: "email.getChannelPreference", args: { channelId } }` |
| `setChannelPreference` | `setChannelPreference(channelId: string, data: { ownerUserId?: string; assigneeUserGroupId?: string; sendAsEmail?: boolean; defaultCc?: string[]; emailMergeMode?: string; twoStepSendEnabled?: boolean; autoDraftMode?: string; autoDraftAgentSlug?: string; metricsEnabled?: boolean; }): Promise<void>` | `POST /api/sdk/v1/mutate — body { op: "email.setChannelPreference", args: { channelId, ...data } }` |
| `setClassificationConfig` | `setClassificationConfig(data: { channelId: string; classificationEnabled: boolean; classificationPrompt: string; categoryField: string; subCategoryField?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate — body { op: "email.setClassificationConfig", args: data }` |
| `setPriorityClassificationConfig` | `setPriorityClassificationConfig(data: { channelId: string; priorityClassificationEnabled: boolean; priorityClassificationPrompt?: string; priorityClassificationThreshold?: number; }): Promise<void>` | `POST /api/sdk/v1/mutate — body { op: "email.setPriorityClassificationConfig", args: data }` |
| `listLabels` | `listLabels(channelId: string): Promise<ConversationLabel[]>` | `POST /api/sdk/v1/query — body { op: "email.listLabels", args: { channelId } }` |
| `listConversationsByLabel` | `listConversationsByLabel(labelId: string): Promise<ConversationLabelMapping[]>` | `POST /api/sdk/v1/query — body { op: "email.listConversationsByLabel", args: { labelId } }` |
| `createLabel` | `createLabel(data: { name: string; channelId: string; color?: string; }): Promise<{ id: string; }>` | `POST /api/sdk/v1/mutate — body { op: "email.createLabel", args: { id, ...data } }` |
| `applyLabel` | `applyLabel(data: { labelId: string; labelName: string; conversationId: string; channelId: string; color?: string; }): Promise<{ mappingId: string; }>` | `POST /api/sdk/v1/mutate — body { op: "email.applyLabel", args: { mappingId, ...data } }` |
| `removeLabel` | `removeLabel(conversationId: string, labelId: string): Promise<void>` | `POST /api/sdk/v1/mutate — body { op: "email.removeLabel", args: { conversationId, labelId } }` |

<details><summary>Notes (26)</summary>

- **`listForConversations`** — conversationIds and channelId are both required (channelId is required in V2 and is forwarded to the table ACL for channel-membership gating). isMember is an ACL hint and is omitted from the payload entirely when undefined; leave unset unless you know otherwise. Returns emails across every thread named, unpaginated (no limit/start).
- **`listSent`** — Server-side cursor pagination: EmailCursor = { id: string; createdAt: number } (ordered by creation). Pass the cursor from the previous page as options.start; limit is page size; scope narrows the listing (e.g. to one mailbox). Returns one page of mail the caller sent, newest first. There is no listAll variant — loop on the cursor yourself.
- **`listDrafts`** — The caller's own reply drafts in a channel. Cursor-paginated with EmailDraftCursor = { id: string; updatedAt: number } (ordered by last edit). Note the doc comment omits the options param but the signature and implementation both accept and forward it.
- **`getDraftForConversation`** — conversationId and channelId required; isMember is an ACL hint dropped from the payload when undefined. The underlying query has no .one() and returns a list ordered by updatedAt desc (there can legitimately be two rows: the caller's own draft and a shared one with null userId), so the registry applies mapResult: firstOrNull — the newest row, or null when there is none.
- **`listComposeDrafts`** — The caller's compose drafts — new mail not yet tied to a conversation. channelId required. Unpaginated (no limit/start).
- **`saveDraft`** — Upsert (create or replace): there is exactly one reply draft per conversation, so saving again replaces it. conversationId and channelId required. The client mints the id via newId() when data.id is omitted and always sends a concrete id, then returns { id } — so the caller knows the draft id without a round trip. draftContent is HTML; attachmentIds come from sdk.attachments.uploadDraft.
- **`deleteDraft`** — Gotcha: takes the CONVERSATION id, not the draft id — reply drafts are keyed by the conversation they reply to. Destructive: discards the thread's reply draft.
- **`saveComposeDraft`** — Upsert of a standalone compose draft (no conversation yet), so it carries its own subject/fromAddress/recipients. Only channelId is required. id generated client-side with newId() when omitted and returned as { id }; pass an existing id to overwrite that draft. attachmentIds come from sdk.attachments.uploadDraft.
- **`deleteComposeDraft`** — Takes the draft id (unlike deleteDraft, which takes a conversation id). Destructive.
- **`markAsRead`** — Marks a desk ticket's mail read up to lastReadEmailId. ticketId and lastReadEmailId required; id is the read-marker row id — pass it to update an existing marker, otherwise one is generated client-side. Returns void (the generated id is not surfaced).
- **`bulkMarkAsRead`** — EmailReadMarker = { id: string; ticketId: string } where id is the EMAIL id (the last email read) and ticketId the desk ticket. Both fields required per item; no client-side id generation here.
- **`bulkMarkAsUnread`** — Marks several desk tickets unread in one call; takes ticket ids only.
- **`listSignatures`** — No parameters — scoped to the calling user by their token; the operation's arg type is void and the resource passes undefined. Result includes which signature is the default.
- **`createSignature`** — Both name and content required (content is HTML). The id is always generated client-side with newId() — unlike saveDraft there is no way to supply your own — and returned as { id }.
- **`updateSignature`** — Full replace, not a patch: both name and content are required by the type, so send the current value for any field you are not changing.
- **`deleteSignature`** — Destructive; no confirmation or soft-delete.
- **`setDefaultSignature`** — Side effect: makes this signature the default for new mail, implicitly unsetting the previous default.
- **`getChannelPreference`** — At most one row per channel, but the underlying query omits .one() so the server sends a list; the registry unwraps it with mapResult: firstOrNull. Returns null when no configuration has been set for the channel.
- **`setChannelPreference`** — Partial update — every data field is optional and omitted fields are left alone. Side effects on desk behaviour: sendAsEmail (reply as email vs chat), twoStepSendEnabled (confirmation before sending), assigneeUserGroupId (routing of new mail), defaultCc (copied on every reply), emailMergeMode (how incoming mail is threaded), autoDraftMode / autoDraftAgentSlug (automatic AI drafting), metricsEnabled.
- **`setClassificationConfig`** — data is forwarded verbatim (no id generation, no reshaping). channelId, classificationEnabled, classificationPrompt and categoryField are ALL required even when disabling — classificationPrompt/categoryField are non-optional in the type. Side effect: turns AI categorisation of incoming mail on/off for the channel.
- **`setPriorityClassificationConfig`** — data forwarded verbatim. Only channelId and priorityClassificationEnabled are required; prompt and threshold are optional. Side effect: enables AI priority scoring, with mail above the threshold escalated.
- **`listLabels`** — Labels defined in a channel. The backend schema also wants an isMember ACL hint, but the registry supplies it so callers never pass it. Unpaginated.
- **`listConversationsByLabel`** — Returns one ConversationLabelMapping per thread carrying the label (mappings, not conversations). Unpaginated.
- **`createLabel`** — name and channelId required; color optional. id is always minted client-side with newId() and returned as { id } — you cannot supply your own.
- **`applyLabel`** — Requires labelId, labelName, conversationId and channelId — labelName (and optional color) are denormalised onto the mapping, so pass the label's current values. Returns { mappingId } (NOT { id }); the mappingId is generated client-side with newId(). Note removeLabel does not take the mappingId despite the doc saying it is 'needed to remove it later'.
- **`removeLabel`** — Takes both the conversation and the label because one thread can carry several labels. Keyed by (conversationId, labelId), not by the mappingId returned from applyLabel.

</details>

## forms

Custom forms, their fields, the context mappings that decide where a form applies (board / stage / release change), and the field values submitted against tickets and sub-tickets.

| method | signature | route |
|---|---|---|
| `get` | `get(formId: string): Promise<Form \| null>` | `POST /api/sdk/v1/query` |
| `list` | `list(): Promise<Form[]>` | `POST /api/sdk/v1/query` |
| `listLite` | `listLite(): Promise<Form[]>` | `POST /api/sdk/v1/query` |
| `listMappingsByContextIds` | `listMappingsByContextIds(contextIds: string[], contextType: FormContextType, entityType: FormEntityType): Promise<FormContextMapping[]>` | `POST /api/sdk/v1/query` |
| `listByContextType` | `listByContextType(contextType: FormContextType): Promise<Form[]>` | `POST /api/sdk/v1/query` |
| `listFields` | `listFields(formId: string): Promise<FormField[]>` | `POST /api/sdk/v1/query` |
| `getMapping` | `getMapping(contextId: string, contextType: FormContextType, entityType: FormEntityType): Promise<FormContextMapping \| null>` | `POST /api/sdk/v1/query` |
| `listMappingsForBoards` | `listMappingsForBoards(boardIds: string[]): Promise<FormContextMapping[]>` | `POST /api/sdk/v1/query` |
| `listValues` | `listValues(entityId: string): Promise<FormEntityValue[]>` | `POST /api/sdk/v1/query` |
| `listAllTicketValues` | `listAllTicketValues(): Promise<FormEntityValue[]>` | `POST /api/sdk/v1/query` |
| `update` | `update(data: { formId?: string; fields: FormFieldInput[]; projectId?: string; formDescription?: string; }): Promise<{ formId: string; }>` | `POST /api/sdk/v1/mutate` |
| `setMapping` | `setMapping(data: { contextId: string; contextType: FormContextType; entityType: FormEntityType; formId: string; }): Promise<{ mappingId: string; }>` | `POST /api/sdk/v1/mutate` |
| `deleteMapping` | `deleteMapping(contextId: string, contextType: FormContextType, entityType: FormEntityType): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `createValue` | `createValue(data: { entityId: string; entityType: FormEntityType; formId: string; fieldId: string; newValue: unknown; contextId?: string; version?: number; }): Promise<{ id: string; }>` | `POST /api/sdk/v1/mutate` |
| `updateValue` | `updateValue(formEntityValueId: string, newValue: unknown, options?: { expectedValueUpdatedAt?: number; }): Promise<void>` | `POST /api/sdk/v1/mutate` |

<details><summary>Notes (15)</summary>

- **`get`** — formId required. Returns the form row ALONE — no fields, no mappings; fetch fields separately with listFields(). Resolves to null when the form does not exist. No pagination.
- **`list`** — No params. Heavy read: returns EVERY form with its fields and context mappings resolved. Returns the whole array in one response — no server-side cursor, no limit/offset param; use core/paginate.ts `paginate(all, {limit, offset})` client-side if you need a window (DEFAULT_LIMIT=100, MAX_LIMIT=100). Use listLite() when you only need identifiers.
- **`listLite`** — No params. Same Form[] shape as list() but WITHOUT fields or mappings resolved — the cheap variant intended for populating a picker. Unbounded array, client-side pagination only.
- **`listMappingsByContextIds`** — All three params required and positional. Batch lookup: one mapping per context id that actually has a form bound, so the result can be shorter than contextIds. Mappings come back with their fields. FormContextType = 'BOARD' | 'RELEASE_CHANGE' | 'STAGE'; FormEntityType = 'TICKET' | 'SUB_TICKET' (the registry doc-comment also mentions RELEASE_MIGRATION_FORM | RELEASE_ENV_FORM, but the exported TS union in types/index.d.ts is only TICKET | SUB_TICKET). No pagination.
- **`listByContextType`** — contextType required ('BOARD' | 'RELEASE_CHANGE' | 'STAGE'). Returns every form bound anywhere within that context type. Registry types the wire arg loosely as { contextType: string }, but the public signature narrows it to FormContextType. No pagination.
- **`listFields`** — formId required. Fields come back in display (sequence) order. Call this before update() — update replaces the entire field list, so you need the current set to avoid dropping fields. No pagination.
- **`getMapping`** — All three params required and positional. Singular lookup: which form applies in one specific context. Returns null when nothing is bound there.
- **`listMappingsForBoards`** — boardIds required. Board-scoped convenience over listMappingsByContextIds — no contextType/entityType arguments; returns every mapping bound to any of those boards. No pagination.
- **`listValues`** — entityId required — the id of a ticket or sub-ticket. Returns the recorded field values for that one entity. Read the returned rows' `updatedAt` if you intend to pass expectedValueUpdatedAt to updateValue(). No pagination.
- **`listAllTicketValues`** — No params. Workspace-wide read of every ticket form value — potentially very large and entirely unbounded (no limit/offset arg, no cursor). Prefer listValues(entityId) unless you genuinely need the whole workspace; window the result with core/paginate.ts if you must call it.
- **`update`** — Upsert — there is no separate create method. Omit data.formId to create: the client mints the id locally via newId() and returns it, so the caller always gets a formId back. DESTRUCTIVE: `fields` REPLACES the entire field list — every field you omit is deleted, so call listFields() first and resend each field with its existing `id`. FormFieldInput = { id?: string; fieldName?: string; fieldType?: string; fieldEnum?: unknown; fieldOptions?: string; isOptional?: boolean; sequenceNumber?: number; globalFieldId?: string; parentOptionId?: string } (exported from registry/forms.js; note the .d.ts doc example shows `label`/`fieldType`/`sequence`, which do NOT match the actual interface keys fieldName/sequenceNumber). Underlying operation returns void; the resolved { formId } is synthesized client-side.
- **`setMapping`** — All four data fields required. The mappingId is ALWAYS generated client-side with newId() before the call and returned — there is no way to supply your own, and calling it again for the same context creates a new mapping id rather than reusing one. Side effect: binds the form so it applies in that context. Underlying operation returns void; { mappingId } is synthesized client-side.
- **`deleteMapping`** — All three params required and positional; identified by the context triple, not by mappingId. Side effect: unbinds the form from that context. Returns void — no confirmation of whether a mapping existed.
- **`createValue`** — Required: entityId, entityType ('TICKET' | 'SUB_TICKET'), formId, fieldId, newValue. Optional: contextId (board or stage the form was shown in), version (form version the value was captured against). The row id is generated client-side with newId() and returned. Records one value per field — call once per field. Underlying operation returns void; { id } is synthesized client-side.
- **`updateValue`** — formEntityValueId and newValue required. options.expectedValueUpdatedAt is an optimistic-concurrency guard: pass the `updatedAt` you last read (from listValues) and the server rejects the write if someone else changed the value since. Options are spread flat into the args object, not nested. Returns void.

</details>

## incidents

Root-cause analyses (RCAs) plus everything hanging off them — recorded impacts and their attachments, corrective actions (CoE), release tickets/changes/events, and the attributions linking an incident to the deploy that caused it.

| method | signature | route |
|---|---|---|
| `listRcas` | `listRcas(options?: { limit?: number; start?: RcaCursor }): Promise<Rca[]>` | `POST /api/sdk/v1/query (body { op: "incidents.listRcas", args })` |
| `getRca` | `getRca(rcaId: string): Promise<Rca \| null>` | `POST /api/sdk/v1/query (body { op: "incidents.getRca", args })` |
| `createRca` | `createRca(data: { ticketId: string; title: string; severity: Severity; bugTypeId: string; categoryTypeId: string; status: RcaStatus; ownerId?: string; summary?: string; rootCause?: string; issueCategoryId?: string; issueStartAt?: number }): Promise<{ id: string }>` | `POST /api/sdk/v1/mutate (body { op: "incidents.createRca", args })` |
| `updateRca` | `updateRca(id: string, data: { ticketId?: string; title?: string; summary?: string; rootCause?: string; severity?: Severity; bugTypeId?: string; categoryTypeId?: string; issueCategoryId?: string; issueStartAt?: number; status?: RcaStatus }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "incidents.updateRca", args })` |
| `createImpact` | `createImpact(data: { ticketId: string; rcaId: string; impactTypeId: string; impact: string }): Promise<{ id: string }>` | `POST /api/sdk/v1/mutate (body { op: "incidents.createImpact", args })` |
| `updateImpact` | `updateImpact(id: string, data: { impactTypeId?: string; impact?: string }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "incidents.updateImpact", args })` |
| `deleteImpact` | `deleteImpact(id: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "incidents.deleteImpact", args })` |
| `listImpactAttachments` | `listImpactAttachments(impactId: string): Promise<MessageAttachment[]>` | `POST /api/sdk/v1/query (body { op: "incidents.listImpactAttachments", args })` |
| `listAttachmentsForImpacts` | `listAttachmentsForImpacts(impactIds: string[]): Promise<MessageAttachment[]>` | `POST /api/sdk/v1/query (body { op: "incidents.listAttachmentsForImpacts", args })` |
| `createAction` | `createAction(data: { rcaId: string; ownerId: string; actionTypeId: string; action: string; status: CoeStatus; dueDate?: number }): Promise<{ id: string }>` | `POST /api/sdk/v1/mutate (body { op: "incidents.createAction", args })` |
| `updateAction` | `updateAction(id: string, data: { ownerId?: string; actionTypeId?: string; action?: string; status?: CoeStatus; dueDate?: number; completedAt?: number }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "incidents.updateAction", args })` |
| `deleteAction` | `deleteAction(id: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "incidents.deleteAction", args })` |
| `listReleaseTickets` | `listReleaseTickets(): Promise<Ticket[]>` | `POST /api/sdk/v1/query (body { op: "incidents.listReleaseTickets", args })` |
| `searchReleaseTickets` | `searchReleaseTickets(options?: { search?: string; limit?: number }): Promise<Ticket[]>` | `POST /api/sdk/v1/query (body { op: "incidents.searchReleaseTickets", args })` |
| `listApplicationReleaseTickets` | `listApplicationReleaseTickets(releaseId: string, limit?: number): Promise<ApplicationReleaseTicket[]>` | `POST /api/sdk/v1/query (body { op: "incidents.listApplicationReleaseTickets", args })` |
| `listReleaseChanges` | `listReleaseChanges(releaseId: string): Promise<ReleaseChange[]>` | `POST /api/sdk/v1/query (body { op: "incidents.listReleaseChanges", args })` |
| `listReleaseChangeFormValues` | `listReleaseChangeFormValues(releaseId: string): Promise<FormEntityValue[]>` | `POST /api/sdk/v1/query (body { op: "incidents.listReleaseChangeFormValues", args })` |
| `listReleaseChangeLog` | `listReleaseChangeLog(releaseId: string): Promise<FormEntityValue[]>` | `POST /api/sdk/v1/query (body { op: "incidents.listReleaseChangeLog", args })` |
| `createAttribution` | `createAttribution(data: { ticketId: string; releaseId: string; confidence: AttributionConfidence; releaseApplicationId?: string; rootCauseTicketId?: string }): Promise<{ id: string }>` | `POST /api/sdk/v1/mutate (body { op: "incidents.createAttribution", args })` |
| `updateAttribution` | `updateAttribution(id: string, data: { releaseId?: string; releaseApplicationId?: string; rootCauseTicketId?: string; confidence?: AttributionConfidence }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "incidents.updateAttribution", args })` |
| `deleteAttribution` | `deleteAttribution(id: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "incidents.deleteAttribution", args })` |
| `updateReleaseTicketStatus` | `updateReleaseTicketStatus(id: string, data: { stageName?: string; defaultTicketStatusV2?: string; failureReason?: string }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "incidents.updateReleaseTicketStatus", args })` |
| `setReleaseTicketTestedBy` | `setReleaseTicketTestedBy(id: string, userId: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "incidents.setReleaseTicketTestedBy", args })` |
| `listReleaseEvents` | `listReleaseEvents(releaseId: string, limit?: number): Promise<ReleaseEvent[]>` | `POST /api/sdk/v1/query (body { op: "incidents.listReleaseEvents", args })` |

<details><summary>Notes (24)</summary>

- **`listRcas`** — Read. Server-side cursor pagination: `start` is an `RcaCursor` ({ id: string; createdAt: number }) taken from the previous page's last row; `limit` is page size. Most recent first. No listAll variant — page manually by feeding the last item's cursor back in. Passing no options sends `{}`. Response is unwrapped from `response.data`.
- **`getRca`** — Read. `rcaId` required. Returns null when the RCA does not exist (so callers must null-check rather than try/catch).
- **`createRca`** — Write. Required: ticketId, title, severity, bugTypeId, categoryTypeId, status (usually 'DRAFT'). Side effect: the SDK mints the row id client-side via `newId()` (crypto.randomUUID) and sends it as `id` alongside the data; the registry op itself returns void, and the resource method returns that generated `{ id }`. `issueStartAt` is epoch milliseconds. An RCA hangs off a ticket.
- **`updateRca`** — Write. Partial update — every field optional, omitted fields are left alone. Note the .d.ts JSDoc calls the first param `rcaId` but the declared parameter name is `id`; it is flattened into the payload as `{ id, ...data }`.
- **`createImpact`** — Write. All four fields required. Side effect: id generated client-side with `newId()` and returned as `{ id }`. Impacts hang off an RCA (rcaId) and also carry the tracking ticketId.
- **`updateImpact`** — Write. Partial update; sent as `{ id, ...data }`.
- **`deleteImpact`** — Destructive write. Removes the recorded impact.
- **`listImpactAttachments`** — Read. Single impact's attachments. No limit/cursor — returns the full set.
- **`listAttachmentsForImpacts`** — Read. Batched form of listImpactAttachments — one call for many impacts, returning a flat array across every impact named. Prefer it over N single calls. No pagination.
- **`createAction`** — Write. Corrective action (CoE) attached to an RCA. Required: rcaId, ownerId, actionTypeId, action, status (usually 'OPEN'). `dueDate` is epoch milliseconds. Side effect: id minted client-side and returned as `{ id }`.
- **`updateAction`** — Write. Partial update. `completedAt` is accepted here but not on createAction; both it and `dueDate` are epoch milliseconds.
- **`deleteAction`** — Destructive write. Removes the corrective action.
- **`listReleaseTickets`** — Read. Takes no arguments at all — the registry op is typed `SdkOperation<void, Ticket[]>` and the implementation passes `undefined` as args. Returns every ticket of type Release in the workspace, unpaginated; use searchReleaseTickets when you need to narrow or cap it.
- **`searchReleaseTickets`** — Read. Name-text search over release tickets. Both fields optional (calling with no options sends `{}`, which degenerates to an unfiltered capped listing). `limit` caps results; no cursor.
- **`listApplicationReleaseTickets`** — Read. One row per dev ticket in the release, with test outcomes. `releaseId` required; `limit` is a positional second arg and is omitted from the payload entirely when undefined. The row ids returned here are the `id` values that updateReleaseTicketStatus and setReleaseTicketTestedBy take.
- **`listReleaseChanges`** — Read. Code changes bundled into the release, sourced from the repository scan. No limit/cursor.
- **`listReleaseChangeFormValues`** — Read. Form field values captured against the release's changes. Same FormEntityValue[] return shape as listReleaseChangeLog — different operation, different data.
- **`listReleaseChangeLog`** — Read. Change-log entries for the release. No pagination.
- **`createAttribution`** — Write. Links a ticket to the release held responsible. Required: ticketId, releaseId, confidence (e.g. 'HIGH'). Optional `releaseApplicationId` narrows to an application within the release; `rootCauseTicketId` names the change that introduced the fault. Side effect: id minted client-side and returned as `{ id }`.
- **`updateAttribution`** — Write. Partial update. Note `ticketId` is NOT updatable here — it can only be set at creation; re-pointing an attribution at a different ticket means delete + create.
- **`deleteAttribution`** — Destructive write. Removes the release attribution.
- **`updateReleaseTicketStatus`** — Write. `id` is the application-release-ticket row id (from listApplicationReleaseTickets), NOT a ticket id or release id. All data fields optional: `stageName` moves the stage, `defaultTicketStatusV2` sets the accompanying status, `failureReason` explains a failed test.
- **`setReleaseTicketTestedBy`** — Write. Both params required and positional (not a data object) — sent as `{ id, userId }`. `id` is the application-release-ticket row id; `userId` is the user who signed the ticket off in testing.
- **`listReleaseEvents`** — Read. Release timeline, newest first. `FORM_SAVED` events are filtered out server-side as noise. `limit` is positional and capped at 100 server-side; it is omitted from the payload when undefined. No cursor — you cannot page past the cap.

</details>

## preferences

The calling user's own settings — notification levels and keywords, per-channel notification overrides, interface/sidebar behaviour, profile card, presence/status, bookmarks, and saved filter views (exposed on SpacesClient as the `preferences` property; class PreferencesResource).

| method | signature | route |
|---|---|---|
| `get` | `get(): Promise<UserPreferences \| null>` | `POST /api/sdk/v1/query` |
| `setNotificationSettings` | `setNotificationSettings(data: { id?: string; globalDesktopNotificationLevel?: NotificationLevel; globalMobileNotificationLevel?: NotificationLevel; threadReplyNotificationsEnabled?: boolean; channelWideMentionsEnabled?: boolean; }): Promise<void>` | `POST /api/sdk/v1/mutate (op: "preferences.setNotificationSettings")` |
| `setNotificationKeywords` | `setNotificationKeywords(keywords: string[], options?: { id?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate (op: "preferences.setNotificationKeywords")` |
| `setChannelNotifications` | `setChannelNotifications(channelId: string, data: { desktopNotificationLevel?: NotificationLevel \| null; mobileNotificationLevel?: NotificationLevel \| null; threadReplyNotificationsEnabled?: boolean \| null; channelWideMentionsEnabled?: boolean \| null; }): Promise<void>` | `POST /api/sdk/v1/mutate (op: "preferences.setChannelNotifications")` |
| `setChannelSortOrder` | `setChannelSortOrder(channelSortOrder: ChannelSortOrder, options?: { id?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate (op: "preferences.setChannelSortOrder")` |
| `setEnterSendsMessage` | `setEnterSendsMessage(enterSendsMessage: boolean, options?: { id?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate (op: "preferences.setEnterSendsMessage")` |
| `setShowThreadTags` | `setShowThreadTags(showThreadTags: boolean, options?: { id?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate (op: "preferences.setShowThreadTags")` |
| `setAllowThreadBroadcastMentions` | `setAllowThreadBroadcastMentions(allowThreadBroadcastMentions: boolean, options?: { id?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate (op: "preferences.setAllowThreadBroadcastMentions")` |
| `updateProfile` | `updateProfile(data: { profileId?: string; displayName?: string; pronunciation?: string; team?: string; phoneNumber?: string; dob?: number; manager?: string; }): Promise<{ profileId: string; }>` | `POST /api/sdk/v1/mutate (op: "preferences.updateProfile")` |
| `updatePresence` | `updatePresence(data: { presenceId?: string; statusEmoji?: string; statusContent?: string; statusExpiryAt?: number; assignmentUnavailableUntil?: number; notificationsPausedUntil?: number; }): Promise<{ presenceId: string; }>` | `POST /api/sdk/v1/mutate (op: "preferences.updatePresence")` |
| `listBookmarks` | `listBookmarks(): Promise<Bookmark[]>` | `POST /api/sdk/v1/query (op: "preferences.listBookmarks", args: undefined)` |
| `addBookmark` | `addBookmark(data: { entityId: string; entityType: BookmarkEntityType; metadata?: unknown; }): Promise<{ bookmarkId: string; }>` | `POST /api/sdk/v1/mutate (op: "preferences.addBookmark")` |
| `removeBookmark` | `removeBookmark(entityId: string, entityType: BookmarkEntityType, options?: { markAsDone?: boolean; }): Promise<void>` | `POST /api/sdk/v1/mutate (op: "preferences.removeBookmark")` |
| `updateBookmark` | `updateBookmark(entityId: string, entityType: BookmarkEntityType, metadata: unknown): Promise<void>` | `POST /api/sdk/v1/mutate (op: "preferences.updateBookmark")` |
| `listSavedViews` | `listSavedViews(userId: string): Promise<SavedView[]>` | `POST /api/sdk/v1/query (op: "preferences.listSavedViews", args: { userId })` |
| `createSavedView` | `createSavedView(data: { name: string; contextType: SavedConfigContextType; contextId: string; channelId: string; visibility: SavedConfigVisibility; values: unknown; }): Promise<{ id: string; }>` | `POST /api/sdk/v1/mutate (op: "preferences.createSavedView")` |
| `updateSavedView` | `updateSavedView(configId: string, data: { values: unknown; name?: string; visibility?: SavedConfigVisibility; isStarred?: boolean; }): Promise<void>` | `POST /api/sdk/v1/mutate (op: "preferences.updateSavedView")` |
| `deleteSavedView` | `deleteSavedView(configId: string): Promise<void>` | `POST /api/sdk/v1/mutate (op: "preferences.deleteSavedView")` |
| `setSidebarGroup` | `setSidebarGroup(id: string, group: 'starred' \| 'channels' \| 'dms', options?: { filterMode?: ChannelFilterMode; sortOrder?: ChannelSortOrder; }): Promise<void>` | `POST /api/sdk/v1/mutate (op: "preferences.setSidebarGroup")` |

<details><summary>Notes (19)</summary>

- **`get`** — No params. Every method on this resource is an SdkOperation (registry/preferences.js uses op(id, 'query'|'mutator')), so Transport.executeV1 posts to /api/sdk/v1/query for kind 'query' and /api/sdk/v1/mutate for kind 'mutator'; there are no direct REST routes here. Returns null before any preference row exists. Read `id` off this row to reuse the same preference row explicitly in the `id`-taking mutators below.
- **`setNotificationSettings`** — The `data` object is required; all its fields are optional and omitted fields are left alone. Side effect: if `data.id` is omitted the SDK generates one client-side via newId() and sends it, creating a new preference row — pass the id from get() to update the existing row instead. Registry arg type has `id: string` (required on the wire).
- **`setNotificationKeywords`** — `keywords` required and replaces the whole list (max 50 keywords, each up to 80 chars). Side effect: `options.id` defaults to newId(), so omitting it writes a fresh preference row.
- **`setChannelNotifications`** — Both `channelId` and the `data` object are required. Passing `null` for a field clears that per-channel override so it falls back to the global setting. Unlike the other mutators this one takes no preference-row `id` and generates nothing.
- **`setChannelSortOrder`** — `channelSortOrder` required (e.g. 'RECENCY'); controls sidebar channel ordering. Side effect: `options.id` defaults to newId().
- **`setEnterSendsMessage`** — true = Enter sends the message, false = Shift+Enter sends. Side effect: `options.id` defaults to newId().
- **`setShowThreadTags`** — Shows/hides thread classification chips in chat. Side effect: `options.id` defaults to newId().
- **`setAllowThreadBroadcastMentions`** — Allows or blocks @channel and @here inside thread replies. Side effect: `options.id` defaults to newId().
- **`updateProfile`** — All fields optional; omitted fields are left alone. `dob` is epoch milliseconds, `manager` is a user id. Side effect: `profileId` defaults to a client-generated newId(); the method awaits the mutation and returns { profileId } (the supplied or generated id) rather than the server response.
- **`updatePresence`** — All fields optional. `statusExpiryAt`, `assignmentUnavailableUntil` and `notificationsPausedUntil` are epoch milliseconds. Side effects: pauses ticket assignment / mutes notifications until those times; `presenceId` defaults to newId() and is returned as { presenceId }.
- **`listBookmarks`** — No params, caller-scoped; returns saved references to messages, threads, tickets and canvases. Returns the full array in one response — no limit/offset or cursor, and this resource never calls core/paginate.ts, so there is no list vs listAll split here. Window client-side with paginate() if needed (DEFAULT_LIMIT and MAX_LIMIT are both 100).
- **`addBookmark`** — `entityId` and `entityType` required (e.g. 'TICKET'); `metadata` optional (e.g. a reminder time). Side effect: `bookmarkId` is always generated client-side with newId() — it cannot be supplied — and returned as { bookmarkId }.
- **`removeBookmark`** — Addressed by entity, not by bookmark id: both `entityId` and `entityType` are required. `options.markAsDone: true` completes the bookmark instead of deleting it; otherwise the call is destructive.
- **`updateBookmark`** — All three params required. `metadata` replaces the existing metadata wholesale (e.g. { remindAt: Date.now() }).
- **`listSavedViews`** — `userId` is required — the registry notes the underlying query has no `ctx` fallback, so it is NOT implicitly caller-scoped; pass `(await sdk.users.me()).id` for your own views. Returns the full array, unpaginated.
- **`createSavedView`** — Every field is required: name, contextType (e.g. 'BOARD'), contextId, channelId, visibility (e.g. 'PRIVATE'), and values (the filter configuration itself). Side effect: the view `id` is generated client-side with newId() and returned as { id }.
- **`updateSavedView`** — `configId` required, and `data.values` is required even for a rename — it replaces the filter configuration wholesale. `isStarred: true` pins the view to the top of the list.
- **`deleteSavedView`** — `configId` required. Destructive; no soft-delete option.
- **`setSidebarGroup`** — The only mutator where the preference-row `id` is a required positional param — nothing is generated for you, so read it from get() first. `group` is required. Registry notes filterMode is ACTIVE | UNREADS | MENTIONS | ALL.

</details>

## recaps

Daily AI-generated channel and project recaps — reading them by day, managing subscriptions/custom prompts/read state, plus entity-level nudge queries.

| method | signature | route |
|---|---|---|
| `listForChannels` | `listForChannels(channelIds: string[], recapDate: number): Promise<Recap[]>` | `POST /api/sdk/v1/query` |
| `listDaily` | `listDaily(channelIds: string[], recapDate: number): Promise<Recap[]>` | `POST /api/sdk/v1/query` |
| `listForProjects` | `listForProjects(recapDate: number): Promise<Recap[]>` | `POST /api/sdk/v1/query` |
| `saveSubscriptions` | `saveSubscriptions(channelIds: string[]): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `setCustomPrompt` | `setCustomPrompt(channelId: string, prompt: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `markSeen` | `markSeen(recapDate: number): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `markChannelRead` | `markChannelRead(channelId: string, recapDate: number): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `markChannelUnread` | `markChannelUnread(channelId: string): Promise<void>` | `POST /api/sdk/v1/mutate` |
| `listEntityNudges` | `listEntityNudges(sourceId: string, states?: NudgeState[]): Promise<Nudge[]>` | `POST /api/sdk/v1/query` |
| `listNudgesByCountRows` | `listNudgesByCountRows(countRowIds: string[]): Promise<Nudge[]>` | `POST /api/sdk/v1/query` |

<details><summary>Notes (10)</summary>

- **`listForChannels`** — Body: { op: 'recaps.listForChannels', args: { channelIds, recapDate } }; response returned from `response.data`. Both params required. `recapDate` is epoch milliseconds identifying the day summarised. Returns one Recap per channel that has one for that day (channels with no recap are simply absent). No pagination — the full array is returned; no listAll variant.
- **`listDaily`** — Body: { op: 'recaps.listDaily', args: { channelIds, recapDate } }. Both params required. Superset of listForChannels: returns the base recap rows plus any per-user custom variants generated from the caller's custom prompts (see setCustomPrompt). No pagination.
- **`listForProjects`** — Body: { op: 'recaps.listForProjects', args: { recapDate } }. `recapDate` required (epoch ms). Takes no ids — scoped implicitly to the caller; returns project recaps written for the caller on that day. No pagination.
- **`saveSubscriptions`** — Body: { op: 'recaps.saveSubscriptions', args: { channelIds } }; mutator, returns `response.generated ?? response` (typed void). DESTRUCTIVE/REPLACING: sets the caller's entire recap-subscription list rather than adding to it — any channel omitted from `channelIds` is unsubscribed. Read the current set first and merge if you only mean to add one.
- **`setCustomPrompt`** — Body: { op: 'recaps.setCustomPrompt', args: { channelId, prompt } }. Both params required. Side effect: stores a per-caller instruction that shapes how that channel's future recaps are generated; the resulting per-user variants surface via listDaily.
- **`markSeen`** — Body: { op: 'recaps.markSeen', args: { recapDate } }. Marks the caller's whole day of recaps as seen (day-level, not per channel). `recapDate` in epoch ms.
- **`markChannelRead`** — Body: { op: 'recaps.markChannelRead', args: { channelId, recapDate } }. Both required — read state here is per (channel, day).
- **`markChannelUnread`** — Body: { op: 'recaps.markChannelUnread', args: { channelId } }. Asymmetric with markChannelRead: takes NO recapDate — restores the channel's recap to unread without naming a day.
- **`listEntityNudges`** — Body: { op: 'recaps.listEntityNudges', args: { sourceId, states? } }; `states` is omitted from the args object entirely when undefined (`...(states ? { states } : {})`). `sourceId` required — id of the entity the nudges hang off (e.g. a ticket). `NudgeState = 'ACTIVE' | 'DISMISSED' | 'ACTED_ON'`; defaults to active nudges only when `states` is not passed. Message-level nudges, and dismissing or acting on any nudge, are NOT here — they live on `sdk.activities`. No pagination.
- **`listNudgesByCountRows`** — Body: { op: 'recaps.listNudgesByCountRows', args: { countRowIds } }. Required. Expands aggregate nudge count rows into the individual Nudge rows rolled into them (matches `Nudge.surfaceNudgeCountId`). Returns a flat array across all supplied ids; no pagination.

</details>

## supportTickets

Read-only support-desk view of ticket rows: email-driven tickets in a desk channel, ordered by most recent email, with desk-specific filters (assignee, priority, stage, AI category, draft state); all writes go through sdk.tickets, which operates on the same rows.

| method | signature | route |
|---|---|---|
| `list` | `list(channelId: string, options?: { limit?: number; start?: SupportTicketCursor; dir?: 'forward' \| 'backward'; assignedTo?: string[]; priority?: TicketPriority[]; stageName?: string[]; isMember?: boolean; }): Promise<Ticket[]>` | `POST /api/sdk/v1/query` |
| `listFiltered` | `listFiltered(channelId: string, filters?: { merchantMid?: string; assignedTo?: string[]; priority?: TicketPriority[]; stageName?: string[]; aiCategory?: string[]; hasAiDraft?: boolean; userGroups?: string[]; lastEmailAtStart?: number; lastEmailAtEnd?: number; formEntityValueFieldIds?: string[]; isMember?: boolean; }): Promise<Ticket[]>` | `POST /api/sdk/v1/query` |
| `get` | `get(id: string, channelId: string, options?: { isMember?: boolean; }): Promise<Ticket \| null>` | `POST /api/sdk/v1/query` |
| `getByKey` | `getByKey(xyneId: string, workspaceId: string, channelId: string, options?: { isMember?: boolean; }): Promise<Ticket \| null>` | `POST /api/sdk/v1/query` |
| `getDetail` | `getDetail(options: { workspaceId: string; channelId: string; id?: string; xyneId?: string; isMember?: boolean; }): Promise<Ticket \| null>` | `POST /api/sdk/v1/query` |
| `listForEmailChannels` | `listForEmailChannels(options?: { channelId?: string; merchantMid?: string; }): Promise<Ticket[]>` | `POST /api/sdk/v1/query` |

<details><summary>Notes (6)</summary>

- **`list`** — Required: channelId (positional). The only cursor-paginated method on the resource — there is no listAll counterpart. Paging is bidirectional server-side: `start` is a SupportTicketCursor `{ id: string; lastEmailAt: number }` taken from the previous page, and `dir` ('forward' | 'backward') walks either way from it. Ordered by most recent email (lastEmailAt), not creation. `limit` is a real server-side page size here (core/paginate.ts client-side windowing with DEFAULT_LIMIT/MAX_LIMIT = 100 is NOT used by this resource — no method calls paginate()). `isMember` is an ACL fast-path hint, not a filter; leave unset unless you know otherwise. `priority` values: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'. Read-only. SupportTicketCursor is exported from ../registry/support-tickets.js and re-exported (type-only) by the resource module.
- **`listFiltered`** — Required: channelId (positional); every filter is optional. UNPAGINATED — returns every matching row in one response; no limit/start/dir accepted. Intended for the filtered desk sidebar views, not for walking a large inbox. Supports the full desk filter set including AI categorisation (`aiCategory`) and whether a drafted reply is waiting (`hasAiDraft`). `lastEmailAtStart` / `lastEmailAtEnd` are epoch milliseconds. `formEntityValueFieldIds` names custom fields to resolve on each returned row. `isMember` is an ACL hint, not a filter. Read-only.
- **`get`** — Required: id and channelId (both positional). Returns null if the ticket is not in that channel — the channel scope is part of the lookup, not just a filter. Resolves the relations the desk list view renders (lighter than getDetail). `isMember` is an ACL hint. Read-only.
- **`getByKey`** — Required: xyneId, workspaceId, channelId (all three positional). `xyneId` is the human-readable ticket key, e.g. 'SETL-0002'. `workspaceId` must come from `await sdk.users.me()` (me.workspaceId). Returns null if the key is unknown in that workspace/channel. `isMember` is an ACL hint. Read-only.
- **`getDetail`** — Single required options object (not positional args). workspaceId and channelId are required; pass EXACTLY ONE of `id` or `xyneId`. workspaceId comes from `sdk.users.me()`. Returns the ticket with its detail relations, or null. Registry note: the V2 backend resolves fewer relations than V1 — it drops the caller-scoped `emailDrafts` / `emailReads` and the `conversation`; neither was part of the declared `Ticket` result so the typed surface is unchanged, but read email state through `sdk.email` instead. `isMember` is an ACL hint. Read-only.
- **`listForEmailChannels`** — No required params — callable as `sdk.supportTickets.listForEmailChannels()`. Spans every email channel the caller can see; `channelId` narrows to one channel and `merchantMid` to one merchant. Unpaginated (no limit/cursor). Note the args are passed through as the whole options object, so `args` is `undefined` when the caller passes nothing (the registry types this operand as `{...} | undefined`). Read-only.

</details>

## userGroups

Teams (user groups): their membership and the assignment-routing configuration — on-call state, board weights, expertise, and auto rotation — exposed on SpacesClient as `userGroups`.

| method | signature | route |
|---|---|---|
| `list` | `list(): Promise<UserGroup[]>` | `POST /api/sdk/v1/query (body { op: "userGroups.list", args: undefined })` |
| `getMany` | `getMany(groupIds: string[]): Promise<UserGroup[]>` | `POST /api/sdk/v1/query (body { op: "userGroups.getMany", args: { groupIds } })` |
| `get` | `get(userGroupId: string): Promise<UserGroup \| null>` | `POST /api/sdk/v1/query (body { op: "userGroups.get", args: { userGroupId } })` |
| `search` | `search(query: string, options?: { limit?: number; }): Promise<UserGroup[]>` | `POST /api/sdk/v1/query (body { op: "userGroups.search", args: { query, ...options } })` |
| `listMembers` | `listMembers(userGroupId: string): Promise<UserGroupMember[]>` | `POST /api/sdk/v1/query (body { op: "userGroups.listMembers", args: { userGroupId } })` |
| `listMembersForGroups` | `listMembersForGroups(userGroupIds: string[]): Promise<UserGroupMember[]>` | `POST /api/sdk/v1/query (body { op: "userGroups.listMembersForGroups", args: { userGroupIds } })` |
| `listMine` | `listMine(): Promise<UserGroupMember[]>` | `POST /api/sdk/v1/query (body { op: "userGroups.listMine", args: undefined })` |
| `update` | `update(userGroupId: string, data: { name?: string; alias?: string; description?: string; userRoleUpdates?: Record<string, string>; userResponsibilityUpdates?: Record<string, string>; }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "userGroups.update", args: { userGroupId, ...data } })` |
| `delete` | `delete(userGroupId: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "userGroups.delete", args: { userGroupId } })` |
| `deactivate` | `deactivate(userGroupId: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "userGroups.deactivate", args: { userGroupId } })` |
| `reactivate` | `reactivate(userGroupId: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "userGroups.reactivate", args: { userGroupId } })` |
| `addUsers` | `addUsers(userGroupId: string, userIds: string[], options?: { roleIds?: string[]; }): Promise<{ mappingIds: Record<string, string>; }>` | `POST /api/sdk/v1/mutate (body { op: "userGroups.addUsers", args: { userGroupId, userIds, mappingIds, ...options } })` |
| `removeUsers` | `removeUsers(userGroupId: string, userIds: string[]): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "userGroups.removeUsers", args: { userGroupId, userIds } })` |
| `listAssignmentStates` | `listAssignmentStates(userGroupId: string): Promise<UserAssignmentState[]>` | `POST /api/sdk/v1/query (body { op: "userGroups.listAssignmentStates", args: { userGroupId } })` |
| `listAssignmentStatesForGroups` | `listAssignmentStatesForGroups(userGroupIds: string[]): Promise<UserAssignmentState[]>` | `POST /api/sdk/v1/query (body { op: "userGroups.listAssignmentStatesForGroups", args: { userGroupIds } })` |
| `listWorkloadMappings` | `listWorkloadMappings(userGroupId: string): Promise<UserWorkloadMapping[]>` | `POST /api/sdk/v1/query (body { op: "userGroups.listWorkloadMappings", args: { userGroupId } })` |
| `getAssignmentStateForUser` | `getAssignmentStateForUser(userId: string): Promise<UserAssignmentState[]>` | `POST /api/sdk/v1/query (body { op: "userGroups.getAssignmentStateForUser", args: { userId } })` |
| `listExpertise` | `listExpertise(userGroupId: string, boardId: string): Promise<UserExpertiseMapping[]>` | `POST /api/sdk/v1/query (body { op: "userGroups.listExpertise", args: { userGroupId, boardId } })` |
| `updateAssignmentConfig` | `updateAssignmentConfig(data: { userGroupId: string; userStates: unknown; userMappings: unknown; boardWeight: unknown; expertiseMappings: unknown; stateIds?: unknown; complexityScoreId?: string; mappingIds?: unknown; }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "userGroups.updateAssignmentConfig", args: data })` |
| `toggleAutoRotation` | `toggleAutoRotation(userGroupId: string, autoRotationEnabled: boolean, options?: { rotationInterval?: RotationInterval; rotationStartDate?: number; }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "userGroups.toggleAutoRotation", args: { userGroupId, autoRotationEnabled, ...options } })` |

<details><summary>Notes (20)</summary>

- **`list`** — No params. Returns every group in the workspace, active and inactive — no server-side filtering or pagination; there is no listAll variant and paginate() is not used anywhere in this resource.
- **`getMany`** — Required: groupIds. Batch form of get(); unknown ids are silently skipped, so the result array may be shorter than the input and is not positionally aligned.
- **`get`** — Required: userGroupId. Resolves to null (not a throw) when the group does not exist.
- **`search`** — Required: query (matched against group names). options.limit is spread into args; the registry notes limit is required by the underlying query and accepts null for no cap, so omitting it relies on the server defaulting it.
- **`listMembers`** — Required: userGroupId. One membership row per member including responsibility and rotation position. Full set in one response, no pagination.
- **`listMembersForGroups`** — Required: userGroupIds. Batch form of listMembers — one round trip for many groups; rows from all groups are flattened into a single array.
- **`listMine`** — No params. Identity comes from the caller's access token on the transport, not from an argument.
- **`update`** — Required: userGroupId and a data object (all of its fields optional; omitted fields are left alone). userRoleUpdates / userResponsibilityUpdates are maps keyed by user id. Write; returns void.
- **`delete`** — Required: userGroupId. Destructive — removes the group. Use deactivate() to stop routing while keeping the group and its membership.
- **`deactivate`** — Required: userGroupId. Side effect: the group stops receiving assignments; the group row and its membership survive. Reversible via reactivate().
- **`reactivate`** — Required: userGroupId. Inverse of deactivate(); the group receives assignments again.
- **`addUsers`** — Required: userGroupId, userIds. Client-side id minting: the method calls newIdMap(userIds) (crypto.randomUUID per user) BEFORE the request, sends those membership ids as args.mappingIds, and returns { mappingIds } keyed by user id — the only method on this resource that returns generated ids. options.roleIds is positional: roleIds[i] applies to userIds[i]. async; awaits the mutate then returns.
- **`removeUsers`** — Required: userGroupId, userIds. Write; returns void.
- **`listAssignmentStates`** — Required: userGroupId. One state row per member: who is on call and taking work. Read this (with listExpertise) before calling updateAssignmentConfig.
- **`listAssignmentStatesForGroups`** — Required: userGroupIds. Batch form of listAssignmentStates — one round trip instead of one per group when rendering a roster; rows across all named groups are returned flattened.
- **`listWorkloadMappings`** — Required: userGroupId. Per-member, per-board counts of active and total assignments. Pairs with listAssignmentStates: that says who is available, this says how much each already holds.
- **`getAssignmentStateForUser`** — Required: userId (a user id, not a group id). Despite the get* name it returns an array — one state row per group the user belongs to.
- **`listExpertise`** — Both userGroupId and boardId are required — expertise is always scoped to a board. Returns one row per member with their share and ticket cap for that board.
- **`updateAssignmentConfig`** — Single object param passed straight through (no spreading, no client-side id minting). Required: userGroupId, userStates, userMappings, boardWeight, expertiseMappings — the last four are typed `unknown` and deliberately unmodelled because the shapes are nested and interdependent. Read-modify-write: fetch the current config with listAssignmentStates and listExpertise, modify, send back. Optional: stateIds (ids of existing state rows being updated), complexityScoreId, mappingIds (ids of existing membership rows). Replaces on-call state, board weights, and expertise for the group in one call.
- **`toggleAutoRotation`** — Required: userGroupId, autoRotationEnabled (explicit boolean, not a flip). options.rotationInterval is the RotationInterval union — 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'; options.rotationStartDate is epoch milliseconds (e.g. Date.now()). Side effect: enables/disables automatic advancement of the on-call rotation.

</details>

## workspace

Workspace-level shared items on `SpacesClient.workspace` (WorkspaceResource): shared links, connected git repositories, SDLC hub channels/tracks, custom emoji, reference data (lookup values, merchants, ticket tags), and mail classification routing rules.

| method | signature | route |
|---|---|---|
| `createLink` | `createLink(data: { url: string; title: string; channelId: string; visibility: LinkVisibility; description?: string; favicon?: string; }): Promise<{ id: string; }>` | `POST /api/sdk/v1/mutate (body { op: "workspace.createLink", args })` |
| `updateLink` | `updateLink(id: string, data: { title?: string; description?: string; favicon?: string; visibility?: LinkVisibility; }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "workspace.updateLink", args })` |
| `deleteLink` | `deleteLink(id: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "workspace.deleteLink", args })` |
| `shareLink` | `shareLink(linkId: string, userIds: string[]): Promise<{ accessIds: Record<string, string>; }>` | `POST /api/sdk/v1/mutate (body { op: "workspace.shareLink", args })` |
| `unshareLink` | `unshareLink(linkId: string, userId: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "workspace.unshareLink", args })` |
| `listRepos` | `listRepos(): Promise<Repo[]>` | `POST /api/sdk/v1/query (body { op: "workspace.listRepos", args: undefined })` |
| `createRepo` | `createRepo(data: { name: string; url: string; baseBranch: string[]; prefix: string; }): Promise<{ id: string; }>` | `POST /api/sdk/v1/mutate (body { op: "workspace.createRepo", args })` |
| `updateRepo` | `updateRepo(id: string, data: { name?: string; url?: string; baseBranch?: string[]; prefix?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "workspace.updateRepo", args })` |
| `deleteRepo` | `deleteRepo(id: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "workspace.deleteRepo", args })` |
| `addRepoBranch` | `addRepoBranch(id: string, branchName: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "workspace.addRepoBranch", args })` |
| `getSdlcChannel` | `getSdlcChannel(channelId: string): Promise<Channel \| null>` | `POST /api/sdk/v1/query (body { op: "workspace.getSdlcChannel", args })` |
| `listSdlcTracks` | `listSdlcTracks(channelId: string): Promise<SdlcTrack[]>` | `POST /api/sdk/v1/query (body { op: "workspace.listSdlcTracks", args })` |
| `createSdlcTrack` | `createSdlcTrack(data: { repoId: string; name: string; description?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "workspace.createSdlcTrack", args })` |
| `updateSdlcTrack` | `updateSdlcTrack(trackId: string, updates: { name?: string; description?: string \| null; status?: SdlcTrackStatus; }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "workspace.updateSdlcTrack", args })` |
| `listEmojis` | `listEmojis(): Promise<CustomEmoji[]>` | `POST /api/sdk/v1/query (body { op: "workspace.listEmojis", args: undefined })` |
| `getEmoji` | `getEmoji(emojiId: string): Promise<CustomEmoji \| null>` | `POST /api/sdk/v1/query (body { op: "workspace.getEmoji", args })` |
| `getEmojiByName` | `getEmojiByName(name: string): Promise<CustomEmoji \| null>` | `POST /api/sdk/v1/query (body { op: "workspace.getEmojiByName", args })` |
| `listLookupValues` | `listLookupValues(type: LookupType): Promise<LookupValue[]>` | `POST /api/sdk/v1/query (body { op: "workspace.listLookupValues", args })` |
| `listMerchants` | `listMerchants(): Promise<Merchant[]>` | `POST /api/sdk/v1/query (body { op: "workspace.listMerchants", args: undefined })` |
| `listTicketTags` | `listTicketTags(projectId: string): Promise<TicketTag[]>` | `POST /api/sdk/v1/query (body { op: "workspace.listTicketTags", args })` |
| `listClassificationMappings` | `listClassificationMappings(channelId: string): Promise<ClassificationMapping[]>` | `POST /api/sdk/v1/query (body { op: "workspace.listClassificationMappings", args })` |
| `createClassificationMapping` | `createClassificationMapping(data: { channelId: string; category: string; userGroupId: string; subCategory?: string; }): Promise<{ id: string; }>` | `POST /api/sdk/v1/mutate (body { op: "workspace.createClassificationMapping", args })` |
| `updateClassificationMapping` | `updateClassificationMapping(id: string, data: { category?: string; subCategory?: string; userGroupId?: string; }): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "workspace.updateClassificationMapping", args })` |
| `deleteClassificationMapping` | `deleteClassificationMapping(id: string): Promise<void>` | `POST /api/sdk/v1/mutate (body { op: "workspace.deleteClassificationMapping", args })` |

<details><summary>Notes (24)</summary>

- **`createLink`** — Required: url, title, channelId, visibility. Side effect: the SDK mints the link id client-side via newId() (crypto.randomUUID) and sends it as `id` in args, then returns { id } — the id is known without a re-read. No pagination.
- **`updateLink`** — Required: id (positional). Partial update — omitted fields are left alone; args sent as { id, ...data }. Returns void.
- **`deleteLink`** — Required: id. Destructive: removes the shared link.
- **`shareLink`** — Required: linkId, userIds. Side effect: the SDK generates one access-grant id per user (newIdMap) and sends them as a positional array `accessIds` aligned to `userIds`, while returning them to the caller keyed by user id.
- **`unshareLink`** — Required: linkId, userId. Revokes one person's access; use once per user.
- **`listRepos`** — No params. Returns the full array in one response — no server cursor, no list/listAll split, no limit/offset. Window client-side with core/paginate.js `paginate()` if needed (DEFAULT_LIMIT 100, MAX_LIMIT 100).
- **`createRepo`** — All four fields required (baseBranch is an array of branch names, prefix is the branch prefix e.g. 'feature'). Side effect: id generated client-side, sent as `id`, and returned as { id }.
- **`updateRepo`** — Required: id (positional). Partial update; omitted fields untouched. Passing baseBranch replaces the whole array — use addRepoBranch to append.
- **`deleteRepo`** — Required: id. Destructive: disconnects the repository from the workspace.
- **`addRepoBranch`** — Required: id, branchName. Appends one more base branch to the repo rather than replacing baseBranch.
- **`getSdlcChannel`** — Required: channelId. Singular query (server query ends in .one()) — resolves to null when the channel is not an SDLC hub, rather than an empty list. Returns the channel with participants, stats and canvas folders. Replaces the removed getSdlcRepoByChannel / getSdlcRepoByChannelId: the SDLC hub is now a channel, not a separate repo row.
- **`listSdlcTracks`** — Required: channelId (re-keyed from the old repoId). Returns every track oldest-first in one response; no server-side pagination.
- **`createSdlcTrack`** — Required: repoId, name. Note the asymmetry with the other create* methods — args are forwarded verbatim, no client-side id is minted and the method returns void, so the new track id is not surfaced (the docs claim the id is returned; the code does not). Permission: caller must be a participant of the repository's channel. Track id and timestamp are generated server-side.
- **`updateSdlcTrack`** — Required: trackId (positional); second param is named `updates` in the .d.ts. Partial update; `description: null` explicitly clears the description (undefined leaves it alone).
- **`listEmojis`** — No params. Returns every uploaded custom emoji with its image URL in one unpaginated response.
- **`getEmoji`** — Required: emojiId. Returns null when no such emoji exists (does not throw).
- **`getEmojiByName`** — Required: name — the short name WITHOUT surrounding colons (e.g. 'shipit', not ':shipit:'). Returns null when no emoji has that name.
- **`listLookupValues`** — Required: type (LookupType enum, e.g. 'BUG_TYPE'). Reads the configurable vocabularies used across forms and incident records — bug types, impact types, corrective-action types. Unpaginated.
- **`listMerchants`** — No params. Each Merchant carries the `mid` used across tickets and filters. Unpaginated.
- **`listTicketTags`** — Required: projectId — scoped to one project despite the registry comment saying 'tags defined across projects'. Unpaginated.
- **`listClassificationMappings`** — Required: channelId (a Desk channel). Returns that channel's mail-category → team routing rules. Unpaginated.
- **`createClassificationMapping`** — Required: channelId, category, userGroupId; subCategory narrows the match. Side effect: rule id minted client-side, sent as `id`, and returned as { id }.
- **`updateClassificationMapping`** — Required: id (positional). Partial update; omitted fields left alone. channelId cannot be changed — delete and recreate to move a rule to another channel.
- **`deleteClassificationMapping`** — Required: id. Destructive: removes the routing rule; mail in that category stops being routed to the group.

</details>

---

## SDK plumbing: `@xyne/spaces-sdk`

### Creating a client

```ts
import { createClient, SpacesClient } from '@xyne/spaces-sdk';

const sdk = createClient({
  apiKey: process.env.XYNE_SPACES_API_KEY,
});
```

`createClient(options?)` is a one-line factory over `new SpacesClient(options?)` — identical behaviour, pick either. Options are entirely optional (`options = {}`), but with no `apiKey` every call goes out unauthenticated.

#### `SpacesClientOptions`

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `baseUrl` | `string` | `'https://spaces.xyne.app'` | Origin of the Spaces API. A trailing slash is stripped on construction. |
| `apiKey` | `string` | — | Bearer credential minted from the Apps page in Spaces. It acts **as the user who created it**, in that user's workspace, and expires after a fixed period. Can be supplied later via `setApiKey()`. |
| `timeout` | `number` (ms) | `30000` | Per-HTTP-request deadline, enforced with `AbortController`. |
| `useBeta` | `boolean` | `false` | When strictly `true`, every request carries `x-route-env: playground` so the gateway routes to pre-prod — the same header the Electron app's pre-prod toggle and `@xyne/storage-sdk` use. Absent or `false` sends **no header at all**, which is what routes to prod. |

#### Key management on the client

```ts
sdk.setApiKey(newKey);   // swap in a rotated key, in place
sdk.clearApiKey();       // subsequent calls fail with AuthError
sdk.hasApiKey();         // boolean — whether a key is set, NOT whether it is still valid
```

To learn when the current key dies, call `sdk.users.me()` — it returns the acting user plus `keyExpiresAt`, so a long-running process can renew before expiry instead of discovering it mid-request.

### Auth headers and base URL handling

Every request is assembled in `HttpClient.request`:

- `Accept: application/json` always.
- `Authorization: Bearer <apiKey>` — only when a key is set; otherwise the header is omitted entirely (no anonymous placeholder).
- `Content-Type: application/json` — **unless** the body is a `FormData` (attachment uploads), where the header is deliberately left off so `fetch` can add the multipart boundary. Setting it manually would break Express/multer uploads.
- `x-route-env: playground` — only when `useBeta === true`.
- `credentials: 'include'` on every fetch, so browser cookies ride along for same-origin session auth in addition to (or instead of) the bearer key.

URL construction is asymmetric and worth knowing:

- `POST`/`PUT`/`PATCH` concatenate: `${baseUrl}${path}`.
- `GET`/`DELETE` go through `new URL(path, baseUrl)` and append query params from a `Record<string, unknown>`, skipping `undefined`/`null` values and `String()`-ing the rest.

Because SDK paths are absolute (`/api/sdk/v1/...`), a `baseUrl` that contains a **path prefix** (e.g. `https://host/spaces`) is preserved for writes but dropped for `GET`/`DELETE`. Point `baseUrl` at a bare origin.

Under the hood, `Transport` posts operation ids to two versioned endpoints — `POST /api/sdk/v1/query` and `POST /api/sdk/v1/mutate`, each with `{ op, args }` — unwrapping `response.data` for queries and `response.generated ?? response` for mutations; a minority of operations map to direct versioned REST routes instead. You never call these yourself; resources do.

### Response decoding

- Empty body (e.g. `204`) resolves to `undefined`.
- Response whose `content-type` does not contain `json` resolves to the raw **string** (schema definitions come back as plain text).
- Otherwise `JSON.parse` — a malformed JSON body raises rather than silently returning a string.

### Errors

All errors extend `SdkError`, which carries three fields beyond `message`:

```ts
class SdkError extends Error {
  readonly code: SdkErrorCode;   // 'network_error' | 'timeout' | 'api_error'
                                 // | 'forbidden' | 'validation_error' | 'unknown'
  readonly serverCode?: string;  // the API's error.code, when the server produced it
  readonly requestId?: string;   // X-Request-Id — quote this in support requests
}
```

`requestId` is read from the `X-Request-Id` response header first (present even when the error body is not JSON), falling back to `error.request_id` in the body. It is absent when the failure never reached the server.

Status-to-error mapping:

| Condition | Thrown | `code` |
| --- | --- | --- |
| `400` | `SdkError` | `'validation_error'` |
| `401` | `AuthError` | `'api_error'` |
| `403` | `SdkError` | `'forbidden'` |
| `404` | `NotFoundError` | `'api_error'` |
| any other non-2xx | `SdkError` | `'api_error'` |
| request aborted at `timeout` | `SdkError` | `'timeout'` |
| fetch/DNS/socket failure | `SdkError` | `'network_error'` |

**Catch by class for 401/404, by `code` for the rest.** `AuthError` and `NotFoundError` both report `code === 'api_error'`, so a `switch` on `code` alone cannot distinguish them:

```ts
import { SdkError, AuthError, NotFoundError } from '@xyne/spaces-sdk';

try {
  const page = await sdk.users.list({ limit: 50 });
} catch (err) {
  if (err instanceof AuthError) {
    // 401 — key missing, expired, or rotated
  } else if (err instanceof NotFoundError) {
    // 404
  } else if (err instanceof SdkError) {
    switch (err.code) {
      case 'timeout':
      case 'network_error':
        // safe to retry
        break;
      case 'validation_error':  // 400 — fix the args, do not retry
      case 'forbidden':         // 403
      default:                  // 'api_error'
        console.error(err.message, err.serverCode, err.requestId);
    }
  } else {
    throw err;
  }
}
```

Two exports to be aware of:

- `RateLimitError` (with `retryAfter`) is exported and **deprecated — nothing throws it today**; the Spaces API has no rate limiter. Do not build a retry strategy around it.
- `ZeroOperationError` exists in the errors module but is **not re-exported from the package root**; only `SdkError`, `AuthError`, `NotFoundError`, `RateLimitError`, and the `SdkErrorCode` type are.

The error message resolves in order: body `message` → nested `error.message` → `error` when it is a string → HTTP `statusText`.

### Timeouts

One `timeout` value covers each individual HTTP round trip, not a logical SDK operation. A helper that polls (for example `sdk.claw.runAndWait`) issues many requests, each with its own budget, so a long agent run is not bounded by `timeout`. On abort you get `SdkError` with `code === 'timeout'` and message `'Request timed out'`; because it never reached the server, `requestId` and `serverCode` are undefined. Raise `timeout` for search over large corpora and for multipart uploads.

### Pagination

There are three distinct paging styles in this SDK, and picking the wrong mental model is the usual source of bugs.

#### 1. Client-side windowing — returns `Page<T>`

Used where the underlying query has no server cursor and hands back every matching row in one response. The SDK fetches that full result and windows it locally.

```ts
export interface PageOptions {
  limit?: number;   // defaults to 100, capped at 100
  offset?: number;  // defaults to 0
}

export interface Page<T> {
  items: T[];        // rows in this page
  hasMore: boolean;  // true when the fetched result held rows beyond this page
  total: number;     // total rows in the underlying fetched result
  nextOffset: number;// pass back as `offset` for the next page
}

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 100;
```

`limit` is **clamped, not validated**, into `[1, 100]` — an over-large value silently becomes 100, and `0` becomes 1 (a zero-limit page would report `hasMore: true` forever). `offset` is floored at 0. `total` is the size of the already-fetched result set, after any server-side filter such as `updatedAt` — not a workspace-wide count.

```ts
let offset = 0;
for (;;) {
  const page = await sdk.users.list({ limit: 100, offset });
  for (const user of page.items) { /* ... */ }
  if (!page.hasMore) break;
  offset = page.nextOffset;
}
```

Important cost note: each page re-fetches the entire underlying result over the network. Windowing saves you from holding and iterating an unbounded array; it does not save a round trip. If you genuinely need every row, one call plus your own slicing is cheaper than walking pages.

Methods returning `Page<T>`: `users.list`, `users.listBasic`, `channels.listBrowsable`, `messages.listByConversation`, `messages.listByChannel`, `tickets.listByProject`, `tickets.listActivities`.

#### 2. Real server-side cursors — return a plain array

These take `{ limit, start, direction? }` and return `T[]`, **not** a `Page`. The cursor is a composite object you build from the last row of the previous page:

```ts
let start: ConversationCursor | undefined;
for (;;) {
  const threads = await sdk.conversations.listByChannel('channel-123', {
    limit: 20,
    start,
    direction: 'forward',
  });
  if (threads.length === 0) break;
  const last = threads[threads.length - 1];
  start = { conversationId: last.id, lastActivityAt: last.lastActivityAt };
  if (threads.length < 20) break;   // short page ⇒ end of the set
}
```

Since the response has no `hasMore`, the convention is: keep going while the returned array length equals the requested `limit`. Cursor shapes exported from the package root include `ConversationCursor { conversationId, lastActivityAt }`, `MessageCursor { messageId, createdAt }`, `ActivityCursor { id, updatedAt }`, `TicketCursor { id, createdAt }`, `TicketActivityCursor { timestamp, id }`, `CanvasCursor { id, updatedAt }`, plus `SupportTicketCursor`, `CallCursor`, `EmailCursor`, `EmailDraftCursor`, `AppCursor`, `RoleCursor`, `WorkflowCursor`, and `RcaCursor`. `channels.listParticipantsPaginated` uses an inline `{ role, userId }` cursor and is the one to prefer over `channels.listParticipants` on large channels.

`conversations.listByChannel` additionally accepts `direction: 'forward' | 'backward'` to page either side of the cursor.

Several of these reads also take `isMember?: boolean`. It is **not a filter** — it is a hint selecting a cheaper ACL path; row-level ACLs still apply, so passing `true` when you are not a member is safe and returns nothing.

#### 3. `listAll` is not auto-pagination

`sdk.channels.listAll({ updatedAt? })` means "every channel the caller belongs to, including closed ones, as a plain array" — it does not loop pages, and it returns `Channel[]` (no per-user read state), in contrast to `sdk.channels.list()` which returns `ChannelUserStatus[]` rows. `sdk.forms.listAllTicketValues()` is the same pattern. There is no generic auto-paginating helper and no async iterator; write the loops above.

#### Search paging

`sdk.search.query(...)` is its own thing: `SearchOptions` takes `limit`/`offset`, and `SearchResponse` echoes `offset`, `limit`, and `totalCount`. Use `orderBy: 'newest'` when paging — the default relevance ordering cannot be paged through reliably.

#### A trap in the exported types

`PaginatedResponse<T> { data, cursor?, hasMore }` and `PaginationOptions { limit?, cursor? }` are exported from the package root but **no resource method accepts or returns them**. They are vestigial. The live contracts are `Page<T>`/`PageOptions` and the per-resource cursor interfaces.

### Full resource surface on `SpacesClient`

All 25 are `readonly` properties constructed eagerly in the client constructor:

| Property | Type | Covers |
| --- | --- | --- |
| `users` | `UsersResource` | User operations |
| `search` | `SearchResource` | Search operations |
| `attachments` | `AttachmentsResource` | Direct multipart file uploads |
| `channels` | `ChannelsResource` | Channel membership, settings, participants, and sidebar sections |
| `conversations` | `ConversationsResource` | Threads: listing, reading, pinning, and subscription |
| `messages` | `MessagesResource` | Messages, drafts, and scheduled sends |
| `activities` | `ActivitiesResource` | The current user's activity feed and its read state |
| `tickets` | `TicketsResource` | Tickets, sub-tickets, tags, references, and stage approvals |
| `supportTickets` | `SupportTicketsResource` | The support-desk view of tickets (reads; write via `tickets`) |
| `boards` | `BoardsResource` | Boards, stages, transitions, and SLA policies |
| `projects` | `ProjectsResource` | Projects and their tags, fields, and applications |
| `canvases` | `CanvasesResource` | Canvases: content, sharing, comments, versions, and folders |
| `collections` | `CollectionsResource` | Knowledge-base collections and their permissions |
| `forms` | `FormsResource` | Custom forms, their mappings, and submitted values |
| `calls` | `CallsResource` | Calls, scheduling, participation, and recordings |
| `email` | `EmailResource` | Desk email: drafts, signatures, read state, and labels |
| `recaps` | `RecapsResource` | Daily channel and project recaps, and entity nudges |
| `admin` | `AdminResource` | Workspace and organization administration |
| `userGroups` | `UserGroupsResource` | Teams, membership, and assignment routing |
| `dashboards` | `DashboardsResource` | Dashboards, saved queries, and tile layout |
| `automations` | `AutomationsResource` | Automations and their approval lifecycle |
| `incidents` | `IncidentsResource` | RCAs, impacts, corrective actions, and release attribution |
| `preferences` | `PreferencesResource` | The current user's own settings, bookmarks, and saved views |
| `workspace` | `WorkspaceResource` | Shared links, repositories, emoji, and reference data |
| `claw` | `ClawResource` | Remote agents: dispatch, poll, and their own login |

---

# Xyne Storage SDK Reference

`@xyne/storage-sdk` v0.1.0 — "Paste-a-JWT client SDK for per-app key-value storage served by xyne-claw-auth: scoped records, prefix listings, bounded pages."

Source of truth: `/Users/pradeesh.s/Documents/xyne-app-hack/node_modules/@xyne/storage-sdk/dist/{client,types,index}.{d.ts,js}`, vendored (minified, identical behavior) at `/Users/pradeesh.s/Documents/xyne-app-hack/lib/vendor/storage-sdk.js`, wired up in `/Users/pradeesh.s/Documents/xyne-app-hack/lib/xyne.ts`.

---

## 1. The data model in one paragraph

Records live under **`(appId, baseKey, scope, key)`**. `baseKey` is the *collection* — a namespace grouping records. `key` sorts **lexicographically**, so ISO dates (`2026-09-08T12:00:00Z`) and zero-padded numbers (`0007`) give you ordered listings for free. `value` is **opaque JSON**: the server never inspects, indexes, or filters on it. **Every query addresses keys only** — there is no `where`, no content search, no secondary index. If you need to query by a field, encode that field into the key.

---

## 2. Getting a client

In this app you never construct `XyneStorageClient` yourself — `lib/xyne.ts` builds and exports a pre-authenticated singleton:

```ts
import { xyne } from './lib/xyne';

const { storage } = await xyne();     // storage: XyneStorageClient
```

`lib/xyne.ts` constructs it as `new XyneStorageClient({ baseUrl: '', token: token ?? '', appId })`:

- **`baseUrl` is always `''`** (empty), so the SDK emits *relative* paths like `/claw/api/v1/artifact-app-storage/query`. In local dev those go through the Vite proxy; published, `lib/xyne.ts` monkey-patches `window.fetch` to tunnel any `/api/*` or `/claw/*` request to the host dashboard over `postMessage`, which performs the real same-origin fetch as the logged-in viewer.
- **Published, `token` is `''` and `appId` is `''`** — the app holds no credential at all. The host supplies identity and app scoping. Locally, both come from `.env` via Vite's `define` (`__XYNE_TOKEN__`, `__XYNE_APP_ID__`).

Consequence: the `Authorization: Bearer` header the SDK sets is meaningless in the published sandbox (it's `Bearer `), and that is fine — the bridge replaces it. Don't "fix" it by injecting a token into the app.

### Constructing directly (Node scripts, tests)

```ts
import { XyneStorageClient } from '@xyne/storage-sdk';

const client = new XyneStorageClient({
  baseUrl: 'https://spaces.example.com',
  token: process.env.XYNE_TOKEN!,
  appId: process.env.XYNE_APP_ID!,
});
```

### `XyneStorageClientOptions`

```ts
export interface XyneStorageClientOptions {
    /** Backend origin, e.g. https://spaces.example.com */
    baseUrl: string;
    /** JWT pasted from a logged-in web session (value of the
     *  xyne_ws_<workspaceId>_token cookie, visible in DevTools → Application).
     *  The workspace is derived server-side from the token's own workspaceId
     *  claim — nothing else identifies it. */
    token: string;
    /** The app whose records this client reads and writes (ArtifactApp id). */
    appId: string;
    /** Override where the storage routes are mounted. Defaults to
     *  DEFAULT_STORAGE_BASE_PATH under baseUrl. */
    basePath?: string;
}
```

| Option | Required | Notes |
|---|---|---|
| `baseUrl` | yes | Trailing slash is stripped (`.replace(/\/$/, '')`). `''` is legal and yields relative URLs. |
| `token` | yes | Raw JWT, no `Bearer ` prefix — the SDK adds it. There is **no workspace option**: the workspace comes from the token's own `workspaceId` claim. |
| `appId` | yes | Injected into every request body automatically; you never pass it to `query`/`put`/`delete`. |
| `basePath` | no | Defaults to `DEFAULT_STORAGE_BASE_PATH`. Trailing slash stripped. |

```ts
export declare const DEFAULT_STORAGE_BASE_PATH = "/claw/api/v1/artifact-app-storage";
```

---

## 3. Scope

```ts
/** Who a record belongs to. Enforced SERVER-side — the SDK cannot widen it. */
export type StorageScope = 'user' | 'global';
/** Which rows a read may return: only the caller's, only shared, or both. */
export type StorageReadScope = StorageScope | 'any';
```

- **`'user'`** — private to the calling user. **Default for writes** (`put`, `remove`).
- **`'global'`** — one shared record that every user of the app reads and writes.
- **`'any'`** — read-only value. **Default for reads.** Returns shared records *plus* the caller's own.

**Shadowing:** when a `user` and a `global` record exist under the same `key`, reads with scope `any` return the **user** one. This is the idiom for per-user overrides of a shared default: seed defaults as `global`, let each user `put` their own `user` record over the top.

**Isolation is server-side and absolute.** One user can never read another user's records "no matter what this client sends." Scope is resolved from the verified session, not from anything the client asserts.

`user` and `global` are *separate rows*, keyed independently. `remove(key)` (default `user`) will **not** delete a `global` record with the same key — you must pass `{ scope: 'global' }` explicitly.

---

## 4. `XyneStorageClient` — public API (verbatim signatures)

```ts
export declare class XyneStorageClient {
    private baseUrl;
    private basePath;
    private token;
    private appId;
    constructor(options: XyneStorageClientOptions);
    /** Swap in a freshly pasted token after the old one expires. */
    setToken(token: string): void;
    /** Records for one collection. */
    collection<T = unknown>(baseKey: string): XyneCollection<T>;
    /** Raw fetch call — `collection()` is sugar over this. */
    query(input: Omit<StorageQuery, 'appId'>): Promise<{
        record?: StorageRecord | null;
        records?: StorageRecord[];
        hasMore?: boolean;
    }>;
    /** Raw upsert call. */
    put(input: Omit<StoragePut, 'appId'>): Promise<{
        record: StorageRecord;
    }>;
    /** Raw delete call. */
    delete(input: Omit<StorageDelete, 'appId'>): Promise<{
        deleted: boolean;
    }>;
    private request;
}
```

Notes:

- **`setToken(token)`** replaces the credential in place; existing `XyneCollection` handles keep working because they delegate to the client. Useful in Node when a pasted JWT expires; irrelevant in the published sandbox.
- **`collection<T>(baseKey)`** does no validation or network I/O — it just returns `new XyneCollection(this, baseKey)`. Cheap; call it inline if you like.
- **The three raw methods take `Omit<…, 'appId'>`** because the client splices `appId` in: `this.request('/query', { ...input, appId: this.appId })`. Passing `appId` yourself is a type error (and would be redundant).
- The raw return types are **loose** (`record?`, `records?`, `hasMore?` all optional, and `StorageRecord` is unparameterized — i.e. `value: unknown`). The typed, normalized shapes come from `XyneCollection<T>`. Prefer `collection()` unless you genuinely need a raw call.

---

## 5. `collection()` — the API you actually code against

```ts
export declare class XyneCollection<T = unknown> {
    private readonly client;
    private readonly baseKey;
    constructor(client: XyneStorageClient, baseKey: string);
    /** One record, or null. A 'user' record shadows a 'global' one with the same key. */
    get(key: string, options?: {
        scope?: StorageReadScope;
    }): Promise<StorageRecord<T> | null>;
    /** Up to 50 records in one round trip. Missing keys are simply absent. */
    getMany(keys: string[], options?: {
        scope?: StorageReadScope;
    }): Promise<Array<StorageRecord<T>>>;
    /** Create or replace. Default scope 'user' (private). The full value is
     *  replaced — read-modify-write for partial updates. */
    put(key: string, value: T, options?: {
        scope?: StorageScope;
    }): Promise<StorageRecord<T>>;
    /** Remove one record. Resolves false when there was nothing to remove. */
    remove(key: string, options?: {
        scope?: StorageScope;
    }): Promise<boolean>;
    /** A bounded page of records, ordered by key. */
    list(query?: {
        prefix?: string;
        scope?: StorageReadScope;
        order?: 'asc' | 'desc';
        limit?: number;
        offset?: number;
    }): Promise<StorageListResult<T>>;
}
```

| Method | Wire call | Returns |
|---|---|---|
| `get(key, opts?)` | `POST /query` `{op:'get', key}` | `StorageRecord<T>` or `null` (normalizes `undefined` → `null`) |
| `getMany(keys, opts?)` | `POST /query` `{op:'get', keys}` | `StorageRecord<T>[]`, `[]` if absent. **Missing keys are silently omitted** — the result array is not positionally aligned with `keys`. |
| `put(key, value, opts?)` | `POST /put` | the written `StorageRecord<T>` |
| `remove(key, opts?)` | `POST /delete` | `boolean` — `false` when nothing matched |
| `list(query?)` | `POST /query` `{op:'list'}` | `StorageListResult<T>` with `records` defaulted to `[]` and `hasMore` coerced via `hasMore === true` |

**`T` is unchecked.** The generic is a compile-time convenience only; nothing validates the round-tripped JSON. Parse/guard at the boundary if the data can be stale or written by an older build.

**Option objects are conditionally spread.** `get`/`getMany`/`put`/`remove` use `...(options?.scope ? { scope } : {})` — a *truthiness* check, so passing `scope: undefined` (or omitting it) means the field is never sent and the server default applies. `list` uses `!== undefined` checks, so a falsy-but-defined value like `offset: 0` **is** transmitted.

---

## 6. Stored document shape

```ts
export interface StorageRecord<T = unknown> {
    key: string;
    scope: StorageScope;
    value: T;
    createdAt: string;
    updatedAt: string;
}

export interface StorageListResult<T = unknown> {
    records: Array<StorageRecord<T>>;
    /** True when another page exists — pass a larger `offset` to fetch it. */
    hasMore: boolean;
}
```

Note what is **not** on the record: no `appId`, no `baseKey`, no user id. Those are implicit in the request you made and the session you made it under. `createdAt` / `updatedAt` are ISO-8601 **strings**, not `Date` objects.

Since `put` is an upsert against `(baseKey, scope, key)`, re-putting an existing key preserves `createdAt` and advances `updatedAt`.

---

## 7. HTTP routes

Every call is a **`POST`** with a JSON body to one of three routes under `{baseUrl}{basePath}`, where `basePath` defaults to `/claw/api/v1/artifact-app-storage` (nginx proxies `/claw` to `xyne-claw-auth`):

| Route | Method | Body | Response |
|---|---|---|---|
| `/claw/api/v1/artifact-app-storage/query` | POST | `StorageQuery` | `{ record? }` (op `get`, single) · `{ records? }` (op `get`, batch) · `{ records?, hasMore? }` (op `list`) |
| `/claw/api/v1/artifact-app-storage/put` | POST | `StoragePut` | `{ record }` |
| `/claw/api/v1/artifact-app-storage/delete` | POST | `StorageDelete` | `{ deleted: boolean }` |

Request construction, verbatim from `client.js`:

```js
const headers = new Headers({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${this.token}`,
});
const response = await fetch(`${this.baseUrl}${this.basePath}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'omit',
});
```

- **Pure Bearer auth.** `credentials: 'omit'` — no cookies are sent, and there is no workspace header. The storage routes bridge the token's own `workspaceId` claim into the cookie form claw-auth verifies against the Spaces backend. This is why the same code works unchanged in Node and in browsers.
- There are **no GET/PUT/DELETE verbs** — even reads and deletes are POSTs. Don't expect these to be cacheable or to work from a plain `<img>`/link.

### Wire contracts

```ts
/**
 * The fetch contract for `POST /query`, verbatim what the server's zod schema
 * accepts (`.strict()` — an unknown field is a 400, not ignored). This IS the
 * whole query language: records are addressed by key only, never by content.
 */
export interface StorageQuery {
    appId: string;
    /** 1-64 chars of letters, digits, `.` `_` `-`; names one collection. */
    baseKey: string;
    op: 'get' | 'list';
    /** get: one key (1-256 chars), or a batch of up to 50. Exactly one of the two. */
    key?: string;
    keys?: string[];
    /** list: only keys starting with this prefix. */
    prefix?: string;
    /** Default "any": shared records plus the caller's own. */
    scope?: StorageReadScope;
    /** list: by key, lexicographic. Default "asc". */
    order?: 'asc' | 'desc';
    /** list: page size 1-100. Default 50. */
    limit?: number;
    /** list: rows to skip, 0-10000. Default 0. */
    offset?: number;
}

/** The write contract for `POST /put`. Upserts against (baseKey, scope, key). */
export interface StoragePut {
    appId: string;
    baseKey: string;
    key: string;
    /** Opaque JSON, at most 64KB serialized. The server never filters on it. */
    value: unknown;
    /** Default "user": private to the caller. "global" is shared by all users of the app. */
    scope?: StorageScope;
}

export interface StorageDelete {
    appId: string;
    baseKey: string;
    key: string;
    scope?: StorageScope;
}
```

---

## 8. Errors

```ts
export declare class XyneStorageApiError extends Error {
    readonly status: number;
    readonly body?: unknown | undefined;
    constructor(message: string, status: number, body?: unknown | undefined);
}
export declare class XyneStorageAuthError extends XyneStorageApiError {
    constructor(status: number, body?: unknown);
}
```

Throw logic in `request()`:

1. `status === 401 || status === 403` → **`XyneStorageAuthError`** (a subclass of `XyneStorageApiError`, `name === 'XyneStorageAuthError'`), with the fixed message: *"Xyne auth failed — the pasted token is missing, invalid, or expired. Copy a fresh `xyne_ws_<workspaceId>_token` cookie value from a logged-in web session and call `setToken()`."*
2. `!response.ok` **or** `parsed?.success === false` → **`XyneStorageApiError`** with `parsed?.error` as the message, falling back to ``Xyne storage POST ${path} failed (HTTP ${status})``.

The response body is parsed with `await response.json().catch(() => undefined)`, so a non-JSON body yields `body: undefined` rather than a parse crash. Note the second condition: a **200 with `{ success: false }` still throws** — the server can report failure in-band.

Order matters when catching: check `XyneStorageAuthError` **first**, since it also `instanceof XyneStorageApiError`.

```ts
import { xyne } from './lib/xyne';
import { XyneStorageApiError, XyneStorageAuthError } from './lib/vendor/storage-sdk.js';

const { storage } = await xyne();

try {
  await storage.collection('prefs').put('theme', 'dark');
} catch (err) {
  if (err instanceof XyneStorageAuthError) {
    // 401/403 — session gone. In the sandbox the viewer must re-log-in;
    // in Node, storage.setToken(freshJwt) and retry.
  } else if (err instanceof XyneStorageApiError) {
    console.error(err.status, err.message, err.body);
  } else {
    throw err; // network / TypeError from fetch
  }
}
```

---

## 9. Limits and validation

Server-enforced — **the SDK does not pre-trim or pre-validate anything**. You find out by getting a 400.

| Thing | Limit |
|---|---|
| `value` | ≤ **64 KB** serialized JSON |
| `baseKey` (collection name) | **1–64** chars, `[A-Za-z0-9._-]` only |
| `key` | **1–256** chars |
| `list` page size (`limit`) | **1–100**, default **50** |
| `list` `offset` | **0–10000**, default **0** |
| `getMany` batch (`keys`) | ≤ **50** keys |
| `get` | exactly **one** of `key` or `keys` |
| `order` | `'asc'` (default) or `'desc'`, lexicographic by key |
| Read `scope` | default `'any'` |
| Write `scope` | default `'user'` |

---

## 10. Gotchas

1. **The zod schema is `.strict()` — an unknown field is a 400, not ignored.** Never spread extra properties into a raw `query`/`put`/`delete` input. This mainly bites when you build the body dynamically.
2. **`put` replaces the whole value.** There is no patch/merge. For a partial update do read-modify-write:
   ```ts
   const cur = await todos.get(key);
   await todos.put(key, { ...(cur?.value ?? {}), done: true });
   ```
   …which is a **non-atomic** read-modify-write. Two concurrent writers to the same `global` key will lose an update. There is no CAS, no version, no ETag. For `global` counters/shared state, prefer per-user keys you aggregate at read time over a single hot shared row.
3. **No content queries, ever.** No filtering, sorting, or searching on `value`. Design keys as your index: `"2026-09-08T10:00:00Z#todo_123"`, `"status=open#0042"`, etc.
4. **Lexicographic ordering means numbers must be zero-padded.** `"10"` sorts before `"9"`. Use `String(n).padStart(6, '0')`.
5. **Pagination is offset-based, and offsets cap at 10000.** There is no cursor. A collection deeper than 10k rows in one prefix is unreachable past that point — partition with prefixes instead.
6. **`hasMore` is coerced with `hasMore === true`**, so a missing field reads as `false`. Don't infer "no more pages" from `records.length < limit` alone if you care; trust `hasMore`.
7. **`getMany` results are unordered and sparse.** Missing keys are simply absent, and nothing guarantees the server returns them in your requested order. Index the result by `record.key` before use.
8. **`remove` is scope-specific and defaults to `'user'`.** Deleting a `global` record requires `{ scope: 'global' }`. Also, `remove` returning `false` is not an error — it just means nothing matched.
9. **`get` with default scope `'any'` can return either a `user` or a `global` record.** Check `record.scope` if the distinction matters (e.g. "is this the shared default or my override?").
10. **`limit`/`offset` bypass the truthiness guard.** In `list`, `!== undefined` is used, so `limit: 0` is sent to the server and rejected (valid range 1–100). Omit the field rather than passing `0`.
11. **The published app has `token: ''` and `appId: ''`** (see `lib/xyne.ts`) — that is intentional; the host bridge injects real identity. Any local reasoning like "appId is empty, that must be a bug" is wrong.
12. **Only `/api/*` and `/claw/*` are tunnelled** by the published-mode fetch shim (`const BACKEND = /^\/(api|claw)\//`). If you override `basePath` to something outside those prefixes, the published app will fetch the sandbox origin directly and fail.
13. **`baseUrl` and `basePath` both get their trailing slash stripped**, then `path` (`'/query'` etc.) is appended — so `basePath: 'foo'` without a leading slash produces `foo/query`, a *relative* URL. Always lead with `/`.
14. **`credentials: 'omit'`** means a cookie you can see in DevTools will *not* authenticate a direct Node/browser call. You must paste the `xyne_ws_<workspaceId>_token` cookie value in as `token`.
15. **The vendored bundle is a byte-for-byte behavioral copy.** `lib/vendor/storage-sdk.js` is the minified build (`XyneStorageClient` → `p`, `XyneCollection` → `i`, `XyneStorageApiError` → `a`, `XyneStorageAuthError` → `n`, `DEFAULT_STORAGE_BASE_PATH` → `d`) and `lib/vendor/storage-sdk.d.ts` is just `export * from '@xyne/storage-sdk';`. Import from `./lib/xyne` (or `./lib/vendor/storage-sdk.js` for the error classes) at runtime; the `node_modules` package exists for its types.

---

## 11. Runnable examples

### Read/write a per-user preference

```ts
import { xyne } from './lib/xyne';

const { storage } = await xyne();
const prefs = storage.collection<string>('prefs');

await prefs.put('theme', 'dark');                 // scope 'user' by default
const theme = (await prefs.get('theme'))?.value ?? 'light';
```

### A typed collection with a shared default and per-user override

```ts
import { xyne } from './lib/xyne';

interface Settings { density: 'compact' | 'cozy'; locale: string }

const { storage } = await xyne();
const settings = storage.collection<Settings>('settings');

// Seed a shared default all users see (any user of the app can write this).
await settings.put('default', { density: 'cozy', locale: 'en' }, { scope: 'global' });

// This user overrides it — same key, scope 'user'. It shadows the global row.
await settings.put('default', { density: 'compact', locale: 'en' }, { scope: 'user' });

const rec = await settings.get('default');        // scope 'any' -> the user row wins
console.log(rec?.scope, rec?.value.density);      // 'user' 'compact'

// Read past the override to see the shared baseline:
const shared = await settings.get('default', { scope: 'global' });
```

### Time-ordered records + prefix listing

```ts
import { xyne } from './lib/xyne';

interface Todo { text: string; done: boolean }

const { storage } = await xyne();
const todos = storage.collection<Todo>('todos');

// ISO keys sort lexicographically == chronologically.
const key = `${new Date().toISOString()}#${crypto.randomUUID()}`;
await todos.put(key, { text: 'ship it', done: false });

// Newest-first page of everything in September 2026.
const page = await todos.list({ prefix: '2026-09', order: 'desc', limit: 50 });
for (const r of page.records) {
  console.log(r.key, r.value.text, r.updatedAt);
}
if (page.hasMore) {
  const next = await todos.list({ prefix: '2026-09', order: 'desc', limit: 50, offset: 50 });
}
```

### Draining a collection within the offset ceiling

```ts
import { xyne } from './lib/xyne';
import type { StorageRecord } from './lib/vendor/storage-sdk.js';

const { storage } = await xyne();
const todos = storage.collection<{ text: string }>('todos');

const all: Array<StorageRecord<{ text: string }>> = [];
for (let offset = 0; offset <= 10000; offset += 100) {
  const { records, hasMore } = await todos.list({ limit: 100, offset });
  all.push(...records);
  if (!hasMore) break;                  // offset caps at 10000 — partition beyond that
}
```

### Batch get (≤ 50 keys), indexed because results are sparse

```ts
import { xyne } from './lib/xyne';

const { storage } = await xyne();
const todos = storage.collection<{ text: string }>('todos');

const wanted = ['a', 'b', 'missing'];
const found = await todos.getMany(wanted);              // 'missing' simply absent
const byKey = new Map(found.map(r => [r.key, r.value]));
const rows = wanted.map(k => byKey.get(k) ?? null);     // realign to your order
```

### Read-modify-write (the only way to patch)

```ts
import { xyne } from './lib/xyne';

interface Todo { text: string; done: boolean; tags?: string[] }

const { storage } = await xyne();
const todos = storage.collection<Todo>('todos');

const cur = await todos.get('2026-09-08#abc');
if (cur) {
  await todos.put(cur.key, { ...cur.value, done: true }); // full replace
}
```

### Delete, including the shared row

```ts
import { xyne } from './lib/xyne';

const { storage } = await xyne();
const settings = storage.collection('settings');

await settings.remove('default');                      // removes MY row only
await settings.remove('default', { scope: 'global' }); // removes the shared row
```

### Raw calls (escape hatch)

```ts
import { xyne } from './lib/xyne';

const { storage } = await xyne();

// appId is spliced in by the client — never pass it.
const { records, hasMore } = await storage.query({
  baseKey: 'todos',
  op: 'list',
  prefix: '2026-09',
  order: 'desc',
  limit: 100,
});

const { record } = await storage.put({ baseKey: 'todos', key: 'k1', value: { n: 1 } });
const { deleted } = await storage.delete({ baseKey: 'todos', key: 'k1' });
```

---

## Adding a resource

The vendored bundle is slim on purpose: the published Spaces sandbox caps each file at **64 KB**, and the full SDK bundles to ~70 KB. To use one of the unbundled resources:

1. Add its import + client property in `scripts/slim-spaces-entry.js`.
2. Add the same key to the `Pick<>` in `lib/vendor/spaces-sdk.d.ts`.
3. `npm run bundle:sdk`
4. `ls -l lib/vendor/spaces-sdk.js` — keep it **under 64 KB** or the published app will be rejected.
