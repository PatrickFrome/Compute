-- METAENGINE H205F22 SAME_POINT_DUEL_V4
-- Two simultaneous waves over one semantic point: PROPOSE || PROPOSE, then REBUT || REBUT.
-- The second pair commit and deterministic arbitration happen in one transaction.

create table if not exists destruktion_meta.compute_fabric_duel_decision_h205f22 (
  decision_id uuid primary key default gen_random_uuid(),
  duel_id uuid not null unique references destruktion_meta.compute_fabric_duel_session_h205f22(duel_id) on delete restrict,
  semantic_checkpoint_id text not null,
  semantic_payload_root_sha256 text not null check (semantic_payload_root_sha256 ~ '^[0-9a-f]{64}$'),
  base_github_sha text not null check (base_github_sha ~ '^[0-9a-f]{40}$'),
  propose_tick bigint not null default 1 check (propose_tick=1),
  rebut_tick bigint not null default 2 check (rebut_tick=2),
  gpt_propose_event_sha256 text not null check (gpt_propose_event_sha256 ~ '^[0-9a-f]{64}$'),
  glm_propose_event_sha256 text not null check (glm_propose_event_sha256 ~ '^[0-9a-f]{64}$'),
  gpt_rebut_event_sha256 text not null check (gpt_rebut_event_sha256 ~ '^[0-9a-f]{64}$'),
  glm_rebut_event_sha256 text not null check (glm_rebut_event_sha256 ~ '^[0-9a-f]{64}$'),
  propose_checkpoint_sha256 text not null check (propose_checkpoint_sha256 ~ '^[0-9a-f]{64}$'),
  rebut_checkpoint_sha256 text not null check (rebut_checkpoint_sha256 ~ '^[0-9a-f]{64}$'),
  outcome text not null check (outcome in ('WIN_GPT','WIN_GLM','SYNTHESIS','NO_ACTION','CANARY_REQUIRED','BLOCKED_EXECUTOR')),
  resulting_action jsonb not null check (jsonb_typeof(resulting_action)='object'),
  arbitration jsonb not null check (jsonb_typeof(arbitration)='object'),
  decision_sha256 text not null unique check (decision_sha256 ~ '^[0-9a-f]{64}$'),
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  created_at timestamptz not null default clock_timestamp()
);

create or replace function destruktion_meta.compute_fabric_duel_decision_immutable_h205f22()
returns trigger
language plpgsql
set search_path='pg_catalog'
as $$
begin
  raise exception 'duel_decision_immutable';
end
$$;

drop trigger if exists compute_fabric_duel_decision_immutable_h205f22 on destruktion_meta.compute_fabric_duel_decision_h205f22;
create trigger compute_fabric_duel_decision_immutable_h205f22
before update or delete on destruktion_meta.compute_fabric_duel_decision_h205f22
for each row execute function destruktion_meta.compute_fabric_duel_decision_immutable_h205f22();

revoke all on table destruktion_meta.compute_fabric_duel_decision_h205f22 from public,anon,authenticated,service_role;

