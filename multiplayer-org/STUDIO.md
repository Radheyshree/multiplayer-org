# Studio — an AI-Studio-class app builder, built on Claw

**Surface:** `components/surfaces/Studio*.tsx` · **Data layer:** `lib/studio*.ts`
**Status:** working end to end, verified in a real browser against the live workspace.

Describe an app → a Claw agent writes the files → they **run for real** in the
preview → every followup keeps the conversation *and* the code. Preview, code,
diff, versions, restore, element-picker, and a deploy path into the workspace
Library.

---

## Why this exists, given Xyne already generates apps

Xyne's dashboard can already build an app: you describe one in Ask AI, the agent
calls the `create-app` tool, and a Sandpack frame renders it. That works. Three
things about it are what an AI-Studio-class tool fixes:

| | Dashboard app creation | Studio |
|---|---|---|
| **The code** | Not yours to see. `create-app` returns a *manifest* — paths, never contents. | The files **are** the state: readable, diffable, editable, re-run on save. |
| **Versions** | Not navigable. | Every turn is a version. Restore is a read, not a re-run. Diff against the previous turn is one click. |
| **Progress** | A spinner. | The tool the agent is running, the tool count, and the clock — all real, all moving. |
| **Iteration** | A chat thread that happens to emit artifacts. | A build loop: preview ⇄ code ⇄ followup, with the current source replayed every turn. |

And one thing it adds outright: **apps built here can read the real workspace
while you are still iterating**, because the preview runs in-process and the
generated module graph resolves `xyne` to the live SDK.

---

## The three load-bearing decisions

### 1. We cannot use `create-app`, and that turned out to be better

Every run an app starts carries a conversation id prefixed `app_`
(`xyne-claw-auth/.../artifact-app-agents.ts:88`), and the runtime strips
`create-app`, `read-app-file` and `schedule-task` from any such run — the
**self-replication ban** (`xyne-claw/src/routes/run.ts:3272`). An app that can
ask its agent to build an app produces a chain nothing outside can kill.

There is an apparent loophole — an SDK run via `spaces.claw.run` sets no
`eventType` and lets you choose the conversation id — and it is not usable: the
tool writes its payload to GCS and hands back only a manifest, readable only
behind an S2S key an app never holds. You would generate an app you cannot read.

So Studio imposes **its own wire format**: fenced blocks tagged with a path.

```tsx path=/App.tsx
export default function App() { return <div>hi</div>; }
```

It costs one paragraph of prompt, works with **all 214 agents** in the workspace
rather than the handful configured with the tool, and hands back the file
*contents* — which a live preview needs anyway.

### 2. The preview evaluates in-process, not in a nested bundler

A published Space app is *already* inside the CodeSandbox bundler's iframe.
Nesting a second bundler would mean a second npm install and a second cold boot
on every iteration — the exact thing Studio exists to remove.

So: **Sucrase → CommonJS module registry → mount with our own React.**

- Refresh is sub-100ms. Iteration is the product.
- Tailwind already works: `@tailwindcss/browser` is in the sandbox's base
  dependencies and compiles classes off DOM mutations, so a class the generated
  app invents is styled the moment it mounts.
- One React instance — no duplicate-copy hook failures.
- The app reaches the real SDK with no bridge.

`new Function` is not a new capability: the bundler evaluates our own module
graph in this same document to run us at all. Electron's CSP injector only
targets `FRONTEND_URL` (`request-interceptor.ts:248`) and never reaches here.

The trade is isolation. Generated code *can* reach Studio's DOM. Acceptable for
code the viewer just asked an agent to write and is watching run; it would not be
for running someone else's app, and Studio doesn't do that.

### 3. Followups are real conversation, not a re-prompt

**Verified live:** passing our own `conversationId` to `spaces.claw.run` gives
genuine multi-turn memory — a value stated in one run was recalled by a second,
separate run carrying the same id. Nothing in the SDK docs says this.

