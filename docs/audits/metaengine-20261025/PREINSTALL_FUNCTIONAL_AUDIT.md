# Preinstallation functional audit and repair record

Date: 2026-10-25. Installation remains blocked.

## Decision and source boundaries

The frozen `.4589.1` installer is **rejected for the autonomous-development acceptance objective**. Its exact source is `e4c88cdcf68d3c8002b1fa4274324299cc4f337d`; the artifact has independent payload verification, but does not contain the native coding work developed on `work/metaengine-operator-autonomy-20261022`. A valid installer digest cannot establish a missing feature. Do not relabel the frozen artifact with tests from another checkout.

The active repair baseline was `ebf94e50fd652ca2d68461444be2b3afd171fdeb`. UI replacement was committed in `c88f005`, per-run MCP/Host/Git/SQL integration in `846c2d7`, the recovery merge in `a31881c`, and remaining retired UI adapters in `774af98`. These source commits require a distinct rebuilt artifact. The prior installed `.4588.1` and its PostgreSQL/Keeper are preserved. Preparing a protected backup/candidate and stopping its qualification Host is not Owner publication or installation.

The user explicitly required a full audit before installation. Neither a source-reference inventory nor a passing subset of tests proves that every possible UI or runtime path works. The open gates below must remain visible; this record is not a blanket certification.

## Evidence collected

- Three independent source audits traced the current package entry, UI navigation/handlers, twelve Edge route modules, auth/SQL boundaries, thirty backend mechanics, Windows executor, Guardian, installer and restart path.
- The UI source inventory found 24 TSX components, 17 reachable components and 181 reachable lexical control tags in the frozen candidate. These counts are source inventory, not 181 physical clicks.
- Conservative Browser/backend reference graphs retain unresolved reachability candidates. A missing static incoming edge alone is not sufficient evidence to delete a dynamic entry, worker, preload or diagnostic module.
- Frozen candidate UI was launched with its exact staged Next payload, isolated from the Owner/runtime. Physical navigation reproduced Tasks' unavailable source and the Supervisor autopilot button's permanent `Action unavailable` toast. Code exposed retired tool panels alongside real managed-project readers.
- Repaired UI passed all 47 existing/new `apps/me2-ui/src/lib/*.test.mjs` tests and a production webpack build with the unchanged, matching package/lock dependency tree. Physical navigation confirmed the retained native Tasks, Settings and search. At the observed 320 CSS-pixel viewport the layout remained usable. This standalone UI has no native bridge and cannot qualify installed effects or data reads.

## Findings and repair status

| Area | Actual defect or missing acceptance step | Repair / remaining gate |
| --- | --- | --- |
| Release identity | `.4589` has none of B's native CLI, independent coding checkpoint or commit continuation | Frozen candidate rejected; a distinct integrated version and exact-head rebuild are required. |
| Supervisor UI | Reachable mutation forms always terminate in a permanent toast stub | Removed retired page, handlers and navigation; goal submission remains in the real primary workspace. |
| Tasks / queue / palette | Reads came only from an empty compatibility probe with `task_content_authority:false` | Shared typed projectOverview/projectSnapshot resource; exact IDs/cursors, explicit page bounds, stale states and real per-task history. |
| Legacy Code / Memory / Evidence / Settings | Retired daemon terminal, edit/demo, sandbox lifecycle, vault/policy, reset/budget and eval controls advertised missing transports | Removed those pages/forms/handlers and dormant legacy UI components. Managed Projects/history, native Operator and typed connections/recovery remain. |
| History reader | Full event content was stored but only exposed as a truncated line/title | Accessible expandable, selectable full event content; no HTML execution. |
| Packaged dead adapters | Five retired ME2 Brain/fleet/tabs/mesh/socket implementations still shipped through `src/**/*` | Removed production files and obsolete tests for the retired tabs adapter; retained actual Browser identity/gateway coverage. |
| Windows PC bridge | Bare `powershell.exe` and inherited full environment | Absolute canonical OS interpreter, OS-only search/module path, narrow environment, owner-protected per-operation temp, bounded cleanup. 36 targeted tests passed, including real read-only STATUS; the separate GUI capture fixture was excluded from this run. |
| Request ingestion | Body read/JSON allocation preceded authentication without byte, time or stream limits | Streaming reader bounds body to 8 MiB, shared buffering to 16 MiB, eight streams and twelve seconds. Health/OPTIONS bypass that pool. Five request-budget tests pass, including chunked overflow, malformed UTF-8, slow streams, concurrent buffering and capacity cleanup. |
| Native agent collaboration | C has no addressed full-text delivery or peer overview; browser tool history truncates event content | Protected SQL, actual Host actions and per-run MCP are integrated. Read/write ambiguity remains fenced. Tests establish storage and tool transport; actual model pickup and agent-to-agent interaction remain unqualified. |
| Native checkpoint / Git / successor | B stopped at CHECKPOINTED_PENDING_COMMIT; its project heartbeat ignored SQL's native commit candidates | Real Git finalizer, Host commit service and append-only permit/base rotation are integrated. The existing project heartbeat now forwards bounded selectors to a nonblocking commit observer; first dispatch requires physical NOT_ATTEMPTED, uncertain writes use readback only. Runtime drain joins active checkpoint/commit operations. |
| Host IPC composition | Authority object includes private `close`, while IPC demanded exactly dispatch action keys | Fixed; the lifecycle method remains private. Integrated real IPC and runtime-loss checks pass. |
| Packaged native imports | Repository-relative Browser imports can escape app.asar; plain Node cannot execute bridge files inside ASAR | Browser-local source closure and three separately hash-pinned bridge resources are integrated; package/ASAR fixtures pass. A new complete installer is still required. |
| Runtime loss / recovery | Host exit was mistaken for child cleanup; late startup after stop, missing agent drain and sticky cleanup failures | Second-stream patch was merged by behavior with MCP. 114 joint tests pass, including bridge revocation before joining an interrupted runner. A fresh-Browser recovery coordinator remains under development. |
| Initial native task | Existing browser goal submission creates a different immutable task kind | Protected native seed/profile admission is being qualified separately. Actual loaded-device authentication, main/Host mount and real UI submission remain required. |
| Native admission / readiness | Native leases still inherit browser-conversation recovery gates; readiness still projects the legacy coding backend | A native-only signed evidence contract is required. Do not clear historical browser ambiguity or set decorative readiness flags. |
| Supervisor rebinding | Endpoint module captures instance identity at evaluation; changing env after a replacement Host cannot rebind it | Fresh Browser/bootstrap or an explicitly designed generation transition is required. Blind in-process bootstrap retry is insufficient. |
| Installed acceptance | No completed live code → independent CRITIC → checkpoint → Git → successor → physical restart proof | Must be demonstrated after all preinstallation gates pass. Component fixtures and chat-development subagents do not count as installed METAENGINE agents. |

