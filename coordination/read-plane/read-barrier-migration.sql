-- read-barrier-migration.sql — coordination_read_barrier_h205f22() v1
--
-- PR-FIRST artifact (apply via ChatGPT apply_migration after PR review —
-- PAP-1.3 §12: DDL must be reproducible from Git).
-- Fixes the three fingerprint-v2 implementation defects (ChatGPT review
-- 2026-08-23): claim/run lease conflation, milestone-scoped fences,
-- client wall clock. ONE atomic statement snapshot for the whole
-- authority + semantic domain.
--
-- Design contract (per PAP-1.3 + sync-defect-1 + this review):
--   effective_claim_live = state = 'ACTIVE' AND expires_at > clock_timestamp()
--   fences are execution-plane confirmations, NEVER claim-liveness source.
--   Plane separation: PROJECT CLAIM LEASE != AOP RUN LEASE != PAP TRANSPORT LEASE.
--
-- SECURITY: SECURITY DEFINER, executes with the migration owner's role.
-- It is intentionally callable only by service_role.  Postgres grants EXECUTE
-- on new functions to PUBLIC by default, so the explicit revokes below are a
-- required part of this contract rather than optional hardening.

create or replace function public.coordination_read_barrier_h205f22()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_db_now timestamptz := clock_timestamp();
  v_semantic_head jsonb;
  v_claims jsonb;
  v_runs jsonb;
  v_directives jsonb;
  v_roadmap jsonb;
  v_valid_until timestamptz;
begin
  -- semantic head (single source)
  select to_jsonb(s)
    into v_semantic_head
    from destruktion_meta.semantic_checkpoint_h205f22 s
   order by s.created_at desc
   limit 1;

  -- claims with EFFECTIVE liveness computed IN the database
  select coalesce(jsonb_agg(row_to_json(c.*) order by c.claim_id), '[]'::jsonb)
    into v_claims
    from (
      select
        claim_id,
        holder,
        state                          as stored_state,
        claimed_at,
        expires_at                      as claim_expires_at,
        (state = 'ACTIVE' and expires_at > v_db_now)
                                       as effective_claim_live,
        roadmap_milestone_key
        from destruktion_meta.compute_fabric_roadmap_claim_h205f22
       where state in ('ACTIVE', 'READY')
    ) c;

  -- execution runs (lease state at db_now; fences correlated by run_id)
  select coalesce(jsonb_agg(row_to_json(r.*) order by r.run_id), '[]'::jsonb)
    into v_runs
    from (
      select
        run_id,
        milestone_key,
        state,
        lease_owner,
        lease_expires_at,
        (lease_expires_at is not null and lease_expires_at > v_db_now)
                                       as lease_live_at_barrier,
        attempt_count
        from destruktion_meta.fabric_run_h205f22
       where state in ('QUEUED', 'LEASED', 'WAITING_EVENT')
         and updated_at > v_db_now - interval '7 days'
    ) r;

  -- supervisor directives (current)
  select coalesce(jsonb_agg(row_to_json(d.*) order by d.directive_id desc), '[]'::jsonb)
    into v_directives
    from (
      select directive_id, milestone_key, state, created_at
        from destruktion_meta.aop1_directive_h205f22
       where created_at > v_db_now - interval '2 days'
    ) d;

  -- roadmap effective status (authoritative projection)
  select coalesce(jsonb_agg(row_to_json(m.*) order by m.milestone_key), '[]'::jsonb)
    into v_roadmap
    from (
      select milestone_key, effective_status
        from destruktion_meta.compute_fabric_roadmap_milestone_h205f22
       where effective_status <> 'PLANNED'
    ) m;

  -- validity window: shortest live claim expiry capped at 60s
  select min(least(expires_at, v_db_now + interval '60 seconds'))
    into v_valid_until
    from destruktion_meta.compute_fabric_roadmap_claim_h205f22
   where state = 'ACTIVE' and expires_at > v_db_now;

  return jsonb_build_object(
    'schema', 'metaengine.coordination.read-barrier.h205f22.v1',
    'db_now', v_db_now,
    'valid_until', coalesce(v_valid_until, v_db_now + interval '60 seconds'),
    'semantic_head', v_semantic_head,
    'claims', v_claims,
    'execution_runs', v_runs,
    'directives', v_directives,
    'roadmap', v_roadmap,
    'authority_effect', false
  );
exception
  when undefined_table then
    -- PREPARED contract: actual table names in destruktion_meta may differ;
    -- PR review must reconcile names BEFORE apply. Fail closed with detail.
    return jsonb_build_object(
      'schema', 'metaengine.coordination.read-barrier.h205f22.v1',
      'error', 'READ_BARRIER_SCHEMA_MISMATCH',
      'detail', 'One or more destruktion_meta tables not found; reconcile names in PR review.',
      'db_now', v_db_now,
      'authority_effect', false
    );
end;
$$;

-- Trusted read-plane ingress only.  Untrusted clients must not be able to use
-- this privileged function to bypass the private-schema RLS boundary.
revoke execute on function public.coordination_read_barrier_h205f22()
  from public, anon, authenticated;
grant execute on function public.coordination_read_barrier_h205f22()
  to service_role;

-- NOTE FOR PR REVIEW (ChatGPT):
--   1. Table/column names in destruktion_meta are best-effort from public
--      surfaces; verify against actual schema before apply (fail-closed
--      handler covers mismatch).
--   2. v_valid_until caps at +60s so clients treat the barrier as a point
--      snapshot, not a lease.
--   3. After this lands, fingerprint v2.2 authority section upgrades from
--      NOT_COMPUTABLE to barrier-derived (semantic+authority+frontier).
