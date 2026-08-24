-- METAENGINE H205F22 SAME_POINT_DUEL_V4 PEER RELAY
-- Enables two independent interactive agent environments to participate in the
-- same V4 causal machine without exposing pending peer content before atomic pairing.

create table if not exists destruktion_meta.compute_fabric_duel_peer_submission_h205f22 (
  submission_id uuid primary key default gen_random_uuid(),
  duel_id uuid not null references destruktion_meta.compute_fabric_duel_session_h205f22(duel_id),
  wave text not null check (wave in ('PROPOSE','REBUT')),
  actor text not null check (actor in ('GPT','GLM')),
  peer_id text not null check (length(trim(peer_id)) >= 3),
  seen_checkpoint_sha256 text not null check (seen_checkpoint_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  created_at timestamptz not null default clock_timestamp(),
  unique (duel_id,wave,actor)
);

create or replace function destruktion_meta.compute_fabric_duel_peer_submission_immutable_h205f22()
returns trigger language plpgsql set search_path=pg_catalog,destruktion_meta as $$
begin
  raise exception 'duel_peer_submission_append_only';
end $$;

drop trigger if exists compute_fabric_duel_peer_submission_immutable_h205f22
  on destruktion_meta.compute_fabric_duel_peer_submission_h205f22;
create trigger compute_fabric_duel_peer_submission_immutable_h205f22
before update or delete on destruktion_meta.compute_fabric_duel_peer_submission_h205f22
for each row execute function destruktion_meta.compute_fabric_duel_peer_submission_immutable_h205f22();

revoke all on destruktion_meta.compute_fabric_duel_peer_submission_h205f22 from public,anon,authenticated,service_role;

create or replace function public.h205f22_duel_read_peer_relay_v4(p_duel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','destruktion_meta','extensions'
as $$
declare
  d destruktion_meta.compute_fabric_duel_session_h205f22%rowtype;
  base jsonb;
  pending text[];
  pending_wave text;
  relay_state text;
  has_decision boolean;
begin
  select * into d from destruktion_meta.compute_fabric_duel_session_h205f22 where duel_id=p_duel_id;
  if not found then
    return jsonb_build_object('schema','metaengine.compute.same-point-peer-relay.h205f22.v1','found',false,'canonical',false,'authority_effect',false);
  end if;
  if coalesce((d.subject->>'peer_relay')::boolean,false) is not true
     or d.subject->>'debate_protocol' <> 'SAME_POINT_DUEL_V4' then
    raise exception 'not_peer_relay_v4';
  end if;

  base := public.h205f22_duel_read_same_point_v4(p_duel_id);
  pending_wave := case when d.current_tick=0 then 'PROPOSE' when d.current_tick=1 then 'REBUT' else null end;
  if pending_wave is not null then
    select array_agg(actor order by actor) into pending
    from destruktion_meta.compute_fabric_duel_peer_submission_h205f22
    where duel_id=p_duel_id and wave=pending_wave;
  end if;
  select exists(select 1 from destruktion_meta.compute_fabric_duel_decision_h205f22 where duel_id=p_duel_id) into has_decision;

  relay_state := case
    when has_decision then 'DECIDED'
    when d.current_tick=0 and coalesce(array_length(pending,1),0)=0 then 'ARMED_WAIT'
    when d.current_tick=0 then 'WAITING_PROPOSE_PEER'
    when d.current_tick=1 and coalesce(array_length(pending,1),0)=0 then 'WAITING_REBUT_START'
    when d.current_tick=1 then 'WAITING_REBUT_PEER'
    else 'ADVANCED'
  end;

  return base || jsonb_build_object(
    'schema','metaengine.compute.same-point-peer-relay.h205f22.v1',
    'peer_relay',true,
    'relay_state',relay_state,
    'pending_wave',pending_wave,
    'pending_actors',coalesce(to_jsonb(pending),'[]'::jsonb),
    'pending_payloads_exposed',false,
    'canonical',false,
    'authority_effect',false
  );
end $$;

revoke all on function public.h205f22_duel_read_peer_relay_v4(uuid) from public,anon,authenticated;
grant execute on function public.h205f22_duel_read_peer_relay_v4(uuid) to service_role;

create or replace function public.h205f22_duel_create_peer_relay_v4(
  p_duel_key text,
  p_milestone_key text,
  p_base_github_sha text,
  p_subject jsonb default '{}'::jsonb,
  p_gpt_peer_id text default 'chatgpt:gpt-5.6-sol',
  p_glm_peer_id text default 'glm:5.3'
) returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','destruktion_meta','extensions'
as $$
declare
  s jsonb;
  r jsonb;
  v_duel_id uuid;
begin
  if jsonb_typeof(coalesce(p_subject,'{}'::jsonb)) <> 'object' then raise exception 'subject_must_be_object'; end if;
  if p_gpt_peer_id is null or length(trim(p_gpt_peer_id))<3 then raise exception 'gpt_peer_id_required'; end if;
  if p_glm_peer_id is null or length(trim(p_glm_peer_id))<3 then raise exception 'glm_peer_id_required'; end if;
  s := coalesce(p_subject,'{}'::jsonb) || jsonb_build_object(
    'peer_relay',true,
    'peer_relay_protocol','TWO_CHAT_AGENT_RELAY_V1',
    'peer_identities',jsonb_build_object('GPT',trim(p_gpt_peer_id),'GLM',trim(p_glm_peer_id)),
    'pending_payload_visibility','HIDDEN_UNTIL_ATOMIC_PAIR'
  );
  r := public.h205f22_duel_create_same_point_v4(
    p_duel_key,p_milestone_key,p_base_github_sha,s,'SOVEREIGN_ONLY',trim(p_gpt_peer_id),trim(p_glm_peer_id)
  );
  v_duel_id := (r->>'duel_id')::uuid;
  update destruktion_meta.compute_fabric_duel_session_h205f22
  set status='BLOCKED',lease_owner=null,lease_expires_at=null,updated_at=clock_timestamp()
  where duel_id=v_duel_id and current_tick=0;
  return public.h205f22_duel_read_peer_relay_v4(v_duel_id) || jsonb_build_object(
    'created',true,'relay_worker_policy','DB_ATOMIC_PAIR_ONLY','canonical',false,'authority_effect',false
  );
end $$;

revoke all on function public.h205f22_duel_create_peer_relay_v4(text,text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.h205f22_duel_create_peer_relay_v4(text,text,text,jsonb,text,text) to service_role;

create or replace function public.h205f22_duel_submit_peer_v4(
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
  gpt_row destruktion_meta.compute_fabric_duel_peer_submission_h205f22%rowtype;
  glm_row destruktion_meta.compute_fabric_duel_peer_submission_h205f22%rowtype;
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
  p_actor := upper(trim(coalesce(p_actor,'')));
  p_wave := upper(trim(coalesce(p_wave,'')));
  if p_actor not in ('GPT','GLM') then raise exception 'peer_actor_invalid'; end if;
  if p_wave not in ('PROPOSE','REBUT') then raise exception 'peer_wave_invalid'; end if;
  if p_seen_checkpoint_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'seen_checkpoint_invalid'; end if;
  if p_peer_id is null or length(trim(p_peer_id))<3 then raise exception 'peer_id_required'; end if;
  if p_actor='GPT' and trim(p_peer_id) not like 'chatgpt:%' then raise exception 'gpt_peer_id_prefix_required'; end if;
  if p_actor='GLM' and trim(p_peer_id) not like 'glm:%' then raise exception 'glm_peer_id_prefix_required'; end if;
  if p_lease_seconds<60 or p_lease_seconds>3600 then raise exception 'lease_seconds_out_of_range'; end if;
  if jsonb_typeof(coalesce(p_payload,'null'::jsonb)) <> 'object' then raise exception 'peer_payload_object_required'; end if;

  v_payload := p_payload || jsonb_build_object(
    'canonical',false,
    'authority_effect',false,
    '_peer_relay',jsonb_build_object('peer_id',trim(p_peer_id),'actor',p_actor,'wave',p_wave,'protocol','TWO_CHAT_AGENT_RELAY_V1')
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
    if v_payload->>'terminal_vote' not in ('WIN_GPT','WIN_GLM','SYNTHESIS','NO_ACTION') then raise exception 'rebut_terminal_vote_invalid'; end if;
  end if;
  v_payload := jsonb_set(v_payload,'{need_canary}',to_jsonb(coalesce((v_payload->>'need_canary')::boolean,false)),true);
  v_hash := encode(extensions.digest(convert_to(v_payload::text,'utf8'),'sha256'),'hex');

  select * into d from destruktion_meta.compute_fabric_duel_session_h205f22 where duel_id=p_duel_id for update;
  if not found then raise exception 'peer_relay_duel_not_found'; end if;
  if coalesce((d.subject->>'peer_relay')::boolean,false) is not true
     or d.subject->>'debate_protocol' <> 'SAME_POINT_DUEL_V4'
     or d.subject->>'peer_relay_protocol' <> 'TWO_CHAT_AGENT_RELAY_V1' then raise exception 'not_peer_relay_v4'; end if;
  if d.protocol_version <> 'LOCKSTEP_V2' or d.max_ticks <> 2 then raise exception 'peer_relay_protocol_mismatch'; end if;
  if (d.subject->'peer_identities'->>p_actor) is distinct from trim(p_peer_id) then raise exception 'peer_identity_mismatch'; end if;

  select * into existing
  from destruktion_meta.compute_fabric_duel_peer_submission_h205f22
  where duel_id=p_duel_id and wave=p_wave and actor=p_actor;
  if found then
    if existing.payload_sha256 <> v_hash or existing.seen_checkpoint_sha256 <> p_seen_checkpoint_sha256
       or existing.peer_id <> trim(p_peer_id) then raise exception 'peer_submission_conflict'; end if;
    return public.h205f22_duel_read_peer_relay_v4(p_duel_id) || jsonb_build_object(
      'submission_replayed',true,'actor',p_actor,'wave',p_wave,'payload_sha256',v_hash,'canonical',false,'authority_effect',false
    );
  end if;

  v_expected_tick := case when p_wave='PROPOSE' then 0 else 1 end;
  if d.current_tick <> v_expected_tick then raise exception 'peer_wave_stale_tick:%:%',d.current_tick,p_wave; end if;
  if d.current_checkpoint_sha256 <> p_seen_checkpoint_sha256 then raise exception 'peer_seen_checkpoint_stale'; end if;

  if p_wave='REBUT' then
    select event_sha256 into v_expected_peer_hash
    from destruktion_meta.compute_fabric_duel_event_h205f22
    where duel_id=p_duel_id and tick_no=1 and actor=(case when p_actor='GPT' then 'GLM' else 'GPT' end)
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

  v_relay_worker := 'sovereign:v4:peer-relay:'||p_duel_id::text;
  v_lease := public.h205f22_duel_lease_target_lockstep_v3(p_duel_id,v_relay_worker,p_lease_seconds,0);
  if coalesce((v_lease->>'leased')::boolean,false) is not true then
    raise exception 'peer_relay_lease_failed:%',coalesce(v_lease->>'reason','UNKNOWN');
  end if;
  v_generation := (v_lease->>'lease_generation')::bigint;

  insert into destruktion_meta.compute_fabric_duel_peer_submission_h205f22(
    duel_id,wave,actor,peer_id,seen_checkpoint_sha256,payload,payload_sha256
  ) values(p_duel_id,p_wave,p_actor,trim(p_peer_id),p_seen_checkpoint_sha256,v_payload,v_hash);

  select count(*) into v_count
  from destruktion_meta.compute_fabric_duel_peer_submission_h205f22
  where duel_id=p_duel_id and wave=p_wave;

  if v_count < 2 then
    update destruktion_meta.compute_fabric_duel_session_h205f22
    set status='BLOCKED',lease_owner=null,lease_expires_at=null,updated_at=clock_timestamp()
    where duel_id=p_duel_id;
    return public.h205f22_duel_read_peer_relay_v4(p_duel_id) || jsonb_build_object(
      'submission_accepted',true,'pair_committed',false,'actor',p_actor,'wave',p_wave,
      'payload_sha256',v_hash,'canonical',false,'authority_effect',false
    );
  end if;

  select * into gpt_row from destruktion_meta.compute_fabric_duel_peer_submission_h205f22
   where duel_id=p_duel_id and wave=p_wave and actor='GPT';
  select * into glm_row from destruktion_meta.compute_fabric_duel_peer_submission_h205f22
   where duel_id=p_duel_id and wave=p_wave and actor='GLM';
  if gpt_row.submission_id is null or glm_row.submission_id is null then raise exception 'peer_pair_incomplete'; end if;
  if gpt_row.seen_checkpoint_sha256 <> glm_row.seen_checkpoint_sha256
     or gpt_row.seen_checkpoint_sha256 <> p_seen_checkpoint_sha256 then raise exception 'peer_pair_checkpoint_mismatch'; end if;

  if p_wave='PROPOSE' then
    v_receipt := public.h205f22_duel_submit_pair_v3(
      p_duel_id,v_relay_worker,v_generation,1,p_seen_checkpoint_sha256,
      gpt_row.payload->>'step_type',gpt_row.payload,glm_row.payload->>'step_type',glm_row.payload
    );
    update destruktion_meta.compute_fabric_duel_session_h205f22
    set status='BLOCKED',lease_owner=null,lease_expires_at=null,updated_at=clock_timestamp()
    where duel_id=p_duel_id and current_tick=1;
    v_read := public.h205f22_duel_read_peer_relay_v4(p_duel_id);
    return v_read || jsonb_build_object(
      'submission_accepted',true,'pair_committed',true,'wave','PROPOSE','pair',v_receipt,
      'canonical',false,'authority_effect',false
    );
  end if;

  v_receipt := public.h205f22_duel_submit_rebut_finalize_v4(
    p_duel_id,v_relay_worker,v_generation,p_seen_checkpoint_sha256,
    gpt_row.payload->>'step_type',gpt_row.payload,glm_row.payload->>'step_type',glm_row.payload
  );
  return public.h205f22_duel_read_peer_relay_v4(p_duel_id) || jsonb_build_object(
    'submission_accepted',true,'pair_committed',true,'wave','REBUT','finalize',v_receipt,
    'canonical',false,'authority_effect',false
  );
end $$;

revoke all on function public.h205f22_duel_submit_peer_v4(uuid,text,text,text,jsonb,text,integer) from public,anon,authenticated;
grant execute on function public.h205f22_duel_submit_peer_v4(uuid,text,text,text,jsonb,text,integer) to service_role;
