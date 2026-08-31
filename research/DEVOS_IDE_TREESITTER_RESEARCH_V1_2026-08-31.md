# DEVOS IDE Tree-sitter Architecture Research V1 — 2026-08-31

## Scope and authority

Fleet task: `5539ea20-c7ba-4e5d-9a09-ef657f320a6f`  
Agent: `agent_56550ccb-e53c-4a60-8beb-12305000875d` (`RESEARCHER`)  
Lease generation: `1`  
Exact supplied base: `84a71aaedc49186c24a992f507ca1d3f14767181`  
Target branch: `work/devos-ide-treesitter-research-v1`

This checkpoint is **advisory/research only**. It contains no Tree-sitter implementation, runtime promotion, production mutation, main merge, arbitrary evaluation, repository-defined execution, or browser actuation.

The task omitted `source_branch`, so this branch was created directly from the exact supplied base SHA rather than inferring a source branch.

Repository, page, model, grammar source, query text, LSP output and syntax-tree output are treated as untrusted data with zero authority. Findings below may shape future implementation only after the explicit dependency gates are proven.

## Dependency gate status

The existing DEVOS IDE elastic backlog defines the stage order:

`MONACO -> XTERM_PTY -> TREE_SITTER -> LSP -> CODE_KNOWLEDGE_GRAPH -> R10_CONTEXT_COMPILER`

and already defines the non-duplicative Tree-sitter semantic points:

- `TS1 devos.ide.treesitter.registry`
- `TS2 devos.ide.treesitter.incremental-edits`
- `TS3 devos.ide.treesitter.semantic-extract`
- `TS4 devos.ide.treesitter.integration`

All four depend on the XTERM/PTTY gate in that plan. GitHub branch/commit probes performed for this task did not find an independently named Monaco/PTTY completion commit. That absence is not proof that no work exists elsewhere, so this checkpoint **does not change dependency state** and makes no implementation-readiness claim.

Implementation rule for the future: Tree-sitter work may move from research to implementation only after authoritative evidence proves both Monaco and bounded PTY completion against the then-current integration line. Do not infer completion from branch names, model text, worker messages or repository prose alone.

## Existing DEVOS IDE contracts to reuse, not duplicate

`research/DEVOS_IDE_SHELL_RESEARCH_V2_2026-08-30.md` at `c2d2e73722cde49e6890675fe52dc7f18c3d6100` already establishes:

- host-owned workspace identity `{workspaceId, rootUri, generation, trustState}`;
- canonical Monaco model identity `(workspaceId, canonicalResourceUri)`;
- Monaco `versionId` for in-memory edit ordering, distinct from persisted file revision;
- a narrow typed host/file boundary rather than renderer filesystem access;
- a host-side large-file admission controller before Monaco model allocation;
- a language-service broker with stale-result fencing;
- restricted workspace as the default for unknown repositories;
- no generic privileged backend and no arbitrary eval.

This checkpoint specializes those seams for Tree-sitter instead of creating a parallel workspace, document, scheduler, trust or execution plane.

The current authoritative Supabase architecture checkpoint observed read-only during this task remains `METAENGINE_COMPUTE_UNIFIED_V1_CONVERGENCE_CP2_2026-08-29` at git commit `a23b647220c6bdeaa4340f804575dc2009e434cb`, with invariants including `PAGE_MODEL_WEBMCP_DATA_HAS_ZERO_AUTHORITY`, `TARGET_AND_EXECUTOR_INCARNATION_BINDING_IS_EXACT`, `REMOTE_CODE_IS_NEVER_EVALLED_IN_BROWSER_KERNEL`, `NO_BLIND_RETRY_AFTER_AMBIGUOUS_EFFECT`, and development-plane zero direct promotion authority. No Supabase mutation was performed.

## Current external evidence

Research retrieved on 2026-08-31:

1. Tree-sitter remains an incremental parsing system designed for editor-frequency reparsing. Current upstream releases list `v0.26.11` as latest, released 2026-07-12.
   - https://github.com/tree-sitter/tree-sitter/releases
   - https://github.com/tree-sitter/tree-sitter
2. Official incremental edit flow is: edit the old tree with `TSInputEdit`, then parse the new source using that edited old tree. The new tree structurally shares unchanged data with the old tree.
   - https://tree-sitter.github.io/tree-sitter/using-parsers/3-advanced-parsing.html
