# METAENGINE RSI V1.7 — Trusted Promotion Producer Activation Barrier

Status: PREP IMPLEMENTED / NO LIVE SIGNING / NO PROMOTION OR SELF-UPDATE AUTHORITY

## Purpose

V1.7 separates recursive improvement from the identity that may later attest promotion-review evidence. The candidate branch may produce measurements and proposed evidence, but it cannot execute the trusted signer, select its code, change its workflow identity, or turn a self-hash into provenance.

The future producer flow is:

`persisted trusted evidence bytes -> exact GitHub run readback -> deterministic promotion subject -> protected trusted workflow -> pinned GitHub attestation -> independent gh attestation verify -> cryptographically verified NONAUTHORITATIVE receipt`

No step in V1.7 installs a Browser build, calls Self Update, grants a promotion token, performs browser/process actuation, applies production DDL, or authorizes automatic retry.

## Trust separation

The producer must run only from `refs/heads/release/self-update-ambiguity-live-v2` under an exact trusted-control SHA and protected environment `rsi-promotion-attestation`.

It must not use `pull_request`, `push`, `pull_request_target`, `workflow_run`, or `workflow_call` as a signing authority path. In particular, privileged jobs must never checkout candidate code. Candidate output is consumed only as persisted, digest-bound data.

The planned signer job is constrained to:

- `contents: read`
- `actions: read`
- `id-token: write`
- `attestations: write`

Pinned actions:

- `actions/checkout@11d5960a326750d5838078e36cf38b85af677262`
- `actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6`
- `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`

## Persisted evidence requirement

Signing activation requires actual bytes and hashes for exactly:

- `promotion-gate.json`
- `promotion-qualification.json`
- `shadow-canary-proof.json`
- `rollback-proof.json`
- `artifact-manifest.json`
- `slsa-provenance-verification.json`
- `github-workflow-runs.json`

The producer must independently compare the seven required Browser workflow runs against qualification claims using repository id/name, exact candidate SHA, run id, completed status, SUCCESS conclusion and expected event. Caller-provided CI truth is never sufficient.

## Activation semantics

`READY_FOR_TRUSTED_WORKFLOW_ACTIVATION` means only that the protected workflow contract may be installed on the trusted ref after revalidation. It does **not** mean signing is already authorized.

The activation result always keeps:

- `signing_activation_authorized=false`
- `production_mutation_authority=false`
- `promotion_authority=false`
- `self_update_authority=false`
- `execution_authority=false`
- `automatic_retry_allowed=false`
- `authority_effect=false`

The live signer workflow is intentionally absent from the RSI development branch. It must be introduced from the trusted release/control lineage and independently reviewed there.

## Research basis

The boundary follows the repository's existing R1 attestation pattern and current GitHub/SLSA guidance: artifact attestations become useful only when independently verified; provenance consumers must bind the artifact to the expected repository, workflow/build identity and exact source; protected environments can restrict branch use and require approval; privileged workflow contexts must not execute untrusted pull-request code.
