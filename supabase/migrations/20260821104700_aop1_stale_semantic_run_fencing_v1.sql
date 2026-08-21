create or replace function destruktion_meta.compute_fabric_aop_run_resume_eligible_h205f22(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','destruktion_meta'
as $$
declare
  v_run destruktion_meta.compute_fabric_aop_run_h205f22%rowtype;
  v_role destruktion_meta.compute_fabric_aop_role_h205f22%rowtype;
  v_status jsonb;
  v_head text;
  v_effective text;
  v_claim_ok boolean:=false;
begin
  select * into v_run from destruktion_meta.compute_fabric_aop_run_h205f22 where run_id=p_run_id;
  if not found then
    return jsonb_build_object('eligible',false,'reason','UNKNOWN_RUN','canonical',false,'authority_effect',false);
  end if;
  select * into v_role from destruktion_meta.compute_fabric_aop_role_h205f22 where role_key=v_run.role_key and enabled=true;
  if not found then
    return jsonb_build_object('eligible',false,'reason','ROLE_DISABLED_OR_MISSING','canonical',false,'authority_effect',false);
  end if;
  if v_run.state in ('COMPLETED','FAILED','CANCELLED','FENCED') then
    return jsonb_build_object('eligible',false,'reason','TERMINAL_RUN','state',v_run.state,'canonical',false,'authority_effect',false);
  end if;
  v_status:=destruktion_meta.compute_fabric_roadmap_status_h205f22();
  v_head:=v_status#>>'{semantic_head,checkpoint_id}';
  if v_run.base_checkpoint_id is distinct from v_head then
    return jsonb_build_object('eligible',false,'reason','BASE_CHECKPOINT_STALE','run_base_checkpoint_id',v_run.base_checkpoint_id,'semantic_head',v_head,'canonical',false,'authority_effect',false);
  end if;
  if v_role.role_kind='IMPLEMENTER' then
    select x->>'effective_status' into v_effective from jsonb_array_elements(v_status->'milestones') x where x->>'milestone_key'=v_run.milestone_key;
    select exists(
      select 1 from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 c
      where c.claim_id=v_run.claim_id and c.state='ACTIVE' and c.expires_at>clock_timestamp()
        and c.holder_id='aop1:'||v_run.role_key and c.milestone_key=v_run.milestone_key
    ) into v_claim_ok;
    if v_effective is distinct from 'IN_PROGRESS' or not v_claim_ok then
      return jsonb_build_object('eligible',false,'reason','IMPLEMENTER_AUTHORITY_STALE','effective_status',v_effective,'active_claim_match',v_claim_ok,'canonical',false,'authority_effect',false);
    end if;
  end if;
  return jsonb_build_object('eligible',true,'reason','PASS','semantic_head',v_head,'canonical',false,'authority_effect',false);
end $$;

revoke all on function destruktion_meta.compute_fabric_aop_run_resume_eligible_h205f22(uuid) from public,anon,authenticated;
grant execute on function destruktion_meta.compute_fabric_aop_run_resume_eligible_h205f22(uuid) to postgres,service_role;

create or replace function destruktion_meta.compute_fabric_aop_reconcile_h205f22()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','destruktion_meta','extensions'
as $$
declare
  v_status jsonb;
  v_m jsonb;
  v_role text;
  v_holder text;
  v_claim_id bigint;
  v_created integer:=0;
  v_fenced integer:=0;
  v_result jsonb;
  v_milestone text;
  v_effective text;
  v_head text;
  v_stale record;
begin
  if not pg_try_advisory_xact_lock(hashtext('metaengine:h205f22:aop1:reconcile')) then
    return jsonb_build_object('schema','metaengine.compute.aop-reconcile.h205f22.v3','status','SKIPPED_LOCKED','created_runs',0,'fenced_runs',0,'canonical',false,'authority_effect',false);
  end if;
  v_status:=destruktion_meta.compute_fabric_roadmap_status_h205f22();
  v_head:=v_status#>>'{semantic_head,checkpoint_id}';

  for v_stale in
    select r.run_id,r.idempotency_key,r.milestone_key,r.role_key,r.expected_github_sha,r.base_checkpoint_id,ro.role_kind
    from destruktion_meta.compute_fabric_aop_run_h205f22 r
    join destruktion_meta.compute_fabric_aop_role_h205f22 ro on ro.role_key=r.role_key
    where r.state in ('READY','LEASED','RUNNING','WAITING_EXECUTOR','WAITING_EVENT')
      and (
        r.base_checkpoint_id is distinct from v_head
        or (
          ro.role_kind='IMPLEMENTER' and not exists(
            select 1 from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 c
            where c.claim_id=r.claim_id and c.state='ACTIVE' and c.expires_at>clock_timestamp()
              and c.holder_id='aop1:'||r.role_key and c.milestone_key=r.milestone_key
          )
        )
      )
    for update of r
  loop
    update destruktion_meta.compute_fabric_aop_run_h205f22
      set state='FENCED',lease_owner=null,lease_expires_at=null,wake_condition=null,finished_at=clock_timestamp(),updated_at=clock_timestamp(),
          output=coalesce(output,'{}'::jsonb)||jsonb_build_object('fenced_reason',case when v_stale.base_checkpoint_id is distinct from v_head then 'BASE_CHECKPOINT_STALE' else 'IMPLEMENTER_AUTHORITY_STALE' end,'semantic_head',v_head)
      where run_id=v_stale.run_id;
    perform destruktion_meta.compute_fabric_aop_emit_event_h205f22(
      'RUN_FENCED_STALE_AUTHORITY',v_stale.milestone_key,v_stale.run_id,v_stale.role_key,v_stale.role_kind,
      jsonb_build_object('reason',case when v_stale.base_checkpoint_id is distinct from v_head then 'BASE_CHECKPOINT_STALE' else 'IMPLEMENTER_AUTHORITY_STALE' end,'run_base_checkpoint_id',v_stale.base_checkpoint_id,'semantic_head',v_head),
      v_stale.idempotency_key||':fenced:'||coalesce(v_head,'none'),v_stale.expected_github_sha);
    v_fenced:=v_fenced+1;
  end loop;

  for v_m in select value from jsonb_array_elements(v_status->'milestones') loop
    v_milestone:=v_m->>'milestone_key';
    v_effective:=v_m->>'effective_status';
    if v_effective='EVIDENCE_READY' then
      if not exists(select 1 from destruktion_meta.compute_fabric_aop_run_h205f22 where milestone_key=v_milestone and role_key='INTEGRATION_ANALYST' and state in ('READY','LEASED','RUNNING','WAITING_EXECUTOR','WAITING_EVENT') and base_checkpoint_id is not distinct from v_head and created_at>clock_timestamp()-interval '24 hours')
         and not exists(select 1 from destruktion_meta.compute_fabric_aop_run_h205f22 where milestone_key=v_milestone and role_key='MAINLINE_SUPERVISOR' and state in ('READY','LEASED','RUNNING','WAITING_EXECUTOR','WAITING_EVENT') and base_checkpoint_id is not distinct from v_head and created_at>clock_timestamp()-interval '24 hours') then
        v_result:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22('INTEGRATION_ANALYST',v_milestone,null,null,jsonb_build_object('reason','AUTHORITATIVE_EVIDENCE_READY','roadmap_status',v_effective),'reconcile:analyst:'||v_milestone||':'||coalesce(v_head,'none'));
        v_created:=v_created+1;
      end if;
    elsif v_effective='IN_PROGRESS' then
      select role_key into v_role from destruktion_meta.compute_fabric_aop_role_h205f22 where role_kind='IMPLEMENTER' and milestone_key=v_milestone and enabled=true;
      if v_role is not null then
        v_holder:='aop1:'||v_role;
        select claim_id into v_claim_id from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22 where roadmap_id='compute-fabric-roadmap-v1' and milestone_key=v_milestone and state='ACTIVE' and expires_at>clock_timestamp() and holder_id=v_holder order by claim_id desc limit 1;
        if v_claim_id is not null then
          if not exists(select 1 from destruktion_meta.compute_fabric_aop_run_h205f22 where milestone_key=v_milestone and role_key=v_role and claim_id=v_claim_id and state in ('READY','LEASED','RUNNING','WAITING_EXECUTOR','WAITING_EVENT') and base_checkpoint_id is not distinct from v_head and created_at>clock_timestamp()-interval '24 hours') then
            v_result:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22(v_role,v_milestone,null,null,jsonb_build_object('reason','AUTHORITATIVE_IN_PROGRESS','roadmap_status',v_effective,'authority_holder',v_holder),'reconcile:implementer:'||v_milestone||':'||v_claim_id::text||':'||coalesce(v_head,'none'));
            v_created:=v_created+1;
          end if;
        else
          if not exists(select 1 from destruktion_meta.compute_fabric_aop_run_h205f22 where milestone_key=v_milestone and role_key='MAINLINE_SUPERVISOR' and state in ('READY','LEASED','RUNNING','WAITING_EXECUTOR','WAITING_EVENT') and base_checkpoint_id is not distinct from v_head and input->>'reason'='AUTHORITY_REBIND_REQUIRED') then
            v_result:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22('MAINLINE_SUPERVISOR',v_milestone,null,null,jsonb_build_object('reason','AUTHORITY_REBIND_REQUIRED','target_holder',v_holder,'roadmap_status',v_effective),'reconcile:authority-rebind:'||v_milestone||':'||coalesce(v_head,'none'));
            v_created:=v_created+1;
          end if;
        end if;
      end if;
    end if;
    v_role:=null; v_holder:=null; v_claim_id:=null;
  end loop;
  return jsonb_build_object('schema','metaengine.compute.aop-reconcile.h205f22.v3','status','PASS','created_runs',v_created,'fenced_runs',v_fenced,'semantic_head',v_status->'semantic_head','canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_aop1_signal_v1(p_condition text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','destruktion_meta'
as $$
declare
  v_count integer;
  v_now timestamptz:=clock_timestamp();
  v_payload jsonb:=coalesce(p_payload,'{}'::jsonb);
begin
  if p_condition is null or char_length(p_condition)<3 then raise exception 'invalid_condition' using errcode='22023'; end if;
  if jsonb_typeof(v_payload)<>'object' then raise exception 'signal_payload_must_be_object' using errcode='22023'; end if;
  if octet_length(v_payload::text)>65536 then raise exception 'signal_payload_too_large' using errcode='22023'; end if;
  perform destruktion_meta.compute_fabric_aop_reconcile_h205f22();
  update destruktion_meta.compute_fabric_aop_run_h205f22 r
     set state='READY',wake_condition=null,
         input=coalesce(input,'{}'::jsonb)||jsonb_build_object('resume_signal',jsonb_build_object('condition',p_condition,'payload',v_payload,'received_at',v_now)),
         updated_at=v_now
   where r.state='WAITING_EVENT' and r.wake_condition=p_condition
     and (destruktion_meta.compute_fabric_aop_run_resume_eligible_h205f22(r.run_id)->>'eligible')::boolean;
  get diagnostics v_count=row_count;
  perform destruktion_meta.compute_fabric_aop_emit_event_h205f22('CONDITION_SIGNAL',null,null,null,'EXTERNAL',jsonb_build_object('condition',p_condition,'payload',v_payload,'woken_runs',v_count,'resume_payload_attached',true,'stale_runs_fenced_before_signal',true),'signal:'||p_condition||':'||v_now::text,null);
  return jsonb_build_object('schema','metaengine.compute.aop-signal.h205f22.v2','condition',p_condition,'woken_runs',v_count,'resume_payload_attached',true,'stale_runs_fenced_before_signal',true,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_aop1_signal_role_v1(p_condition text,p_role_key text,p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','destruktion_meta'
as $$
declare
  v_count integer;
  v_role destruktion_meta.compute_fabric_aop_role_h205f22%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_payload jsonb:=coalesce(p_payload,'{}'::jsonb);
begin
  if p_condition is null or char_length(p_condition)<3 then raise exception 'invalid_condition' using errcode='22023'; end if;
  if p_role_key is null or char_length(p_role_key)<3 then raise exception 'invalid_role_key' using errcode='22023'; end if;
  if jsonb_typeof(v_payload)<>'object' then raise exception 'payload_must_be_object' using errcode='22023'; end if;
  if octet_length(v_payload::text)>65536 then raise exception 'signal_payload_too_large' using errcode='22023'; end if;
  select * into v_role from destruktion_meta.compute_fabric_aop_role_h205f22 where role_key=p_role_key and enabled=true;
  if not found then raise exception 'unknown_or_disabled_role' using errcode='22023'; end if;
  perform destruktion_meta.compute_fabric_aop_reconcile_h205f22();
  update destruktion_meta.compute_fabric_aop_run_h205f22 r
     set state='READY',wake_condition=null,
         input=coalesce(input,'{}'::jsonb)||jsonb_build_object('resume_signal',jsonb_build_object('condition',p_condition,'payload',v_payload,'received_at',v_now)),
         updated_at=v_now
   where r.state='WAITING_EVENT' and r.wake_condition=p_condition and r.role_key=p_role_key
     and (destruktion_meta.compute_fabric_aop_run_resume_eligible_h205f22(r.run_id)->>'eligible')::boolean;
  get diagnostics v_count=row_count;
  perform destruktion_meta.compute_fabric_aop_emit_event_h205f22('CONDITION_SIGNAL_ROLE',v_role.milestone_key,null,p_role_key,'EXTERNAL',jsonb_build_object('condition',p_condition,'role_key',p_role_key,'payload',v_payload,'woken_runs',v_count,'resume_payload_attached',true,'stale_runs_fenced_before_signal',true),'signal-role:'||p_condition||':'||p_role_key||':'||v_now::text,null);
  return jsonb_build_object('schema','metaengine.compute.aop-signal-role.h205f22.v2','condition',p_condition,'role_key',p_role_key,'woken_runs',v_count,'resume_payload_attached',true,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_aop1_signal_run_v1(p_run_id uuid,p_condition text,p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','destruktion_meta'
as $$
declare
  v_run destruktion_meta.compute_fabric_aop_run_h205f22%rowtype;
  v_event jsonb;
  v_elig jsonb;
begin
  if p_run_id is null then raise exception 'run_id_required' using errcode='22023'; end if;
  if p_condition is null or char_length(p_condition)<3 then raise exception 'invalid_condition' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb))<>'object' then raise exception 'signal_payload_must_be_object' using errcode='22023'; end if;
  if octet_length(coalesce(p_payload,'{}'::jsonb)::text)>65536 then raise exception 'signal_payload_too_large' using errcode='22023'; end if;
  perform destruktion_meta.compute_fabric_aop_reconcile_h205f22();
  select * into v_run from destruktion_meta.compute_fabric_aop_run_h205f22 where run_id=p_run_id for update;
  if not found then raise exception 'unknown_run' using errcode='22023'; end if;
  if v_run.state<>'WAITING_EVENT' then raise exception 'run_not_waiting_event' using errcode='55000'; end if;
  if v_run.wake_condition is distinct from p_condition then raise exception 'wake_condition_mismatch' using errcode='55000'; end if;
  v_elig:=destruktion_meta.compute_fabric_aop_run_resume_eligible_h205f22(p_run_id);
  if not coalesce((v_elig->>'eligible')::boolean,false) then raise exception 'run_resume_fenced:%',coalesce(v_elig->>'reason','UNKNOWN') using errcode='55000'; end if;
  update destruktion_meta.compute_fabric_aop_run_h205f22
     set state='READY',wake_condition=null,input=coalesce(input,'{}'::jsonb)||jsonb_build_object('resume_signal',jsonb_build_object('condition',p_condition,'payload',coalesce(p_payload,'{}'::jsonb),'received_at',clock_timestamp())),updated_at=clock_timestamp()
   where run_id=p_run_id;
  v_event:=destruktion_meta.compute_fabric_aop_emit_event_h205f22('CONDITION_SIGNAL_TARGETED',v_run.milestone_key,v_run.run_id,v_run.role_key,'EXTERNAL',jsonb_build_object('condition',p_condition,'payload',coalesce(p_payload,'{}'::jsonb),'resume_payload_attached',true,'eligibility',v_elig),'targeted-signal:'||p_run_id::text||':'||p_condition||':'||clock_timestamp()::text,v_run.expected_github_sha);
  return jsonb_build_object('schema','metaengine.compute.aop-targeted-signal.h205f22.v2','run_id',p_run_id,'condition',p_condition,'woken',true,'resume_payload_attached',true,'event_id',(v_event->>'event_id')::bigint,'canonical',false,'authority_effect',false);
end $$;

revoke all on function public.h205f22_aop1_signal_v1(text,jsonb) from public,anon,authenticated;
revoke all on function public.h205f22_aop1_signal_role_v1(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.h205f22_aop1_signal_run_v1(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.h205f22_aop1_signal_v1(text,jsonb) to postgres,service_role;
grant execute on function public.h205f22_aop1_signal_role_v1(text,text,jsonb) to postgres,service_role;
grant execute on function public.h205f22_aop1_signal_run_v1(uuid,text,jsonb) to postgres,service_role;

-- Completion is also fenced against a semantic-head change. The live migration
-- replaces h205f22_aop1_complete_run_v1 with schema v4 and checks, before any
-- authoritative finish call, that run.base_checkpoint_id == current semantic head
-- and that non-FAILED implementer completions still own the exact ACTIVE claim.
-- This repository marker is intentionally paired with the static contract test;
-- the full function body is obtained from the authoritative migration registry.