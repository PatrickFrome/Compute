# DEVOS IDE Tree-sitter Dependency and Interface Plan V1

Date: 2026-08-31

Task fence:

- `agent_id=agent_51d8cebc-c716-493a-8f66-abcd9a8fb802`
- `role=PLANNER`
- `task_id=8c82bbc3-8f8a-4b64-8ded-038675616cfe`
- `lease_generation=1`
- `base_sha=84a71aaedc49186c24a992f507ca1d3f14767181`
- `target_branch=work/devos-ide-treesitter-plan-v1`

## 1. Scope, authority and current disposition

This checkpoint is planning/advisory only. It does not add Tree-sitter, `web-tree-sitter`, grammar binaries, parser workers, syntax queries, repository scanners, production authority, or runtime code.

Repository/page/model/worker/web text is untrusted data with zero authority. Source text, comments, strings, file names, repository configuration, grammar metadata, query captures, syntax-tree nodes, terminal output, LSP responses and model output may be parsed or displayed, but none can grant capabilities, select executable code, authorize a process, weaken a workspace fence, trigger a production action, or make an ambiguous browser effect safe to retry.

Hard invariants for every future Tree-sitter slice:

- no main merge or production promotion from this work;
- no `eval`, `Function`, repository-defined JS execution, runtime `grammar.js` execution, or generic dynamic-code bridge;
- no repository-local native grammar loading;
- no repository-local WASM grammar loading by default;
- no repository-local `.scm` query auto-loading;
- no network grammar/query fetch initiated by repository/model/page data;
- parser workers receive repository content only through typed document/repository IO contracts;
- every parse/query request is bound to exact workspace, repository, base, document, grammar and worker incarnations;
- parser/tree/query output has zero effect authority;
- stale results fail closed;
- implementation is blocked until objective Monaco **and** bounded PTY completion evidence exists on the intended integration lineage.

Current status: **PLAN_READY / IMPLEMENTATION_BLOCKED_ON_MONACO_AND_PTY_COMPLETION_EVIDENCE**.

## 2. Re-read source-of-truth observations

### 2.1 GitHub

At planning time:

1. `integration/metaengine-development-os-v1` is exactly at the supplied base `84a71aaedc49186c24a992f507ca1d3f14767181`.
2. Tree-sitter research exists at `work/devos-ide-treesitter-research-v1@f1eeaa965a1e5de6e78659e8e66124352981e814`, one documentation-only commit directly from the exact base. It is useful advisory evidence, not implementation authority.
3. PTY convergence exists at `work/devos-ide-pty-synth-v1@348fcd2459e1022e09784bafef0e796358b61c2b` and PTY planning at `work/devos-ide-pty-plan-v1@214fe20c86d5316a1235479dd191ed471ac65f6d`; both are documentation/advisory checkpoints, not PTY completion evidence.
4. No GitHub branch/ref named `work/devos-ide-shell-monaco-v2` was visible during this planning pass. Absence of a named branch is not proof that Monaco work does not exist elsewhere, but it means the Tree-sitter planner has no objective implementation SHA to use as a dependency proof.
5. The established stage order remains `MONACO -> XTERM_PTY -> TREE_SITTER -> LSP -> CODE_KNOWLEDGE_GRAPH -> R10_CONTEXT_COMPILER`.

### 2.2 Supabase

Read-only facts observed from project `xpeibufgzjknrhbhpffp`:

- this task `8c82bbc3-8f8a-4b64-8ded-038675616cfe` is `RUNNING`, `ADVISORY`, generation `1`, bound to the supplied agent/base/branch, with `authority_effect=false`;
- `devos.ide.shell.monaco.v2` is not completed; its fleet state is `AMBIGUOUS` with `LEASE_EXPIRED_EFFECT_UNKNOWN`;
- PTY planner/research/synthesis tasks are advisory and are not durably completed implementation evidence; several are `AMBIGUOUS` and critic/falsifier work remains pending/leased at this observation point;
- the Tree-sitter researcher fleet task is also `AMBIGUOUS / LEASE_EXPIRED_EFFECT_UNKNOWN` even though a GitHub documentation commit exists. Therefore that commit is consumed as advisory research only and its task state is not upgraded by inference;
- the unsuperseded architecture checkpoint remains `METAENGINE_COMPUTE_UNIFIED_V1_CONVERGENCE_CP2_2026-08-29` at `a23b647220c6bdeaa4340f804575dc2009e434cb`, with invariants including one-resource/one-actuation-lease, no blind retry after ambiguous effects, page/model data zero authority, exact target/executor incarnation binding, remote code never evalled in Browser kernel, and development plane zero direct production-promotion authority.

No Supabase mutation is part of this task.

## 3. Activation gate: `G_TREE_SITTER_READY`

Tree-sitter implementation must not start merely because this plan or the research checkpoint exists.

`G_TREE_SITTER_READY` requires all of the following objective evidence on one intended integration lineage:

### Monaco completion proof

- exact Monaco implementation SHA/ref;
- local packaged Monaco assets/workers, no remote code/eval;
- sandboxed renderer remains `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true` where applicable;
- typed trusted preload/host boundary;
- host-issued workspace identity/generation;
- canonical resource/model identity;
- typed repository/file IO and conflict-safe save boundary;
- large-file admission/degraded-view contract;
- green Monaco build/integration/state-machine tests.

### Bounded PTY completion proof

- exact PTY implementation SHA/ref descending from/reconciled with the Monaco lineage;
- renderer-only xterm surface;
- exact workspace/session/process/host generation fencing;
- no arbitrary renderer-supplied executable/argv/cwd/env;
- input non-idempotence/no-blind-replay proven;
- output backpressure and bounded memory proven;
- exit receipts and crash behavior proven;
- supported-platform process-tree containment evidence;
- green required PTY parity/failure-injection tests.

### Gate failure behavior

If either dependency is missing, ambiguous, stale, divergent without disposition, or only described in prose, Tree-sitter remains disabled/unimplemented. Planning, research, static test design and offline fixture preparation are allowed; parser dependency/runtime mutation is not.

## 4. Contracts to reuse rather than duplicate

Tree-sitter must extend existing DevOS seams, not create a second workspace, repository, storage, trust, scheduler or execution plane.

Reuse after dependency proof:

- Monaco host-issued workspace identity and generation;
- Monaco canonical resource URI/model lifecycle;
- Monaco document version for in-memory edit ordering;
- host persisted file revision for storage truth;
- typed repo/file read boundary rather than direct worker filesystem access;
- large-file admission state from the document service;
- trusted shell/preload sender validation;
- PTY exact workspace binding patterns where identity semantics overlap;
- Browser/DevOS owner lifecycle for worker creation/disposal; no parser scheduler/poller;
- existing no-blind-retry and exact-incarnation principles.

Do not add:

- raw `fs` access in parser worker;
- `ipcRenderer` exposure to parser code;
- generic `readFile(path)` from worker;
- repository-owned plugin/grammar loader;
- a background repository crawler in the first Tree-sitter slice;
- a second task queue or heartbeat scheduler;
- parser-derived command execution;
- direct LSP or CKG mutation authority from a syntax capture.

## 5. Smallest target architecture

```text
Sandboxed DevOS IDE renderer
  Monaco model registry
       |
       | typed document snapshot/change envelopes
       v
Tree-sitter broker (renderer-side service with no repo/process authority)
  - validates document binding
  - owns worker lifecycle/epochs
  - enforces budgets/degraded mode
       |
       | dedicated MessagePort/Worker messages
       v
Workspace-scoped parser Web Worker
  - web-tree-sitter runtime
  - verified app-bundled WASM grammars
  - parser/language/query caches
  - document text projection + live TSTree
  - incremental parse + bounded queries
       |
       | immutable version-fenced DTO facts only
       v
Monaco decorations / future language broker / future CKG ingest
```

Security meaning:

- the Web Worker is a CPU/crash/isolation boundary, **not** an authority boundary;
- the worker has no repository filesystem, shell, PTY, production, Browser Operator or supervisor capability;
- grammar WASM is trusted app code only after registry/hash verification;
- repository source remains data even while interpreted by the parser;
- worker termination/restart is safe because syntax state is derived and read-only.

For V1, parse active Monaco documents only. Background workspace indexing is deferred until the typed repository read/indexing contract and CKG ingestion budgets are separately sealed.

## 6. Exact identity model

### 6.1 Repository/workspace binding

The Tree-sitter broker consumes a host-issued binding; the renderer/worker cannot invent it.

```ts
type RepoAnalysisBinding = {
  workspaceId: string;
  workspaceGeneration: number;
  repositoryBindingId: string;
  repositoryGeneration: number;
  canonicalRepoRootUri: string;
  baseSha: string;               // exact development/worktree base provenance
};
```

Rules:

- `workspaceId + workspaceGeneration` identify the exact DevOS workspace incarnation;
- `repositoryBindingId + repositoryGeneration` identify the exact repository/worktree binding currently associated with it;
- `baseSha` is host-owned provenance inherited from the workspace/claim creation point and is never parsed from repository text;
- a checkout/rebind/worktree replacement that changes repository identity must advance `repositoryGeneration` or workspace generation according to the proven host contract;
- canonical containment remains a host responsibility; the parser worker never resolves paths;
- `baseSha` is provenance, not a claim that an edited Monaco model equals Git content at that commit.

### 6.2 Document parse reference

```ts
type SyntaxDocumentRef = RepoAnalysisBinding & {
  resourceUri: string;           // canonical workspace-scoped URI
  documentGeneration: number;    // changes on close/reopen/rebind incarnation
  modelVersion: number;          // exact Monaco in-memory version
  languageId: string;
};
```

### 6.3 Grammar identity

