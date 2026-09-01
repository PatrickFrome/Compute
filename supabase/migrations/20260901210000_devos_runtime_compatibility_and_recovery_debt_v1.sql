begin;

create or replace function public.devos_runtime_capabilities_v1()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $function$
select jsonb_build_object(
  'schema', 'metaengine.native-browser-supervisor.capabilities.v1',
  'protocol_generation', 2,
  'features', jsonb_build_object(
    'signed_device_auth_v1', true,
    'typed_commands_only_v1', true,
    'devos_cycle_v1', true,
    'devos_ambiguity_reconcile_v2', true,
    'devos_transport_promotion_v1', true,
    'devos_scheduler_capacity_v1', true,
    'meta_orchestrator_superstep_v1', true,
    'meta_orchestrator_controller_lease_v1', true,
    'meta_atomic_frontier_v2', true,
    'post_lock_transport_revalidation_v1', true
  ),
  'ambiguity_recovery_classes', jsonb_build_array('PRE_EFFECT_ABORTED', 'EFFECT_PROVEN'),
  'scheduler_source', 'NATIVE_SUPERVISOR_HEARTBEAT',
  'second_scheduler_loop', false,
  'automatic_retry_allowed', false,
  'arbitrary_eval', false,
  'page_model_text_authority', false,
  'authority_effect', false
)
$function$;

revoke all on function public.devos_runtime_capabilities_v1() from public, anon, authenticated;
grant execute on function public.devos_runtime_capabilities_v1() to service_role;

create or replace function public.devos_recovery_debt_snapshot_v1(p_workspace uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, destruktion_meta
as $function$
with ambiguous as (
  select t.task_id, t.lease_generation, t.error_code
  from destruktion_meta.devos_fleet_task_h205f22 t
  where t.workspace_id = p_workspace
    and t.state = 'AMBIGUOUS'
), classified as (
  select
    a.task_id,
    a.lease_generation,
    a.error_code,
    exists (
      select 1
      from destruktion_meta.devos_fleet_event_h205f22 e
      where e.workspace_id = p_workspace
        and e.task_id = a.task_id
        and e.lease_generation = a.lease_generation
        and e.event_type = 'TASK_TRANSPORT_PROVEN'
        and coalesce(e.payload->>'prompt_sha256','') ~ '^[0-9a-f]{64}$'
        and coalesce(e.payload->>'conversation_url_sha256','') ~ '^[0-9a-f]{64}$'
        and coalesce(e.payload->>'effect_state','') in ('PROVEN_GENERATING','PROVEN_NEW_CONVERSATION','PROVEN_CONVERSATION')
    ) as effect_proven
  from ambiguous a
), counts as (
  select
    count(*)::bigint as ambiguous_total,
    count(*) filter (where effect_proven)::bigint as effect_proven_count,
    count(*) filter (where not effect_proven)::bigint as effect_unknown_count,
    count(*) filter (where error_code = 'LEASE_EXPIRED_EFFECT_UNKNOWN')::bigint as lease_expired_effect_unknown_count
  from classified
), fleet as (
  select
    count(*) filter (where t.state = 'READY')::bigint as ready_backlog,
    count(*) filter (where t.state in ('LEASED','RUNNING'))::bigint as inflight_backlog
  from destruktion_meta.devos_fleet_task_h205f22 t
  where t.workspace_id = p_workspace
), claims as (
  select count(*)::bigint as active_claims
  from destruktion_meta.devos_fleet_claim_h205f22 c
  where c.workspace_id = p_workspace and c.state = 'ACTIVE'
)
select jsonb_build_object(
  'schema', 'metaengine.devos.recovery-debt.v1',
  'workspace_id', p_workspace,
  'state', case
    when counts.ambiguous_total = 0 then 'CLEAR'
    when counts.effect_unknown_count = 0 then 'EFFECT_PROVEN_ONLY'
    else 'EFFECT_UNKNOWN_PRESENT'
  end,
  'ambiguous_total', counts.ambiguous_total,
  'effect_proven_count', counts.effect_proven_count,
  'effect_unknown_count', counts.effect_unknown_count,
  'lease_expired_effect_unknown_count', counts.lease_expired_effect_unknown_count,
  'ready_backlog', fleet.ready_backlog,
  'inflight_backlog', fleet.inflight_backlog,
  'active_claims', claims.active_claims,
  'task_content_returned', false,
  'physical_effect_replayed', false,
  'automatic_retry_allowed', false,
  'scheduler_authority', false,
  'browser_authority', false,
  'release_authority', false,
  'authority_effect', false
)
from counts cross join fleet cross join claims
$function$;

revoke all on function public.devos_recovery_debt_snapshot_v1(uuid) from public, anon, authenticated;
grant execute on function public.devos_recovery_debt_snapshot_v1(uuid) to service_role;

commit;
