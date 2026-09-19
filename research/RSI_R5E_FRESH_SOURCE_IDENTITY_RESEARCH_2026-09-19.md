# RSI R5E — fresh source-identity convergence research-after

Date: 2026-09-19  
Parent: PR #885 / `b2556e281e633da5c6ccc3861e93a7ec957ca682`  
Branch: `work/metaengine-rsi-source-identity-freshness-v1-gpt`  
PR: #890  
Authority: source-only; no Browser, DB-authority, runtime-update, promotion or self-update effect.

## Why R5D needed one more fence

R5D correctly established that GitHub source, durable roadmap authority and installed/runtime target must have exact SHA equality. The remaining replay problem is temporal: an old three-way equality observation can remain byte-valid after one of those planes changes.

R5E therefore does not create another authority plane. It composes R5D evidence with a deterministic freshness certificate and freezes its timing policy outside candidate control.

## Adopt now

### SLSA Source v1.2 — immutable revision is not a moving named reference

SLSA distinguishes a cryptographically identified Source Revision from a Named Reference such as `main`. It also requires contemporaneous source provenance for stronger source levels and says claimed controls on consumable revisions must actually be enforced by the source control system.

METAENGINE consequence:
- exact Git SHA remains the identity;
- `main` is re-read, not treated as identity;
- read time belongs in the evidence envelope;
- branch/version-name equivalence remains forbidden.

Primary source:
https://slsa.dev/spec/v1.2/source-requirements

### Uptane/TUF model — freshness is a security property, not telemetry

Uptane explicitly uses expiration/current-time checks to limit freeze attacks, and monotonic metadata versions to stop rollback. The transferable invariant is that authentic old metadata is still unsafe when replayed as current.

METAENGINE consequence:
- fresh readback age is bounded;
- future clock observations fail closed beyond small skew;
- cross-plane observations must be temporally close enough to describe one coherent state;
- freshness thresholds are trust-root constants, never candidate-selected.

Primary sources:
https://uptane.org/docs/2.1.0/deployment/best-practices
https://uptane.org/docs/1.0.0/standard/uptane-standard

### Sigstore — verifiability includes trusted time evidence

Sigstore bundles carry verification material, transparency-log entries and signed/RFC3161 timestamps so a verifier can establish when signing occurred relative to certificate validity.

METAENGINE consequence:
R5E remains a non-authoritative structural freshness gate today, but the later external promotion consumer should prefer timestamped cryptographic readbacks/attestations over self-declared wall-clock fields.

Primary source:
https://docs.sigstore.dev/about/bundle/

### in-toto — owner-defined steps and authorized functionaries

in-toto validates supply-chain steps against an owner-signed layout, authorized functionaries and signed link metadata. Layout expiration is also part of verification.

METAENGINE consequence:
typed readback origin is explicit: GitHub main-ref readback, Supabase roadmap-authority row and durable runtime-state row are distinct evidence kinds. A generic digest with a boolean called `external` is not enough to explain provenance.

Primary source:
https://in-toto.io/docs/getting-started/

### SEA — frozen external admission around self-modification

Self-Evolving Agents with Anytime-Valid Certificates isolates self-modification behind a versioned harness and external auditable admission certificates.

METAENGINE consequence:
R5E can block external admission review, but cannot grant promotion. The learner cannot choose timing windows or author its own admissible freshness certificate.

Primary source:
https://arxiv.org/abs/2607.00871

### Harness tampering — stale/replayed evidence belongs to the verifier attack surface

Auditing Harness Tampering shows that authorization, provenance and completeness failures can create illusory self-improvement gains and survive selection.

METAENGINE consequence:
freshness policy is an immutable trust-root snapshot and needs negative tests for stale, future, mismatched and cross-window readbacks.

Primary source:
https://arxiv.org/abs/2609.00069

## Implemented policy

`metaengine.rsi.source-identity-freshness.v1` consumes the exact parent R5D evidence and requires:

- typed GitHub readback from `PatrickFrome/Compute` and the exact bound ref;
- typed Supabase roadmap authority readback from project `xpeibufgzjknrhbhpffp`;
- typed durable runtime-state readback with exact client and process incarnation;
- exact inherited readback digests;
- max readback age = 60 s;
- max cross-plane span = 30 s;
- max future skew = 5 s;
- runtime heartbeat fresh at the runtime read;
- candidate-authored certificate forbidden;
- every authority/effect flag false.

The verifier reconstructs the canonical certificate from the embedded verified R5D evidence and typed readbacks rather than trusting derived state or a self-hash alone.

## Current live reality

The current planes are intentionally *not* synchronized by this slice:

- GitHub `main`: `85767548ad3d71b29881c7872017050d0dbf6d56`;
- DB roadmap authority baseline: `b69f6629ddc696daf19c122f8c0a3e7a9be44f63`, alignment epoch 87;
- live Browser startup-recovery target: `1abb958f5833e40433a0044aa3fc2ee5bd8bc7ba`, version `0.7.0-dev.35447978700.1`.

That is real three-way drift. R5E therefore cannot produce a promotable certificate from the current live state, which is the correct outcome.

## Deferred

- automatic DB baseline rewrite;
- automatic Browser update;
- ancestry/semantic/version equivalence;
- candidate-selected freshness budgets;
- treating a durable DB projection as cryptographic proof from the runtime;
- promotion directly from R5E.

A later promotion gate should bind this structural certificate to existing GitHub/Sigstore external attestation evidence and independently re-read live release/runtime state at the effect boundary.
