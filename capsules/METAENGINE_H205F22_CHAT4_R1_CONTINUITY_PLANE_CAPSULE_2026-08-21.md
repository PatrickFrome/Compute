# METAENGINE H205F22 — CHAT-4 R1 CONTINUITY CAPSULE

Capsule type: implementation handoff / continuity checkpoint  
Milestone: `R1_CONTINUITY_PLANE_ADOPTION`  
Role: Implementation Chat 4  
Repository: `PatrickFrome/Compute`  
Branch: `work/r1-continuity-plane`  
Issue: `#4`  
Created: `2026-08-21T08:17:00+03:00`  
Implementation commit: `6f42791357e365339b522ad2712a68a216af54ef`  
Implementation state: `EVIDENCE_READY`  
Production R2: `NOT_PROVEN`  
Production R3: `BLOCKED_BY_R2`  
Real production persisted readbacks at handoff: `0`

## Truth boundary

R1 adopted the recovered H41–H49 continuity invariants into H205F22, but schema/control-plane readiness is not durability proof. Configuration or upload is not persisted-readback proof. Synthetic tests do not count as R2 evidence. Integrity verification alone is not restore success. R3 MUST remain blocked until R2 is materially proven. CHAT-4 does not own supervisor/mainline seal authority.

## Adopted contracts

- **H41 audit/repair:** append-only observations; invalid `VERIFIED` evidence normalizes fail-closed to `MISMATCH`, `MISSING`, `STALE`, or `ERROR`; repair is separate evidence and never erases the bad mirror.
- **H43 restore quorum:** append-only restore receipts; `PASS` requires readback plus expected content hash; R3 cannot evaluate true while R2 is false.
- **H44 independent durability:** R2 requires at least 2 verified domains, 2 distinct failure domains, and 2 distinct operator classes; independence is explicit evidence, never inferred from names.
- **H45 retention/GC:** append-only acquire/release retention events; malformed releases rejected; active retention, unknown subject, or sealed graph reference blocks GC admission; no destructive delete executor added.
- **H46 recovery graph:** immutable graph nodes; deterministic root over sorted `TYPE<TAB>KEY<TAB>NODE_SHA256`; no mutation after sealing.
- **H47C persisted-readback-first seal:** seal rejected until current independent two-domain verified persisted readback quorum exists; local/control-plane state, repository configuration, or upload success is insufficient.
- **H48 append-only checkpoints:** dedicated continuity checkpoint ledger rejects update/delete and is separate from supervisor mainline checkpoint authority.
- **H49 bad mirror + replacement:** original bad observation remains immutable; repair links it to a distinct verified replacement readback.

## Registered migrations

1. `20260821044158_r1_continuity_plane_adoption`
2. `20260821044429_r1_continuity_schema_contract`
3. `20260821044510_r1_continuity_semantic_guards`
4. `20260821044527_r1_continuity_trigger_contract`
5. `20260821044545_r1_continuity_acl_contract`

Repository artifacts:

- `supabase/migrations/20260821044158_r1_continuity_plane_adoption.sql`
- `supabase/migrations/20260821044429_r1_continuity_schema_contract.sql`
- `supabase/migrations/20260821044510_r1_continuity_semantic_guards.sql`
- `supabase/migrations/20260821044527_r1_continuity_trigger_contract.sql`
- `supabase/migrations/20260821044545_r1_continuity_acl_contract.sql`
- `supabase/tests/r1_continuity_plane_adoption.sql`
- `evidence/R1_CONTINUITY_PLANE_ADOPTION.md`

## Test state

Semantic/negative tests: `PASS` in `SYNTHETIC_ROLLBACK_ONLY` mode.

Covered: wrong hash -> `MISMATCH`; missing hash -> `MISSING`; no persisted readback -> `ERROR`; stale readback excluded from R2; premature H47C seal rejected; bad mirror immutable after repair; wrong restored hash -> `FAIL`; malformed retention release rejected; active retention and unknown object block GC; recovery graph cannot mutate after seal; checkpoint ledger cannot update/delete; R3 blocked while R2 is false.

All synthetic operational rows were rolled back. They do not manufacture durability evidence.

## Append-only evidence state

Known R1 evidence chain:

`r1-continuity-core-implemented-v1` -> `r1-continuity-core-tested-v1` -> `r1-continuity-core-evidence-v1` -> `r1-continuity-core-evidence-v2`

Recorded truth remains:

- `production_r2_proven = false`
- `production_r3_proven = false`
- `real_readbacks = 0`

v2 was appended rather than rewriting v1.

## GitHub state at handoff

Implementation commit: `6f42791357e365339b522ad2712a68a216af54ef` (`feat(r1): adopt H41-H49 continuity contracts`). Before this capsule commit, `work/r1-continuity-plane` was 1 commit ahead of `main`, 0 behind, with exactly seven R1 implementation artifacts. `main` was not mutated by CHAT-4.

## Advisor state

After hardening, no new R1 `RLS enabled/no policy` findings remained on the new `compute_continuity_*_h205f22` surfaces. FK coverage warnings found for R1 were addressed. Remaining fresh R1 index notices are expected `unused_index` INFO. Legacy findings outside CHAT-4 mutation scope were not changed.

## Research conclusions

Primary orchestration candidate: **pgBackRest multi-repository**, but multi-repository configuration is not two-domain proof. Each domain must independently produce persisted byte readback evidence.

