create table if not exists destruktion_meta.compute_fabric_aop_bootstrap_capability_h205f22 (
  capability_id uuid primary key default gen_random_uuid(),
  capability_sha256 text not null unique check (capability_sha256 ~ '^[0-9a-f]{64}$'),
  scope text not null check (scope in ('GITHUB_OIDC_LIVE_DEPLOY')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false)
);

alter table destruktion_meta.compute_fabric_aop_bootstrap_capability_h205f22 enable row level security;
revoke all on destruktion_meta.compute_fabric_aop_bootstrap_capability_h205f22 from public, anon, authenticated;

create or replace function public.h205f22_aop1_consume_bootstrap_bundle_v1(p_capability text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, vault, destruktion_meta
as $$
declare
  v_hash text;
  v_row destruktion_meta.compute_fabric_aop_bootstrap_capability_h205f22%rowtype;
  v_bundle jsonb;
begin
  if p_capability is null or length(p_capability) < 32 then
    raise exception 'bootstrap_capability_invalid' using errcode='28000';
  end if;

  v_hash := encode(extensions.digest(p_capability,'sha256'),'hex');
  select * into v_row
  from destruktion_meta.compute_fabric_aop_bootstrap_capability_h205f22
  where capability_sha256=v_hash and scope='GITHUB_OIDC_LIVE_DEPLOY'
  for update;

  if not found then raise exception 'bootstrap_capability_invalid' using errcode='28000'; end if;
  if v_row.used_at is not null then raise exception 'bootstrap_capability_consumed' using errcode='55000'; end if;
  if v_row.expires_at <= clock_timestamp() then raise exception 'bootstrap_capability_expired' using errcode='55000'; end if;

  select jsonb_build_object(
    'cloudflare_api_token', max(decrypted_secret) filter (where name='aop1_cloudflare_api_token'),
    'cloudflare_account_id', max(decrypted_secret) filter (where name='aop1_cloudflare_account_id'),
    'cloudflare_ai_token', max(decrypted_secret) filter (where name='aop1_cloudflare_ai_token'),
    'supabase_service_role', max(decrypted_secret) filter (where name='aop1_supabase_service_role'),
    'supervisor_token', max(decrypted_secret) filter (where name='aop1_supervisor_token'),
    'wake_secret', max(decrypted_secret) filter (where name='aop1_wake_secret')
  ) into v_bundle
  from vault.decrypted_secrets
  where name in (
    'aop1_cloudflare_api_token','aop1_cloudflare_account_id','aop1_cloudflare_ai_token',
    'aop1_supabase_service_role','aop1_supervisor_token','aop1_wake_secret'
  );

  if v_bundle is null
     or v_bundle->>'cloudflare_api_token' is null
     or v_bundle->>'cloudflare_account_id' is null
     or v_bundle->>'cloudflare_ai_token' is null
     or v_bundle->>'supabase_service_role' is null
     or v_bundle->>'supervisor_token' is null
     or v_bundle->>'wake_secret' is null then
    raise exception 'bootstrap_bundle_incomplete' using errcode='55000';
  end if;

  update destruktion_meta.compute_fabric_aop_bootstrap_capability_h205f22
  set used_at=clock_timestamp()
  where capability_id=v_row.capability_id;

  return v_bundle;
end $$;

revoke all on function public.h205f22_aop1_consume_bootstrap_bundle_v1(text) from public, anon, authenticated;
grant execute on function public.h205f22_aop1_consume_bootstrap_bundle_v1(text) to service_role;
