# METAENGINE DevFleet — separate ChatGPT development client

**Independent product**, not a mode of METAENGINE Browser.

- Windows product/installer: **METAENGINE DevFleet**, appId `com.metaengine.devfleet.standalone`.
- Browser userData: `%APPDATA%\METAENGINE DevFleet`; Electron session partition `persist:metaengine-devfleet-auth-v1`.
- The parent METAENGINE Browser, its Guardian, installed files, updater, scheduler,
  PostgreSQL and Supervisor are **not opened or mutated**.
- No Supabase, hosted database, second cloud task backend, shell/eval, user-supplied CDP
  or privileged OS process control. This MVP has no production DB dependency.
- User may need to log in to ChatGPT once inside this **separate** profile.
- Exactly three operator operations: `chat.create`, `chat.read`, `chat.assign`.
  A read-only `chat.list` is available to recover the created conversation IDs.

## Local operator control

The app writes a private bearer manifest at
`%APPDATA%\METAENGINE DevFleet\operator-rpc.json`, binds an ephemeral
`127.0.0.1` port and supports `POST /rpc`. The token must never appear
in chats or logs. From the repo root:

```powershell
node apps/metaengine-devfleet/scripts/devfleet-cli.mjs create --count 7 --id roadmap-create-20261012-1
node apps/metaengine-devfleet/scripts/devfleet-cli.mjs list
node apps/metaengine-devfleet/scripts/devfleet-cli.mjs read --tab tab_<uuid>
node apps/metaengine-devfleet/scripts/devfleet-cli.mjs assign --tab tab_<uuid> --file .\task.txt --id p0-step-20261012-1
```

Only use exact IDs returned by the client. Save task prompts in a private local
file and never pass passwords, keys or cookies to chat tasks. The sending
operation appends a non-secret unique request marker, checks the typed composer,
clicks Send exactly once and waits for visible conversation proof. An ambiguous
send is **never** automatically retried.

## Continuity and limitation

For this **minimal three-operation MVP**, a bounded `operator-state.json` in the
separate profile records chat URLs and request hashes / receipts (not prompt
bodies or secret tokens). Upon restart, the standalone Browser reconnects these
exact ChatGPT URLs. An unresolved send stays ambiguous and blocks later sends
to the same tab until manual reconciliation. This file is not a second
METAENGINE task database. A future integration with an independently operated
PostgreSQL ledger would be a *separate, explicitly approved milestone*.

Acceptance requires (1) source/security tests, (2) independent NSIS EXE
identity/provenance and installed readback, and (3) real authenticated ChatGPT
`create → assign → read → assign` proof. A running process or empty ChatGPT
page is not evidence that real sends have succeeded.

The installed product is independent of the standalone dev-worktree; use the
version and EXE SHA-256 readback rather than assuming sources are installed.

## Live Development Console (0.1.0-dev.2; staged development)

**One bootstrap installation, many checked UI iterations.** Open the
**DevFleet > Live Development Console** menu (`Ctrl+Shift+D`). Choose the
trusted `apps/metaengine-devfleet` source directory once through the local
directory picker. This pins the source folder; pages and model outputs cannot
set or change it. Subsequent iterations:

1. Edit `src/index.html` in the pinned source worktree using your normal
   IDE/terminal/Codex tools; keep application title, embedded entrypoint and
   typed `window.devfleet` bridge.
2. In the Console, press **Stage**. The host parses the exact local HTML and
   JavaScript, blocks external scripts/iframes, checks size and ABI, and copies
   the file to a SHA-256-addressed private immutable slot.
3. Press **Activate**. Only the main DevFleet UI is reloaded from this
   exact staged copy; ChatGPT `WebContentsView` sessions and cookies are
   separate and MUST remain intact. The activation generation, hash and
   previous slot are recorded atomically.
4. If unsuitable, press **Rollback** to the prior live UI. On ambiguous
   load or persistence failure, the host fails closed to the last-known-good
   page until manual reconciliation. Do **not** reattempt blindly.

