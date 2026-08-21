# R1 STEP02 — Two-Domain Materialized Readback Preparation

Date: 2026-08-21  
Milestone: `R1_CONTINUITY_PLANE_ADOPTION`  
Mode: `PREPARE_ONLY / NON-AUTHORITATIVE`  
Semantic head reviewed: `metaengine-h205f22-recovery-dev-20260821-cp072`

## Goal

Turn the next R1 target, `REAL_TWO_DOMAIN_R2_PROOF`, into an executable evidence contract before any provider credentials or production durability claims are introduced.

This step deliberately does **not** create storage, upload backup bytes, write continuity observations to Supabase, create an H47C persisted seal, or claim R2/R3.

## Research result

### 1. pgBackRest is the preferred PostgreSQL-native orchestrator

Current pgBackRest documentation is at 2.59.1 and demonstrates multiple repositories, including S3-backed repositories. The backup command targets a selected repository with `--repo`; archive/WAL behavior is repository-aware. The current `verify` command validates whether backups and archives in a repository are valid, and `verify --set=<backup-label>` verifies all database and archive files associated with the specified backup set.

Implication for H205F22:

- use one exact pgBackRest backup label as the cross-domain object identity;
- run repository verification independently against each durability domain;
- record repository verification as supporting evidence, not as the sole R2 proof;
- materialize a canonical backup manifest/marker (or other explicitly bound canonical byte object) from each repository and locally hash those bytes;
- later, for R3, perform a real restore from each repository. Repository `verify` is not a restore-success substitute.

### 2. Cross-provider content proof must not trust ETag

Amazon S3 explicitly states that ETag may or may not be an MD5 digest. SSE-KMS/SSE-C objects and multipart objects do not have a whole-object MD5 ETag. Cloudflare R2 multipart ETags similarly derive from the MD5 values of the parts and include the part count.

Therefore H205F22 canonical content proof is:

`independently materialized bytes -> local streaming SHA-256 + exact byte count`

Provider ETag/version/checksum metadata is retained for object/version identity and additional diagnostics only. It does not replace the local SHA-256 readback proof.

### 3. Retention strength must be explicit rather than boolean

#### AWS S3 Object Lock

S3 Object Lock requires versioning. In `COMPLIANCE` mode an object version cannot be overwritten or deleted by users including account root; retention mode cannot be changed and the retention period cannot be shortened. `GOVERNANCE` can be bypassed by principals with `s3:BypassGovernanceRetention`.

H205F22 grades:

- `COMPLIANCE_NON_SHORTENABLE` -> strong immutability.
- `GOVERNANCE_BYPASSABLE` -> active protection but weaker authority boundary.

#### Backblaze B2 Object Lock

B2 supports governance and compliance retention. Backblaze documents that compliance retention cannot be removed by any user and the retention date may be extended but not shortened.

H205F22 grades:

- `COMPLIANCE_NON_SHORTENABLE` -> strong immutability.
- `GOVERNANCE_BYPASSABLE` -> weaker protection.

#### Cloudflare R2 Bucket Locks

R2 Bucket Locks block deletion/overwrite for an age, date, or indefinitely, and they override lifecycle deletion. However, Cloudflare also documents a direct dashboard/Wrangler/API mechanism to remove bucket lock rules.

H205F22 grade:

- `ADMIN_REVOCABLE_BUCKET_RULE` -> valid active retention evidence, but explicitly not equivalent to non-shortenable compliance retention.

This distinction avoids silently treating all provider locks as the same durability class.

## Recommended domain pairs

### Preferred strong pair

**AWS S3 Object Lock COMPLIANCE + Backblaze B2 Object Lock COMPLIANCE**

Why:

- different providers/operators;
- separate account/credential planes;
- both support non-shortenable compliance retention;
- S3-compatible tooling makes the adapter surface similar while maintaining provider independence.

This is the preferred initial target for a strong two-domain R2 proof.

### Operationally convenient secondary pair

**AWS S3 Object Lock COMPLIANCE + Cloudflare R2 Bucket Lock**

Advantages:

- different provider/operator planes;
- R2 is S3-compatible and already relevant to the wider Compute Fabric environment;
- simple independent GET/readback path.

Caveat:

- R2 retention is administratively removable, so quorum evidence must carry a retention-strength warning. The pair can still demonstrate two independent current persisted readbacks if the live DB definition admits it, but it must not be represented as two strong compliance-WORM domains.

## Receipt contract implemented in this step

`controller/r1/materialized_readback_verifier.py` is intentionally offline and credential-free.

Input:

1. bytes already materialized by an independent provider controller;
2. descriptor binding:
   - subject kind/id;
   - expected SHA-256 and exact bytes;
   - domain/provider/operator/failure-domain identity;
   - account-scope digest rather than raw account credentials;
   - provider object key/version/ETag/content length/last-modified;
   - provider retention observation;
   - controller evidence digest and readback time.

Verification:

- stream and hash materialized bytes locally with SHA-256;
- exact expected-byte comparison;
- exact provider content-length comparison;
- provider-specific retention classification;
- known provider/operator binding validation;
- deterministic self-hashed receipt.

Output remains:

- `MATERIALIZED_READBACK_RECEIPT_CANDIDATE`;
- `canonical=false`;
- `authority_effect=false`;
- `r2_proven=false`;
- `r3_proven=false`;
- `persisted_seal_allowed=false`.

The two-domain evaluator also remains non-authoritative. It only reports whether receipt candidates have:

- one identical object identity;
- at least two domain keys;
- at least two operator classes;
- at least two failure domains;
- valid self-hashes;
- independently verified materialized bytes;
- active retention.

Only a later supervisor/provider-evidence validation plus DB ingestion can cause `compute_continuity_readiness_h205f22()` to evaluate real production R2.

## Required real execution sequence

1. Produce one canonical pgBackRest backup set / manifest identity.
2. Persist the exact backup set into provider A and provider B.
3. Capture provider-side object/version and retention metadata independently.
4. Run `pgbackrest verify --repo=<A> --set=<label>`.
5. Materialize the canonical bound bytes from provider A and locally SHA-256 them.
6. Repeat verify + independent materialized readback from provider B.
7. Create two non-authoritative readback receipt candidates.
8. Independently review provider/account/failure-domain evidence.
9. Only then ingest observations into the append-only continuity DB surfaces.
10. Evaluate `compute_continuity_readiness_h205f22()`; only the DB may report `R2_PROVEN`.
11. If R2 is proven, H47C persisted seal may be attempted through its existing fail-closed guard.
12. Restore the same backup independently from each domain and validate restored bytes/database state.
13. Only after both real restore drills can R3 be evaluated.

## Adversarial cases required in CI

- misleading/correct-looking ETag with tampered bytes -> `MISMATCH`;
- provider content length disagrees with materialized bytes -> `MISMATCH`;
- expired retention -> not quorum eligible;
- provider/operator spoof -> reject;
- receipt modified after self-hash -> reject;
- two receipts for different object identities -> reject;
- same operator or same failure domain -> no quorum candidate;
- AWS + B2 compliance -> two strong-domain candidate, still `r2_proven=false`;
- AWS + R2 bucket lock -> candidate with explicit weak-retention warning, still `r2_proven=false`.

## Sources reviewed

- pgBackRest current user guide: https://pgbackrest.org/user-guide.html
- pgBackRest current command reference (`verify`, `--set`, multi-repo behavior): https://pgbackrest.org/command.html
- AWS S3 Object Lock: https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html
- AWS S3 Object Lock management: https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html
- AWS S3 object/ETag semantics: https://docs.aws.amazon.com/AmazonS3/latest/API/API_Object.html
- AWS S3 integrity / multipart checksum semantics: https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html
- Backblaze B2 file retention API: https://www.backblaze.com/apidocs/b2-update-file-retention
- Cloudflare R2 Bucket Locks: https://developers.cloudflare.com/r2/buckets/bucket-locks/
- Cloudflare R2 multipart ETags: https://developers.cloudflare.com/r2/objects/upload-objects/

## Strict nonclaims

- real provider storage created: **NO**
- real backup bytes persisted by this step: **NO**
- production readback observations inserted: **NO**
- production R2 proven: **NO**
- H47C persisted seal created: **NO**
- real restore drill run: **NO**
- production R3 proven: **NO**
- active R1 worker claim modified by this support-plane step: **NO**
