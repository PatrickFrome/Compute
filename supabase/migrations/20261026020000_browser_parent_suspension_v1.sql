-- Durable denial certificate: physical retirement never completes a task.
create table destruktion_meta.browser_child_retirement_h205f22 (
 retirement_id uuid primary key default gen_random_uuid(), workspace_id uuid not null,project_id uuid not null,
 task_id uuid not null,lease_generation bigint not null,agent_id text not null,tab_id text not null,target_id text not null,
 agent_generation_epoch bigint not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),
 unique(task_id,lease_generation),unique(workspace_id,agent_id,tab_id,target_id,agent_generation_epoch)
);
alter table destruktion_meta.browser_child_retirement_h205f22 enable row level security;
revoke all on destruktion_meta.browser_child_retirement_h205f22 from public,anon,authenticated,service_role;
-- Browser-only continuation within existing W30 ownership. Signed device routes
-- accept only private Host-produced quiescence/restoration observations. These
-- functions are NOT exposed as agent tools. Never turn page/model JSON into a
-- Host witness. READ_ONLY parents only: mutable worktree custody is not released.
create table destruktion_meta.browser_parent_suspension_h205f22 (
  suspension_id uuid primary key,
  seq bigint generated always as identity unique,
  project_id uuid not null references destruktion_meta.project_run_h205f22(project_id),
  workspace_id uuid not null,
  task_id uuid not null references destruktion_meta.devos_fleet_task_h205f22(task_id),
  old_claim_id bigint not null,
  old_lease_generation bigint not null,
  checkpoint jsonb not null,
  checkpoint_sha256 text not null check(checkpoint_sha256 ~ '^[a-f0-9]{64}$'),
  awaited_children jsonb not null,
  status text not null default 'SUSPENDED' check(status in ('SUSPENDED','RESUMED')),
  restoration jsonb,
  resumed_lease jsonb,
  created_at timestamptz not null default clock_timestamp(),
  resumed_at timestamptz,
  unique(task_id,old_lease_generation),
  check(checkpoint_sha256=encode(extensions.digest(convert_to(checkpoint::text,'UTF8'),'sha256'),'hex')),
  check((status='RESUMED')=(restoration is not null and resumed_lease is not null and resumed_at is not null))
);
alter table destruktion_meta.browser_parent_suspension_h205f22 enable row level security;
revoke all on table destruktion_meta.browser_parent_suspension_h205f22 from public,anon,authenticated,service_role;

alter table destruktion_meta.devos_fleet_task_h205f22 drop constraint devos_fleet_task_state_ck;
alter table destruktion_meta.devos_fleet_task_h205f22 add constraint devos_fleet_task_state_ck
  check(state in ('READY','LEASED','RUNNING','RESULT_READY','BLOCKED','COMPLETED','FAILED','AMBIGUOUS','FENCED','SUSPENDED'));

