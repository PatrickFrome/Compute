create or replace function public.h205f22_compute_unified_rollover_checkpoint_envelope_v1(p_workspace uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with evidence as (
  select public.h205f22_compute_unified_rollover_read_v1(p_workspace) as value
), decision as (
  select public.h205f22_compute_unified_supervisor_rollover_decision_v1(e.value) as value
  from evidence e
)
select jsonb_build_object(
  'schema', 'metaengine.compute-unified.rollover-checkpoint-envelope.v1',
  'workspace_id', p_workspace,
  'observed_at', e.value->'observed_at',
  'evidence', e.value,
  'decision', d.value,
  'continuity_identity', jsonb_strip_nulls(jsonb_build_object(
    'client_id', e.value#>>'{browser_supervisor,client_id}',
    'process_incarnation_id', e.value#>>'{browser_supervisor,runtime,process_incarnation_id}',
    'supervisor_id', e.value#>>'{browser_supervisor,runtime,keepalive,supervisor_id}',
    'supervisor_epoch', e.value#>'{browser_supervisor,runtime,keepalive,supervisor_epoch}',
    'current_version', e.value#>>'{browser_supervisor,runtime,self_update,current_version}'
  )),
  'persistence_authorized', false,
  'restart_authorized', false,
  'wake_replay_authorized', false,
  'lease_mutation_authorized', false,
  'authority_effect', false
)
from evidence e
cross join decision d;
$$;

revoke all on function public.h205f22_compute_unified_rollover_checkpoint_envelope_v1(uuid) from public;
revoke all on function public.h205f22_compute_unified_rollover_checkpoint_envelope_v1(uuid) from anon;
revoke all on function public.h205f22_compute_unified_rollover_checkpoint_envelope_v1(uuid) from authenticated;
grant execute on function public.h205f22_compute_unified_rollover_checkpoint_envelope_v1(uuid) to service_role;
