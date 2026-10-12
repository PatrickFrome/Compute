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
