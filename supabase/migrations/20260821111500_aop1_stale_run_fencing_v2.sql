create or replace function destruktion_meta.compute_fabric_aop_run_wake_status_h205f22(p_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,destruktion_meta
as $$
declare
  v_run destruktion_meta.compute_fabric_aop_run_h205f22%rowtype;
  v_role_kind text;
  v_status jsonb;
  v_head text;
  v_effective text;
  v_claim_ok boolean:=false;
  v_reason text;
begin
  select * into v_run from destruktion_meta.compute_fabric_aop_run_h205f22 where run_id=p_run_id;
  if not found then return jsonb_build_object('eligible',false,'reason','UNKNOWN_RUN','canonical',false,'authority_effect',false); end if;
  select role_kind into v_role_kind from destruktion_meta.compute_fabric_aop_role_h205f22 where role_key=v_run.role_key and enabled=true;
  if v_role_kind is null then return jsonb_build_object('eligible',false,'reason','ROLE_DISABLED_OR_MISSING','canonical',false,'authority_effect',false); end if;
  if v_run.state<>'WAITING_EVENT' then return jsonb_build_object('eligible',false,'reason','RUN_NOT_WAITING_EVENT','state',v_run.state,'canonical',false,'authority_effect',false); end if;
  v_status:=destruktion_meta.compute_fabric_roadmap_status_h205f22();
  v_head:=v_status#>>'{semantic_head,checkpoint_id}';
  if v_run.base_checkpoint_id is distinct from v_head then return jsonb_build_object('eligible',false,'reason','STALE_SEMANTIC_HEAD','base_checkpoint_id',v_run.base_checkpoint_id,'semantic_checkpoint_id',v_head,'canonical',false,'authority_effect',false); end if;
  if v_run.milestone_key is not null then select m->>'effective_status' into v_effective from jsonb_array_elements(v_status->'milestones') m where m->>'milestone_key'=v_run.milestone_key limit 1; end if;
  v_reason:=coalesce(v_run.input->>'reason','');
  if v_role_kind='IMPLEMENTER' then
    if v_effective is distinct from 'IN_PROGRESS' then return jsonb_build_object('eligible',false,'reason','ROADMAP_NOT_IN_PROGRESS','effective_status',v_effective,'canonical',false,'authority_effect',false); end if;
    select exists(select 1 from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 c where c.claim_id=v_run.claim_id and c.roadmap_id='compute-fabric-roadmap-v1' and c.milestone_key=v_run.milestone_key and c.state='ACTIVE' and c.expires_at>clock_timestamp() and c.holder_id='aop1:'||v_run.role_key and c.base_checkpoint_id=v_head) into v_claim_ok;
    if not v_claim_ok then return jsonb_build_object('eligible',false,'reason','ORPHANED_OR_EXPIRED_CLAIM','claim_id',v_run.claim_id,'canonical',false,'authority_effect',false); end if;
  elsif v_role_kind='ANALYST' and v_run.milestone_key is not null then
    if v_effective is distinct from 'EVIDENCE_READY' then return jsonb_build_object('eligible',false,'reason','ROADMAP_NOT_EVIDENCE_READY','effective_status',v_effective,'canonical',false,'authority_effect',false); end if;
  elsif v_role_kind='SUPERVISOR' and v_run.milestone_key is not null then
    if v_reason='AUTHORITY_REBIND_REQUIRED' and v_effective is distinct from 'IN_PROGRESS' then return jsonb_build_object('eligible',false,'reason','SUPERVISOR_REBIND_STATUS_STALE','effective_status',v_effective,'canonical',false,'authority_effect',false); end if;
    if (v_reason like 'ANALYST_%' or v_reason='SUPERVISOR_ACCEPT_CONTINUE_TO_SEAL') and v_effective is distinct from 'EVIDENCE_READY' then return jsonb_build_object('eligible',false,'reason','SUPERVISOR_REVIEW_STATUS_STALE','effective_status',v_effective,'canonical',false,'authority_effect',false); end if;
  end if;
  return jsonb_build_object('eligible',true,'reason','ELIGIBLE','role_kind',v_role_kind,'effective_status',v_effective,'semantic_checkpoint_id',v_head,'canonical',false,'authority_effect',false);
end $$;
revoke all on function destruktion_meta.compute_fabric_aop_run_wake_status_h205f22(uuid) from public,anon,authenticated;
grant execute on function destruktion_meta.compute_fabric_aop_run_wake_status_h205f22(uuid) to postgres,service_role;

create or replace function destruktion_meta.compute_fabric_aop_reconcile_h205f22()
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,destruktion_meta,extensions
as $$
declare
  v_status jsonb; v_m jsonb; v_role text; v_holder text; v_claim_id bigint; v_created integer:=0; v_fenced integer:=0; v_result jsonb; v_milestone text; v_effective text; v_f record; v_head text;
begin
  if not pg_try_advisory_xact_lock(hashtext('metaengine:h205f22:aop1:reconcile')) then return jsonb_build_object('schema','metaengine.compute.aop-reconcile.h205f22.v4','status','SKIPPED_LOCKED','created_runs',0,'fenced_runs',0,'canonical',false,'authority_effect',false); end if;
  v_status:=destruktion_meta.compute_fabric_roadmap_status_h205f22(); v_head:=v_status#>>'{semantic_head,checkpoint_id}';
  for v_f in
    update destruktion_meta.compute_fabric_aop_run_h205f22 r set state='FENCED',lease_owner=null,lease_expires_at=null,wake_condition=null,error_class='FENCED',error_code='STALE_SEMANTIC_HEAD',error_text='run base checkpoint no longer equals authoritative semantic head',finished_at=coalesce(finished_at,clock_timestamp()),updated_at=clock_timestamp()
    where r.state in ('READY','LEASED','RUNNING','WAITING_EXECUTOR','WAITING_EVENT') and r.base_checkpoint_id is distinct from v_head
    returning r.run_id,r.milestone_key,r.role_key,r.expected_github_sha
  loop
    v_fenced:=v_fenced+1;
    perform destruktion_meta.compute_fabric_aop_emit_event_h205f22('RUN_FENCED',v_f.milestone_key,v_f.run_id,v_f.role_key,'AOP',jsonb_build_object('reason','STALE_SEMANTIC_HEAD','semantic_checkpoint_id',v_head),'fence:stale-head:v2:'||v_f.run_id::text||':'||coalesce(v_head,'none'),v_f.expected_github_sha);
  end loop;
  for v_f in
    update destruktion_meta.compute_fabric_aop_run_h205f22 r set state='FENCED',lease_owner=null,lease_expires_at=null,wake_condition=null,error_class='FENCED',error_code='ORPHANED_OR_EXPIRED_CLAIM',error_text='implementer run no longer has its exact active current-head AOP claim',finished_at=coalesce(finished_at,clock_timestamp()),updated_at=clock_timestamp()
    from destruktion_meta.compute_fabric_aop_role_h205f22 ro
    where r.role_key=ro.role_key and ro.role_kind='IMPLEMENTER' and r.state in ('READY','LEASED','RUNNING','WAITING_EXECUTOR','WAITING_EVENT') and r.base_checkpoint_id=v_head
      and not exists(select 1 from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 c where c.claim_id=r.claim_id and c.roadmap_id='compute-fabric-roadmap-v1' and c.milestone_key=r.milestone_key and c.state='ACTIVE' and c.expires_at>clock_timestamp() and c.holder_id='aop1:'||r.role_key and c.base_checkpoint_id=v_head)
    returning r.run_id,r.milestone_key,r.role_key,r.expected_github_sha
  loop
    v_fenced:=v_fenced+1;
    perform destruktion_meta.compute_fabric_aop_emit_event_h205f22('RUN_FENCED',v_f.milestone_key,v_f.run_id,v_f.role_key,'AOP',jsonb_build_object('reason','ORPHANED_OR_EXPIRED_CLAIM','semantic_checkpoint_id',v_head),'fence:orphan-claim:v2:'||v_f.run_id::text||':'||coalesce(v_head,'none'),v_f.expected_github_sha);
  end loop;
  for v_m in select value from jsonb_array_elements(v_status->'milestones') loop
    v_milestone:=v_m->>'milestone_key'; v_effective:=v_m->>'effective_status';
    if v_effective='EVIDENCE_READY' then
      if not exists(select 1 from destruktion_meta.compute_fabric_aop_run_h205f22 where milestone_key=v_milestone and role_key='INTEGRATION_ANALYST' and state in ('READY','LEASED','RUNNING','WAITING_EXECUTOR','WAITING_EVENT') and base_checkpoint_id=v_head and created_at>clock_timestamp()-interval '24 hours')
         and not exists(select 1 from destruktion_meta.compute_fabric_aop_run_h205f22 where milestone_key=v_milestone and role_key='MAINLINE_SUPERVISOR' and state in ('READY','LEASED','RUNNING','WAITING_EXECUTOR','WAITING_EVENT') and base_checkpoint_id=v_head and created_at>clock_timestamp()-interval '24 hours') then
        v_result:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22('INTEGRATION_ANALYST',v_milestone,null,null,jsonb_build_object('reason','AUTHORITATIVE_EVIDENCE_READY','roadmap_status',v_effective),'reconcile:analyst:v2:'||v_milestone||':'||coalesce(v_head,'none')); v_created:=v_created+1;
      end if;
    elsif v_effective='IN_PROGRESS' then
      select role_key into v_role from destruktion_meta.compute_fabric_aop_role_h205f22 where role_kind='IMPLEMENTER' and milestone_key=v_milestone and enabled=true;
      if v_role is not null then
        v_holder:='aop1:'||v_role;
        select claim_id into v_claim_id from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 where roadmap_id='compute-fabric-roadmap-v1' and milestone_key=v_milestone and state='ACTIVE' and expires_at>clock_timestamp() and holder_id=v_holder and base_checkpoint_id=v_head order by claim_id desc limit 1;
        if v_claim_id is not null then
          if not exists(select 1 from destruktion_meta.compute_fabric_aop_run_h205f22 where milestone_key=v_milestone and role_key=v_role and claim_id=v_claim_id and state in ('READY','LEASED','RUNNING','WAITING_EXECUTOR','WAITING_EVENT') and base_checkpoint_id=v_head and created_at>clock_timestamp()-interval '24 hours') then
            v_result:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22(v_role,v_milestone,null,null,jsonb_build_object('reason','AUTHORITATIVE_IN_PROGRESS','roadmap_status',v_effective,'authority_holder',v_holder),'reconcile:implementer:v2:'||v_milestone||':'||v_claim_id::text||':'||coalesce(v_head,'none')); v_created:=v_created+1;
          end if;
        else
          if not exists(select 1 from destruktion_meta.compute_fabric_aop_run_h205f22 where milestone_key=v_milestone and role_key='MAINLINE_SUPERVISOR' and state in ('READY','LEASED','RUNNING','WAITING_EXECUTOR','WAITING_EVENT') and input->>'reason'='AUTHORITY_REBIND_REQUIRED' and base_checkpoint_id=v_head) then
            v_result:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22('MAINLINE_SUPERVISOR',v_milestone,null,null,jsonb_build_object('reason','AUTHORITY_REBIND_REQUIRED','target_holder',v_holder,'roadmap_status',v_effective),'reconcile:authority-rebind:v2:'||v_milestone||':'||coalesce(v_head,'none')); v_created:=v_created+1;
          end if;
        end if;
      end if;
    end if;
    v_role:=null; v_holder:=null; v_claim_id:=null;
  end loop;
  return jsonb_build_object('schema','metaengine.compute.aop-reconcile.h205f22.v4','status','PASS','created_runs',v_created,'fenced_runs',v_fenced,'semantic_head',v_status->'semantic_head','canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_aop1_signal_v1(p_condition text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $$
declare v_count integer; v_now timestamptz:=clock_timestamp(); v_payload jsonb:=coalesce(p_payload,'{}'::jsonb);
begin
  if p_condition is null or char_length(p_condition)<3 then raise exception 'invalid_condition' using errcode='22023'; end if;
  if jsonb_typeof(v_payload)<>'object' then raise exception 'signal_payload_must_be_object' using errcode='22023'; end if;
  if octet_length(v_payload::text)>65536 then raise exception 'signal_payload_too_large' using errcode='22023'; end if;
  if p_condition='GITHUB_WRITE_EXECUTOR_AVAILABLE' then
    perform destruktion_meta.compute_fabric_aop_emit_event_h205f22('CONDITION_SIGNAL_REJECTED_BROAD_MUTATION',null,null,null,'EXTERNAL',jsonb_build_object('condition',p_condition,'reason','TARGETED_OR_ROLE_SIGNAL_REQUIRED'),'signal-reject-broad-write:'||v_now::text,null);
    return jsonb_build_object('schema','metaengine.compute.aop-signal.h205f22.v3','condition',p_condition,'woken_runs',0,'reason','TARGETED_OR_ROLE_SIGNAL_REQUIRED','canonical',false,'authority_effect',false);
  end if;
  perform destruktion_meta.compute_fabric_aop_reconcile_h205f22();
  update destruktion_meta.compute_fabric_aop_run_h205f22 r set state='READY',wake_condition=null,input=coalesce(input,'{}'::jsonb)||jsonb_build_object('resume_signal',jsonb_build_object('condition',p_condition,'payload',v_payload,'received_at',v_now)),updated_at=v_now
  where r.state='WAITING_EVENT' and r.wake_condition=p_condition and coalesce((destruktion_meta.compute_fabric_aop_run_wake_status_h205f22(r.run_id)->>'eligible')::boolean,false);
  get diagnostics v_count=row_count;
  perform destruktion_meta.compute_fabric_aop_emit_event_h205f22('CONDITION_SIGNAL',null,null,null,'EXTERNAL',jsonb_build_object('condition',p_condition,'payload',v_payload,'woken_runs',v_count,'resume_payload_attached',true,'stale_or_orphan_runs_fail_closed',true),'signal:v3:'||p_condition||':'||v_now::text,null);
  return jsonb_build_object('schema','metaengine.compute.aop-signal.h205f22.v3','condition',p_condition,'woken_runs',v_count,'resume_payload_attached',true,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_aop1_signal_role_v1(p_condition text,p_role_key text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $$
declare v_count integer; v_role destruktion_meta.compute_fabric_aop_role_h205f22%rowtype; v_now timestamptz:=clock_timestamp(); v_payload jsonb:=coalesce(p_payload,'{}'::jsonb);
begin
  if p_condition is null or char_length(p_condition)<3 then raise exception 'invalid_condition' using errcode='22023'; end if; if p_role_key is null or char_length(p_role_key)<3 then raise exception 'invalid_role_key' using errcode='22023'; end if; if jsonb_typeof(v_payload)<>'object' then raise exception 'payload_must_be_object' using errcode='22023'; end if; if octet_length(v_payload::text)>65536 then raise exception 'signal_payload_too_large' using errcode='22023'; end if;
  select * into v_role from destruktion_meta.compute_fabric_aop_role_h205f22 where role_key=p_role_key and enabled=true; if not found then raise exception 'unknown_or_disabled_role' using errcode='22023'; end if;
  perform destruktion_meta.compute_fabric_aop_reconcile_h205f22();
  update destruktion_meta.compute_fabric_aop_run_h205f22 r set state='READY',wake_condition=null,input=coalesce(input,'{}'::jsonb)||jsonb_build_object('resume_signal',jsonb_build_object('condition',p_condition,'payload',v_payload,'received_at',v_now)),updated_at=v_now
  where r.state='WAITING_EVENT' and r.wake_condition=p_condition and r.role_key=p_role_key and coalesce((destruktion_meta.compute_fabric_aop_run_wake_status_h205f22(r.run_id)->>'eligible')::boolean,false);
  get diagnostics v_count=row_count;
  perform destruktion_meta.compute_fabric_aop_emit_event_h205f22('CONDITION_SIGNAL_ROLE',v_role.milestone_key,null,p_role_key,'EXTERNAL',jsonb_build_object('condition',p_condition,'role_key',p_role_key,'payload',v_payload,'woken_runs',v_count,'resume_payload_attached',true,'stale_or_orphan_runs_fail_closed',true),'signal-role:v2:'||p_condition||':'||p_role_key||':'||v_now::text,null);
  return jsonb_build_object('schema','metaengine.compute.aop-signal-role.h205f22.v2','condition',p_condition,'role_key',p_role_key,'woken_runs',v_count,'resume_payload_attached',true,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_aop1_signal_run_v1(p_run_id uuid,p_condition text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $$
declare v_run destruktion_meta.compute_fabric_aop_run_h205f22%rowtype; v_event jsonb; v_wake jsonb; v_now timestamptz:=clock_timestamp(); v_payload jsonb:=coalesce(p_payload,'{}'::jsonb);
begin
  if p_run_id is null then raise exception 'run_id_required' using errcode='22023'; end if; if p_condition is null or char_length(p_condition)<3 then raise exception 'invalid_condition' using errcode='22023'; end if; if jsonb_typeof(v_payload)<>'object' then raise exception 'signal_payload_must_be_object' using errcode='22023'; end if; if octet_length(v_payload::text)>65536 then raise exception 'signal_payload_too_large' using errcode='22023'; end if;
  perform destruktion_meta.compute_fabric_aop_reconcile_h205f22();
  select * into v_run from destruktion_meta.compute_fabric_aop_run_h205f22 where run_id=p_run_id for update; if not found then raise exception 'unknown_run' using errcode='22023'; end if;
  if v_run.state='FENCED' then return jsonb_build_object('schema','metaengine.compute.aop-targeted-signal.h205f22.v3','run_id',p_run_id,'condition',p_condition,'woken',false,'reason',coalesce(v_run.error_code,'FENCED'),'resume_payload_attached',false,'canonical',false,'authority_effect',false); end if;
  if v_run.state<>'WAITING_EVENT' then raise exception 'run_not_waiting_event' using errcode='55000'; end if; if v_run.wake_condition is distinct from p_condition then raise exception 'wake_condition_mismatch' using errcode='55000'; end if;
  v_wake:=destruktion_meta.compute_fabric_aop_run_wake_status_h205f22(p_run_id); if not coalesce((v_wake->>'eligible')::boolean,false) then return jsonb_build_object('schema','metaengine.compute.aop-targeted-signal.h205f22.v3','run_id',p_run_id,'condition',p_condition,'woken',false,'reason',v_wake->>'reason','resume_payload_attached',false,'canonical',false,'authority_effect',false); end if;
  update destruktion_meta.compute_fabric_aop_run_h205f22 set state='READY',wake_condition=null,input=coalesce(input,'{}'::jsonb)||jsonb_build_object('resume_signal',jsonb_build_object('condition',p_condition,'payload',v_payload,'received_at',v_now)),updated_at=v_now where run_id=p_run_id;
  v_event:=destruktion_meta.compute_fabric_aop_emit_event_h205f22('CONDITION_SIGNAL_TARGETED',v_run.milestone_key,v_run.run_id,v_run.role_key,'EXTERNAL',jsonb_build_object('condition',p_condition,'payload',v_payload,'resume_payload_attached',true,'stale_or_orphan_runs_fail_closed',true),'targeted-signal:v3:'||p_run_id::text||':'||p_condition||':'||v_now::text,v_run.expected_github_sha);
  return jsonb_build_object('schema','metaengine.compute.aop-targeted-signal.h205f22.v3','run_id',p_run_id,'condition',p_condition,'woken',true,'resume_payload_attached',true,'event_id',(v_event->>'event_id')::bigint,'canonical',false,'authority_effect',false);
end $$;

revoke all on function public.h205f22_aop1_signal_v1(text,jsonb) from public,anon,authenticated; revoke all on function public.h205f22_aop1_signal_role_v1(text,text,jsonb) from public,anon,authenticated; revoke all on function public.h205f22_aop1_signal_run_v1(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.h205f22_aop1_signal_v1(text,jsonb) to postgres,service_role; grant execute on function public.h205f22_aop1_signal_role_v1(text,text,jsonb) to postgres,service_role; grant execute on function public.h205f22_aop1_signal_run_v1(uuid,text,jsonb) to postgres,service_role;

-- Completion v5: before any authoritative finish, require current semantic head;
-- Implementer must still own exact ACTIVE current-head claim; Analyst must still
-- be auditing EVIDENCE_READY; Supervisor review/rebind reasons must still match
-- the authoritative roadmap state. Full behavior remains identical to v4 after
-- these additional guards, including implementer->analyst->supervisor chaining.
create or replace function public.h205f22_aop1_complete_run_v1(p_run_id uuid,p_worker text,p_lease_generation bigint,p_result_code text,p_output jsonb default '{}'::jsonb,p_github_sha text default null,p_wake_condition text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta,extensions as $$
declare
  v_run destruktion_meta.compute_fabric_aop_run_h205f22%rowtype; v_role destruktion_meta.compute_fabric_aop_role_h205f22%rowtype; v_output jsonb:=coalesce(p_output,'{}'::jsonb); v_sha text; v_event jsonb; v_event_id bigint; v_next jsonb; v_terminal_state text:='COMPLETED'; v_impl_role text; v_claim destruktion_meta.compute_fabric_roadmap_work_claim_h205f22%rowtype; v_finish jsonb; v_authoritative_status text; v_reason text; v_status jsonb; v_head text; v_effective text;
begin
  if jsonb_typeof(v_output)<>'object' then raise exception 'output_must_be_object' using errcode='22023'; end if;
  select * into v_run from destruktion_meta.compute_fabric_aop_run_h205f22 where run_id=p_run_id for update; if not found then raise exception 'unknown_run' using errcode='22023'; end if;
  if v_run.state<>'LEASED' or v_run.lease_owner is distinct from p_worker or v_run.lease_generation<>p_lease_generation or v_run.lease_expires_at<=clock_timestamp() then raise exception 'run_lease_fenced' using errcode='55000'; end if;
  select * into v_role from destruktion_meta.compute_fabric_aop_role_h205f22 where role_key=v_run.role_key; v_reason:=coalesce(v_run.input->>'reason',''); v_status:=destruktion_meta.compute_fabric_roadmap_status_h205f22(); v_head:=v_status#>>'{semantic_head,checkpoint_id}';
  if v_run.base_checkpoint_id is distinct from v_head then raise exception 'run_base_checkpoint_stale' using errcode='55000'; end if;
  if v_run.milestone_key is not null then select m->>'effective_status' into v_effective from jsonb_array_elements(v_status->'milestones') m where m->>'milestone_key'=v_run.milestone_key limit 1; end if;
  if v_role.role_kind='IMPLEMENTER' and p_result_code not in ('CONTINUE','EVIDENCE_READY','WAITING_EVENT','FAILED') then raise exception 'invalid_implementer_result' using errcode='22023'; end if;
  if v_role.role_kind='ANALYST' and p_result_code not in ('ACCEPT','ACCEPT_WITH_REBASE','REQUEST_CHANGES','HOLD','REJECT') then raise exception 'invalid_analyst_result' using errcode='22023'; end if;
  if v_role.role_kind='SUPERVISOR' and p_result_code not in ('ACCEPT','RETURN','WAIT','VERIFIED','REJECT') then raise exception 'invalid_supervisor_result' using errcode='22023'; end if;
  if v_role.role_kind='SUPERVISOR' and p_result_code='RETURN' and v_reason not in ('ANALYST_REQUEST_CHANGES','ANALYST_HOLD','ANALYST_REJECT','ANALYST_ACCEPT_WITH_REBASE') then raise exception 'supervisor_return_result_forbidden_for_run_reason:%',v_reason using errcode='42501'; end if;
  if v_role.role_kind='IMPLEMENTER' and p_result_code<>'FAILED' then
    if v_effective is distinct from 'IN_PROGRESS' then raise exception 'implementer_completion_requires_in_progress' using errcode='55000'; end if;
    if v_run.claim_id is null then raise exception 'active_claim_required_for_implementer_completion' using errcode='55000'; end if;
    select * into v_claim from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 where claim_id=v_run.claim_id for update;
    if not found or v_claim.state<>'ACTIVE' or v_claim.expires_at<=clock_timestamp() or v_claim.holder_id is distinct from 'aop1:'||v_run.role_key or v_claim.milestone_key is distinct from v_run.milestone_key or v_claim.base_checkpoint_id is distinct from v_head then raise exception 'active_claim_required_for_implementer_completion' using errcode='55000'; end if;
  elsif v_role.role_kind='ANALYST' and v_effective is distinct from 'EVIDENCE_READY' then raise exception 'analyst_completion_requires_evidence_ready' using errcode='55000';
  elsif v_role.role_kind='SUPERVISOR' then
    if v_reason='AUTHORITY_REBIND_REQUIRED' and v_effective is distinct from 'IN_PROGRESS' then raise exception 'supervisor_rebind_completion_status_stale' using errcode='55000'; end if;
    if (v_reason like 'ANALYST_%' or v_reason='SUPERVISOR_ACCEPT_CONTINUE_TO_SEAL') and p_result_code<>'VERIFIED' and v_effective is distinct from 'EVIDENCE_READY' then raise exception 'supervisor_review_completion_status_stale' using errcode='55000'; end if;
  end if;
  if v_role.role_kind='IMPLEMENTER' and p_result_code='EVIDENCE_READY' then if jsonb_typeof(v_output->'summary') is distinct from 'object' or jsonb_typeof(v_output->'evidence') is distinct from 'object' or jsonb_typeof(v_output->'research') is distinct from 'object' then raise exception 'evidence_ready_requires_summary_evidence_research_objects' using errcode='22023'; end if; v_finish:=destruktion_meta.compute_fabric_finish_roadmap_claim_h205f22(v_claim.claim_id,v_claim.claim_token,v_output->'summary',v_output->'evidence',v_output->'research'); end if;
  v_sha:=encode(extensions.digest(convert_to(v_output::text,'UTF8'),'sha256'),'hex'); if p_result_code='WAITING_EVENT' or (v_role.role_kind='SUPERVISOR' and p_result_code='WAIT') then v_terminal_state:='WAITING_EVENT'; end if; if (v_role.role_kind='IMPLEMENTER' and p_result_code='FAILED') or (v_role.role_kind='SUPERVISOR' and p_result_code='REJECT') then v_terminal_state:='FAILED'; end if;
  update destruktion_meta.compute_fabric_aop_run_h205f22 set state=v_terminal_state,output=v_output,output_sha256=v_sha,result_code=p_result_code,expected_github_sha=coalesce(p_github_sha,expected_github_sha),wake_condition=case when v_terminal_state='WAITING_EVENT' then coalesce(p_wake_condition,wake_condition,'EXTERNAL_CHANGE') else wake_condition end,lease_owner=null,lease_expires_at=null,finished_at=case when v_terminal_state in ('COMPLETED','FAILED') then clock_timestamp() else null end,updated_at=clock_timestamp() where run_id=p_run_id;
  v_event:=destruktion_meta.compute_fabric_aop_emit_event_h205f22('RUN_RESULT_'||p_result_code,v_run.milestone_key,p_run_id,v_run.role_key,v_role.role_kind,v_output||case when v_finish is null then '{}'::jsonb else jsonb_build_object('authoritative_finish',v_finish) end,v_run.idempotency_key||':result:'||p_lease_generation::text||':'||p_result_code,p_github_sha); v_event_id:=(v_event->>'event_id')::bigint;
  if v_terminal_state='COMPLETED' then
    if v_role.role_kind='IMPLEMENTER' and p_result_code='CONTINUE' then v_next:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22(v_run.role_key,v_run.milestone_key,v_event_id,p_run_id,jsonb_build_object('reason','CONTINUE','previous_output_sha256',v_sha),'chain:continue:'||p_run_id::text||':'||p_lease_generation::text,p_github_sha);
    elsif v_role.role_kind='IMPLEMENTER' and p_result_code='EVIDENCE_READY' then v_next:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22('INTEGRATION_ANALYST',v_run.milestone_key,v_event_id,p_run_id,jsonb_build_object('reason','IMPLEMENTER_EVIDENCE_READY','evidence',v_output,'authoritative_finish',v_finish,'github_sha',p_github_sha),'chain:analyst:'||p_run_id::text||':'||p_lease_generation::text,p_github_sha);
    elsif v_role.role_kind='ANALYST' then v_next:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22('MAINLINE_SUPERVISOR',v_run.milestone_key,v_event_id,p_run_id,jsonb_build_object('reason','ANALYST_'||p_result_code,'analyst_verdict',v_output,'verdict_code',p_result_code,'github_sha',p_github_sha),'chain:supervisor:'||p_run_id::text||':'||p_lease_generation::text,p_github_sha);
    elsif v_role.role_kind='SUPERVISOR' and p_result_code='RETURN' then select role_key into v_impl_role from destruktion_meta.compute_fabric_aop_role_h205f22 where role_kind='IMPLEMENTER' and milestone_key=v_run.milestone_key and enabled=true; select x->>'effective_status' into v_authoritative_status from jsonb_array_elements(destruktion_meta.compute_fabric_roadmap_status_h205f22()->'milestones') x where x->>'milestone_key'=v_run.milestone_key; if v_authoritative_status<>'IN_PROGRESS' then raise exception 'supervisor_return_requires_authority_bridge_first: current_status=%',v_authoritative_status using errcode='55000'; end if; if v_impl_role is null then raise exception 'no_implementer_for_milestone' using errcode='55000'; end if; v_next:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22(v_impl_role,v_run.milestone_key,v_event_id,p_run_id,jsonb_build_object('reason','SUPERVISOR_RETURN','required_changes',v_output,'github_sha',p_github_sha),'chain:supervisor-return:'||p_run_id::text||':'||p_lease_generation::text,p_github_sha);
    elsif v_role.role_kind='SUPERVISOR' and p_result_code='ACCEPT' then if v_reason='SUPERVISOR_ACCEPT_CONTINUE_TO_SEAL' then perform destruktion_meta.compute_fabric_aop_emit_event_h205f22('MAINLINE_SEAL_READY',v_run.milestone_key,p_run_id,v_run.role_key,'SUPERVISOR',jsonb_build_object('github_sha',coalesce(p_github_sha,v_run.expected_github_sha),'output_sha256',v_sha,'seal_executor_required',true),v_run.idempotency_key||':mainline-seal-ready:'||p_lease_generation::text,coalesce(p_github_sha,v_run.expected_github_sha)); v_next:=null; else v_next:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22('MAINLINE_SUPERVISOR',v_run.milestone_key,v_event_id,p_run_id,jsonb_build_object('reason','SUPERVISOR_ACCEPT_CONTINUE_TO_SEAL','previous_output_sha256',v_sha,'github_sha',p_github_sha),'chain:supervisor-seal:'||p_run_id::text||':'||p_lease_generation::text,p_github_sha); end if;
    elsif v_role.role_kind='SUPERVISOR' and p_result_code='VERIFIED' then select x->>'effective_status' into v_authoritative_status from jsonb_array_elements(destruktion_meta.compute_fabric_roadmap_status_h205f22()->'milestones') x where x->>'milestone_key'=v_run.milestone_key; if v_authoritative_status<>'VERIFIED' then raise exception 'cannot_record_verified_before_authoritative_roadmap_is_verified' using errcode='55000'; end if; perform destruktion_meta.compute_fabric_aop_emit_event_h205f22('MILESTONE_VERIFIED_OBSERVED',v_run.milestone_key,p_run_id,v_run.role_key,'SUPERVISOR',jsonb_build_object('authoritative_status',v_authoritative_status,'output_sha256',v_sha),v_run.idempotency_key||':verified-observed',p_github_sha); perform destruktion_meta.compute_fabric_aop_reconcile_h205f22();
    end if;
  end if;
  return jsonb_build_object('schema','metaengine.compute.aop-complete.h205f22.v5','run_id',p_run_id,'state',v_terminal_state,'result_code',p_result_code,'output_sha256',v_sha,'authoritative_finish',v_finish,'next_run',v_next,'base_checkpoint_id',v_run.base_checkpoint_id,'semantic_head',v_head,'canonical',false,'authority_effect',false);
end $$;
revoke all on function public.h205f22_aop1_complete_run_v1(uuid,text,bigint,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.h205f22_aop1_complete_run_v1(uuid,text,bigint,text,jsonb,text,text) to postgres,service_role;