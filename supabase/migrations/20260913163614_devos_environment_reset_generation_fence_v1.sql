-- METAENGINE DevOS: controlled environment reset + durable agent-generation fence.
-- Keeps immutable historical evidence, removes stale execution identities, and
-- prevents pre-reset agents from leasing new work after a reset.

create table if not exists destruktion_meta.devos_fleet_runtime_control_h205f22 (
  workspace_id uuid primary key,
  generation_floor bigint not null default 0 check (generation_floor >= 0),
  refill_enabled boolean not null default true,
  reset_at timestamptz,
  reset_reason text,
  updated_at timestamptz not null default clock_timestamp(),
  authority_effect boolean not null default false
);

revoke all on table destruktion_meta.devos_fleet_runtime_control_h205f22 from public, anon, authenticated, service_role;

insert into destruktion_meta.devos_fleet_runtime_control_h205f22(workspace_id)
select workspace_id
from (
  select distinct workspace_id from destruktion_meta.devos_fleet_task_h205f22
  union
  select distinct workspace_id from public.compute_fabric_a2_browser_supervisor_state_h205f22
) s
where workspace_id is not null
on conflict (workspace_id) do nothing;

-- Preserve the proven lease implementation but remove every external privilege
-- so callers cannot bypass the generation fence added below.
alter function public.devos_fleet_lease_v1(uuid,text,text,text,text,bigint,integer)
  rename to devos_fleet_lease_legacy_h205f22;

revoke all on function public.devos_fleet_lease_legacy_h205f22(uuid,text,text,text,text,bigint,integer)
  from public, anon, authenticated, service_role;

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
  v_floor bigint := 0;
