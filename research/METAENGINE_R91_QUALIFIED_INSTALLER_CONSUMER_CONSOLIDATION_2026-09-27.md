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
