create or replace function public.h205f22_a2_ingress_session_identity_v1(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,destruktion_meta
as $$
declare s destruktion_meta.compute_fabric_a2_peer_session_h205f22%rowtype;
begin
  select * into s from destruktion_meta.compute_fabric_a2_peer_session_h205f22 where session_id=p_session_id;
  if not found then raise exception 'a2_ingress_session_not_found'; end if;
  return jsonb_build_object(
    'schema','metaengine.compute.a2-ingress-session-identity.v1',
    'session_id',s.session_id,'workspace_id',s.workspace_id,'agent',s.agent,
    'requested_model',s.requested_model,'runtime_id',s.runtime_id,
    'public_key_alg',s.public_key_alg,'public_key_base64',s.public_key_base64,
    'key_fingerprint_sha256',s.key_fingerprint_sha256,'status',s.status,
    'lease_expires_at',s.lease_expires_at,'canonical',false,'authority_effect',false
  );
end $$;

create or replace function public.h205f22_a2_ingress_emit_edge_verified_v1(
  p_event_id uuid,
  p_session_id uuid,
  p_agent_seq bigint,
  p_semantic_point text,
  p_event_type text,
  p_priority smallint,
  p_parent_hashes text[],
  p_payload jsonb,
  p_visibility_proof_id uuid,
  p_model_provenance jsonb,
  p_event_hash text,
  p_signature_base64 text,
  p_signature_key_fingerprint_sha256 text,
  p_ed25519_verified boolean,
  p_edge_verifier_id text
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,destruktion_meta,extensions,vault
as $$
declare
  v_secret text;
  v_signature_sha256 text;
  v_issued timestamptz:=clock_timestamp();
  v_expires timestamptz;
  v_nonce text;
  v_preimage text;
  v_hmac text;
  v_result jsonb;
begin
  if p_ed25519_verified is distinct from true then raise exception 'a2_edge_ed25519_verification_required'; end if;
  if p_edge_verifier_id<>'A2_EDGE_WEBCRYPTO_ED25519_V1' then raise exception 'a2_edge_verifier_invalid'; end if;
  if p_event_hash is null or p_event_hash !~ '^[0-9a-f]{64}$' then raise exception 'a2_event_hash_invalid'; end if;
  if p_signature_key_fingerprint_sha256 is null or p_signature_key_fingerprint_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'a2_signature_key_fingerprint_invalid'; end if;
  if p_signature_base64 is null or octet_length(decode(p_signature_base64,'base64'))<>64 then raise exception 'a2_ed25519_signature_length_invalid'; end if;

  perform 1 from destruktion_meta.compute_fabric_a2_peer_session_h205f22 s
  where s.session_id=p_session_id and s.status='ACTIVE' and s.lease_expires_at>v_issued
    and s.key_fingerprint_sha256=p_signature_key_fingerprint_sha256;
  if not found then raise exception 'a2_ingress_session_not_active_or_lease_expired'; end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets
  where name='a2_ingress_hmac_v1' order by created_at desc limit 1;
  if v_secret is null or length(v_secret)<32 then raise exception 'a2_ingress_secret_unavailable'; end if;

  v_signature_sha256:=encode(extensions.digest(decode(p_signature_base64,'base64'),'sha256'),'hex');
  v_expires:=v_issued+interval '60 seconds';
  v_nonce:=encode(extensions.gen_random_bytes(24),'hex');
  v_preimage:=destruktion_meta.compute_fabric_a2_ingress_receipt_preimage_v2(
    p_event_hash,p_session_id,p_signature_key_fingerprint_sha256,'A2_TRUSTED_ED25519_INGRESS_V2',
    v_issued,v_expires,v_nonce,v_signature_sha256
  );
  v_hmac:=encode(extensions.hmac(convert_to(v_preimage,'UTF8'),convert_to(v_secret,'UTF8'),'sha256'),'hex');

  v_result:=public.h205f22_a2_emit_agent_event_v3(
    p_event_id,p_session_id,p_agent_seq,p_semantic_point,p_event_type,p_priority,
    p_parent_hashes,p_payload,p_visibility_proof_id,p_model_provenance,p_event_hash,
    p_signature_base64,p_signature_key_fingerprint_sha256,'A2_TRUSTED_ED25519_INGRESS_V2',
    v_issued,v_expires,v_nonce,v_hmac
  );
  return v_result||jsonb_build_object(
    'edge_verifier_id',p_edge_verifier_id,
    'edge_ed25519_verified',true,
    'canonical',false,'authority_effect',false
  );
end $$;

revoke all on function public.h205f22_a2_ingress_session_identity_v1(uuid) from public,anon,authenticated,a2_peer_runtime;
revoke all on function public.h205f22_a2_ingress_emit_edge_verified_v1(uuid,uuid,bigint,text,text,smallint,text[],jsonb,uuid,jsonb,text,text,text,boolean,text) from public,anon,authenticated,a2_peer_runtime;
grant execute on function public.h205f22_a2_ingress_session_identity_v1(uuid) to service_role;
grant execute on function public.h205f22_a2_ingress_emit_edge_verified_v1(uuid,uuid,bigint,text,text,smallint,text[],jsonb,uuid,jsonb,text,text,text,boolean,text) to service_role;

comment on function public.h205f22_a2_ingress_emit_edge_verified_v1(uuid,uuid,bigint,text,text,smallint,text[],jsonb,uuid,jsonb,text,text,text,boolean,text) is
  'Service-role-only bridge from Edge WebCrypto Ed25519 verification to the existing signature-bound A2 ingress receipt; Vault HMAC secret never leaves Postgres.';