3. Tree-sitter points are byte-oriented: node positions contain raw byte offsets and a `{row,column}` whose `column` is the number of bytes from the line start.
   - https://tree-sitter.github.io/tree-sitter/using-parsers/2-basic-parsing.html
4. Monaco content events expose an ordered `changes[]`, new `versionId`, and change records containing old range, `rangeLength`, `rangeOffset`, and replacement `text`. Monaco documents that changes are ordered from the end of the document toward the beginning and are safe to apply in sequence.
   - https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.IModelContentChangedEvent.html
   - https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.IModelContentChange.html
5. `web-tree-sitter` supports browser/Electron WASM grammars, supports CommonJS packaging for Electron, loads languages independently, and documents parser-ABI compatibility. For `web-tree-sitter >=0.25`, parser ABI 13-15 is supported; older prebuilt dynamic-linking WASM may still be incompatible and should be rebuilt with a current CLI.
   - https://github.com/tree-sitter/tree-sitter/blob/master/lib/binding_web/README.md
6. VS Code currently depends on `@vscode/tree-sitter-wasm`, and its standalone editor service contains a Tree-sitter library service. VS Code's own prebuild repository builds the runtime and selected grammars as WASM.
   - https://github.com/microsoft/vscode/blob/main/package.json
   - https://github.com/microsoft/vscode/blob/main/src/vs/editor/standalone/browser/standaloneServices.ts
   - https://github.com/microsoft/vscode-tree-sitter-wasm
7. Zed separates language metadata, grammar, Tree-sitter queries and language servers, and pins grammar sources to an explicit Git revision in extension metadata.
   - https://zed.dev/docs/extensions/languages
8. Neovim uses incremental Tree-sitter parsing and explicitly notes that injection queries currently run across the whole buffer and can be slow on large buffers. Its runtime model also allows parser/query loading from runtime paths — useful precedent for functionality, but not a trust model DEVOS should copy.
   - https://neovim.io/doc/user/treesitter/
9. The Tree-sitter Query API defines `TSQuery` as immutable/thread-shareable and `TSQueryCursor` as mutable execution state that must not be shared across threads. Query execution can be restricted by byte/point ranges.
   - https://tree-sitter.github.io/tree-sitter/using-parsers/queries/4-api.html
10. A VS Code issue from 2025 documents a real unresponsive-window sample whose hot stack was Tree-sitter query-cursor execution after a large edit. This is evidence that query execution needs isolation/budgets, not proof of a universal Tree-sitter defect.
    - https://github.com/microsoft/vscode/issues/248296
11. An open upstream `web-tree-sitter` issue (`#5547`, opened 2026-04-25) reports retained native memory in a global scratch query cursor across multi-language query workloads. It is an unresolved upstream report, not an established invariant; DEVOS should convert it into soak/recycling acceptance tests rather than assuming the report is always reproducible.
    - https://github.com/tree-sitter/tree-sitter/issues/5547
12. Sourcegraph explicitly distinguishes syntactic navigation from precise semantic navigation: precise data outranks syntactic data, which outranks search-based fallback. This is a useful model for the future Tree-sitter -> LSP -> CKG provenance seam.
    - https://sourcegraph.com/docs/code-navigation/syntactic-code-navigation
    - https://sourcegraph.com/docs/code-navigation/precise-code-navigation

## Architecture decisions

### TS-D1 — Prefer app-bundled WASM grammars in a dedicated parser worker for V1

**Decision.** The first implementation slice should use `web-tree-sitter` plus locally packaged/pinned WASM grammars inside a dedicated parser Web Worker (or equivalent isolated worker surface already provided by the IDE language-service broker). Do not load native `.node`, `.so`, `.dll` or `.dylib` grammars into the renderer.

A native binding may be revisited only after measurements prove WASM is insufficient and a separate trusted utility-process boundary can preserve the same identity/resource limits.

**Why.** This gives one grammar format for desktop/web IDE modes, avoids native addon ABI/deployment complexity, keeps parser CPU away from the UI thread, and matches the already-planned worker language-service seam. Upstream notes that WASM is slower than native Node bindings, so this is a safety/parity choice, not a claim of peak parser throughput.

