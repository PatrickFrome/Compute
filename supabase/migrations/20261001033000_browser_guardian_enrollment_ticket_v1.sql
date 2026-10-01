-- METAENGINE Browser Guardian enrollment ticket v1.
--
-- A short-lived single-use bearer bridges already-approved ADMIN device identity
-- into the machine-local Guardian owner-enrollment boundary. The plaintext ticket
-- is never persisted. Guardian still derives the owner SID only from the
-- impersonated local named-pipe client; the server never accepts a caller-supplied
-- owner SID as authority.

create table if not exists public.compute_fabric_a2_browser_guardian_enrollment_ticket_h205f22 (
  ticket_id uuid primary key default pg_catalog.gen_random_uuid(),
  workspace_id uuid not null,
  client_id text not null,
  device_id uuid not null,
  key_fingerprint_sha256 text not null,
  admin_grant_epoch bigint not null,
  ticket_sha256 text not null unique,
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumer_owner_sid_sha256 text,
  authority_effect boolean not null default false,
  constraint guardian_enrollment_ticket_workspace_ck
    check (workspace_id='2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid),
  constraint guardian_enrollment_ticket_client_ck
    check (char_length(client_id) between 1 and 160),
  constraint guardian_enrollment_ticket_fingerprint_ck
    check (key_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  constraint guardian_enrollment_ticket_sha_ck
    check (ticket_sha256 ~ '^[0-9a-f]{64}$'),
  constraint guardian_enrollment_ticket_epoch_ck
    check (admin_grant_epoch >= 1),
  constraint guardian_enrollment_ticket_expiry_ck
    check (expires_at > issued_at and expires_at <= issued_at + interval '2 minutes'),
  constraint guardian_enrollment_ticket_consumer_sid_ck
    check (consumer_owner_sid_sha256 is null or consumer_owner_sid_sha256 ~ '^[0-9a-f]{64}$'),
  constraint guardian_enrollment_ticket_authority_ck
    check (authority_effect=false)
);

revoke all on public.compute_fabric_a2_browser_guardian_enrollment_ticket_h205f22
  from public, anon, authenticated;

alter table public.compute_fabric_a2_browser_guardian_enrollment_ticket_h205f22 enable row level security;

create index if not exists browser_guardian_enrollment_ticket_expiry_idx
  on public.compute_fabric_a2_browser_guardian_enrollment_ticket_h205f22(expires_at)
  where consumed_at is null;

create or replace function public.client_v1_guardian_enrollment_ticket_issue_v1(
  p_client_id text,
  p_device_id uuid,
  p_key_fingerprint_sha256 text,
  p_admin_grant_epoch bigint,
  p_ticket_sha256 text,
  p_ttl_seconds integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_workspace constant uuid := '2de9f84b-7c0a-4091-911c-894ff1d6eaf4'::uuid;
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_fingerprint text := lower(trim(coalesce(p_key_fingerprint_sha256,'')));
  v_ticket_sha text := lower(trim(coalesce(p_ticket_sha256,'')));
  v_epoch bigint := coalesce(p_admin_grant_epoch,0);
  v_ttl integer := greatest(30,least(120,coalesce(p_ttl_seconds,90)));
  v_device public.compute_fabric_a2_browser_device_h205f22%rowtype;
  v_row public.compute_fabric_a2_browser_guardian_enrollment_ticket_h205f22%rowtype;
begin
  if v_client='' then raise exception 'guardian_enrollment_ticket_client_required'; end if;
  if v_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'guardian_enrollment_ticket_fingerprint_invalid'; end if;
  if v_ticket_sha !~ '^[0-9a-f]{64}$' then raise exception 'guardian_enrollment_ticket_sha_invalid'; end if;
  if v_epoch < 1 then raise exception 'guardian_enrollment_ticket_epoch_invalid'; end if;

  select * into v_device
    from public.compute_fabric_a2_browser_device_h205f22
   where device_id=p_device_id
     and client_id=v_client
     and key_fingerprint_sha256=v_fingerprint
   limit 1 for share;
  if not found then raise exception 'guardian_enrollment_ticket_device_not_found'; end if;
  if v_device.active is not true or v_device.revoked_at is not null then
    raise exception 'guardian_enrollment_ticket_device_inactive';
  end if;
  if v_device.access_tier is distinct from 'ADMIN'
     or v_device.admin_revoked_at is not null
     or coalesce(v_device.admin_grant_epoch,0) <> v_epoch
     or jsonb_typeof(v_device.admin_scopes) is distinct from 'array'
     or (v_device.admin_scopes ? 'CONTROL_PLANE') is distinct from true then
    raise exception 'guardian_enrollment_ticket_admin_grant_invalid';
  end if;

  insert into public.compute_fabric_a2_browser_guardian_enrollment_ticket_h205f22(
    workspace_id,client_id,device_id,key_fingerprint_sha256,admin_grant_epoch,
    ticket_sha256,issued_at,expires_at,authority_effect
  ) values (
    v_workspace,v_client,p_device_id,v_fingerprint,v_epoch,
    v_ticket_sha,clock_timestamp(),clock_timestamp()+make_interval(secs=>v_ttl),false
  )
  returning * into v_row;

  return jsonb_build_object(
    'schema','metaengine.guardian-enrollment-ticket-issue.v1',
    'accepted',true,
    'ticket_id',v_row.ticket_id,
    'client_id',v_row.client_id,
    'device_id',v_row.device_id,
    'key_fingerprint_sha256',v_row.key_fingerprint_sha256,
    'admin_grant_epoch',v_row.admin_grant_epoch,
    'expires_at',v_row.expires_at,
    'single_use',true,
    'plaintext_persisted',false,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end;
$function$;

create or replace function public.client_v1_guardian_enrollment_ticket_consume_v1(
  p_ticket_sha256 text,
  p_key_fingerprint_sha256 text,
  p_owner_sid_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_ticket_sha text := lower(trim(coalesce(p_ticket_sha256,'')));
  v_fingerprint text := lower(trim(coalesce(p_key_fingerprint_sha256,'')));
  v_owner_sid_sha text := lower(trim(coalesce(p_owner_sid_sha256,'')));
  v_row public.compute_fabric_a2_browser_guardian_enrollment_ticket_h205f22%rowtype;
  v_device public.compute_fabric_a2_browser_device_h205f22%rowtype;
begin
  if v_ticket_sha !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('schema','metaengine.guardian-enrollment-ticket-redemption.v1','accepted',false,'reason','TICKET_INVALID','authority_effect',false);
  end if;
  if v_fingerprint !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('schema','metaengine.guardian-enrollment-ticket-redemption.v1','accepted',false,'reason','FINGERPRINT_INVALID','authority_effect',false);
  end if;
  if v_owner_sid_sha !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('schema','metaengine.guardian-enrollment-ticket-redemption.v1','accepted',false,'reason','OWNER_SID_PROOF_INVALID','authority_effect',false);
  end if;

  select * into v_row
    from public.compute_fabric_a2_browser_guardian_enrollment_ticket_h205f22
   where ticket_sha256=v_ticket_sha
     and key_fingerprint_sha256=v_fingerprint
     and consumed_at is null
     and expires_at > clock_timestamp()
   for update;
  if not found then
    return jsonb_build_object('schema','metaengine.guardian-enrollment-ticket-redemption.v1','accepted',false,'reason','TICKET_NOT_AVAILABLE','authority_effect',false);
  end if;

  select * into v_device
    from public.compute_fabric_a2_browser_device_h205f22
   where device_id=v_row.device_id
     and client_id=v_row.client_id
     and key_fingerprint_sha256=v_row.key_fingerprint_sha256
   limit 1 for share;
  if not found
     or v_device.active is not true
     or v_device.revoked_at is not null
     or v_device.access_tier is distinct from 'ADMIN'
     or v_device.admin_revoked_at is not null
     or coalesce(v_device.admin_grant_epoch,0) <> v_row.admin_grant_epoch
     or jsonb_typeof(v_device.admin_scopes) is distinct from 'array'
     or (v_device.admin_scopes ? 'CONTROL_PLANE') is distinct from true then
    return jsonb_build_object('schema','metaengine.guardian-enrollment-ticket-redemption.v1','accepted',false,'reason','DEVICE_GRANT_REVOKED','authority_effect',false);
  end if;

  update public.compute_fabric_a2_browser_guardian_enrollment_ticket_h205f22
     set consumed_at=clock_timestamp(),
         consumer_owner_sid_sha256=v_owner_sid_sha
   where ticket_id=v_row.ticket_id
     and consumed_at is null
     and expires_at > clock_timestamp()
  returning * into v_row;
  if not found then
    return jsonb_build_object('schema','metaengine.guardian-enrollment-ticket-redemption.v1','accepted',false,'reason','TICKET_CONSUME_CONFLICT','authority_effect',false);
  end if;

  return jsonb_build_object(
    'schema','metaengine.guardian-enrollment-ticket-redemption.v1',
    'accepted',true,
    'ticket_id',v_row.ticket_id,
    'client_id',v_row.client_id,
    'device_id',v_row.device_id,
    'key_fingerprint_sha256',v_row.key_fingerprint_sha256,
    'admin_grant_epoch',v_row.admin_grant_epoch,
    'consumer_owner_sid_sha256',v_row.consumer_owner_sid_sha256,
    'consumed_at',v_row.consumed_at,
    'single_use',true,
    'device_grant_revalidated',true,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end;
$function$;

revoke all on function public.client_v1_guardian_enrollment_ticket_issue_v1(text,uuid,text,bigint,text,integer)
  from public, anon, authenticated;
grant execute on function public.client_v1_guardian_enrollment_ticket_issue_v1(text,uuid,text,bigint,text,integer)
  to service_role;

revoke all on function public.client_v1_guardian_enrollment_ticket_consume_v1(text,text,text)
  from public, anon, authenticated;
grant execute on function public.client_v1_guardian_enrollment_ticket_consume_v1(text,text,text)
  to service_role;

comment on table public.compute_fabric_a2_browser_guardian_enrollment_ticket_h205f22 is
  'Single-use short-lived Guardian owner-enrollment tickets. Only SHA-256 ticket digests are persisted; exact ADMIN device grant is revalidated at issue and consume.';
