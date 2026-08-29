-- A2 model-authored cognition is accepted only while the workspace is COLLABORATE.
-- Runtime/system telemetry remains admissible during DUEL/PAUSED so observers can see transitions.
create or replace function public.h205f22_a2_emit_agent_event_v1(
  p_event_id uuid,p_session_id uuid,p_agent_seq bigint,p_semantic_point text,
  p_event_type text,p_priority smallint,p_parent_hashes text[],p_payload jsonb,
  p_visibility_proof_id uuid,p_model_provenance jsonb,p_event_hash text,
  p_signature_base64 text,p_signature_key_fingerprint_sha256 text,p_signature_verified boolean
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,destruktion_meta,extensions
as $$
declare
  s destruktion_meta.compute_fabric_a2_peer_session_h205f22%rowtype;
  prep jsonb;
  e destruktion_meta.compute_fabric_a2_agent_event_h205f22%rowtype;
  v destruktion_meta.compute_fabric_a2_visibility_proof_h205f22%rowtype;
  model_authored boolean;
  sig_bytes bytea;
  allowed boolean;
  reported text;
  requested text;
  workspace_mode text;
begin
  if p_signature_verified is distinct from true then raise exception 'a2_signature_not_verified_by_ingress'; end if;
  allowed:=p_event_type in ('PLAN','HYPOTHESIS','CLAIM','COUNTERCLAIM','QUESTION','EVIDENCE','ASSUMPTION','FALSIFIER','CRITIQUE','AGREEMENT','SYNTHESIS','ACTION_PROPOSAL','REQUEST_DUEL','MODEL_STARTED','MODEL_COMPLETED','MODEL_INTERRUPTED','PEER_EVENT_APPLIED','TOOL_CALL','TOOL_RESULT','TOOL_ERROR','FILE_READ','PATCH_CREATED','TEST_STARTED','TEST_RESULT','AUTHORITY_READ','AUTHORITY_DRIFT','BACKPRESSURE','CATCH_UP_STARTED','CATCH_UP_COMPLETED','CHECKPOINT','ERROR','DUEL_OPENED','DUEL_DECIDED');
  if not allowed then raise exception 'a2_event_type_invalid:%',p_event_type; end if;
  model_authored:=p_event_type in ('PLAN','HYPOTHESIS','CLAIM','COUNTERCLAIM','QUESTION','EVIDENCE','ASSUMPTION','FALSIFIER','CRITIQUE','AGREEMENT','SYNTHESIS','ACTION_PROPOSAL','REQUEST_DUEL');

  select * into s from destruktion_meta.compute_fabric_a2_peer_session_h205f22 where session_id=p_session_id and status='ACTIVE';
  if not found then raise exception 'a2_session_not_active'; end if;
  perform pg_advisory_xact_lock(hashtextextended(s.workspace_id::text,205022));

  select mode into workspace_mode from destruktion_meta.compute_fabric_a2_workspace_h205f22 where workspace_id=s.workspace_id;
  if workspace_mode is null then raise exception 'a2_workspace_not_found'; end if;
  if model_authored and workspace_mode<>'COLLABORATE' then
    raise exception 'a2_model_event_workspace_not_collaborating:%',workspace_mode;
  end if;

  if p_signature_key_fingerprint_sha256<>s.key_fingerprint_sha256 then raise exception 'a2_signature_key_mismatch'; end if;
  requested:=coalesce(p_model_provenance->>'requested_model','');
  reported:=coalesce(p_model_provenance->>'reported_model','');
  if requested<>'' and requested<>s.requested_model then raise exception 'a2_requested_model_provenance_mismatch'; end if;
  if reported<>'' and reported<>s.requested_model then raise exception 'a2_reported_model_provenance_mismatch'; end if;
  begin sig_bytes:=decode(p_signature_base64,'base64'); exception when others then raise exception 'a2_signature_base64_invalid'; end;
  if octet_length(sig_bytes)<>64 then raise exception 'a2_ed25519_signature_length_invalid'; end if;

  prep:=public.h205f22_a2_prepare_event_v1(p_event_id,p_session_id,p_agent_seq,p_semantic_point,p_event_type,p_priority,p_parent_hashes,p_payload,p_visibility_proof_id,p_model_provenance);
  if prep->>'event_hash'<>p_event_hash then raise exception 'a2_event_hash_mismatch'; end if;
  if model_authored and p_visibility_proof_id is null then raise exception 'a2_model_event_visibility_proof_required'; end if;
  if model_authored then
    select * into v from destruktion_meta.compute_fabric_a2_visibility_proof_h205f22
    where proof_id=p_visibility_proof_id and session_id=p_session_id and accepted_event_id is null for update;
    if not found then raise exception 'a2_visibility_proof_already_used_or_invalid'; end if;
    if exists(select 1 from destruktion_meta.compute_fabric_a2_agent_event_h205f22 x where x.workspace_id=s.workspace_id and x.agent<>s.agent and x.priority<=1 and x.commit_seq>v.seen_commit_seq) then
      raise exception 'a2_model_event_stale_frontier';
    end if;
  end if;

  perform set_config('metaengine.a2_rpc','on',true);
  insert into destruktion_meta.compute_fabric_a2_agent_event_h205f22(
    event_id,workspace_id,session_id,agent,agent_seq,semantic_point,event_type,priority,parent_hashes,payload,payload_sha256,event_hash,signature_base64,signature_key_fingerprint_sha256,signature_verification_mode,visibility_proof_id,model_provenance
  ) values(
    p_event_id,s.workspace_id,s.session_id,s.agent,p_agent_seq,p_semantic_point,p_event_type,p_priority,coalesce(p_parent_hashes,'{}'::text[]),coalesce(p_payload,'{}'::jsonb),prep->>'payload_sha256',p_event_hash,p_signature_base64,p_signature_key_fingerprint_sha256,'TRUSTED_INGRESS_ED25519_V1',p_visibility_proof_id,coalesce(p_model_provenance,'{}'::jsonb)
  ) returning * into e;
  if model_authored then update destruktion_meta.compute_fabric_a2_visibility_proof_h205f22 set accepted_event_id=e.event_id where proof_id=p_visibility_proof_id; end if;
  update destruktion_meta.compute_fabric_a2_peer_session_h205f22 set last_seen_at=clock_timestamp() where session_id=p_session_id;
  return jsonb_build_object('schema','metaengine.compute.a2-agent-event.v1','event_id',e.event_id,'commit_seq',e.commit_seq,'workspace_id',e.workspace_id,'agent',e.agent,'agent_seq',e.agent_seq,'event_type',e.event_type,'priority',e.priority,'event_hash',e.event_hash,'visibility_proof_id',e.visibility_proof_id,'canonical',false,'authority_effect',false);
end $$;
