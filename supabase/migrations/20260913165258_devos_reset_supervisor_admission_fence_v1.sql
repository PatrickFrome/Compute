-- Prevent stale local Browser supervisor identities from rematerializing after a
-- controlled DevOS reset. Refill and supervisor admission are independent so a
-- clean generation may be admitted before legacy roadmap auto-refill is resumed.

alter table destruktion_meta.devos_fleet_runtime_control_h205f22
  add column if not exists supervisor_admission_enabled boolean not null default true;

update destruktion_meta.devos_fleet_runtime_control_h205f22
   set supervisor_admission_enabled=false,
       updated_at=clock_timestamp()
 where refill_enabled=false
   and reset_at is not null;

alter function public.h205f22_a2_supervisor_mesh_sync_v1(text,jsonb)
  rename to h205f22_a2_supervisor_mesh_sync_legacy_h205f22;

revoke all on function public.h205f22_a2_supervisor_mesh_sync_legacy_h205f22(text,jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.h205f22_a2_supervisor_mesh_sync_v1(
  p_client_id text,
  p_mesh jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','destruktion_meta'
as $function$
declare
  v_workspace constant uuid := '2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid;
  v_enabled boolean := true;
begin
  select coalesce(c.supervisor_admission_enabled,true)
    into v_enabled
    from destruktion_meta.devos_fleet_runtime_control_h205f22 c
   where c.workspace_id=v_workspace;

  v_enabled := coalesce(v_enabled,true);

  if not v_enabled then
    return jsonb_build_object(
      'schema','metaengine.supervisor-mesh.sync.v1',
      'supervisor_count',0,
      'skipped','ENVIRONMENT_RESET_SUPERVISOR_ADMISSION_FENCED',
      'supervisor_admission_enabled',false,
      'automatic_retry_allowed',false,
      'authority_effect',false
    );
  end if;

  return public.h205f22_a2_supervisor_mesh_sync_legacy_h205f22(p_client_id,p_mesh);
end
$function$;

revoke all on function public.h205f22_a2_supervisor_mesh_sync_v1(text,jsonb)
  from public, anon, authenticated;
grant execute on function public.h205f22_a2_supervisor_mesh_sync_v1(text,jsonb)
  to service_role;

-- Wrap reset atomically: admission is fenced before any stale identities are
-- deleted, so a concurrent Browser heartbeat cannot repopulate the mesh.
alter function public.devos_environment_reset_v1(uuid,text)
  rename to devos_environment_reset_legacy_h205f22;

revoke all on function public.devos_environment_reset_legacy_h205f22(uuid,text)
  from public, anon, authenticated, service_role;

create or replace function public.devos_environment_reset_v1(
  p_workspace uuid,
  p_reason text default 'CONTROLLED_RESET'
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','destruktion_meta'
as $function$
declare
  v_result jsonb;
begin
  if p_workspace is null then
    raise exception 'devos_workspace_required' using errcode='22023';
  end if;

  insert into destruktion_meta.devos_fleet_runtime_control_h205f22(workspace_id,supervisor_admission_enabled)
  values(p_workspace,false)
  on conflict (workspace_id) do update
     set supervisor_admission_enabled=false,
         updated_at=clock_timestamp(),
         authority_effect=false;

  v_result := public.devos_environment_reset_legacy_h205f22(p_workspace,p_reason);

  return v_result || jsonb_build_object('supervisor_admission_enabled',false);
end
$function$;

revoke all on function public.devos_environment_reset_v1(uuid,text)
  from public, anon, authenticated;
grant execute on function public.devos_environment_reset_v1(uuid,text)
  to service_role;

-- Keep resume exact-generation fenced and make it the explicit point that
-- re-enables both stale-roadmap refill and supervisor admission.
alter function public.devos_environment_resume_v1(uuid,bigint)
  rename to devos_environment_resume_legacy_h205f22;

revoke all on function public.devos_environment_resume_legacy_h205f22(uuid,bigint)
  from public, anon, authenticated, service_role;

create or replace function public.devos_environment_resume_v1(
  p_workspace uuid,
  p_expected_generation_floor bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','destruktion_meta'
as $function$
declare
  v_result jsonb;
begin
  v_result := public.devos_environment_resume_legacy_h205f22(
    p_workspace,p_expected_generation_floor
  );

  update destruktion_meta.devos_fleet_runtime_control_h205f22
     set supervisor_admission_enabled=true,
         updated_at=clock_timestamp(),
         authority_effect=false
   where workspace_id=p_workspace
     and generation_floor=p_expected_generation_floor;

  if not found then
    raise exception 'devos_environment_resume_generation_mismatch' using errcode='40001';
  end if;

  return v_result || jsonb_build_object('supervisor_admission_enabled',true);
end
$function$;

revoke all on function public.devos_environment_resume_v1(uuid,bigint)
  from public, anon, authenticated;
grant execute on function public.devos_environment_resume_v1(uuid,bigint)
  to service_role;

-- Separate admission from refill so a new clean Browser generation can be
-- admitted while old roadmap auto-refill remains safely disabled.
create or replace function public.devos_supervisor_admission_v1(
  p_workspace uuid,
  p_expected_generation_floor bigint,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','destruktion_meta'
as $function$
declare
  v_refill boolean;
begin
  if p_workspace is null or p_expected_generation_floor is null or p_enabled is null then
    raise exception 'devos_supervisor_admission_arguments_required' using errcode='22023';
  end if;

  update destruktion_meta.devos_fleet_runtime_control_h205f22
     set supervisor_admission_enabled=p_enabled,
         updated_at=clock_timestamp(),
         authority_effect=false
   where workspace_id=p_workspace
     and generation_floor=p_expected_generation_floor
  returning refill_enabled into v_refill;

  if not found then
    raise exception 'devos_supervisor_admission_generation_mismatch' using errcode='40001';
  end if;

  return jsonb_build_object(
    'schema','metaengine.devos.supervisor-admission.v1',
    'ok',true,
    'workspace_id',p_workspace,
    'generation_floor',p_expected_generation_floor,
    'supervisor_admission_enabled',p_enabled,
    'refill_enabled',v_refill,
    'authority_effect',false
  );
end
$function$;

revoke all on function public.devos_supervisor_admission_v1(uuid,bigint,boolean)
  from public, anon, authenticated;
grant execute on function public.devos_supervisor_admission_v1(uuid,bigint,boolean)
  to service_role;

create or replace function public.devos_environment_state_v1(p_workspace uuid)
returns jsonb
language sql
security definer
set search_path to 'pg_catalog','public','destruktion_meta'
as $function$
  select jsonb_build_object(
    'schema','metaengine.devos.environment-state.v1',
    'workspace_id',p_workspace,
    'generation_floor',coalesce(c.generation_floor,0),
    'refill_enabled',coalesce(c.refill_enabled,true),
    'supervisor_admission_enabled',coalesce(c.supervisor_admission_enabled,true),
    'reset_at',c.reset_at,
    'reset_reason',c.reset_reason,
    'authority_effect',false
  )
  from (select 1) one
  left join destruktion_meta.devos_fleet_runtime_control_h205f22 c
    on c.workspace_id=p_workspace;
$function$;

revoke all on function public.devos_environment_state_v1(uuid) from public, anon, authenticated;
grant execute on function public.devos_environment_state_v1(uuid) to service_role;
