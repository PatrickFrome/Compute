-- Client V1 C4.4: exact Agent-origin + typed result proof readback.
--
-- This migration does two bounded things:
-- 1) repairs the fresh-project DevOS completion contract so it matches the
--    already-shipped Browser/Edge FINALISH states (BLOCKED + AMBIGUOUS);
-- 2) adds a read-only Client proof membrane joining one request UUID to its
--    exact task, TASK_TRANSPORT_PROVEN event and digest-only Result Claim.
--
-- It creates no scheduler, lease allocator, Browser effect, retry loop,
-- model/page-content authority or release authority.

alter table destruktion_meta.devos_fleet_task_h205f22
  drop constraint if exists devos_fleet_task_state_ck;

alter table destruktion_meta.devos_fleet_task_h205f22
  add constraint devos_fleet_task_state_ck
  check (state in (
    'READY','LEASED','RUNNING','RESULT_READY',
    'BLOCKED','COMPLETED','FAILED','AMBIGUOUS','FENCED'
  ));


create or replace function public.devos_fleet_complete_v1(
  p_task uuid,
  p_agent text,
  p_generation bigint,
  p_tab text,
  p_target text,
  p_epoch bigint,
  p_state text,
  p_summary jsonb,
  p_error text default null
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','destruktion_meta','extensions'
as $$
declare
  v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_now timestamptz := clock_timestamp();
  v_final text := upper(coalesce(p_state,''));
  v_summary jsonb := coalesce(p_summary,'{}'::jsonb);
  v_sha text;
  v_error text;
begin
  if v_final not in ('COMPLETED','FAILED','RESULT_READY','BLOCKED','AMBIGUOUS')
     or jsonb_typeof(v_summary) <> 'object'
  then
    raise exception 'devos_complete_invalid' using errcode='22023';
  end if;

  select * into v_task
    from destruktion_meta.devos_fleet_task_h205f22
   where task_id=p_task
   for update;

  if not found
     or v_task.state <> 'RUNNING'
     or v_task.lease_agent_id <> lower(p_agent)
     or v_task.lease_generation <> p_generation
     or v_task.lease_tab_id <> p_tab
     or v_task.lease_target_id <> lower(p_target)
     or v_task.lease_agent_generation_epoch <> p_epoch
     or v_task.lease_expires_at <= v_now
  then
    raise exception 'task_lease_fenced';
  end if;

  v_sha := encode(extensions.digest(convert_to(v_summary::text,'UTF8'),'sha256'),'hex');
  v_error := nullif(left(coalesce(p_error,''),160),'');

  update destruktion_meta.devos_fleet_task_h205f22
     set state=v_final,
         result_summary=v_summary,
         result_summary_sha256=v_sha,
         result_sha256=v_sha,
         error_code=v_error,
         finished_at=case
           when v_final in ('BLOCKED','COMPLETED','FAILED','AMBIGUOUS') then v_now
           else null
         end,
         updated_at=v_now
   where task_id=p_task;

  update destruktion_meta.devos_fleet_claim_h205f22
     set state='CLOSED',updated_at=v_now
   where task_id=p_task
     and lease_generation=p_generation
     and state='ACTIVE';

  perform destruktion_meta.devos_emit_event_h205f22(
    v_task.workspace_id,
    'TASK_RESULT_' || v_final,
    v_task.task_id,
    v_task.point_id,
    v_task.role,
    v_task.lease_agent_id,
    v_task.lease_generation,
    v_task.base_sha,
    jsonb_build_object(
      'result_sha256',v_sha,
      'result_summary_sha256',v_sha,
      'error_code',v_error,
      'conversation_url_sha256',case
        when coalesce(v_summary->>'conversation_url_sha256','') ~ '^[0-9a-f]{64}$'
          then v_summary->>'conversation_url_sha256'
        else null
      end,
      'result_claim_sha256',case
        when coalesce(v_summary->>'result_claim_sha256','') ~ '^[0-9a-f]{64}$'
          then v_summary->>'result_claim_sha256'
        else null
      end,
      'result_claim_disposition',left(coalesce(v_summary->>'result_claim_disposition',''),32),
      'result_summary_included',false,
      'page_data_authority',false,
      'model_claim_authority',false,
      'automatic_retry_allowed',false,
      'authority_effect',false
    ),
    v_task.idempotency_key || ':result:' || v_task.lease_generation::text
  );

  return jsonb_build_object(
    'task_id',p_task,
    'state',v_final,
    'result_sha256',v_sha,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.devos_fleet_complete_v1(uuid,text,bigint,text,text,bigint,text,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.devos_fleet_complete_v1(uuid,text,bigint,text,text,bigint,text,jsonb,text)
  to service_role;


-- Keep the existing Client progress contract but admit the already-existing
-- BLOCKED state as terminal. No payload/result text or scheduler identity is
-- added to this projection.
create or replace function public.client_v1_goal_progress_v1(
  p_workspace_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, destruktion_meta, pg_temp
as $$
declare
  v_request destruktion_meta.client_v1_goal_request_h205f22%rowtype;
  v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_terminal boolean := false;
begin
  if p_workspace_id is null then
    raise exception 'client_v1_goal_progress_workspace_required' using errcode='22023';
  end if;
  if p_request_id is null then
    raise exception 'client_v1_goal_progress_request_id_required' using errcode='22023';
  end if;

  select * into v_request
    from destruktion_meta.client_v1_goal_request_h205f22
   where workspace_id = p_workspace_id
     and request_id = p_request_id
   limit 1;

  if not found then
    return jsonb_build_object(
      'schema','metaengine.client-v1.goal-progress.v1',
      'found',false,
      'request_id',p_request_id,
      'workspace_id',p_workspace_id,
      'task_payload_returned',false,
      'result_summary_returned',false,
      'scheduler_identity_returned',false,
      'automatic_retry_allowed',false,
      'scheduler_authority',false,
      'browser_authority',false,
      'release_authority',false,
      'authority_effect',false
    );
  end if;

  select * into v_task
    from destruktion_meta.devos_fleet_task_h205f22
   where workspace_id = v_request.workspace_id
     and task_id = v_request.task_id
   limit 1;
  if not found then
    raise exception 'client_v1_goal_progress_task_missing';
  end if;

  if v_task.point_id <> v_request.point_id
     or v_task.base_sha <> v_request.baseline_sha
     or v_task.task_spec_sha256 <> v_request.task_spec_sha256
     or lower(coalesce(v_task.task_spec #>> '{meta_orchestrator,roadmap_id}','')) <> v_request.roadmap_id
     or coalesce(v_task.task_spec #>> '{meta_orchestrator,alignment_epoch}','') !~ '^[0-9]+$'
     or (v_task.task_spec #>> '{meta_orchestrator,alignment_epoch}')::bigint <> v_request.alignment_epoch
     or coalesce(v_task.task_spec #>> '{meta_orchestrator,plan_generation}','') !~ '^[0-9]+$'
     or (v_task.task_spec #>> '{meta_orchestrator,plan_generation}')::bigint <> v_request.plan_generation
  then
    raise exception 'client_v1_goal_progress_binding_drift';
  end if;

  v_terminal := v_task.state in ('BLOCKED','COMPLETED','FAILED','AMBIGUOUS','FENCED');

  return jsonb_build_object(
    'schema','metaengine.client-v1.goal-progress.v1',
    'found',true,
    'request_id',v_request.request_id,
    'workspace_id',v_request.workspace_id,
    'roadmap_id',v_request.roadmap_id,
    'plan_generation',v_request.plan_generation,
    'alignment_epoch',v_request.alignment_epoch,
    'baseline_sha',v_request.baseline_sha,
    'plan_sha256',v_request.plan_sha256,
    'point_id',v_request.point_id,
    'task_id',v_request.task_id,
    'task_spec_sha256',v_request.task_spec_sha256,
    'task_state',v_task.state,
    'terminal',v_terminal,
    'lease_generation',v_task.lease_generation,
    'result_checkpoint_id',v_task.result_checkpoint_id,
    'result_summary_sha256',v_task.result_summary_sha256,
    'result_sha256',v_task.result_sha256,
    'error_code',v_task.error_code,
    'created_at',v_task.created_at,
    'updated_at',v_task.updated_at,
    'finished_at',v_task.finished_at,
    'survives_plan_retirement',true,
    'task_payload_returned',false,
    'result_summary_returned',false,
    'scheduler_identity_returned',false,
    'automatic_retry_allowed',false,
    'scheduler_authority',false,
    'browser_authority',false,
    'release_authority',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.client_v1_goal_progress_v1(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.client_v1_goal_progress_v1(uuid,uuid)
  to service_role;


create or replace function public.client_v1_goal_execution_proof_v1(
  p_workspace_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, destruktion_meta, extensions, pg_temp
as $$
declare
  v_request destruktion_meta.client_v1_goal_request_h205f22%rowtype;
  v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_origin destruktion_meta.devos_fleet_event_h205f22%rowtype;
  v_origin_proven boolean := false;
  v_result_summary_valid boolean := false;
  v_result_claim_valid boolean := false;
  v_result_origin_bound boolean := false;
  v_result_accepted boolean := false;
  v_result_digest text := null;
  v_terminal boolean := false;
  v_origin_contract text := null;
  v_origin_conversation_sha text := null;
  v_origin_agent_surface_sha text := null;
  v_origin_prompt_sha text := null;
  v_origin_effect_state text := null;
  v_result_claim_sha text := null;
  v_result_claim_schema text := null;
  v_result_claim_disposition text := null;
  v_result_conversation_sha text := null;
  v_allowed_disposition boolean := false;
begin
  if p_workspace_id is null then
    raise exception 'client_v1_goal_execution_proof_workspace_required' using errcode='22023';
  end if;
  if p_request_id is null then
    raise exception 'client_v1_goal_execution_proof_request_id_required' using errcode='22023';
  end if;

  select * into v_request
    from destruktion_meta.client_v1_goal_request_h205f22
   where workspace_id=p_workspace_id
     and request_id=p_request_id
   limit 1;

  if not found then
    return jsonb_build_object(
      'schema','metaengine.client-v1.goal-execution-proof.v1',
      'found',false,
      'request_id',p_request_id,
      'workspace_id',p_workspace_id,
      'user_goal_to_agent_readback',false,
      'user_goal_to_result_readback',false,
      'task_payload_returned',false,
      'result_summary_returned',false,
      'page_content_returned',false,
      'model_output_returned',false,
      'scheduler_identity_returned',false,
      'automatic_retry_allowed',false,
      'scheduler_authority',false,
      'browser_authority',false,
      'release_authority',false,
      'authority_effect',false
    );
  end if;

  select * into v_task
    from destruktion_meta.devos_fleet_task_h205f22
   where workspace_id=v_request.workspace_id
     and task_id=v_request.task_id
   limit 1;
  if not found then
    raise exception 'client_v1_goal_execution_proof_task_missing';
  end if;

  if v_task.point_id <> v_request.point_id
     or v_task.base_sha <> v_request.baseline_sha
     or v_task.task_spec_sha256 <> v_request.task_spec_sha256
     or lower(coalesce(v_task.task_spec #>> '{meta_orchestrator,roadmap_id}','')) <> v_request.roadmap_id
     or coalesce(v_task.task_spec #>> '{meta_orchestrator,alignment_epoch}','') !~ '^[0-9]+$'
     or (v_task.task_spec #>> '{meta_orchestrator,alignment_epoch}')::bigint <> v_request.alignment_epoch
     or coalesce(v_task.task_spec #>> '{meta_orchestrator,plan_generation}','') !~ '^[0-9]+$'
     or (v_task.task_spec #>> '{meta_orchestrator,plan_generation}')::bigint <> v_request.plan_generation
  then
    raise exception 'client_v1_goal_execution_proof_binding_drift';
  end if;

  v_terminal := v_task.state in ('BLOCKED','COMPLETED','FAILED','AMBIGUOUS','FENCED');

  if v_task.lease_generation > 0 then
    select * into v_origin
      from destruktion_meta.devos_fleet_event_h205f22 e
     where e.workspace_id=v_request.workspace_id
       and e.task_id=v_request.task_id
       and e.point_id=v_request.point_id
       and e.base_sha=v_request.baseline_sha
       and e.lease_generation=v_task.lease_generation
       and e.event_type='TASK_TRANSPORT_PROVEN'
       and e.authority_effect=false
     order by e.event_id desc
     limit 1;

    if found then
      v_origin_contract := coalesce(v_origin.payload->>'agent_origin_contract','');
      v_origin_conversation_sha := lower(coalesce(v_origin.payload->>'conversation_url_sha256',''));
      v_origin_agent_surface_sha := lower(coalesce(v_origin.payload->>'agent_surface_sha256',''));
      v_origin_prompt_sha := lower(coalesce(v_origin.payload->>'prompt_sha256',''));
      v_origin_effect_state := upper(coalesce(v_origin.payload->>'effect_state',''));

      v_origin_proven :=
        coalesce(v_origin.agent_id,'') ~ '^agent_[a-z0-9-]{8,64}$'
        and upper(coalesce(v_origin.role,'')) = upper(v_task.role)
        and v_origin_contract = 'ZAI_AGENT_SURFACE_CAUSAL_V1'
        and v_origin_conversation_sha ~ '^[0-9a-f]{64}$'
        and v_origin_agent_surface_sha ~ '^[0-9a-f]{64}$'
        and v_origin_prompt_sha ~ '^[0-9a-f]{64}$'
        and v_origin_effect_state in (
          'PROVEN_GENERATING',
          'PROVEN_NEW_CONVERSATION',
          'PROVEN_CONVERSATION',
          'PROVEN_COMPOSER_CLEARED'
        );
    end if;
  end if;

  if jsonb_typeof(v_task.result_summary)='object'
     and coalesce(v_task.result_summary_sha256,'') ~ '^[0-9a-f]{64}$'
     and coalesce(v_task.result_sha256,'') ~ '^[0-9a-f]{64}$'
  then
    v_result_digest := encode(extensions.digest(convert_to(v_task.result_summary::text,'UTF8'),'sha256'),'hex');
    v_result_summary_valid :=
      v_result_digest=v_task.result_summary_sha256
      and v_task.result_sha256=v_task.result_summary_sha256;
  end if;

  if v_result_summary_valid then
    v_result_claim_schema := coalesce(v_task.result_summary->>'result_claim_schema','');
    v_result_claim_sha := lower(coalesce(v_task.result_summary->>'result_claim_sha256',''));
    v_result_claim_disposition := upper(coalesce(v_task.result_summary->>'result_claim_disposition',''));
    v_result_conversation_sha := lower(coalesce(v_task.result_summary->>'conversation_url_sha256',''));

    v_allowed_disposition := case
      when upper(v_task.role) in ('CRITIC','FALSIFIER')
        then v_result_claim_disposition in ('ACCEPT','REJECT','BLOCKED')
      else v_result_claim_disposition in ('READY','BLOCKED','FAILED')
    end;

    v_result_claim_valid :=
      v_result_claim_schema='metaengine.agent-result-claim.v1'
      and v_result_claim_sha ~ '^[0-9a-f]{64}$'
      and v_allowed_disposition
      and coalesce(v_task.result_summary->>'raw_model_claim_included','false')='false'
      and coalesce(v_task.result_summary->>'model_claim_authority','false')='false'
      and coalesce(v_task.result_summary->>'page_content_included','false')='false'
      and coalesce(v_task.result_summary->>'page_data_authority','false')='false';

    v_result_origin_bound :=
      v_origin_proven
      and v_result_conversation_sha ~ '^[0-9a-f]{64}$'
      and v_result_conversation_sha=v_origin_conversation_sha;

    v_result_accepted :=
      v_result_claim_valid
      and v_result_origin_bound
      and v_task.state in ('RESULT_READY','COMPLETED')
      and (
        (upper(v_task.role) in ('CRITIC','FALSIFIER') and v_result_claim_disposition='ACCEPT')
        or
        (upper(v_task.role) not in ('CRITIC','FALSIFIER') and v_result_claim_disposition='READY')
      );
  end if;

  return jsonb_build_object(
    'schema','metaengine.client-v1.goal-execution-proof.v1',
    'found',true,
    'request_id',v_request.request_id,
    'workspace_id',v_request.workspace_id,
    'roadmap_id',v_request.roadmap_id,
    'plan_generation',v_request.plan_generation,
    'alignment_epoch',v_request.alignment_epoch,
    'baseline_sha',v_request.baseline_sha,
    'plan_sha256',v_request.plan_sha256,
    'point_id',v_request.point_id,
    'task_id',v_request.task_id,
    'task_spec_sha256',v_request.task_spec_sha256,
    'task_state',v_task.state,
    'terminal',v_terminal,
    'lease_generation',v_task.lease_generation,
    'survives_plan_retirement',true,
    'agent_origin_proof',jsonb_build_object(
      'proven',v_origin_proven,
      'contract',case when v_origin_proven then v_origin_contract else null end,
      'conversation_url_sha256',case when v_origin_proven then v_origin_conversation_sha else null end,
      'agent_surface_sha256',case when v_origin_proven then v_origin_agent_surface_sha else null end,
      'prompt_sha256',case when v_origin_proven then v_origin_prompt_sha else null end,
      'effect_state',case when v_origin_proven then v_origin_effect_state else null end,
      'lease_generation',case when v_origin_proven then v_origin.lease_generation else null end,
      'proven_at',case when v_origin_proven then v_origin.created_at else null end,
      'agent_identity_returned',false,
      'tab_identity_returned',false,
      'target_identity_returned',false,
      'authority_effect',false
    ),
    'result_proof',jsonb_build_object(
      'available',v_result_summary_valid,
      'result_summary_sha256',case when v_result_summary_valid then v_task.result_summary_sha256 else null end,
      'result_sha256',case when v_result_summary_valid then v_task.result_sha256 else null end,
      'claim_valid',v_result_claim_valid,
      'claim_schema',case when v_result_claim_valid then v_result_claim_schema else null end,
      'claim_sha256',case when v_result_claim_valid then v_result_claim_sha else null end,
      'claim_disposition',case when v_result_claim_valid then v_result_claim_disposition else null end,
      'conversation_url_sha256',case when v_result_claim_valid and v_result_conversation_sha ~ '^[0-9a-f]{64}$' then v_result_conversation_sha else null end,
      'origin_bound',v_result_origin_bound,
      'accepted',v_result_accepted,
      'result_summary_returned',false,
      'model_output_returned',false,
      'page_content_returned',false,
      'authority_effect',false
    ),
    'user_goal_to_agent_readback',v_origin_proven,
    'user_goal_to_result_readback',v_result_accepted,
    'task_payload_returned',false,
    'result_summary_returned',false,
    'page_content_returned',false,
    'model_output_returned',false,
    'scheduler_identity_returned',false,
    'automatic_retry_allowed',false,
    'scheduler_authority',false,
    'browser_authority',false,
    'release_authority',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.client_v1_goal_execution_proof_v1(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.client_v1_goal_execution_proof_v1(uuid,uuid)
  to service_role;

comment on function public.client_v1_goal_execution_proof_v1(uuid,uuid) is
  'Read-only Client V1 proof join from request UUID to exact DevOS Agent-origin transport event and digest-only typed Result Claim; no scheduler identity, page/model content, retry or Browser authority.';
