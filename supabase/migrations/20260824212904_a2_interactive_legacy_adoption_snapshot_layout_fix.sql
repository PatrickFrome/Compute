create or replace function public.h205f22_a2_interactive_round_adopt_legacy_reveal_v1(
  p_round_id uuid, p_agent text, p_seal_message_hash text, p_reveal_message_hash text
) returns jsonb language plpgsql security definer
set search_path='pg_catalog','destruktion_meta','extensions'
as $$
declare
  r destruktion_meta.compute_fabric_a2_interactive_round_h205f22%rowtype;
  s destruktion_meta.compute_fabric_a2_interactive_message_h205f22%rowtype;
  v destruktion_meta.compute_fabric_a2_interactive_message_h205f22%rowtype;
  legacy_commit text; formal_commit text; reveal_sha text; nonce text; proposal jsonb; reveal_snapshot text;
begin
  if p_agent not in ('GPT','GLM') then raise exception 'a2_interactive_round_agent_invalid'; end if;
  select * into r from destruktion_meta.compute_fabric_a2_interactive_round_h205f22 where round_id=p_round_id for update;
  if not found then raise exception 'a2_interactive_round_not_found'; end if;
  if r.state not in ('COMMIT_OPEN','REVEAL_OPEN') then raise exception 'a2_interactive_round_legacy_adoption_closed:%',r.state; end if;
  select * into s from destruktion_meta.compute_fabric_a2_interactive_message_h205f22 where workspace_id=r.workspace_id and message_hash=p_seal_message_hash and agent=p_agent;
  if not found then raise exception 'a2_interactive_round_legacy_seal_missing'; end if;
  select * into v from destruktion_meta.compute_fabric_a2_interactive_message_h205f22 where workspace_id=r.workspace_id and message_hash=p_reveal_message_hash and agent=p_agent;
  if not found then raise exception 'a2_interactive_round_legacy_reveal_missing'; end if;
  if s.message_type<>'CHECKPOINT' or s.payload->>'kind'<>'BLIND_PROPOSE_SEAL' or coalesce((s.payload->>'proposal_hidden')::boolean,false) is not true then raise exception 'a2_interactive_round_legacy_seal_invalid'; end if;
  if v.message_type<>'PLAN' or v.payload->>'kind'<>'PROPOSE_REVEAL' then raise exception 'a2_interactive_round_legacy_reveal_invalid'; end if;
  proposal:=v.payload->'proposal'; nonce:=v.payload->>'nonce';
  if proposal is null or jsonb_typeof(proposal)<>'object' or nullif(nonce,'') is null then raise exception 'a2_interactive_round_legacy_payload_invalid'; end if;
  reveal_snapshot:=coalesce(v.payload->>'start_snapshot_sha256',proposal->>'start_snapshot_sha256');
  if s.payload->>'start_snapshot_sha256' is distinct from r.start_snapshot_sha256 or reveal_snapshot is distinct from r.start_snapshot_sha256 then raise exception 'a2_interactive_round_legacy_snapshot_mismatch'; end if;
  if v.payload#>>'{responds_to_seal,hash}' is distinct from s.message_hash then raise exception 'a2_interactive_round_legacy_parent_mismatch'; end if;
  legacy_commit:=encode(extensions.digest(convert_to(destruktion_meta.compute_fabric_jsonb_canonical_compact_v1(jsonb_build_object('proposal',proposal,'nonce',nonce)),'UTF8'),'sha256'),'hex');
  if legacy_commit is distinct from s.payload->>'proposal_commitment_sha256' then raise exception 'a2_interactive_round_legacy_commitment_mismatch'; end if;
  if v.payload#>>'{commitment_verification,published_commitment}' is distinct from legacy_commit or v.payload#>>'{commitment_verification,recomputed_before_submit}' is distinct from legacy_commit then raise exception 'a2_interactive_round_legacy_reveal_verification_mismatch'; end if;
  formal_commit:=public.h205f22_a2_interactive_commitment_v1(proposal,nonce);
  reveal_sha:=encode(extensions.digest(convert_to(proposal::text,'UTF8'),'sha256'),'hex');
  if p_agent='GPT' and r.gpt_commitment_sha256 is not null and r.gpt_commitment_sha256<>formal_commit then raise exception 'a2_interactive_round_gpt_commitment_conflict'; end if;
  if p_agent='GLM' and r.glm_commitment_sha256 is not null and r.glm_commitment_sha256<>formal_commit then raise exception 'a2_interactive_round_glm_commitment_conflict'; end if;
  perform set_config('metaengine.a2_interactive_round_rpc','on',true);
  update destruktion_meta.compute_fabric_a2_interactive_round_h205f22
  set gpt_commitment_sha256=case when p_agent='GPT' then formal_commit else gpt_commitment_sha256 end,
      glm_commitment_sha256=case when p_agent='GLM' then formal_commit else glm_commitment_sha256 end,
      gpt_adopted_source_hashes=case when p_agent='GPT' then array[p_seal_message_hash,p_reveal_message_hash] else gpt_adopted_source_hashes end,
      glm_adopted_source_hashes=case when p_agent='GLM' then array[p_seal_message_hash,p_reveal_message_hash] else glm_adopted_source_hashes end
  where round_id=p_round_id returning * into r;
  if r.gpt_commitment_sha256 is not null and r.glm_commitment_sha256 is not null and r.state='COMMIT_OPEN' then
    update destruktion_meta.compute_fabric_a2_interactive_round_h205f22 set state='REVEAL_OPEN' where round_id=p_round_id returning * into r;
  end if;
  if r.state<>'REVEAL_OPEN' then raise exception 'a2_interactive_round_legacy_reveal_not_open:%',r.state; end if;
  update destruktion_meta.compute_fabric_a2_interactive_round_h205f22
  set gpt_reveal_payload=case when p_agent='GPT' then proposal else gpt_reveal_payload end,
      glm_reveal_payload=case when p_agent='GLM' then proposal else glm_reveal_payload end,
      gpt_reveal_nonce=case when p_agent='GPT' then nonce else gpt_reveal_nonce end,
      glm_reveal_nonce=case when p_agent='GLM' then nonce else glm_reveal_nonce end,
      gpt_reveal_sha256=case when p_agent='GPT' then reveal_sha else gpt_reveal_sha256 end,
      glm_reveal_sha256=case when p_agent='GLM' then reveal_sha else glm_reveal_sha256 end
  where round_id=p_round_id returning * into r;
  if r.gpt_reveal_payload is not null and r.glm_reveal_payload is not null then
    update destruktion_meta.compute_fabric_a2_interactive_round_h205f22 set state='CHALLENGE_OPEN' where round_id=p_round_id returning * into r;
  end if;
  return jsonb_build_object('schema','metaengine.compute.a2-interactive-legacy-adoption.v1','round_id',r.round_id,'state',r.state,'agent',p_agent,'legacy_commitment_sha256',legacy_commit,'formal_commitment_sha256',formal_commit,'reveal_sha256',reveal_sha,'source_message_hashes',array[p_seal_message_hash,p_reveal_message_hash],'canonical',false,'authority_effect',false);
end $$;