**Expected gain.** Lower renderer crash/freeze blast radius; simpler web/desktop parity; auditable grammar loading; deterministic packaging.

**Risk.** WASM parsing/querying may consume more CPU than native bindings. Mitigation: incremental parsing, query ranges, worker sharding/recycling and profiling before any native optimization.

### TS-D2 — Grammar provenance is host-owned and content-addressed

**Decision.** Define an immutable grammar registry entry with at least:

`{ languageId, grammarSourceRepo, grammarSourceRevision, grammarWasmSha256, treeSitterRuntimeVersion, treeSitterCliBuildVersion, parserAbiVersion, queryPackSha256, registryRevision }`

Only an app/host-owned allowlist may resolve `languageId -> grammar`. File extension, shebang, Monaco language id or repository metadata may request a language but can never cause an arbitrary grammar to be fetched or executed.

Do not load repository-local `.wasm`, native parser libraries, `grammar.js`, generated parser source, or `.scm` query files automatically. Do not fetch a grammar URL from workspace settings. Do not compile a repository grammar at runtime.

**Why.** Zed's pinned grammar revisions are a useful supply-chain pattern, while the current web-tree-sitter ABI/dynamic-link compatibility warning shows that source revision alone is insufficient; binary hash, build/runtime versions and ABI need to be part of provenance.

**Expected gain.** Reproducible parser behavior; simpler rollback; no repository-to-executable grammar escalation; fewer “works on one machine” ABI failures.

**Risk.** Slower language onboarding. Mitigation: offline registry/build pipeline that produces reviewed artifacts; no need to weaken runtime trust.

### TS-D3 — Tree-sitter remains derived analysis with zero effect authority

**Decision.** Parser/tree/query output is advisory derived data only. A syntax capture can annotate the editor or emit a `SyntaxFact`, but cannot:

- write files;
- start commands/processes;
- grant workspace trust;
- change Browser Operator authority;
- choose an executable grammar or query source;
- authorize LSP workspace edits;
- promote production state.

All downstream consumers must treat node text, names, comments, strings and captures as untrusted repository data.

**Expected gain.** Prompt injection or malicious source text cannot become a privilege transition through the parser layer.

**Risk.** Some IDE features may be less convenient than ecosystems that allow project-local parser/query overrides. This is intentional for V1.

### TS-D4 — Introduce one explicit Monaco-to-Tree-sitter coordinate codec

**Decision.** Do not pass Monaco offsets/columns directly into Tree-sitter edit structs. Centralize translation in one tested `DocumentOffsetCodec` that derives Tree-sitter byte offsets and byte columns from the canonical model snapshot/edits.

Required invariant:

`Monaco document version N -> exact byte representation B_N -> exact Tree-sitter coordinates for edits N -> N+1`

The codec must cover Unicode astral characters/surrogate pairs, combining characters, tabs, CRLF/LF, multi-edit events and EOL replacement. The parser should consume a canonical UTF-8 projection for V1; persisted file encoding remains a host/file concern defined by the shell research.

Monaco states that change records within one event are ordered from document end to beginning and safe to apply in sequence. Preserve that contract or normalize it explicitly; never reorder edits ad hoc.

**Expected gain.** Eliminates a major class of silent incremental-tree corruption on non-ASCII text and multi-cursor edits.

**Risk.** Maintaining byte indexes can become expensive if every edit rescans the full document. Mitigation: per-line UTF-8 byte prefix metadata / rope-style mapping, introduced only when profiling requires it. Correctness first.

### TS-D5 — Version-fenced incremental parse protocol with deterministic full-reparse recovery

**Decision.** Parser-worker messages use exact document incarnation fields:

`{ workspaceId, workspaceGeneration, resourceUri, modelVersion, languageId, grammarWasmSha256, parserWorkerEpoch }`

`OPEN` carries a full canonical snapshot. `APPLY_CHANGES` carries the expected previous model version plus the Monaco change batch and exact new model version.

For every accepted edit batch:

1. validate workspace/document/grammar/worker identity;
2. require `previousVersion == workerCurrentVersion`;
3. translate the entire change batch through the coordinate codec;
4. edit the old tree with matching Tree-sitter edits;
5. parse the new snapshot/text with the edited old tree;
6. compute changed ranges immediately;
7. atomically publish the new tree/version and discard stale result messages.

