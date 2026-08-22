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

## Production migrations

Applied production migrations:

1. `20260821234739_r1_step09b_supervisor_db_ingestion_v1`
   - initial postgres-only append-only ingestion function.
2. `20260821235859_r1_step09b_idempotency_truthfulness_v2`
   - keeps the same function signature and authority boundary;
   - makes READ COMMITTED explicit;
   - normalizes durable domain metadata to stable account/domain identity;
   - allows an exact existing readback to be reused under a newly issued fresh STEP09A gate without mutating historical evidence;
   - truthfully reports whether any durable row was inserted.

Repo paths:

- `supabase/migrations/20260821234739_r1_step09b_supervisor_db_ingestion_v1.sql`
- `supabase/migrations/20260821235859_r1_step09b_idempotency_truthfulness_v2.sql`

Function:

- `destruktion_meta.compute_ingest_r2_projection_h205f22(jsonb,jsonb)`

Live post-v2 inspection:

- `prosecdef=false` (`SECURITY INVOKER`);
- `search_path=""`;
- ACL: `{postgres=X/postgres}`;
- no public/anon/authenticated/service_role EXECUTE;
- READ COMMITTED guard present;
- stable-domain contract present;
- `database_transaction_validated` contract present;
- function does not reference the persisted-seal table;
- no continuity row was inserted by applying either migration.

## Synthetic production verification — rollback only

### v1 baseline

A synthetic two-domain projection and synthetic STEP09A-shaped authority receipt were executed against the real production function inside `BEGIN ... ROLLBACK`.

The function traversed the real domain/object/observation triggers and existing readiness/audit functions and reached database-derived R2 in the transaction. The transaction was then rolled back.

A v1 rollback-only adversarial suite confirmed 5/5 fail-closed cases:

1. trusted-root context older than 15 minutes;
2. provider readback older than seven days;
3. `step09b_ingestion_eligible=false`;
4. forged projection with `r2_proven=true`;
5. existing domain key with conflicting semantic identity.

### v2 idempotency/truthfulness suite

Mandatory research-after found a domain-model issue in v1: STEP08's projected domain metadata includes `provider_result_sha256`, which is object-specific. Persisting and exact-matching that entire metadata object would incorrectly prevent a second backup object from reusing the same physical AWS/B2 continuity domain.

v2 fixes the model without changing STEP08 schema. It validates the projected account-scope and provider-result hashes, but persists only stable domain identity metadata:

- `account_scope_sha256`;
- `registration_contract=STEP09B_STABLE_DOMAIN_IDENTITY_V1`.

The object-specific provider result remains in observation evidence.

A production rollback-only v2 suite proved:

1. first synthetic object inserted two domains, one object and two VERIFIED observations and reached DB-derived R2;
2. a second invocation of the **same projection with a newly issued authority-gate receipt/root context** reused both domains, the object and both observations, reached R2 again, and truthfully returned `database_write_performed=false`;
3. a second synthetic backup object using the same AWS/B2 domain keys but different projected `provider_result_sha256` values reused the stable domain rows and inserted only the new object/observations;
4. object-specific `provider_result_sha256` did not leak into durable domain metadata;
5. `REPEATABLE READ` was rejected by the explicit isolation guard;
6. an existing domain with conflicting stable account-scope identity failed closed.

After every rollback-only suite, live state was re-read as:

- domains: 0;
- objects: 0;
- observations: 0;
- persisted seals: 0.

No synthetic row survived.

## Implementation contract

### Database function

The postgres-only v2 function:

- requires `READ COMMITTED` isolation;
- validates exact STEP08 projection schema/classification/non-authority flags;
- validates STEP09A production authority-gate schema/classification/binding/non-authority flags;
- requires the production wrapper's `gh_attestation_verification` facts;
- rechecks trusted-root and readback freshness with DB time;
- requires exactly two distinct domains/providers/operators/failure domains for the current projection v1;
- takes an object-scoped transaction advisory lock;
- persists only stable domain identity and exact-matches it on reuse;
- exact-match-or-inserts the object;
- exact-reuses a prior observation based on immutable readback/base-evidence/projection/package/source identity while allowing a newer authority-gate/root context to authorize reuse;
- append-inserts only missing observations and fails on conflicting same readback identity;
- calls existing DB readiness and audit functions;
- returns `database_transaction_validated=true` only after those checks;
- returns `database_write_performed` from actual inserted-row counts;
- returns `continuity_readiness_r2_proven=true` only when the DB itself proves it;
- always returns `canonical_roadmap_r2_promoted=false`, `r3_proven=false`, `persisted_seal_created=false`.

### Thin runner

`controller/r1/supervisor_r2_db_ingestion.py`:

- validates STEP08 package/projection through the existing safe package parser;
- verifies the STEP09A authority receipt self-hash and exact package/projection binding;
- requires the receipt SHA to be lowercase 64-hex;
- performs a local 15-minute root precheck (the DB repeats it);
- rejects GitHub/OIDC/AWS/B2 credential variables;
- passes only an explicit libpq environment allowlist to `psql`;
- invokes the DB function with base64-transported canonical JSON;
- requires `database_transaction_validated=true`;
- accepts `database_write_performed` as a truthful boolean, including `false` for complete idempotent reuse;
- requires DB-derived readiness and audit PASS;
- rejects any attempted roadmap/R3/seal authority expansion.

