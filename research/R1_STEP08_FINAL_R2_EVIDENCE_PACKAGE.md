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

### Independent CI result before research-after

The first STEP08 run failed before entering STEP08 semantics because its synthetic STEP05B HEAD response omitted the user metadata that the already-merged STEP05B validator requires. The fixture was corrected to model the real `metaengine-sha256` and `metaengine-contract` metadata written by STEP05. No production compiler behavior changed.

The next independent run on `4cb9e7a7a38a8385a97f3c8549b043634067a900` succeeded, as did Compute Fabric Governance. Those runs are pre-research-after signals only and are not the merge gate.

### 1. Trusted-root freshness must not be inferred from deterministic package metadata

Post-step GitHub documentation re-check confirms:

- `trusted_root.jsonl` has no built-in expiration;
- a root snapshot cannot tell an offline verifier whether key material was revoked after the snapshot was generated;
- GitHub recommends generating a new root when importing new signed material into an offline environment.

Therefore STEP08 must not invent a freshness claim from filesystem mtime, package mtime, or a package-generation timestamp. The compiler remains deterministic and treats the included root as portable verification material, not proof of current revocation status.

The existing manifest already states that the compiler does not perform cryptographic re-verification and that offline re-verification is required before authority. No additional timestamp is added because an unsigned compiler timestamp would not solve revocation freshness.

Operational rule for the future Supervisor verifier: if online access is available at import/ingestion time, obtain a fresh trusted root before the authority decision; if fully offline, the verifier must explicitly accept the revocation-knowledge limitation.

Source:
- https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline

### 2. Ciphertext omission is compatible with future offline verification

GitHub's offline command takes an artifact path plus `--bundle` and `--custom-trusted-root`. It does not require that the artifact bytes live in the same archive as the bundle/root.

STEP08 therefore has enough information to re-establish the artifact input later:

1. choose one recorded version-pinned provider locator;
2. materialize that exact version;
3. recompute SHA-256 and byte count and require equality with the package ciphertext identity;
4. run `gh attestation verify` against the preserved bundle/root (or a refreshed root, if online).

Keeping the large ciphertext out of the evidence tar remains correct and prevents the evidence package from being mistaken for a third continuity domain.

Source:
- https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline

### 3. DB projection matches the live insert shape without owning generated IDs

Post-step production-schema inspection confirms:

- `compute_continuity_object_h205f22.object_id` defaults to `gen_random_uuid()`;
- `compute_continuity_observation_h205f22.observation_id` is `GENERATED ALWAYS` identity backed by its sequence;
- observations require a resolved `object_id` foreign key;
- domain/object/observation rows remain append-only through immutable triggers;
- the observation insert guard independently normalizes/checks VERIFIED status against persisted/readback timestamps, expected SHA-256 and expected bytes.

The STEP08 projection therefore correctly emits an object identity selector and does not manufacture database IDs. A later Supervisor ingestion step must insert or exact-match the object, resolve its DB-generated UUID, then use that UUID for observation inserts.

The provider result is carried inside proposed observation `evidence` only as supporting audit material. `evidence` JSON cannot create R2 because readiness ignores its claim fields and derives state from the immutable structured columns.

### 4. Seven-day projection is conservative

For two independently timed readbacks, both remain simultaneously current only until the earlier readback reaches the DB's seven-day age boundary. STEP08 therefore computes:

`min(readback_at_A + 7 days, readback_at_B + 7 days)`

and preserves both original timestamps unchanged.

At ingestion, the Supervisor must compare the actual effective time to this boundary. The package never substitutes build/import time into either observation.

### 5. USTAR normalization is safe for the current package envelope

Current Python documentation states USTAR supports pathnames up to roughly 256 characters and individual files up to 8 GiB.

All STEP08 paths are static and far below the pathname limit. The compiler additionally caps ordinary JSON inputs at 4 MiB and JSONL attestation/root inputs at 16 MiB, far below the USTAR file-size ceiling. Normalized mtime/uid/gid/mode plus sorted entry order therefore preserves deterministic bytes without requiring PAX/GNU extensions.

Source:
- https://docs.python.org/3/library/tarfile.html

### 6. Provider readiness receipts remain in the package

They are not required by the DB R2 arithmetic, but they preserve a different evidence class from provider results:

- provider results prove the exact object version, COMPLIANCE retention and materialized readback;
- readiness receipts capture surrounding versioning/Object Lock/lifecycle/session-scope or B2 bucket/key-scope configuration at execution time.

Dropping readiness receipts would make later audit depend on re-querying mutable provider configuration. They therefore remain supporting, non-authoritative package entries.

### 7. Supervisor ingestion must remain a separate step

STEP08 remains a pure compiler. Combining package construction with database mutation would collapse three independent checks into one trust zone:

- offline/portable source attestation re-verification;
- provider evidence and current readback freshness validation;
- append-only DB insertion and subsequent DB-derived R2 evaluation.

The next authority-bearing work should therefore be a separate Supervisor ingestion/verifier step. It must fail closed if the package is stale, if Sigstore re-verification fails, if existing domain/object identities differ, or if any DB insert guard normalizes an observation away from VERIFIED.

## Final merge gate

After this research-after commit, all earlier CI results are stale for merge purposes. The exact final head must again pass:

- R1 Final R2 Evidence Package;
- STEP05B/STEP06/STEP07 regressions contained in that workflow;
- Compute Fabric Governance.

Strict nonclaims remain unchanged: no live provider call, no ciphertext packaging, no Supabase continuity write, no R2/R3 transition and no persisted seal.