```ts
type GrammarRef = {
  languageId: string;
  grammarRegistryRevision: string;
  grammarSourceRepo: string;
  grammarSourceRevision: string;
  grammarWasmSha256: string;
  treeSitterRuntimeVersion: string;
  treeSitterCliBuildVersion: string;
  parserAbiVersion: number;
  queryPackSha256: string;
};
```

### 6.4 Worker identity

```ts
type ParserWorkerRef = {
  workspaceId: string;
  workspaceGeneration: number;
  parserWorkerEpoch: number;
};
```

A new/recycled worker always increments `parserWorkerEpoch`. Results from a dead epoch are stale even if all document fields happen to match.

### 6.5 Full parse cache identity

```text
ParseKey = (
  workspaceId,
  workspaceGeneration,
  repositoryBindingId,
  repositoryGeneration,
  baseSha,
  resourceUri,
  documentGeneration,
  languageId,
  grammarWasmSha256,
  parserAbiVersion,
  queryPackSha256
)
```

Mutable entry state includes `modelVersion`, `parserWorkerEpoch`, tree, canonical text projection, metrics and changed ranges.

PID-like/native pointer/node object identity is never durable syntax identity.

## 7. Typed parser protocol V1

Every message has a fixed schema/version, request ID, payload-size limit and exact binding fields. Unknown message types/fields fail closed.

### 7.1 Worker bootstrap

```ts
TS_WORKER_INIT {
  worker: ParserWorkerRef;
  runtimeAssetId: string;        // host/app-owned manifest key
  runtimeSha256: string;
  grammarRegistryRevision: string;
  budgetsRevision: string;
}
```

Worker reports runtime version/capabilities. A version/hash mismatch terminates the worker; there is no runtime network fallback.

### 7.2 Grammar activation

```ts
TS_GRAMMAR_ACTIVATE {
  worker: ParserWorkerRef;
  grammar: GrammarRef;
  grammarAssetId: string;        // app manifest ID only
  grammarBytes: Uint8Array;      // or equivalent verified packaged asset handle
  queryPack: VerifiedQueryPack;
}
```

The worker never receives a repository-supplied grammar path/URL.

### 7.3 Open document

```ts
TS_DOCUMENT_OPEN {
  worker: ParserWorkerRef;
  document: SyntaxDocumentRef;
  grammar: GrammarRef;
  textUtf8Projection: string;
  admission: 'NORMAL' | 'PARSE_DEGRADED' | 'PARSE_DISABLED';
}
```

The exact implementation may transport UTF-8 bytes instead of JS text if the selected binding supports it cleanly; the semantic requirement is one canonical UTF-8 projection and exact byte-coordinate accounting.

### 7.4 Incremental changes

```ts
TS_DOCUMENT_APPLY_CHANGES {
  worker: ParserWorkerRef;
  documentBefore: SyntaxDocumentRef;
  nextModelVersion: number;
  changes: Array<{
    rangeOffsetUtf16: number;
    rangeLengthUtf16: number;
    range: MonacoRangeDto;
    text: string;
  }>;
}
```

`documentBefore.modelVersion` must equal the worker's current version exactly. `nextModelVersion` must be the expected next accepted Monaco version under the proven document contract. A gap/reorder/mismatch triggers one typed resync request, not guessed edit replay.

### 7.5 Full resync

```ts
TS_DOCUMENT_RESYNC {
  worker: ParserWorkerRef;
  document: SyntaxDocumentRef;
  grammar: GrammarRef;
  fullTextUtf8Projection: string;
  reason: 'VERSION_GAP' | 'LANGUAGE_CHANGED' | 'GRAMMAR_CHANGED' |
          'CODEC_INVARIANT_FAILED' | 'WORKER_RECOVERY' | 'EXPLICIT_REOPEN';
}
```

Full reparse is a safe derived-state recovery, not an external side-effect retry. It must still be bounded to avoid an infinite crash/resync loop.

### 7.6 Query request

```ts
TS_QUERY_RUN {
  worker: ParserWorkerRef;
  document: SyntaxDocumentRef;
  grammar: GrammarRef;
  queryId: string;               // app-owned registry ID
  byteRange?: { start: number; end: number };
  changedRangeGeneration?: number;
  budgetClass: 'INTERACTIVE' | 'BACKGROUND_BOUNDED';
}
```

No raw query text is accepted from repository/model/page data.

### 7.7 Syntax result

```ts
type SyntaxFactBatch = {
  worker: ParserWorkerRef;
  document: SyntaxDocumentRef;
  grammar: GrammarRef;
  queryId: string;
  provenance: 'TREE_SITTER_SYNTACTIC';
  changedRanges: ByteRangeDto[];
  facts: Array<{
    capture: string;
    nodeType: string;
    startByte: number;
    endByte: number;
    startPoint: BytePointDto;
    endPoint: BytePointDto;
    textPreview?: string;         // bounded/untrusted, optional
  }>;
};
```

