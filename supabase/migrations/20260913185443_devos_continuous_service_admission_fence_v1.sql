-- METAENGINE DevOS runtime-coherence repair v1.
-- Single existing control plane: destruktion_meta.devos_fleet_runtime_control_h205f22.
-- Fence continuous-service enqueue / refill / lease / fleet transport-promotion while
-- supervisor admission is closed. Sentinel and self-update native paths are untouched.

alter function public.devos_fleet_enqueue_v1(uuid,text,text,text,jsonb,text,text,integer)
  rename to devos_fleet_enqueue_legacy_admission_h205f22;
revoke all on function public.devos_fleet_enqueue_legacy_admission_h205f22(uuid,text,text,text,jsonb,text,text,integer)
  from public, anon, authenticated, service_role;

create function public.devos_fleet_enqueue_v1(
  p_workspace uuid,
  p_point text,
  p_role text,
  p_base text,
  p_spec jsonb,
  p_key text,
  p_branch text default null,
  p_priority integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','destruktion_meta'
as $function$
declare
  v_control destruktion_meta.devos_fleet_runtime_control_h205f22%rowtype;
  v_continuous boolean := coalesce(p_spec->>'continuous_role','false')='true';
begin
  if v_continuous then
    select * into v_control
      from destruktion_meta.devos_fleet_runtime_control_h205f22
     where workspace_id=p_workspace;
    if not found then
      return jsonb_build_object(
        'accepted',false,'enqueued',false,'reason','RUNTIME_CONTROL_MISSING',
        'workspace_id',p_workspace,'automatic_retry_allowed',false,'authority_effect',false
      );
    end if;
    if not v_control.refill_enabled or not v_control.supervisor_admission_enabled then
      return jsonb_build_object(
        'accepted',false,'enqueued',false,'reason','CONTINUOUS_SERVICE_ADMISSION_FENCED',
        'workspace_id',p_workspace,
        'generation_floor',v_control.generation_floor,
        'refill_enabled',v_control.refill_enabled,
        'supervisor_admission_enabled',v_control.supervisor_admission_enabled,
        'automatic_retry_allowed',false,'authority_effect',false
      );
    end if;
  end if;
  return public.devos_fleet_enqueue_legacy_admission_h205f22(
    p_workspace,p_point,p_role,p_base,p_spec,p_key,p_branch,p_priority
  );
end
$function$;
revoke all on function public.devos_fleet_enqueue_v1(uuid,text,text,text,jsonb,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.devos_fleet_enqueue_v1(uuid,text,text,text,jsonb,text,text,integer)
  to service_role;

alter function destruktion_meta.devos_maintenance_refill_h205f22()
  rename to devos_maintenance_refill_legacy_admission_h205f22;
revoke all on function destruktion_meta.devos_maintenance_refill_legacy_admission_h205f22()
  from public, anon, authenticated, service_role;

create function destruktion_meta.devos_maintenance_refill_h205f22()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','destruktion_meta','public','extensions'
as $function$
declare
  v_allowed boolean := false;
  v_floor bigint := 0;
  v_refill boolean := false;
  v_admission boolean := false;
begin
  select coalesce(bool_and(refill_enabled and supervisor_admission_enabled),false),
         coalesce(max(generation_floor),0),
         coalesce(bool_and(refill_enabled),false),
         coalesce(bool_and(supervisor_admission_enabled),false)
    into v_allowed,v_floor,v_refill,v_admission
    from destruktion_meta.devos_fleet_runtime_control_h205f22;
  if not v_allowed then
    return jsonb_build_object(
      'ok',true,'skipped','CONTINUOUS_SERVICE_ADMISSION_FENCED',
      'generation_floor',v_floor,'refill_enabled',v_refill,
      'supervisor_admission_enabled',v_admission,
      'created','[]'::jsonb,'automatic_retry_allowed',false,'authority_effect',false
    );
  end if;
  return destruktion_meta.devos_maintenance_refill_legacy_admission_h205f22();
end
$function$;
revoke all on function destruktion_meta.devos_maintenance_refill_h205f22()
  from public, anon, authenticated;
grant execute on function destruktion_meta.devos_maintenance_refill_h205f22()
  to service_role;

alter function destruktion_meta.devos_meta_refill_h205f22()
  rename to devos_meta_refill_legacy_admission_h205f22;
revoke all on function destruktion_meta.devos_meta_refill_legacy_admission_h205f22()
  from public, anon, authenticated, service_role;

create function destruktion_meta.devos_meta_refill_h205f22()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','destruktion_meta','public','extensions'
as $function$
declare
  v_allowed boolean := false;
  v_floor bigint := 0;
  v_refill boolean := false;
  v_admission boolean := false;
begin
  select coalesce(bool_and(refill_enabled and supervisor_admission_enabled),false),
         coalesce(max(generation_floor),0),
         coalesce(bool_and(refill_enabled),false),
         coalesce(bool_and(supervisor_admission_enabled),false)
    into v_allowed,v_floor,v_refill,v_admission
    from destruktion_meta.devos_fleet_runtime_control_h205f22;
  if not v_allowed then
    return jsonb_build_object(
      'ok',true,'skipped','CONTINUOUS_SERVICE_ADMISSION_FENCED',
      'generation_floor',v_floor,'refill_enabled',v_refill,
      'supervisor_admission_enabled',v_admission,
      'created','[]'::jsonb,'automatic_retry_allowed',false,'authority_effect',false
    );
  end if;
  return destruktion_meta.devos_meta_refill_legacy_admission_h205f22();
end
$function$;
revoke all on function destruktion_meta.devos_meta_refill_h205f22()
  from public, anon, authenticated;
grant execute on function destruktion_meta.devos_meta_refill_h205f22()
  to service_role;

create or replace function public.devos_fleet_lease_v1(
  p_workspace uuid,
  p_agent text,
  p_role text,
  p_tab text,
  p_target text,
  p_epoch bigint,
  p_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','destruktion_meta'
as $function$
declare
  v_control destruktion_meta.devos_fleet_runtime_control_h205f22%rowtype;
begin
  if p_workspace is null then
    raise exception 'devos_workspace_required' using errcode='22023';
  end if;
  select * into v_control
    from destruktion_meta.devos_fleet_runtime_control_h205f22
   where workspace_id=p_workspace;
  if not found then
    return jsonb_build_object(
      'leased',false,'agent_id',lower(p_agent),'role',upper(p_role),
      'reason','RUNTIME_CONTROL_MISSING','automatic_retry_allowed',false,'authority_effect',false
    );
  end if;
  if not v_control.supervisor_admission_enabled then
    return jsonb_build_object(
      'leased',false,'agent_id',lower(p_agent),'role',upper(p_role),
      'reason','SUPERVISOR_ADMISSION_FENCED',
      'required_generation_floor',v_control.generation_floor,
      'presented_generation_epoch',p_epoch,
      'automatic_retry_allowed',false,'authority_effect',false
    );
  end if;
  if p_epoch is null or p_epoch < v_control.generation_floor then
    return jsonb_build_object(
      'leased',false,'agent_id',lower(p_agent),'role',upper(p_role),
      'reason','AGENT_GENERATION_FENCED',
      'required_generation_floor',v_control.generation_floor,
      'presented_generation_epoch',p_epoch,
      'automatic_retry_allowed',false,'authority_effect',false
    );
  end if;
  return public.devos_fleet_lease_legacy_h205f22(
    p_workspace,p_agent,p_role,p_tab,p_target,p_epoch,p_seconds
  );
end
$function$;
revoke all on function public.devos_fleet_lease_v1(uuid,text,text,text,text,bigint,integer)
  from public, anon, authenticated;
grant execute on function public.devos_fleet_lease_v1(uuid,text,text,text,text,bigint,integer)
  to service_role;

alter function public.devos_transport_promotion_lease_v1(uuid,text,text,text,text,bigint)
  rename to devos_transport_promotion_lease_legacy_admission_h205f22;
revoke all on function public.devos_transport_promotion_lease_legacy_admission_h205f22(uuid,text,text,text,text,bigint)
  from public, anon, authenticated, service_role;

create function public.devos_transport_promotion_lease_v1(
  p_workspace uuid,
  p_client text,
  p_agent text,
  p_tab text,
  p_target text,
  p_epoch bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','destruktion_meta'
as $function$
declare
  v_control destruktion_meta.devos_fleet_runtime_control_h205f22%rowtype;
begin
  if p_workspace is null then
    raise exception 'devos_promotion_workspace_invalid';
  end if;
  select * into v_control
    from destruktion_meta.devos_fleet_runtime_control_h205f22
   where workspace_id=p_workspace;
  if not found then
    return jsonb_build_object(
      'leased',false,'status','FENCED','reason','RUNTIME_CONTROL_MISSING',
      'automatic_retry_allowed',false,'authority_effect',false
    );
  end if;
  if not v_control.supervisor_admission_enabled then
    return jsonb_build_object(
      'leased',false,'status','FENCED','reason','SUPERVISOR_ADMISSION_FENCED',
      'generation_floor',v_control.generation_floor,
      'presented_generation_epoch',p_epoch,
      'automatic_retry_allowed',false,'authority_effect',false
    );
  end if;
  if p_epoch is null or p_epoch < v_control.generation_floor then
    return jsonb_build_object(
      'leased',false,'status','FENCED','reason','AGENT_GENERATION_FENCED',
      'required_generation_floor',v_control.generation_floor,
      'presented_generation_epoch',p_epoch,
      'automatic_retry_allowed',false,'authority_effect',false
    );
  end if;
  return public.devos_transport_promotion_lease_legacy_admission_h205f22(
    p_workspace,p_client,p_agent,p_tab,p_target,p_epoch
  );
end
$function$;
revoke all on function public.devos_transport_promotion_lease_v1(uuid,text,text,text,text,bigint)
  from public, anon, authenticated;
grant execute on function public.devos_transport_promotion_lease_v1(uuid,text,text,text,text,bigint)
  to service_role;

-- Preserve leaked work as immutable terminal evidence rather than deleting it.
update destruktion_meta.devos_fleet_task_h205f22
   set state='FENCED',
       error_code='SUPERVISOR_ADMISSION_FENCED',
       result_summary=jsonb_build_object(
         'reason','CONTINUOUS_SERVICE_CREATED_WHILE_ADMISSION_CLOSED',
         'repair','DEVOS_CONTINUOUS_SERVICE_ADMISSION_FENCE_V1',
         'generation_floor',28,
         'refill_enabled',false,
         'supervisor_admission_enabled',false,
         'automatic_retry_allowed',false,
         'authority_effect',false
       ),
       updated_at=clock_timestamp(),
       finished_at=coalesce(finished_at,clock_timestamp()),
       authority_effect=false
 where workspace_id='2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid
   and state='READY'
   and task_spec->>'continuous_role'='true';