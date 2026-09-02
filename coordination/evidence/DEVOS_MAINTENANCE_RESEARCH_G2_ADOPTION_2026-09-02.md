# DevOS Maintenance Research G2 — Adoption Checkpoint

Status: **ADOPT_AS_FUTURE_ZERO_AUTHORITY_EVIDENCE**  
Date: 2026-09-02  
Source task: `ebc40044-3896-43e4-bcad-17c9959a7531`  
Source checkpoint: `work/devos-maintenance-researcher-g2 @ a2c4ea214f8906a22a945a3ac1d92737e8c8e60f`  
Adoption task: `33a68f01-4564-43a8-ba3f-075deb2a4ab9`  
Authority effect: false

## Decision

Adopt `C12_TEST_SELECTION_CALIBRATION_GATE_V1` as future `DEVOS_BUILD_FABRIC` / canonical C12 acceptance evidence only.

The accepted idea is deliberately narrower than a new scheduler or build graph:

1. keep the full suite authoritative while an affected-test selector runs in shadow;
2. persist counterfactual selected/omitted/full results bound to exact base/head/diff/selector/graph digests;
3. measure failure recall before allowing any test-skipping authority;
4. use bounded mutation-seeded faults as a lab oracle for selector false negatives;
5. classify infrastructure/flaky outcomes separately rather than counting them as selector success;
6. fail back to the full suite on unknown graph state, unsupported changes or calibration uncertainty.

## Non-duplication boundary

Do not add a second impact graph, CI scheduler, workflow engine or external authority plane. The existing C12 Incremental Impact Graph remains the roadmap owner. This checkpoint only adds the calibration/acceptance contract that must be satisfied before C12 can suppress tests.

## Ordering

This evidence does not pre-empt the current IDE/workspace/runtime critical path. It becomes actionable only when `DEVOS_BUILD_FABRIC` reaches its dependency-safe implementation window.

## Required future acceptance tests

- candidate selector runs in shadow while full suite still executes;
- deterministic exact base/head inputs reproduce the same selected set;
- any full-suite relevant failure omitted by the subset is a hard false negative;
- mutation killed by full suite but missed by selected subset is a hard false negative;
- dependency/lockfile/config/generated-file uncertainty forces full-suite fallback;
- no speedup claim is accepted if failure recall regresses;
- receipts have `authority_effect=false` until an independent promotion gate is satisfied.

No production mutation, package installation, Browser actuation, scheduler creation, main/integration merge or release promotion is performed by this adoption checkpoint.