After the one-time local directory selection, a trusted command-line process
on the authorized PC may also use the **separate developer-only bearer
capability**, `%APPDATA%\METAENGINE DevFleet\developer-rpc.json`, to run:

```powershell
node apps/metaengine-devfleet/scripts/devfleet-live-cli.mjs status
node apps/metaengine-devfleet/scripts/devfleet-live-cli.mjs stage
node apps/metaengine-devfleet/scripts/devfleet-live-cli.mjs activate
node apps/metaengine-devfleet/scripts/devfleet-live-cli.mjs rollback
node apps/metaengine-devfleet/scripts/devfleet-live-cli.mjs reconcile
```

The regular `operator-rpc.json` bearer **cannot** stage or activate UI.
The developer capability never accepts arbitrary paths, script bodies, SQL,
OS commands or CDP expressions: it acts only on the already operator-pinned
source tree. Neither token should ever appear in a chat/log/repository.

**Boundary:** this first phase hot-updates *the UI and workflows implemented
within that UI using the existing three typed chat tools*. A new Electron
main-process feature, preload privilege or native capability still needs a
qualified application release; future signed ABI-versioned runtime modules
will permit more backend logic without reinstalling the bootstrap. Such
native/privilege changes are never silently injected from a ChatGPT page.

**Cross-client contract:** the same stable-bootstrap + versioned feature
module + evidence/rollback model is mandatory for the principal METAENGINE
Browser, while preserving **its own PostgreSQL**, Guardian and Supervisor
authority. See
`coordination/operator-control/ROADMAP_UNIFIED_COMMAND_CONTINUITY_V1.md`
section "Binding cross-client requirement: Live Development Plane".

### First live module: Chat fleet read-only qualification

The `src/index.html` first post-install candidate adds **«Аудит всех чатов»**.
This iterates only `window.devfleet.list/inspect` (no model send, reload,
arbitrary scripts, owner database mutation or browser process intervention).
The interface refuses to label a session ready unless it independently sees
`mode=CHAT`, `high_label_visible=true`, `gpt6_label_visible=true` and
no page failure. All other states remain unverified or blocked. A separate
19-test source suite includes a mocked UI that verifies the auditor cannot
invoke `chat.assign` or `chat.recover` while inspecting fleet state.

The visual auditor is **not** a proof that ChatGPT actually selected GPT-6
High in every tab, and the installed native Host only hard-enforces Chat
rather than GPT-6 High. Do not automatically dispatch roadmap work until
each exact chat has model-setting proof; ordinary chat prompts never alter
the ChatGPT model picker.

### Native model/input preflight (0.1.0-dev.3 candidate)

DevFleet v0.1.0-dev.3 adds bounded, authenticated native `chat.model_probe`
and `chat.input_probe` operations. `model_probe` checks a CHAT-only target,
opens only a unique ChatGPT model-picker control and observes bounded model
menu option labels plus explicit selected flags; it closes the menu with
Escape and does not send a message. Mere visible text `GPT-6` or
`Высокий` is **not** an assertion that the selected model is GPT-6 High.
The input probe returns only booleans for unique textbox/Send and an existing
draft, never the draft text. The native Send control recognizer now uses
Unicode-safe Russian/English names and enables DOM before attempting focus.

These are native adapter additions that require one qualified bootstrap
upgrade. The UI for them was independently hot-activated through Dev Console
in generation 4 while retaining nine owned tabs and two historical ambiguous
send receipts. Do not reuse either ambiguous task ID until exact prior
conversation evidence has been reconciled; never send into Work.


## Guarded one-call dispatch (source candidate, not installed)

The authenticated local `chat.batch_assign` route takes at most eight distinct
`{tab_id,request_id,text}` records (32,000 characters total) in one HTTP request.
It performs an exact GPT-6 High selection readback, Chat-only input/draft
preflight, a persisted request receipt **before** each Send, and readback
after each Send. A previous request ID is replayed from the receipt and does
not click Send again. On AMBIGUOUS outcome it marks remaining records
NOT_ATTEMPTED. A refused model, missing composer, or existing draft does not
create a false send receipt.

Input file example for the trusted CLI (replace IDs with owned tab IDs):

