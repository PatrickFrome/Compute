# METAENGINE Client V1 C5 — Supervisor Trust-Root Checkpoint

Date: 2026-10-06  
Status: **EVIDENCE_READY — PREPARE_ONLY / CONTROLLED TRUST-ROOT VECTOR**  
Branch: `work/client-v1-c5-supervisor-trust-root-v1`  
Qualified implementation head before report commit: `ee32b3a1e921e0f04cd6feb6b0ab2a7bf51d5c75`

## Roadmap reconciliation

Canonical Level-1 owner remains **C2 — First Serial Coding Loop**.

This work does not introduce a new control-plane milestone. It removes a trust ambiguity from the first real serial coding-loop evidence path:

`live Agent result → signed Supervisor readback → trusted public-key resolution → independent useful-work verification`

Client-side state after this slice:

- C5 LIVE launch readiness: EVIDENCE_READY / PREPARE_ONLY
- C5 independent LIVE evidence consumer: EVIDENCE_READY / CONTROLLED CRYPTOGRAPHIC VECTOR
- **C5 Supervisor trust-root lifecycle: EVIDENCE_READY / CONTROLLED TRUST-ROOT VECTOR**
- production Supervisor bootstrap pin: NOT_PROVEN
- protected GitHub environment: NOT_PROVEN
- Client C5 LIVE useful work: NOT_PROVEN
- canonical C2: NOT_PROVEN
- canonical promotion authority: false

## Gap closed

The independent evidence consumer previously required a caller-supplied pinned Supervisor public key.

That is necessary but incomplete: without a lifecycle contract, key rotation, expiry, revocation and rollback behavior were implicit.

This checkpoint adds an explicit versioned trust-root policy.

## Implementation

Trust-root policy:

`coordination/client-v1/c5-live-readiness/client-c5-supervisor-trust-root.mjs`

Adversarial lifecycle tests:

`coordination/client-v1/c5-live-readiness/client-c5-supervisor-trust-root.test.mjs`

Controlled root-chain generator:

`coordination/client-v1/c5-live-readiness/client-c5-supervisor-trust-root-test-vector.mjs`

Offline resolver CLI:

`coordination/client-v1/c5-live-readiness/client-c5-supervisor-trust-root-verify.mjs`

Qualification workflow:

`.github/workflows/client-v1-c5-supervisor-trust-root.yml`

No packaged Browser runtime file is changed.

## Trust-root schema

Schema:

`metaengine.client-v1.c5-supervisor-trust-root.v1`

The manifest binds:

- semantic version;
- monotonic generation;
- issued time;
- expiry time;
- previous manifest SHA-256;
- root signature threshold;
- exact usage `CLIENT_C5_SUPERVISOR_READBACK`;
- canonical ordered key set;
- no automatic retry;
- no authority effect.

Each key binds:

- key id;
- role;
- Ed25519 / `EdDSA`;
- DER-SPKI public key bytes;
- SPKI SHA-256;
- lifecycle state;
- cryptoperiod;
- retirement time where applicable;
- revocation time where applicable.

Private-key fields are rejected by the exact schema.

## Role separation

Two key roles exist:

- `ROOT`
- `SUPERVISOR_READBACK`

ROOT keys authorize trust-root metadata transitions.

SUPERVISOR_READBACK keys verify C5 semantic evidence envelopes.

An operational Supervisor readback key therefore does not automatically become trust-root rotation authority.

## Bootstrap rule

Generation 1 requires:

- `previous_manifest_sha256=null`;
- detached root-signature envelope;
- externally supplied pinned root public key;
- exact manifest key-id/SPKI match;
- root threshold satisfaction.

Production bootstrap additionally requires an externally governed expected SPKI SHA-256 pin.

The code cannot mark production bootstrap proven from a public key alone.

## Rotation rule

A candidate root must have exactly:

`candidate.generation = current.generation + 1`

and:

`candidate.previous_manifest_sha256 = sha256(current_manifest)`

The candidate must satisfy both:

1. the **old** ROOT threshold using keys from the already trusted root;
2. the **new** ROOT threshold using keys declared by the candidate.

This mirrors the security intent of TUF root rotation: a compromised new root set alone cannot install itself, while the old root alone cannot silently install key material that the new root holders do not possess.

## Lifecycle states

Supported states:

- `ACTIVE`
- `RETIRED`
- `REVOKED`

ACTIVE keys operate only inside their declared cryptoperiod.

RETIRED Supervisor keys can verify historical evidence strictly before `retired_at`.

REVOKED Supervisor keys can verify historical evidence strictly before the recorded `revoked_at`, but are rejected at or after that time.

ROOT signatures for new metadata require ACTIVE root keys.

## Amplifier research — TUF

The Update Framework uses signed root metadata to define trusted keys and signature thresholds. Root metadata is versioned and expiring, which allows clients to reject rollback/freeze behavior.

Reference:

https://theupdateframework.io/docs/metadata/

TUF bootstrap also requires shipping an initial trusted root separately from the untrusted update stream.

Reference:

https://theupdateframework.io/docs/faq/

Applied design:

- externally pinned generation-1 root;
- monotonic generation;
- previous-root digest;
- expiry;
- signature threshold;
- old + new threshold rotation.

This is deliberately a small C5-specific subset rather than a second general package-update framework.

## Amplifier research — NIST key lifecycle

NIST SP 800-57 defines key lifecycle states and key revocation. Revocation means affected parties are told that a key must be removed from operational use before the normal end of its cryptoperiod.

References:

https://csrc.nist.gov/glossary/term/Key_states

https://csrc.nist.gov/glossary/term/Key_revocation

Applied design:

