-- read-barrier-migration.sql — coordination_read_barrier_h205f22() v1.1
--
-- PR-FIRST synchronization hardening for PAP-1.3.
-- Reviewed against the LIVE destruktion_meta schema by ChatGPT on 2026-08-23.
--
-- Core invariants:
--   PROJECT CLAIM LEASE != AOP RUN LEASE != PAP TRANSPORT LEASE.
--   project claim liveness comes ONLY from roadmap_work_claim.state/expires_at.
--   run liveness comes ONLY from aop_run.state/lease_expires_at plus run-scoped fence.
--   RUN_FENCED is correlated by run_id; it never defines project-claim liveness.
--   barrier time is PostgreSQL statement_timestamp(), constant for this RPC call.
--
-- SECURITY:
--   SECURITY DEFINER is required because underlying destruktion_meta tables are private.
--   The public RPC is explicitly REVOKED from PUBLIC/anon/authenticated and granted
--   only to service_role, matching the existing h205f22_* read RPC security surface.
--   No claim_token, service key, bearer token, or other secret is returned.

create or replace function public.coordination_read_barrier_h205f22()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, destruktion_meta
as $$
declare
  v_db_now timestamptz := statement_timestamp();
  v_roadmap_status jsonb;
  v_claims jsonb;
  v_runs jsonb;
  v_directives jsonb;
  v_valid_until timestamptz;
begin
  -- Canonical roadmap projection and semantic head. The existing roadmap function
  -- already derives effective milestone status from live claim expiry.
  v_roadmap_status := destruktion_meta.compute_fabric_roadmap_status_h205f22();

  -- PROJECT CLAIM plane. Intentionally omits claim_token.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'claim_id', c.claim_id,
               'roadmap_id', c.roadmap_id,
               'milestone_key', c.milestone_key,
               'holder_id', c.holder_id,
               'stored_state', c.state,
               'claimed_at', c.claimed_at,
               'heartbeat_at', c.heartbeat_at,
               'claim_expires_at', c.expires_at,
               'effective_claim_live', (c.state = 'ACTIVE' and c.expires_at > v_db_now),
               'base_checkpoint_id', c.base_checkpoint_id,
               'base_payload_root_sha256', c.base_payload_root_sha256
             ) order by c.claim_id
           ),
           '[]'::jsonb
         )
    into v_claims
    from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 c
   where c.state = 'ACTIVE'
      or c.claimed_at > v_db_now - interval '7 days';

  -- AOP EXECUTION plane. Fence is correlated strictly by run_id. The explicit
  -- bound_claim_live field is informational; the two leases remain distinct.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'run_id', r.run_id,
               'roadmap_id', r.roadmap_id,
               'milestone_key', r.milestone_key,
               'role_key', r.role_key,
               'claim_id', r.claim_id,
               'directive_id', r.directive_id,
               'stored_state', r.state,
               'lease_owner', r.lease_owner,
               'lease_generation', r.lease_generation,
               'lease_expires_at', r.lease_expires_at,
               'effective_run_live', (
                 r.state = 'LEASED'
                 and r.lease_expires_at is not null
                 and r.lease_expires_at > v_db_now
                 and f.event_id is null
               ),
               'attempt_count', r.attempt_count,
               'latest_fence_event_id', f.event_id,
               'latest_fence_at', f.created_at,
               'claim_binding_resolved', (r.claim_id is null or c.claim_id is not null),
               'bound_claim_live', case
                 when r.claim_id is null then null
                 else (c.state = 'ACTIVE' and c.expires_at > v_db_now)
               end,
               'mutation_authority_possible', (
                 r.claim_id is not null
                 and c.state = 'ACTIVE'
                 and c.expires_at > v_db_now
                 and r.state = 'LEASED'
                 and r.lease_expires_at is not null
                 and r.lease_expires_at > v_db_now
                 and f.event_id is null
               )
             ) order by r.run_id
           ),
           '[]'::jsonb
         )
    into v_runs
    from destruktion_meta.compute_fabric_aop_run_h205f22 r
    left join destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 c
      on c.claim_id = r.claim_id
    left join lateral (
      select e.event_id, e.created_at
        from destruktion_meta.compute_fabric_aop_event_h205f22 e
       where e.run_id = r.run_id
         and e.event_type = 'RUN_FENCED'
       order by e.event_id desc
       limit 1
    ) f on true
   where r.updated_at > v_db_now - interval '7 days';

  -- SUPERVISOR DIRECTIVE plane. Stored and effective state are both exposed so
  -- stale ACTIVE rows with expired timestamps cannot be mistaken for authority.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'directive_id', d.directive_id,
               'roadmap_id', d.roadmap_id,
               'milestone_key', d.milestone_key,
               'directive_kind', d.directive_kind,
               'target_holder_id', d.target_holder_id,
               'stored_status', d.status,
               'created_at', d.created_at,
               'expires_at', d.expires_at,
               'effective_directive_live', (
                 d.status = 'ACTIVE'
                 and (d.expires_at is null or d.expires_at > v_db_now)
               )
             ) order by d.directive_id desc
           ),
           '[]'::jsonb
         )
    into v_directives
    from destruktion_meta.compute_fabric_supervisor_directive_h205f22 d
   where d.status = 'ACTIVE'
      or d.created_at > v_db_now - interval '7 days';

  -- Clients must treat a barrier response as a point-in-time projection. Bound
  -- its freshness by the nearest live temporal authority edge and by +60s.
  select min(boundary_at)
    into v_valid_until
    from (
      select least(c.expires_at, v_db_now + interval '60 seconds') as boundary_at
        from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 c
       where c.state = 'ACTIVE' and c.expires_at > v_db_now
      union all
      select least(r.lease_expires_at, v_db_now + interval '60 seconds')
        from destruktion_meta.compute_fabric_aop_run_h205f22 r
       where r.state = 'LEASED'
         and r.lease_expires_at is not null
         and r.lease_expires_at > v_db_now
      union all
      select least(d.expires_at, v_db_now + interval '60 seconds')
        from destruktion_meta.compute_fabric_supervisor_directive_h205f22 d
       where d.status = 'ACTIVE'
         and d.expires_at is not null
         and d.expires_at > v_db_now
    ) boundaries;

  return jsonb_build_object(
    'schema', 'metaengine.coordination.read-barrier.h205f22.v1.1',
    'db_now', v_db_now,
    'valid_until', coalesce(v_valid_until, v_db_now + interval '60 seconds'),
    'semantic_head', v_roadmap_status -> 'semantic_head',
    'definition_integrity', v_roadmap_status -> 'definition_integrity',
    'claims', v_claims,
    'execution_runs', v_runs,
    'directives', v_directives,
    'roadmap_status', v_roadmap_status,
    'plane_separation', jsonb_build_object(
      'project_claim_lease', 'compute_fabric_roadmap_work_claim_h205f22.expires_at',
      'aop_run_lease', 'compute_fabric_aop_run_h205f22.lease_expires_at',
      'fence_scope', 'compute_fabric_aop_event_h205f22.run_id'
    ),
    'canonical', false,
    'authority_effect', false
  );
end;
$$;

revoke all on function public.coordination_read_barrier_h205f22() from public;
revoke all on function public.coordination_read_barrier_h205f22() from anon;
revoke all on function public.coordination_read_barrier_h205f22() from authenticated;
grant execute on function public.coordination_read_barrier_h205f22() to service_role;

comment on function public.coordination_read_barrier_h205f22() is
  'Read-only H205F22 synchronization barrier. Computes project-claim and AOP-run liveness separately at PostgreSQL statement time; service_role only; authority_effect=false.';