Facts are immutable DTOs. Raw `Tree`, `Node`, `QueryCursor`, WASM pointers or handles never cross the worker boundary.

## 8. Parser and worker lifecycle

### 8.1 Worker lifecycle

```text
ABSENT
  -> BOOTING
  -> RUNTIME_READY
  -> ACTIVE
  -> DRAINING
  -> TERMINATED

BOOTING/RUNTIME_READY/ACTIVE
  -> FAULTED
  -> TERMINATED
  -> new epoch BOOTING
```

One workspace generation owns one parser worker in the smallest V1. This maximizes content separation and makes stale-worker invalidation simple. A later bounded pool may be introduced only after profiling proves the per-workspace worker cost is unacceptable while preserving exact workspace fencing.

The worker is event-driven. No polling/heartbeat scheduler is added. Owner lifecycle events are document open/change/close, workspace rebind/close, grammar activation, query request, worker fault and budget timeout.

### 8.2 Parser lifecycle per document

```text
CLOSED
  -> OPENING
  -> PARSING_FULL
  -> READY
READY
  -> PARSING_INCREMENTAL
  -> READY
READY/PARSING_*
  -> NEEDS_RESYNC
  -> PARSING_FULL
READY/PARSING_*
  -> DEGRADED
READY/PARSING_*/DEGRADED
  -> CLOSED
```

A document cannot transition to `READY` unless the returned tree/facts exactly match the current full document fence.

### 8.3 Workspace/repository rebind

A stale workspace or repository generation immediately makes every corresponding parse entry non-current. The broker drops late output, disposes the worker epoch and creates a new worker only after the host exposes a new exact binding. It never re-labels an old tree as belonging to the new worktree/repository incarnation.

## 9. Incremental parsing boundaries and coordinate codec

Tree-sitter uses byte offsets and byte columns; Monaco editor changes are expressed in UTF-16-oriented model coordinates. These are not interchangeable.

Create one `DocumentOffsetCodec` and make it the only conversion seam.

Required mapping invariant:

```text
Monaco model version N
  -> canonical UTF-8 byte projection B_N
  -> exact TSInputEdit coordinates for N -> N+1
  -> canonical UTF-8 byte projection B_N+1
```

### 9.1 Multi-edit event rule

For one Monaco content-change event:

1. require exact current model version;
2. consume Monaco changes in the proven event order (currently end-of-document toward beginning);
3. for each change, translate old UTF-16 range/offset against the pre-change/current local text state into Tree-sitter byte offsets/points;
4. calculate `newEndByte/newEndPoint` from the inserted UTF-8 text;
5. apply corresponding `tree.edit(...)`/binding equivalent in the same deterministic order;
6. apply the text changes to the worker's canonical text projection in the same order;
7. parse once against the final text using the edited old tree;
8. compute changed ranges immediately while the old/new relationship is still available;
9. atomically publish the new tree/model version;
10. run only required bounded queries for changed regions or explicitly requested whole-document features.

### 9.2 Codec cases that must be proven

- ASCII;
- BMP non-ASCII;
- astral characters/surrogate pairs;
- combining marks;
- emoji/ZWJ sequences;
- tabs;
- LF and CRLF;
- line insertion/deletion;
- EOL-style replacement;
- multiple cursors/multiple disjoint edits;
- edit at byte 0;
- edit at EOF;
- replacement spanning multiple lines;
- very long line near configured limit.

### 9.3 Fail-closed recovery

Full reparse is required if any of these occur:

- model version gap/reorder;
- change range outside local snapshot;
- UTF-16 range/length inconsistency;
- coordinate conversion failure;
- language change;
- grammar/query-pack identity change;
- worker epoch change;
- repository/workspace generation change;
- parser reports a state that cannot be reconciled with the current document fence.

Do not guess missing edits and do not repeatedly full-reparse in a tight failure loop. Repeated resync failure moves the document to `DEGRADED`/`PARSE_DISABLED` with visible diagnostics/telemetry.

## 10. Grammar loading and supply-chain contract

### 10.1 V1 grammar source

Use `web-tree-sitter` with app-bundled/pinned WASM grammars in the parser worker for V1.

Reasons:

- one format can support Electron/web-shaped parser workers;
- native grammar libraries remain out of renderer/main;
- binary provenance is hashable and packaging is deterministic;
- current upstream explicitly supports independently loaded WASM languages;
- WASM keeps untrusted repository text away from native parser-addon ABI concerns.

A future native parser utility process is a performance optimization only after measurements prove WASM insufficient and must preserve the same registry, identity, trust and budget contracts.

### 10.2 Immutable host-owned grammar registry

Each supported language is pinned by exact source revision and built artifact identity. The app build/release process produces the registry; runtime repository content cannot edit it.

Minimum registry fields are defined by `GrammarRef` above.

Activation sequence:

1. resolve `languageId` through the host/app registry;
2. load packaged artifact by manifest ID;
3. verify hash/size before language instantiation;
4. verify runtime/parser ABI compatibility;
5. compile/load app-owned query pack for the exact grammar identity;
6. cache language/query objects only under the full grammar identity;
7. fail closed on mismatch; never fetch a replacement from the network.

### 10.3 Explicitly forbidden runtime grammar paths

- execute repository `grammar.js`;
- run Tree-sitter CLI/generator against an opened repository;
- build C/C++ external scanners at runtime;
- `Language.load` a path/URL assembled from repository settings;
- load repository `.wasm` merely because it is named like a grammar;
- load native `.node`, `.dll`, `.so`, `.dylib` grammar modules from a workspace;
- accept grammar bytes from terminal output or model/page text;
- silently downgrade to an older runtime to make an incompatible grammar load.

## 11. Repository-content trust boundaries

### 11.1 Source text

Source is data. It may alter parse shape, produce errors, create huge trees or pathological query matches, but cannot change permissions.

### 11.2 Language selection

File extension, Monaco language mode, shebang and repository metadata may be **signals** requesting a known `languageId`. Final resolution is through the host-owned grammar registry. Unknown language -> plain-text/no-parser mode.

### 11.3 Queries

Only app-bundled query packs addressed by `queryId` are executable parser queries in V1. Repository `.scm` files are ordinary text and are never auto-executed.

### 11.4 Injection languages

Repository text often carries embedded-language names (for example fenced code labels). Those names have zero loader authority.

V1 recommendation: disable injection-language spawning in the smallest initial Tree-sitter slice. When injections are enabled later, require all of:

- injection target maps through a fixed app-owned allowlist;
- grammar already exists in verified registry;
- bounded injection depth;
- bounded number of injected regions/parsers;
- bounded aggregate injected bytes;
- cycles/recursive self-injection fail closed;
- unknown injected language is inert text;
- no network/repository grammar resolution.

### 11.5 Syntax facts downstream

Capture text/names/docstrings/comments are tainted repository data. LSP, CKG, context compiler and agents must retain provenance and cannot treat a syntax fact as authority or executable instruction.

## 12. Query lifecycle

Tree-sitter queries can be expensive independently of parsing. Keep query lifecycle separate from tree lifecycle.

### 12.1 Compiled query cache

Cache immutable compiled queries by:

```text
(languageId, grammarWasmSha256, parserAbiVersion, queryPackSha256, queryId)
```

Do not key only by language name.

### 12.2 Cursor ownership

A query cursor/execution object is per invocation or worker-local reusable state and is never shared concurrently across worker threads/epochs. It is reset/disposed deterministically.

### 12.3 Range-first execution

For interactive changed-document features, prefer query execution over Tree-sitter changed ranges expanded by a small feature-specific context window rather than whole-buffer queries after every keystroke.

Whole-document queries are allowed only for explicitly classified bounded features and under a budget.

### 12.4 Query budgets

Central configuration must bound at least:

- maximum query wall time/response deadline;
- maximum captures/matches admitted per response;
- maximum serialized fact bytes;
- maximum queried byte range per interactive operation;
- maximum simultaneous query requests per document/worker;
- maximum queued work; newest-state supersession should drop stale queued analysis.

If the JS/WASM binding cannot cooperatively interrupt a pathological synchronous query, the broker's hard containment mechanism is worker termination and epoch replacement. No stale result from the killed epoch may publish.

## 13. Large-file and pathological-content degradation

Reuse Monaco's host-side large-file admission result; Tree-sitter may impose a stricter analysis budget but must not secretly bypass the document service.

Suggested modes:

- `NORMAL`: incremental parse + bounded queries;
- `PARSE_ONLY`: incremental parse, expensive semantic/highlight queries reduced;
- `VISIBLE_RANGE_ONLY`: parse/query only where the chosen implementation can prove bounded range behavior safely;
- `PARSE_DISABLED`: plain text/editor remains usable; Tree-sitter produces no semantic facts.

Budget dimensions are configuration, not repository-controlled settings:

- UTF-8 byte size;
- line count;
- maximum line length;
- binary/NUL detection from document admission;
- parse latency percentile;
- query latency percentile;
- worker memory/RSS/heap proxy where measurable;
- syntax node/capture/result counts;
- repeated worker fault/resync count.

Do not promise a specific permanent byte threshold in architecture. Implementation must choose centralized initial limits from benchmarks, then acceptance tests prove `limit`, `limit+1`, and pathological-shape behavior.

If analysis degrades, editing remains available according to Monaco policy; syntax analysis never blocks save/close merely because Tree-sitter is unavailable.

## 14. Crash recovery and stale-result semantics

### Worker crash/termination

- increment `parserWorkerEpoch` before a replacement worker becomes current;
- invalidate all raw trees/nodes/query cursors from old epoch;
- request one exact current document snapshot for active eligible models;
- rebuild grammar/query cache from verified app assets;
- do not replay historical edit batches into an uncertain worker state;
- drop all late old-epoch results.

### Renderer reload