If a version gap, malformed edit, language change, grammar revision change, EOL reset or codec invariant failure is detected, **discard the old tree and request/reparse one exact current snapshot**. Do not guess missing edits.

This recovery is safe because parse state is derived/read-only analysis; it is not a retry of an ambiguous external effect.

**Expected gain.** Incremental work on normal edits while making lost/reordered worker messages fail closed instead of corrupting syntax state.

**Risk.** Full snapshot fallback can be expensive during repeated transport gaps. Mitigation: fix the transport; rate-limit fallback and degrade parsing rather than loop.

### TS-D6 — Syntax-tree cache identity must include workspace incarnation and grammar binary identity

**Decision.** Keep live `TSTree` objects inside their owning worker only. Do not structured-clone or persist raw Tree/Node handles outside the worker.

Recommended parse cache key:

`ParseKey = (workspaceId, workspaceGeneration, canonicalResourceUri, languageId, grammarWasmSha256, parserAbiVersion)`

Mutable entry state includes:

`{ modelVersion, workerEpoch, tree, lastParseMetrics, lastChangedRanges }`

Changing workspace generation, canonical URI binding, language, grammar hash or ABI creates a different identity and invalidates the old tree.

Cross-thread messages must also carry `workerEpoch`; results from a terminated/recycled worker are stale even if the document version happens to match.

**Expected gain.** Prevents stale trees from crossing worktree replacement, language reassignment, grammar upgrades or worker crashes.

**Risk.** More cache churn during explicit language/grammar changes. Correctness is preferable to unsafe reuse.

### TS-D7 — Never use raw `TSNode` identity as durable semantic identity

**Decision.** Node handles are scoped to a tree incarnation. Official Tree-sitter guidance notes that stored node positions need separate edit updates after tree edits. Therefore:

- do not cache raw nodes across document versions outside the worker;
- do not use node object identity as a CKG node ID;
- do not persist node IDs as authoritative symbol identity;
- publish immutable DTO captures with explicit source range, node type, query provenance and document version.

A downstream system may derive a provisional syntactic key from document identity + query role + range/name fingerprint, but it must remain explicitly `SYNTACTIC` and replaceable by LSP/SCIP semantic identity later.

**Expected gain.** Avoids ghost symbols and cross-version node aliasing.

**Risk.** Syntactic facts can churn after edits. The future CKG invalidation layer should model that rather than pretending Tree-sitter gives stable semantic IDs.

### TS-D8 — Query packs are immutable, grammar-coupled artifacts; query execution is bounded and local

**Decision.** Query text is shipped as a reviewed app artifact, not read from repository runtime paths. Compile/cache queries by:

`QueryKey = (grammarWasmSha256, parserAbiVersion, queryPackSha256, queryKind)`

At minimum, separate query kinds such as:

- `outline/symbols`
- `scopes`
- `imports`
- `calls`
- optional `injections`
- optional editor decoration/highlight queries if they are actually needed beyond Monaco tokenization

Compile once per compatible language/worker lifecycle and explicitly dispose/recreate on grammar/query revision change.

Treat execution cursor/state as per-execution mutable state. Do not share a query cursor across threads. Restrict queries to changed/viewport/indexing ranges where semantics permit, and bound match counts/time/complexity. A `(0,0)` query end range is documented as unbounded, so range construction requires explicit tests.

**Expected gain.** Less query compilation churn and fewer full-tree scans; reproducible extraction semantics.

**Risk.** A badly designed query can still cause high CPU/memory. Mitigation: budgets, golden fixtures, fuzzing and worker termination.

### TS-D9 — Large-file degradation should be layered on top of the existing Monaco admission controller

Do **not** create a second independent “large file” authority policy. Reuse the shell's host admission result, then specialize Tree-sitter service quality.

Proposed levels:

**TS_NORMAL**
- full incremental tree;
- changed-range extraction;
- standard structural queries;
- bounded injection support.

**TS_CONSTRAINED**
- keep incremental parse if parse budget is healthy;
- disable injection queries first;
- run structural queries only for changed ranges plus a bounded context window;
- viewport/outline-critical queries get priority;
- defer call/import graph scans to idle time.

