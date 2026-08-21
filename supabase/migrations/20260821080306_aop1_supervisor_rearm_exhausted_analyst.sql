create or replace function public.h205f22_aop1_supervisor_rearm_exhausted_analyst_v1(
  p_run_id uuid,
  p_supervisor_token uuid,
  p_reason jsonb default '{}'::jsonb,
  p_extra_attempts integer default 2
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, destruktion_meta
as $$
declare
  v_run destruktion_meta.compute_fabric_aop_run_h205f22%rowtype;
  v_role destruktion_meta.compute_fabric_aop_role_h205f22%rowtype;
  v_old_max integer;
  v_new_max integer;
begin
  if jsonb_typeof(coalesce(p_reason,'{}'::jsonb)) <> 'object' then
    raise exception 'reason_must_be_object' using errcode='22023';
  end if;
  if p_extra_attempts < 1 or p_extra_attempts > 3 then
    raise exception 'invalid_extra_attempts' using errcode='22023';
  end if;

  select * into v_run
  from destruktion_meta.compute_fabric_aop_run_h205f22
  where run_id=p_run_id
  for update;

  if not found then raise exception 'run_not_found' using errcode='P0002'; end if;

  select * into v_role
  from destruktion_meta.compute_fabric_aop_role_h205f22
  where role_key=v_run.role_key;

  if not found or v_role.role_kind <> 'ANALYST' then
    raise exception 'analyst_role_required' using errcode='42501';
  end if;
  if v_run.state <> 'LEASED'
     or v_run.lease_expires_at is null
     or v_run.lease_expires_at >= clock_timestamp()
     or v_run.attempt_count < v_run.max_attempts
     or v_run.finished_at is not null then
    raise exception 'exhausted_expired_lease_required' using errcode='55000';
  end if;
  if not exists(
    select 1
    from destruktion_meta.compute_fabric_supervisor_control_h205f22
    where supervisor_key='COMPUTE_FABRIC_MAINLINE'
      and roadmap_id=v_run.roadmap_id
      and supervisor_token=p_supervisor_token
      and mode='ACTIVE'
  ) then
    raise exception 'active_supervisor_capability_required' using errcode='42501';
  end if;

  v_old_max := v_run.max_attempts;
  v_new_max := greatest(v_run.max_attempts,v_run.attempt_count) + p_extra_attempts;

  update destruktion_meta.compute_fabric_aop_run_h205f22
  set state='READY',
      lease_owner=null,
      lease_expires_at=null,
      max_attempts=v_new_max,
      error_class=null,
      error_code=null,
      error_text=null,
      wake_condition=null,
      updated_at=clock_timestamp()
  where run_id=v_run.run_id;

  perform destruktion_meta.compute_fabric_aop_emit_event_h205f22(
    'SUPERVISOR_RUN_REARMED',
    v_run.milestone_key,
    v_run.run_id,
    v_run.role_key,
    'SUPERVISOR',
    jsonb_build_object(
      'reason',coalesce(p_reason,'{}'::jsonb),
      'previous_state',v_run.state,
      'previous_attempt_count',v_run.attempt_count,
      'previous_max_attempts',v_old_max,
      'new_max_attempts',v_new_max,
      'expired_lease_generation',v_run.lease_generation,
      'recovery_class','EXECUTOR_REPAIR_RETRY'
    ),
    v_run.idempotency_key||':supervisor-rearm:'||v_run.lease_generation::text||':'||v_run.attempt_count::text,
    v_run.expected_github_sha
  );

  return jsonb_build_object(
    'schema','metaengine.compute.aop-supervisor-rearm.h205f22.v1',
    'run_id',v_run.run_id,
    'role_key',v_run.role_key,
    'state','READY',
    'attempt_count',v_run.attempt_count,
    'previous_max_attempts',v_old_max,
    'new_max_attempts',v_new_max,
    'canonical',false,
    'authority_effect',false
  );
end $$;

revoke all on function public.h205f22_aop1_supervisor_rearm_exhausted_analyst_v1(uuid,uuid,jsonb,integer) from public, anon, authenticated;
grant execute on function public.h205f22_aop1_supervisor_rearm_exhausted_analyst_v1(uuid,uuid,jsonb,integer) to service_role;
