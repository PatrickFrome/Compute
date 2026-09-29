-- METAENGINE Client V1 native-device enrollment plane for fresh Supabase projects.
-- The Edge function already implements a signed public-key enrollment request/status flow.
-- Historical databases had this surface outside the tracked migration ledger; a fresh project did not.
-- This migration restores that missing durable substrate without auto-approving any device.

create table if not exists public.compute_fabric_a2_browser_device_enrollment_request_h205f22 (
  request_id uuid primary key default gen_random_uuid(),
  client_id text not null,
  profile text not null default 'A2_DEVICE_HTTP_SIGNATURE_V1',
  public_jwk jsonb not null,
  key_fingerprint_sha256 text not null,
  status text not null default 'PENDING',
  metadata jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '30 minutes'),
  approved_at timestamptz,
  rejected_at timestamptz,
  claimed_at timestamptz,
  device_id uuid references public.compute_fabric_a2_browser_device_h205f22(device_id),
  approved_pairing_token_hash text,
  authority_effect boolean not null default false,
  constraint a2_browser_device_enrollment_client_len_ck
    check (char_length(client_id) between 1 and 160),
  constraint a2_browser_device_enrollment_profile_ck
    check (profile='A2_DEVICE_HTTP_SIGNATURE_V1'),
  constraint a2_browser_device_enrollment_fp_ck
    check (key_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  constraint a2_browser_device_enrollment_jwk_ck
    check (
      jsonb_typeof(public_jwk)='object'
      and public_jwk->>'kty'='EC'
      and public_jwk->>'crv'='P-256'
      and public_jwk->>'x' ~ '^[A-Za-z0-9_-]{43}$'
      and public_jwk->>'y' ~ '^[A-Za-z0-9_-]{43}$'
      and not (public_jwk ? 'd')
      and (not (public_jwk ? 'key_ops') or public_jwk->'key_ops'='["verify"]'::jsonb)
      and (not (public_jwk ? 'ext') or public_jwk->'ext'='true'::jsonb)
    ),
  constraint a2_browser_device_enrollment_status_ck
    check (status in ('PENDING','APPROVED','REJECTED','EXPIRED','CLAIMED')),
  constraint a2_browser_device_enrollment_expiry_ck
    check (expires_at > requested_at),
  constraint a2_browser_device_enrollment_pairing_hash_ck
    check (approved_pairing_token_hash is null or approved_pairing_token_hash ~ '^[0-9a-f]{64}$'),
  constraint a2_browser_device_enrollment_authority_ck
    check (authority_effect=false)
);

create unique index if not exists a2_browser_device_enrollment_live_uq
  on public.compute_fabric_a2_browser_device_enrollment_request_h205f22(client_id,key_fingerprint_sha256)
  where status in ('PENDING','APPROVED');

create index if not exists a2_browser_device_enrollment_status_idx
  on public.compute_fabric_a2_browser_device_enrollment_request_h205f22(status,expires_at,requested_at);

alter table public.compute_fabric_a2_browser_device_enrollment_request_h205f22 enable row level security;
revoke all on table public.compute_fabric_a2_browser_device_enrollment_request_h205f22
  from public,anon,authenticated;
grant select,insert,update on table public.compute_fabric_a2_browser_device_enrollment_request_h205f22
  to service_role;

create or replace function public.h205f22_a2_browser_device_enrollment_approve_v1(
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_pairing_hash text := encode(extensions.gen_random_bytes(32),'hex');
  v_request public.compute_fabric_a2_browser_device_enrollment_request_h205f22%rowtype;
begin
  if p_request_id is null then
    return jsonb_build_object('accepted',false,'reason','REQUEST_ID_REQUIRED','authority_effect',false);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('METAENGINE_A2_DEVICE_ENROLLMENT_APPROVE'),
    pg_catalog.hashtext(p_request_id::text)
  );

  update public.compute_fabric_a2_browser_device_enrollment_request_h205f22
     set status = case when expires_at<=v_now then 'EXPIRED' else 'APPROVED' end,
         approved_at = case when expires_at>v_now then coalesce(approved_at,v_now) else approved_at end,
         approved_pairing_token_hash = case when expires_at>v_now then coalesce(approved_pairing_token_hash,v_pairing_hash) else approved_pairing_token_hash end,
         authority_effect = false
   where request_id=p_request_id
     and status in ('PENDING','APPROVED')
  returning * into v_request;

  if not found then
    select * into v_request
      from public.compute_fabric_a2_browser_device_enrollment_request_h205f22
     where request_id=p_request_id;
    if not found then
      return jsonb_build_object('accepted',false,'reason','REQUEST_NOT_FOUND','authority_effect',false);
    end if;
  end if;

  if v_request.status='EXPIRED' or v_request.expires_at<=v_now then
    update public.compute_fabric_a2_browser_device_enrollment_request_h205f22
       set status='EXPIRED',authority_effect=false
     where request_id=v_request.request_id and status in ('PENDING','APPROVED');
    return jsonb_build_object('accepted',false,'request_id',v_request.request_id,'status','EXPIRED','reason','REQUEST_EXPIRED','authority_effect',false);
  end if;

  if v_request.status<>'APPROVED' then
    return jsonb_build_object('accepted',false,'request_id',v_request.request_id,'status',v_request.status,'reason','REQUEST_NOT_APPROVABLE','authority_effect',false);
  end if;

  insert into public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(
    token_hash,label,active,created_at,last_used_at
  ) values (
    v_request.approved_pairing_token_hash,
    'native-device-enrollment',
    true,
    v_now,
    null
  )
  on conflict(token_hash) do update set active=true;

  return jsonb_build_object(
    'accepted',true,
    'request_id',v_request.request_id,
    'client_id',v_request.client_id,
    'status','APPROVED',
    'approved_at',v_request.approved_at,
    'authority_effect',false
  );
