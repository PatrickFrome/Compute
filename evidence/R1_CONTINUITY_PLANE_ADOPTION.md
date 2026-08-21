# R1_CONTINUITY_PLANE_ADOPTION — Evidence

## Authority boundary

Base semantic head: `metaengine-h205f22-recovery-dev-20260821-cp071`.

This milestone adopts continuity **contracts** only. It does **not** claim that two independent providers already contain durable bytes. Production R2 remains `NOT_PROVEN` until two real current persisted readbacks exist. Production R3 remains blocked until R2 is proven and two real restore/readback drills pass.

## H41–H49 invariant mapping

| Historical invariant | H205F22 adoption |
|---|---|
| H41 audit/repair | Append-only observations; `VERIFIED` is normalized to `MISMATCH`, `MISSING`, or `ERROR` on bad/missing/no-readback evidence. Audit status exposes repair/readback requirement. Repair is separate evidence. |
| H43 restore quorum | Restore receipts are append-only. `PASS` requires readback + expected hash. Quorum refuses to evaluate as R3 while R2 is not proven. |
| H44 independent durability | R2 requires at least 2 verified domains, 2 distinct failure domains, and 2 distinct operator classes. Physical-region independence is an explicit claim, never inferred. |
| H45 retention / GC | Append-only lease acquire/release events. GC admission fails closed for unknown objects, active leases, or sealed recovery-graph references. No delete executor is added. |
| H46 recovery graph | Immutable graph nodes; deterministic root over sorted `TYPE<TAB>KEY<TAB>NODE_SHA256`; no node insertion after sealing. |
| H47C persisted-readback-first | Persisted seal insertion is rejected until current two-domain independent verified readback quorum exists. Local/control-plane state alone cannot seal. |
| H48 append-only checkpoints | Dedicated continuity checkpoint ledger rejects update/delete. It is deliberately separate from supervisor mainline checkpoint sealing. |
| H49 bad mirror + repair replacement | Bad observation is immutable and remains `MISMATCH`/bad state. A repair links it to a distinct verified replacement readback. |

## Negative/adversarial tests

The SQL test runs all synthetic rows in a transaction and `ROLLBACK`s them. Covered assertions:

- wrong hash submitted as `VERIFIED` -> `MISMATCH`;
- null hash submitted as `VERIFIED` -> `MISSING`;
- no persisted readback -> `ERROR`;
- stale readback does not count toward R2;
- H47C seal is rejected before two-domain readback;
- bad mirror remains immutable after repair;
- R3 is blocked while R2 is not proven;
- wrong restored hash normalizes `PASS` -> `FAIL`;
- retention lease blocks GC and malformed release is rejected;
- unknown GC subject fails closed;
- recovery graph cannot mutate after sealing;
- continuity checkpoint ledger cannot update/delete.

Production operational continuity tables were verified empty after rollback, so these tests do not fabricate durability evidence.

## Deep research amplifier matrix

Scores are architectural, not vendor guarantees. Cost notes are relative and should be re-priced at deployment time.

