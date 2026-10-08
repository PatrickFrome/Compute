# Isolated Client Goal Verification

`client-goal.integration.test.mjs` exercises the normal Client goal contracts
through a separate real API and Native Supervisor with generated P256 device
signatures. It verifies atomic submit, exact progress, missing execution proof,
durable ClientGoalJournal reload, and response-loss reconciliation without
automatically resubmitting an effect. The first goal remains readable after
the next synthetic goal supersedes its semantic plan.

The fixture owns a fresh temporary PostgreSQL 17 cluster, generated SCRAM
credentials, unused loopback ports, service processes and a private synthetic
client journal. It never accepts a caller-supplied database or supervisor URL,
connects to the existing main cluster, uses an installed Browser profile, or
contacts a hosted Supabase project. No lease, cycle, resume, model, Browser
effect or completed result is requested.

## Explicit Setup

Set all four environment variables, then run the integration file:

- `LOCAL_STATE_TEST_GOAL_BACKUP_DIRECTORY`: absolute immutable private backup directory.
- `LOCAL_STATE_TEST_GOAL_DUMP_SHA256`: independently recorded SHA256 of `database.dump`.
- `LOCAL_STATE_TEST_PG_BIN_DIR`: absolute PostgreSQL 17 portable `bin` directory.
- `LOCAL_STATE_TEST_DENO_PATH`: absolute Deno executable, with frozen dependencies already cached.

Run `node --test infra/client-state-runtime/client-goal.integration.test.mjs`.
When both goal backup/digest variables are absent, the test skips, even if other
integration settings exist. Once either goal opt-in variable is present, partial
configuration or any external database/supervisor connection variable fails
closed. An optional
`LOCAL_STATE_TEST_GOAL_REPORT_PATH` writes a new sanitized receipt outside the
checkout; it will not overwrite an existing file.

## Fixture Boundary

The pinned archive is restored with `--schema-only`, excluding table data,
sequence values, event triggers and external connectors. Every user table is
checked empty before synthetic seeding. Source SQL function bodies and RLS
definitions are retained; owners are replaced by a generated test owner,
compatibility roles cannot log in, and the unavailable managed Vault uses the
declared local pgcrypto provider. The three existing local runtime migrations
are applied only to this fixture. These are explicit compatibility adaptations,
not a byte-identical production platform restore.

Only synthetic roadmap authority, devices, pairing records, goal requests,
semantic plans and their two READY task admissions are created. Both tasks must
retain zero lease generation and no agent/tab/target binding. Claims, supervisor
commands/state and runtime-control tables remain empty. An owned marker,
canonical temporary path and exact postmaster PID/data directory are checked
before cleanup. An unconfirmed stop prevents deletion of the cluster.

Successful evidence is `ISOLATED_SCHEMA_FIXTURE_SMOKE`. It proves this bounded
workflow on a declared fresh schema fixture, not the installed application,
production runtime, useful coding, model output, result acceptance, autonomous
execution, or completeness of a Supabase replacement. Archive and fixture data,
keys and connection URLs must never be committed or uploaded as CI artifacts.