**TS_PARSE_ONLY**
- keep a syntax tree only if parsing remains within budget;
- disable nonessential query packs and semantic extraction;
- Monaco/editor continues without Tree-sitter-derived enrichments.

**TS_DISABLED_FOR_DOCUMENT**
- terminate/dispose tree state after repeated parse/query budget failures or worker OOM/restart;
- continue plain Monaco/tokenizer/LSP paths independently if their own gates/services are healthy;
- expose a typed degraded reason, never spin in automatic retry.

Neovim's current documentation that injection queries operate over an entire buffer and can be slow supports disabling injections before abandoning the base parser. The VS Code freeze report supports keeping expensive query execution off the UI thread.

**Expected gain.** Editor responsiveness survives pathological generated/minified/mixed-language files without duplicating file admission policy.

**Risk.** Semantic richness becomes size-dependent. Surface the degraded reason and collect metrics so thresholds can be tuned from evidence.

### TS-D10 — Parser workers need bounded lifecycle and explicit recycling

**Decision.** Use a small bounded worker pool, preferably sharded by language or compatible grammar set, rather than one worker per document or one unbounded global worker for every language.

Each worker tracks:

- live document count;
- live tree count;
- grammar/query set count;
- parse latency EWMA/p95;
- query latency EWMA/p95;
- cancellation/timeout count;
- approximate heap/RSS/native memory when available;
- recycle generation (`workerEpoch`).

Recycle a worker only at a typed safe boundary: dispose/cancel read-only parse work, increment epoch, start a clean worker, then re-open exact current snapshots for still-live documents. Results from the old epoch are rejected.

The open upstream web-tree-sitter memory-retention issue is a reason to add multi-language soak tests and recycling capability, not a reason to assume every current runtime leaks.

**Expected gain.** Bounds blast radius of parser/query memory pathology and gives a deterministic crash-recovery story.

**Risk.** Recycling causes temporary reparsing. Keep the pool small and measure before choosing thresholds.

### TS-D11 — Separate syntactic facts from semantic facts at the LSP seam

**Decision.** Tree-sitter emits only syntactic facts, for example:

`SyntaxFact { documentIdentity, modelVersion, grammarHash, queryPackHash, factKind, localName?, syntacticRole?, rangeUtf16, rangeBytes, scopePath?, provenance: 'TREE_SITTER_SYNTACTIC' }`

The future LSP layer must use the same canonical document identity and model version plus its own exact language-server incarnation. It may enrich/resolve syntactic facts into semantic definitions/references/types, but stale LSP responses never mutate current syntax facts.

Tree-sitter should not emulate compiler-resolved symbol identity when it only has syntax. Sourcegraph's precedence model is appropriate:

`precise semantic > syntactic > search heuristic`

**Expected gain.** Fast local structure is available before/without an LSP, while precise navigation can supersede it cleanly when available.

**Risk.** Consumers may accidentally treat syntactic name matches as precise references. Require a provenance/quality field in every fact and API response.

### TS-D12 — CKG ingestion is versioned, provenance-preserving and replaceable

**Decision.** The future Code Knowledge Graph should ingest Tree-sitter facts transactionally by exact document version, not directly hold Tree-sitter nodes.

Suggested provenance key:

`{ workspaceId, workspaceGeneration, resourceUri, modelVersion, producer='TREE_SITTER', grammarWasmSha256, queryPackSha256 }`

On a new accepted document version, invalidate/replace the previous Tree-sitter-produced fact set for that document (or changed-range partitions if the graph implementation later proves that partitioning is deterministic). LSP enrichment is a separate producer with server-incarnation provenance.

Tree-sitter tags/queries can seed definitions, references, imports, scopes and calls, but graph edges requiring semantic resolution remain provisional until LSP/SCIP evidence exists.

**Expected gain.** Fast incremental graph freshness without laundering syntax heuristics into precise semantic authority.

**Risk.** Full per-document fact replacement can cost more than fine-grained invalidation. Start with deterministic replacement; optimize only after profiling and consistency tests.

## Recommended process/data shape

