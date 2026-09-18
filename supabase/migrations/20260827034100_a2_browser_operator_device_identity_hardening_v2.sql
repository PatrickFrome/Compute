alter table public.compute_fabric_a2_browser_device_h205f22
  drop constraint if exists a2_browser_device_jwk_chk;

alter table public.compute_fabric_a2_browser_device_h205f22
  add constraint a2_browser_device_jwk_chk check (
    jsonb_typeof(public_jwk) = 'object' and
    public_jwk->>'kty' = 'EC' and
    public_jwk->>'crv' = 'P-256' and
    (public_jwk->>'x') ~ '^[A-Za-z0-9_-]{43}$' and
    (public_jwk->>'y') ~ '^[A-Za-z0-9_-]{43}$' and
    not (public_jwk ? 'd') and
    (not (public_jwk ? 'key_ops') or public_jwk->'key_ops' = '["verify"]'::jsonb) and
    (not (public_jwk ? 'ext') or public_jwk->'ext' = 'true'::jsonb)
  );

create or replace function public.h205f22_a2_browser_device_enroll_v1(
  p_client_id text,
  p_profile text,
  p_public_jwk jsonb,
  p_key_fingerprint_sha256 text,
  p_pairing_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.compute_fabric_a2_browser_device_h205f22%rowtype;
  v_device_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if p_client_id is null or char_length(p_client_id) < 1 or char_length(p_client_id) > 160
     or p_profile <> 'A2_DEVICE_HTTP_SIGNATURE_V1'
     or p_key_fingerprint_sha256 is null or p_key_fingerprint_sha256 !~ '^[0-9a-f]{64}$'
     or p_pairing_token_hash is null or p_pairing_token_hash !~ '^[0-9a-f]{64}$'
     or p_public_jwk is null or jsonb_typeof(p_public_jwk) <> 'object'
     or p_public_jwk->>'kty' <> 'EC' or p_public_jwk->>'crv' <> 'P-256'
     or (p_public_jwk->>'x') !~ '^[A-Za-z0-9_-]{43}$'
     or (p_public_jwk->>'y') !~ '^[A-Za-z0-9_-]{43}$'
     or p_public_jwk ? 'd'
     or (p_public_jwk ? 'key_ops' and p_public_jwk->'key_ops' <> '["verify"]'::jsonb)
     or (p_public_jwk ? 'ext' and p_public_jwk->'ext' <> 'true'::jsonb) then
    return jsonb_build_object('accepted', false, 'reason', 'INVALID_INPUT');
  end if;

  if not exists (
    select 1
      from public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22
     where token_hash = p_pairing_token_hash
       and active is true
  ) then
    return jsonb_build_object('accepted', false, 'reason', 'PAIRING_INVALID');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('METAENGINE_A2_BROWSER_DEVICE_ENROLL'),
    pg_catalog.hashtext(p_client_id)
  );

  select * into v_existing
    from public.compute_fabric_a2_browser_device_h205f22
   where client_id = p_client_id
     and active is true
   for update;

  if found and v_existing.key_fingerprint_sha256 = p_key_fingerprint_sha256
     and v_existing.public_jwk = p_public_jwk
     and v_existing.profile = p_profile then
    update public.compute_fabric_a2_browser_device_h205f22
       set enrollment_pairing_token_hash = p_pairing_token_hash,
           last_used_at = v_now
     where device_id = v_existing.device_id;
    update public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22
       set last_used_at = v_now
     where token_hash = p_pairing_token_hash;
    return jsonb_build_object(
      'accepted', true,
      'reason', 'ALREADY_ENROLLED',
      'device_id', v_existing.device_id,
      'profile', v_existing.profile,
      'enrolled_at', v_existing.enrolled_at,
      'key_fingerprint_sha256', v_existing.key_fingerprint_sha256
    );
  end if;

  if found then
    update public.compute_fabric_a2_browser_device_h205f22
       set active = false,
           revoked_at = v_now
     where device_id = v_existing.device_id;
  end if;

  insert into public.compute_fabric_a2_browser_device_h205f22(
    client_id, profile, public_jwk, key_fingerprint_sha256,
    enrollment_pairing_token_hash, active, enrolled_at, last_used_at
  ) values (
    p_client_id, p_profile, p_public_jwk, p_key_fingerprint_sha256,
    p_pairing_token_hash, true, v_now, v_now
  ) returning device_id into v_device_id;

  update public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22
     set last_used_at = v_now
   where token_hash = p_pairing_token_hash;

  return jsonb_build_object(
    'accepted', true,
    'reason', case when v_existing.device_id is null then 'ENROLLED' else 'ROTATED' end,
    'device_id', v_device_id,
    'profile', p_profile,
    'enrolled_at', v_now,
    'key_fingerprint_sha256', p_key_fingerprint_sha256
  );
