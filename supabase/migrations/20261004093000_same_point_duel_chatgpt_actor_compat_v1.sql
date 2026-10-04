-- METAENGINE SAME_POINT_DUEL ChatGPT actor compatibility V1
--
-- Historical V4 storage/RPCs use actor slots GPT/GLM. Those immutable labels
-- are NOT provider identities anymore. This additive surface accepts only two
-- independent ChatGPT/OpenAI actor identities and maps them to the old slots
-- at the final DB compatibility boundary.
--
-- No historical migration/table is rewritten. Old peer relay APIs remain
-- readable for historical evidence; new active clients use the *_chatgpt_* RPCs.

create or replace function public.h205f22_duel_create_chatgpt_relay_v1(
  p_duel_key text,
  p_milestone_key text,
  p_base_github_sha text,
  p_subject jsonb default '{}'::jsonb,
  p_actor_a_peer_id text default 'chatgpt:actor-a:gpt-5.6',
  p_actor_b_peer_id text default 'chatgpt:actor-b:gpt-5.6'
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','destruktion_meta','extensions'
as $$
declare
  s jsonb;
  r jsonb;
begin
  if jsonb_typeof(coalesce(p_subject,'{}'::jsonb)) <> 'object' then
    raise exception 'subject_must_be_object';
  end if;
  if trim(coalesce(p_actor_a_peer_id,'')) not like 'chatgpt:actor-a:%' then
    raise exception 'actor_a_chatgpt_peer_id_required';
  end if;
  if trim(coalesce(p_actor_b_peer_id,'')) not like 'chatgpt:actor-b:%' then
    raise exception 'actor_b_chatgpt_peer_id_required';
  end if;

  s := coalesce(p_subject,'{}'::jsonb) || jsonb_build_object(
    'actor_identity_protocol','CHATGPT_ACTOR_PAIR_V1',
    'active_inference_provider','OPENAI',
    'active_inference_platform','CHATGPT',
    'actor_identities',jsonb_build_object(
      'ACTOR_A',trim(p_actor_a_peer_id),
      'ACTOR_B',trim(p_actor_b_peer_id)
    ),
    'legacy_db_actor_slot_mapping',jsonb_build_object(
      'GPT','ACTOR_A',
      'GLM','ACTOR_B'
    ),
    'legacy_db_slot_names_are_provider_identity',false,
    'independent_actor_contexts_required',true,
    'canonical',false,
    'authority_effect',false
  );

  -- Historical create RPC stores the final two model/peer coordinates in
  -- GPT/GLM slots. Both peer IDs remain truthful ChatGPT identities.
  r := public.h205f22_duel_create_peer_relay_v4(
    p_duel_key,
    p_milestone_key,
    p_base_github_sha,
    s,
    trim(p_actor_a_peer_id),
    trim(p_actor_b_peer_id)
  );

  return r || jsonb_build_object(
    'actor_identity_protocol','CHATGPT_ACTOR_PAIR_V1',
    'active_inference_provider','OPENAI',
    'active_inference_platform','CHATGPT',
    'legacy_db_slot_mapping',jsonb_build_object('GPT','ACTOR_A','GLM','ACTOR_B'),
    'canonical',false,
    'authority_effect',false
  );
end $$;

revoke all on function public.h205f22_duel_create_chatgpt_relay_v1(text,text,text,jsonb,text,text)
  from public,anon,authenticated;
grant execute on function public.h205f22_duel_create_chatgpt_relay_v1(text,text,text,jsonb,text,text)
  to service_role;

create or replace function public.h205f22_duel_submit_chatgpt_peer_v1(
  p_duel_id uuid,
  p_actor text,
  p_wave text,
  p_seen_checkpoint_sha256 text,
  p_payload jsonb,
  p_peer_id text,
  p_lease_seconds integer default 1200
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','destruktion_meta','extensions'
as $$
declare
  d destruktion_meta.compute_fabric_duel_session_h205f22%rowtype;
  existing destruktion_meta.compute_fabric_duel_peer_submission_h205f22%rowtype;
  actor_a_row destruktion_meta.compute_fabric_duel_peer_submission_h205f22%rowtype;
  actor_b_row destruktion_meta.compute_fabric_duel_peer_submission_h205f22%rowtype;
  v_actor text;
  v_slot text;
  v_peer_slot text;
  v_payload jsonb;
  v_hash text;
  v_step text;
  v_expected_tick bigint;
  v_expected_peer_hash text;
  v_relay_worker text;
  v_lease jsonb;
  v_generation bigint;
  v_count integer;
  v_receipt jsonb;
  v_read jsonb;
begin
  v_actor := upper(trim(coalesce(p_actor,'')));
  p_wave := upper(trim(coalesce(p_wave,'')));
  if v_actor not in ('ACTOR_A','ACTOR_B') then raise exception 'chatgpt_actor_invalid'; end if;
  v_slot := case when v_actor='ACTOR_A' then 'GPT' else 'GLM' end;
  v_peer_slot := case when v_actor='ACTOR_A' then 'GLM' else 'GPT' end;

  if p_wave not in ('PROPOSE','REBUT') then raise exception 'peer_wave_invalid'; end if;
  if p_seen_checkpoint_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'seen_checkpoint_invalid'; end if;
  if v_actor='ACTOR_A' and trim(coalesce(p_peer_id,'')) not like 'chatgpt:actor-a:%' then
    raise exception 'actor_a_chatgpt_peer_id_required';
  end if;
  if v_actor='ACTOR_B' and trim(coalesce(p_peer_id,'')) not like 'chatgpt:actor-b:%' then
    raise exception 'actor_b_chatgpt_peer_id_required';
  end if;
  if p_lease_seconds<60 or p_lease_seconds>3600 then raise exception 'lease_seconds_out_of_range'; end if;
  if jsonb_typeof(coalesce(p_payload,'null'::jsonb)) <> 'object' then raise exception 'peer_payload_object_required'; end if;

  v_payload := p_payload || jsonb_build_object(
    'canonical',false,
    'authority_effect',false,
    '_peer_relay',jsonb_build_object(
      'peer_id',trim(p_peer_id),
      'actor',v_actor,
      'legacy_db_slot',v_slot,
      'provider','OPENAI',
      'platform','CHATGPT',
      'wave',p_wave,
      'protocol','CHATGPT_TWO_ACTOR_RELAY_V1'
    )
  );
  if v_payload->>'phase' is distinct from p_wave then raise exception 'peer_payload_phase_mismatch'; end if;
  v_step := upper(trim(coalesce(v_payload->>'step_type','')));
  if v_step !~ '^[A-Z0-9_]{2,48}$' then raise exception 'peer_step_type_invalid'; end if;
  v_payload := jsonb_set(v_payload,'{step_type}',to_jsonb(v_step),true);
  if length(trim(coalesce(v_payload->>'claim','')))=0 then raise exception 'peer_claim_required'; end if;
  if length(trim(coalesce(v_payload->>'falsifier','')))=0 then raise exception 'peer_falsifier_required'; end if;
  if jsonb_typeof(v_payload->'reasoning_summary') is distinct from 'array' then raise exception 'peer_reasoning_summary_array_required'; end if;
  if jsonb_typeof(v_payload->'evidence_used') is distinct from 'array' then raise exception 'peer_evidence_used_array_required'; end if;
  if jsonb_typeof(v_payload->'assumptions') is distinct from 'array' then raise exception 'peer_assumptions_array_required'; end if;
  if jsonb_typeof(v_payload->'peer_claims_addressed') is distinct from 'array' then raise exception 'peer_claims_addressed_array_required'; end if;
  if jsonb_typeof(v_payload->'tests_required') is distinct from 'array' then raise exception 'peer_tests_required_array_required'; end if;
  if p_wave='PROPOSE' then
    if jsonb_typeof(v_payload->'proposed_action') is distinct from 'object'
       or length(trim(coalesce(v_payload->'proposed_action'->>'kind','')))=0 then raise exception 'peer_proposed_action_required'; end if;
    if v_payload->>'peer_event_hash_addressed' is not null then raise exception 'propose_peer_hash_must_be_null'; end if;
    if v_payload->>'terminal_vote' is not null then raise exception 'propose_terminal_vote_must_be_null'; end if;
  else
    if jsonb_typeof(v_payload->'resulting_action') is distinct from 'object'
       or length(trim(coalesce(v_payload->'resulting_action'->>'kind','')))=0 then raise exception 'peer_resulting_action_required'; end if;
    -- Historical decision vocabulary is retained by V4 arbitration. These are
    -- candidate-slot names only: WIN_GPT=ACTOR_A, WIN_GLM=ACTOR_B.
    if v_payload->>'terminal_vote' not in ('WIN_GPT','WIN_GLM','SYNTHESIS','NO_ACTION') then
      raise exception 'rebut_terminal_vote_invalid';
    end if;
  end if;
  v_payload := jsonb_set(v_payload,'{need_canary}',to_jsonb(coalesce((v_payload->>'need_canary')::boolean,false)),true);
  v_hash := encode(extensions.digest(convert_to(v_payload::text,'utf8'),'sha256'),'hex');

  select * into d
  from destruktion_meta.compute_fabric_duel_session_h205f22
  where duel_id=p_duel_id
  for update;
  if not found then raise exception 'peer_relay_duel_not_found'; end if;
  if coalesce((d.subject->>'peer_relay')::boolean,false) is not true
     or d.subject->>'debate_protocol' <> 'SAME_POINT_DUEL_V4'
     or d.subject->>'actor_identity_protocol' <> 'CHATGPT_ACTOR_PAIR_V1'
     or d.subject->>'active_inference_provider' <> 'OPENAI'
     or d.subject->>'active_inference_platform' <> 'CHATGPT' then
    raise exception 'not_chatgpt_actor_pair_v1';
  end if;
  if d.protocol_version <> 'LOCKSTEP_V2' or d.max_ticks <> 2 then raise exception 'peer_relay_protocol_mismatch'; end if;
  if (d.subject->'actor_identities'->>v_actor) is distinct from trim(p_peer_id) then raise exception 'peer_identity_mismatch'; end if;
  if (d.subject->'peer_identities'->>v_slot) is distinct from trim(p_peer_id) then raise exception 'legacy_slot_identity_mismatch'; end if;

  select * into existing
  from destruktion_meta.compute_fabric_duel_peer_submission_h205f22
  where duel_id=p_duel_id and wave=p_wave and actor=v_slot;
  if found then
    if existing.payload_sha256 <> v_hash or existing.seen_checkpoint_sha256 <> p_seen_checkpoint_sha256
       or existing.peer_id <> trim(p_peer_id) then raise exception 'peer_submission_conflict'; end if;
    return public.h205f22_duel_read_peer_relay_v4(p_duel_id) || jsonb_build_object(
      'submission_replayed',true,
      'actor',v_actor,
      'legacy_db_slot',v_slot,
      'wave',p_wave,
      'payload_sha256',v_hash,
      'active_inference_provider','OPENAI',
      'active_inference_platform','CHATGPT',
      'canonical',false,
      'authority_effect',false
    );
  end if;

  v_expected_tick := case when p_wave='PROPOSE' then 0 else 1 end;
  if d.current_tick <> v_expected_tick then raise exception 'peer_wave_stale_tick:%:%',d.current_tick,p_wave; end if;
  if d.current_checkpoint_sha256 <> p_seen_checkpoint_sha256 then raise exception 'peer_seen_checkpoint_stale'; end if;

  if p_wave='REBUT' then
    select event_sha256 into v_expected_peer_hash
    from destruktion_meta.compute_fabric_duel_event_h205f22
    where duel_id=p_duel_id and tick_no=1 and actor=v_peer_slot
    order by event_id desc limit 1;
    if v_expected_peer_hash is null then raise exception 'peer_propose_event_missing'; end if;
    if v_payload->>'peer_event_hash_addressed' is distinct from v_expected_peer_hash then raise exception 'rebut_peer_hash_mismatch'; end if;
  end if;

  if d.status='BLOCKED' and d.lease_owner is null then
    update destruktion_meta.compute_fabric_duel_session_h205f22
    set status='READY',updated_at=clock_timestamp() where duel_id=p_duel_id;
  elsif d.status not in ('READY','RUNNING') then
    raise exception 'peer_relay_session_not_submittable:%',d.status;
  end if;

  v_relay_worker := 'sovereign:v4:chatgpt-relay:'||p_duel_id::text;
  v_lease := public.h205f22_duel_lease_target_lockstep_v3(p_duel_id,v_relay_worker,p_lease_seconds,0);
  if coalesce((v_lease->>'leased')::boolean,false) is not true then
    raise exception 'peer_relay_lease_failed:%',coalesce(v_lease->>'reason','UNKNOWN');
  end if;
  v_generation := (v_lease->>'lease_generation')::bigint;

  -- The actor column is the immutable historical slot; peer_id/payload remain
  -- truthful ChatGPT Actor A/B identities.
  insert into destruktion_meta.compute_fabric_duel_peer_submission_h205f22(
    duel_id,wave,actor,peer_id,seen_checkpoint_sha256,payload,payload_sha256
  ) values(p_duel_id,p_wave,v_slot,trim(p_peer_id),p_seen_checkpoint_sha256,v_payload,v_hash);

  select count(*) into v_count
  from destruktion_meta.compute_fabric_duel_peer_submission_h205f22
  where duel_id=p_duel_id and wave=p_wave;

  if v_count < 2 then
    update destruktion_meta.compute_fabric_duel_session_h205f22
    set status='BLOCKED',lease_owner=null,lease_expires_at=null,updated_at=clock_timestamp()
    where duel_id=p_duel_id;
    return public.h205f22_duel_read_peer_relay_v4(p_duel_id) || jsonb_build_object(
      'submission_accepted',true,'pair_committed',false,
      'actor',v_actor,'legacy_db_slot',v_slot,'wave',p_wave,
      'payload_sha256',v_hash,
      'active_inference_provider','OPENAI','active_inference_platform','CHATGPT',
      'canonical',false,'authority_effect',false
    );
  end if;

  select * into actor_a_row
  from destruktion_meta.compute_fabric_duel_peer_submission_h205f22
  where duel_id=p_duel_id and wave=p_wave and actor='GPT';
  select * into actor_b_row
  from destruktion_meta.compute_fabric_duel_peer_submission_h205f22
  where duel_id=p_duel_id and wave=p_wave and actor='GLM';
  if actor_a_row.submission_id is null or actor_b_row.submission_id is null then raise exception 'peer_pair_incomplete'; end if;
  if actor_a_row.seen_checkpoint_sha256 <> actor_b_row.seen_checkpoint_sha256
     or actor_a_row.seen_checkpoint_sha256 <> p_seen_checkpoint_sha256 then raise exception 'peer_pair_checkpoint_mismatch'; end if;

  if p_wave='PROPOSE' then
    v_receipt := public.h205f22_duel_submit_pair_v3(
      p_duel_id,v_relay_worker,v_generation,1,p_seen_checkpoint_sha256,
      actor_a_row.payload->>'step_type',actor_a_row.payload,
      actor_b_row.payload->>'step_type',actor_b_row.payload
    );
    update destruktion_meta.compute_fabric_duel_session_h205f22
    set status='BLOCKED',lease_owner=null,lease_expires_at=null,updated_at=clock_timestamp()
    where duel_id=p_duel_id and current_tick=1;
    v_read := public.h205f22_duel_read_peer_relay_v4(p_duel_id);
    return v_read || jsonb_build_object(
      'submission_accepted',true,'pair_committed',true,'wave','PROPOSE','pair',v_receipt,
      'actor_identity_protocol','CHATGPT_ACTOR_PAIR_V1',
      'active_inference_provider','OPENAI','active_inference_platform','CHATGPT',
      'canonical',false,'authority_effect',false
    );
  end if;

  v_receipt := public.h205f22_duel_submit_rebut_finalize_v4(
    p_duel_id,v_relay_worker,v_generation,p_seen_checkpoint_sha256,
    actor_a_row.payload->>'step_type',actor_a_row.payload,
    actor_b_row.payload->>'step_type',actor_b_row.payload
  );
  return public.h205f22_duel_read_peer_relay_v4(p_duel_id) || jsonb_build_object(
    'submission_accepted',true,'pair_committed',true,'wave','REBUT','finalize',v_receipt,
    'actor_identity_protocol','CHATGPT_ACTOR_PAIR_V1',
    'active_inference_provider','OPENAI','active_inference_platform','CHATGPT',
    'canonical',false,'authority_effect',false
  );
end $$;

revoke all on function public.h205f22_duel_submit_chatgpt_peer_v1(uuid,text,text,text,jsonb,text,integer)
  from public,anon,authenticated;
grant execute on function public.h205f22_duel_submit_chatgpt_peer_v1(uuid,text,text,text,jsonb,text,integer)
  to service_role;
