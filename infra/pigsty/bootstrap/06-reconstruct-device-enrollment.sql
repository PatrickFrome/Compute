-- ============================================================================
-- METAENGINE reconstruction 2026-09-21 (часть 2) — device enrollment слой.
-- Артефакты облачной эры (2026-08-27), в каталог миграций не попали.
-- Контракт извлечён из edge-кода a2-browser-native-supervisor-v1/index.ts:
--   enrollmentExisting/Insert/ById, deviceLookup, ACTIVATE_RPC вызов.
-- ============================================================================

-- 1. Таблица заявок на enrollment устройства
create table if not exists public.compute_fabric_a2_browser_device_enrollment_request_h205f22 (
  request_id uuid primary key default gen_random_uuid(),
  client_id text not null,
  profile text not null,
  public_jwk jsonb not null,
  key_fingerprint_sha256 text not null,
  status text not null default 'PENDING'
    check (status in ('PENDING','APPROVED','REJECTED','EXPIRED')),
  metadata jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '24 hours',
  approved_at timestamptz,
  device_id uuid,
  authority_effect boolean not null default false
);
create index if not exists device_enrollment_client_idx
  on public.compute_fabric_a2_browser_device_enrollment_request_h205f22(client_id, key_fingerprint_sha256, status);
-- zero-authority: оператор одобряет заявку, service_role только читает
revoke insert, update, delete on public.compute_fabric_a2_browser_device_enrollment_request_h205f22 from service_role;
grant select on public.compute_fabric_a2_browser_device_enrollment_request_h205f22 to service_role;

-- 2. RPC активации одобренной заявки (оператор-гейт пройден: status='APPROVED')
create or replace function public.h205f22_a2_browser_device_activate_approved_v1(
  p_request_id uuid,
  p_client_id text,
  p_profile text,
  p_key_fingerprint_sha256 text,
  p_public_jwk jsonb
) returns jsonb
language plpgsql
security definer
as $fn$
declare
  v_request public.compute_fabric_a2_browser_device_enrollment_request_h205f22%rowtype;
  v_device_id uuid;
  v_pairing_token text;
  v_pairing_hash text;
begin
  select * into v_request
    from public.compute_fabric_a2_browser_device_enrollment_request_h205f22
   where request_id = p_request_id
     and client_id = p_client_id
     and key_fingerprint_sha256 = p_key_fingerprint_sha256
   limit 1;
  if not found then
    return jsonb_build_object('accepted', false, 'reason', 'ENROLLMENT_REQUEST_NOT_FOUND');
  end if;
  if v_request.status <> 'APPROVED' then
    return jsonb_build_object('accepted', false, 'reason', 'REQUEST_' || v_request.status);
  end if;
  if v_request.expires_at <= clock_timestamp() then
    return jsonb_build_object('accepted', false, 'reason', 'REQUEST_EXPIRED');
  end if;
  if v_request.profile <> p_profile then
    return jsonb_build_object('accepted', false, 'reason', 'PROFILE_MISMATCH');
  end if;

  v_device_id := coalesce(v_request.device_id, encode(extensions.gen_random_bytes(16), 'hex')::uuid);
  v_pairing_token := encode(extensions.gen_random_bytes(48), 'base64');
  v_pairing_hash := encode(extensions.digest(convert_to(v_pairing_token, 'UTF8'), 'sha256'), 'hex');

  insert into public.compute_fabric_a2_browser_device_h205f22 as d
    (device_id, client_id, profile, public_jwk, key_fingerprint_sha256,
     enrollment_pairing_token_hash, active, enrolled_at)
  values
    (v_device_id, p_client_id, p_profile, p_public_jwk, p_key_fingerprint_sha256,
     v_pairing_hash, true, clock_timestamp())
  on conflict (device_id) do update
    set public_jwk = excluded.public_jwk,
        key_fingerprint_sha256 = excluded.key_fingerprint_sha256,
        enrollment_pairing_token_hash = excluded.enrollment_pairing_token_hash,
        active = true,
        revoked_at = null;

  insert into public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22
    (token_hash, label, active)
  values (v_pairing_hash, 'device-enrollment:' || p_client_id, true)
  on conflict do nothing;

  update public.compute_fabric_a2_browser_device_enrollment_request_h205f22
     set device_id = v_device_id
   where request_id = v_request.request_id;

  return jsonb_build_object(
    'accepted', true,
    'device_id', v_device_id::text,
    'client_id', p_client_id,
    'profile', p_profile,
    'key_fingerprint_sha256', p_key_fingerprint_sha256,
    'pairing_token', v_pairing_token,
    'authority_effect', false
  );
end $fn$;

revoke all on function public.h205f22_a2_browser_device_activate_approved_v1(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_device_activate_approved_v1(uuid, text, text, text, jsonb)
  to service_role;
