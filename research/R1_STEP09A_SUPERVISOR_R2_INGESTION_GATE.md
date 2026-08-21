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

The low-level `supervisor_r2_ingestion_gate.py` is a package/freshness/source-binding verifier candidate. It can consume a verification JSON for offline/unit composition, but its schema is never accepted by STEP09B.

The production STEP09A boundary is `supervisor_r2_ingestion_authority_gate.py`. It does **not** accept precomputed verification JSON. It materializes the bundle from the validated STEP08 package and executes `gh attestation verify` itself with exact policy and the fresh trusted root. Only its distinct authority-gate schema may be accepted by STEP09B.

Outputs remain non-authoritative with `r2_proven=false`; the stronger wrapper merely establishes eligibility to attempt the DB transaction.

### STEP09B — future separate semantic step

Trust zone: direct Supervisor DB transaction; **no provider or GitHub credentials**.

STEP09B will consume the production STEP09A authority-gate receipt + STEP08 projection and attempt the append-only transaction. It will receive its own mandatory research-before and research-after.

## STEP09A implementation contract

### Core verifier

`controller/r1/supervisor_r2_ingestion_gate.py`:

- safe USTAR parser: regular files only, path normalization, no traversal, no duplicate/unmanifested members, size/member bounds;
- validates STEP08 package/manifest/projection/receipt hashes and non-authority flags;
- validates exact materialized ciphertext SHA-256/bytes;
- requires exactly two projected observations and recomputes the seven-day simultaneous freshness boundary;
- rejects effective time before readbacks or after freshness expiry;
- requires a fresh online trusted-root context and exact strict GitHub CLI policy;
- runs existing `validate_verification_result()` against the materialized bytes;
- requires the verified statement predicate to equal the packaged predicate;
- re-runs STEP07B `bind_verification()` with packaged readiness/approval evidence and requires exact equality to the packaged source-verification receipt.

### Production authority wrapper

`controller/r1/supervisor_r2_ingestion_authority_gate.py`:

- extracts the attestation bundle only from the already validated STEP08 package;
- builds the exact `gh attestation verify` command itself;
- always uses `--bundle` and `--custom-trusted-root`, so attestation verification does not depend on fetching attestation data from GitHub;
- pins repository, signer workflow, signer digest, source ref, source digest, OIDC issuer, predicate type and `--deny-self-hosted-runners`;
- parses only its own command output;
- passes that output into the core verifier for predicate/source-environment reconstruction;
- emits distinct schema `metaengine.compute.r1-supervisor-r2-ingestion-authority-gate.h205f22.v1` with `step09b_ingestion_eligible=true`;
- always keeps database/provider credentials absent and DB/R2/R3/seal authority false.

## Adversarial requirements

Tests cover:

- valid core gate is eligible but never R2;
- exact policy fields and deny-self-hosted requirement;
- stale root context;
- recomputed root-context hash cannot weaken policy;
- stale two-domain readback evidence;
- wrong materialized ciphertext bytes;
- verified predicate differing from package predicate;
- USTAR path traversal;
- recomputed projection hash cannot claim R2;
- production wrapper command includes every strict GitHub identity flag;
- wrapper, not caller, executes verification;
- invalid/multiple `gh` JSON results fail closed;
- core candidate must be eligible and non-authoritative before wrapper can emit STEP09B eligibility.

CI also reruns the real STEP07 source-attestation/environment-binding and STEP08 package suites so mocked wrapper plumbing cannot replace underlying cryptographic/source-binding coverage.

## Strict nonclaims

- PR CI does not call GitHub attestation APIs;
- PR CI does not fetch a live trusted root;
- PR CI does not call AWS/B2;
- PR CI has no DB credential and performs no SQL;
- no continuity rows are inserted;
- no R2/R3 or persisted seal is created;
- worker/roadmap state is not mutated.

## Mandatory research after implementation before merge

### Independent implementation signal

The initial pure-core head passed STEP09A CI and Governance. Research-after then found that accepting precomputed `gh --format json` as sufficient admission evidence would leave a forgeable-file boundary. The implementation was hardened before merge by adding the in-process GitHub CLI wrapper described above.

The hardened head `64d54f35fd8474f5d2183146d9e43cdcfaab4aa3` passed R1 Supervisor R2 Ingestion Gate run #4 and Compute Fabric Governance #71. Those are pre-final-research commits only; the final research commit must receive a new exact-head run.