If Monaco model state survives in a trusted owner, new Tree-sitter worker receives a full exact current snapshot. Tree persistence across renderer reload is not required for V1.

### Workspace/repository rebind

Terminate current workspace parser worker. New binding starts from clean full snapshots. Never migrate a `TSTree` across workspace/repository generations.

### Repeated crash loop

After configurable bounded restart attempts in a time window, stop restarting and mark parsing degraded/disabled for that workspace/session. The parser layer must not become a crash-loop scheduler.

## 15. Cache and memory ownership

Live `TSTree`, `TSNode`, parser, language and query cursor handles stay inside their owning worker.

Ownership rules:

- close/dispose document -> delete live tree/text entry;
- language/grammar change -> dispose parser/tree/query references for old grammar identity;
- workspace generation change -> terminate worker and release all entries;
- memory pressure -> evict least-recently-used **closed/inactive** derived caches first;
- never persist raw trees/nodes as authoritative durable state;
- syntax DTOs outside worker include exact provenance/fence and can be discarded/recomputed.

No raw Tree-sitter node ID is a CKG symbol identity. Future CKG IDs must be independently defined and may use syntactic provenance as replaceable evidence only.

## 16. Seam toward LSP and Code Knowledge Graph

Tree-sitter should provide a stable read-only `SyntaxFactBatch` interface so later stages do not depend on parser internals.

Precedence/provenance rule:

- Tree-sitter facts: `TREE_SITTER_SYNTACTIC`;
- future LSP/semantic facts: separate `LSP_SEMANTIC` provenance;
- future graph fusion decides precedence/conflict explicitly;
- syntactic identity never silently masquerades as semantic identity.

The Tree-sitter layer may emit symbols/scopes/imports/calls/source ranges, but it cannot apply workspace edits, start LSP servers, execute code or mutate CKG authoritative state directly.

## 17. Dependency-ordered implementation slices

### TS0 — Dependency/lineage proof (**BLOCKED now**)

Dependencies: objective Monaco completion + objective bounded PTY completion.

Before any Tree-sitter dependency/runtime change:

- identify exact integration SHA containing both accepted slices;
- prove no source-of-truth drift;
- prove typed workspace/repo/document identity available;
- prove large-file admission contract available;
- record exact source SHA for Tree-sitter implementation branch.

Exit evidence: dependency convergence checkpoint with exact SHAs and green required tests.

### TS1 — Identity/protocol/codec contracts only

Dependencies: TS0.

Add types/validators/state machines and `DocumentOffsetCodec` tests. No real parser/grammar yet.

Exit evidence:

- stale-field matrix;
- Unicode/CRLF/multi-edit codec property tests;
- workspace/repo/base binding tests;
- protocol size/unknown-field negative tests.

### TS2 — Verified runtime + grammar registry + worker bootstrap

Dependencies: TS1.

Add local pinned `web-tree-sitter` runtime, one or two initial reviewed WASM grammar fixtures, app-owned grammar/query registry and workspace-scoped worker bootstrap.

No repository-local grammar/query loading.

Exit evidence:

- packaged/dev runtime load smoke;
- grammar SHA/ABI mismatch negatives;
- CSP/no-network proof;
- worker epoch/lifecycle tests.

### TS3 — Full parse + cache identity

Dependencies: TS2.

Open active Monaco document snapshots through typed protocol, parse full text, retain tree inside worker, expose minimal version-fenced syntax DTOs.

Exit evidence:

- exact ParseKey tests;
- stale workspace/repo/base/document/worker result drops;
- close/dispose leak tests;
- parser errors remain data/non-authority.

### TS4 — Incremental edits and deterministic resync

Dependencies: TS3.

Apply exact Monaco change batches via codec/tree edits, incremental parse and changed-range calculation. Add one-shot full snapshot resync on version/codec fault.

Exit evidence:

- incremental tree result equals fresh full reparse across randomized edit sequences;
- Unicode/multi-edit/EOL fixtures;
- version gap/reorder negatives;
- repeated-resync degradation test.

### TS5 — Bounded query packs and syntax facts

Dependencies: TS4.

Compile app-owned queries by exact grammar/query identity. Run changed-range-first queries and emit bounded immutable facts.

Exit evidence:

- golden fixtures per supported language/query;
- query cache identity tests;
- capture/result quota tests;
- pathological query timeout -> worker recycle/degrade;
- source/query capture cannot cause effects.

### TS6 — Large-file/failure/resource seal

Dependencies: TS5.

Integrate Monaco admission modes, parser/query budgets, memory/restart limits and worker fault recovery.

Exit evidence:

- configured budget boundary + `limit+1` tests;
- minified/long-line/generated/binary fixtures;
- worker kill/restart stale-result test;
- soak/leak tests across repeated languages/documents/queries.

### TS7 — DevOS Tree-sitter integration checkpoint

Dependencies: TS6.

