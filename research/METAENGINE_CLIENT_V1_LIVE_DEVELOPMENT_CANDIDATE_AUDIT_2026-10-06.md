# METAENGINE Client V1 — LIVE Development Candidate Critical Audit

Date: 2026-10-06  
Status: **PRE-LIVE RELEASE CANDIDATE AUDIT — CONTROLLED / EVIDENCE_READY**  
Branch: `work/client-v1-live-development-candidate-v1`  
Qualified implementation head before this report: `5fb1356febad22c0bf7aa21d052de5f3dde1fde7`

## Roadmap reconciliation

Canonical Level-1 owner remains:

**C2 — First Serial Coding Loop**

Required canonical result remains:

`repo checkout → isolated edit → real build/test → verified artifact`

This audit is the final non-live hardening pass before assembling the Windows installer that will be used for LIVE development.

It does not execute a provider/Agent effect and does not claim canonical C2 completion.

## Audit objective

The previous stack had individually qualified components:

- installed useful-work restart continuity;
- LIVE launch readiness capsule;
- independent signed evidence consumer;
- Supervisor trust-root lifecycle.

The control question was stricter:

> Can these pieces be composed into one LIVE-development verification path without a caller being able to self-assert production trust, bypass trust-root lifecycle, retroactively trust an old signature, or reuse an installer identity built from an older source head?

The answer before this audit was **not yet**.

## Critical finding 1 — stale installer/source identity

The latest physically qualified Windows package version inherited by the stack was:

`0.7.0-dev.37399755569.1`

That installer was qualified on source:

`eee637fcba41906dc21e8d2dc44d214257fabae5`

The current trust/readiness stack is newer.

Reusing that package identity for the final LIVE-development source would violate the repository's immutable source ↔ package-version reservation model.

Decision:

- do not reuse the old installer;
- reserve a new package version only after the integrated pre-live audit is green;
- run the full Windows package/installed-process fan-out on the new exact source head.

## Critical finding 2 — raw material could overclaim production bootstrap

The earlier trust-root API accepted a caller boolean plus:

- public ROOT key;
- expected SPKI digest.

That proves cryptographic equality of supplied material.

It does **not** prove the governance provenance of the digest.

Therefore code had too much semantic authority when it could emit:

`production_bootstrap_proven=true`

Repair:

- trust-root schema advanced to v2;
- raw verifier supports only:
  - `CONTROLLED_TEST_VECTOR`;
  - `LIVE_DEVELOPMENT_PIN`;
- no raw input mode can claim production bootstrap;
- `production_bootstrap_proven` is always false in this code path;
- production governance becomes an external fact, not a caller-controlled boolean.

## Critical finding 3 — evidence verifier could be called with an arbitrary raw key map

The evidence consumer and trust-root resolver were separately correct, but a caller could theoretically bypass the resolver and directly provide a public key map to the evidence verifier.

Repair:

- the exported low-level `verifyClientC5LiveEvidence()` is permanently controlled/test-only;
- caller-supplied legacy labels such as `PINNED_SUPERVISOR` cannot escalate it;
- LIVE-development verification uses a separate entrypoint:
  `verifyClientC5LiveDevelopmentEvidence()`;
- that entrypoint itself re-verifies:
  1. generation-1 bootstrap root;
  2. external SPKI pin equality;
  3. old-root threshold;
  4. new-root threshold;
  5. exact candidate generation/lineage;
  6. exact Supervisor key id;
  7. Supervisor key state;
  8. evidence timestamp/cryptoperiod;
  9. signed evidence envelope;
  10. complete useful-work digest chain.

No separately supplied JSON “trust receipt” is trusted as authority input.

## Critical finding 4 — revocation timestamp was not enough for compromise

The previous model used the administrative `revoked_at` timestamp as the historical cutoff.

For a compromised private key, compromise can predate the time administrators record revocation.

Repair:

REVOKED keys now require:

- `invalid_since`;
- `revoked_at`;
- `invalid_since <= revoked_at`.

Evidence signed at or after `invalid_since` is rejected.

This follows NIST SP 800-57's security principle that a compromised key's cryptoperiod is no longer valid.

Reference:

https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-57pt1r5.pdf

## Critical finding 5 — retroactive trust introduction

A key could previously have a `valid_from` earlier than the root manifest generation that first introduces that key.

That could allow current metadata to retrospectively authenticate evidence created before the trust root existed.