### 1. The 15-minute root-context window is an operational project policy, not a GitHub guarantee

GitHub does not publish a 15-minute trusted-root freshness SLA. The important upstream property is that a root snapshot has no built-in expiry and cannot report revocation that occurred after it was generated.

The 15-minute limit is therefore retained only as a conservative Supervisor execution bound. It must never be described as cryptographic revocation freshness. The stronger operational requirement is that the future live Supervisor job fetch the root and invoke the authority wrapper in the **same job** and same ephemeral workspace.

### 2. In-process `gh attestation verify` removes the forged-JSON admission gap

GitHub CLI documents that its identity flags enforce certificate/source/signer constraints. Because the production wrapper now executes `gh` itself with exact flags, a separate home-grown certificate parser would duplicate GitHub CLI policy logic without adding an independent cryptographic primitive.

The second pass remains valuable at the statement layer: the existing STEP07 verifier checks subject digest, source identity, predicate type and timestamps; STEP07B reconstruction requires the verified predicate to exactly match packaged readiness/approval-bound provenance.

The low-level core JSON input is retained only for composition/testing. Future STEP09B must reject that schema and accept only the wrapper authority-gate schema.

Source:
- https://cli.github.com/manual/gh_attestation_verify

### 3. STEP08 package is complete for STEP09B without trusting unmanifested files

The core gate accepts only regular USTAR members, rejects traversal/duplicates/unmanifested entries and verifies every manifest hash/size. The projection, source verification, source readiness/approval/predicate, envelope and attestation bundle therefore reach STEP09B only through package-bound identities.

STEP09B will not need arbitrary adjacent files. It will need exactly:

- production STEP09A authority-gate receipt;
- validated STEP08 package/receipt or extracted projection bound by their hashes;
- its own current DB state.

### 4. Exactly two observations is intentional for the current package schema

The current live orchestration and STEP08 v1 package are explicitly AWS + Backblaze B2 two-domain evidence. The DB readiness rule is a minimum of two domains, but silently accepting a third/different package shape in the current gate would weaken schema expectations.

STEP09A therefore keeps `len(observations) == 2` for the current schema. A future generalized N-domain evidence package should use a versioned contract and explicit new tests rather than changing the meaning of v1 implicitly.

### 5. No new observation unique constraint is required before STEP09B research

Live schema inspection confirms observation has only its generated primary key; there is no composite uniqueness constraint preventing duplicate re-ingestion.

However the write plane is currently restricted to `postgres`, continuity rows are immutable, and the planned Supervisor transaction can serialize cooperating ingestions with `pg_advisory_xact_lock` and exact-query existing observations before insert. Under this restricted writer model, that can provide idempotent application behavior without production DDL.

This is not yet a STEP09B implementation decision. STEP09B research-before must adversarially test concurrent/repeated ingestion and may still conclude that a dedicated ingestion ledger/unique constraint is warranted.

Sources:
- https://www.postgresql.org/docs/16/functions-admin.html
- https://www.postgresql.org/docs/current/sql-insert.html

### 6. Root acquisition and Sigstore verification belong in one future protected Supervisor job

Splitting the root fetch into one durable artifact-producing job and verification into a later job would create avoidable TOCTOU and artifact-lifecycle dependencies. The future live execution path should:

1. fetch `gh attestation trusted-root`;
2. immediately build root context;
3. materialize exact provider ciphertext;
4. immediately invoke the production STEP09A authority wrapper;
5. upload only the resulting non-secret gate receipt/package references.

That job still must not hold the continuity DB credential.

### 7. STEP09A logic should remain outside PostgreSQL

Sigstore certificate verification, trusted-root handling, tar validation and materialized-byte hashing are file/cryptography concerns. Moving them into PostgreSQL would expand DB trusted code and would require file/network/tool access that the current continuity schema intentionally avoids.

PostgreSQL should remain responsible for structured append-only continuity facts and DB-derived readiness only. STEP09B is the boundary that converts a verified external eligibility/projection into those facts.

## Final merge gate

After this research-after commit, all earlier CI results are stale for merge purposes. Exact final head must again pass:

- R1 Supervisor R2 Ingestion Gate (core + production wrapper + STEP07/STEP08 regressions);
- Compute Fabric Governance.

Strict nonclaims remain unchanged: no live provider call, no DB credential/write, no continuity observation, no R2/R3 transition and no persisted seal.