## Recovery ownership

`work/runtime-recovery-second-stream-20261025` starts from the same `ebf94e5` baseline in a separate checkout. Its changes overlap native runtime, Host IPC client, Host lifecycle/controller, observers and related tests. Merge by behavior and rerun those tests together with MCP/commit integration; never overwrite either side wholesale. The terminal proof must bind the actual child generation, cleanup and released ownership. A stopped Host does not prove that an interrupted agent's task can be replayed.

The working PostgreSQL/Keeper must retain its existing identity. No Owner/profile deletion, database reset, unresolved-write retry or relaxed trust claim is part of this audit repair.

## Joined checkpoint-to-successor evidence

The new project commit observer passed eleven adversarial tests; the joined checkpoint/runtime run passed 52 tests after adding positive drain of an active private commit. These overlap previous suites and must not be added to an invented total.

The actual project heartbeat was then joined to the actual Host service, disposable PostgreSQL 17 and a locked physical Git worktree: four tests passed. It dispatched one commit, verified the old-ref CAS, committed the SQL receipt despite a deliberately lost COMMIT acknowledgement, appended fresh permits and obtained the next real W30 lease. SQL system identifier `7700453151651499324`; old Git head `62dd86d29ca48494c7be5d3eee8931ae5ca18d87`, new head `ef946bb6afe26d70826a9dc03381812b83836ade`. The disposable cluster was stopped and its PID file was absent. Evidence is kept privately in `.audit-local/native-coding-host-commit-pg-git-lTjzco`.

This joined test still uses generated protected writer/critic receipts and OS/ACL callbacks. It executes zero model calls and uses no installed Keeper. It proves the integrated heartbeat-to-Git/SQL/next-lease path, not installed autonomous work, native sandbox qualification or a physical client restart.

## Installation gates

1. Close concrete functional findings and reconcile the recovery patch with the integrated source.
2. Validate retained UI against real native read models/effects, not only isolated rendering. Mark unsupported capabilities unavailable, never decorative success.
3. Qualify actual Host/SQL/Git/Job bindings and failure/readback/restart semantics, with exact source and explicit fixture boundaries.
4. Reserve a fresh package version, rebuild from a clean exact head, independently compare its source/runtime/UI/native resources, and qualify the staged client on an isolated genuine Owner/PG profile.
5. Only after the preinstallation audit passes may the reviewed upgrade publish Owner and install. Installation/opening and continuous useful-work proof remain separately reported outcomes.

Signing is not configured. Local operator QA and production Authenticode/release-root/SLSA qualification remain distinct; no missing signature is replaced by a status flag.