Repair:

Supervisor evidence must satisfy both:

- evidence time is inside the key cryptoperiod;
- evidence time is not earlier than the trust-root manifest `issued_at` that introduces the key.

Failure state:

`SUPERVISOR_READBACK_EVIDENCE_PREDATES_TRUST_ROOT`

## Critical finding 6 — LIVE development and production were conflated

The project needs a real LIVE Agent loop for development before it has production governance.

Repair:

A separate trust context now exists:

`LIVE_DEVELOPMENT_TRUST`

Successful integrated verification returns:

`LIVE_DEVELOPMENT_EVIDENCE_VERIFIED`

but always:

- `production_trust_root_verified=false`;
- `canonical_c2_promotion_authorized=false`;
- `release_authority=false`;
- `authority_effect=false`.

This permits real LIVE-development evidence without relabelling it as production or canonical completion.

## Trust-root v2

Schema:

`metaengine.client-v1.c5-supervisor-trust-root.v2`

Important invariants:

- monotonic generation;
- exact N+1 transition;
- previous manifest digest;
- expiry;
- ROOT/SUPERVISOR_READBACK role separation;
- Ed25519/EdDSA;
- root threshold;
- old + new root threshold on rotation;
- ACTIVE/RETIRED/REVOKED lifecycle;
- `invalid_since` for revoked/compromised keys;
- evidence may not predate the root generation that introduces the key;
- no private-key fields;
- no network/provider authority;
- no production bootstrap claim.

## Integrated evidence verifier

The positive LIVE-development path is now:

`exact readiness capsule`
→ `exact dispatch authorization`
→ `exact Client submission`
→ `exact completed execution proof`
→ `exact useful-work proof`
→ `real artifact bytes rehashed`
→ `provenance rehashed`
→ `artifact-verification receipt rehashed`
→ `independent review rehashed`
→ `generation-1 root pin verified`
→ `root rotation verified`
→ `active Supervisor key resolved`
→ `Supervisor Ed25519 envelope verified`
→ `LIVE_DEVELOPMENT_EVIDENCE_VERIFIED`

The verifier requires no provider credentials and performs no network effect.

## Controlled integrated qualification

First audit attempt:

`37413579490`

Result:

**FAILED AS DESIGNED**

The new “evidence predates trust root” invariant exposed one stale test expectation.

No artifact/package identity was reserved.

The test was corrected to independently test:

- key cryptoperiod boundary;
- trust-root introduction-time boundary.

Second exact-head audit:

`37413639425`

Head:

`5fb1356febad22c0bf7aa21d052de5f3dde1fde7`

Producer job:

`112107358736` — **SUCCESS**

Independent consumer job:

`112107426983` — **SUCCESS**

Critical suite:

- tests: **50**
- pass: **50**
- fail: **0**
- skipped: **0**

## Two-VM composition proof

The producer created:

1. exact-head readiness capsule;
2. controlled signed useful-work evidence;
3. trust-root chain whose candidate Supervisor key is the exact evidence signer;
4. separately delivered controlled pin artifact.

The second GitHub-hosted job independently downloaded those artifacts and re-ran the complete integrated verifier.

This is a controlled simulation of the LIVE-development trust topology.

It is not production governance and not a provider/Agent execution.

## Exact controlled artifacts

Pre-live material artifact:

- id: `11390521038`
- digest: `sha256:475fbb9f19a97fef5ec6791870f620da3d8f0849bbecb972e2dc91d288532f67`

Controlled pin artifact:

- id: `11389649983`
- digest: `sha256:9268fa41054bd12a45618b6279b4fe27f00f4e38d66c0d67cc570cc366c9cba6`

Independent verification artifact:

- id: `11390610922`
- digest: `sha256:a66512525e16651dfbfe4c739905e0c4c42c6bf7c9adcc0ff4b0403a66da72cb`

Independent receipt file SHA-256:

`688b07f8399114c2014e990b4274b031600cf07311b8776ecd8caca868039889`

## Integrated receipt

State:

`LIVE_DEVELOPMENT_EVIDENCE_VERIFIED`

Reason:

`EXACT_SIGNED_LIVE_DEVELOPMENT_EVIDENCE`

Verified:

