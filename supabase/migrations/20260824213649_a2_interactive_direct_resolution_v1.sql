alter table destruktion_meta.compute_fabric_a2_interactive_round_h205f22
  add column if not exists gpt_resolution_payload jsonb,
  add column if not exists glm_resolution_payload jsonb,
  add column if not exists gpt_resolution_action_sha256 text check (gpt_resolution_action_sha256 is null or gpt_resolution_action_sha256 ~ '^[0-9a-f]{64}$'),
  add column if not exists glm_resolution_action_sha256 text check (glm_resolution_action_sha256 is null or glm_resolution_action_sha256 ~ '^[0-9a-f]{64}$'),
  add column if not exists resolution_exhausted boolean not null default false;

create or replace function public.h205f22_a2_interactive_round_direct_resolution_v1(p_round_id uuid,p_agent text,p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path='pg_catalog','destruktion_meta','extensions'
as $$
declare r destruktion_meta.compute_fabric_a2_interactive_round_h205f22%rowtype; action_sha text;
begin
  if p_agent not in ('GPT','GLM') then raise exception 'a2_interactive_round_agent_invalid'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or not (p_payload?'action') then raise exception 'a2_interactive_round_resolution_invalid'; end if;
  select * into r from destruktion_meta.compute_fabric_a2_interactive_round_h205f22 where round_id=p_round_id for update;
  if not found then raise exception 'a2_interactive_round_not_found'; end if;
  if r.state<>'DISPUTED' or r.resolution_exhausted then raise exception 'a2_interactive_round_resolution_closed'; end if;
  if p_agent='GPT' and r.gpt_resolution_payload is not null then raise exception 'a2_interactive_round_gpt_resolution_already_submitted'; end if;
  if p_agent='GLM' and r.glm_resolution_payload is not null then raise exception 'a2_interactive_round_glm_resolution_already_submitted'; end if;
  action_sha:=encode(extensions.digest(convert_to((p_payload->'action')::text,'UTF8'),'sha256'),'hex');
  perform set_config('metaengine.a2_interactive_round_rpc','on',true);
  update destruktion_meta.compute_fabric_a2_interactive_round_h205f22
  set gpt_resolution_payload=case when p_agent='GPT' then p_payload else gpt_resolution_payload end,
      glm_resolution_payload=case when p_agent='GLM' then p_payload else glm_resolution_payload end,
      gpt_resolution_action_sha256=case when p_agent='GPT' then action_sha else gpt_resolution_action_sha256 end,
      glm_resolution_action_sha256=case when p_agent='GLM' then action_sha else glm_resolution_action_sha256 end
  where round_id=p_round_id returning * into r;
  if r.gpt_resolution_payload is not null and r.glm_resolution_payload is not null then
    if r.gpt_resolution_action_sha256=r.glm_resolution_action_sha256 then
      update destruktion_meta.compute_fabric_a2_interactive_round_h205f22
      set state='DECIDED',decided_action_sha256=r.gpt_resolution_action_sha256,resolution_exhausted=false
      where round_id=p_round_id returning * into r;
    else
      update destruktion_meta.compute_fabric_a2_interactive_round_h205f22
      set resolution_exhausted=true
      where round_id=p_round_id returning * into r;
    end if;
  end if;
  return jsonb_build_object('schema','metaengine.compute.a2-interactive-direct-resolution.v1','round_id',r.round_id,'state',r.state,'gpt_resolution_submitted',r.gpt_resolution_payload is not null,'glm_resolution_submitted',r.glm_resolution_payload is not null,'resolution_exhausted',r.resolution_exhausted,'gpt_resolution_action_sha256',r.gpt_resolution_action_sha256,'glm_resolution_action_sha256',r.glm_resolution_action_sha256,'decided_action_sha256',r.decided_action_sha256,'canonical',false,'authority_effect',false);
end $$;

create or replace function public.h205f22_a2_interactive_round_read_v1(p_round_id uuid)
returns jsonb language plpgsql stable security definer
set search_path='pg_catalog','destruktion_meta'
as $$
declare r destruktion_meta.compute_fabric_a2_interactive_round_h205f22%rowtype; reveal_visible boolean;
begin
  select * into r from destruktion_meta.compute_fabric_a2_interactive_round_h205f22 where round_id=p_round_id;
  if not found then raise exception 'a2_interactive_round_not_found'; end if;
  reveal_visible:=r.state in ('CHALLENGE_OPEN','DECIDE_OPEN','DECIDED','DISPUTED','ABANDONED');
  return jsonb_build_object(
    'schema','metaengine.compute.a2-interactive-dual-round.v1','round_id',r.round_id,'workspace_id',r.workspace_id,'semantic_point',r.semantic_point,
    'start_snapshot_sha256',r.start_snapshot_sha256,'base_message_seq',r.base_message_seq,'base_message_hash',r.base_message_hash,'state',r.state,
    'gpt_commitment_sha256',r.gpt_commitment_sha256,'glm_commitment_sha256',r.glm_commitment_sha256,
    'gpt_reveal_sha256',case when reveal_visible then r.gpt_reveal_sha256 else null end,'glm_reveal_sha256',case when reveal_visible then r.glm_reveal_sha256 else null end,
    'gpt_reveal_payload',case when reveal_visible then r.gpt_reveal_payload else null end,'glm_reveal_payload',case when reveal_visible then r.glm_reveal_payload else null end,
    'gpt_challenge_target_sha256',r.gpt_challenge_target_sha256,'glm_challenge_target_sha256',r.glm_challenge_target_sha256,
    'gpt_challenge_payload',r.gpt_challenge_payload,'glm_challenge_payload',r.glm_challenge_payload,
    'gpt_decision_payload',r.gpt_decision_payload,'glm_decision_payload',r.glm_decision_payload,
    'gpt_action_sha256',r.gpt_action_sha256,'glm_action_sha256',r.glm_action_sha256,
    'gpt_resolution_payload',r.gpt_resolution_payload,'glm_resolution_payload',r.glm_resolution_payload,
    'gpt_resolution_action_sha256',r.gpt_resolution_action_sha256,'glm_resolution_action_sha256',r.glm_resolution_action_sha256,
    'resolution_exhausted',r.resolution_exhausted,'decided_action_sha256',r.decided_action_sha256,
    'canonical',false,'authority_effect',false,'created_at',r.created_at,'updated_at',r.updated_at
  );
end $$;

revoke all on function public.h205f22_a2_interactive_round_direct_resolution_v1(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.h205f22_a2_interactive_round_direct_resolution_v1(uuid,text,jsonb) to service_role;
