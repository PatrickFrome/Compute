# Read-plane trusted-ingress decision — 2026-08-24

Evidence class before the migration is applied and read back: `PREPARE_ONLY`.

## Decision

Keep `coordination_read_barrier_h205f22()` as a single-statement,
`SECURITY DEFINER` authority snapshot, but remove Data API execution from
`PUBLIC`, `anon`, and `authenticated`.  Preserve `service_role` execution for
trusted server-side GPT/GLM coordination paths.

This is an access-boundary correction, not a milestone-completion claim:
`canonical=false`, `authority_effect=false`, and no W1/A2/C1 gate changes.

## Why this is on the critical path

Low-latency model agreement needs one database-clock snapshot of semantic,
authority, and transport state.  The function must read private authority
tables, so changing it to `SECURITY INVOKER` would require a separate RLS and
projection design.  Leaving the definer function executable by client roles,
however, makes the private authority view reachable by anyone with the public
anon key or any signed-in account.  The smallest fail-closed change is therefore
service-role-only execution now, followed later by a separately authenticated
agent ingress that verifies model identity before invoking the barrier.

## Alternatives

| Candidate | Disposition | Reason |
|---|---|---|
| Revoke `PUBLIC`, `anon`, `authenticated`; retain `service_role` | ADOPT_NOW | Removes both advisor warnings without changing snapshot semantics. |
| Revoke only `anon` | REJECT | `PUBLIC` and `authenticated` remain executable. |
| Keep broad grants because the result is read-only | REJECT | `SECURITY DEFINER` bypasses the caller's RLS; read-only data can still be privileged. |
| Convert directly to `SECURITY INVOKER` | DEFER | Requires explicit read projections/RLS and could silently return incomplete authority state. |
| Put model keys or service-role credentials in the repository | REJECT | Violates the trusted-ingress boundary and credential isolation. |

## Verification gates

1. Static contract tests require all three revokes and the service-role grant.
2. Apply the versioned migration through Supabase migration tooling.
3. Read back `has_function_privilege` for all four roles.
4. Re-run Supabase security and performance advisors.
5. Keep agent-facing ingress `PREPARE_ONLY` until it verifies model identity;
   no client receives the service-role credential.

## Primary sources

- Supabase Database Advisor lint 0028: <https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0028_anon_security_definer_function_executable>
- Supabase Database Advisor lint 0029: <https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0029_authenticated_security_definer_function_executable>
- Supabase database functions security guidance: <https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker>
- PostgreSQL function privileges: <https://www.postgresql.org/docs/current/sql-grant.html>