- signed Supervisor readback = true;
- trusted Supervisor key = true;
- live-development trust = true;
- exact capsule binding = true;
- exact dispatch binding = true;
- exact submission binding = true;
- exact execution binding = true;
- exact useful-work binding = true;
- artifact subject = true;
- provenance = true;
- artifact-verification receipt = true;
- independent review = true.

Explicitly false:

- production trust root verified;
- canonical C2 promotion authorized;
- scheduler authority;
- Browser authority;
- release authority;
- authority effect.

## Production shortcut negative canary

The independent VM deliberately invokes:

`PINNED_PRODUCTION`

against the same material.

The CLI rejects immediately:

`client_c5_live_trust_root_kind_invalid`

There is no production shortcut in the verifier surface.

## GitHub environment research

GitHub documents that a job referencing an environment waits until configured protection rules pass, and environment secrets are unavailable until those rules pass.

Required reviewers can be configured and self-review can be disabled.

This repository is public, so the documented public-repository protection model applies.

References:

https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments

https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments

https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments

Current repository environment configuration still cannot be read through the connected GitHub tool.

Therefore:

`client-v1-c5-live environment protection = NOT_PROVEN`

## Root-rotation research

TUF root metadata defines trusted keys and signature thresholds.

The project applies a deliberately narrower C5-specific form:

- versioned root metadata;
- expiry;
- old trust threshold;
- new trust threshold;
- exact N+1 lineage;
- rollback rejection.

Reference:

https://theupdateframework.io/docs/metadata/

## NIST key-lifecycle research

NIST SP 800-57 Rev. 5 defines a cryptoperiod as the period a key is authorized for use and states that, if a key is compromised, its cryptoperiod is no longer valid.

It also requires revocation/de-registration handling for compromised signing keys.

References:

https://csrc.nist.gov/Projects/key-management/key-management-guidelines

https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-57pt1r5.pdf

This directly motivates the v2 `invalid_since` field.

## Windows candidate rule

The old package:

`0.7.0-dev.37399755569.1`

must not be reused.

After this report-containing branch is requalified, a new immutable package version will be reserved and the physical Windows fan-out will be run against that exact source.

Required physical gates include:

- NSIS build;
- installer install;
- installed executable launch;
- installed-process Client journal/restart continuity;
- Browser runtime activation;
- autonomous soak;
- shell-first dirty-profile qualification;
- self-update E2E;
- package/build identity and attestation checks.

## Remaining external LIVE boundary

Code-side PRE-LIVE trust composition is now evidence-ready.

Still external/not proven:

1. actual `client-v1-c5-live` environment protection;
2. actual environment required reviewer policy;
3. actual prevent-self-review setting;
4. actual environment-scoped live credentials;
5. actual externally governed LIVE-development bootstrap ROOT/SPKI pin;
6. actual provider/Agent useful-work execution.

No code in this checkpoint may silently convert those unknowns into true.

## Checkpoint

Critical trust defects found:

**7**

Critical trust defects repaired:

**7**

Integrated adversarial tests:

**50/50 PASS**

Integrated two-VM pre-live verification:

**SUCCESS**

Production shortcut:

**ABSENT**

Production trust root:

**NOT_PROVEN**

GitHub LIVE environment protection:

**NOT_PROVEN**

Provider contacted:

**false**

Goal submitted:

**false**

Client C5 real LIVE useful work:

**NOT_PROVEN**

Canonical C2:

**NOT_PROVEN**

Canonical promotion authority:

**false**

Physical correction discovered after initial reservation:

- predecessor source `ca98e9475102d8e0f4a16f8134fec8e2f85f3a38` / package `0.7.0-dev.37415000001.1` passed Package Smoke and the major installed consumers, but Self Update E2E run `37414725143` failed at `baseline_version_probe_exit_code_unavailable`;
- qualified installer digest before failure: `sha256:d3d0847e2623b0025330c6c36f80ede0fa9f849cb5bc76ab3cd0d3b197e8a433`;
- the failing boundary was the Windows PowerShell process-exit observer, not package provenance or installer bytes;
- direct `System.Diagnostics.ProcessStartInfo` capture now replaces the unstable short-probe `Start-Process` path while preserving timeout and non-zero-exit rejection;
- `0.7.0-dev.37415000001.1` is consumed and immutable; final successor reservation is `0.7.0-dev.37416000001.1`.

Next release action:

**physically qualify exact successor `0.7.0-dev.37416000001.1` on all Windows gates; no further source mutation is allowed without another fresh package identity**
