# R1 STEP09B — append-only Supervisor DB transaction

Status: IMPLEMENTED / PREPARE_ONLY until a real STEP09A authority receipt exists  
Authority: may derive continuity-table R2 from real inserts; does **not** promote canonical roadmap R2, create R3, or create a persisted seal

## Goal

Provide the narrow database trust zone after STEP09A. STEP09B consumes the exact STEP08 DB projection and the production STEP09A authority-gate receipt, performs append-only exact-match-or-insert continuity writes, and requires the existing database readiness/audit functions to prove the resulting two-domain readback quorum inside the same transaction.

This step deliberately separates two statements that must not be conflated:

1. `continuity_readiness.r2_proven=true` is a live database fact about the continuity object.
2. canonical roadmap R2 promotion / R1 sealing is a later Supervisor governance decision and remains false here.

## Mandatory research before implementation

### 1. Current Supabase security model favors SECURITY INVOKER + selective EXECUTE

Current Supabase function guidance recommends the default `security invoker` model unless a privileged function is genuinely required. Supabase also warns that `SECURITY DEFINER` bypasses normal caller/RLS privileges and that new PostgreSQL functions receive EXECUTE for `PUBLIC` unless privileges are explicitly revoked.

Live H205F22 inspection confirmed before STEP09B:

- PostgreSQL version: **17.6**;
- continuity domain/object/observation/seal tables have RLS enabled;
- `anon` and `authenticated` have deny-all policies;
- direct table privileges are effectively `postgres`-only;
- existing continuity functions are `SECURITY INVOKER` and postgres-only.

Therefore STEP09B uses a postgres-only `SECURITY INVOKER` function in `destruktion_meta`; it does not introduce a `SECURITY DEFINER`, service-role RPC, or Data API surface.

Sources:
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/database/postgres/roles
- https://supabase.com/docs/guides/api/securing-your-api
- https://www.postgresql.org/docs/17/sql-createfunction.html

### 2. Mutable UPSERT is incompatible with the append-only trigger contract

Current continuity tables have BEFORE UPDATE/DELETE immutable triggers. PostgreSQL documents that `INSERT ... ON CONFLICT DO UPDATE` follows UPDATE semantics and can execute UPDATE-trigger paths. That is the wrong primitive for immutable evidence.

STEP09B instead uses:

- `ON CONFLICT DO NOTHING` only for the already-unique domain/object identities;
- an immediate exact semantic readback of the existing row;
- fail-close on any mismatch;
- no UPDATE or DELETE.

Sources:
- https://www.postgresql.org/docs/17/sql-insert.html
- https://www.postgresql.org/docs/17/trigger-definition.html

### 3. Transaction advisory lock is sufficient for the current Supervisor writer plane

PostgreSQL transaction-level advisory locks are released automatically at transaction end. STEP09B obtains `pg_advisory_xact_lock()` from the continuity object's SHA-256 prefix before domain/object/observation reconciliation.

This serializes cooperating ingestion attempts for the same object. A 64-bit lock-key collision can only over-serialize two unrelated objects; it does not allow concurrent same-object ingestion and therefore cannot weaken correctness.

No new observation unique constraint is introduced in v1. The current writer plane is postgres-only, and STEP09B checks for an exact existing observation or a conflicting same `(object_id, domain_key, readback_at)` fact while holding the object lock. A global schema constraint would change broader append-only observation semantics without being necessary for this Supervisor path.

Sources:
- https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS
- https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS

### 4. Freshness must be rechecked at DB commit

STEP09A proves source/provider evidence before database credentials are introduced, but time can pass between STEP09A and STEP09B. The database cannot trust the earlier effective time.

The STEP09B function therefore captures `clock_timestamp()` and independently rejects:

- trusted-root acquisition older than 15 minutes at DB execution;
- readbacks in the future;
- readbacks older than seven days;
- a projection freshness boundary that does not recompute exactly from the two readback timestamps.

The 15-minute root window remains an H205F22 operational policy, not a cryptographic revocation guarantee.

### 5. Existing continuity guards remain authoritative

The migration intentionally reuses the existing continuity plane rather than creating a second state machine:

- `compute_record_continuity_observation_h205f22()` inserts observations through the existing fail-closed normalization path;
- the observation BEFORE INSERT trigger independently checks expected SHA-256/bytes/timestamps;
- `compute_continuity_readiness_h205f22()` requires current latest VERIFIED observations in >=2 domains, >=2 failure domains and >=2 operator classes;
- `compute_continuity_audit_status_h205f22()` must return `PASS`;
- no persisted seal is inserted.

### 6. Runner trust zone must contain DB credentials only

The thin Python runner refuses non-database credential variables including GitHub/OIDC, AWS and Backblaze credentials. Only an allowlist of libpq environment variables is copied to the `psql` child process. STEP08 projection and STEP09A receipt are transmitted as canonical JSON encoded to base64, then decoded in PostgreSQL with `decode()` + `convert_from()`; raw JSON and database secrets are not placed in command arguments.

