create or replace function public.h205f22_aop1_complete_run_v1(p_run_id uuid,p_worker text,p_lease_generation bigint,p_result_code text,p_output jsonb default '{}'::jsonb,p_github_sha text default null,p_wake_condition text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','destruktion_meta','extensions'
as $$
declare
  v_run destruktion_meta.compute_fabric_aop_run_h205f22%rowtype;
  v_role destruktion_meta.compute_fabric_aop_role_h205f22%rowtype;
  v_output jsonb:=coalesce(p_output,'{}'::jsonb);
  v_sha text;
  v_event jsonb;
  v_event_id bigint;
  v_next jsonb;
  v_terminal_state text:='COMPLETED';
  v_impl_role text;
  v_claim destruktion_meta.compute_fabric_roadmap_work_claim_h205f22%rowtype;
  v_finish jsonb;
  v_authoritative_status text;
  v_reason text;
  v_status jsonb;
  v_head text;
begin
  if jsonb_typeof(v_output)<>'object' then raise exception 'output_must_be_object' using errcode='22023'; end if;
  select * into v_run from destruktion_meta.compute_fabric_aop_run_h205f22 where run_id=p_run_id for update;
  if not found then raise exception 'unknown_run' using errcode='22023'; end if;
  if v_run.state<>'LEASED' or v_run.lease_owner is distinct from p_worker or v_run.lease_generation<>p_lease_generation or v_run.lease_expires_at<=clock_timestamp() then raise exception 'run_lease_fenced' using errcode='55000'; end if;
  select * into v_role from destruktion_meta.compute_fabric_aop_role_h205f22 where role_key=v_run.role_key;
  v_reason:=coalesce(v_run.input->>'reason','');
  v_status:=destruktion_meta.compute_fabric_roadmap_status_h205f22();
  v_head:=v_status#>>'{semantic_head,checkpoint_id}';
  if v_run.base_checkpoint_id is distinct from v_head then raise exception 'run_base_checkpoint_stale: run_base=%, semantic_head=%',v_run.base_checkpoint_id,v_head using errcode='55000'; end if;

  if v_role.role_kind='IMPLEMENTER' and p_result_code not in ('CONTINUE','EVIDENCE_READY','WAITING_EVENT','FAILED') then raise exception 'invalid_implementer_result' using errcode='22023'; end if;
  if v_role.role_kind='ANALYST' and p_result_code not in ('ACCEPT','ACCEPT_WITH_REBASE','REQUEST_CHANGES','HOLD','REJECT') then raise exception 'invalid_analyst_result' using errcode='22023'; end if;
  if v_role.role_kind='SUPERVISOR' and p_result_code not in ('ACCEPT','RETURN','WAIT','VERIFIED','REJECT') then raise exception 'invalid_supervisor_result' using errcode='22023'; end if;
  if v_role.role_kind='SUPERVISOR' and p_result_code='RETURN' and v_reason not in ('ANALYST_REQUEST_CHANGES','ANALYST_HOLD','ANALYST_REJECT','ANALYST_ACCEPT_WITH_REBASE') then raise exception 'supervisor_return_result_forbidden_for_run_reason:%',v_reason using errcode='42501'; end if;

  if v_role.role_kind='IMPLEMENTER' and p_result_code<>'FAILED' then
    if v_run.claim_id is null then raise exception 'active_claim_required_for_implementer_completion' using errcode='55000'; end if;
    select * into v_claim from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 where claim_id=v_run.claim_id for update;
    if not found or v_claim.state<>'ACTIVE' or v_claim.expires_at<=clock_timestamp() or v_claim.holder_id is distinct from 'aop1:'||v_run.role_key or v_claim.milestone_key is distinct from v_run.milestone_key then raise exception 'active_claim_required_for_implementer_completion' using errcode='55000'; end if;
  end if;

  if v_role.role_kind='IMPLEMENTER' and p_result_code='EVIDENCE_READY' then
    if jsonb_typeof(v_output->'summary') is distinct from 'object' or jsonb_typeof(v_output->'evidence') is distinct from 'object' or jsonb_typeof(v_output->'research') is distinct from 'object' then raise exception 'evidence_ready_requires_summary_evidence_research_objects' using errcode='22023'; end if;
    v_finish:=destruktion_meta.compute_fabric_finish_roadmap_claim_h205f22(v_claim.claim_id,v_claim.claim_token,v_output->'summary',v_output->'evidence',v_output->'research');
  end if;

  v_sha:=encode(extensions.digest(convert_to(v_output::text,'UTF8'),'sha256'),'hex');
  if p_result_code='WAITING_EVENT' or (v_role.role_kind='SUPERVISOR' and p_result_code='WAIT') then v_terminal_state:='WAITING_EVENT'; end if;
  if (v_role.role_kind='IMPLEMENTER' and p_result_code='FAILED') or (v_role.role_kind='SUPERVISOR' and p_result_code='REJECT') then v_terminal_state:='FAILED'; end if;
  update destruktion_meta.compute_fabric_aop_run_h205f22 set state=v_terminal_state,output=v_output,output_sha256=v_sha,result_code=p_result_code,expected_github_sha=coalesce(p_github_sha,expected_github_sha),wake_condition=case when v_terminal_state='WAITING_EVENT' then coalesce(p_wake_condition,wake_condition,'EXTERNAL_CHANGE') else wake_condition end,lease_owner=null,lease_expires_at=null,finished_at=case when v_terminal_state in ('COMPLETED','FAILED') then clock_timestamp() else null end,updated_at=clock_timestamp() where run_id=p_run_id;
  v_event:=destruktion_meta.compute_fabric_aop_emit_event_h205f22('RUN_RESULT_'||p_result_code,v_run.milestone_key,p_run_id,v_run.role_key,v_role.role_kind,v_output||case when v_finish is null then '{}'::jsonb else jsonb_build_object('authoritative_finish',v_finish) end,v_run.idempotency_key||':result:'||p_lease_generation::text||':'||p_result_code,p_github_sha);
  v_event_id:=(v_event->>'event_id')::bigint;
  if v_terminal_state='COMPLETED' then
    if v_role.role_kind='IMPLEMENTER' and p_result_code='CONTINUE' then
      v_next:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22(v_run.role_key,v_run.milestone_key,v_event_id,p_run_id,jsonb_build_object('reason','CONTINUE','previous_output_sha256',v_sha),'chain:continue:'||p_run_id::text||':'||p_lease_generation::text,p_github_sha);
    elsif v_role.role_kind='IMPLEMENTER' and p_result_code='EVIDENCE_READY' then
      v_next:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22('INTEGRATION_ANALYST',v_run.milestone_key,v_event_id,p_run_id,jsonb_build_object('reason','IMPLEMENTER_EVIDENCE_READY','evidence',v_output,'authoritative_finish',v_finish,'github_sha',p_github_sha),'chain:analyst:'||p_run_id::text||':'||p_lease_generation::text,p_github_sha);
    elsif v_role.role_kind='ANALYST' then
      v_next:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22('MAINLINE_SUPERVISOR',v_run.milestone_key,v_event_id,p_run_id,jsonb_build_object('reason','ANALYST_'||p_result_code,'analyst_verdict',v_output,'verdict_code',p_result_code,'github_sha',p_github_sha),'chain:supervisor:'||p_run_id::text||':'||p_lease_generation::text,p_github_sha);
    elsif v_role.role_kind='SUPERVISOR' and p_result_code='RETURN' then
      select role_key into v_impl_role from destruktion_meta.compute_fabric_aop_role_h205f22 where role_kind='IMPLEMENTER' and milestone_key=v_run.milestone_key and enabled=true;
      select x->>'effective_status' into v_authoritative_status from jsonb_array_elements(destruktion_meta.compute_fabric_roadmap_status_h205f22()->'milestones') x where x->>'milestone_key'=v_run.milestone_key;
      if v_authoritative_status<>'IN_PROGRESS' then raise exception 'supervisor_return_requires_authority_bridge_first: current_status=%',v_authoritative_status using errcode='55000'; end if;
      if v_impl_role is null then raise exception 'no_implementer_for_milestone' using errcode='55000'; end if;
      v_next:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22(v_impl_role,v_run.milestone_key,v_event_id,p_run_id,jsonb_build_object('reason','SUPERVISOR_RETURN','required_changes',v_output,'github_sha',p_github_sha),'chain:supervisor-return:'||p_run_id::text||':'||p_lease_generation::text,p_github_sha);
    elsif v_role.role_kind='SUPERVISOR' and p_result_code='ACCEPT' then
      if v_reason='SUPERVISOR_ACCEPT_CONTINUE_TO_SEAL' then
        perform destruktion_meta.compute_fabric_aop_emit_event_h205f22('MAINLINE_SEAL_READY',v_run.milestone_key,p_run_id,v_run.role_key,'SUPERVISOR',jsonb_build_object('github_sha',coalesce(p_github_sha,v_run.expected_github_sha),'output_sha256',v_sha,'seal_executor_required',true),v_run.idempotency_key||':mainline-seal-ready:'||p_lease_generation::text,coalesce(p_github_sha,v_run.expected_github_sha));
        v_next:=null;
      else
        v_next:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22('MAINLINE_SUPERVISOR',v_run.milestone_key,v_event_id,p_run_id,jsonb_build_object('reason','SUPERVISOR_ACCEPT_CONTINUE_TO_SEAL','previous_output_sha256',v_sha,'github_sha',p_github_sha),'chain:supervisor-seal:'||p_run_id::text||':'||p_lease_generation::text,p_github_sha);
      end if;
    elsif v_role.role_kind='SUPERVISOR' and p_result_code='VERIFIED' then
      select x->>'effective_status' into v_authoritative_status from jsonb_array_elements(destruktion_meta.compute_fabric_roadmap_status_h205f22()->'milestones') x where x->>'milestone_key'=v_run.milestone_key;
      if v_authoritative_status<>'VERIFIED' then raise exception 'cannot_record_verified_before_authoritative_roadmap_is_verified' using errcode='55000'; end if;
      perform destruktion_meta.compute_fabric_aop_emit_event_h205f22('MILESTONE_VERIFIED_OBSERVED',v_run.milestone_key,p_run_id,v_run.role_key,'SUPERVISOR',jsonb_build_object('authoritative_status',v_authoritative_status,'output_sha256',v_sha),v_run.idempotency_key||':verified-observed',p_github_sha);
      perform destruktion_meta.compute_fabric_aop_reconcile_h205f22();
    end if;
  end if;
  return jsonb_build_object('schema','metaengine.compute.aop-complete.h205f22.v4','run_id',p_run_id,'state',v_terminal_state,'result_code',p_result_code,'output_sha256',v_sha,'authoritative_finish',v_finish,'next_run',v_next,'base_checkpoint_id',v_run.base_checkpoint_id,'semantic_head',v_head,'canonical',false,'authority_effect',false);
end $$;

revoke all on function public.h205f22_aop1_complete_run_v1(uuid,text,bigint,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.h205f22_aop1_complete_run_v1(uuid,text,bigint,text,jsonb,text,text) to postgres,service_role;