```json
{"assignments":[
  {"tab_id":"tab_11111111-1111-4111-8111-111111111111","request_id":"roadmap-p0-20261012-001","text":"Implement independently scoped P0 fix"},
  {"tab_id":"tab_22222222-2222-4222-8222-222222222222","request_id":"roadmap-p1-20261012-002","text":"Implement independently scoped P1 fix"}
]}
```

`node apps/metaengine-devfleet/scripts/devfleet-cli.mjs batch_assign --file .\\batch.json`

**Safety and performance:** one call eliminates external command round-trips,
but **does not parallelize physical Sends**. A ChatGPT tab shares the visible
WebContents selection; this build deliberately serializes every UI send under
the existing operator lock. GPT-6 High is checked independently for every
item; source code and user assertions are not sufficient. Real native
endpoint, packaged client and ChatGPT delivery qualification remain release
gates. Installed versions without this route return method_unknown.

The independent read-only `scripts/fast-observe.mjs` can already batch
parallel tab reads on compatible installed DevFleet builds, without granting
any additional mutation authority.

## Restore and receipt corrections — 2026-10-13 (source candidate)

The early loopback API reports `RESTORING` while up to four saved cells
reconnect. An `OPEN` cell must return the exact saved conversation URL;
`www.chatgpt.com` and an optional trailing slash are equivalent. A redirect
to the ChatGPT root or a different conversation stays `RESTORE_BLOCKED`.
Reads, probes, recovery and new assignments refuse blocked cells before
calling the native adapter. Existing receipts remain available, and a
blocked cell can still be closed through the typed replacement workflow
without first inspecting a missing page. An ambiguous Send prevents closure.

Observation deadlines now reach the native adapter as an `AbortSignal`.
The signal invalidates event hints and prevents a late AX result from
acknowledging a quiet baseline; it does not cancel Chromium's CDP command.
Final receipt persistence failures for Send or close return `AMBIGUOUS`.
Replaying the same close remains ambiguous; new mutations and Send retries
in that process remain fenced until reconciliation. These changes require a new qualified
native release; source tests alone do not prove installed ChatGPT delivery.


## Native batch observation candidate (source-only, 2026-10-12)

`chat.batch_observe` is a new **read-only** authenticated loopback RPC, stacked
on the guarded batch-dispatch branch. It observes all current OPEN owned tabs
by default, or 1–16 explicitly identified tabs, at concurrency 1–4.
Each tab is read once from its **own** WebContents' Chrome accessibility
tree; the app does not select the tab, click, send, reload, open devtools or
run page scripts. Each read has an 8-second per-tab deadline, and a failure
returns `UNKNOWN` without retrying or contaminating other tabs.

A result's SHA-256 `revision` binds (in a process-local namespace) the
process epoch, native target ID, navigation generation, normalized allowed
ChatGPT origin/path and a bounded transcript. A navigation or destroyed tab
mid-read is refused. A reload changes the revision even when page text is
equal. The native API returns hashes and lengths, not conversation text,
cookies, raw DOM or bearer tokens. If the 180,000-character transcript cap
is reached, the comparison is `TRUNCATED_UNVERIFIED`.

Use the CLI after a **new qualified native install**; the existing installed
v0.1.0-dev.6 does not gain this method from a source-only PR:

```powershell
node apps/metaengine-devfleet/scripts/devfleet-cli.mjs batch_observe
node apps/metaengine-devfleet/scripts/devfleet-cli.mjs batch_observe --file .\\cursor-request.json
```

Optional request: `{"parallelism":3,"tab_ids":["tab_<uuid>"],"since":[{"tab_id":"tab_<uuid>","revision":"<64-hex-from-previous-result>"}]}`.
Only a fresh native read can return `UNCHANGED`. A revision comparison is
**not** independent evidence that an agent completed work, selected GPT-6 High,
or produced a verified GitHub artifact. It must not authorize Send, promotion,
task completion or a checkpoint. Page/model output remains untrusted.

