# MAIN ROADMAP ACCELERATORS V8 — W1 CALLBACK INGRESS READINESS CHECKPOINT

Date: 2026-08-28
Branch: `work/main-roadmap-accelerators-v8`
Verified semantic source SHA: `e9e50db73538681c78aa85a5b127e0009c786920`
Verified semantic source tree: `bda60f4362d28ba71abf9f3bba5f44dbc274b0eb`
Base checkpoint: `add41910168c51f0439690ea1b5409aab068b3cb`

## Implemented source boundary

This slice adds a fail-closed, non-authority readiness/readback guard for the W1 signed callback plane:

- `controller/w1/w1_callback_ingress_readiness_guard.py`
- `tests/test_w1_callback_ingress_readiness_guard.py`
- `.github/workflows/w1-callback-ingress-readiness-contract.yml`
- `research/W1_CALLBACK_INGRESS_READINESS.md`

The guard deliberately keeps four independent readiness surfaces separate:
1. reviewed source identities;
2. Postgres callback objects/RLS/grants;
3. Supabase Edge deployment/config/source identity;
4. AWS SSM callback document identities.

It emits only `NOT_READY` or `READY_CANDIDATE_NON_AUTHORITY`.

## Pinned reviewed source identities

- callback PREP SQL blob: `8122603e6b87d726460937cc84d6c0bdb2fd7663`
- callback Edge `index.ts` blob: `3426721cf6b0f7a3bc1b74d23967da7b420a59a7`
- `supabase/config.toml` blob: `00a51f24203799703afe2de034dbd4ff0d45d556`
- callback-key SSM document blob: `d5a74d4a00799f46259c740d32dbc0bfad6abb37`
- execution-marker SSM document blob: `7660ee6b837e0cf07eca17845350fd045c2b2a86`

Any drift requires an intentional contract revision rather than silent acceptance.

## Database readiness invariants

The guard requires both callback tables to:
- exist in `public`;
- have RLS enabled;
- expose no table privileges to `public`, `anon`, or `authenticated`;
- expose exactly SELECT+INSERT table privileges to `service_role`;
- expose only `revoked_at` as a service-role column UPDATE on the callback-key table;
- expose no service-role column UPDATE on the callback-receipt table.

The four callback functions must:
- exist in `public` with exact reviewed identities;
- remain SECURITY INVOKER;
- deny EXECUTE to `public`, `anon`, and `authenticated`;
- grant EXECUTE to `service_role` only.

Object presence without this privilege posture is not readiness.

## Edge readiness invariants

The callback Edge function must:
- exist as `w1-execution-callback`;
- read back `ACTIVE`;
- read back `verify_jwt=false` because it is a signed webhook performing custom enrollment-bound P-256 authentication;
- have a deployed `index.ts` matching the reviewed source identity.

`verify_jwt=false` is never treated as trust by itself.

## AWS document readiness invariants

Both callback SSM documents must independently read back:
- present with exact names;
- owned by the expected 12-digit account;
- document/latest/default version `1`;
- `Active`;
- `Sha256` hash metadata;
- reviewed document content identity.

## Authority boundary

Even a fully passing supplied readback is only `READY_CANDIDATE_NON_AUTHORITY`.

The guard always emits:
- `provenance_labels_are_self_asserted=true`;
- `live_provider_readback_cryptographically_verified_by_guard=false`;
- `database_mutation_authorized=false`;
- `edge_deployment_authorized=false`;
- `aws_mutation_authorized=false`;
- `send_command_authorized=false`;
- `provider_identity_verified=false`;
- `persistent_worker_proof=false`;
- `worker_admitted=false`;
- `w1_verified=false`;
- `canonical=false`;
- `authority_effect=false`.

## Research basis refreshed 2026-08-28

Research was refreshed against current Supabase and PostgreSQL documentation covering:
- per-function `verify_jwt` configuration for webhook/custom-auth Edge Functions;
- database function privilege defaults and explicit REVOKE/GRANT posture;
- PostgreSQL routine/table privilege readback;
- Edge deployment/config separation.

This confirms that deployment presence, JWT-gate configuration and database grants must be verified independently.

## Exact CI evidence

Exact GitHub Actions run:
- workflow: `W1 Callback Ingress Readiness Contract`;
- run: `33141859286`;
- job: `98754229581`;
- head SHA: `e9e50db73538681c78aa85a5b127e0009c786920`;
- conclusion: `success`.

All relevant steps passed: exact source identity, guard compilation and fail-closed readiness contracts.

## Live state after the source slice

Read-only Supabase readback immediately before this slice showed at `2026-08-28T04:22:50.497128Z`:
- W1 remains `READY`, not VERIFIED;
- First Real Linux Worker remains `PLANNED`;
- fresh active roadmap claims: `0`;
- stale persisted claim `32` remains cleanup debt with no authority effect;
- callback key table: absent;
- callback receipt table: absent;
- callback key registration RPC: absent;
- callback receipt recording RPC: absent;
- Linux safety verifications: `0`;
- backend bindings: `0`;
- reboot receipts: `0`;
- admitted non-revoked cpu-local workers: `0`.

A separate live Edge Function list read after v8 source implementation also showed no `w1-execution-callback` deployment.

Therefore current live callback ingress readiness is already conclusively `NOT_READY` from the Supabase surfaces alone. No claim is made about live AWS document existence because no protected AWS readback was performed in this slice.

No callback DDL was applied. No Edge function was deployed. No AWS mutation, SSM `SendCommand`, reboot or worker admission occurred.

## Advisor post-audit

Security advisors observed at `2026-08-28T04:27:51.303Z` show no callback-specific new live finding. Pre-existing findings remain, notably:
- anon execution of `public.coordination_read_barrier_h205f22()` as SECURITY DEFINER;
- authenticated execution of the same function;
- leaked-password protection disabled;
- existing RLS-enabled/no-policy INFO notices.

Performance advisors observed at `2026-08-28T04:27:58.529Z` remain pre-existing unused-index INFO findings. No index is removed without workload evidence.

## Current truth

`W1_PERSISTENT_LINUX_WORKER_SAFETY = READY`

`callback_ingress_live_readiness = NOT_READY`

`W1 VERIFIED = false`

## Next bounded slice

Build a protected read-only collection contract that obtains provider readback for the readiness guard without granting mutation authority. It must separate:
- Supabase/Postgres object and privilege inspection;
- Supabase Edge deployment/source inspection;
- AWS SSM Describe/Get document inspection.

The collector must never run DDL, deploy Edge code, create/update SSM documents, call `SendCommand`, start a session, reboot a host, or admit a worker.