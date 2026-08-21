# R1 STEP09A — Supervisor R2 ingestion eligibility gate

Status: PREPARE_ONLY / pre-DB authority gate  
Authority: ingestion eligibility only; no continuity DB mutation and no R2/R3 seal authority

## Goal

Create a Supervisor-only evidence gate between STEP08 and the future append-only continuity DB transaction.

STEP09A re-establishes source provenance and evidence freshness immediately before DB ingestion, but deliberately has **no database credential**. Passing the gate means only that STEP09B may attempt the append-only transaction.

## Mandatory research before implementation

### 1. GitHub verification policy must be stricter than predicate inspection

Current GitHub CLI documentation states that `gh attestation verify --format json` returns:

- the verified attestation bundle;
- `verificationResult.signature.certificate`;
- `verifiedTimestamps`;
- the in-toto statement and predicate.

GitHub explicitly warns that only certificate and verified timestamp properties are outside the originating workflow's control. The custom statement predicate remains workflow-controlled metadata.

Therefore STEP09A must not trust the STEP07 custom predicate by itself. The execution context must enforce exact GitHub CLI policy:

- repository `PatrickFrome/Compute`;
- signer workflow `PatrickFrome/Compute/.github/workflows/r1-live-recovery-source.yml`;
- signer digest = exact source head SHA;
- source ref = `refs/heads/main`;
- source digest = exact source head SHA;
- OIDC issuer = `https://token.actions.githubusercontent.com`;
- exact custom predicate type;
- `--deny-self-hosted-runners`;
- `--custom-trusted-root` using a root fetched for the ingestion decision;
- JSON output for subsequent policy validation.

The gate then reuses the existing STEP07 verifier and STEP07B environment-binding reconstruction rather than accepting the predicate as authority.

Sources:
- https://cli.github.com/manual/gh_attestation_verify
- https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline

### 2. Fresh trusted root is a separate execution-time fact

GitHub documents that `trusted_root.jsonl` has no built-in expiration and cannot reveal revocation that occurred after the snapshot was generated. GitHub recommends fetching a new root when importing new signed material.

STEP09A therefore does not use the packaged STEP08 root as current revocation evidence. A separate online root-fetch context is required for ingestion eligibility. The pure controller binds:

- SHA-256/size of the root actually supplied to the verifier;
- acquisition timestamp;
- `online_fetch=true`;
- source `GH_ATTESTATION_TRUSTED_ROOT`;
- exact strict policy above.

The current PREPARE_ONLY contract limits this operational context to 15 minutes before the effective ingestion decision. This is a freshness policy for the Supervisor workflow, not a cryptographic timestamp claim.

Source:
- https://cli.github.com/manual/gh_attestation_trusted-root

### 3. DB authority must stay separated from provider/GitHub verification

Current Supabase guidance recommends least-privilege Postgres roles/grants and careful review of `SECURITY DEFINER`; database functions use invoker rights by default.

Live H205F22 inspection confirms:

- continuity domain/object/observation/seal tables have RLS enabled;
- direct table grants are currently only for `postgres`;
- `anon` and `authenticated` have explicit deny-all RLS policies;
- continuity functions are invoker (`prosecdef=false`) and EXECUTE is restricted to `postgres`;
- no provider workflow needs or should receive continuity DB write authority.

Therefore STEP09A has no DB connection string, no Supabase service key and no SQL execution. STEP09B will be a separate trust zone with its own research-before.

Sources:
- https://supabase.com/docs/guides/database/postgres/roles
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/api/securing-your-api

### 4. Future DB idempotency is exact-match-or-insert, not mutable upsert

Live H205F22 continuity rows are append-only through immutable UPDATE/DELETE triggers.

Current PostgreSQL documentation confirms:

- trigger errors participate in the same transaction and roll back the triggering work;
- `ON CONFLICT DO UPDATE` is an atomic UPSERT, but it performs UPDATE semantics and would interact with UPDATE triggers;
- Serializable consistency requires retry on serialization failure;
- transaction-level advisory locks can serialize cooperating transactions.

For the future STEP09B, the intended pattern is therefore:

