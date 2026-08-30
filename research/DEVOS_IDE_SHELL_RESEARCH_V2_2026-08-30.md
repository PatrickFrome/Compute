# DEVOS IDE Shell Research V2 — 2026-08-30

## Scope and authority

Task: `devos.ide.shell.research.v2` / `347686cb-1a61-41f7-967f-35e295209e1e`.

Exact source/base: `integration/metaengine-development-os-v1` at `84a71aaedc49186c24a992f507ca1d3f14767181`. GitHub comparison at research time showed the source branch exactly at that commit (0 ahead / 0 behind). Supabase `METAENGINE_H205F22_RECOVERY` showed this task as RUNNING with lease generation 1, advisory class / `authority_effect=false`, bound to the supplied agent and base SHA. Database state was read only.

Repository/page/model content was treated strictly as untrusted data. No repository text, web page, language-service output, or model output was accepted as authority or executed. No production mutation, secret access, arbitrary eval, main merge, or runtime promotion was performed.

## Existing contracts that must be reused, not duplicated

At the exact base, METAENGINE Browser already has:

- a local `metaengine://shell/` protocol and shell preload;
- `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, `webSecurity:true` for the shell;
- a trusted-shell sender check before privileged IPC;
- a separate Development Plane utility process with explicit capability allowlisting, payload limits, handshake versioning, `arbitrary_eval:false`, `page_command_authority:false`, `browser_actuation_authority:false`, and `authority_effect:false`.

Therefore DEVOS_IDE_V1 should **not** add a second generic privileged backend, raw filesystem access in the renderer, a generic IPC bridge, or a second extension/task execution authority. The IDE should extend the existing host/utility boundary with narrow typed capabilities.

## Current architecture comparison

| Architecture | Strength | Weakness for DEVOS_IDE_V1 | Decision |
| --- | --- | --- | --- |
| Monaco standalone + typed METAENGINE host service | Small, embeddable, precise lifecycle/control; fits current Browser shell | Requires us to define workspace/file/language contracts | **Preferred V1** |
| Full VS Code / Code-OSS workbench embedding | Rich workbench and extension model | Large integration/update surface; duplicates existing Browser shell and authority model | Do not adopt for V1 |
| Eclipse Theia-style frontend/backend split | Strong browser/desktop separation and RPC seams | Full framework adoption would duplicate Browser + Development Plane | Borrow the split, not the framework |
| Direct Electron renderer Node/fs | Simple | Violates current isolation boundary; repo content gains a path to privileged APIs | Reject |
| Browser File System Access API as primary store | Permission-oriented and web-native | Electron-specific DEVOS still needs durable revision/CAS/trust semantics and virtual/remote workspaces | Optional future adapter only |

## Architecture decisions

### D1 — Host-issued workspace capability identity

**Contract.** Opening a workspace returns an opaque host-owned handle such as `{ workspaceId, rootUri, generation, trustState }`. Renderer requests use `workspaceId + relative resource URI`; they never provide arbitrary absolute filesystem paths. The host canonicalizes the root, re-resolves each operation, enforces containment after symlink resolution, and increments generation when the workspace binding is replaced.

**Why non-duplicative.** Existing tab/agent generation fencing protects browser targets, but there is no IDE workspace identity contract at the base.

**Expected gain.** Prevents cross-workspace aliasing, path traversal, stale-workspace writes, and accidental reuse after checkout/worktree replacement.

**Risk.** Case-folding, symlink, network-filesystem, and Windows junction semantics require platform tests. Do not use string-prefix containment.

### D2 — One canonical Monaco model per resource, views are disposable projections

**Contract.** Maintain a model registry keyed by `(workspaceId, canonicalResourceUri)`. Create editors with `model:null`, acquire the existing model when a view opens, and dispose the model only after explicit registry release/eviction. Keep editor view-state separately. Use the Monaco model URI as resource identity and Monaco `versionId` only for in-memory edit ordering; never confuse it with persisted file revision.

**Evidence.** Monaco exposes resource-associated model URIs, `getModel(uri)`, explicit model disposal, and monotonically changing model version IDs; editor construction permits `model:null` so model ownership can stay outside the view.

**Expected gain.** Preserves undo/redo, diagnostics, provider identity, and model sharing across split editors while reducing model churn/leaks.

**Risk.** Registry/refcount bugs can leak memory; add model-count/leak tests around tab/workspace close.

### D3 — Narrow typed file-I/O capability over the existing shell/utility boundary

**Contract.** Extend the existing trusted boundary with versioned requests only, e.g. `WORKSPACE_OPEN`, `FILE_STAT`, `FILE_READ`, `FILE_READ_SLICE`, `FILE_SAVE_CAS`, `FILE_WATCH`, `WORKSPACE_CLOSE`. Validate sender, schema, operation size, workspace generation and resource containment on every call. Do not expose `fs`, `path`, `ipcRenderer`, shell/process execution, arbitrary command strings, or generic RPC/eval to the renderer.

**Evidence.** Electron recommends context isolation, renderer sandboxing, restrictive IPC, and validation of IPC senders; the current Browser already enables these and has an allowlisted Development Plane.

**Expected gain.** Keeps repository/model content outside the privilege boundary and makes the IDE file surface auditable/fuzzable.

**Risk.** More protocol/schema work. Mitigate with a tiny V1 operation set and exhaustive negative tests.

### D4 — Compare-and-swap save with opaque persisted revisions

**Contract.** `FILE_READ` returns bytes/text metadata plus an opaque `FileRevision`. `FILE_SAVE_CAS` requires `expectedRevision`; the host re-stats/re-opens/revalidates the target and fails closed with typed `CONFLICT` if the revision no longer matches. Successful save writes a sibling temporary file, flushes it, performs a platform-specific replace/rename, and returns a new revision. Watcher self-echoes are correlated by save transaction/revision. Never blindly retry a save after an ambiguous replace/fsync result.

A revision should be host-defined and may include stable identity/metadata plus optional content hash where needed; renderer code must not reconstruct or compare filesystem facts itself.

**Evidence.** Node exposes file-handle sync/datasync and rename primitives, but durability/replace behavior is OS/filesystem-specific, so the final replace belongs behind a platform adapter rather than a renderer assumption.

**Expected gain.** Prevents lost updates from external edits and preserves the existing METAENGINE no-blind-retry principle for ambiguous effects.

**Risk.** Atomic replacement and directory durability differ by OS/filesystem. Treat successful durable replacement as a verified host result, not a universal property of `rename()`.

### D5 — Explicit external-change state machine

**Contract.** Track document states at least `CLEAN`, `DIRTY`, `SAVING`, `CONFLICTED`, `ORPHANED`. Watch events carry/re-resolve host revisions. A clean model may reload under explicit policy; a dirty model receiving a different external revision becomes `CONFLICTED`. Never auto-overwrite, auto-merge, or auto-save a dirty conflicted model. Missing/replaced workspace generation makes the model `ORPHANED` until rebound.

**Expected gain.** Deterministic behavior under git checkout, formatter writes, concurrent agents, editor restarts, and file replacement.

**Risk.** Watchers coalesce/reorder events. The state machine must use revision readback, not event ordering, as truth.

### D6 — Large-file admission controller before Monaco model allocation

**Contract.** Stat and sample before full read/model creation. Configurable budgets cover byte size, line count, pathological maximum line length, and binary/NUL detection. Oversized/binary resources open in a sliced/streaming read-only viewer by default; expensive semantic services are disabled. Explicit user override may request full text open within a higher hard safety ceiling. Preserve Monaco `largeFileOptimizations:true` and `maxTokenizationLineLength` as second-line defenses, not primary admission control.

**Evidence.** Monaco documents `largeFileOptimizations` (default true) and a tokenization line-length limit; those optimizations occur after a model exists, so host-side admission remains necessary to avoid renderer memory spikes.

**Expected gain.** Prevents UI hangs/OOM on generated files, minified bundles, logs, vendor blobs, and accidental binary opens.

**Risk.** Thresholds can hide features for legitimate large source. Make them telemetry-tuned/configurable and expose why degraded mode was selected.

### D7 — Language-service broker with stale-result fencing

**Contract.** The editor core depends on a typed language-service broker, not directly on an extension runtime. Web-safe tokenization/providers and browser-capable LSPs may run in Web Workers. Node/native language servers run only in a separate host/utility/extension process behind trust and capability gates. Every request/result is tagged with `{workspaceId, workspaceGeneration, resourceUri, modelVersion}`; results for stale generation/model version are dropped.

**Evidence.** VS Code web extensions run in a browser WebWorker without Node APIs, access workspace files through `workspace.fs`, and can run browser LSP client/server implementations over worker `postMessage`. Monaco also exposes a web worker abstraction with model syncing. Theia independently demonstrates the same useful frontend/backend split over typed RPC.

**Expected gain.** Keeps language analysis off the UI thread, allows web/native providers to coexist, and prevents stale diagnostics/completions from crossing workspace/model incarnations.

**Risk.** Protocol complexity and cancellation races. Start with diagnostics/completion/document-symbol seams and require cancellation + stale-drop tests.

### D8 — Restricted workspace is the default; trust is host-owned and outside the repo

**Contract.** Unknown repositories open in `RESTRICTED`: text viewing/editing, inert syntax/tokenization, search, and safe file operations only. Disable tasks, terminals, debugger adapters, extension activation that executes code, repository-defined commands, executable workspace settings, scripted previews, post-install hooks, and model-proposed privileged actions. Trust decisions are stored outside repository contents and keyed to canonical workspace identity/generation; repository text may request but can never grant trust.

**Evidence.** VS Code Workspace Trust exists specifically because opening a workspace can lead to unintended code execution; Restricted Mode disables/limits execution-capable features. Electron likewise warns against executing untrusted content with privileged APIs.

**Expected gain.** Converts malicious repository configuration/prompt injection from an execution path into inert data by default.

**Risk.** Reduced convenience. Provide clear capability-by-capability trust elevation rather than a hidden global bypass.

### D9 — Preserve bytes/encoding metadata; text is a projection, not the storage truth

**Contract.** Host reads return explicit byte length, detected/selected encoding, BOM, EOL metadata, binary flag, and `FileRevision`. Text decoding is explicit. Save preserves BOM/EOL/encoding unless the user deliberately changes them. Files that cannot be decoded safely remain byte/sliced-view resources rather than being lossy-coerced into a Monaco model.

**Expected gain.** Avoids silent corruption and makes save hashes/revisions reproducible across platforms.

**Risk.** Encoding detection is probabilistic. Prefer deterministic BOM/config/user choice and surface uncertainty instead of silently guessing.

## Recommended DEVOS_IDE_V1 process shape

`Sandboxed IDE renderer (Monaco + view state)` → `typed preload façade` → `trusted host workspace/file service` → `platform file adapter`

and independently:

`Monaco model registry` → `language-service broker` → `Web Worker providers OR trusted utility/extension process`

The renderer owns presentation and transient editor state. The trusted host owns workspace identity, canonical paths, file revisions, conflict decisions and persistence. Language workers own analysis only and never gain save/exec authority from repository or model content.

## Smallest implementation sequence

1. Workspace capability + canonical resource identity.
2. Read/stat + model registry, no writes yet.
3. CAS save + conflict state machine + watcher revision readback.
4. Large-file/binary admission path.
5. Web-worker language-service broker with stale fencing.
6. Restricted-workspace policy integration; only then consider explicitly gated native language servers/tasks.

This sequence avoids introducing a second scheduler/authority plane and keeps each slice independently falsifiable.

## Source notes (retrieved 2026-08-30)

- Monaco Editor API: `ITextModel`, `getModel`, `createWebWorker`, and editor options (`largeFileOptimizations`, `maxTokenizationLineLength`) — https://microsoft.github.io/monaco-editor/typedoc/
- VS Code Web Extensions — https://code.visualstudio.com/api/extension-guides/web-extensions
- VS Code API / `workspace.fs` and `FileSystemProvider` — https://code.visualstudio.com/api/references/vscode-api
- VS Code Workspace Trust — https://code.visualstudio.com/docs/editing/workspaces/workspace-trust
- Electron Security — https://www.electronjs.org/docs/latest/tutorial/security
- Electron Process Sandboxing — https://www.electronjs.org/docs/latest/tutorial/sandbox
- Node.js File System API — https://nodejs.org/api/fs.html
- Eclipse Theia architecture (comparison only; no framework adoption) — https://theia-ide.org/docs/architecture/
