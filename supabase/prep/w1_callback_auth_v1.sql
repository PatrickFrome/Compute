-- PREP ONLY: H205F22 W1 callback key registry and signed callback receipts.
-- This file is intentionally NOT a migration. Do not apply until protected W1
-- readiness and exact SSM key-enrollment evidence exist.
--
-- Authority boundary:
-- * stores only provider-bound public callback keys and verified callback receipts;
-- * cannot admit a worker, prove reboot/persistence, verify W1, or mutate roadmap;
-- * all functions are SECURITY INVOKER and service_role-only.

create table if not exists public.compute_fabric_w1_callback_key_h205f22 (
  key_id text primary key check (key_id ~ '^[0-9a-f]{64}$'),
  worker_id text not null check (worker_id ~ '^[A-Za-z0-9._:-]{3,160}$'),
  provider_kind text not null check (provider_kind = 'AWS_EC2'),
  provider_instance_id text not null check (provider_instance_id ~ '^i-[0-9a-f]{8}([0-9a-f]{9})?$'),
  algorithm text not null check (algorithm = 'ES256-P1363-SHA256'),
  public_jwk jsonb not null,
  enrollment_record_sha256 text not null check (enrollment_record_sha256 ~ '^[0-9a-f]{64}$'),
  enrollment_invocation_sha256 text not null check (enrollment_invocation_sha256 ~ '^[0-9a-f]{64}$'),
  ssm_command_id uuid not null,
  ssm_document_name text not null check (ssm_document_name = 'Metaengine-W1-Callback-Key-Enroll-H205F22'),
  ssm_document_version text not null check (ssm_document_version = '1'),
  ssm_document_hash_sha256 text not null check (ssm_document_hash_sha256 ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz not null,
  registered_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  canonical boolean not null default false check (canonical = false),
  authority_effect boolean not null default false check (authority_effect = false),
  worker_admitted boolean not null default false check (worker_admitted = false),
  w1_verified boolean not null default false check (w1_verified = false),
  persistent_worker_proof boolean not null default false check (persistent_worker_proof = false),
  reboot_completion_proven boolean not null default false check (reboot_completion_proven = false),
  check (jsonb_typeof(public_jwk) = 'object'),
  check (public_jwk ->> 'kty' = 'EC'),
  check (public_jwk ->> 'crv' = 'P-256'),
  check ((public_jwk ->> 'x') ~ '^[A-Za-z0-9_-]{43}$'),
  check ((public_jwk ->> 'y') ~ '^[A-Za-z0-9_-]{43}$'),
  check (revoked_at is null or revoked_at >= registered_at)
);

alter table public.compute_fabric_w1_callback_key_h205f22 enable row level security;
revoke all on table public.compute_fabric_w1_callback_key_h205f22 from public, anon, authenticated;
grant select, insert on table public.compute_fabric_w1_callback_key_h205f22 to service_role;
grant update (revoked_at) on table public.compute_fabric_w1_callback_key_h205f22 to service_role;

create table if not exists public.compute_fabric_w1_execution_callback_receipt_h205f22 (
  callback_receipt_id uuid primary key,
  marker_id uuid not null unique,
  key_id text not null references public.compute_fabric_w1_callback_key_h205f22(key_id),
  worker_id text not null check (worker_id ~ '^[A-Za-z0-9._:-]{3,160}$'),
  provider_kind text not null check (provider_kind = 'AWS_EC2'),
  provider_instance_id text not null check (provider_instance_id ~ '^i-[0-9a-f]{8}([0-9a-f]{9})?$'),
  execution_payload_sha256 text not null check (execution_payload_sha256 ~ '^[0-9a-f]{64}$'),
  package_sha256 text not null check (package_sha256 ~ '^[0-9a-f]{64}$'),
  payload_lock_sha256 text not null check (payload_lock_sha256 ~ '^[0-9a-f]{64}$'),
  marker_body_sha256 text not null check (marker_body_sha256 ~ '^[0-9a-f]{64}$'),
  key_enrollment_record_sha256 text not null check (key_enrollment_record_sha256 ~ '^[0-9a-f]{64}$'),
  challenge_nonce_sha256 text not null check (challenge_nonce_sha256 ~ '^[0-9a-f]{64}$'),
  signed_payload_sha256 text not null check (signed_payload_sha256 ~ '^[0-9a-f]{64}$'),
  signature_sha256 text not null check (signature_sha256 ~ '^[0-9a-f]{64}$'),
  attestation_sha256 text not null check (attestation_sha256 ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null,
  attestation jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  canonical boolean not null default false check (canonical = false),
  authority_effect boolean not null default false check (authority_effect = false),
  database_persistence_verified boolean not null default false check (database_persistence_verified = false),
  persistent_worker_proof boolean not null default false check (persistent_worker_proof = false),
  worker_admitted boolean not null default false check (worker_admitted = false),
  w1_verified boolean not null default false check (w1_verified = false),
  check (jsonb_typeof(attestation) = 'object')
);

alter table public.compute_fabric_w1_execution_callback_receipt_h205f22 enable row level security;
revoke all on table public.compute_fabric_w1_execution_callback_receipt_h205f22 from public, anon, authenticated;
grant select, insert on table public.compute_fabric_w1_execution_callback_receipt_h205f22 to service_role;

create or replace function public.compute_fabric_register_w1_callback_key_h205f22(p_registration jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_jwk jsonb;
  v_existing public.compute_fabric_w1_callback_key_h205f22%rowtype;
  v_keys text[];
begin
  if jsonb_typeof(p_registration) <> 'object'
     or p_registration ->> 'schema' <> 'metaengine.compute.w1-callback-key-registration.h205f22.v1'
     or p_registration ->> 'source_classification' <> 'SSM_KEY_ENROLLMENT_VERIFIED_NONAUTHORITY'
     or p_registration ->> 'provider_kind' <> 'AWS_EC2'
     or p_registration ->> 'algorithm' <> 'ES256-P1363-SHA256'
     or p_registration ->> 'ssm_document_name' <> 'Metaengine-W1-Callback-Key-Enroll-H205F22'
     or p_registration ->> 'ssm_document_version' <> '1'
     or coalesce((p_registration ->> 'canonical')::boolean, true)
     or coalesce((p_registration ->> 'authority_effect')::boolean, true)
     or coalesce((p_registration ->> 'worker_admitted')::boolean, true)
     or coalesce((p_registration ->> 'w1_verified')::boolean, true)
     or coalesce((p_registration ->> 'persistent_worker_proof')::boolean, true)
     or coalesce((p_registration ->> 'reboot_completion_proven')::boolean, true)
  then
    raise exception 'w1_callback_key_registration_contract_invalid';
  end if;

  if coalesce(p_registration ->> 'key_id','') !~ '^[0-9a-f]{64}$'
     or coalesce(p_registration ->> 'worker_id','') !~ '^[A-Za-z0-9._:-]{3,160}$'
     or coalesce(p_registration ->> 'provider_instance_id','') !~ '^i-[0-9a-f]{8}([0-9a-f]{9})?$'
     or coalesce(p_registration ->> 'enrollment_record_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(p_registration ->> 'enrollment_invocation_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(p_registration ->> 'ssm_document_hash_sha256','') !~ '^[0-9a-f]{64}$'
  then
    raise exception 'w1_callback_key_registration_identity_invalid';
  end if;

  v_jwk := p_registration -> 'public_jwk';
  if jsonb_typeof(v_jwk) <> 'object' then
    raise exception 'w1_callback_key_registration_jwk_invalid';
  end if;
  select array_agg(key order by key)
  into v_keys
  from jsonb_object_keys(v_jwk) as t(key);
  if v_keys <> array['crv','kty','x','y']::text[]
     or v_jwk ->> 'kty' <> 'EC'
     or v_jwk ->> 'crv' <> 'P-256'
     or coalesce(v_jwk ->> 'x','') !~ '^[A-Za-z0-9_-]{43}$'
     or coalesce(v_jwk ->> 'y','') !~ '^[A-Za-z0-9_-]{43}$'
  then
    raise exception 'w1_callback_key_registration_jwk_invalid';
  end if;

  select *
  into v_existing
  from public.compute_fabric_w1_callback_key_h205f22
  where key_id = p_registration ->> 'key_id';

  if found then
    if v_existing.worker_id <> p_registration ->> 'worker_id'
       or v_existing.provider_instance_id <> p_registration ->> 'provider_instance_id'
       or v_existing.public_jwk <> v_jwk
       or v_existing.enrollment_record_sha256 <> p_registration ->> 'enrollment_record_sha256'
       or v_existing.enrollment_invocation_sha256 <> p_registration ->> 'enrollment_invocation_sha256'
       or v_existing.ssm_command_id <> (p_registration ->> 'ssm_command_id')::uuid
       or v_existing.ssm_document_hash_sha256 <> p_registration ->> 'ssm_document_hash_sha256'
    then
      raise exception 'w1_callback_key_registration_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'stored', true, 'reused', true, 'key_id', v_existing.key_id,
      'revoked_at', v_existing.revoked_at, 'canonical', false, 'authority_effect', false
    );
  end if;

  insert into public.compute_fabric_w1_callback_key_h205f22 (
    key_id, worker_id, provider_kind, provider_instance_id, algorithm, public_jwk,
    enrollment_record_sha256, enrollment_invocation_sha256, ssm_command_id,
    ssm_document_name, ssm_document_version, ssm_document_hash_sha256, observed_at
  ) values (
    p_registration ->> 'key_id',
    p_registration ->> 'worker_id',
    'AWS_EC2',
    p_registration ->> 'provider_instance_id',
    'ES256-P1363-SHA256',
    v_jwk,
    p_registration ->> 'enrollment_record_sha256',
    p_registration ->> 'enrollment_invocation_sha256',
    (p_registration ->> 'ssm_command_id')::uuid,
    'Metaengine-W1-Callback-Key-Enroll-H205F22',
    '1',
    p_registration ->> 'ssm_document_hash_sha256',
    (p_registration ->> 'observed_at')::timestamptz
  );

  return jsonb_build_object(
    'stored', true, 'reused', false, 'key_id', p_registration ->> 'key_id',
    'revoked_at', null, 'canonical', false, 'authority_effect', false
  );
end
$$;

create or replace function public.compute_fabric_revoke_w1_callback_key_h205f22(
  p_key_id text,
  p_revoked_at timestamptz default statement_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if coalesce(p_key_id,'') !~ '^[0-9a-f]{64}$' then
    raise exception 'w1_callback_key_id_invalid';
  end if;
  update public.compute_fabric_w1_callback_key_h205f22
  set revoked_at = p_revoked_at
  where key_id = p_key_id
    and revoked_at is null;
  get diagnostics v_count = row_count;
  return jsonb_build_object(
    'key_id', p_key_id, 'revoked', v_count = 1,
    'canonical', false, 'authority_effect', false
  );
end
$$;

create or replace function public.compute_fabric_get_w1_callback_key_h205f22(p_key_id text)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'key_id', k.key_id,
    'worker_id', k.worker_id,
    'provider_kind', k.provider_kind,
    'provider_instance_id', k.provider_instance_id,
    'algorithm', k.algorithm,
    'public_jwk', k.public_jwk,
    'enrollment_record_sha256', k.enrollment_record_sha256,
    'revoked_at', k.revoked_at,
    'canonical', false,
    'authority_effect', false
  )
  from public.compute_fabric_w1_callback_key_h205f22 k
  where k.key_id = p_key_id
    and k.revoked_at is null
$$;

create or replace function public.compute_fabric_record_w1_execution_callback_h205f22(p_attestation jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_key public.compute_fabric_w1_callback_key_h205f22%rowtype;
  v_existing public.compute_fabric_w1_execution_callback_receipt_h205f22%rowtype;
begin
  if jsonb_typeof(p_attestation) <> 'object'
     or p_attestation ->> 'schema' <> 'metaengine.compute.w1-execution-callback-attestation.h205f22.v1'
     or p_attestation ->> 'auth_kind' <> 'WORKER_ENROLLMENT_SIGNATURE_V1'
     or coalesce((p_attestation ->> 'accepted')::boolean, false) is not true
     or coalesce((p_attestation ->> 'auth_verified')::boolean, false) is not true
     or coalesce((p_attestation ->> 'database_persistence_verified')::boolean, true)
     or coalesce((p_attestation ->> 'persistent_worker_proof')::boolean, true)
     or coalesce((p_attestation ->> 'worker_admitted')::boolean, true)
     or coalesce((p_attestation ->> 'w1_verified')::boolean, true)
     or coalesce((p_attestation ->> 'canonical')::boolean, true)
     or coalesce((p_attestation ->> 'authority_effect')::boolean, true)
  then
    raise exception 'w1_execution_callback_attestation_contract_invalid';
  end if;

  if coalesce(p_attestation ->> 'key_id','') !~ '^[0-9a-f]{64}$'
     or coalesce(p_attestation ->> 'worker_id','') !~ '^[A-Za-z0-9._:-]{3,160}$'
     or coalesce(p_attestation ->> 'provider_instance_id','') !~ '^i-[0-9a-f]{8}([0-9a-f]{9})?$'
     or coalesce(p_attestation ->> 'execution_payload_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(p_attestation ->> 'package_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(p_attestation ->> 'payload_lock_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(p_attestation ->> 'marker_body_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(p_attestation ->> 'key_enrollment_record_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(p_attestation ->> 'challenge_nonce_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(p_attestation ->> 'signed_payload_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(p_attestation ->> 'signature_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(p_attestation ->> 'attestation_sha256','') !~ '^[0-9a-f]{64}$'
  then
    raise exception 'w1_execution_callback_attestation_digest_invalid';
  end if;

  select *
  into v_key
  from public.compute_fabric_w1_callback_key_h205f22
  where key_id = p_attestation ->> 'key_id'
    and revoked_at is null;
  if not found
     or v_key.worker_id <> p_attestation ->> 'worker_id'
     or v_key.provider_instance_id <> p_attestation ->> 'provider_instance_id'
     or v_key.enrollment_record_sha256 <> p_attestation ->> 'key_enrollment_record_sha256'
  then
    raise exception 'w1_execution_callback_key_binding_invalid';
  end if;

  select *
  into v_existing
  from public.compute_fabric_w1_execution_callback_receipt_h205f22
  where marker_id = (p_attestation ->> 'marker_id')::uuid;
  if found then
    if v_existing.key_id <> p_attestation ->> 'key_id'
       or v_existing.worker_id <> p_attestation ->> 'worker_id'
       or v_existing.provider_instance_id <> p_attestation ->> 'provider_instance_id'
       or v_existing.marker_body_sha256 <> p_attestation ->> 'marker_body_sha256'
       or v_existing.signed_payload_sha256 <> p_attestation ->> 'signed_payload_sha256'
       or v_existing.signature_sha256 <> p_attestation ->> 'signature_sha256'
    then
      raise exception 'w1_execution_callback_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'stored', true, 'reused', true,
      'callback_receipt_id', v_existing.callback_receipt_id,
      'marker_id', v_existing.marker_id,
      'canonical', false, 'authority_effect', false
    );
  end if;

  insert into public.compute_fabric_w1_execution_callback_receipt_h205f22 (
    callback_receipt_id, marker_id, key_id, worker_id, provider_kind, provider_instance_id,
    execution_payload_sha256, package_sha256, payload_lock_sha256, marker_body_sha256,
    key_enrollment_record_sha256, challenge_nonce_sha256, signed_payload_sha256,
    signature_sha256, attestation_sha256, received_at, attestation
  ) values (
    (p_attestation ->> 'callback_receipt_id')::uuid,
    (p_attestation ->> 'marker_id')::uuid,
    p_attestation ->> 'key_id',
    p_attestation ->> 'worker_id',
    'AWS_EC2',
    p_attestation ->> 'provider_instance_id',
    p_attestation ->> 'execution_payload_sha256',
    p_attestation ->> 'package_sha256',
    p_attestation ->> 'payload_lock_sha256',
    p_attestation ->> 'marker_body_sha256',
    p_attestation ->> 'key_enrollment_record_sha256',
    p_attestation ->> 'challenge_nonce_sha256',
    p_attestation ->> 'signed_payload_sha256',
    p_attestation ->> 'signature_sha256',
    p_attestation ->> 'attestation_sha256',
    (p_attestation ->> 'received_at')::timestamptz,
    p_attestation
  );

  return jsonb_build_object(
    'stored', true, 'reused', false,
    'callback_receipt_id', p_attestation ->> 'callback_receipt_id',
    'marker_id', p_attestation ->> 'marker_id',
    'canonical', false, 'authority_effect', false
  );
end
$$;

revoke all on function public.compute_fabric_register_w1_callback_key_h205f22(jsonb) from public, anon, authenticated;
revoke all on function public.compute_fabric_revoke_w1_callback_key_h205f22(text, timestamptz) from public, anon, authenticated;
revoke all on function public.compute_fabric_get_w1_callback_key_h205f22(text) from public, anon, authenticated;
revoke all on function public.compute_fabric_record_w1_execution_callback_h205f22(jsonb) from public, anon, authenticated;

grant execute on function public.compute_fabric_register_w1_callback_key_h205f22(jsonb) to service_role;
grant execute on function public.compute_fabric_revoke_w1_callback_key_h205f22(text, timestamptz) to service_role;
grant execute on function public.compute_fabric_get_w1_callback_key_h205f22(text) to service_role;
grant execute on function public.compute_fabric_record_w1_execution_callback_h205f22(jsonb) to service_role;