Mount syntax facts into allowed Monaco read-only presentation/features and seal the future LSP/CKG seam. Do not add LSP process execution in this slice.

Exit evidence:

- end-to-end open -> parse -> edit -> incremental parse -> query -> close;
- exact workspace/repo/base provenance visible in test receipts;
- zero production/process authority regression;
- branch-local checkpoint + exact CI/platform/browser-shell build evidence.

### Deferred TSI — Injection parsing

Dependencies: TS7 plus separate injection threat/resource review.

Not required to claim initial Tree-sitter V1 integration complete.

## 18. Acceptance matrix

| ID | Requirement | Required evidence | Fail-closed expectation |
| --- | --- | --- | --- |
| A0 | Dependency gate | exact accepted Monaco + bounded PTY SHAs and green evidence | no Tree-sitter runtime/dependency activation |
| A1 | Exact workspace binding | mutate `workspaceId`/generation independently | stale request/result rejected |
| A2 | Exact repository binding | mutate repository binding/generation | stale request/result rejected |
| A3 | Exact base provenance | mismatch supplied vs host `baseSha` | analysis session not opened |
| A4 | Exact document incarnation | close/reopen same URI with new document generation | old tree/results cannot attach |
| A5 | Exact worker epoch | kill/restart worker and deliver late response | old response dropped |
| A6 | Grammar binary identity | alter grammar hash/ABI/runtime version | grammar activation fails closed |
| A7 | Query-pack identity | same language with different query hash | no cache alias/reuse |
| A8 | No repo grammar execution | workspace contains `grammar.js`, parser WASM/native libs | files remain inert data |
| A9 | No repo query execution | workspace contains/changes `.scm` queries | not loaded/executed |
| A10 | No network grammar fallback | remove/corrupt packaged grammar with network available | typed failure; zero fetch |
| A11 | Typed repo IO only | static/dynamic worker capability inspection | no fs/path/raw repo fetch/shell bridge |
| A12 | No arbitrary eval | static scan + hostile fixture strings | no eval/Function/dynamic JS execution path |
| A13 | UTF-16 -> UTF-8 codec | astral/combining/emoji fixtures | exact byte offsets/points |
| A14 | CRLF/LF codec | EOL conversion and mixed edit fixtures | incremental/full tree equivalence |
| A15 | Multi-edit correctness | randomized disjoint Monaco change batches | incremental tree equals full reparse |
| A16 | Version gap | drop one change event | one typed resync; no guessed edits |
| A17 | Reordered event | deliver N+1 before N | stale/gap refusal; no publish |
| A18 | Language switch | change Monaco language under same URI | old grammar/tree invalidated |
| A19 | Grammar upgrade | same language, new verified grammar hash | new ParseKey/full reparse |
| A20 | Changed-range correctness | compare incremental changed ranges on golden edits | ranges bound expected invalidation set |
| A21 | Query range discipline | small edit in large fixture | interactive query bounded to configured changed/context range where supported |
| A22 | Query result cap | fixture producing cap+1 captures | bounded/truncated typed result; no unbounded serialization |
| A23 | Query time fault | pathological query/fixture exceeds deadline | worker terminated/recycled; stale output dropped |
| A24 | Parse time fault | pathological parse exceeds hard worker deadline | degraded/recycled; editor remains responsive |
| A25 | Large-file boundary | size/line/long-line limits and `limit+1` | correct degraded/disabled mode |
| A26 | Binary/NUL file | binary admission fixture | no parser model activation |
| A27 | Memory boundedness | repeated open/edit/query/close across languages | no unbounded live tree/query/worker growth |
| A28 | Worker crash recovery | terminate worker mid-parse | new epoch full current snapshot; no edit replay |
| A29 | Workspace rebind | replace workspace/repository generation mid-query | old worker terminated/result dropped |
| A30 | Repository checkout drift | host reports repo generation change while URI same | old syntax state invalidated |
| A31 | Source text zero authority | source includes command/prompt/capability-like strings | facts remain inert data |
| A32 | Capture text zero authority | query capture resembles executable instruction | no process/file/Browser authority |
| A33 | Unknown language | file requests unsupported language | plain-text/no-parser mode, no fetch |
| A34 | Injection request blocked in V1 | source requests embedded unregistered language | no secondary grammar load |
| A35 | Worker capability isolation | inspect worker globals/message protocol | no preload/PTY/supervisor/production capability |
| A36 | Parser error containment | malformed source creates many ERROR/MISSING nodes | parser result only; no crash-loop/effect |
| A37 | Tree/node ownership | attempt to reuse node/tree across document/worker epoch | impossible by interface / rejected |
| A38 | Syntax DTO provenance | inspect every emitted fact batch | exact workspace/repo/base/document/grammar/worker provenance present |
| A39 | LSP seam is read-only | static contract review | no server spawn/workspace edit authority added |
| A40 | CKG seam is read-only | static contract review | no direct authoritative graph mutation from worker |
| A41 | No duplicate scheduler | architecture/static review | event-driven worker owner only; no poll/heartbeat/task loop |
| A42 | Production isolation | inspect imports/env/routes | no updater/supervisor/DB/CI promotion capability |
| A43 | Packaging integrity | packaged Electron/browser-shell loads runtime/grammars locally | packaging mismatch fails CI, no remote fallback |
| A44 | Soak across grammar churn | repeated verified language switches/query runs | bounded memory; deterministic disposal/recycle |
| A45 | End-to-end acceptance | open/edit/query/close on supported languages | exact versioned results, responsive editor, clean disposal |