This means a future live execution should have:

- STEP09A job: GitHub/Sigstore + provider-materialization context, **no DB credential**;
- STEP09B job: direct postgres credential, **no GitHub/provider credential**.

## Production migration

Applied production migration:

- version: `20260821234739`
- name: `r1_step09b_supervisor_db_ingestion_v1`
- repo path: `supabase/migrations/20260821234739_r1_step09b_supervisor_db_ingestion_v1.sql`
- function: `destruktion_meta.compute_ingest_r2_projection_h205f22(jsonb,jsonb)`

Live post-apply inspection:

- `prosecdef=false` (`SECURITY INVOKER`);
- `search_path=""`;
- ACL: `{postgres=X/postgres}`;
- no public/anon/authenticated/service_role EXECUTE;
- no continuity row was inserted by applying the migration.

## Synthetic production verification — rollback only

A synthetic two-domain projection and synthetic STEP09A-shaped authority receipt were executed against the real production function inside `BEGIN ... ROLLBACK`.

The function traversed the real domain/object/observation triggers and existing readiness/audit functions and reached database-derived R2 in the transaction. The transaction was then rolled back.

Post-rollback counts were verified:

- synthetic domains: 0;
- synthetic objects: 0;
- synthetic observations: 0;
- live continuity domains: 0;
- live continuity objects: 0;
- live continuity observations: 0;
- live persisted seals: 0.

A second rollback-only adversarial suite confirmed 5/5 fail-closed cases:

1. trusted-root context older than 15 minutes;
2. provider readback older than seven days;
3. `step09b_ingestion_eligible=false`;
4. forged projection with `r2_proven=true`;
5. existing domain key with conflicting semantic identity.

No synthetic row survived.

## Implementation contract

### Database function

The postgres-only function:

- validates exact STEP08 projection schema/classification/non-authority flags;
- validates STEP09A production authority-gate schema/classification/binding/non-authority flags;
- requires the production wrapper's `gh_attestation_verification` facts;
- rechecks trusted-root and readback freshness with DB time;
- requires exactly two distinct domains/providers/operators/failure domains for the current v1 projection;
- takes an object-scoped transaction advisory lock;
- exact-match-or-inserts domains and object;
- exact-reuses or append-inserts observations, failing on conflicting readback identity;
- calls existing DB readiness and audit functions;
- returns `continuity_readiness_r2_proven=true` only when the DB itself proves it;
- always returns `canonical_roadmap_r2_promoted=false`, `r3_proven=false`, `persisted_seal_created=false`.

### Thin runner

`controller/r1/supervisor_r2_db_ingestion.py`:

- validates STEP08 package/projection through the existing safe package parser;
- verifies the STEP09A authority receipt self-hash and exact package/projection binding;
- performs a local 15-minute root precheck (the DB repeats it);
- rejects GitHub/OIDC/AWS/B2 credential variables;
- passes only an explicit libpq environment allowlist to `psql`;
- invokes the DB function with base64-transported canonical JSON;
- validates the DB result and rejects any attempted roadmap/R3/seal authority expansion.

## Strict nonclaims

At implementation time:

- there is no real STEP09A production authority receipt for a live provider object;
- the thin runner has **not** performed a real production ingestion;
- production continuity counts remain 0/0/0/0;
- database-derived R2 has only been observed inside a labeled rollback-only synthetic transaction;
- canonical roadmap R2 is not promoted;
- R1 is not sealed;
- R3 is not proven;
- no persisted seal exists.

## Mandatory research after implementation before merge

After the first independent PR CI run, re-check and record:

1. production function ACL, `prosecdef=false`, empty search path and exact migration/source alignment;
2. Supabase security/performance advisors against the pre-DDL baseline and identify any new STEP09B-specific finding;
3. rollback-only success/adversarial evidence and final zero production counts;
4. transaction advisory-lock collision semantics and whether it can under-lock (expected: no, collision only over-serializes);
5. correctness of `ON CONFLICT DO NOTHING` + exact-match under the current postgres-only writer plane;
6. DB-time root/readback freshness so client-supplied `effective_at` cannot bypass freshness;
7. the distinction between `continuity_readiness_r2_proven=true` and `canonical_roadmap_r2_promoted=false`;
8. whether requiring continuity audit `PASS` is correct for the current exactly-two-domain v1 contract;
9. whether the DB needs to cryptographically recompute the STEP09A JSON self-hash. Expected boundary: no — the runner validates it and a caller with unrestricted postgres can bypass any SQL wrapper anyway; the DB function is the transactional integrity/idempotency guard, not the Sigstore verifier.

Merge is forbidden until research-after is appended and STEP09B CI + STEP08/STEP09A regressions + Compute Fabric Governance succeed again on the exact final head.