create function destruktion_meta.browser_parent_suspension_projection_v1(p_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta as $$
declare s destruktion_meta.browser_parent_suspension_h205f22; control jsonb; projected text;
begin
  select * into s from destruktion_meta.browser_parent_suspension_h205f22 where suspension_id=p_id;
  if not found then return jsonb_build_object('schema','metaengine.devos.browser-parent-suspension.v1','found',false,'automatic_retry_allowed',false,'authority_effect',false); end if;
  control:=public.devos_environment_state_v1(s.workspace_id);
  projected:=case
    when s.status='RESUMED' then 'RESUMED'
    when control->'refill_enabled' is distinct from 'true'::jsonb or control->'supervisor_admission_enabled' is distinct from 'true'::jsonb
      or control->'owner_stop'='true'::jsonb or control->>'state'='STOPPED' then 'OWNER_STOPPED'
    when control->>'generation_floor' is distinct from s.checkpoint->>'control_generation' then 'GENERATION_FENCED'
    when exists(select 1 from destruktion_meta.project_task_h205f22 pt join destruktion_meta.devos_fleet_task_h205f22 t using(task_id)
      where pt.project_id=s.project_id and pt.parent_task_id=s.task_id and t.state in ('FAILED','BLOCKED','AMBIGUOUS','FENCED')) then 'BLOCKED_CHILDREN'
    when exists(select 1 from destruktion_meta.project_task_h205f22 pt join destruktion_meta.devos_fleet_task_h205f22 t using(task_id)
      where pt.project_id=s.project_id and pt.parent_task_id=s.task_id and t.state<>'COMPLETED')
      or exists(select 1 from destruktion_meta.project_child_proposal_h205f22 where project_id=s.project_id and parent_task_id=s.task_id and child_task_id is null)
      then 'WAITING_CHILDREN'
    else 'READY_TO_RESUME' end;
  return jsonb_build_object('schema','metaengine.devos.browser-parent-suspension.v1','found',true,
    'suspension_id',s.suspension_id,'seq',s.seq,'project_id',s.project_id,'workspace_id',s.workspace_id,'task_id',s.task_id,
    'old_claim_id',s.old_claim_id,'old_lease_generation',s.old_lease_generation,'checkpoint',s.checkpoint,
    'checkpoint_sha256',s.checkpoint_sha256,'awaited_children',s.awaited_children,'status',s.status,'state',projected,
    'lease',s.resumed_lease,'automatic_retry_allowed',false,'authority_effect',false);
end $$;
revoke all on function destruktion_meta.browser_parent_suspension_projection_v1(uuid) from public,anon,authenticated,service_role;

create function public.h205f22_project_suspend_browser_v1(p_workspace_id uuid,p_project_id uuid,p_task_id uuid,p_claim_id bigint,
  p_lease_generation bigint,p_suspension_id uuid,p_checkpoint jsonb,p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta as $$
declare r destruktion_meta.project_run_h205f22; t destruktion_meta.devos_fleet_task_h205f22;
  s destruktion_meta.browser_parent_suspension_h205f22; auth jsonb; control jsonb; children jsonb; result jsonb;
begin
  r:=destruktion_meta.project_authorize_h205f22(p_workspace_id,p_project_id,p_device_id,p_client_id,p_admin_grant_epoch);
  if p_suspension_id is null or p_task_id is null then raise exception 'BROWSER_SUSPENSION_ID_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('browser-agent:'||p_workspace_id||':'||lower(p_checkpoint->>'agent_id'),0));
  perform pg_advisory_xact_lock(hashtextextended('browser-parent:'||p_task_id,0));
  select * into s from destruktion_meta.browser_parent_suspension_h205f22 where suspension_id=p_suspension_id;
  if found then
    if s.project_id is distinct from p_project_id or s.workspace_id is distinct from p_workspace_id or s.task_id is distinct from p_task_id
      or s.old_claim_id is distinct from p_claim_id or s.old_lease_generation is distinct from p_lease_generation or s.checkpoint is distinct from p_checkpoint
      then raise exception 'BROWSER_SUSPENSION_COLLISION' using errcode='23505'; end if;
    return destruktion_meta.browser_parent_suspension_projection_v1(s.suspension_id)||jsonb_build_object('replayed',true);
  end if;
  if exists(select 1 from destruktion_meta.browser_parent_suspension_h205f22 where task_id=p_task_id and old_lease_generation=p_lease_generation)
    then raise exception 'BROWSER_SUSPENSION_PRIOR_INTENT_REQUIRED'; end if;
  auth:=destruktion_meta.project_parent_h205f22(p_workspace_id,p_project_id,p_task_id,p_claim_id,p_lease_generation,p_device_id,p_client_id,p_admin_grant_epoch);
  select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=p_task_id for update;
  if t.state is distinct from 'RUNNING' or t.claim_class is distinct from 'READ_ONLY' or t.task_spec ? 'native_coding'
    or t.lease_target_id not like 'webcontents:%' or exists(select 1 from public.compute_fabric_a2_workspace_binding_h205f22 where task_id=t.task_id and retired_at is null)
    then raise exception 'BROWSER_SUSPENSION_READ_ONLY_REQUIRED'; end if;
  insert into destruktion_meta.devos_fleet_runtime_control_h205f22(workspace_id) values(p_workspace_id) on conflict do nothing;
  perform 1 from destruktion_meta.devos_fleet_runtime_control_h205f22 where workspace_id=p_workspace_id for share;
  if exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 where workspace_id=p_workspace_id and agent_id=t.lease_agent_id and state='ACTIVE' and claim_id<>p_claim_id)
    then raise exception 'BROWSER_SUSPENSION_AGENT_BUSY'; end if;
  control:=public.devos_environment_state_v1(p_workspace_id);
  if control->'refill_enabled' is distinct from 'true'::jsonb or control->'supervisor_admission_enabled' is distinct from 'true'::jsonb
    or control->'owner_stop'='true'::jsonb or control->>'state'='STOPPED' then raise exception 'BROWSER_SUSPENSION_OWNER_STOPPED'; end if;
  if coalesce(jsonb_typeof(p_checkpoint) is distinct from 'object'
    or p_checkpoint->>'schema' is distinct from 'metaengine.browser.parent-checkpoint.v1'
    or not (p_checkpoint ?& array['schema','conversation_url','conversation_url_sha256','transcript_floor','transcript_total_chars','transcript_sha256',
      'agent_surface_sha256','confirmed_turn_sha256','delivered_tool_results','observed_at','tab_id','target_id','agent_id','agent_generation_epoch','control_generation','worktree_custody'])
    or (select count(*) from jsonb_object_keys(p_checkpoint))<>16
    or p_checkpoint->'worktree_custody' is distinct from 'null'::jsonb
    or p_checkpoint->>'conversation_url' !~ '^https://chatgpt[.]com/c/[a-z0-9-]+$'
    or p_checkpoint->>'conversation_url_sha256' is distinct from encode(extensions.digest(convert_to(p_checkpoint->>'conversation_url','UTF8'),'sha256'),'hex')
    or p_checkpoint->>'agent_surface_sha256' !~ '^[a-f0-9]{64}$' or p_checkpoint->>'transcript_sha256' !~ '^[a-f0-9]{64}$' or p_checkpoint->>'confirmed_turn_sha256' !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_checkpoint->'transcript_floor') is distinct from 'number' or (p_checkpoint->>'transcript_floor')::bigint<0
    or jsonb_typeof(p_checkpoint->'transcript_total_chars') is distinct from 'number' or (p_checkpoint->>'transcript_total_chars')::bigint<(p_checkpoint->>'transcript_floor')::bigint
    or p_checkpoint->>'agent_id' is distinct from t.lease_agent_id or p_checkpoint->>'tab_id' is distinct from t.lease_tab_id
    or p_checkpoint->>'target_id' is distinct from t.lease_target_id or (p_checkpoint->>'agent_generation_epoch')::bigint is distinct from t.lease_agent_generation_epoch
    or p_checkpoint->>'control_generation' is distinct from control->>'generation_floor'
    or (p_checkpoint->>'observed_at')::timestamptz not between clock_timestamp()-interval '30 seconds' and clock_timestamp()+interval '5 seconds'
    or jsonb_typeof(p_checkpoint->'delivered_tool_results') is distinct from 'array',true)
    then raise exception 'BROWSER_SUSPENSION_CHECKPOINT_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(p_checkpoint->'delivered_tool_results') v where jsonb_typeof(v) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(v))<>2 or not(v ?& array['request_id','result_sha256'])
    or coalesce(v->>'request_id','') !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{3,63}$' or coalesce(v->>'result_sha256','') !~ '^[a-f0-9]{64}$')
    or (select count(*) from jsonb_array_elements(p_checkpoint->'delivered_tool_results'))<>(select count(distinct v->>'request_id') from jsonb_array_elements(p_checkpoint->'delivered_tool_results') v)
    then raise exception 'BROWSER_SUSPENSION_TOOL_RESULTS_INVALID'; end if;
  if not exists(select 1 from destruktion_meta.devos_fleet_event_h205f22 where task_id=t.task_id and lease_generation=t.lease_generation
    and event_type='TASK_TRANSPORT_PROVEN' and payload->>'conversation_url_sha256'=p_checkpoint->>'conversation_url_sha256'
    and payload->>'agent_surface_sha256'=p_checkpoint->>'agent_surface_sha256')
    then raise exception 'BROWSER_SUSPENSION_CONVERSATION_UNPROVEN'; end if;
  if exists(select 1 from destruktion_meta.project_child_proposal_h205f22 where project_id=p_project_id and parent_task_id=p_task_id and child_task_id is null)
    then raise exception 'BROWSER_SUSPENSION_UNADMITTED_PROPOSALS'; end if;
  select jsonb_agg(pt.task_id order by pt.task_id) into children from destruktion_meta.project_task_h205f22 pt
    join destruktion_meta.devos_fleet_task_h205f22 child using(task_id) where pt.project_id=p_project_id and pt.parent_task_id=p_task_id and child.state<>'COMPLETED';
  if children is null then raise exception 'BROWSER_SUSPENSION_NO_PENDING_CHILDREN'; end if;
  if exists(select 1 from destruktion_meta.project_task_h205f22 pt join destruktion_meta.devos_fleet_task_h205f22 child using(task_id)
    where pt.project_id=p_project_id and pt.parent_task_id=p_task_id and child.state in ('FAILED','BLOCKED','AMBIGUOUS','FENCED'))
    then raise exception 'BROWSER_SUSPENSION_CHILD_BLOCKED'; end if;
  insert into destruktion_meta.browser_parent_suspension_h205f22(suspension_id,project_id,workspace_id,task_id,old_claim_id,old_lease_generation,checkpoint,checkpoint_sha256,awaited_children)
    values(p_suspension_id,p_project_id,p_workspace_id,p_task_id,p_claim_id,p_lease_generation,p_checkpoint,
      encode(extensions.digest(convert_to(p_checkpoint::text,'UTF8'),'sha256'),'hex'),children);
  update destruktion_meta.devos_fleet_claim_h205f22 set state='CLOSED',updated_at=clock_timestamp()
    where claim_id=p_claim_id and task_id=p_task_id and state='ACTIVE' and lease_generation=p_lease_generation and expires_at>clock_timestamp();
  if not found then raise exception 'BROWSER_SUSPENSION_CLAIM_CHANGED'; end if;
  update destruktion_meta.devos_fleet_task_h205f22 set state='SUSPENDED',updated_at=clock_timestamp() where task_id=p_task_id and state='RUNNING' and lease_generation=p_lease_generation;
  if not found then raise exception 'BROWSER_SUSPENSION_TASK_CHANGED'; end if;
  perform destruktion_meta.project_append_h205f22(p_project_id,'BROWSER_PARENT_SUSPENDED',p_task_id,p_lease_generation,p_client_id,null,null,null,
    jsonb_build_object('suspension_id',p_suspension_id,'checkpoint_sha256',encode(extensions.digest(convert_to(p_checkpoint::text,'UTF8'),'sha256'),'hex')),
    'SIGNED_HOST_OBSERVATION',null,false,'browser-suspend:'||p_suspension_id);
  return destruktion_meta.browser_parent_suspension_projection_v1(p_suspension_id)||jsonb_build_object('replayed',false);