end;
$$;

revoke all on function public.h205f22_a2_browser_device_enroll_v1(text,text,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_device_enroll_v1(text,text,jsonb,text,text) to service_role;

create or replace function public.h205f22_a2_browser_device_consume_nonce_v2(
  p_device_id uuid,
  p_client_id text,
  p_nonce_sha256 text,
  p_request_timestamp timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.compute_fabric_a2_browser_device_h205f22%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_device_id is null or p_client_id is null or char_length(p_client_id) < 1 or char_length(p_client_id) > 160
     or p_nonce_sha256 is null or p_nonce_sha256 !~ '^[0-9a-f]{64}$'
     or p_request_timestamp is null then
    return jsonb_build_object('accepted', false, 'reason', 'INVALID_INPUT');
  end if;

  if p_request_timestamp < v_now - interval '2 minutes'
     or p_request_timestamp > v_now + interval '2 minutes' then
    return jsonb_build_object('accepted', false, 'reason', 'TIMESTAMP_OUT_OF_WINDOW');
  end if;

  select * into v_device
    from public.compute_fabric_a2_browser_device_h205f22
   where device_id = p_device_id
   for update;

  if not found then
    return jsonb_build_object('accepted', false, 'reason', 'DEVICE_NOT_FOUND');
  end if;
  if v_device.active is not true or v_device.revoked_at is not null then
    return jsonb_build_object('accepted', false, 'reason', 'DEVICE_REVOKED');
  end if;
  if v_device.client_id <> p_client_id or v_device.profile <> 'A2_DEVICE_HTTP_SIGNATURE_V1' then
    return jsonb_build_object('accepted', false, 'reason', 'DEVICE_BINDING_MISMATCH');
  end if;

  delete from public.compute_fabric_a2_browser_device_nonce_h205f22
   where expires_at < v_now - interval '1 minute';

  begin
    insert into public.compute_fabric_a2_browser_device_nonce_h205f22(device_id, nonce_sha256, seen_at, expires_at)
    values (p_device_id, p_nonce_sha256, v_now, v_now + interval '10 minutes');
  exception when unique_violation then
    return jsonb_build_object('accepted', false, 'reason', 'NONCE_REPLAY');
  end;

  update public.compute_fabric_a2_browser_device_h205f22
     set last_used_at = v_now
   where device_id = p_device_id;

  return jsonb_build_object(
    'accepted', true,
    'reason', 'ACCEPTED',
    'device_id', p_device_id,
    'profile', v_device.profile,
    'key_fingerprint_sha256', v_device.key_fingerprint_sha256
  );
end;
$$;

revoke all on function public.h205f22_a2_browser_device_consume_nonce_v2(uuid,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_device_consume_nonce_v2(uuid,text,text,timestamptz) to service_role;

comment on function public.h205f22_a2_browser_device_enroll_v1(text,text,jsonb,text,text) is
  'Pairing-bound transactional enrollment/rotation for non-exportable browser P-256 device identities.';
comment on function public.h205f22_a2_browser_device_consume_nonce_v2(uuid,text,text,timestamptz) is
  'Durable anti-replay admission for signed Browser Operator requests; validates device binding and +/-2 minute timestamp freshness.';
