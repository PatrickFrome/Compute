# METAENGINE R91 — Qualified Installer Consumer Consolidation

Date: 2026-09-27
Branch: `work/r91-qualified-installer-consumer-helper-v1`
Parent: qualified R90 exact head `1ca341fc3e6f03d34bade36c8960754791a444c8`

## Starting audit

R90 is terminal-green on the exact qualified head and is now the strongest active convergence line above R85.

After R90 qualification, the divergent implementation PRs #988–#993 were retired as superseded by #994. They remain historical evidence, not merge authority. R84 #986 and R85 #987 remain structural ancestors; R90 #994 remains the active convergence PR.

The next repeated failure surface was no longer semantic build drift. It was duplicated consumer plumbing: Installed Chat, Final Runtime and Autonomous Soak each carried their own copies of the same acquire → resolve → expand → verify → bind → terminal-wait protocol.

## R91 objective

Reduce that drift surface without changing runtime or authority semantics.

R91 introduces one Windows CI helper:

`apps/metaengine-browser/scripts/qualified-installer-consumer.ps1`

It owns two bounded modes:

- `Acquire`
  - resolves the exact-head Package Smoke run;
  - allows the already-proven R90 early-artifact overlap;
  - expands the exact artifact;
  - verifies exact SHA, producer run id/number/attempt/workflow;
  - verifies installer, blockmap and builder-config evidence;
  - persists one immutable consumer binding JSON.

- `Wait`
  - re-reads the persisted binding;
  - checks it against the workflow-specific proof;
  - waits only for the exact bound Package Smoke run/number/attempt;
  - requires terminal `success`;
  - writes `producer_terminal_success=true` and a qualification timestamp into the consumer proof.

## Workflow simplification

The three physical consumers now depend on one binding file instead of four independent producer environment variables:

- Browser Windows Installed Chat Qualification
- METAENGINE Browser Final Runtime Activation V1
- METAENGINE Browser Windows Autonomous Soak V1

The workflows no longer inline low-level calls to:

- `installer-provenance.mjs acquire`
- `installer-provenance.mjs verify`
- `installer-provenance.mjs wait`

They invoke the R91 helper in `Acquire` and `Wait` modes and preserve their own product-specific installed proofs.


## Trigger-topology defect found during qualification setup

Opening the R91 PR exposed a separate exact-head orchestration defect: Installed Chat / Final Runtime / Autonomous Soak were scheduled for the new head, but Package Smoke was not, because the producer's pull-request path filter was narrower than the union of its consumers.

That topology is invalid for an exact-head immutable artifact system: every consumer head requires a Package Smoke artifact whose provenance names that same head. Reusing a parent artifact would violate the source-head contract, while waiting for a producer that was never scheduled would deadlock/fail the consumers.

R91 therefore also closes the producer trigger graph:

- Package Smoke now includes `apps/metaengine-browser/**` in its PR trigger surface;
- consumer workflow file changes themselves also trigger Package Smoke;
- the contract test pins this closure so a future consumer-only CI change cannot schedule downstream qualification without an exact-head producer.

This deliberately prefers correctness over avoiding one producer run. The build-once architecture still removes the larger duplicate cost: only Package Smoke builds NSIS.

### Shared-helper trigger dependency

A second trigger-graph audit found that Final Runtime and Autonomous Soak executed the new shared helper but their selective PR path filters did not yet include the helper file itself. That would allow a future helper-only change to receive Package Smoke evidence without rerunning every consumer that depends on the helper.

The R91 line now explicitly includes `apps/metaengine-browser/scripts/qualified-installer-consumer.ps1` in Final Runtime and Autonomous Soak triggers. Installed Chat already covers it through `apps/metaengine-browser/**`. A regression pins this dependency closure.

## Safety invariants

R91 does not change:

- the single Package Smoke NSIS producer;
- exact-source SHA fencing;
- installer/blockmap/config digest verification;
- early immutable-artifact overlap;
- terminal producer-success requirement;
- second-scheduler prohibition;
- automatic effect retry prohibition;
- Browser command authority;
- production promotion, signing or publication authority.

The helper does not use `Invoke-Expression`, `Start-Process`, `cmd.exe` or nested PowerShell execution. Native execution remains the fixed Node provenance CLI plus `Expand-Archive`.

## Regression coverage

New `qualified-installer-consumer-contract.test.mjs` pins:

- the helper's fixed Acquire/Wait protocol;
- exact producer-generation verification;
- blockmap/config verification;
- terminal producer binding;
- absence of dangerous arbitrary execution primitives;
- one helper Acquire and one helper Wait call in each consumer;
- absence of duplicated low-level provenance commands and old producer env-variable fanout.

## Qualification requirement

R91 is not accepted by static simplification alone. It requires the same exact-head physical matrix as R90 for the affected surfaces:

1. Critical Audit full Node regression green.
2. Shell green.
3. Package Smoke green.
4. Installed Chat green through the helper.
5. Final Runtime green through the helper.
6. Autonomous Soak green through the helper.
7. Self Update remains green on the same exact head.

Only after physical Windows CI demonstrates that the centralized helper preserves R90's early-overlap and terminal-success behavior should R91 be treated as the next development head.
