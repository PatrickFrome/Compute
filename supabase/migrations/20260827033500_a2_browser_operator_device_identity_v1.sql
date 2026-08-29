create table if not exists public.compute_fabric_a2_browser_device_h205f22 (
  device_id uuid primary key default gen_random_uuid(),
  client_id text not null,
  profile text not null default 'A2_DEVICE_HTTP_SIGNATURE_V1',
  public_jwk jsonb not null,
  key_fingerprint_sha256 text not null,
  enrollment_pairing_token_hash text,
  active boolean not null default true,
  enrolled_at timestamptz not null default clock_timestamp(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint a2_browser_device_client_len_chk check (char_length(client_id) between 1 and 160),
  constraint a2_browser_device_profile_chk check (profile = 'A2_DEVICE_HTTP_SIGNATURE_V1'),
  constraint a2_browser_device_fp_chk check (key_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  constraint a2_browser_device_pairing_hash_chk check (enrollment_pairing_token_hash is null or enrollment_pairing_token_hash ~ '^[0-9a-f]{64}$'),
  constraint a2_browser_device_jwk_chk check (
    public_jwk->>'kty' = 'EC' and public_jwk->>'crv' = 'P-256' and
    jsonb_typeof(public_jwk->'x') = 'string' and jsonb_typeof(public_jwk->'y') = 'string'
  ),
  constraint a2_browser_device_revoke_chk check ((active and revoked_at is null) or (not active))
);

create unique index if not exists compute_fabric_a2_browser_device_active_client_uidx
  on public.compute_fabric_a2_browser_device_h205f22 (client_id)
  where active;
create index if not exists compute_fabric_a2_browser_device_fp_idx
  on public.compute_fabric_a2_browser_device_h205f22 (key_fingerprint_sha256);

create table if not exists public.compute_fabric_a2_browser_device_nonce_h205f22 (
  device_id uuid not null references public.compute_fabric_a2_browser_device_h205f22(device_id) on delete cascade,
  nonce_sha256 text not null,
  seen_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '10 minutes'),
  primary key (device_id, nonce_sha256),
  constraint a2_browser_nonce_hash_chk check (nonce_sha256 ~ '^[0-9a-f]{64}$'),
  constraint a2_browser_nonce_expiry_chk check (expires_at > seen_at)
);
create index if not exists compute_fabric_a2_browser_device_nonce_exp_idx
  on public.compute_fabric_a2_browser_device_nonce_h205f22 (expires_at);

alter table public.compute_fabric_a2_browser_device_h205f22 enable row level security;
alter table public.compute_fabric_a2_browser_device_h205f22 force row level security;
alter table public.compute_fabric_a2_browser_device_nonce_h205f22 enable row level security;
alter table public.compute_fabric_a2_browser_device_nonce_h205f22 force row level security;

revoke all on table public.compute_fabric_a2_browser_device_h205f22 from public, anon, authenticated;
revoke all on table public.compute_fabric_a2_browser_device_nonce_h205f22 from public, anon, authenticated;
grant select, insert, update, delete on table public.compute_fabric_a2_browser_device_h205f22 to service_role;
grant select, insert, update, delete on table public.compute_fabric_a2_browser_device_nonce_h205f22 to service_role;

create or replace function public.h205f22_a2_browser_device_consume_nonce_v1(
  p_device_id uuid,
  p_client_id text,
  p_nonce_sha256 text
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
     or p_nonce_sha256 is null or p_nonce_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('accepted', false, 'reason', 'INVALID_INPUT');
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

  return jsonb_build_object('accepted', true, 'reason', 'ACCEPTED', 'device_id', p_device_id, 'profile', v_device.profile);
end;
$$;

revoke all on function public.h205f22_a2_browser_device_consume_nonce_v1(uuid,text,text) from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_device_consume_nonce_v1(uuid,text,text) to service_role;

comment on table public.compute_fabric_a2_browser_device_h205f22 is 'Non-authority A2 Browser Operator device public identities. Private keys never leave browser IndexedDB.';
comment on table public.compute_fabric_a2_browser_device_nonce_h205f22 is 'Replay fence: SHA-256 hashes of consumed signed-request nonces only.';