```text
Monaco canonical model
  | onDidChangeContent + exact modelVersion
  v
Tree-sitter broker (renderer-side typed API only)
  | identity/version validation
  v
Parser worker pool
  |-- local, pinned tree-sitter runtime WASM
  |-- host-provided approved grammar WASM
  |-- immutable approved query packs
  |-- DocumentOffsetCodec
  |-- TSTree + Query cache (worker-local)
  |
  +--> typed SyntaxFact/read-only editor projections
           |
           +--> later LSP broker (semantic enrichment, own incarnation fence)
                    |
                    +--> later CKG ingest (versioned provenance)
```

No arrow in this pipeline grants execution, filesystem, task, terminal, Browser Operator or production authority.

## Failure/recovery matrix

| Failure | Required behavior | Never do |
| --- | --- | --- |
| Monaco version gap | Drop incremental state; request one exact current snapshot; full reparse if within budget | Guess missing edits |
| Workspace generation change | Invalidate all old workspace parse/query results | Rebind by path string alone |
| Language/grammar hash change | Dispose old tree/query cache; reopen under new parse identity | Reuse old tree across grammar revisions |
| Worker crash/OOM | Increment worker epoch; re-open exact live snapshots under bounded policy | Accept late old-worker results |
| Parse timeout/budget breach | Degrade service level; bounded retry only from exact snapshot as read-only analysis | Tight retry loop |
| Query timeout/match explosion | Abort/terminate query worker as needed; disable offending query pack/document tier | Block UI thread waiting |
| Malicious repo `.scm`/`.wasm`/native grammar | Treat as inert workspace content | Auto-load/compile/execute it |
| Query pack compile failure | Disable that approved query pack/version and report typed error | Fetch replacement query from repository/web |
| Stale LSP enrichment | Drop semantic result | Overwrite current syntax/CKG state |
| CKG ingest partial failure | Keep previous committed graph snapshot or atomically replace | Publish half-updated provenance |

## Acceptance evidence required before implementation can be called complete

This research does not implement these tests; it defines the evidence the future TS1-TS4 slices should produce after dependency gates open.

### TS1 registry/provenance

- approved grammar registry rejects unknown language ids and unknown hashes;
- parser runtime/grammar ABI compatibility is tested;
- grammar/query artifact SHA changes force new identity;
- repository-local `.wasm`, native parser libraries and `.scm` files cannot become runtime inputs;
- no network grammar fetch on normal parse path;
- worker has no generic filesystem/process/eval bridge.

### TS2 incremental edits

- property test: incremental tree after random valid Monaco edit sequences equals full parse tree for the final exact text;
- multi-change event ordering test using Monaco's documented end-to-start ordering;
- Unicode fixtures: BMP, astral/surrogate pairs, combining marks, CRLF/LF and mixed-width text;
- stale/out-of-order model version is rejected;
- EOL flush/language change/grammar revision triggers deterministic full-reparse path;
- changed-range result is computed from the edited old tree and new tree immediately after parse.

### TS3 semantic extraction/query lifecycle

- golden symbol/scope/import/call fixtures across initial supported languages;
- query pack grammar mismatch fails closed;
- range-restricted query equivalence tests where range execution is allowed;
- query match/time budget negative tests;
- query compile/disposal lifecycle leak test;
- malicious source strings/comments/captures remain inert data;
- SyntaxFacts always include document version and producer/query/grammar provenance.

### TS4 integration/resource behavior

- parser/query work never runs synchronously on UI-critical thread;
- large-file degradation ladder is deterministic and observable;
- injection queries disable before base parsing is abandoned;
- worker crash/recycle rejects old-epoch results and restores live documents from exact snapshots;
- multi-language soak test tracks memory and catches monotonic growth regressions;
- opening/closing/reopening workspaces leaves no live trees from stale workspace generations;
- CKG/LSP seams are typed but remain inactive until their later gates open.

## Risk register

