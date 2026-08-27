# R1 STEP11 — Two-Domain Materialized Readback Verifier (research + additive implementation)

Date: 2026-08-27
Milestone: R1_CONTINUITY_PLANE_ADOPTION
Spine blocker addressed: R2 — real two-domain persisted readback (acceptance gate R2)
Mode: RESEARCH + ADDITIVE IMPLEMENTATION / NON-AUTHORITATIVE
Companion module: coordination/continuity/readback-verifier.mjs
Companion test: coordination/continuity/readback-verifier.test.mjs

## Status at handoff

- R2: NOT_PROVEN
- real_readbacks: 0
- R3: BLOCKED_BY_R2

This step does NOT change those facts. It delivers an offline, fail-closed decision oracle
that, once two REAL materialized readbacks exist, can decide an R2 proof from them. Until
real provider bytes + manifests are supplied, the oracle is exercised only by synthetic unit
fixtures, which are explicitly NON-authoritative and do not create proof rows.

## 1. Problem

R2 requires TWO real, current, persisted readbacks from genuinely independent durability
domains. The current production continuity state is 0 domains / 0 objects / 0 observations /
0 persisted seals, so `real_readbacks = 0` and `R2 = NOT_PROVEN`.

The existing chain (STEP02 materialized readback contract, STEP05B provider controller
evidence, STEP06 two-domain orchestration, STEP07 trusted source, STEP08 evidence package,
STEP09A supervisor ingestion gate, STEP09B append-only DB transaction, STEP10 live
orchestration) defines HOW real readbacks are produced and how the DB derives readiness, but
it does not contain a small, pure, offline function that independently re-decides "do these
two supplied materialized readbacks actually satisfy the two-domain WORM readback contract."

That gap is what this step fills: a deterministic, credential-free, network-free oracle that
operates on already-materialized bytes + bound manifests and returns either a proof or a
fail-closed reason. It is additive and does not modify the existing SQL/Python evidence plane.

## 2. Design

### 2.1 verifyReadback(bytes, expectedHash, manifest)

Decides whether ONE materialized readback is authentic, intact, and carried by an immutable
WORM domain. Returns `{ok:true, sha256, byteLength, domainId, worm}` or `{ok:false, reason}`.
Never throws; every abnormal path returns a reason string.

Checks:

  (a) Content integrity — `SHA-256(bytes) === expectedHash` (computed locally via Node
      built-in `crypto`; provider ETag/checksum is never trusted, per STEP02). Tampered bytes
      fail here with `hash_mismatch`.
  (b) Manifest integrity — required fields present (domainId, provider, region, bucket,
      objectKey, sequence, timestamp, contentHash); sequence is a finite non-negative integer;
      timestamp is parseable, not absurdly old, not in the future beyond a small clock skew;
      manifest.contentHash equals the locally computed SHA-256 (binds the manifest to the
      bytes; `manifest_content_hash_mismatch` otherwise). Optional expectedBytes is checked
      against the real byte length (`byte_count_mismatch`).
  (c) Immutability / WORM evidence — fail-closed if any missing. Requires an explicit
      `immutable: true` domain claim AND at least one concrete WORM fact: a legal hold
      (`worm.legalHold === true`), or a retention-until that is indefinite or still in the
      future, or a recognized retention-strength `mode`. Unrecognized modes and expired
      retention are rejected.

### 2.2 evaluateR2Proof(domains)

Decides whether TWO independent durability domains together prove the R2 readback contract.
`domains` is an array of `{id, provider, region, bucket, bytes, expectedHash, manifest}`.
Returns `{ok:true, proof}` or `{ok:false, reason}`. Never throws.

