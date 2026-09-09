# Patches for xyne-spaces

Changes this app cannot make from inside the sandbox, written out so they can be
reviewed and applied deliberately.

## `pr-comments-to-tickets.patch`

**Makes pull-request comments reach the ticket, on both Bitbucket and GitHub.**

### The bug

You commented on Bitbucket PR #9604 and on GitHub PR #1624, and neither appeared
on XYNE-62896. That is not a configuration problem. Both hosts deliver the
event; nothing on the Xyne side writes it anywhere.

**Bitbucket** does subscribe to `pr:comment:added`, and
`bitbucketWebhookService.handleCommentEvent` does run. Here is everything it does
(`bitbucketWebhookService.ts:153-193`):

```ts
const mentions = this.extractMentions(commentText);
if (mentions.some(m => m.toLowerCase() === 'john.doe@gmail.com')) {
  await xyneCommentService.handleXyneMention({ … });   // starts a PR-check workflow
}
return { success: true, message: `Comment event ${eventKey} processed successfully` };
```

It extracts mentions, and if one matches a single hardcoded address it kicks off
a **PR-check workflow**. It never writes a message to the ticket's conversation.
Your comment mentioned nobody, so the handler found no mentions, returned
success, and the comment was gone.

An earlier draft of `LINKING.md` said "Bitbucket is different — it has
`pr:comment:added` and a real `handleCommentEvent`, so comments flow from
Bitbucket and not from GitHub." That was wrong: the handler exists, and it
records nothing. Comments flow from neither.

**GitHub** is worse in a different way. Its router handles exactly two events
(`githubWebhookService.ts:130-152`):

```ts
if (eventType === 'pull_request')  …
if (eventType === 'issue_comment') …
logger.info(`Event ${eventType} acknowledged but not processed`)
```

A comment on a line of the diff — the "Files changed" tab, which is how most
review actually happens, and what `#r3963340329` in your URL is — arrives as
**`pull_request_review_comment`**. That is not in the router at all. Neither is
`pull_request_review`, which carries approvals. And even a plain `issue_comment`
only does anything if it mentions `@xynespaces`.

### The fix

Three files:

| File | Change |
|---|---|
| `prTicketStatusSyncService.ts` | New `recordPRComment()` — resolves the PR to its ticket and writes a `SYSTEM` message, reusing the existing `findPR` / `findTicketForPR` / `resolveUpdatedBy` so a comment attributes to the same person and lands on the same ticket as every other PR event |
| `bitbucketWebhookService.ts` | `handleCommentEvent` calls it, with the diff anchor (`comment.anchor.path` / `.line`) when there is one |
| `githubWebhookService.ts` | Routes `pull_request_review_comment` and `pull_request_review`; records ordinary `issue_comment`s too, mentioned or not |

The mention check stays exactly where it was. It decides whether an **agent**
acts; it should never have decided whether a **person** can see what was said.

The message carries `prEvent: 'COMMENTED'` alongside the existing `prUrl` /
`prId` / `prWebhook`, so it is distinguishable from a state change, plus
`prCommentUrl` (a permalink to the comment) and `externalAuthor`. This app reads
all of those already — `lib/provenance.ts` will badge the row **via Bitbucket ↗**
or **via GitHub ↗** and link to the comment with no further change.

### Status

- `git apply --check` passes against `xyne-spaces@466c7046d` (branch `fix/call-route`)
- `npx tsc --noEmit -p apps/backend/tsconfig.json` is clean with it applied
- **Not applied.** Your working tree was left untouched.

```sh
cd /Users/pradeesh.s/Documents/github/xyne-spaces
git apply /Users/pradeesh.s/Documents/multiplayer-org/multiplayer-org/patches/pr-comments-to-tickets.patch
```

One thing to check before it does anything for GitHub: the repository's webhook
must be **subscribed** to the new events. Delivering `pull_request_review_comment`
is a checkbox in the repo's webhook settings, and no code change makes GitHub
send an event nobody asked for.
