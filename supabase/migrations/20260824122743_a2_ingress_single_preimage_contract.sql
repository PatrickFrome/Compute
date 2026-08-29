-- A2 trusted ingress: use one DB-native canonical receipt preimage for both ingress and emit verification.
create or replace function destruktion_meta.compute_fabric_a2_ingress_receipt_preimage_v2(
  p_event_hash text,
  p_session_id uuid,
  p_signature_key_fingerprint_sha256 text,
  p_ingress_verifier_id text,
  p_ingress_issued_at timestamptz,
  p_ingress_expires_at timestamptz,
  p_ingress_nonce text,
  p_signature_sha256 text
) returns text
language sql
stable
set search_path=pg_catalog
as $$
  select concat_ws(E'\n',
    'A2_INGRESS_RECEIPT_V2',
    p_event_hash,
    p_session_id::text,
    p_signature_key_fingerprint_sha256,
    p_ingress_verifier_id,
    extract(epoch from p_ingress_issued_at)::numeric::text,
    extract(epoch from p_ingress_expires_at)::numeric::text,
    p_ingress_nonce,
    p_signature_sha256
  )
$$;

revoke all on function destruktion_meta.compute_fabric_a2_ingress_receipt_preimage_v2(text,uuid,text,text,timestamptz,timestamptz,text,text)
from public,anon,authenticated,service_role,a2_peer_runtime;

create or replace function public.h205f22_a2_emit_agent_event_v3(
  p_event_id uuid,p_session_id uuid,p_agent_seq bigint,p_semantic_point text,
  p_event_type text,p_priority smallint,p_parent_hashes text[],p_payload jsonb,
  p_visibility_proof_id uuid,p_model_provenance jsonb,p_event_hash text,
  p_signature_base64 text,p_signature_key_fingerprint_sha256 text,
  p_ingress_verifier_id text,p_ingress_issued_at timestamptz,
  p_ingress_expires_at timestamptz,p_ingress_nonce text,p_ingress_hmac_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,destruktion_meta,extensions,vault
as $$
declare
  v_secret text; v_message text; v_expected_hmac text; v_signature_sha256 text;
  v_receipt_id uuid; v_emitted jsonb; v_now timestamptz:=clock_timestamp();
begin
  if p_ingress_verifier_id<>'A2_TRUSTED_ED25519_INGRESS_V2' then raise exception 'a2_ingress_verifier_invalid'; end if;
  if p_ingress_nonce is null or p_ingress_nonce !~ '^[0-9a-f]{32,128}$' then raise exception 'a2_ingress_nonce_invalid'; end if;
  if p_ingress_hmac_sha256 is null or p_ingress_hmac_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'a2_ingress_hmac_invalid'; end if;
  if p_signature_base64 is null or octet_length(decode(p_signature_base64,'base64'))<>64 then raise exception 'a2_ed25519_signature_length_invalid'; end if;
  if p_ingress_issued_at>v_now+interval '30 seconds' or p_ingress_issued_at<v_now-interval '2 minutes' or p_ingress_expires_at<=v_now or p_ingress_expires_at>p_ingress_issued_at+interval '2 minutes' then raise exception 'a2_ingress_receipt_expired_or_invalid'; end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name='a2_ingress_hmac_v1' order by created_at desc limit 1;
  if v_secret is null or length(v_secret)<32 then raise exception 'a2_ingress_secret_unavailable'; end if;
  v_signature_sha256:=encode(extensions.digest(decode(p_signature_base64,'base64'),'sha256'),'hex');
  v_message:=destruktion_meta.compute_fabric_a2_ingress_receipt_preimage_v2(
    p_event_hash,p_session_id,p_signature_key_fingerprint_sha256,p_ingress_verifier_id,
    p_ingress_issued_at,p_ingress_expires_at,p_ingress_nonce,v_signature_sha256
  );
  v_expected_hmac:=encode(extensions.hmac(convert_to(v_message,'UTF8'),convert_to(v_secret,'UTF8'),'sha256'),'hex');
  if decode(v_expected_hmac,'hex')<>decode(lower(p_ingress_hmac_sha256),'hex') then raise exception 'a2_ingress_hmac_mismatch'; end if;

  perform set_config('metaengine.a2_rpc','on',true);
  insert into destruktion_meta.compute_fabric_a2_ingress_receipt_h205f22(
    event_hash,session_id,signature_key_fingerprint_sha256,verifier_id,issued_at,expires_at,nonce,hmac_sha256,signature_sha256
  ) values(
    p_event_hash,p_session_id,p_signature_key_fingerprint_sha256,p_ingress_verifier_id,p_ingress_issued_at,p_ingress_expires_at,p_ingress_nonce,lower(p_ingress_hmac_sha256),v_signature_sha256
  ) returning receipt_id into v_receipt_id;
  v_emitted:=public.h205f22_a2_emit_agent_event_v1(
    p_event_id,p_session_id,p_agent_seq,p_semantic_point,p_event_type,p_priority,p_parent_hashes,p_payload,
    p_visibility_proof_id,p_model_provenance,p_event_hash,p_signature_base64,p_signature_key_fingerprint_sha256,true
  );
  update destruktion_meta.compute_fabric_a2_ingress_receipt_h205f22
  set consumed_event_id=(v_emitted->>'event_id')::uuid where receipt_id=v_receipt_id;
  return v_emitted||jsonb_build_object(
    'ingress_verification','A2_TRUSTED_ED25519_INGRESS_V2',
    'ingress_receipt_id',v_receipt_id,
    'signature_sha256',v_signature_sha256,
    'signature_bound',true
  );
end $$;