## Mandatory research after implementation — completed

### 1. Production ACL/security/search-path/source alignment

Post-v2 live inspection confirms the production function is still `SECURITY INVOKER`, has an empty `search_path`, and EXECUTE ACL is only `{postgres=X/postgres}`. The function contains the exact v2 READ COMMITTED, stable-domain and transaction-validation clauses, and does not reference the persisted-seal table.

The exact applied v2 migration is represented in Git at `supabase/migrations/20260821235859_r1_step09b_idempotency_truthfulness_v2.sql`.

### 2. Supabase advisors

Security and performance advisors were rerun after v2.

No STEP09B-specific finding appeared. The security output contains existing INFO `rls_enabled_no_policy` findings on other internal tables; the performance output contains existing INFO `unused_index` findings, including pre-existing continuity indexes. v2 creates no table/index and adds no Data API role access.

Supabase's current docs still recommend `SECURITY INVOKER` as best practice for database functions and explicitly document revoking default PUBLIC/function-role execution before selectively granting a trusted role.

Sources:
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/troubleshooting/how-can-i-revoke-execution-of-a-postgresql-function-2GYb0A
- https://supabase.com/docs/guides/api/securing-your-api

### 3. Rollback evidence and final zero-state

Both baseline and v2 suites exercised the actual production function, real continuity INSERT trigger, readiness function and audit function only inside explicit rollback transactions.

Final live counts after all tests are 0 domains / 0 objects / 0 observations / 0 persisted seals.

### 4. Advisory-lock collision semantics

PostgreSQL documents advisory locks as application-defined locks and transaction-level advisory locks as automatically released at transaction end. STEP09B derives the two-int lock key deterministically from the object's SHA-256 prefix.

A collision can make two unrelated objects serialize on the same advisory lock, which is a throughput cost only. It cannot make two invocations for the same object acquire different keys, so it does not under-lock the protected object identity.

Source:
- https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS

### 5. `DO NOTHING` + exact-match race behavior

PostgreSQL 17 uses READ COMMITTED by default; each command sees rows committed before that command began, while higher isolation levels hold an older snapshot across commands. STEP09B v2 therefore rejects any transaction isolation other than READ COMMITTED.

Under this explicit contract, a concurrent `ON CONFLICT DO NOTHING` can wait/skip the conflicting insert, and the following exact-match SELECT runs as a new command snapshot and can observe the committed row. This makes the existing pattern deterministic for the current postgres-only cooperating writer plane.

No `DO UPDATE` path is introduced, so immutable UPDATE triggers are never used for reconciliation.

Source:
- https://www.postgresql.org/docs/17/sql-set-transaction.html

### 6. DB-time freshness

Both trusted-root age and seven-day provider-readback freshness are recomputed from `clock_timestamp()` inside the database function. No client-supplied STEP09A `effective_at` can refresh stale evidence.

The Python runner also prechecks the root window, but that check is defense-in-depth; the DB check is the commit-time boundary.

### 7. Continuity R2 is not canonical roadmap R2

The v2 result explicitly distinguishes:

- `continuity_readiness_r2_proven=true`: DB continuity fact for the object;
- `canonical_roadmap_r2_promoted=false`: governance state unchanged.

STEP09B cannot seal R1, promote canonical R2, prove R3, or create a persisted seal. Those remain later Supervisor decisions after real evidence exists.

### 8. Audit PASS remains required

For the current exactly-two-domain projection v1, the existing continuity audit is an additional fail-closed check over the same live continuity object. Synthetic v2 transactions proved that valid two-domain evidence reaches `PASS`; keeping this requirement increases confidence without introducing a second state machine.

Future >2-domain support should use a new STEP08/STEP09 schema version rather than silently broadening the v1 contract.

### 9. STEP09A self-hash boundary

The database does not try to reproduce Python canonical JSON hashing. The DB validates the authority-gate schema, hash shape, package/projection binding, verification/freshness facts and all transactional invariants. The thin runner cryptographically recomputes the STEP09A receipt self-hash before any DB call.

This is the correct trust split: STEP09A/Sigstore verification and canonical JSON hashing live outside PostgreSQL; STEP09B is the append-only transactional integrity/idempotency boundary. A principal with unrestricted `postgres` privileges can bypass any wrapper and directly modify postgres-owned tables, so duplicating a Python canonicalizer in SQL would not create a meaningful additional privilege boundary.

## Strict nonclaims

At completion of research-after:

- there is no real STEP09A production authority receipt for a live provider object;
- the thin runner has **not** performed a real production ingestion;
- production continuity counts remain 0/0/0/0;
- database-derived R2 has only been observed inside labeled rollback-only synthetic transactions;
- canonical roadmap R2 is not promoted;
- R1 is not sealed;
- R3 is not proven;
- no persisted seal exists.

Merge remains forbidden until STEP09B CI + STEP08/STEP09A regressions + Compute Fabric Governance succeed again on the exact final head containing this research-after record.
