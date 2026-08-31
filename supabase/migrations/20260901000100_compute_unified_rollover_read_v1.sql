create or replace function public.h205f22_compute_unified_rollover_read_v1(p_workspace uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with params as (
  select statement_timestamp() as observed_at
), browser as (
  select jsonb_build_object(
    'present', true,
    'client_id', s.client_id,
    'last_seen_at', s.last_seen_at,
    'stale', (p.observed_at - s.last_seen_at) > interval '30 seconds',
    'runtime', jsonb_strip_nulls(jsonb_build_object(
      'process_incarnation_id', s.state->>'process_incarnation_id',
      'supervisor_generation', s.state#>>'{supervisor_lifecycle,supervisor_generation}',
      'quiescent', s.state#>'{supervisor_lifecycle,quiescent}',
      'keepalive', jsonb_strip_nulls(jsonb_build_object(
        'state', s.state#>>'{supervisor_lifecycle,keepalive,state}',
        'supervisor_id', s.state#>>'{supervisor_lifecycle,keepalive,supervisor_id}',
        'supervisor_epoch', s.state#>'{supervisor_lifecycle,keepalive,supervisor_epoch}',
        'active_wake_id', s.state#>>'{supervisor_lifecycle,keepalive,active_wake,wake_id}',
        'pending_wake_id', s.state#>>'{supervisor_lifecycle,keepalive,pending_wake,wake_id}',
        'queued_wake_count', jsonb_array_length(coalesce(s.state#>'{supervisor_lifecycle,keepalive,queued_wakes}', '[]'::jsonb))
      )),
      'self_update', jsonb_strip_nulls(jsonb_build_object(
        'state', s.state#>>'{self_update,state}',
        'current_version', s.state#>>'{self_update,current_version}',
        'trusted_channel', s.state#>>'{self_update,trusted_channel}',
        'restart_gate_safe', s.state#>'{self_update,restart_gate_safe}'
      ))
    )),
    'authority_effect', false
  ) as value
  from public.compute_fabric_a2_browser_supervisor_state_h205f22 s
  cross join params p
  where s.workspace_id = p_workspace
  order by s.last_seen_at desc nulls last
  limit 1
), leases as (
  select jsonb_build_object(
    'active_unreleased_count', count(*) filter (
      where l.status = 'ACTIVE'
        and l.released_at is null
        and (l.expires_at is null or l.expires_at > p.observed_at)
    ),
    'authority_effect', false
  ) as value
  from public.compute_fabric_a2_supervisor_actuation_lease_h205f22 l
  cross join params p
  where l.workspace_id = p_workspace
)
select jsonb_build_object(
  'schema', 'metaengine.compute-unified.rollover-read.v1',
  'observed_at', p.observed_at,
  'workspace_id', p_workspace,
  'browser_supervisor', coalesce((select value from browser), jsonb_build_object('present', false, 'stale', true, 'authority_effect', false)),
  'actuation_leases', coalesce((select value from leases), jsonb_build_object('active_unreleased_count', 0, 'authority_effect', false)),
  'authority_effect', false
)
from params p;
$$;

revoke all on function public.h205f22_compute_unified_rollover_read_v1(uuid) from public;
revoke all on function public.h205f22_compute_unified_rollover_read_v1(uuid) from anon;
revoke all on function public.h205f22_compute_unified_rollover_read_v1(uuid) from authenticated;
grant execute on function public.h205f22_compute_unified_rollover_read_v1(uuid) to service_role;
