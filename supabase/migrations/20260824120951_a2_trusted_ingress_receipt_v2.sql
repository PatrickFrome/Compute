-- A2 trusted ingress hardening.
-- The peer runtime verifies Ed25519 locally, the trusted ingress issues a short-lived HMAC receipt,
-- and Postgres verifies that receipt before internally calling the legacy emit primitive.
-- A2 remains non-authority throughout.

do $$
begin
  if not exists (select 1 from vault.secrets where name='a2_ingress_hmac_v1') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32),'hex'),
      'a2_ingress_hmac_v1',
      'A2 trusted ingress HMAC key; never expose to peer runtimes or observer UI',
      null
    );
  end if;
end $$;

create table if not exists destruktion_meta.compute_fabric_a2_ingress_receipt_h205f22 (
  receipt_id uuid primary key default extensions.gen_random_uuid(),
  event_hash text not null unique check (event_hash ~ '^[0-9a-f]{64}$'),
  session_id uuid not null references destruktion_meta.compute_fabric_a2_peer_session_h205f22(session_id) on delete cascade,
  signature_key_fingerprint_sha256 text not null check (signature_key_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  verifier_id text not null check (verifier_id='A2_TRUSTED_ED25519_INGRESS_V1'),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  nonce text not null unique check (nonce ~ '^[0-9a-f]{32,128}$'),
  hmac_sha256 text not null check (hmac_sha256 ~ '^[0-9a-f]{64}$'),
  consumed_event_id uuid references destruktion_meta.compute_fabric_a2_agent_event_h205f22(event_id),
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists compute_fabric_a2_ingress_receipt_session_idx
  on destruktion_meta.compute_fabric_a2_ingress_receipt_h205f22(session_id,created_at desc);

drop trigger if exists trg_a2_guard_ingress_receipt on destruktion_meta.compute_fabric_a2_ingress_receipt_h205f22;
create trigger trg_a2_guard_ingress_receipt
before insert or update or delete on destruktion_meta.compute_fabric_a2_ingress_receipt_h205f22
for each row execute function destruktion_meta.compute_fabric_a2_guard_write_h205f22();

create or replace function public.h205f22_a2_emit_agent_event_v2(
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
  p_ingress_verifier_id text,
  p_ingress_issued_at timestamptz,
  p_ingress_expires_at timestamptz,
  p_ingress_nonce text,
  p_ingress_hmac_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,destruktion_meta,extensions,vault
as $$
declare
  k text;
  msg text;
  expected text;
  receipt uuid;
  emitted jsonb;
  now_ts timestamptz := clock_timestamp();
begin
  if p_ingress_verifier_id <> 'A2_TRUSTED_ED25519_INGRESS_V1' then
    raise exception 'a2_ingress_verifier_invalid';
  end if;
  if p_ingress_nonce is null or p_ingress_nonce !~ '^[0-9a-f]{32,128}$' then
    raise exception 'a2_ingress_nonce_invalid';
  end if;
  if p_ingress_hmac_sha256 is null or p_ingress_hmac_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'a2_ingress_hmac_invalid';
  end if;
  if p_ingress_issued_at > now_ts + interval '30 seconds'
     or p_ingress_issued_at < now_ts - interval '2 minutes'
     or p_ingress_expires_at <= now_ts
     or p_ingress_expires_at > p_ingress_issued_at + interval '2 minutes' then
    raise exception 'a2_ingress_receipt_expired_or_invalid';
  end if;

  select decrypted_secret into k
  from vault.decrypted_secrets
  where name='a2_ingress_hmac_v1'
  order by created_at desc
  limit 1;
  if k is null or length(k)<32 then
    raise exception 'a2_ingress_secret_unavailable';
  end if;

  msg := concat_ws(E'\n',
    'A2_INGRESS_RECEIPT_V1',
    p_event_hash,
    p_session_id::text,
    p_signature_key_fingerprint_sha256,
    p_ingress_verifier_id,
    extract(epoch from p_ingress_issued_at)::numeric::text,
    extract(epoch from p_ingress_expires_at)::numeric::text,
    p_ingress_nonce
  );
  expected := encode(extensions.hmac(convert_to(msg,'UTF8'),convert_to(k,'UTF8'),'sha256'),'hex');
  if expected <> lower(p_ingress_hmac_sha256) then
    raise exception 'a2_ingress_hmac_mismatch';
  end if;

  perform set_config('metaengine.a2_rpc','on',true);
  insert into destruktion_meta.compute_fabric_a2_ingress_receipt_h205f22(
    event_hash,session_id,signature_key_fingerprint_sha256,verifier_id,
    issued_at,expires_at,nonce,hmac_sha256
  ) values (
    p_event_hash,p_session_id,p_signature_key_fingerprint_sha256,p_ingress_verifier_id,
    p_ingress_issued_at,p_ingress_expires_at,p_ingress_nonce,lower(p_ingress_hmac_sha256)
  ) returning receipt_id into receipt;

  emitted := public.h205f22_a2_emit_agent_event_v1(
    p_event_id,p_session_id,p_agent_seq,p_semantic_point,p_event_type,p_priority,
    p_parent_hashes,p_payload,p_visibility_proof_id,p_model_provenance,p_event_hash,
    p_signature_base64,p_signature_key_fingerprint_sha256,true
  );

  update destruktion_meta.compute_fabric_a2_ingress_receipt_h205f22
  set consumed_event_id=(emitted->>'event_id')::uuid
  where receipt_id=receipt;

  return emitted || jsonb_build_object(
    'ingress_verification','A2_TRUSTED_ED25519_INGRESS_V1',
    'ingress_receipt_id',receipt
  );
end $$;

revoke all on destruktion_meta.compute_fabric_a2_ingress_receipt_h205f22 from anon,authenticated,service_role;
revoke all on function public.h205f22_a2_emit_agent_event_v2(uuid,uuid,bigint,text,text,smallint,text[],jsonb,uuid,jsonb,text,text,text,text,timestamptz,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.h205f22_a2_emit_agent_event_v2(uuid,uuid,bigint,text,text,smallint,text[],jsonb,uuid,jsonb,text,text,text,text,timestamptz,timestamptz,text,text) to service_role;
revoke execute on function public.h205f22_a2_emit_agent_event_v1(uuid,uuid,bigint,text,text,smallint,text[],jsonb,uuid,jsonb,text,text,text,boolean) from service_role;