## 19. Interface invariants for later implementation review

A Tree-sitter implementation is rejected if any of these appear:

- `Language.load(workspacePathOrUrl)`;
- repository `grammar.js` execution;
- generic worker `READ_FILE` with arbitrary path;
- parser worker access to Node `fs`, `child_process`, PTY or supervisor bridge;
- raw repository query text passed to `Query` as an executable query source;
- parse request missing workspace/repository/base/document/grammar/worker fences;
- syntax results accepted based only on URI/version while generation/grammar/worker identity is stale;
- unbounded whole-buffer query on every keystroke without budget evidence;
- raw `TSNode`/tree handle used as durable cross-version identity;
- source/query capture text becoming a command/tool/capability request automatically;
- parser crash causing automatic repeated restart without a bounded circuit breaker;
- grammar/network fallback after integrity/ABI failure;
- Tree-sitter layer starting LSP processes, terminal commands or production actions.

## 20. Risks and expected gains

| Decision | Expected gain | Main risk | Mitigation |
| --- | --- | --- | --- |
| WASM grammars in worker | web/Electron parity, renderer isolation, deterministic packaging | slower than native bindings | incremental parse, budgets, profile before native optimization |
| exact workspace/repo/base fences | prevents cross-worktree/stale analysis aliasing | more protocol fields/state | shared identity types and exhaustive stale matrix |
| one worker/workspace V1 | simple isolation and crash invalidation | worker memory overhead | bounded worker count; profile before pooling |
| app-owned grammar/query registry | supply-chain/reproducibility | slower language onboarding | offline reviewed build pipeline |
| UTF-16/UTF-8 codec | correct incremental parsing for Unicode | conversion cost | correctness-first; optimize with indexed line metadata after profiling |
| changed-range-first queries | lower interactive CPU | some query semantics may need wider scope | feature-specific context + explicit whole-document budget class |
| hard worker kill on pathological synchronous work | UI remains responsive | loses derived caches | epoch restart + full current snapshot |
| no persisted raw trees | no stale pointer/durable corruption | reparsing after restart | incremental during session; full parse is derived recovery |
| injections deferred | smaller safe V1 and no language-loader escalation | reduced embedded-language features | separate bounded injection gate after TS7 |

## 21. Current external implementation notes (non-authoritative)

Retrieved 2026-08-31 only as engineering inputs; they do not override GitHub/Supabase authority:

- Tree-sitter latest release observed: `v0.26.11` (2026-07-12).
- Official Tree-sitter query API distinguishes immutable query objects from mutable query cursors and supports byte/point range restriction.
- `web-tree-sitter` supports independently loaded WASM languages and documents Electron/CommonJS usage; runtime/grammar compatibility must be verified rather than inferred.
- Current upstream issue tracking includes web-binding memory/pathological-work concerns; convert these into soak/resource tests rather than assuming issue text is universally reproducible.

Reference inputs:

- https://github.com/tree-sitter/tree-sitter/releases
- https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md
- https://tree-sitter.github.io/tree-sitter/using-parsers/3-advanced-parsing.html
- https://tree-sitter.github.io/tree-sitter/using-parsers/queries/4-api.html

## 22. Planner handoff

The smallest safe Tree-sitter integration is **not** "install Tree-sitter and parse files". The dependency-safe sequence is:

1. prove accepted Monaco and bounded PTY implementation SHAs on one lineage;
2. reuse their workspace/repository/document identity rather than inventing parallel identity;
3. seal typed parser protocol and UTF-16/UTF-8 incremental edit codec before loading a grammar;
4. load only hash-pinned app-bundled WASM grammars/query packs in a workspace-scoped worker;
5. keep repository content, syntax trees and captures at zero authority;
6. cache trees only under exact workspace/repo/base/document/grammar identity and worker epoch;
7. use version-fenced incremental parsing with deterministic full-snapshot recovery on gaps;
8. budget parsing and queries independently, degrade instead of blocking the editor, and kill/recycle workers on pathological synchronous work;
9. emit immutable provenance-rich syntactic facts only, leaving LSP/process authority and CKG semantic fusion to later explicitly gated stages;
10. defer repository-driven injection grammars and background repository indexing until separate trust/resource gates exist.

Current checkpoint disposition: **PLAN_READY / IMPLEMENTATION_BLOCKED_ON_MONACO_AND_PTY_COMPLETION_EVIDENCE**.
