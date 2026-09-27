# METAENGINE R89 — Early Immutable Artifact Overlap

Date: 2026-09-27  
Branch: `work/r89-early-artifact-overlap-v1`  
Parent: R88 consumer CI deduplication

## Objective

Remove the remaining serialization between the Package Smoke producer and the three downstream physical qualification workflows without weakening the build-once safety model.

R86 proved that Installed Chat, Final Runtime, and Autonomous Soak can qualify the same immutable Package Smoke bytes. R88 removes redundant UI rebuilds in those consumers. The remaining latency is structural: Package Smoke previously uploaded the candidate only after its long installed UI / second-instance / Sentinel proof, so consumers could not start installation until the producer was already terminal.

R89 separates **artifact availability** from **producer qualification**.

## Protocol

1. Package Smoke builds NSIS once and writes `installer-provenance.json`.
2. Immediately after the immutable installer, blockmap, and provenance exist, Package Smoke uploads:
   `metaengine-browser-windows-candidate-<exact-head>`.
3. Package Smoke continues its own installed Browser, normal UI, second-instance, and Sentinel proof independently.
4. Consumers may resolve and acquire the candidate while that exact Package Smoke run is still `in_progress`.
5. The acquire result binds the consumer to exact:
   - source SHA;
   - Package Smoke run id;
   - run attempt;
   - artifact id/name.
6. After extraction, provenance verification additionally requires the exact resolved producer run id and attempt. A candidate cannot claim a different producer generation.
7. Consumers perform their physical qualification against those immutable bytes.
8. Before any consumer can finish green, it calls the new producer `wait` gate for the bound run id/attempt and requires the same Package Smoke run to terminate `success`.
9. Consumer proof JSON persists the producer run id/attempt, whether the producer was already terminal at acquire time, and `producer_terminal_success=true` only after the terminal gate passes.

Thus an early candidate from a producer that later fails can consume test time, but it can never become accepted evidence or a green downstream qualification.

## Package Smoke artifact split

The old single late artifact mixed immutable candidate bytes and late qualification evidence.

R89 splits it into:

- early immutable candidate:
  `metaengine-browser-windows-candidate-<sha>`
  - installer;
  - blockmap;
  - installer provenance;
  - compression level 0 because the NSIS payload is already compressed and downstream latency matters.

- late proof artifact:
  `metaengine-browser-windows-package-evidence-<sha>`
  - package proof;
  - installed ME2/daemon evidence;
  - startup/Sentinel/progress journals;
  - shell and primary-ME2 visual evidence;
  - diagnostic logs.

This avoids uploading the large installer twice.

## Failure semantics

- Exact head mismatch: fail closed.
- Producer workflow mismatch: fail closed.
- Producer run/attempt mismatch between resolution and provenance: fail closed.
- Producer terminal failure: all bound consumers fail.
- Permanent GitHub API 4xx: fail immediately.
- Transient API/network errors: bounded retry only.
- Missing early artifact while producer is still active: bounded polling.
- Missing artifact after producer success: fail closed.
- No automatic effect retry, no second scheduler, no production promotion authority.

## Expected effect

R86 physical evidence shows all three consumers spend a significant interval waiting at the acquire boundary until Package Smoke completes its long normal-UI/Sentinel proof. R89 allows their installer download, installation, bundle verification, and most physical tests to overlap that interval while preserving the producer-success fence.

Performance improvement is not claimed until exact R89 Windows CI provides timestamps.

## Qualification

R89 is not qualified by unit/static tests alone. Required evidence:

- Package Smoke publishes the early immutable candidate before its long installed proof;
- at least one downstream consumer acquires while Package Smoke is still in progress;
- provenance binds that consumer to the exact producer run/attempt;
- the consumer later crosses the terminal producer-success gate;
- Package Smoke and all affected consumers finish green on the same exact source SHA.