This implementation is an always-fresh bounded-AX baseline, **not** a
claim that CDP `Accessibility.nodesUpdated` has been adopted or physically
qualified. Event-driven caching and source-backed completion extraction
require separate false-negative tests, renderer-restart/hidden-tab chaos,
and physical Windows release qualification.


## Fast event-hint polling candidate (not installed)

After at least one **fresh native `chat.batch_observe`** has initialized
a trusted WebContents baseline, `chat.batch_poll` returns a compact
O(1)-per-tab hint without traversing the accessibility tree or opening
a ChatGPT menu:

```powershell
node apps/metaengine-devfleet/scripts/devfleet-cli.mjs batch_observe
node apps/metaengine-devfleet/scripts/devfleet-cli.mjs batch_poll
```

The listener is target-bound to native
`debugger.on('message', method)` for
`Accessibility.nodesUpdated` / `Accessibility.loadComplete`, with
navigation, SPA route change, process death and debugger-detach invalidation.
The 2-second monotonic TTL forces fresh readback even if a Chrome event is
dropped or a hidden tab is throttled. Poll states are:

- `UNINITIALIZED`: no valid exact WebContents baseline
- `DIRTY_HINT`: new native signal or invalidated baseline; prioritize a full read
- `RESCAN_DUE`: no signal but baseline has expired; do a full read
- `QUIET_HINT`: short-lived advisory signal only, **not proof of unchanged text**
- `UNKNOWN`: missing or inconsistent native observation

These are **scheduling hints**, not credible completion, model, readiness
or safety proofs; `completion_proven:false` is mandatory. A GPT operator
or UI should call `batch_observe` before comparing revisions, and must use
real source/CI/artifact readback before advancing tasks. No Send or page scripts
are part of either endpoint. Live Electron/ChatGPT events have **not** yet
been physically qualified on this source candidate.


## Native candidate qualification — 2026-10-12 (unsigned, NOT installed)

The isolated Windows candidate is `0.1.0-dev.7.1196.1` from
`work/devfleet-native-qualification-v1` (built source commit
`af299d565fb75d60447252b22dba4550ebb07e6e`; later repository-only
scripts/docs are excluded from the bundled ASAR). No change was made to
the existing installed `0.1.0-dev.6`, its sessions or main METAENGINE.

Physical Windows qualifications:

- Node v24.19.0: **48/48 PASS**, including per-tab deadline cancellation.
- Source Electron `--devfleet-live-ui-smoke`: PASS; a UI stage, activation,
  rollback and BrowserCell retention were reported.
- Synthetic offscreen Electron CDP test: AX role/name change was read back,
  `Accessibility.loadComplete=true` after reload, but
  `Accessibility.nodesUpdated=false`. Treat live-text event delivery as
  **UNPROVEN**. The 2-second expiry remains a required fallback.
- `scripts/verify-package.mjs`: byte-for-byte match between current source
  and eight shipped `app.asar` native/UI modules; PASS.
- Electron-builder 26.15.7 / Electron 44.0.0 NSIS x64: SUCCESS.
- Installer SHA-256:
  `104858efefb3c9d0e8aca96fb4e6ad36a359e4dd86641502ce3b8b54549784b1`;
  size **119,659,526 bytes**.
- `app.asar` SHA-256:
  `cc0f5c8da6ed5d8b8f916fc8f813fe97ce7791d12af83c676055195472750aba`.
- Windows Authenticode for the installer: **NotSigned**, despite signing
  progress lines in the electron-builder log. Do not claim code signing.
- Running the unpacked GUI EXE in temporary `--devfleet-live-ui-smoke` mode
  exited 0 but produced no attached stdout, so count this as *launch only*,
  not a verifiable PASS of the smoke payload.

Installer location on authorized PC (not a public download):
`C:\Users\User\Desktop\metaen\devfleet-qualification-worktree\apps\metaengine-devfleet\dist\METAENGINE-DevFleet-Setup-0.1.0-dev.7.1196.1-x64.exe`.