Requires, fail-closed:

  - exactly two domains (matches the R1 v1 exactly-two-domain evidence contract used by
    STEP08/STEP09A/STEP09B; `not_two_domains` otherwise);
  - two DISTINCT domains: different `id`, and NOT identical `(provider, region, bucket)`
    tuple (`same_domain_id`, `not_independent_provider_region_bucket`); optional `operator`
    and `failureDomain` must also differ when both are present (`same_operator_class`,
    `same_failure_domain`) — this enforces the >=2 operator classes / >=2 failure domains
    rule from the DB readiness function without reimplementing the DB;
  - identical content hash across both readbacks (`content_hash_divergence`);
  - each `verifyReadback(...)` returns `ok` (`domain_invalid`);
  - each manifest `timestamp` within a configurable freshness window (default 7 days, matching
    the DB readiness window in STEP09B) of an injectable `clock` (`stale_readback`,
    `future_readback`);
  - WORM/immutability evidence present on each (enforced inside `verifyReadback`).

On success it returns a `proof` carrying the shared `contentHash`, `byteLength`, per-domain
identity + WORM grade, the freshness window used, the evaluation time, and a
`weakRetentionWarning` flag when either domain uses a weaker-than-compliance retention class
(e.g. R2 bucket lock). The proof does NOT assert `r2_proven` and does NOT persist anything.

## 3. Why two independent WORM domains (S3 Object Lock + B2/R2/Wasabi)

A single durability domain shares one failure plane: one account compromise, one provider
outage, one misconfiguration, one retention-bypass path. Two genuinely independent domains
remove the common failure domain:

  - different providers / operators (AWS vs Backblaze vs Cloudflare vs Wasabi, or a
    separately operated self-hosted MinIO/erasure-coded domain);
  - separate credential planes and account scopes (no shared root that can delete both);
  - each with versioning + Object Lock / compliance retention so neither readback can be
    silently overwritten or deleted before its retention expires.

Preferring S3 Object Lock COMPLIANCE + B2 Object Lock COMPLIANCE gives two
non-shortenable domains. A convenience pair (S3 COMPLIANCE + R2 Bucket Lock) is still two
independent current readbacks, but R2 bucket lock is administratively removable, so the
oracle surfaces `weakRetentionWarning` rather than treating it as two strong WORM domains.
Two regions of one provider/account improve availability but do NOT establish equivalent
provider/operator independence and are rejected by the independence fence.

## 4. Alternatives considered

  - Single domain + DB row: cheaper but shares one failure plane; a DB `VERIFIED` flag is an
    assertion, not a second independent materialized readback. Rejected as the R2 definition.
  - Hash-chain / append-only log across domains: good for ordering integrity, but does not by
    itself prove the bytes still exist and are readable NOW from two independent stores. Used
    as a supporting structure, not a substitute.
  - Witness cosigning (Sigstore/in-toto): strong cryptographic provenance (already used at
    STEP07 for source attestation), but signature verification is ADDITIONAL to byte/hash
    readback, never a replacement. The oracle consumes materialized bytes + manifests; a
    signed manifest would strengthen provenance without changing the byte/hash/WORM checks.
  - Trusting provider ETag / version checksum: explicitly rejected (STEP02) — ETag may not be
    an MD5, and SSE/SSE-KMS/multipart objects break ETag-as-hash. Local SHA-256 is authoritative.

## 5. Adversarial threat model and the fence for each

  - Tampered bytes: local SHA-256 vs expectedHash -> `hash_mismatch`. Fence: content authority
    is the bytes themselves, not provider metadata.
  - SHA-256 collision: assumed infeasible; the oracle additionally requires a well-formed
    64-hex hash and a non-trivial byte length, so a collision cannot be mounted via malformed
    short inputs.
  - Same domain replayed and presented as two: independence fence (distinct id AND not
    identical provider/region/bucket, plus operator/failureDomain when present) ->
    `same_domain_id` / `not_independent_provider_region_bucket`.
  - WORM bypass / deleted object: `immutable: true` + a live legal hold or future
    retention-until or recognized compliance mode is required; an object deleted or with
    expired/removed retention fails `no_immutable_claim` / `no_worm_evidence` /
    `worm_retention_expired`. (The oracle trusts the manifest's claimed WORM facts; binding
    those facts to a real provider readback is the job of STEP05B/STEP10 materialization, which
    must re-verify retention against the provider before admitting the manifest.)
  - Stale readback (old timestamp): freshness window vs injected clock -> `stale_readback`.
  - Clock skew: bounded by `maxFutureSkewMs` (default 5 minutes); future timestamps beyond skew
    -> `future_readback`; ancient timestamps -> `manifest_timestamp_too_old`.
  - Manifest forgery: manifest.contentHash must equal the locally computed SHA-256
    (`manifest_content_hash_mismatch`); missing/required fields -> `manifest_missing_*`. The
    oracle does not trust a manifest that disagrees with the bytes it accompanied.
  - Garbage / wrong-shaped input: every path is wrapped so the oracle returns `{ok:false,
    reason}` and never throws, including `domains_not_array`, `bad_input_bytes`,
    `bad_expected_hash`.