end
$function$;

create or replace function public.h205f22_a2_browser_device_enrollment_reject_v1(
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text;
begin
  update public.compute_fabric_a2_browser_device_enrollment_request_h205f22
     set status='REJECTED',
         rejected_at=coalesce(rejected_at,clock_timestamp()),
         approved_pairing_token_hash=null,
         authority_effect=false
   where request_id=p_request_id
     and status in ('PENDING','APPROVED')
  returning status into v_status;

  if not found then
    select status into v_status
      from public.compute_fabric_a2_browser_device_enrollment_request_h205f22
     where request_id=p_request_id;
    if not found then
      return jsonb_build_object('accepted',false,'reason','REQUEST_NOT_FOUND','authority_effect',false);
    end if;
  end if;

  return jsonb_build_object(
    'accepted',v_status='REJECTED',
    'request_id',p_request_id,
    'status',v_status,
    'authority_effect',false
  );
end
$function$;

create or replace function public.h205f22_a2_browser_device_activate_approved_v1(
  p_request_id uuid,
  p_client_id text,
  p_profile text,
  p_key_fingerprint_sha256 text,
  p_public_jwk jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_request public.compute_fabric_a2_browser_device_enrollment_request_h205f22%rowtype;
  v_enrolled jsonb;
  v_device_id uuid;
begin
  if p_request_id is null then
    return jsonb_build_object('accepted',false,'reason','REQUEST_ID_REQUIRED','authority_effect',false);
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('METAENGINE_A2_DEVICE_ENROLLMENT_ACTIVATE'),
    pg_catalog.hashtext(p_request_id::text)
  );

  select * into v_request
    from public.compute_fabric_a2_browser_device_enrollment_request_h205f22
   where request_id=p_request_id
   for update;

  if not found then
    return jsonb_build_object('accepted',false,'reason','REQUEST_NOT_FOUND','authority_effect',false);
  end if;

  if v_request.status='CLAIMED' and v_request.device_id is not null then
    return jsonb_build_object(
      'accepted',true,'reason','ALREADY_CLAIMED','request_id',v_request.request_id,
      'device_id',v_request.device_id,'status','CLAIMED',
      'key_fingerprint_sha256',v_request.key_fingerprint_sha256,'authority_effect',false
    );
  end if;

  if v_request.expires_at<=v_now then
    update public.compute_fabric_a2_browser_device_enrollment_request_h205f22
       set status='EXPIRED',authority_effect=false
     where request_id=v_request.request_id and status in ('PENDING','APPROVED');
    return jsonb_build_object('accepted',false,'reason','REQUEST_EXPIRED','request_id',v_request.request_id,'status','EXPIRED','authority_effect',false);
  end if;

  if v_request.status<>'APPROVED'
     or v_request.approved_pairing_token_hash is null
     or v_request.client_id<>p_client_id
     or v_request.profile<>p_profile
     or v_request.key_fingerprint_sha256<>p_key_fingerprint_sha256
     or v_request.public_jwk<>p_public_jwk
  then
    return jsonb_build_object('accepted',false,'reason','REQUEST_BINDING_MISMATCH','request_id',v_request.request_id,'status',v_request.status,'authority_effect',false);
  end if;

  v_enrolled := public.h205f22_a2_browser_device_enroll_v1(
    p_client_id,p_profile,p_public_jwk,p_key_fingerprint_sha256,v_request.approved_pairing_token_hash
  );

  if coalesce((v_enrolled->>'accepted')::boolean,false) is not true
     or nullif(v_enrolled->>'device_id','') is null
  then
    return coalesce(v_enrolled,'{}'::jsonb) || jsonb_build_object(
      'request_id',v_request.request_id,
      'status','APPROVED',
      'authority_effect',false
    );
  end if;

  v_device_id := (v_enrolled->>'device_id')::uuid;

  update public.compute_fabric_a2_browser_device_enrollment_request_h205f22
     set status='CLAIMED',
         device_id=v_device_id,
         claimed_at=v_now,
         authority_effect=false
   where request_id=v_request.request_id;

  return v_enrolled || jsonb_build_object(
    'request_id',v_request.request_id,
    'status','CLAIMED',
    'authority_effect',false
  );
end
$function$;

revoke all on function public.h205f22_a2_browser_device_enrollment_approve_v1(uuid)
  from public,anon,authenticated;
revoke all on function public.h205f22_a2_browser_device_enrollment_reject_v1(uuid)
  from public,anon,authenticated;
revoke all on function public.h205f22_a2_browser_device_activate_approved_v1(uuid,text,text,text,jsonb)
  from public,anon,authenticated;

grant execute on function public.h205f22_a2_browser_device_enrollment_approve_v1(uuid)
  to service_role;
grant execute on function public.h205f22_a2_browser_device_enrollment_reject_v1(uuid)
  to service_role;
grant execute on function public.h205f22_a2_browser_device_activate_approved_v1(uuid,text,text,text,jsonb)
  to service_role;