end $$;
revoke all on function public.h205f22_project_suspend_browser_v1(uuid,uuid,uuid,bigint,bigint,uuid,jsonb,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.h205f22_project_suspend_browser_v1(uuid,uuid,uuid,bigint,bigint,uuid,jsonb,uuid,text,bigint) to service_role;

create function public.h205f22_project_suspension_read_v1(p_workspace_id uuid,p_task_id uuid,p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta as $$
declare s destruktion_meta.browser_parent_suspension_h205f22;
begin
  perform destruktion_meta.project_device_grant_h205f22(p_device_id,p_client_id,p_admin_grant_epoch);
  select * into s from destruktion_meta.browser_parent_suspension_h205f22 where workspace_id=p_workspace_id and task_id=p_task_id order by seq desc limit 1;
  if not found then return jsonb_build_object('schema','metaengine.devos.browser-parent-suspension.v1','found',false,'task_id',p_task_id,'automatic_retry_allowed',false,'authority_effect',false); end if;
  perform destruktion_meta.project_authorize_h205f22(p_workspace_id,s.project_id,p_device_id,p_client_id,p_admin_grant_epoch);
  return destruktion_meta.browser_parent_suspension_projection_v1(s.suspension_id);
end $$;
revoke all on function public.h205f22_project_suspension_read_v1(uuid,uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.h205f22_project_suspension_read_v1(uuid,uuid,uuid,text,bigint) to service_role;

create function public.h205f22_project_suspension_list_v1(p_workspace_id uuid,p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint,p_after_seq bigint default 0,p_limit integer default 32)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta as $$
declare rows jsonb; nextseq bigint; more boolean;
begin
  perform destruktion_meta.project_device_grant_h205f22(p_device_id,p_client_id,p_admin_grant_epoch);
  if p_after_seq is null or p_after_seq<0 or p_limit is null or p_limit not between 1 and 128 then raise exception 'BROWSER_SUSPENSION_CURSOR_INVALID'; end if;
  select coalesce(jsonb_agg(value order by seq),'[]'),coalesce(max(seq),p_after_seq) into rows,nextseq from (
    select s.seq,destruktion_meta.browser_parent_suspension_projection_v1(s.suspension_id) as value
    from destruktion_meta.browser_parent_suspension_h205f22 s join destruktion_meta.project_run_h205f22 r using(project_id)
    where s.workspace_id=p_workspace_id and r.workspace_id=p_workspace_id and r.device_id=p_device_id and r.client_id=p_client_id
      and r.admin_grant_epoch=p_admin_grant_epoch and s.seq>p_after_seq and not exists(select 1 from destruktion_meta.browser_parent_suspension_h205f22 newer where newer.task_id=s.task_id and newer.seq>s.seq)
      and (s.status='SUSPENDED' or (s.status='RESUMED' and exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 t
        join destruktion_meta.devos_fleet_claim_h205f22 c on c.task_id=t.task_id and c.claim_id=(s.resumed_lease->>'claim_id')::bigint
        where t.task_id=s.task_id and t.state='RUNNING' and t.lease_generation=(s.resumed_lease->>'lease_generation')::bigint
        and c.state='ACTIVE' and c.lease_generation=t.lease_generation and c.expires_at>clock_timestamp()))) order by s.seq limit p_limit
  ) q;
  select exists(select 1 from destruktion_meta.browser_parent_suspension_h205f22 s join destruktion_meta.project_run_h205f22 r using(project_id)
    where s.workspace_id=p_workspace_id and r.device_id=p_device_id and r.client_id=p_client_id and r.admin_grant_epoch=p_admin_grant_epoch and s.seq>nextseq and not exists(select 1 from destruktion_meta.browser_parent_suspension_h205f22 newer where newer.task_id=s.task_id and newer.seq>s.seq)
      and (s.status='SUSPENDED' or (s.status='RESUMED' and exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 t
        join destruktion_meta.devos_fleet_claim_h205f22 c on c.task_id=t.task_id and c.claim_id=(s.resumed_lease->>'claim_id')::bigint
        where t.task_id=s.task_id and t.state='RUNNING' and t.lease_generation=(s.resumed_lease->>'lease_generation')::bigint
        and c.state='ACTIVE' and c.lease_generation=t.lease_generation and c.expires_at>clock_timestamp())))) into more;
  return jsonb_build_object('schema','metaengine.devos.browser-parent-suspension-list.v1','entries',rows,'cursor',jsonb_build_object('after_seq',p_after_seq,'next_seq',nextseq,'has_more',more),'automatic_retry_allowed',false,'authority_effect',false);
end $$;
revoke all on function public.h205f22_project_suspension_list_v1(uuid,uuid,text,bigint,bigint,integer) from public,anon,authenticated;
grant execute on function public.h205f22_project_suspension_list_v1(uuid,uuid,text,bigint,bigint,integer) to service_role;

create function public.h205f22_project_resume_browser_v1(p_workspace_id uuid,p_suspension_id uuid,p_restoration jsonb,p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta as $$
declare s destruktion_meta.browser_parent_suspension_h205f22; r destruktion_meta.project_run_h205f22;
  t destruktion_meta.devos_fleet_task_h205f22; control jsonb; claimid bigint; lease jsonb; observed jsonb; agent jsonb; auth jsonb;
begin
  select * into s from destruktion_meta.browser_parent_suspension_h205f22 where suspension_id=p_suspension_id and workspace_id=p_workspace_id;
  if not found then raise exception 'BROWSER_RESUME_SUSPENSION_MISSING'; end if;
  r:=destruktion_meta.project_authorize_h205f22(p_workspace_id,s.project_id,p_device_id,p_client_id,p_admin_grant_epoch);
  perform pg_advisory_xact_lock(hashtextextended('browser-agent:'||p_workspace_id||':'||lower(s.checkpoint->>'agent_id'),0));
  perform pg_advisory_xact_lock(hashtextextended('browser-parent:'||s.task_id,0));
  select * into s from destruktion_meta.browser_parent_suspension_h205f22 where suspension_id=p_suspension_id for update;
  insert into destruktion_meta.devos_fleet_runtime_control_h205f22(workspace_id) values(p_workspace_id) on conflict do nothing;
  perform 1 from destruktion_meta.devos_fleet_runtime_control_h205f22 where workspace_id=p_workspace_id for share;
  select * into r from destruktion_meta.project_run_h205f22 where project_id=s.project_id for share;
  control:=public.devos_environment_state_v1(p_workspace_id);
  if r.state is distinct from 'ACTIVE' or control->'refill_enabled' is distinct from 'true'::jsonb or control->'supervisor_admission_enabled' is distinct from 'true'::jsonb
    or control->'owner_stop'='true'::jsonb or control->>'state'='STOPPED' or control->>'generation_floor' is distinct from s.checkpoint->>'control_generation'
    then raise exception 'BROWSER_RESUME_OWNER_FENCED'; end if;
  if s.status='RESUMED' then
    if not exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 task
      join destruktion_meta.devos_fleet_claim_h205f22 claim on claim.task_id=task.task_id and claim.claim_id=(s.resumed_lease->>'claim_id')::bigint
      where task.task_id=s.task_id and task.state='RUNNING' and task.lease_generation=(s.resumed_lease->>'lease_generation')::bigint
      and claim.state='ACTIVE' and claim.lease_generation=task.lease_generation and claim.expires_at>clock_timestamp())
      then raise exception 'BROWSER_RESUME_RECEIPT_STALE'; end if;
    if s.restoration is distinct from p_restoration then raise exception 'BROWSER_RESUME_COLLISION' using errcode='23505'; end if;
    return destruktion_meta.browser_parent_suspension_projection_v1(s.suspension_id)||jsonb_build_object('replayed',true);
  end if;
  perform 1 from destruktion_meta.project_task_h205f22 pt join destruktion_meta.devos_fleet_task_h205f22 child using(task_id)
    where pt.project_id=s.project_id and pt.parent_task_id=s.task_id for share of child;
  if destruktion_meta.browser_parent_suspension_projection_v1(s.suspension_id)->>'state' is distinct from 'READY_TO_RESUME'
    then raise exception 'BROWSER_RESUME_DEPENDENCIES_PENDING'; end if;
  select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=s.task_id and workspace_id=p_workspace_id for update;
  if not found or t.state is distinct from 'SUSPENDED' or t.lease_generation is distinct from s.old_lease_generation
    or t.claim_class is distinct from 'READ_ONLY' or t.task_spec ? 'native_coding'
    or exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 where task_id=t.task_id and state='ACTIVE')
    or exists(select 1 from public.compute_fabric_a2_workspace_binding_h205f22 where task_id=t.task_id and retired_at is null)
    then raise exception 'BROWSER_RESUME_TASK_FENCED'; end if;
  if coalesce(jsonb_typeof(p_restoration) is distinct from 'object'
    or p_restoration->>'schema' is distinct from 'metaengine.devos.browser-parent-restoration.v1'
    or not(p_restoration ?& array['schema','checkpoint_sha256','conversation_url','conversation_url_sha256','transcript_floor','transcript_total_chars',
      'transcript_sha256','agent_surface_sha256','observed_at','agent_id','tab_id','target_id','agent_generation_epoch','control_generation'])
    or (select count(*) from jsonb_object_keys(p_restoration))<>14
    or p_restoration->>'checkpoint_sha256' is distinct from s.checkpoint_sha256
    or p_restoration->>'agent_id' is distinct from s.checkpoint->>'agent_id'
    or p_restoration->>'conversation_url' is distinct from s.checkpoint->>'conversation_url'
    or p_restoration->>'conversation_url_sha256' is distinct from s.checkpoint->>'conversation_url_sha256'
    or p_restoration->'transcript_floor' is distinct from s.checkpoint->'transcript_floor'
    or p_restoration->'transcript_total_chars' is distinct from s.checkpoint->'transcript_total_chars'
    or p_restoration->>'agent_surface_sha256' is distinct from s.checkpoint->>'agent_surface_sha256'
    or p_restoration->>'transcript_sha256' is distinct from s.checkpoint->>'transcript_sha256'
    or p_restoration->>'control_generation' is distinct from control->>'generation_floor'
    or p_restoration->>'tab_id' !~ '^tab_[0-9a-f-]{36}$' or p_restoration->>'target_id' !~ '^webcontents:[1-9][0-9]*$'
    or (p_restoration->>'agent_generation_epoch')::bigint<=(s.checkpoint->>'agent_generation_epoch')::bigint
    or (p_restoration->>'observed_at')::timestamptz not between clock_timestamp()-interval '30 seconds' and clock_timestamp()+interval '5 seconds',true)
    then raise exception 'BROWSER_RESUME_RESTORATION_INVALID'; end if;
  -- Same logical identity may have no other active W30 claim. Retained UNKNOWN
  -- work is not made idle merely by checkpointing another task.
  if exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 where workspace_id=p_workspace_id
    and agent_id=t.lease_agent_id and state='ACTIVE') then raise exception 'BROWSER_RESUME_AGENT_BUSY'; end if;
  if destruktion_meta.browser_parent_reservation_v1(p_workspace_id,t.lease_agent_id) is distinct from
    jsonb_build_object('schema','metaengine.browser.parent-restoration-reservation.v1','suspension_id',s.suspension_id,'task_id',s.task_id,
      'checkpoint_sha256',s.checkpoint_sha256,'authority_effect',false,'automatic_retry_allowed',false)
    then raise exception 'BROWSER_RESUME_RESERVATION_REQUIRED'; end if;
  -- INSERT still executes the existing browser claim-admission trigger against
  -- the fresh signed fleet snapshot; this is not a transport admission bypass.
  update destruktion_meta.devos_fleet_task_h205f22 set state='LEASED',lease_generation=lease_generation+1,
    lease_tab_id=p_restoration->>'tab_id',lease_target_id=p_restoration->>'target_id',
    lease_agent_generation_epoch=(p_restoration->>'agent_generation_epoch')::bigint,
    lease_expires_at=clock_timestamp()+interval '900 seconds',updated_at=clock_timestamp()
    where task_id=s.task_id returning * into t;
  insert into destruktion_meta.devos_fleet_claim_h205f22(task_id,workspace_id,point_id,base_sha,role,claim_class,agent_id,tab_id,target_id,agent_generation_epoch,lease_generation,expires_at)
    values(t.task_id,t.workspace_id,t.point_id,t.base_sha,t.role,t.claim_class,t.lease_agent_id,t.lease_tab_id,t.lease_target_id,t.lease_agent_generation_epoch,t.lease_generation,t.lease_expires_at)
    returning claim_id into claimid;
  auth:=destruktion_meta.project_parent_h205f22(p_workspace_id,s.project_id,t.task_id,claimid,t.lease_generation,p_device_id,p_client_id,p_admin_grant_epoch);
  select destruktion_meta.devos_normalize_native_supervisor_state_h205f22(state) into observed
    from public.compute_fabric_a2_browser_supervisor_state_h205f22 where workspace_id=p_workspace_id and client_id=p_client_id;
  select value into agent from jsonb_array_elements(observed#>'{fleet,agents}') where value->>'agent_id'=t.lease_agent_id;
  if agent#>>'{transport_proof,conversation_url_sha256}' is distinct from s.checkpoint->>'conversation_url_sha256'
    or agent#>>'{transport_proof,agent_surface_sha256}' is distinct from s.checkpoint->>'agent_surface_sha256'
    then raise exception 'BROWSER_RESUME_CONVERSATION_FENCED'; end if;
  update destruktion_meta.devos_fleet_task_h205f22 set state='RUNNING' where task_id=t.task_id;
  perform destruktion_meta.devos_emit_event_h205f22(t.workspace_id,'TASK_TRANSPORT_PROVEN',t.task_id,t.point_id,t.role,t.lease_agent_id,t.lease_generation,t.base_sha,
    jsonb_build_object('conversation_url_sha256',s.checkpoint->>'conversation_url_sha256','agent_surface_sha256',agent#>>'{transport_proof,agent_surface_sha256}',
      'effect_state','RESTORED_WITHOUT_SEND','suspension_id',s.suspension_id,'checkpoint_sha256',s.checkpoint_sha256,'physical_send_replayed',false),
    'browser-resume:'||s.suspension_id);
  lease:=jsonb_build_object('leased',true,'state','RUNNING','task_id',t.task_id,'claim_id',claimid,'point_id',t.point_id,'role',t.role,
    'claim_class',t.claim_class,'base_sha',t.base_sha,'branch_name',t.branch_name,'task_spec',t.task_spec,'task_spec_sha256',t.task_spec_sha256,
    'lease_generation',t.lease_generation,'lease_expires_at',t.lease_expires_at,'agent_id',t.lease_agent_id,'tab_id',t.lease_tab_id,
    'target_id',t.lease_target_id,'agent_generation_epoch',t.lease_agent_generation_epoch,
    'conversation_url_sha256',s.checkpoint->>'conversation_url_sha256','automatic_retry_allowed',false,'authority_effect',false);
  update destruktion_meta.browser_parent_suspension_h205f22 set status='RESUMED',restoration=p_restoration,resumed_lease=lease,resumed_at=clock_timestamp()
    where suspension_id=s.suspension_id;
  perform destruktion_meta.project_append_h205f22(s.project_id,'BROWSER_PARENT_RESUMED',s.task_id,t.lease_generation,p_client_id,null,null,null,
    jsonb_build_object('suspension_id',s.suspension_id,'checkpoint_sha256',s.checkpoint_sha256,'old_lease_generation',s.old_lease_generation,'physical_send_replayed',false),
    'SIGNED_HOST_OBSERVATION',null,false,'browser-resume:'||s.suspension_id);
  return destruktion_meta.browser_parent_suspension_projection_v1(s.suspension_id)||jsonb_build_object('replayed',false);
end $$;
revoke all on function public.h205f22_project_resume_browser_v1(uuid,uuid,jsonb,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.h205f22_project_resume_browser_v1(uuid,uuid,jsonb,uuid,text,bigint) to service_role;

-- Reservation is signed Host telemetry, never agent/tool output. It denies
-- ordinary allocation while restoration is physically ACTIVE but awaiting ACK.
create function destruktion_meta.browser_parent_reservation_v1(p_workspace uuid,p_agent text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta as $$
declare snapshot jsonb; reservation jsonb;
begin
 select destruktion_meta.devos_normalize_native_supervisor_state_h205f22(state) into snapshot
   from public.compute_fabric_a2_browser_supervisor_state_h205f22 where workspace_id=p_workspace order by last_seen_at desc limit 1;
 if (select count(*) from jsonb_array_elements(snapshot#>'{fleet,agents}') a where lower(a->>'agent_id')=lower(p_agent))>1
   then raise exception 'BROWSER_RESTORATION_AGENT_AMBIGUOUS'; end if;
 select a->'browser_parent_restoration' into reservation from jsonb_array_elements(snapshot#>'{fleet,agents}') a where lower(a->>'agent_id')=lower(p_agent);
 return nullif(reservation,'null'::jsonb);
end $$;
revoke all on function destruktion_meta.browser_parent_reservation_v1(uuid,text) from public,anon,authenticated,service_role;

create function destruktion_meta.browser_parent_reserved_claim_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta as $$
declare reservation jsonb; s destruktion_meta.browser_parent_suspension_h205f22;
begin
 perform pg_advisory_xact_lock(hashtextextended('browser-agent:'||new.workspace_id||':'||lower(new.agent_id),0));
 if exists(select 1 from destruktion_meta.browser_child_retirement_h205f22 where workspace_id=new.workspace_id and agent_id=new.agent_id
   and tab_id=new.tab_id and target_id=new.target_id and agent_generation_epoch=new.agent_generation_epoch)
   then raise exception 'BROWSER_PHYSICAL_IDENTITY_RETIRED'; end if;
 if new.target_id like 'codex-cli:%' then
   if exists(select 1 from destruktion_meta.browser_parent_suspension_h205f22 where workspace_id=new.workspace_id and status='SUSPENDED' and checkpoint->>'agent_id'=new.agent_id)
     then raise exception 'BROWSER_PARENT_AGENT_SUSPENDED'; end if;
   return new;
 end if;
 reservation:=destruktion_meta.browser_parent_reservation_v1(new.workspace_id,new.agent_id);
 if reservation is null then
   if exists(select 1 from destruktion_meta.browser_parent_suspension_h205f22 where workspace_id=new.workspace_id and status='SUSPENDED' and checkpoint->>'agent_id'=new.agent_id)
     then raise exception 'BROWSER_PARENT_AGENT_SUSPENDED'; end if;
   return new;
 end if;
 if jsonb_typeof(reservation) is distinct from 'object' or reservation->>'schema' is distinct from 'metaengine.browser.parent-restoration-reservation.v1'
   or (select count(*) from jsonb_object_keys(reservation))<>6
   or reservation->'authority_effect' is distinct from 'false'::jsonb or reservation->'automatic_retry_allowed' is distinct from 'false'::jsonb
   then raise exception 'BROWSER_RESTORATION_RESERVATION_INVALID'; end if;
 select * into s from destruktion_meta.browser_parent_suspension_h205f22 where suspension_id=(reservation->>'suspension_id')::uuid for share;
 if not found or s.status is distinct from 'SUSPENDED' or s.workspace_id is distinct from new.workspace_id
   or s.task_id is distinct from new.task_id or reservation->>'task_id' is distinct from new.task_id::text
   or reservation->>'checkpoint_sha256' is distinct from s.checkpoint_sha256
   or new.agent_id is distinct from s.checkpoint->>'agent_id' or new.lease_generation is distinct from s.old_lease_generation+1
   then raise exception 'BROWSER_RESTORATION_CLAIM_RESERVED'; end if;
 return new;
end $$;
revoke all on function destruktion_meta.browser_parent_reserved_claim_v1() from public,anon,authenticated,service_role;
create trigger browser_parent_reserved_claim_trg before insert on destruktion_meta.devos_fleet_claim_h205f22
 for each row execute function destruktion_meta.browser_parent_reserved_claim_v1();

-- Preserve existing allocator/admission; reserved physical slots are not idle.
create or replace function public.devos_fleet_lease_v1(
 p_workspace uuid,p_agent text,p_role text,p_tab text,p_target text,p_epoch bigint,p_seconds integer default 900
) returns jsonb language plpgsql security definer
set search_path='pg_catalog','destruktion_meta'
as $$
declare v_task destruktion_meta.devos_fleet_task_h205f22%rowtype; v_claim bigint;
 v_now timestamptz:=clock_timestamp(); v_secs int:=greatest(60,least(3600,coalesce(p_seconds,900)));
begin
 perform pg_advisory_xact_lock(hashtextextended('browser-agent:'||p_workspace||':'||lower(p_agent),0));
   if exists(select 1 from destruktion_meta.browser_parent_suspension_h205f22 where workspace_id=p_workspace and status='SUSPENDED' and checkpoint->>'agent_id'=lower(p_agent))
     or exists(select 1 from destruktion_meta.browser_child_retirement_h205f22 where workspace_id=p_workspace and agent_id=lower(p_agent)
       and tab_id=p_tab and target_id=lower(p_target) and agent_generation_epoch=p_epoch)
     then return jsonb_build_object('leased',false,'agent_id',lower(p_agent),'role',upper(p_role),'capacity_wait',true,
       'wait_reason','BROWSER_PHYSICAL_CUSTODY_HELD','lease_outcome','NOT_ALLOCATED','automatic_retry_allowed',false,'authority_effect',false); end if;
 if p_target not like 'codex-cli:%' and destruktion_meta.browser_parent_reservation_v1(p_workspace,p_agent) is not null then
   return jsonb_build_object('leased',false,'agent_id',lower(p_agent),'role',upper(p_role),'capacity_wait',true,
     'wait_reason','BROWSER_PARENT_RESTORATION_RESERVED','lease_outcome','NOT_ALLOCATED','automatic_retry_allowed',false,'authority_effect',false);
 end if;
 perform public.devos_fleet_reconcile_v1(p_workspace);
 with picked as (
   select task_id from destruktion_meta.devos_fleet_task_h205f22 t
   where workspace_id=p_workspace and state='READY' and role=upper(p_role)
     and ((p_target not like 'codex-cli:%' and not (t.task_spec ? 'native_coding'))
       or (p_target like 'codex-cli:%' and exists (
         select 1 from destruktion_meta.native_coding_operator_permit_h205f22 p
         join destruktion_meta.native_coding_provider_registration_h205f22 r using(permit_id)
         where p.workspace_id=p_workspace and p.provider_id::text=substring(p_target from 11)
           and p.agent_id=lower(p_agent) and p.agent_generation_epoch=p_epoch and p.revoked_at is null
           and (p.permit->>'expires_at')::timestamptz>clock_timestamp()
           and t.base_sha=p.permit->'worktree'->>'base_sha'
           and destruktion_meta.native_coding_worktree_admissible_v1(p_workspace,t.task_id)
           and t.task_spec->'native_coding' @> jsonb_build_object('permit_id',p.permit_id,'goal_id',p.permit->>'goal_id',
             'goal_sha256',p.permit->>'goal_sha256','project_id',p.permit->>'project_id')
       )))
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
exception when sqlstate 'P0N01' then
 -- This exception block rolls back the picked task, generation increment,
 -- claim and root acquisition together. It never retries the allocation.
 return jsonb_build_object('leased',false,'agent_id',lower(p_agent),'role',upper(p_role),
   'capacity_wait',true,'wait_reason','NATIVE_WORKTREE_BUSY','lease_outcome','NOT_ALLOCATED',
   'automatic_retry_allowed',false,'authority_effect',false);
end $$;

-- Release readback is deny-only: expired/older ACTIVE claims and FROZEN
-- workspace bindings still retain custody. No new effect-authority RPC.
create or replace function destruktion_meta.project_task_projection_h205f22(p_project uuid,p_task uuid)
returns jsonb language sql security definer set search_path=pg_catalog,destruktion_meta,pg_temp as $$
  select jsonb_build_object('task_seq',x.task_seq,'task_id',x.task_id,'root_task_id',x.root_task_id,'parent_task_id',x.parent_task_id,'depth',x.depth,
    'state',t.state,'role',t.role,'claim_class',t.claim_class,'base_sha',t.base_sha,'branch_name',t.branch_name,'point_id',t.point_id,
    'coordination_workspace_id',t.workspace_id,'claim_id',c.claim_id,'lease_generation',t.lease_generation,'agent_id',t.lease_agent_id,
    'tab_id',t.lease_tab_id,'target_id',t.lease_target_id,'agent_generation_epoch',t.lease_agent_generation_epoch,'lease_expires_at',t.lease_expires_at,
    'active_claim_count',(select count(*) from destruktion_meta.devos_fleet_claim_h205f22 held where held.task_id=t.task_id and held.state='ACTIVE'),
    'active_workspace_binding_count',(select count(*) from public.compute_fabric_a2_workspace_binding_h205f22 held where held.task_id=t.task_id and held.retired_at is null),
    'objective',left(t.task_spec->>'objective',4000),'task_spec_sha256',t.task_spec_sha256,
    'project_continuity',jsonb_build_object('schema','metaengine.devos.project-task.v1','project_id',p_project,'root_task_id',x.root_task_id,'parent_task_id',x.parent_task_id,'depth',x.depth,'root_request_id',r.request_id),
    'open_children',(select count(*) from destruktion_meta.project_task_h205f22 y join destruktion_meta.devos_fleet_task_h205f22 z using(task_id) where y.project_id=p_project and y.parent_task_id=t.task_id and z.state<>'COMPLETED'),
    'blocking_children',(select count(*) from destruktion_meta.project_task_h205f22 y join destruktion_meta.devos_fleet_task_h205f22 z using(task_id) where y.project_id=p_project and y.parent_task_id=t.task_id and z.state in ('FAILED','BLOCKED','AMBIGUOUS','FENCED')),
    'pending_proposals',(select count(*) from destruktion_meta.project_child_proposal_h205f22 y where y.project_id=p_project and y.parent_task_id=t.task_id and y.child_task_id is null))
  from destruktion_meta.project_task_h205f22 x join destruktion_meta.devos_fleet_task_h205f22 t using(task_id) join destruktion_meta.project_run_h205f22 r using(project_id)
  left join lateral (select claim_id from destruktion_meta.devos_fleet_claim_h205f22 where task_id=t.task_id and lease_generation=t.lease_generation and state='ACTIVE' and expires_at>clock_timestamp() order by claim_id desc limit 1) c on true
  where x.project_id=p_project and x.task_id=p_task
$$;


create function public.h205f22_project_release_browser_child_v1(p_workspace_id uuid,p_task_id uuid,p_lease_generation bigint,
 p_agent_id text,p_tab_id text,p_target_id text,p_agent_generation_epoch bigint,p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta as $$
declare t destruktion_meta.devos_fleet_task_h205f22; project uuid; prior destruktion_meta.browser_child_retirement_h205f22;
 receipt jsonb; id uuid:=gen_random_uuid();
begin
 select project_id into project from destruktion_meta.project_task_h205f22 where task_id=p_task_id;
 perform destruktion_meta.project_authorize_h205f22(p_workspace_id,project,p_device_id,p_client_id,p_admin_grant_epoch);
 perform pg_advisory_xact_lock(hashtextextended('browser-agent:'||p_workspace_id||':'||lower(p_agent_id),0));
 select * into prior from destruktion_meta.browser_child_retirement_h205f22 where task_id=p_task_id and lease_generation=p_lease_generation;
 if found then
   if prior.workspace_id is distinct from p_workspace_id or prior.agent_id is distinct from p_agent_id or prior.tab_id is distinct from p_tab_id
     or prior.target_id is distinct from p_target_id or prior.agent_generation_epoch is distinct from p_agent_generation_epoch
     then raise exception 'BROWSER_CHILD_RETIREMENT_COLLISION'; end if;
   return prior.receipt||jsonb_build_object('replayed',true);
 end if;
 select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=p_task_id and workspace_id=p_workspace_id for update;
 if not found or t.state not in ('RESULT_READY','COMPLETED') or t.claim_class is distinct from 'READ_ONLY' or t.task_spec ? 'native_coding'
   or t.lease_generation is distinct from p_lease_generation or t.lease_agent_id is distinct from p_agent_id or t.lease_tab_id is distinct from p_tab_id
   or t.lease_target_id is distinct from p_target_id or t.lease_agent_generation_epoch is distinct from p_agent_generation_epoch
   or coalesce(p_target_id,'') not like 'webcontents:%'
   then raise exception 'BROWSER_CHILD_RETIREMENT_TASK_FENCED'; end if;
 if exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 where state='ACTIVE' and (task_id=p_task_id or (workspace_id=p_workspace_id and agent_id=p_agent_id)))
   or exists(select 1 from public.compute_fabric_a2_workspace_binding_h205f22 where retired_at is null and (task_id=p_task_id or agent_id=p_agent_id))
   then raise exception 'BROWSER_CHILD_RETIREMENT_CUSTODY_HELD'; end if;
 if not exists(with recursive ancestors as (
   select parent_task_id from destruktion_meta.project_task_h205f22 where task_id=p_task_id and project_id=project
   union select pt.parent_task_id from destruktion_meta.project_task_h205f22 pt join ancestors a on a.parent_task_id=pt.task_id where pt.project_id=project
 ) select 1 from ancestors a join destruktion_meta.browser_parent_suspension_h205f22 s on s.task_id=a.parent_task_id
   where s.project_id=project and s.status='SUSPENDED') then raise exception 'BROWSER_CHILD_RETIREMENT_NO_SUSPENDED_ANCESTOR'; end if;
 receipt:=jsonb_build_object('schema','metaengine.devos.browser-child-retirement.v1','retired',true,'retirement_id',id,'workspace_id',p_workspace_id,
   'project_id',project,'task_id',p_task_id,'lease_generation',p_lease_generation,'agent_id',p_agent_id,'tab_id',p_tab_id,'target_id',p_target_id,
   'agent_generation_epoch',p_agent_generation_epoch,'state',t.state,'claim_class',t.claim_class,'automatic_retry_allowed',false,'authority_effect',false);
 insert into destruktion_meta.browser_child_retirement_h205f22(retirement_id,workspace_id,project_id,task_id,lease_generation,agent_id,tab_id,target_id,agent_generation_epoch,receipt)
 values(id,p_workspace_id,project,p_task_id,p_lease_generation,p_agent_id,p_tab_id,p_target_id,p_agent_generation_epoch,receipt);
 return receipt||jsonb_build_object('replayed',false);
end $$;
revoke all on function public.h205f22_project_release_browser_child_v1(uuid,uuid,bigint,text,text,text,bigint,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.h205f22_project_release_browser_child_v1(uuid,uuid,bigint,text,text,text,bigint,uuid,text,bigint) to service_role;

create function destruktion_meta.browser_child_retirement_immutable_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin raise exception 'BROWSER_CHILD_RETIREMENT_IMMUTABLE'; end $$;
revoke all on function destruktion_meta.browser_child_retirement_immutable_v1() from public,anon,authenticated,service_role;
create trigger browser_child_retirement_immutable_trg before update or delete on destruktion_meta.browser_child_retirement_h205f22
 for each row execute function destruktion_meta.browser_child_retirement_immutable_v1();