- explicit lifecycle state;
- explicit cryptoperiod;
- retirement/revocation timestamps;
- evidence-time binding;
- no current operational acceptance after retirement/revocation.

## Amplifier research — Sigstore trust root

Sigstore uses TUF-style trust-root management with offline root holders, threshold signing, key rotation, revocation and freshness protections.

References:

https://docs.sigstore.dev/about/security/

https://docs.sigstore.dev/about/threat-model/

This supports keeping C5 root keys distinct from online operational Supervisor keys.

## Adversarial tests

Exact implementation-head run:

`37411025427`

Producer job:

`112099271842` — SUCCESS

Independent consumer:

`112099317515` — SUCCESS

Trust-root tests:

- tests: **12**
- passed: **12**
- failed: **0**
- skipped: **0**

Adversarial coverage includes:

- missing bootstrap pin;
- wrong bootstrap public key;
- absent production SPKI digest pin;
- wrong production SPKI digest pin;
- old-threshold-only rotation;
- new-threshold-only rotation;
- multi-key thresholds;
- rollback generation;
- skipped generation;
- wrong previous-manifest digest;
- expired metadata;
- future metadata;
- duplicate key ids;
- non-canonical key order;
- private/unknown key fields;
- cryptoperiod violation;
- retirement boundary;
- revocation boundary.

## Controlled root vector

Artifact id:

`11388518799`

Artifact name:

`client-c5-supervisor-trust-root-ee32b3a1e921e0f04cd6feb6b0ab2a7bf51d5c75`

Artifact digest:

`sha256:613a3895e566e3835bd7f8d20f2599c0f8ad8418206b90d53d8e53cbd585ac19`

Controlled bootstrap root SPKI SHA-256:

`531e6fd52f171d6266ca6badd03e1782d9b0dfa35fcc843d07c64f1599d8e622`

Generation 1 manifest:

`sha256:479d8387dc6a7dffb80222d0287dcca24be9af15626646bf9d45db254d215234`

Generation 2 manifest:

`sha256:5dbeca5979ae2945b318c8516b337c705d89886b138f2cd0a67ebe93bce96160`

Expected resolved key:

`supervisor:test-b`

Private key persisted:

**false**

Production bootstrap proven:

**false**

## Independent resolver receipt

Artifact id:

`11389555995`

Artifact name:

`client-c5-supervisor-trust-root-resolution-ee32b3a1e921e0f04cd6feb6b0ab2a7bf51d5c75`

Artifact digest:

`sha256:cfcd7aa10c53f41b9dcb2a3c562839fa53e5a8426b82c5551ad26a580b8ec779`

Resolution receipt file SHA-256:

`2497b32781ed9b9feb5683262ee2848aaaddb3851ac15328d912c60d85d2a0e2`

Resolved public-key file SHA-256:

`964f149625563b337d65d7ff2ba4edcfc13cf8b490f8bbcbc0c67ddf78427d77`

Receipt proves:

- bootstrap generation = 1;
- candidate generation = 2;
- old root threshold verified = true;
- new root threshold verified = true;
- Supervisor key resolved = true;
- Supervisor key state = ACTIVE;
- trust-root generation = 2;
- production bootstrap proven = false;
- live effect authorized = false;
- Client C5 LIVE useful work verified = false;
- canonical C2 promotion authorized = false;
- authority effect = false.

## Production-escalation negative checks

The independent VM attempts two forbidden production bootstraps.

### Bundle-contained root key

The bundle's public root key plus its digest is passed to `PINNED_PRODUCTION`.

Result:

`client_c5_production_bootstrap_key_must_be_external_to_bundle`

### External copy without independent digest pin

The same public key is copied outside the artifact directory, but no expected externally governed SPKI SHA-256 is supplied.

Result:

`client_c5_production_bootstrap_spki_pin_required`

Therefore simple path relocation is insufficient to manufacture production trust.

## Initial failure and repair

The first qualification run:

`37410974704`

failed 2 bootstrap tests because Node 24's `crypto.createPublicKey()` was being called again on an already normalized public `KeyObject`.

The transition path was unaffected.

The fix preserves exact SPKI digest verification while accepting either:

- an already normalized public KeyObject; or
- raw key material that must be normalized.

No failed evidence was relabelled.

## No live actuation

This checkpoint performs no:

- production key installation;
- GitHub environment mutation;
- Client goal submission;
- provider/Agent request;
- Supabase mutation;
- release mutation;
- canonical promotion.

All root and Supervisor keys used by CI are ephemeral controlled vectors.

## Remaining boundary

The verifier mechanics and rotation policy are now evidence-ready.

Production still requires external facts:

1. the actual generation-1 ROOT public key;
2. its independently governed SPKI SHA-256 pin;
3. placement of that pin in a protected source independent of the evidence bundle;
4. the actual Supervisor readback key set;
5. GitHub environment `client-v1-c5-live` protections;
6. explicit single-flight LIVE dispatch authorization.

Only after those facts exist can `production_bootstrap_proven=true` become a legitimate claim.

## Checkpoint

C5 Supervisor trust-root policy:

**EVIDENCE_READY / CONTROLLED TRUST-ROOT VECTOR**

Trust-root rotation mechanics:

**PROVEN / CONTROLLED**

Production generation-1 bootstrap pin:

**NOT_PROVEN**

Production Supervisor key set:

**NOT_PROVEN**

Environment protection:

**NOT_PROVEN**

Live effect authorization:

**NOT_GRANTED**

Provider contacted:

**false**

Goal submitted:

**false**

Client C5 LIVE useful work:

**NOT_PROVEN**

Canonical C2:

**NOT_PROVEN**

Canonical promotion authority:

**false**