Recommended R2 shape: Repo A on provider/operator A with versioning + WORM/Object Lock/compliance retention; Repo B on a genuinely independent provider/operator B with independent credentials and retention; independently materialize/read back bytes from each; verify expected digest, bytes and manifest/root; append immutable per-domain observations; only then evaluate R2 and permit H47C seal.

Candidate independent storage domains include AWS S3 Object Lock Compliance, Cloudflare R2 Bucket Locks, Backblaze B2 Object Lock, Wasabi Object Lock, or a separately operated self-hosted MinIO/erasure-coded domain. Two regions in one provider/account improve availability but do not automatically establish equivalent provider/operator independence.

`pg_verifybackup` / repository integrity checks are preconditions, not substitutes for real restore drills. Sigstore Cosign + in-toto/DSSE is a strong cryptographic manifest layer, but signature verification is additional to byte/hash readback, never a replacement.

## Strict non-claims

- R1 contract plane implemented: **YES**.
- R1 semantic/negative tests pass: **YES, synthetic rollback-only**.
- R1 implementation evidence EVIDENCE_READY: **YES**.
- real independent durability proven: **NO**.
- two production persisted readbacks exist: **NO**.
- production R2 proven: **NO**.
- real restore success proven: **NO**.
- production R3 proven: **NO**.
- supervisor/mainline checkpoint sealed by CHAT-4: **NO**.

During creation of this capsule, the connected Supabase tool returned a permission error on a new read-only SQL query. Therefore this capsule itself is **not claimed as persisted/read back from Supabase**. Restore connector permissions before any DB-persistence claim.

## Administrative tail

At the end of the implementation step, roadmap-claim worker finalization and the final issue #4 evidence comment had not been completed after the implementation commit. Supervisor seal was intentionally not attempted. Before changing claim state, re-read current supervisor directives and roadmap state because another actor may have acted since this handoff.

## Next semantic target: REAL_TWO_DOMAIN_R2_PROOF

1. Re-read current semantic head, roadmap, directives and active CHAT-4 claim.
2. Verify branch head, issue #4, PR/CI state and Supabase permissions.
3. Read back the existing R1 evidence chain from the live DB after permissions are restored.
4. Select two genuinely independent durability domains.
5. Configure PostgreSQL backup/WAL archival to both domains with provider-side retention/WORM.
6. Create one real canonical backup/checkpoint manifest/root.
7. Persist to A; independently fetch/read back and verify bytes/hash/root; append observation.
8. Persist to B; independently fetch/read back and verify bytes/hash/root; append observation.
9. Prove operator/failure-domain independence from evidence.
10. Evaluate R2; only if true permit H47C persisted seal.
11. Run a real restore/readback drill from each domain.
12. Only after successful real restore evidence evaluate R3.
13. Repeat corruption/missing/stale/retention/WAL negative tests against real adapters.
14. After every semantic step: implementation -> tests -> negative tests -> deep research -> advisors -> append-only evidence -> commit.

## Resume rule

A new CHAT-4 instance must re-read authoritative state before mutation: roadmap status, current semantic head, supervisor directives, active claim, dependency state, branch SHA, issue #4, PR/CI, Supabase permissions, R1 evidence readback, and any durability observations added by another actor. If a newer authoritative state conflicts with this capsule, the newer state wins.

## Next-chat launch prompt

```text
@Supabase @GitHub
Ты — Implementation Chat 4 проекта METAENGINE H205F22 Compute Fabric.
Milestone: R1_CONTINUITY_PLANE_ADOPTION
Repository: PatrickFrome/Compute
branch: work/r1-continuity-plane
issue: #4

Сначала прочитай capsules/METAENGINE_H205F22_CHAT4_R1_CONTINUITY_PLANE_CAPSULE_2026-08-21.md и затем заново прочитай live authoritative semantic head, roadmap status, supervisor directives, active claim, GitHub head/issue/CI и Supabase evidence state.

Implementation commit: 6f42791357e365339b522ad2712a68a216af54ef
R1 contract plane = IMPLEMENTED/TESTED/EVIDENCE_READY.
At capsule creation: real production persisted readbacks = 0; R2 = NOT_PROVEN; R3 = BLOCKED_BY_R2.
Не заявляй durability по schema/config/upload. Не заявляй restore success без real restore + readback. Не заявляй R3 до доказанного R2. Persisted seal только после current independent two-domain verified readback quorum.

Следующая инженерная цель: REAL_TWO_DOMAIN_R2_PROOF, затем реальные two-domain restore drills для R3.
После каждого semantic step: implementation -> tests -> corruption/missing/stale negative tests -> deep research amplifiers -> advisors -> append-only evidence -> commit.
```

## Research pointers

- pgBackRest: `https://pgbackrest.org/user-guide.html`
- PostgreSQL pg_verifybackup: `https://www.postgresql.org/docs/current/app-pgverifybackup.html`
- Sigstore attestations: `https://docs.sigstore.dev/cosign/verifying/attestation/`
- AWS S3 Object Lock: `https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html`
- Cloudflare R2 Bucket Locks: `https://developers.cloudflare.com/r2/buckets/bucket-locks/`
- Backblaze B2 Object Lock: `https://www.backblaze.com/docs/cloud-storage-object-lock`
- Wasabi Object Lock: `https://docs.wasabi.com/docs/object-lock-overview`
- restic: `https://restic.readthedocs.io/`
- WAL-G storage backends: `https://github.com/wal-g/wal-g/blob/master/docs/STORAGES.md`
