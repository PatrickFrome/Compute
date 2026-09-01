-- METAENGINE DevOS ambiguity reconciliation v1.
-- Branch-local migration only. Do not apply to production from this audit task.
--
-- Resolves only ambiguity classes with durable native evidence. It never replays a Browser
-- effect and never allocates a new lease generation. PRE_EFFECT_ABORTED may return the task
-- to READY only when the native write-ahead effect barrier was not crossed. EFFECT_PROVEN
-- restores the lost RUNNING receipt for the SAME lease generation only after fresh exact
-- transport readback proves the submitted conversation. Everything else stays AMBIGUOUS.

create or replace function public.devos_fleet_reconcile_ambiguous_v1(
  p_workspace uuid,
  p_task uuid,
  p_agent text,
  p_generation bigint,
  p_tab text,
  p_target text,
  p_epoch bigint,
  p_recovery jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, destruktion_meta, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_agent text := lower(trim(coalesce(p_agent,'')));
  v_target text := lower(trim(coalesce(p_target,'')));
  v_class text := upper(trim(coalesce(p_recovery->>'recovery_class','')));
  v_prompt_sha text := lower(trim(coalesce(p_recovery->>'prompt_sha256','')));
  v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_claim destruktion_meta.devos_fleet_claim_h205f22%rowtype;
  v_supervisor_state jsonb;
  v_agents jsonb;
  v_browser_agent jsonb;
  v_transport_proof jsonb;
  v_last_seen timestamptz;
  v_proven_at timestamptz;
  v_proof jsonb := coalesce(p_recovery->'proof','{}'::jsonb);
  v_conversation_sha text;
  v_effect_state text;
  v_claim_expires timestamptz := v_now + interval '900 seconds';
  v_duplicate boolean := false;
begin
  if p_workspace is null or p_task is null then
    raise exception 'devos_ambiguity_identity_required' using errcode='22023';
  end if;
  if v_agent !~ '^agent_[a-z0-9-]{8,64}$'
     or coalesce(p_tab,'') = '' or length(p_tab) > 160
     or v_target !~ '^webcontents:[1-9][0-9]*$'
     or p_generation is null or p_generation < 1
     or p_epoch is null or p_epoch < 1 then
    raise exception 'devos_ambiguity_binding_invalid' using errcode='22023';
  end if;
  if jsonb_typeof(p_recovery) <> 'object'
     or v_class not in ('PRE_EFFECT_ABORTED','EFFECT_PROVEN')
     or v_prompt_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'devos_ambiguity_recovery_invalid' using errcode='22023';
  end if;
  if coalesce((p_recovery->>'automatic_retry_allowed')::boolean,true) <> false
     or coalesce((p_recovery->>'authority_effect')::boolean,true) <> false then
    raise exception 'devos_ambiguity_recovery_authority_invalid' using errcode='22023';
  end if;

  select * into v_task
    from destruktion_meta.devos_fleet_task_h205f22
   where task_id=p_task and workspace_id=p_workspace
   for update;
  if not found then raise exception 'devos_ambiguity_task_missing'; end if;
  if v_task.authority_effect <> false or v_task.lease_generation <> p_generation then
    raise exception 'devos_ambiguity_generation_fenced';
  end if;

  select * into v_claim
    from destruktion_meta.devos_fleet_claim_h205f22 c
   where c.workspace_id=p_workspace
     and c.task_id=p_task
     and c.agent_id=v_agent
     and c.lease_generation=p_generation
     and c.base_sha=v_task.base_sha
     and c.tab_id=p_tab
     and lower(c.target_id)=v_target
     and c.agent_generation_epoch=p_epoch
     and c.authority_effect=false
   order by c.updated_at desc, c.claim_id desc
   limit 1;
  if not found then raise exception 'devos_ambiguity_claim_binding_fenced'; end if;

  -- A retained task lease binding and the durable claim history must never disagree.
  if v_task.lease_agent_id is not null and (
       lower(v_task.lease_agent_id) <> v_agent
       or v_task.lease_tab_id <> p_tab
       or lower(v_task.lease_target_id) <> v_target
       or v_task.lease_agent_generation_epoch <> p_epoch
     ) then
    raise exception 'devos_ambiguity_task_binding_fenced';
  end if;

  if v_class='PRE_EFFECT_ABORTED' then
    if coalesce((p_recovery->>'physical_effect_attempted')::boolean,true) <> false
       or coalesce((p_recovery->>'effect_barrier_crossed')::boolean,true) <> false
       or jsonb_typeof(v_proof) <> 'object'
       or v_proof <> '{}'::jsonb then
      raise exception 'devos_ambiguity_pre_effect_proof_invalid' using errcode='22023';
    end if;

    if v_task.state='READY'
       and v_task.lease_generation=p_generation
       and v_task.lease_agent_id is null
       and v_task.lease_tab_id is null
       and v_task.lease_target_id is null
       and v_task.lease_agent_generation_epoch is null then
      v_duplicate := true;
      return jsonb_build_object(
        'schema','metaengine.devos.ambiguity-reconciliation.v1','workspace_id',p_workspace,'task_id',p_task,
        'lease_generation',p_generation,'state','READY','recovery_class',v_class,'duplicate',true,
        'retry_via_scheduler',true,'physical_effect_replayed',false,'new_lease_generation_allocated',false,
        'automatic_retry_allowed',false,'authority_effect',false
      );
    end if;
    if v_task.state <> 'AMBIGUOUS' then raise exception 'devos_ambiguity_state_fenced'; end if;

    -- No active claim may survive into READY. This is fencing, not a retry or a lease grant.
    update destruktion_meta.devos_fleet_claim_h205f22
       set state='FENCED', updated_at=v_now
     where workspace_id=p_workspace and task_id=p_task and lease_generation=p_generation and state='ACTIVE';

    update destruktion_meta.devos_fleet_task_h205f22
       set state='READY',
           lease_agent_id=null,
           lease_tab_id=null,
           lease_target_id=null,
           lease_agent_generation_epoch=null,
           lease_expires_at=null,
           result_checkpoint_id=null,
           result_summary=null,
           result_summary_sha256=null,
           error_code=null,
           updated_at=v_now
     where task_id=p_task and workspace_id=p_workspace and state='AMBIGUOUS' and lease_generation=p_generation;
    if not found then raise exception 'devos_ambiguity_pre_effect_transition_fenced'; end if;

    perform destruktion_meta.devos_emit_event_h205f22(
      p_workspace,'TASK_AMBIGUITY_EFFECT_ABSENT_REQUEUED',p_task,v_task.point_id,v_task.role,v_agent,p_generation,v_task.base_sha,
      jsonb_build_object(
        'recovery_class',v_class,'prompt_sha256',v_prompt_sha,'physical_effect_attempted',false,
        'effect_barrier_crossed',false,'retry_via_scheduler',true,'physical_effect_replayed',false,
        'new_lease_generation_allocated',false,'automatic_retry_allowed',false,'authority_effect',false
      ),
      'devos:ambiguity:effect-absent:'||p_task::text||':'||p_generation::text
    );

    return jsonb_build_object(
      'schema','metaengine.devos.ambiguity-reconciliation.v1','workspace_id',p_workspace,'task_id',p_task,
      'lease_generation',p_generation,'state','READY','recovery_class',v_class,'duplicate',v_duplicate,
      'retry_via_scheduler',true,'physical_effect_replayed',false,'new_lease_generation_allocated',false,
      'automatic_retry_allowed',false,'authority_effect',false
    );
  end if;

  -- EFFECT_PROVEN: the Browser effect is never replayed. Restore only the missing DB receipt
  -- for the same generation and only if the current supervisor transport proves the exact
  -- conversation, tab, target, agent generation, and fleet ownership.
  if coalesce((p_recovery->>'physical_effect_attempted')::boolean,false) <> true
     or coalesce((p_recovery->>'effect_barrier_crossed')::boolean,false) <> true
     or jsonb_typeof(v_proof) <> 'object' then
    raise exception 'devos_ambiguity_effect_proven_payload_invalid' using errcode='22023';
  end if;
  if lower(coalesce(v_proof->>'prompt_sha256','')) <> v_prompt_sha then
    raise exception 'devos_ambiguity_prompt_proof_fenced';
  end if;
  v_conversation_sha := lower(coalesce(v_proof->>'conversation_url_sha256',''));
  v_effect_state := upper(coalesce(v_proof->>'effect_state',''));
  if v_conversation_sha !~ '^[0-9a-f]{64}$'
     or v_effect_state not in ('PROVEN_GENERATING','PROVEN_NEW_CONVERSATION','PROVEN_CONVERSATION') then
    raise exception 'devos_ambiguity_transport_proof_invalid' using errcode='22023';
  end if;

  select s.state,s.last_seen_at into v_supervisor_state,v_last_seen
    from public.compute_fabric_a2_browser_supervisor_state_h205f22 s
   where s.workspace_id=p_workspace
     and s.authority_effect=false
     and s.state->>'schema'='metaengine.native-browser-supervisor.state.v1'
     and s.state->'fleet'->>'schema'='metaengine.browser.fleet-snapshot.v1'
     and s.state->'fleet'->>'readiness_contract'='TRANSPORT_PROOF_REQUIRED'
   order by s.last_seen_at desc
   limit 1;
  if not found or v_last_seen < v_now - interval '45 seconds' then
    raise exception 'devos_ambiguity_supervisor_snapshot_fenced';
  end if;
  v_agents := v_supervisor_state->'fleet'->'agents';
  if jsonb_typeof(v_agents) <> 'array' or jsonb_array_length(v_agents)>64 then
    raise exception 'devos_ambiguity_fleet_snapshot_fenced';
  end if;

  select value into v_browser_agent
    from jsonb_array_elements(v_agents)
   where lower(coalesce(value->>'agent_id',''))=v_agent
   limit 1;
  if not found
     or v_browser_agent->>'ownership'<>'FLEET_OWNED'
     or v_browser_agent->>'lifecycle_state'<>'ACTIVE'
     or v_browser_agent->>'authority_effect'<>'false'
     or v_browser_agent->>'automatic_retry_allowed'<>'false'
     or v_browser_agent->>'tab_id'<>p_tab
     or lower(coalesce(v_browser_agent->>'target_id',''))<>v_target
     or coalesce(v_browser_agent->>'generation_epoch','')<>p_epoch::text then
    raise exception 'devos_ambiguity_agent_binding_fenced';
  end if;

  v_transport_proof := v_browser_agent->'transport_proof';
  if jsonb_typeof(v_transport_proof)<>'object'
     or v_transport_proof->>'schema'<>'metaengine.browser.fleet-transport-proof.v1'
     or v_transport_proof->>'authority_effect'<>'false'
     or v_transport_proof->>'tab_id'<>p_tab
     or lower(coalesce(v_transport_proof->>'target_id',''))<>v_target
     or coalesce(v_transport_proof->>'generation_epoch','')<>p_epoch::text
     or lower(coalesce(v_transport_proof->>'conversation_url_sha256',''))<>v_conversation_sha
     or coalesce(v_transport_proof->>'proven_at','')='' then
    raise exception 'devos_ambiguity_conversation_proof_fenced';
  end if;
  begin v_proven_at := (v_transport_proof->>'proven_at')::timestamptz;
  exception when others then raise exception 'devos_ambiguity_transport_time_fenced'; end;
  if v_proven_at > v_last_seen + interval '5 seconds' then
    raise exception 'devos_ambiguity_transport_time_fenced';
  end if;

  if v_task.state='RUNNING'
     and lower(coalesce(v_task.lease_agent_id,''))=v_agent
     and v_task.lease_tab_id=p_tab
     and lower(coalesce(v_task.lease_target_id,''))=v_target
     and v_task.lease_agent_generation_epoch=p_epoch
     and exists (
       select 1 from destruktion_meta.devos_fleet_claim_h205f22 c
        where c.task_id=p_task and c.workspace_id=p_workspace and c.agent_id=v_agent
          and c.lease_generation=p_generation and c.tab_id=p_tab and lower(c.target_id)=v_target
          and c.agent_generation_epoch=p_epoch and c.state='ACTIVE' and c.expires_at>v_now
     ) then
    return jsonb_build_object(
      'schema','metaengine.devos.ambiguity-reconciliation.v1','workspace_id',p_workspace,'task_id',p_task,
      'lease_generation',p_generation,'state','RUNNING','recovery_class',v_class,'duplicate',true,
      'retry_via_scheduler',false,'physical_effect_replayed',false,'new_lease_generation_allocated',false,
      'conversation_url_sha256',v_conversation_sha,'automatic_retry_allowed',false,'authority_effect',false
    );
  end if;
  if v_task.state <> 'AMBIGUOUS' then raise exception 'devos_ambiguity_state_fenced'; end if;

  if exists (
    select 1 from destruktion_meta.devos_fleet_claim_h205f22 c
     where c.workspace_id=p_workspace and c.state='ACTIVE' and c.expires_at>v_now
       and (c.task_id=p_task or c.agent_id=v_agent)
       and not (c.task_id=p_task and c.agent_id=v_agent and c.lease_generation=p_generation
         and c.tab_id=p_tab and lower(c.target_id)=v_target and c.agent_generation_epoch=p_epoch)
  ) then
    raise exception 'devos_ambiguity_active_claim_conflict_fenced';
  end if;

  update destruktion_meta.devos_fleet_claim_h205f22
     set state='FENCED',updated_at=v_now
   where workspace_id=p_workspace and task_id=p_task and lease_generation=p_generation and state='ACTIVE';

  update destruktion_meta.devos_fleet_task_h205f22
     set state='RUNNING',
         lease_agent_id=v_agent,
         lease_tab_id=p_tab,
         lease_target_id=v_target,
         lease_agent_generation_epoch=p_epoch,
         lease_expires_at=v_claim_expires,
         result_checkpoint_id=null,
         result_summary=null,
         result_summary_sha256=null,
         error_code=null,
         updated_at=v_now
   where task_id=p_task and workspace_id=p_workspace and state='AMBIGUOUS' and lease_generation=p_generation;
  if not found then raise exception 'devos_ambiguity_effect_proven_transition_fenced'; end if;

  insert into destruktion_meta.devos_fleet_claim_h205f22(
    claim_id,task_id,workspace_id,point_id,role,agent_id,claim_class,lease_generation,base_sha,
    tab_id,target_id,agent_generation_epoch,state,expires_at,created_at,updated_at,authority_effect
  ) values (
    gen_random_uuid(),p_task,p_workspace,v_task.point_id,v_task.role,v_agent,v_claim.claim_class,p_generation,v_task.base_sha,
    p_tab,v_target,p_epoch,'ACTIVE',v_claim_expires,v_now,v_now,false
  );

  perform destruktion_meta.devos_emit_event_h205f22(
    p_workspace,'TASK_AMBIGUITY_EFFECT_PROVEN_RUNNING',p_task,v_task.point_id,v_task.role,v_agent,p_generation,v_task.base_sha,
    jsonb_build_object(
      'recovery_class',v_class,'prompt_sha256',v_prompt_sha,'conversation_url_sha256',v_conversation_sha,
      'effect_state',v_effect_state,'physical_effect_attempted',true,'effect_barrier_crossed',true,
      'physical_effect_replayed',false,'new_lease_generation_allocated',false,
      'automatic_retry_allowed',false,'authority_effect',false
    ),
    'devos:ambiguity:effect-proven:'||p_task::text||':'||p_generation::text
  );

  return jsonb_build_object(
    'schema','metaengine.devos.ambiguity-reconciliation.v1','workspace_id',p_workspace,'task_id',p_task,
    'lease_generation',p_generation,'state','RUNNING','recovery_class',v_class,'duplicate',false,
    'retry_via_scheduler',false,'physical_effect_replayed',false,'new_lease_generation_allocated',false,
    'conversation_url_sha256',v_conversation_sha,'automatic_retry_allowed',false,'authority_effect',false
  );
end;
$$;

revoke all on function public.devos_fleet_reconcile_ambiguous_v1(uuid,uuid,text,bigint,text,text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.devos_fleet_reconcile_ambiguous_v1(uuid,uuid,text,bigint,text,text,bigint,jsonb) to service_role;
