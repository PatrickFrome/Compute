-- Fresh Meta substrate recovery. Does not reset task history, lower a floor,
-- replay an effect, open admission automatically, or create another scheduler.
-- Execute only after the transactional qualification script passes.

create or replace function public.devos_environment_state_v1(p_workspace uuid)
returns jsonb language sql security definer
set search_path='pg_catalog'
as $$
 select jsonb_build_object('schema','metaengine.devos.environment-state.v1','workspace_id',p_workspace,
  'authority_present',c.workspace_id is not null,'authoritative',c.workspace_id is not null,
  'generation_floor',c.generation_floor,'refill_enabled',c.refill_enabled,
  'supervisor_admission_enabled',c.supervisor_admission_enabled,
  'state',case when c.workspace_id is null then 'UNAVAILABLE'
     when c.refill_enabled and c.supervisor_admission_enabled then 'OPEN' else 'CLOSED' end,
  'reason',case when c.workspace_id is null then 'WORKSPACE_AUTHORITY_MISSING' else null end,
  'reset_at',c.reset_at,'reset_reason',c.reset_reason,'authority_effect',false)
 from (select 1) x left join destruktion_meta.devos_fleet_runtime_control_h205f22 c on c.workspace_id=p_workspace;
$$;

create or replace function public.devos_environment_bootstrap_v1(
 p_workspace uuid,p_client_id text,p_expected_generation_floor bigint,p_expected_process_incarnation text
) returns jsonb language plpgsql security definer set search_path='pg_catalog'
as $$
declare
 v_state public.compute_fabric_a2_browser_supervisor_state_h205f22%rowtype;
 v_control destruktion_meta.devos_fleet_runtime_control_h205f22%rowtype;
 v_floor bigint; v_max_floor bigint; v_event bigint;
