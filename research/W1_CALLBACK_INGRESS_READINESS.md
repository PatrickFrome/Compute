# W1 Callback Ingress Readiness / Readback Contract

Status: source-only, non-authority readiness composition. No provider mutation.

## Problem

The callback plane spans three trust surfaces that must never be collapsed into one boolean:

1. Postgres callback persistence objects and privileges;
2. Supabase Edge callback deployment/config/source identity;
3. AWS SSM callback-key enrollment and execution-marker document identity.

A deployed Edge function alone is not sufficient. A database migration alone is not sufficient. AWS document existence alone is not sufficient.

`controller/w1/w1_callback_ingress_readiness_guard.py` composes exact readback from all three surfaces and emits either:

- `NOT_READY`; or
- `READY_CANDIDATE_NON_AUTHORITY`.

Even the latter cannot authorize DDL, Edge deployment, AWS mutation, SendCommand, admission or W1 verification.

## Research refreshed 2026-08-28

### Supabase Edge function authentication configuration

Supabase documents `functions.<name>.verify_jwt=false` as the supported per-function configuration for webhook-style ingress that does not use a user JWT. This disables the platform JWT gate; therefore the handler itself must authenticate the request.

- https://supabase.com/docs/guides/functions/function-configuration
- https://supabase.com/docs/guides/functions/auth-headers
- https://supabase.com/docs/guides/local-development/cli/config

W1 consequence: `w1-execution-callback` must read back as `ACTIVE`, `verify_jwt=false`, and its deployed `index.ts` must match the reviewed source blob. `verify_jwt=false` is accepted only because the handler performs enrollment-bound P-256 verification before persistence.

### Database function/table privilege posture

Supabase documents that database functions are executable by roles by default unless execution is explicitly revoked/granted. PostgreSQL `routine_privileges` and `table_privileges` expose function/table grants; column-specific privileges are separately observable.

- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/api/securing-your-api
- https://www.postgresql.org/docs/17/infoschema-routine-privileges.html
- https://www.postgresql.org/docs/18/infoschema-table-privileges.html

W1 consequence:
- both callback tables must exist in `public`, have RLS enabled, and expose no table privileges to `public`, `anon`, or `authenticated`;
- service_role table privileges are exactly SELECT+INSERT;
- only callback-key `revoked_at` has service_role column UPDATE;
- all four callback functions must exist as SECURITY INVOKER and expose EXECUTE only to service_role.

This is stricter than checking object presence.

### Edge deployment readback

Supabase documents deployment and per-function configuration as separate concerns. The readiness contract therefore requires both deployed function state and source/config identity rather than inferring one from the other.

- https://supabase.com/docs/guides/functions/deploy

### AWS document identity remains independent

The preceding v7 provisioning contract established exact create-once readback for both account-owned SSM Command documents. v8 consumes an independent protected-readback shape and requires version/latest/default `1`, Active status, SHA-256 metadata, exact owner/account consistency, and reviewed document content blob identity.

Provenance labels supplied to this pure guard are intentionally treated as self-asserted. The guard says so in output and never upgrades them to cryptographic/live-provider proof by itself.

## Source identities pinned by v8

Reviewed Git blobs:
- callback PREP SQL: `8122603e6b87d726460937cc84d6c0bdb2fd7663`
- Edge `index.ts`: `3426721cf6b0f7a3bc1b74d23967da7b420a59a7`
- `supabase/config.toml`: `00a51f24203799703afe2de034dbd4ff0d45d556`
- callback-key SSM document: `d5a74d4a00799f46259c740d32dbc0bfad6abb37`
- execution-marker SSM document: `7660ee6b837e0cf07eca17845350fd045c2b2a86`

A change to any reviewed artifact makes the guard fail closed until the readiness contract is intentionally revised and re-reviewed.

## Current live readback

Read-only Supabase inspection at `2026-08-28T04:22:50.497128Z` showed:
- callback key table absent;
- callback receipt table absent;
- callback registration/recording RPCs absent;
- `w1-execution-callback` absent from the project's Edge Function list;
- W1 remains READY, not VERIFIED;
- safety verifications, backend bindings, reboot receipts and admitted cpu-local workers remain zero.

Therefore current live callback ingress readiness is `NOT_READY`. No DDL or Edge deployment was performed to change that state.

## Authority boundary

The readiness guard always emits:
- `database_mutation_authorized=false`
- `edge_deployment_authorized=false`
- `aws_mutation_authorized=false`
- `send_command_authorized=false`
- `provider_identity_verified=false`
- `persistent_worker_proof=false`
- `worker_admitted=false`
- `w1_verified=false`
- `canonical=false`
- `authority_effect=false`

`READY_CANDIDATE_NON_AUTHORITY` means only that supplied readback satisfies the reviewed shape. A protected workflow must independently obtain provider readback; later W1 gates must still require actual host safety, persistence, reboot and admission evidence.