## 6. Integration plan with the continuity plane + Supervisor R2 ingestion gate (STEP09A)

  - The oracle is PURE and OFFLINE: it takes materialized bytes + manifests, the same inputs
    STEP10 already produces by re-reading exact provider versions. It therefore slots into the
    workflow's contract-tests / preflight stage WITHOUT touching the SQL continuity functions,
    the STEP09A Python gate, or STEP09B. No existing continuity/admission code is modified.
  - Recommended wiring (additive): before STEP08/STEP09A admission, run
    `evaluateR2Proof([domainA, domainB])` over the two freshly materialized readbacks. A
    `ok:true` result is a local contract confirmation that the two readbacks satisfy the
    two-domain WORM readback contract; it is supporting evidence only. Authority remains with
    STEP09B's DB-derived `compute_continuity_readiness_h205f22()` after a real STEP09A gate.
  - The oracle's `weakRetentionWarning` feeds the existing STEP02 distinction: a
    COMPLIANCE+COMPLIANCE pair is a strong two-domain candidate; a pair containing R2 bucket
    lock is a valid candidate that STEP09A/audit should flag as weaker retention.
  - The oracle deliberately does NOT insert continuity rows, does NOT promote canonical R2,
    does NOT create a seal, and does NOT replace the DB readiness function. It is a guard in
    front of, not a substitute for, the append-only transaction.

## 7. Open questions / future research (R3 restore drill after R2)

  - R3 requires a REAL restore from each domain and validation of restored bytes/DB state;
    `evaluateR2Proof` proves readback only, not restore success. A future `evaluateR3Proof`
    should materialize + restore + re-hash from each domain and compare restored state to the
    readback contract.
  - Online trusted-root freshness for the source attestation (STEP09A) remains an operational
    policy (15-minute window), not a cryptographic guarantee; offline R3 restore must import a
    fresh root.
  - The oracle currently assumes the manifest's WORM facts are truthful; tightening this means
    binding manifest WORM claims to a provider-signed retention observation (STEP05B) inside
    the same verification, so a forged manifest cannot assert WORM it does not have.
  - >2-domain evidence (N independent domains) should use a new versioned contract rather than
    silently broadening the exactly-two-domain v1 gate.

## 8. Explicit non-claims

  - This research/implementation is NON-AUTHORITATIVE; `authority_effect = false`.
  - No real provider storage is created, read, or mutated by this step or its tests.
  - No real backup bytes are persisted by this step.
  - The unit tests use SYNTHETIC fixtures only; they do NOT create R2 proof rows and do NOT
    mutate the continuity DB.
  - The oracle does NOT itself persist anything (no DB write, no file, no seal).
  - `real_readbacks` remains 0 and `R2` remains `NOT_PROVEN` until real provider readbacks are
    admitted through STEP09A/STEP09B.
  - R3 is not proven and the H47C seal is not created.
  - Existing continuity/admission code (SQL continuity functions, STEP09A/STEP09B, STEP10)
    is not modified; this module is additive.

## 9. Files

  - research/R1_STEP11_TWO_DOMAIN_READBACK_VERIFIER_RESEARCH.md (this document)
  - coordination/continuity/readback-verifier.mjs (additive, fail-closed, offline oracle)
  - coordination/continuity/readback-verifier.test.mjs (offline unit tests, `node --test`)