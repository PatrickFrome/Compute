-- R101: preserve durable z.ai Agent-origin provenance through the DB receipt.
-- The browser proves Agent Home before promotion and sends the resulting
-- agent_surface_sha256 with every task effect receipt. The DB boundary must
-- not silently drop that digest or accept a Chat-only transport proof.

create or replace function public.devos_fleet_mark_running_v1(
  p_task uuid,
  p_agent text,
  p_generation bigint,
  p_tab text,
  p_target text,
  p_epoch bigint,
  p_proof jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'destruktion_meta'
as $function$
declare
  v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
begin
  if coalesce(p_proof->>'prompt_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(p_proof->>'conversation_url_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(p_proof->>'agent_surface_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(p_proof->>'effect_state','') not in (
       'PROVEN_GENERATING',
       'PROVEN_NEW_CONVERSATION',
       'PROVEN_CONVERSATION',
       'PROVEN_COMPOSER_CLEARED'
     )
  then
    raise exception 'transport_not_proven';
  end if;

  select *
    into v_task
    from destruktion_meta.devos_fleet_task_h205f22
   where task_id = p_task
   for update;

  if not found
     or v_task.state <> 'LEASED'
     or v_task.lease_agent_id <> lower(p_agent)
     or v_task.lease_generation <> p_generation
     or v_task.lease_tab_id <> p_tab
     or v_task.lease_target_id <> lower(p_target)
     or v_task.lease_agent_generation_epoch <> p_epoch
     or v_task.lease_expires_at <= clock_timestamp()
  then
    raise exception 'task_lease_fenced';
  end if;

  update destruktion_meta.devos_fleet_task_h205f22
     set state = 'RUNNING',
         updated_at = clock_timestamp()
   where task_id = p_task;

  perform destruktion_meta.devos_emit_event_h205f22(
    v_task.workspace_id,
    'TASK_TRANSPORT_PROVEN',
    v_task.task_id,
    v_task.point_id,
    v_task.role,
    v_task.lease_agent_id,
    v_task.lease_generation,
    v_task.base_sha,
    jsonb_build_object(
      'prompt_sha256', p_proof->>'prompt_sha256',
      'conversation_url_sha256', p_proof->>'conversation_url_sha256',
      'agent_surface_sha256', p_proof->>'agent_surface_sha256',
      'effect_state', p_proof->>'effect_state',
      'agent_origin_contract', 'ZAI_AGENT_SURFACE_CAUSAL_V1'
    ),
    v_task.idempotency_key || ':transport:' || v_task.lease_generation
  );

  return jsonb_build_object(
    'task_id', p_task,
    'state', 'RUNNING',
    'agent_surface_sha256', p_proof->>'agent_surface_sha256',
    'agent_origin_proven', true,
    'automatic_retry_allowed', false,
    'authority_effect', false
  );
end
$function$;

revoke all on function public.devos_fleet_mark_running_v1(uuid,text,bigint,text,text,bigint,jsonb)
from public, anon, authenticated;
grant execute on function public.devos_fleet_mark_running_v1(uuid,text,bigint,text,text,bigint,jsonb)
to service_role;

comment on function public.devos_fleet_mark_running_v1(uuid,text,bigint,text,text,bigint,jsonb)
is 'Marks an exact leased DevOS task RUNNING only with conversation + Agent-surface provenance; no retry authority.';
