# R1 STEP08 — deterministic final R2 evidence package

Status: PREPARE_ONLY / final evidence compilation  
Authority: evidence preservation and proposed ingestion only; no database authority

## Goal

Compile the already validated STEP05B/STEP06/STEP07 evidence chain into one deterministic, credential-free package that remains auditable after GitHub Actions artifacts expire or the originating workflow run is deleted.

STEP08 deliberately does **not** insert continuity rows, declare R2/R3, or create a persisted seal. Its output is an evidence package plus a proposed DB-ingestion projection for later Supervisor review.

## Mandatory research before implementation

### 1. Offline GitHub attestation verification requires three evidence classes

Current GitHub documentation for offline artifact-attestation verification requires importing:

- the artifact being verified;
- the attestation bundle;
- `trusted_root.jsonl`;
- GitHub CLI for the verifier.

GitHub documents `gh attestation trusted-root > trusted_root.jsonl` and recommends generating a fresh trusted-root snapshot when importing new signed material into an offline environment. Trusted-root material has no built-in expiration date, but an old snapshot cannot tell an offline verifier about later revocation and can stop verifying signatures after Sigstore key rotation.

Source:
- https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline

### 2. Attestation generation without policy verification is not authority

GitHub explicitly states that generating attestations alone does not provide the security benefit; consumers must verify them and apply policy criteria.

STEP08 therefore preserves the bundle/root and the already produced STEP07 verification receipt, but the pure compiler does not claim that simply embedding those bytes performs a new cryptographic verification.

The package records:

- `cryptographic_reverification_performed_by_step08_compiler=false`;
- `offline_reverification_required_before_authority=true`.

Source:
- https://docs.github.com/en/actions/concepts/security/artifact-attestations

### 3. GitHub Actions artifacts are transport, not a continuity domain

GitHub documents that deleting a workflow run deletes all artifacts associated with that run. Artifact retention is also finite/configurable.

Therefore STEP08 must preserve the small evidence files that are required for later audit instead of depending on the source/provider Actions runs remaining available.

Source:
- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/remove-workflow-artifacts

### 4. The ciphertext is intentionally not copied into the evidence package

The R1 ciphertext may be large and is already the actual continuity object stored as identical bytes in two independent, version-pinned provider domains.

STEP08 is an evidence package, not a third backup domain. It therefore records the exact ciphertext SHA-256/size and the two provider results/locators, but sets:

- `ciphertext.included_in_package=false`;
- `materialize_from_version_pinned_provider_locator_for_offline_reverification=true`.

For a future offline Sigstore re-verification, the exact ciphertext must first be materialized from one of the recorded version-pinned provider objects and its SHA-256/size rechecked.

### 5. Current production DB R2 authority remains unchanged

The live H205F22 continuity state machine currently has:

- 0 continuity domains;
- 0 continuity objects;
- 0 continuity observations;
- 0 persisted seals.

`compute_continuity_readiness_h205f22()` considers only the latest observation per domain and treats a VERIFIED observation as current only while `readback_at >= effective_at - interval '7 days'`. R2 requires at least two VERIFIED domains, at least two failure domains and at least two operator classes.

`compute_continuity_observation_insert_guard_h205f22()` independently checks persisted/readback timestamps, SHA-256 and expected byte count. `compute_continuity_persisted_seal_insert_guard_h205f22()` reruns readiness with the seven-day window and rejects the seal unless real current R2 is proven.

STEP08 therefore cannot create authority by JSON claim.

### 6. DB projection must preserve original provider times

The package emits proposed rows matching the existing tables:

- one `compute_continuity_object_h205f22` identity;
- two exact-match-or-insert `compute_continuity_domain_h205f22` rows;
- two `compute_continuity_observation_h205f22` inserts.

`persisted_at` is the provider object's observed `LastModified` time and `readback_at` is the original materialized-readback time. Package creation never substitutes its own current time.

The projection records the latest effective time at which both current readbacks could still satisfy the existing seven-day freshness rule. If evidence is stale by ingestion time, a new materialized provider readback is required; STEP08 cannot refresh it.

### 7. Existing validators remain the semantic source of truth

The STEP08 compiler reuses rather than duplicates the existing contracts:

- STEP05B `validate_persisted_provider_controller_evidence()` for nested PUT/HEAD/retention/GET evidence;
- STEP06 `validate_provider_result()` and `evaluate_results()` for provider/readback/quorum semantics;
- STEP07B readiness/approval/predicate binding validators;
- STEP07 source-bound `bind_candidate()` reconstruction.

The provided orchestration result and source-bound candidate must exactly equal the values reconstructed from their lower-level evidence.

## Initial implementation contract

`controller/r1/final_r2_evidence_package.py`:

- credential-free and network-free;
- accepts source readiness, approval, predicate, attestation bundle, trusted root, source verification, handoff, envelope receipt, orchestration preflight, provider readiness receipts, both STEP05B provider results, orchestration result and source-bound candidate;
- revalidates/reconstructs the chain;
- builds deterministic USTAR with normalized uid/gid/mode/mtime and sorted entries;
- preserves the original small evidence bytes;
- omits the ciphertext bytes;
- emits a canonical manifest and package receipt;
- emits proposed DB projection only;
- always keeps `canonical=false`, `authority_effect=false`, `r2_proven=false`, `r3_proven=false`, `persisted_seal_allowed=false`.

## Adversarial requirements

Tests must prove:

- package bytes are deterministic across repeated builds;
- ciphertext bytes are absent;
- trusted root + attestation bundle + provider results are present;
- original readback timestamps are preserved exactly;
- the seven-day freshness window is derived from those original timestamps;
- recomputed-hash provider retention/version tampering is rejected by STEP05B semantics;
- source readiness/predicate/handoff binding tamper fails closed;
- recomputing the source-bound candidate hash cannot promote R2;
- malformed JSONL root/bundle material is rejected;
- a valid two-domain quorum still produces only a non-authoritative package/projection.

## Strict nonclaims

- PR CI performs no GitHub attestation network verification;
- PR CI performs no AWS/B2 call;
- no provider object/readback is created;
- no ciphertext is uploaded into the evidence package;
- no Supabase continuity row is inserted;
- no R2/R3 proof or persisted seal is created;
- no worker claim state is mutated.

## Mandatory research after implementation before merge

After the first independent CI run, re-check and record:

1. whether `trusted_root.jsonl` freshness/revocation semantics require a package-generation timestamp or stronger freshness claim;
2. whether omitting ciphertext still leaves enough information to perform future offline attestation verification after materializing exact provider bytes;
3. whether the DB projection matches all current table columns/insert guards without smuggling authority into `evidence` JSON;
4. whether the projected seven-day window is correctly conservative for two independently timed readbacks;
5. whether USTAR normalization and raw-evidence preservation create any reproducibility or pathname/size issue;
6. whether provider readiness receipts need to remain in the final package after provider results exist;
7. whether STEP08 should remain a pure compiler or gain a separate future Supervisor ingestion step.

Merge is forbidden until research-after is appended here and STEP08 CI + relevant regressions + Compute Fabric Governance succeed again on the exact final head.