1. transaction-level advisory lock keyed by the STEP08 package/object identity;
2. exact-match existing domain/object rows or insert missing rows;
3. fail on any semantic mismatch rather than update immutable rows;
4. detect already-ingested exact observations instead of appending duplicates;
5. insert only missing exact observations;
6. read DB-derived readiness after inserts;
7. never create the persisted seal automatically.

STEP09A itself does none of these writes.

Sources:
- https://www.postgresql.org/docs/current/sql-insert.html
- https://www.postgresql.org/docs/current/trigger-definition.html
- https://www.postgresql.org/docs/current/applevel-consistency.html
- https://www.postgresql.org/docs/16/functions-admin.html

## Architecture split

### STEP09A — this step

Trust zone: provider/GitHub evidence verification; **no DB credential**.

Inputs:

- STEP08 deterministic package + receipt;
- exact materialized provider ciphertext;
- `gh attestation verify --format json` result;
- fresh trusted-root bytes;
- root acquisition/policy context;
- explicit effective time.

Outputs:

- self-hashed `SUPERVISOR_R2_INGESTION_ELIGIBILITY_PRE_DB_NONAUTHORITATIVE` receipt;
- `ingestion_eligible=true` only after all checks;
- `r2_proven=false`, `r3_proven=false`, `persisted_seal_allowed=false` always.

### STEP09B — future separate semantic step

Trust zone: direct Supervisor DB transaction; **no provider or GitHub credentials**.

STEP09B will consume STEP09A eligibility + STEP08 projection and attempt the append-only transaction. It will receive its own mandatory research-before and research-after.

## STEP09A implementation contract

`controller/r1/supervisor_r2_ingestion_gate.py`:

- safe USTAR parser: regular files only, path normalization, no traversal, no duplicate/unmanifested members, size/member bounds;
- validates STEP08 package/manifest/projection/receipt hashes and non-authority flags;
- validates exact materialized ciphertext SHA-256/bytes;
- requires exactly two projected observations and recomputes the seven-day simultaneous freshness boundary;
- rejects effective time before readbacks or after freshness expiry;
- requires a fresh online trusted-root context and exact strict GitHub CLI policy;
- runs existing `validate_verification_result()` against the materialized bytes;
- requires the verified statement predicate to equal the packaged predicate;
- re-runs STEP07B `bind_verification()` with packaged readiness/approval evidence and requires exact equality to the packaged source-verification receipt;
- emits only ingestion eligibility.

## Adversarial requirements

Tests must cover:

- valid gate is eligible but never R2;
- exact policy fields and deny-self-hosted requirement;
- stale root context;
- recomputed root-context hash cannot weaken policy;
- stale two-domain readback evidence;
- wrong materialized ciphertext bytes;
- verified predicate differing from package predicate;
- USTAR path traversal;
- recomputed projection hash cannot claim R2.

The CI gate must also rerun the real STEP07 source-attestation/environment-binding suites so mocked STEP09A plumbing tests cannot replace source-verification coverage.

## Strict nonclaims

- PR CI does not call GitHub attestation APIs;
- PR CI does not fetch a live trusted root;
- PR CI does not call AWS/B2;
- PR CI has no DB credential and performs no SQL;
- no continuity rows are inserted;
- no R2/R3 or persisted seal is created;
- worker/roadmap state is not mutated.

## Mandatory research after implementation before merge

After the first independent CI run, re-check and record:

1. whether a 15-minute root-context window is justified or should be tighter/looser;
2. whether `gh attestation verify` JSON plus a strict execution context is sufficient, or certificate fields need explicit second-pass validation;
3. whether STEP08 tar validation preserves all inputs STEP09B will need without trusting unmanifested files;
4. whether exactly two observations is correct for current R2 authority versus allowing >2 supporting domains;
5. whether the future STEP09B idempotency design needs a new unique DB constraint/ledger or can remain exact-query + advisory-lock under existing schema;
6. whether root acquisition and Sigstore verification should run in one future protected Supervisor job to avoid a TOCTOU gap;
7. whether any part of STEP09A should be moved into PostgreSQL (default answer is no unless research shows a reason).

Merge is forbidden until research-after is appended and STEP09A CI + STEP07/STEP08 regressions + Governance succeed again on the exact final head.