begin
 if p_workspace is null or p_client_id is null or p_expected_generation_floor is null
   or p_expected_generation_floor<0 or p_expected_generation_floor>9007199254740991
   or p_expected_process_incarnation is null or length(p_expected_process_incarnation)>96 then
   raise exception 'devos_environment_bootstrap_input_invalid' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('devos_environment:'||p_workspace::text,0));
 select * into v_state from public.compute_fabric_a2_browser_supervisor_state_h205f22
   where workspace_id=p_workspace and client_id=p_client_id for share;
 if not found or v_state.last_seen_at<clock_timestamp()-interval '90 seconds'
   or v_state.last_seen_at>clock_timestamp()+interval '5 seconds' then
   raise exception 'devos_environment_bootstrap_witness_stale' using errcode='22023';
 end if;
 perform 1 from public.compute_fabric_a2_browser_device_h205f22 d
   where d.client_id=p_client_id and d.active and d.revoked_at is null
     and d.access_tier='ADMIN' and d.admin_revoked_at is null and d.admin_grant_epoch>0
     and d.admin_scopes @> '["DEVOS","RECOVERY"]'::jsonb for share;
 if not found then
   raise exception 'devos_environment_bootstrap_admin_required' using errcode='42501';
 end if;
 if v_state.state #>> '{supervisor_lifecycle,keepalive,process_incarnation_id}'
      is distinct from p_expected_process_incarnation
    or jsonb_typeof(v_state.state #> '{supervisor_lifecycle,keepalive,admission_generation_floor}')<>'number'
    or coalesce(v_state.state #>> '{supervisor_lifecycle,keepalive,admission_generation_floor}','') !~ '^[0-9]+$' then
   raise exception 'devos_environment_bootstrap_witness_mismatch' using errcode='22023';
 end if;
 v_floor:=(v_state.state #>> '{supervisor_lifecycle,keepalive,admission_generation_floor}')::bigint;
 if v_floor<>p_expected_generation_floor then
   raise exception 'devos_environment_bootstrap_generation_mismatch' using errcode='22023';
 end if;
 -- Other persisted profiles may hold a newer durable floor even while offline.
 select max((s.state #>> '{supervisor_lifecycle,keepalive,admission_generation_floor}')::bigint)
   into v_max_floor from public.compute_fabric_a2_browser_supervisor_state_h205f22 s
   where s.workspace_id=p_workspace
     and coalesce(s.state #>> '{supervisor_lifecycle,keepalive,admission_generation_floor}','') ~ '^[0-9]+$';
 if v_max_floor>v_floor then
   raise exception 'devos_environment_bootstrap_newer_profile_floor' using errcode='22023';
 end if;
 select * into v_control from destruktion_meta.devos_fleet_runtime_control_h205f22
   where workspace_id=p_workspace for update;
 if found then
   if v_control.generation_floor<v_floor or v_control.refill_enabled or v_control.supervisor_admission_enabled then
     raise exception 'devos_environment_bootstrap_existing_authority_conflict' using errcode='22023';
   end if;
   return public.devos_environment_state_v1(p_workspace)||jsonb_build_object('created',false,'automatic_retry_allowed',false);
 end if;
 if exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22
      where workspace_id=p_workspace and state not in ('EXPIRED','FENCED','CLOSED'))
   or exists(select 1 from destruktion_meta.devos_fleet_task_h205f22
      where workspace_id=p_workspace and state not in ('READY','FENCED','COMPLETED','FAILED','CANCELLED'))
   or exists(select 1 from public.compute_fabric_a2_supervisor_actuation_lease_h205f22
      where workspace_id=p_workspace and status='ACTIVE') then
   raise exception 'devos_environment_bootstrap_live_execution' using errcode='55000';
 end if;
 insert into destruktion_meta.devos_fleet_runtime_control_h205f22
   (workspace_id,generation_floor,refill_enabled,supervisor_admission_enabled,reset_reason)
   values(p_workspace,v_floor,false,false,'SIGNED_PROFILE_BOOTSTRAP_CLOSED');
 insert into destruktion_meta.devos_fleet_event_h205f22
   (workspace_id,event_type,payload,idempotency_key,authority_effect)
   values(p_workspace,'ENVIRONMENT_AUTHORITY_BOOTSTRAPPED',jsonb_build_object(
     'generation_floor',v_floor,'refill_enabled',false,'supervisor_admission_enabled',false,
     'client_id',p_client_id,'process_incarnation_id',p_expected_process_incarnation,
     'witness_observed_at',v_state.last_seen_at,'automatic_retry_allowed',false,'authority_effect',false),
     'authority-bootstrap:'||p_workspace::text,false) returning event_id into v_event;
 return public.devos_environment_state_v1(p_workspace)||jsonb_build_object('created',true,
   'evidence_event_id',v_event,'automatic_retry_allowed',false);
end $$;

create or replace function public.devos_environment_resume_v1(p_workspace uuid,p_expected_generation_floor bigint)
returns jsonb language plpgsql security definer set search_path='pg_catalog'
as $$
declare v_control destruktion_meta.devos_fleet_runtime_control_h205f22%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('devos_environment:'||p_workspace::text,0));
 select * into v_control from destruktion_meta.devos_fleet_runtime_control_h205f22
   where workspace_id=p_workspace for update;
 if not found then raise exception 'devos_environment_authority_missing' using errcode='22023'; end if;
 if p_expected_generation_floor is null or p_expected_generation_floor<>v_control.generation_floor then
   raise exception 'devos_environment_resume_generation_mismatch' using errcode='22023';
 end if;
 if not (v_control.refill_enabled and v_control.supervisor_admission_enabled) then
   update destruktion_meta.devos_fleet_runtime_control_h205f22
     set refill_enabled=true,supervisor_admission_enabled=true,updated_at=clock_timestamp()
     where workspace_id=p_workspace;
   insert into destruktion_meta.devos_fleet_event_h205f22(workspace_id,event_type,payload,idempotency_key,authority_effect)
     values(p_workspace,'ENVIRONMENT_ADMISSION_RESUMED',jsonb_build_object(
       'generation_floor',v_control.generation_floor,'operator_initiated',true,
       'automatic_retry_allowed',false,'authority_effect',false),
       'authority-resume:'||p_workspace::text||':'||gen_random_uuid()::text,false);
 end if;
 return public.devos_environment_state_v1(p_workspace);
end $$;

revoke all on function public.devos_environment_state_v1(uuid),
 public.devos_environment_bootstrap_v1(uuid,text,bigint,text),
 public.devos_environment_resume_v1(uuid,bigint) from public,anon,authenticated;
grant execute on function public.devos_environment_state_v1(uuid),
 public.devos_environment_bootstrap_v1(uuid,text,bigint,text),
 public.devos_environment_resume_v1(uuid,bigint) to service_role;

-- The existing lease body follows, with admission held FOR SHARE until commit.
create or replace function public.devos_fleet_lease_v1(
 p_workspace uuid,p_agent text,p_role text,p_tab text,p_target text,p_epoch bigint,p_seconds integer default 900
) returns jsonb language plpgsql security definer
set search_path='pg_catalog','destruktion_meta'
as $$
declare v_task destruktion_meta.devos_fleet_task_h205f22%rowtype; v_claim bigint;
 v_control destruktion_meta.devos_fleet_runtime_control_h205f22%rowtype;
 v_now timestamptz:=clock_timestamp(); v_secs int:=greatest(60,least(3600,coalesce(p_seconds,900)));
begin
 select * into v_control from destruktion_meta.devos_fleet_runtime_control_h205f22
   where workspace_id=p_workspace for share;
 if not found then
   return jsonb_build_object('leased',false,'reason','WORKSPACE_AUTHORITY_MISSING',
     'automatic_retry_allowed',false,'authority_effect',false);
 end if;
 if not (v_control.refill_enabled and v_control.supervisor_admission_enabled) then
   return jsonb_build_object('leased',false,'reason','CONTINUOUS_SERVICE_ADMISSION_FENCED',
     'required_generation_floor',v_control.generation_floor,'automatic_retry_allowed',false,'authority_effect',false);
 end if;
 if p_epoch is null or p_epoch<v_control.generation_floor or p_epoch>9007199254740991 then
   return jsonb_build_object('leased',false,'reason','AGENT_GENERATION_FENCED',
     'required_generation_floor',v_control.generation_floor,'presented_generation_epoch',p_epoch,
     'automatic_retry_allowed',false,'authority_effect',false);
 end if;
 perform public.devos_fleet_reconcile_v1(p_workspace);
 with picked as (
   select task_id from destruktion_meta.devos_fleet_task_h205f22
   where workspace_id=p_workspace and state='READY' and role=upper(p_role)
   order by priority desc,created_at,task_id for update skip locked limit 1
 )
 update destruktion_meta.devos_fleet_task_h205f22 t
 set state='LEASED',lease_generation=t.lease_generation+1,lease_agent_id=lower(p_agent),
     lease_tab_id=p_tab,lease_target_id=lower(p_target),lease_agent_generation_epoch=p_epoch,
     lease_expires_at=v_now+make_interval(secs=>v_secs),updated_at=v_now
 from picked p where t.task_id=p.task_id returning t.* into v_task;
 if not found then return jsonb_build_object('leased',false,'agent_id',lower(p_agent),'role',upper(p_role),
   'automatic_retry_allowed',false,'authority_effect',false); end if;
 insert into destruktion_meta.devos_fleet_claim_h205f22(
  task_id,workspace_id,point_id,base_sha,role,claim_class,agent_id,tab_id,target_id,
  agent_generation_epoch,lease_generation,expires_at
 ) values (
  v_task.task_id,v_task.workspace_id,v_task.point_id,v_task.base_sha,v_task.role,v_task.claim_class,
  lower(p_agent),p_tab,lower(p_target),p_epoch,v_task.lease_generation,v_task.lease_expires_at
 ) returning claim_id into v_claim;
 return jsonb_build_object('leased',true,'task_id',v_task.task_id,'claim_id',v_claim,'point_id',v_task.point_id,
  'role',v_task.role,'claim_class',v_task.claim_class,'base_sha',v_task.base_sha,'branch_name',v_task.branch_name,
  'task_spec',v_task.task_spec,'task_spec_sha256',v_task.task_spec_sha256,'lease_generation',v_task.lease_generation,
  'lease_expires_at',v_task.lease_expires_at,'agent_id',lower(p_agent),'tab_id',p_tab,'target_id',lower(p_target),
  'agent_generation_epoch',p_epoch,'automatic_retry_allowed',false,'authority_effect',false);
end $$;

revoke all on function public.devos_fleet_lease_v1(uuid,text,text,text,text,bigint,integer)
 from public,anon,authenticated;
grant execute on function public.devos_fleet_lease_v1(uuid,text,text,text,text,bigint,integer) to service_role;
