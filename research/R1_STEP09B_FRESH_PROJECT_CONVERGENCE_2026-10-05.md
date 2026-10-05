# R1 STEP09B fresh-project convergence — 2026-10-05

Status: IMPLEMENTATION CANDIDATE / no canonical promotion  
Parent: `c2178e0e52b665e3b379cfab74a02ab87e130ec6`  
Canonical owner: **R1 Continuity Plane Adoption**, Level-2 acceptance gate **R2_TWO_DOMAIN_PERSISTED_READBACK**

## Finding

The fresh project has the R1 H41–H49 substrate deployed by live migration `20261005192022_r1_continuity_fresh_project_convergence_v1`, but `destruktion_meta.compute_ingest_r2_projection_h205f22(jsonb,jsonb)` is absent.

The historical STEP09B v2 implementation is already hardened and should not be redesigned. The fresh-project convergence therefore embeds the exact repository bytes of `supabase/migrations/20260821235859_r1_step09b_idempotency_truthfulness_v2.sql` and adds only deployment preconditions/postconditions around it.

## Preserved trust boundary

- `SECURITY INVOKER`, empty pinned search path.
- EXECUTE revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`; granted only to `postgres`.
- READ COMMITTED required at DB execution.
- Object-scoped transaction advisory lock.
- Exact-match-or-insert append-only semantics; no `DO UPDATE`.
- DB-time trusted-root/readback freshness checks.
- Exactly two distinct provider/operator/failure domains for schema v1.
- Existing continuity observation/readiness/audit functions remain the authority for database-derived R2.
- No persisted seal, no R3, no canonical roadmap promotion.

## Verification plan

1. Existing STEP09B Python adversarial suite and STEP08/STEP09A regressions on the exact branch head.
2. Static proof that this operation contains the exact historical v2 migration text.
3. Live post-deploy structural/ACL canary plus an invalid-payload fail-close call.
4. Production continuity row counts must remain unchanged after deployment/canary.
5. A valid live STEP09B call remains forbidden until real STEP08 provider materialization and fresh STEP09A authority receipt exist.

## Nonclaims

This convergence does not create provider credentials, make provider calls, fabricate readback observations, prove R2, create an H47C persisted seal, prove R3, or promote the canonical roadmap.