begin
  if p_workspace is null then
    raise exception 'devos_workspace_required' using errcode='22023';
  end if;

  select coalesce(c.generation_floor,0)
    into v_floor
    from destruktion_meta.devos_fleet_runtime_control_h205f22 c
   where c.workspace_id=p_workspace;

  v_floor := coalesce(v_floor,0);

  if p_epoch is null or p_epoch < v_floor then
    return jsonb_build_object(
      'leased',false,
      'agent_id',lower(p_agent),
      'role',upper(p_role),
      'reason','AGENT_GENERATION_FENCED',
      'required_generation_floor',v_floor,
      'presented_generation_epoch',p_epoch,
      'automatic_retry_allowed',false,
      'authority_effect',false
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

-- Watchdog retains all previous expiry/reconciliation behavior, but automatic
-- maintenance/meta refill is explicitly fenced while a workspace is reset.
create or replace function destruktion_meta.devos_fleet_watchdog_h205f22()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','destruktion_meta','public','extensions'
as $function$
declare
  v_result jsonb;
  v_maintenance jsonb;
  v_meta jsonb;
  v_workspace uuid;
  v_supervisor_lost integer := 0;
  v_actuation_expired integer := 0;
  v_refill_enabled boolean := true;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('devos_fleet_watchdog_h205f22',0)) then
    return jsonb_build_object('ok',true,'skipped','LOCK_HELD','authority_effect',false);
  end if;

  if to_regclass('public.compute_fabric_a2_supervisor_actuation_lease_h205f22') is not null then
    update public.compute_fabric_a2_supervisor_actuation_lease_h205f22
       set status='EXPIRED',
           released_at=coalesce(released_at,clock_timestamp()),
           release_reason=coalesce(release_reason,'LEASE_TTL_EXPIRED'),
           authority_effect=false
     where status='ACTIVE'
       and expires_at <= clock_timestamp();
    get diagnostics v_actuation_expired = row_count;
  end if;

  if to_regclass('public.compute_fabric_a2_supervisor_mesh_instance_h205f22') is not null then
    update public.compute_fabric_a2_supervisor_mesh_instance_h205f22
       set status='LOST',
           tab_id=null,
           retired_at=coalesce(retired_at,clock_timestamp()),
           authority_effect=false
     where status='ACTIVE'
       and last_seen_at < clock_timestamp()-interval '45 seconds';
    get diagnostics v_supervisor_lost = row_count;
  end if;

  select workspace_id into v_workspace
    from destruktion_meta.devos_fleet_task_h205f22
   where state in ('LEASED','RUNNING')
   order by updated_at asc
   limit 1;

  if v_workspace is not null then
    v_result := public.devos_fleet_reconcile_v1(v_workspace);
  else
    v_result := jsonb_build_object('ok',true,'expired_count',0,'authority_effect',false);
  end if;

  select coalesce(bool_and(refill_enabled),true)
    into v_refill_enabled
    from destruktion_meta.devos_fleet_runtime_control_h205f22;

  if v_refill_enabled then
    v_maintenance := destruktion_meta.devos_maintenance_refill_h205f22();
    v_meta := destruktion_meta.devos_meta_refill_h205f22();
  else
    v_maintenance := jsonb_build_object('ok',true,'skipped','ENVIRONMENT_RESET_REFILL_FENCED','authority_effect',false);
    v_meta := jsonb_build_object('ok',true,'skipped','ENVIRONMENT_RESET_REFILL_FENCED','authority_effect',false);
  end if;

  return jsonb_build_object(
    'ok',true,
    'supervisors_lost',v_supervisor_lost,
    'actuation_leases_expired',v_actuation_expired,
    'fleet_reconcile',v_result,
    'maintenance_refill',v_maintenance,
    'meta_refill',v_meta,
    'refill_enabled',v_refill_enabled,
    'leases_ready_work',false,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end
$function$;

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

create or replace function public.devos_environment_reset_v1(
  p_workspace uuid,
  p_reason text default 'CONTROLLED_RESET'
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','destruktion_meta','extensions'
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_live_mesh bigint := 0;
  v_live_actuation bigint := 0;
  v_live_claims bigint := 0;
  v_live_tasks bigint := 0;
  v_generation_floor bigint := 1;
  v_deleted_mesh bigint := 0;
  v_deleted_actuation bigint := 0;
  v_deleted_claims bigint := 0;
  v_deleted_tasks bigint := 0;
  v_deleted_cursors bigint := 0;
begin
  if p_workspace is null then
    raise exception 'devos_workspace_required' using errcode='22023';
  end if;
  if length(coalesce(p_reason,'')) > 256 then
    raise exception 'devos_reset_reason_too_long' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('devos_environment_reset_v1:'||p_workspace::text,0));
  perform set_config('metaengine.a2_rpc','on',true);

  insert into destruktion_meta.devos_fleet_runtime_control_h205f22(workspace_id)
  values(p_workspace)
  on conflict (workspace_id) do nothing;

  select count(*) into v_live_mesh
    from public.compute_fabric_a2_supervisor_mesh_instance_h205f22
   where workspace_id=p_workspace
     and status='ACTIVE'
     and retired_at is null
     and last_seen_at > v_now-interval '45 seconds';

  select count(*) into v_live_actuation
    from public.compute_fabric_a2_supervisor_actuation_lease_h205f22
   where workspace_id=p_workspace
     and status='ACTIVE'
     and expires_at > v_now;

  select count(*) into v_live_claims
    from destruktion_meta.devos_fleet_claim_h205f22
   where workspace_id=p_workspace
     and state='ACTIVE'
     and expires_at > v_now;

  select count(*) into v_live_tasks
    from destruktion_meta.devos_fleet_task_h205f22
   where workspace_id=p_workspace
     and state in ('LEASED','RUNNING')
     and lease_expires_at > v_now;

  if v_live_mesh+v_live_actuation+v_live_claims+v_live_tasks > 0 then
    raise exception 'devos_environment_reset_refused_live_execution:mesh=% actuation=% claims=% tasks=%',
      v_live_mesh,v_live_actuation,v_live_claims,v_live_tasks
      using errcode='55000';
  end if;

  select greatest(
           coalesce((select generation_floor+1
                       from destruktion_meta.devos_fleet_runtime_control_h205f22
                      where workspace_id=p_workspace),1),
           coalesce((select max(agent_generation_epoch)+1
                       from destruktion_meta.devos_fleet_claim_h205f22
                      where workspace_id=p_workspace),1),
           coalesce((select max(lease_agent_generation_epoch)+1
                       from destruktion_meta.devos_fleet_task_h205f22
                      where workspace_id=p_workspace),1)
         )
    into v_generation_floor;

  update destruktion_meta.devos_fleet_runtime_control_h205f22
     set generation_floor=v_generation_floor,
         refill_enabled=false,
         reset_at=v_now,
         reset_reason=coalesce(nullif(p_reason,''),'CONTROLLED_RESET'),
         updated_at=v_now,
         authority_effect=false
   where workspace_id=p_workspace;

  delete from destruktion_meta.compute_fabric_a2_peer_cursor_h205f22 c
   using destruktion_meta.compute_fabric_a2_peer_session_h205f22 s
   where c.workspace_id=p_workspace
     and s.workspace_id=p_workspace
     and c.session_id=s.session_id
     and s.status='CLOSED';
  get diagnostics v_deleted_cursors = row_count;

  delete from destruktion_meta.devos_fleet_claim_h205f22
   where workspace_id=p_workspace;
  get diagnostics v_deleted_claims = row_count;

  delete from destruktion_meta.devos_fleet_task_h205f22
   where workspace_id=p_workspace
     and state in ('READY','RESULT_READY','LEASED','RUNNING');
  get diagnostics v_deleted_tasks = row_count;

  delete from public.compute_fabric_a2_supervisor_actuation_lease_h205f22
   where workspace_id=p_workspace;
  get diagnostics v_deleted_actuation = row_count;

  delete from public.compute_fabric_a2_supervisor_mesh_instance_h205f22
   where workspace_id=p_workspace;
  get diagnostics v_deleted_mesh = row_count;

  perform destruktion_meta.devos_emit_event_h205f22(
    p_workspace,
    'ENVIRONMENT_RESET',
    null,
    'devos.environment.reset.v1',
    'SUPERVISOR',
    null,
    v_generation_floor,
    null,
    jsonb_build_object(
      'generation_floor',v_generation_floor,
      'refill_enabled',false,
      'deleted_mesh_instances',v_deleted_mesh,
      'deleted_actuation_leases',v_deleted_actuation,
      'deleted_claims',v_deleted_claims,
      'deleted_nonterminal_tasks',v_deleted_tasks,
      'deleted_closed_peer_cursors',v_deleted_cursors,
      'reason',coalesce(nullif(p_reason,''),'CONTROLLED_RESET'),
      'historical_evidence_preserved',true,
      'automatic_retry_allowed',false,
      'authority_effect',false
    ),
    'devos:environment-reset:'||p_workspace::text||':'||v_generation_floor::text
  );

  return jsonb_build_object(
    'schema','metaengine.devos.environment-reset.v1',
    'ok',true,
    'workspace_id',p_workspace,
    'generation_floor',v_generation_floor,
    'refill_enabled',false,
    'deleted_mesh_instances',v_deleted_mesh,
    'deleted_actuation_leases',v_deleted_actuation,
    'deleted_claims',v_deleted_claims,
    'deleted_nonterminal_tasks',v_deleted_tasks,
    'deleted_closed_peer_cursors',v_deleted_cursors,
    'historical_evidence_preserved',true,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end
$function$;

revoke all on function public.devos_environment_reset_v1(uuid,text) from public, anon, authenticated;
grant execute on function public.devos_environment_reset_v1(uuid,text) to service_role;

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
  v_floor bigint;
begin
  if p_workspace is null or p_expected_generation_floor is null then
    raise exception 'devos_environment_resume_arguments_required' using errcode='22023';
  end if;

  update destruktion_meta.devos_fleet_runtime_control_h205f22
     set refill_enabled=true,
         updated_at=clock_timestamp(),
         authority_effect=false
   where workspace_id=p_workspace
     and generation_floor=p_expected_generation_floor
  returning generation_floor into v_floor;

  if not found then
    raise exception 'devos_environment_resume_generation_mismatch' using errcode='40001';
  end if;

  return jsonb_build_object(
    'schema','metaengine.devos.environment-resume.v1',
    'ok',true,
    'workspace_id',p_workspace,
    'generation_floor',v_floor,
    'refill_enabled',true,
    'authority_effect',false
  );
end
$function$;

revoke all on function public.devos_environment_resume_v1(uuid,bigint) from public, anon, authenticated;
grant execute on function public.devos_environment_resume_v1(uuid,bigint) to service_role;
