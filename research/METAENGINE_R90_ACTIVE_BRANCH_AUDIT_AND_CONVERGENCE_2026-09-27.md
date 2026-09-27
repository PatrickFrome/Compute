# METAENGINE R90 — Active Branch Audit and Convergence

Date: 2026-09-27
Convergence branch: `work/r90-build-once-overlap-convergence-v1`
Authoritative parent at audit start: `work/r85-control-room-ui-v1 @ 4ed9ae49db91b241d0b35ded6fbb7e11e851e3e9`

## Why R90 exists

The active browser line split after R85 into several parallel build-once and qualification branches. By the time R86/R87/R88/R89 were being developed, the R85 branch itself had advanced and absorbed a separate canonical build-once/provenance implementation. That changed the merge topology:

- R85 became newer than the base of PRs #988/#989/#990.
- PRs #988, #989 and #990 became non-mergeable against the moving R85 base.
- R87/R88/R89 remained internally mergeable as a stack, but they inherited the alternative R86 provenance core rather than the newer implementation already present on R85.
- Blindly merging the stack would therefore replace/reintroduce a competing implementation instead of converging the strongest unique deltas.

R90 is a clean convergence branch created from the latest R85 head. It adopts only the still-useful R87/R88/R89 semantics and extends the canonical R85 provenance implementation in-place.

## Audited active lines

### R84 — PR #986

`work/r84-primary-me2-shell-v1 @ 8e85c4ab30e24c4b1fe330b376339707867d7b1e`

Still the direct base of R85 and therefore structurally relevant, but development has moved forward into R85. It is not used as the R90 implementation base.

### R85 — PR #987

`work/r85-control-room-ui-v1 @ 4ed9ae49db91b241d0b35ded6fbb7e11e851e3e9`

This is the current convergence parent. At audit time its major Windows gates were already green, including Critical Audit, Shell, Package Smoke, Final Runtime Activation and Installed Chat Qualification. The branch contains the current professional control-room UI, visual qualification hardening, and a canonical build-once installer provenance implementation.

### Alternative R85/R86 build-once lines — PRs #988, #989, #990

- #988 `work/r85-installer-forge-v1`
- #989 `work/r86-installer-provenance-v1`
- #990 `work/r86-build-once-provenance-v1`

These branches were valuable research/implementation sources, but all are based on older R85 identities. #988/#989/#990 were non-mergeable against the advanced R85 branch at audit time. Their reusable ideas are now treated as evidence/input, not as merge authority.

### R87 — PR #991

`work/r87-visual-isolation-v1`

Unique useful delta: presentation evidence must not contain live/stale Browser pixels. R90 adopts this on top of current R85 without importing the stale alternative R86 core.

### R88 — PR #992

`work/r88-consumer-ci-dedup-v1`

Unique useful delta: once Package Smoke is the immutable NSIS producer, Installed Chat, Final Runtime and Autonomous Soak must not independently rebuild/stage ME2 UI as if they were producing another package. R90 removes that dead duplicate work while preserving exact installed-bundle verification from the acquired installer.

### R89 — PR #993

`work/r89-early-artifact-overlap-v1`

Unique useful delta: candidate availability and producer qualification can be separated safely. Package Smoke may publish immutable bytes immediately after the single NSIS build; downstream physical consumers may start testing those exact bytes while Package Smoke continues its long installed/Sentinel proof. No consumer may finish green until the exact bound producer run/attempt itself finishes `success`.

## R90 implementation

### 1. Visual isolation without masking product defects

The ME2 BrowserStage now clears the previously rendered live frame when the stream errors, closes or its effect is torn down. The physical R85 visual harness blocks renderer requests targeting Browser transport ports 3042 and 3043, records both blocked ports, rejects any visible remote Browser pixels, and keeps the existing broken-image-hidden requirement.

This makes the screenshot evidence about the ME2 renderer itself, not about whatever remote page happens to be reachable on the runner.

### 2. Stronger canonical installer provenance

The existing R85 provenance core is extended rather than replaced:

- provenance now records Package Smoke run attempt;
- verification can bind exact run id, run number, run attempt and workflow;
- blockmap digest is physically verified;
- electron-builder config digest is physically verified;
- exact producer generation drift fails closed;
- permanent GitHub API 4xx errors fail closed instead of burning the entire polling budget;
- a new `wait` mode qualifies one exact producer run to terminal success.

### 3. Early immutable artifact publication

Package Smoke now uploads `metaengine-browser-windows-candidate-<exact-sha>` immediately after the one NSIS build. It contains only immutable build inputs required by consumers:

- installer;
- blockmap;
- installer provenance.

The long installed Browser / normal UI / second-instance / Sentinel proof continues afterward. Late diagnostics are uploaded separately as `metaengine-browser-windows-package-evidence-<exact-sha>`, avoiding a second upload of the large installer.

### 4. Consumer overlap with terminal producer fence

Installed Chat, Final Runtime and Autonomous Soak may acquire the early candidate while Package Smoke is still running. Each consumer:

1. binds to exact source SHA;
2. persists resolved producer run id/number/attempt;
3. verifies installer + blockmap + builder-config digests against provenance;
4. executes its own physical installed proof;
5. requires the same bound Package Smoke run/attempt to finish `success`;
6. persists `producer_terminal_success=true` before it can become accepted evidence.

If Package Smoke later fails, every bound consumer fails closed even if its own physical checks were otherwise successful.

### 5. CI deduplication

Redundant ME2 UI rebuild/stage work is removed from Installed Chat, Final Runtime and the installed-soak job. Those workflows now qualify the installed UI and daemon that came from the immutable Package Smoke bytes. Their path triggers include ME2 UI/daemon producer inputs so relevant source changes still schedule qualification.

## Safety invariants

R90 does not add:

- a second scheduler;
- blind effect retries;
- page/model production authority;
- Browser command authority in visual qualification;
- update or release promotion authority;
- signing or publication authority.

All early-artifact execution remains bounded by exact SHA, immutable digests and terminal producer-success fencing.

## Qualification plan

R90 is not accepted by static reasoning alone. Required exact-head evidence:

1. Critical Audit and Shell green.
2. Package Smoke visual evidence green with remote Browser transport blocked.
3. Package Smoke uploads the immutable candidate before its long installed proof finishes.
4. At least one downstream consumer acquires while Package Smoke is still in progress.
5. Consumer provenance verifies exact run id/number/attempt plus installer/blockmap/config bytes.
6. Package Smoke finishes success.
7. Installed Chat, Final Runtime and Autonomous Soak finish success after their terminal producer gate.
8. Self Update E2E remains green on the exact same R90 head.

Only after those gates are terminal-green should the older divergent build-once stack be retired as superseded.