**Remaining release gates:** unambiguous installed/packaged smoke receipts,
signature/trusted provenance policy, upgrade session preservation, physical
native `chat.batch_observe` and `chat.batch_poll` with authenticated
ChatGPT and hot/hidden-tab renderer chaos. No promotion, auto-installation,
main-branch merge or inference of model/task completion from AX hints.


## Live Operator MCP v1 — source candidate (2026-10-13)

The separate DevFleet application is an independent, persistent developer client.
This candidate introduces a stable native administrative protocol intended to
avoid repetitive NSIS upgrades for **UI, bounded contracts and pinned source
workspace edits**. The administrative bridge is packaged as
`resources/devfleet-admin-mcp.mjs` in the next qualified Windows build.
It is **not** in the older installed binary until that candidate is proven
and separately installed by the owner. Native Electron/preload/OS-authority
changes continue to require a qualified binary upgrade.

**One-time trust bootstrap:** open DevFleet > Live Development Console and
locally pin an exact trusted `apps/metaengine-devfleet` source folder.
This stores a dedicated private `developer-rpc.json` bearer. It is
separate from the ordinary `operator-rpc.json` capability and must not be
shared with chats or checked into Git. A local MCP host can launch the
packaged Node bridge from `resources/devfleet-admin-mcp.mjs` as a stdio
MCP process. After this one-time MCP connection, it exposes two stable
tools:

- `devfleet_overview`: rapid read-only fleet snapshot, native event hints,
  receipt counts, contract generation and source workspace status.
  It never claims that an open ChatGPT tab equals a working agent.
- `devfleet_admin`: a generic `{method,params}` method that remains stable
  as new server-side developer methods are added. No raw shell, JavaScript,
  arbitrary CDP or SQL endpoint exists.

Example administrative operations (the MCP host handles bearer credentials):

```json
{"method":"dev.overview","params":{"depth":"DIGEST"}}
{"method":"dev.contract.status","params":{}}
{"method":"dev.contract.stage","params":{"expected_generation":0,"contract":{
  "schema":"metaengine.devfleet.operator-contract.v1",
  "dispatch_enabled":true,"max_batch_items":4,"max_prompt_chars":8000,
  "max_observe_parallelism":4,
  "existing_draft":"DENY_EXISTING_DRAFT","require_verified_model":true
}}}
{"method":"dev.contract.activate","params":{"expected_generation":0,"expected_sha256":"<the returned staged_sha256>"}}
{"method":"dev.source.inspect","params":{"path":"src/index.html"}}
{"method":"dev.source.patch","params":{
  "request_id":"devfleet-source-unique-20261013-001",
  "path":"src/index.html","expected_sha256":"<current file SHA-256>",
  "content":"<complete replacement source bytes>"
}}
{"method":"dev.receipt.reconcile","params":{
  "request_id":"<existing exact Send request ID>","tab_id":"<owned tab ID>"
}}
```

`dev.contract.rollback` uses a precise generation CAS; transitions are
write-ahead persisted and a crashed transition fences future dispatch.
`dev.contract.reconcile` conservatively disables dispatch rather than
manufacturing a successful activation. Source patches require exact
source hashes, paths beneath the manually pinned worktree and an append-only
bounded request ledger. They do **not** silently load revised privileged
main-process code. For UI edits, `dev.stage` and `dev.activate`
continue to use the verified immutable HTML slots.

Receipt reconciliation observes the exact owned conversation and clears an
`AMBIGUOUS` tab fence only after positive native sent-message readback and
durable receipt write. Absence of the marker is **not** proof that nothing
was sent. The previous ambiguous record/request ID is retained; no repeat
Send is attempted.

The physical Send and all source/policy maintenance share one operator lock.
The faster `FAST` overview defaults to O(1) native hints; `DIGEST`
explicitly requests bounded parallel AX observation (not task-completion
proof). No Supabase, cloud fallback, main Browser/Guardian/production
PostgreSQL authority, or automatic agent retry is added.

**Qualification gates:** exact-head Linux/Windows Node suite, pinned source
path adversarial tests, Windows NSIS package and MCP resource readback,
then independent installed profile/authenticated ChatGPT send and
reconciliation canaries. A green source CI alone is not a production release.