create or replace function public.h205f22_duel_create_same_point_v4(
  p_duel_key text,
  p_milestone_key text,
  p_base_github_sha text,
  p_subject jsonb default '{}'::jsonb,
  p_execution_policy text default 'SOVEREIGN_ONLY',
  p_gpt_model text default 'openai/gpt-oss-20b',
  p_glm_model text default 'zai-org/GLM-4.7-Flash'
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','destruktion_meta','extensions'
as $$
declare s jsonb; r jsonb;
begin
  if p_execution_policy not in ('SOVEREIGN_ONLY','HOSTED_ONLY','ANY') then raise exception 'invalid_execution_policy'; end if;
  if jsonb_typeof(coalesce(p_subject,'{}'::jsonb)) <> 'object' then raise exception 'subject_must_be_object'; end if;
  s := coalesce(p_subject,'{}'::jsonb) || jsonb_build_object(
    'debate_protocol','SAME_POINT_DUEL_V4',
    'wave_plan',jsonb_build_array('PROPOSE','REBUT'),
    'reasoning_visibility','OBSERVABLE_ENGINEERING_REASONING_V1',
    'arbitration_policy','EVIDENCE_FIRST_ONE_ACTION_V1',
    'execution_policy',p_execution_policy,
    'managed_inference_required',false
  );
  r := public.h205f22_duel_create_lockstep_v2(p_duel_key,p_milestone_key,p_base_github_sha,s,p_gpt_model,p_glm_model,2);
  return r || jsonb_build_object(
    'debate_protocol','SAME_POINT_DUEL_V4',
    'wave_plan',jsonb_build_array('PROPOSE','REBUT'),
    'reasoning_visibility','OBSERVABLE_ENGINEERING_REASONING_V1',
    'arbitration_policy','EVIDENCE_FIRST_ONE_ACTION_V1',
    'execution_policy',p_execution_policy,
    'max_ticks',2,'canonical',false,'authority_effect',false
  );
end
$$;

create or replace function public.h205f22_duel_finalize_same_point_v4(
  p_duel_id uuid,
  p_worker text,
  p_lease_generation bigint
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','destruktion_meta','extensions'
as $$
declare
  d destruktion_meta.compute_fabric_duel_session_h205f22%rowtype;
  existing destruktion_meta.compute_fabric_duel_decision_h205f22%rowtype;
  t1 destruktion_meta.compute_fabric_duel_tick_h205f22%rowtype;
  t2 destruktion_meta.compute_fabric_duel_tick_h205f22%rowtype;
  gp jsonb; lp jsonb; gr jsonb; lr jsonb;
  gp_sha text; lp_sha text; gr_sha text; lr_sha text;
  g_action jsonb; l_action jsonb; action jsonb;
  g_action_sha text; l_action_sha text;
  g_vote text; l_vote text;
  tests jsonb := '[]'::jsonb;
  outcome text; reason text; arbitration jsonb; decision_sha text; decision_obj jsonb; terminal_status text; completion jsonb;
begin
  select * into existing from destruktion_meta.compute_fabric_duel_decision_h205f22 where duel_id=p_duel_id;
  if found then
    return jsonb_build_object('schema','metaengine.compute.same-point-decision.h205f22.v4','decision_id',existing.decision_id,'duel_id',existing.duel_id,'outcome',existing.outcome,'resulting_action',existing.resulting_action,'arbitration',existing.arbitration,'decision_sha256',existing.decision_sha256,'final_checkpoint_sha256',existing.rebut_checkpoint_sha256,'replayed',true,'canonical',false,'authority_effect',false);
  end if;

  select * into d from destruktion_meta.compute_fabric_duel_session_h205f22 where duel_id=p_duel_id for update;
  if not found or d.protocol_version<>'LOCKSTEP_V2' or d.status<>'RUNNING' or d.lease_owner<>p_worker or d.lease_generation<>p_lease_generation or d.lease_expires_at<=clock_timestamp() then raise exception 'v4_duel_lease_fenced'; end if;
  if coalesce(d.subject->>'debate_protocol','') <> 'SAME_POINT_DUEL_V4' then raise exception 'v4_protocol_subject_required'; end if;
  if d.max_ticks<>2 or d.current_tick<>2 then raise exception 'v4_two_wave_state_required'; end if;

  select * into t1 from destruktion_meta.compute_fabric_duel_tick_h205f22 where duel_id=p_duel_id and tick_no=1;
  select * into t2 from destruktion_meta.compute_fabric_duel_tick_h205f22 where duel_id=p_duel_id and tick_no=2;
  if t1.duel_id is null or t2.duel_id is null then raise exception 'v4_wave_tick_missing'; end if;
  if t2.input_checkpoint_sha256 is distinct from t1.output_checkpoint_sha256 then raise exception 'v4_wave_checkpoint_chain_broken'; end if;
  if d.current_checkpoint_sha256 is distinct from t2.output_checkpoint_sha256 then raise exception 'v4_final_checkpoint_mismatch'; end if;

  select payload,event_sha256 into gp,gp_sha from destruktion_meta.compute_fabric_duel_event_h205f22 where duel_id=p_duel_id and tick_no=1 and actor='GPT';
  select payload,event_sha256 into lp,lp_sha from destruktion_meta.compute_fabric_duel_event_h205f22 where duel_id=p_duel_id and tick_no=1 and actor='GLM';
  select payload,event_sha256 into gr,gr_sha from destruktion_meta.compute_fabric_duel_event_h205f22 where duel_id=p_duel_id and tick_no=2 and actor='GPT';
  select payload,event_sha256 into lr,lr_sha from destruktion_meta.compute_fabric_duel_event_h205f22 where duel_id=p_duel_id and tick_no=2 and actor='GLM';

  if gp is null or lp is null or gr is null or lr is null then raise exception 'v4_wave_event_missing'; end if;
  if gp->>'phase'<>'PROPOSE' or lp->>'phase'<>'PROPOSE' or gr->>'phase'<>'REBUT' or lr->>'phase'<>'REBUT' then raise exception 'v4_wave_phase_mismatch'; end if;
  if gr->>'peer_event_hash_addressed' is distinct from lp_sha or lr->>'peer_event_hash_addressed' is distinct from gp_sha then raise exception 'v4_rebut_peer_hash_ack_failed'; end if;
  if jsonb_typeof(gp->'reasoning_summary')<>'array' or jsonb_typeof(lp->'reasoning_summary')<>'array' or jsonb_typeof(gr->'reasoning_summary')<>'array' or jsonb_typeof(lr->'reasoning_summary')<>'array' then raise exception 'v4_public_reasoning_required'; end if;
  if nullif(trim(coalesce(gp->>'claim','')),'') is null or nullif(trim(coalesce(lp->>'claim','')),'') is null or nullif(trim(coalesce(gr->>'claim','')),'') is null or nullif(trim(coalesce(lr->>'claim','')),'') is null then raise exception 'v4_claim_required'; end if;

  g_action := gr->'resulting_action'; l_action := lr->'resulting_action';
  if jsonb_typeof(g_action)<>'object' or jsonb_typeof(l_action)<>'object' or not (g_action ? 'kind') or not (l_action ? 'kind') then raise exception 'v4_rebut_resulting_action_required'; end if;
  g_action_sha := encode(extensions.digest(convert_to(g_action::text,'utf8'),'sha256'),'hex');
  l_action_sha := encode(extensions.digest(convert_to(l_action::text,'utf8'),'sha256'),'hex');
  g_vote := nullif(gr->>'terminal_vote',''); l_vote := nullif(lr->>'terminal_vote','');

  if jsonb_typeof(gp->'tests_required')='array' then tests := tests || (gp->'tests_required'); end if;
  if jsonb_typeof(lp->'tests_required')='array' then tests := tests || (lp->'tests_required'); end if;
  if jsonb_typeof(gr->'tests_required')='array' then tests := tests || (gr->'tests_required'); end if;
  if jsonb_typeof(lr->'tests_required')='array' then tests := tests || (lr->'tests_required'); end if;
  select coalesce(jsonb_agg(x),'[]'::jsonb) into tests from (select distinct value as x from jsonb_array_elements(tests)) q;

  if coalesce(gp->>'model_response','true')='false' or coalesce(lp->>'model_response','true')='false' or coalesce(gr->>'model_response','true')='false' or coalesce(lr->>'model_response','true')='false' or gp->>'step_type'='EXECUTOR_ERROR' or lp->>'step_type'='EXECUTOR_ERROR' or gr->>'step_type'='EXECUTOR_ERROR' or lr->>'step_type'='EXECUTOR_ERROR' then
    outcome := 'BLOCKED_EXECUTOR'; action := jsonb_build_object('kind','NO_ACTION','reason','BLOCKED_EXECUTOR'); reason := 'EXECUTOR_FAILURE_FAIL_CLOSED';
  elsif gp->>'step_type'='SECURITY_VETO' or lp->>'step_type'='SECURITY_VETO' or gr->>'step_type'='SECURITY_VETO' or lr->>'step_type'='SECURITY_VETO' or coalesce((gp->>'need_canary')::boolean,false) or coalesce((lp->>'need_canary')::boolean,false) or coalesce((gr->>'need_canary')::boolean,false) or coalesce((lr->>'need_canary')::boolean,false) then
    outcome := 'CANARY_REQUIRED'; action := jsonb_build_object('kind','RUN_CANARY','tests',tests,'reason','VETO_OR_CANARY_REQUEST'); reason := 'EVIDENCE_REQUIRED_BEFORE_MUTATION';
  elsif g_action_sha=l_action_sha then
    outcome := 'SYNTHESIS'; action := g_action; reason := 'INDEPENDENT_REBUTTALS_CONVERGED_ON_IDENTICAL_ACTION';
  elsif g_vote='WIN_GPT' and l_vote='WIN_GPT' then
    outcome := 'WIN_GPT'; action := g_action; reason := 'BOTH_REBUTTALS_SELECT_GPT_FINAL_ACTION';
  elsif g_vote='WIN_GLM' and l_vote='WIN_GLM' then
    outcome := 'WIN_GLM'; action := l_action; reason := 'BOTH_REBUTTALS_SELECT_GLM_FINAL_ACTION';
  elsif g_vote='NO_ACTION' and l_vote='NO_ACTION' then
    outcome := 'NO_ACTION'; action := jsonb_build_object('kind','NO_ACTION','reason','BOTH_REBUTTALS_REJECT_MUTATION'); reason := 'BOTH_REBUTTALS_REJECT_MUTATION';
  else
    outcome := 'CANARY_REQUIRED'; action := jsonb_build_object('kind','RUN_CANARY','tests',tests,'reason','UNRESOLVED_ACTION_DISAGREEMENT','gpt_candidate_sha256',g_action_sha,'glm_candidate_sha256',l_action_sha); reason := 'DISAGREEMENT_REQUIRES_FALSIFICATION';
  end if;

  arbitration := jsonb_build_object('policy','EVIDENCE_FIRST_ONE_ACTION_V1','reason',reason,'gpt_vote',g_vote,'glm_vote',l_vote,'gpt_action_sha256',g_action_sha,'glm_action_sha256',l_action_sha,'tests_required',tests,'propose_pair',jsonb_build_object('gpt_event_sha256',gp_sha,'glm_event_sha256',lp_sha),'rebut_pair',jsonb_build_object('gpt_event_sha256',gr_sha,'glm_event_sha256',lr_sha));

  decision_sha := encode(extensions.digest(convert_to(concat_ws('|','SAME_POINT_DECISION_V4',p_duel_id::text,d.semantic_checkpoint_id,d.semantic_payload_root_sha256,d.base_github_sha,gp_sha,lp_sha,gr_sha,lr_sha,outcome,action::text,arbitration::text),'utf8'),'sha256'),'hex');

  insert into destruktion_meta.compute_fabric_duel_decision_h205f22(duel_id,semantic_checkpoint_id,semantic_payload_root_sha256,base_github_sha,gpt_propose_event_sha256,glm_propose_event_sha256,gpt_rebut_event_sha256,glm_rebut_event_sha256,propose_checkpoint_sha256,rebut_checkpoint_sha256,outcome,resulting_action,arbitration,decision_sha256)
  values (p_duel_id,d.semantic_checkpoint_id,d.semantic_payload_root_sha256,d.base_github_sha,gp_sha,lp_sha,gr_sha,lr_sha,t1.output_checkpoint_sha256,t2.output_checkpoint_sha256,outcome,action,arbitration,decision_sha)
  returning * into existing;

  decision_obj := jsonb_build_object('schema','metaengine.compute.same-point-decision.h205f22.v4','decision_id',existing.decision_id,'duel_id',p_duel_id,'semantic_checkpoint_id',d.semantic_checkpoint_id,'semantic_payload_root_sha256',d.semantic_payload_root_sha256,'base_github_sha',d.base_github_sha,'outcome',outcome,'resulting_action',action,'arbitration',arbitration,'decision_sha256',decision_sha,'final_tick',2,'final_checkpoint_sha256',d.current_checkpoint_sha256,'canonical',false,'authority_effect',false);
  terminal_status := case when outcome='BLOCKED_EXECUTOR' then 'BLOCKED' when outcome='CANARY_REQUIRED' then 'CANARY_REQUIRED' else 'RESOLVED' end;
  completion := public.h205f22_duel_complete_lockstep_v2(p_duel_id,p_worker,p_lease_generation,terminal_status,decision_obj);
  return decision_obj || jsonb_build_object('completion',completion,'replayed',false);
end
$$;

create or replace function public.h205f22_duel_submit_rebut_finalize_v4(
  p_duel_id uuid,p_worker text,p_lease_generation bigint,p_seen_checkpoint_sha256 text,
  p_gpt_step_type text,p_gpt_payload jsonb,p_glm_step_type text,p_glm_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','destruktion_meta','extensions'
as $$
declare existing destruktion_meta.compute_fabric_duel_decision_h205f22%rowtype; pair jsonb; decision jsonb; readback jsonb;
begin
  select * into existing from destruktion_meta.compute_fabric_duel_decision_h205f22 where duel_id=p_duel_id;
  if found then
    readback := public.h205f22_duel_read_lockstep_v2(p_duel_id,0);
    return jsonb_build_object('schema','metaengine.compute.same-point-rebut-finalize.h205f22.v4','replayed',true,'decision',jsonb_build_object('decision_id',existing.decision_id,'outcome',existing.outcome,'resulting_action',existing.resulting_action,'arbitration',existing.arbitration,'decision_sha256',existing.decision_sha256,'final_checkpoint_sha256',existing.rebut_checkpoint_sha256,'canonical',false,'authority_effect',false),'readback',readback,'canonical',false,'authority_effect',false);
  end if;
  pair := public.h205f22_duel_submit_pair_v3(p_duel_id,p_worker,p_lease_generation,2,p_seen_checkpoint_sha256,p_gpt_step_type,p_gpt_payload,p_glm_step_type,p_glm_payload);
  decision := public.h205f22_duel_finalize_same_point_v4(p_duel_id,p_worker,p_lease_generation);
  return jsonb_build_object('schema','metaengine.compute.same-point-rebut-finalize.h205f22.v4','replayed',false,'pair',pair,'decision',decision,'canonical',false,'authority_effect',false);
end
$$;

create or replace function public.h205f22_duel_read_same_point_v4(p_duel_id uuid) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','destruktion_meta','extensions'
as $$
declare r jsonb; d destruktion_meta.compute_fabric_duel_session_h205f22%rowtype; x destruktion_meta.compute_fabric_duel_decision_h205f22%rowtype; decision jsonb := null;
begin
  select * into d from destruktion_meta.compute_fabric_duel_session_h205f22 where duel_id=p_duel_id;
  if not found then raise exception 'duel_not_found'; end if;
  if coalesce(d.subject->>'debate_protocol','') <> 'SAME_POINT_DUEL_V4' then raise exception 'not_same_point_v4'; end if;
  r := public.h205f22_duel_read_lockstep_v2(p_duel_id,0);
  select * into x from destruktion_meta.compute_fabric_duel_decision_h205f22 where duel_id=p_duel_id;
  if found then decision := jsonb_build_object('decision_id',x.decision_id,'outcome',x.outcome,'resulting_action',x.resulting_action,'arbitration',x.arbitration,'decision_sha256',x.decision_sha256,'created_at',x.created_at,'canonical',false,'authority_effect',false); end if;
  return jsonb_build_object('schema','metaengine.compute.same-point-readback.h205f22.v4','debate_protocol','SAME_POINT_DUEL_V4','reasoning_visibility','OBSERVABLE_ENGINEERING_REASONING_V1','wave_plan',jsonb_build_array('PROPOSE','REBUT'),'ledger',r,'decision',decision,'canonical',false,'authority_effect',false);
end
$$;

revoke all on function public.h205f22_duel_create_same_point_v4(text,text,text,jsonb,text,text,text) from public,anon,authenticated;
revoke all on function public.h205f22_duel_finalize_same_point_v4(uuid,text,bigint) from public,anon,authenticated;
revoke all on function public.h205f22_duel_submit_rebut_finalize_v4(uuid,text,bigint,text,text,jsonb,text,jsonb) from public,anon,authenticated;
revoke all on function public.h205f22_duel_read_same_point_v4(uuid) from public,anon,authenticated;
grant execute on function public.h205f22_duel_create_same_point_v4(text,text,text,jsonb,text,text,text) to service_role;
grant execute on function public.h205f22_duel_finalize_same_point_v4(uuid,text,bigint) to service_role;
grant execute on function public.h205f22_duel_submit_rebut_finalize_v4(uuid,text,bigint,text,text,jsonb,text,jsonb) to service_role;
grant execute on function public.h205f22_duel_read_same_point_v4(uuid) to service_role;