| Risk | Severity | Mitigation |
| --- | --- | --- |
| UTF-16/UTF-8 coordinate mismatch silently corrupts incremental trees | HIGH | Single offset codec; Unicode property tests; full-parse equivalence oracle |
| Repository-provided grammar/query becomes code execution or resource-exhaustion path | HIGH | Host-pinned artifacts only; no runtime repository grammar/query loading |
| Stale tree crosses workspace/model/grammar incarnation | HIGH | ParseKey + modelVersion + workerEpoch fencing |
| Query stalls UI after large edit | HIGH | Worker-only execution, range/budget limits, degradation ladder |
| WASM/native memory retention across many languages | HIGH | Soak tests, bounded language shards, worker recycling; track upstream #5547 |
| Injection queries scale with whole buffer | MEDIUM/HIGH | Disable injections first in constrained mode; explicit budgets |
| WASM slower than native bindings | MEDIUM | Incremental parse; measure; native utility-process option only if evidence demands it |
| Grammar/query ABI drift | MEDIUM | Runtime/CLI/ABI/hash manifest; compatibility test in build pipeline |
| Syntactic facts mistaken for semantic truth | HIGH | Mandatory provenance/quality tier; semantic producer supersedes syntactic producer |
| Over-aggressive degradation hurts language features | MEDIUM | Typed reason + telemetry/profiling + user-visible capability state |
| Worker recycling causes burst reparses | MEDIUM | Small bounded pool; stagger recovery; snapshot dedupe |

## Expected system gains

If implemented after Monaco/PTTY evidence, this design should provide:

1. **Editor responsiveness:** parsing and queries stay off the UI-critical path, with explicit degradation instead of unbounded work.
2. **Incremental efficiency:** normal edits reuse unchanged Tree-sitter structure and restrict downstream extraction to changed regions where safe.
3. **Deterministic correctness:** document/workspace/grammar/worker incarnations make stale results rejectable rather than heuristically merged.
4. **Supply-chain safety:** grammars and query packs are pinned, content-addressed app artifacts; repository content cannot introduce executable parser code.
5. **Web/desktop parity:** WASM worker path can be shared between Electron and web-oriented IDE surfaces.
6. **Clean semantic layering:** Tree-sitter supplies fast syntax; LSP later supplies precise semantics; CKG stores both with explicit provenance.
7. **Crash recovery:** parser state is disposable derived state and can be reconstructed from an exact canonical Monaco snapshot without mutating external state.
8. **Resource containment:** large files, pathological queries and multi-language memory growth have observable bounded failure modes.

These are expected architectural gains, not benchmark claims. Future implementation must attach measured latency/memory evidence before making quantitative performance promises.

## Smallest future implementation order after gates open

Do not execute this order until Monaco + bounded PTY completion is independently proven.

1. `TS1a` — grammar/query provenance schema + packaged two-language fixture registry, no parsing yet.
2. `TS1b` — isolated worker bootstrap with local runtime WASM and one pinned grammar.
3. `TS2a` — full snapshot parse + exact result identity, no incremental edits yet.
4. `TS2b` — Monaco change codec + incremental edit property tests vs full-parse oracle.
5. `TS2c` — changed-range publication + worker crash/version-gap recovery.
6. `TS3a` — one immutable symbol/outline query pack + typed SyntaxFact output.
7. `TS3b` — scopes/imports/calls, query budgets and range restriction.
8. `TS4a` — large-file degradation + injection policy + worker soak/recycle tests.
9. `TS4b` — integration seal exposing read-only seams for later LSP/CKG, with those later stages still gate-disabled.

## Non-decisions / intentionally deferred

- No decision to adopt native Tree-sitter bindings in production.
- No decision to allow third-party/repository grammars at runtime.
- No decision to replace Monaco tokenization/highlighting with Tree-sitter highlighting in V1.
- No decision to persist serialized syntax trees across application restarts.
- No decision to treat Tree-sitter tags as precise cross-file semantic identity.
- No implementation of LSP, CKG, Monaco, PTY or Tree-sitter in this branch.

## Checkpoint conclusion

The smallest safe Tree-sitter architecture for DEVOS is not “put a parser next to Monaco.” It is a **bounded, version-fenced derived-analysis service**:

- canonical Monaco model is the text/version source;
- a single coordinate codec produces byte-correct Tree-sitter edits;
- parser/query state lives in isolated bounded workers;
- grammars/query packs are app-pinned and content-addressed;
- trees/nodes never become durable semantic identities;
- large-file/query pathologies degrade features rather than UI availability;
- Tree-sitter facts are explicitly syntactic and feed later LSP/CKG layers through provenance-preserving, stale-result-fenced contracts;
- repository/page/model content remains data with zero authority.

This checkpoint is ready to inform TS1-TS4 planning, but **implementation remains blocked on authoritative Monaco + PTTY completion evidence**.