-- MAIN_ROADMAP_LEASE_RECONCILIATION_V1
-- Definition only. Applying this migration creates a supervisor-token-gated
-- reconciliation primitive; it does not execute reconciliation by itself.

create or replace function destruktion_meta.compute_fabric_supervisor_reconcile_roadmap_leases_h205f22(
  p_supervisor_token uuid
)
returns jsonb
language plpgsql
security invoker
set search_path to 'pg_catalog', 'destruktion_meta', 'extensions'
as $function$
declare
  v_s destruktion_meta.compute_fabric_supervisor_control_h205f22%rowtype;
  v_observed_at timestamptz := statement_timestamp();
  v_claims jsonb := '[]'::jsonb;
  v_directives jsonb := '[]'::jsonb;
  v_milestones jsonb := '[]'::jsonb;
begin
  select *
    into v_s
    from destruktion_meta.compute_fabric_supervisor_control_h205f22
   where supervisor_key = 'COMPUTE_FABRIC_MAINLINE'
     and supervisor_token = p_supervisor_token
     and mode = 'ACTIVE'
   for update;

  if not found then
    raise exception 'active supervisor token required';
  end if;

  if not pg_try_advisory_xact_lock(hashtext('metaengine:h205f22:roadmap-lease-reconcile')) then
    return jsonb_build_object(
      'schema', 'metaengine.compute.main-roadmap-lease-reconciliation.h205f22.v1',
      'status', 'SKIPPED_LOCKED',
      'roadmap_id', v_s.roadmap_id,
      'observed_at', v_observed_at,
      'database_mutation', false,
      'authority_effect', false,
      'provider_mutation', false,
      'edge_deployment', false,
      'pr_merge', false,
      'checkpoint_promotion', false
    );
  end if;

  with expired as (
    update destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 c
       set state = 'EXPIRED'
     where c.roadmap_id = v_s.roadmap_id
       and c.state = 'ACTIVE'
       and c.expires_at <= v_observed_at
    returning c.claim_id, c.milestone_key, c.holder_id, c.expires_at
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'claim_id', claim_id,
        'milestone_key', milestone_key,
        'holder_id', holder_id,
        'expires_at', expires_at,
        'new_state', 'EXPIRED'
      )
      order by claim_id
    ),
    '[]'::jsonb
  )
  into v_claims
  from expired;

  with closed as (
    update destruktion_meta.compute_fabric_supervisor_directive_h205f22 d
       set status = 'SUPERSEDED',
           superseded_at = coalesce(d.superseded_at, v_observed_at)
     where d.roadmap_id = v_s.roadmap_id
       and d.status = 'ACTIVE'
       and d.expires_at is not null
       and d.expires_at <= v_observed_at
    returning d.directive_id, d.milestone_key, d.directive_kind, d.expires_at
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'directive_id', directive_id,
        'milestone_key', milestone_key,
        'directive_kind', directive_kind,
        'expires_at', expires_at,
        'new_status', 'SUPERSEDED'
      )
      order by directive_id
    ),
    '[]'::jsonb
  )
  into v_directives
  from closed;

  with reset as (
    update destruktion_meta.compute_fabric_roadmap_milestone_h205f22 m
       set status = 'PLANNED',
           updated_at = v_observed_at
     where m.roadmap_id = v_s.roadmap_id
       and m.status = 'IN_PROGRESS'
       and not exists (
         select 1
           from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 c
          where c.roadmap_id = m.roadmap_id
            and c.milestone_key = m.milestone_key
            and c.state = 'ACTIVE'
            and c.expires_at > v_observed_at
       )
    returning m.milestone_key
  )
  select coalesce(jsonb_agg(milestone_key order by milestone_key), '[]'::jsonb)
    into v_milestones
    from reset;

  return jsonb_build_object(
    'schema', 'metaengine.compute.main-roadmap-lease-reconciliation.h205f22.v1',
    'status', 'RECONCILED',
    'roadmap_id', v_s.roadmap_id,
    'observed_at', v_observed_at,
    'expired_claims', v_claims,
    'superseded_expired_directives', v_directives,
    'reset_in_progress_milestones', v_milestones,
    'database_mutation', true,
    'authority_effect', true,
    'provider_mutation', false,
    'edge_deployment', false,
    'pr_merge', false,
    'checkpoint_promotion', false
  );
end
$function$;

revoke all on function destruktion_meta.compute_fabric_supervisor_reconcile_roadmap_leases_h205f22(uuid) from public;
grant execute on function destruktion_meta.compute_fabric_supervisor_reconcile_roadmap_leases_h205f22(uuid) to service_role;