Studio still **replays the current files every turn**. Memory alone is not
enough: the user can restore an old version or hand-edit the code, and then what
the agent remembers writing is no longer what is on screen. Sending the files
makes the editor the single source of truth and a wrong followup impossible
rather than merely unlikely.

---

## What the SDK actually does (measured, not read)

| Claim | Reality |
|---|---|
| `getRun` returns `{sessionId, status, result?, error?}` | It returns the **whole AgentRun row** — `currentToolLabel`, `toolInvocations`, `reasoning`, `toolsUsed`, token counts, timings. The registry sets no `mapResult`, so the extra fields pass straight through. The progress UI is free. |
| Result text streams | **It does not.** Measured: 0 bytes for 51s, then 4,872 bytes at 66s. It lands whole at the terminal poll. |
| Runs take seconds | 23s and 66s when the agent replies directly; **299s+** when it reaches for its file tools. The prompt now forbids tool use, and the watcher's deadline is 15 minutes. |

Because the answer does not stream, Studio shows **only what it can honestly
know**: the current tool label, the invocation count, and elapsed seconds. No
fake typing animation.

---

## Data model

App storage is key-addressed only and caps a record at **64 KB serialized**, so a
version is split the way the platform splits an app: **one record per file**.

```
studio.projects   <projectId>                    meta + turn history
studio.versions   <projectId>.<nnnn>             manifest: summary, prompt, paths
studio.files      <projectId>.<nnnn>.<iiii>      one file
```

`head` is the version you are looking at; `seq` is the highest number ever
**issued**. They differ after a restore — and issuing from a monotonic counter is
what stops "restore to v1, then change something" from writing a second v2 on top
of the first one's file records.

---

## Deploy — and the one-way door

Studio can create a **real Xyne app**, as the signed-in viewer, through the same
`/claw/api/v1/artifact-apps` routes `spaces app publish` uses. The CLI's own
module notes these are "one of the few claw-auth routers mounted WITHOUT the
access-token barrier" — plain cookie auth, which our tunnel already speaks.

This is not the self-replication ban being circumvented. The ban stops an app's
*agent* from calling `create-app`. This is a person clicking a button.

**Two properties shape the UI, and both are stated in it rather than only here:**

1. **There is no delete.** The router exposes create, version, publish, unpublish
   and restore — and nothing that removes an app. `unpublish` only makes it
   private again; the row is permanent. So Studio creates **unpublished**, and
   publishing is a second explicit act.
2. **It runs as the viewer.** Anyone who opens Studio and deploys creates a row
   under their own identity.

"Show what would be sent" renders the exact payload without creating anything.

**Known limitation, surfaced in the deploy panel:** an app that imports `xyne`
for live workspace data runs in the preview but will not *build* once deployed —
`xyne` is a virtual module Studio's preview resolves, and the published sandbox
has no such package. Deployed apps reach data through the host's own runtime.

---

## Verification

Two harnesses, both driving a real headless Chromium against the dev server. No
browser extension; they use the system Chrome binary.

**`unit.mjs` — 36 assertions, ~4s.** Points Playwright at the vite dev server and
`page.evaluate`s a dynamic `import('/lib/studioRuntime.ts')`, so the *real*
modules are exercised with real Sucrase, real React and real shadcn imports — no
stubs. Covers parsing real captured agent output, multi-file graphs, circular
imports, index resolution, TS generics/enums, reserved-path rejection, named
errors for unknown imports, CSS collection, entry fallback, and SDK reachability.

*(Trap, if you reuse the technique: bare specifiers do not resolve in a runtime
dynamic import — vite rewrites those at transform time and this code was never
transformed. Import your own module and take React off it.)*

**`e2e-full.mjs` — the whole loop with live Claw runs.** First turn → interactive
preview → element picker → followup → v2 → diff → restore → deploy gating.

Regression tests exist for every bug an adversarial review confirmed, including
the one whose original assertion was too weak to catch it: a bare ``` inside a
generated file used to truncate it silently, and the test passed anyway because
it only checked that *some* content survived.