| Amplifier | Durability gain | Failure-domain independence | Readback verifiability | Restore speed | Cost | Ops complexity | Provider dependence | Retention | Corruption detection | Two-domain quorum suitability |
|---|---|---|---|---|---|---|---|---|---|---|
| PostgreSQL `pg_verifybackup` + test restore | High integrity screening | None by itself | Strong for manifest/data; test restore still mandatory | Medium | Low | Low | Low | External | Strong | As verifier, not a domain |
| pgBackRest multi-repository | High | High only if repos use independent operators/accounts | Strong repository/check/info surfaces; add explicit byte readback receipts | High with nearby repo | Medium | Medium | Medium | Strong | Strong | **Primary orchestration candidate** |
| WAL-G | High | Potentially high across backends | Good fetch/readback primitives | High | Medium | Medium | Medium | Medium | Good | Useful secondary; failover alone is not quorum proof |
| restic | High for archive layer | Backend-dependent | Strong content-addressed SHA-256 model and full-data checks | Medium | Medium | Medium | Low/medium | Append-only possible | Strong | Good secondary archive / manifest layer |
| AWS S3 Object Lock Compliance | Very high | One provider; separate account/region helps but is not provider independence | Strong GET/version/readback | High | Medium/high | Medium | High | **Strong WORM** | Strong with hashes | Excellent as one of two domains |
| Cloudflare R2 Bucket Locks | High | Independent provider vs AWS/DB | Strong S3-compatible readback | High | Low | Low/medium | Medium | Strong, but lock rules are administratively removable | Strong with hashes | Good independent second domain |
| Backblaze B2 Object Lock Compliance | High | Independent provider | Strong S3/native readback | High | Low | Low/medium | Medium | **Strong compliance retention** | Strong with hashes | **Excellent second domain** |
| Wasabi Object Lock Compliance | High | Independent provider | Strong S3 readback | High | Low/medium with minimums | Low/medium | Medium | **Strong compliance retention** | Strong with hashes | Excellent second domain; cost floor matters |
| MinIO / self-hosted erasure-coded WORM | High inside deployment | High only if independently operated/located | Strong | Depends on hardware | CapEx/Ops-heavy | High | Low | Strong | Strong | Good when a truly separate operator domain exists |
| Sigstore Cosign + in-toto/DSSE | Integrity/authenticity gain, not storage durability | Independent trust plane possible | Strong signed digest/attestation verification | N/A | Low | Medium | Low/medium | External | **Strong cryptographic manifest authenticity** | Bind the same object digest across both domains |

## Recommended R2/R3 implementation shape

1. pgBackRest as PostgreSQL-native backup/WAL orchestrator.
2. Repo A on one provider/account with object versioning + WORM/compliance retention.
3. Repo B on a genuinely independent provider/operator, also with retention lock.
4. Upload/backup does not count as durable by itself: materialize/read back bytes from each domain and verify hash, bytes, manifest/root, and identity.
5. Store one immutable observation per domain; only the current two-domain quorum may create H47C persisted seal.
6. Sign the canonical backup/checkpoint manifest digest using the existing H205F22 crypto trust plane or DSSE/in-toto attestation; signature verification is additional to byte/hash readback, not a substitute.
7. Export pgBackRest stable JSON `info` into observability and alert on mixed/unhealthy repository state, WAL gaps, stale readbacks, expired/near-expiry retention, and failed restore drills.
8. Run real restore drills from each independent domain. `pg_verifybackup`/repository checks are preconditions, not restore-success evidence.

## Advisor result

After R1 DDL hardening:

- new continuity tables have RLS enabled and an explicit deny policy for `anon`/`authenticated`;
- no new R1 `RLS enabled/no policy` findings remain;
- FK coverage warnings found during the first performance pass were fixed;
- remaining new-index notices are expected `unused_index` INFO on fresh empty tables; legacy advisor findings outside R1 were not mutated.

## Evidence state

- migration registry: `20260821044158_r1_continuity_plane_adoption`, `20260821044429_r1_continuity_schema_contract`, `20260821044510_r1_continuity_semantic_guards`, `20260821044527_r1_continuity_trigger_contract`, `20260821044545_r1_continuity_acl_contract`;
- semantic self-test: PASS, synthetic rollback only;
- real persisted readback receipts: 0;
- production R2: **NOT_PROVEN**;
- production R3: **BLOCKED_BY_R2**;
- worker terminal state requested: **EVIDENCE_READY**.


## Research sources

- pgBackRest multi-repository / monitoring: https://pgbackrest.org/user-guide.html
- PostgreSQL pg_verifybackup: https://www.postgresql.org/docs/current/app-pgverifybackup.html
- Sigstore in-toto/DSSE attestations: https://docs.sigstore.dev/cosign/verifying/attestation/
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare R2 Bucket Locks: https://developers.cloudflare.com/r2/buckets/bucket-locks/
- Backblaze B2 Object Lock: https://www.backblaze.com/docs/cloud-storage-object-lock
- Backblaze B2 pricing: https://www.backblaze.com/cloud-storage/pricing
- AWS S3 Object Lock: https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html
- Wasabi Object Lock: https://docs.wasabi.com/docs/object-lock-overview
- restic append-only guidance: https://restic.readthedocs.io/en/latest/060_forget.html
- restic content-addressed repository design: https://restic.readthedocs.io/en/latest/design.html
- WAL-G storage backends: https://github.com/wal-g/wal-g/blob/master/docs/STORAGES.md
