create table if not exists destruktion_meta.compute_fabric_vercel_gateway_key_receipt_h205f22 (
  receipt_id bigint generated always as identity primary key,
  vercel_key_id text not null unique,
  vercel_key_name text not null,
  team_id text not null,
  api_key_sha256 text not null check (api_key_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false)
);

revoke all on destruktion_meta.compute_fabric_vercel_gateway_key_receipt_h205f22 from public, anon, authenticated, service_role;

create or replace function public.h205f22_aop1_vercel_gateway_bootstrap_input_v1()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, destruktion_meta, vault, extensions
as $$
declare
  v_token text;
  v_existing boolean;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name='aop1_vercel_access_token';
  if v_token is null or char_length(v_token) < 20 then
    raise exception 'vercel_access_token_unavailable' using errcode='55000';
  end if;
  select exists(select 1 from vault.decrypted_secrets where name='aop1_vercel_ai_gateway_key') into v_existing;
  return jsonb_build_object(
    'schema','metaengine.compute.vercel-gateway-bootstrap-input.h205f22.v1',
    'vercel_access_token',v_token,
    'team_id','team_XUDkuhwa1WDsfM7IRPrbKv7c',
    'key_name','metaengine-h205f22-duel-gateway',
    'already_provisioned',v_existing,
    'canonical',false,
    'authority_effect',false
  );
end $$;

create or replace function public.h205f22_aop1_store_vercel_gateway_key_v1(
  p_vercel_key_id text,
  p_api_key text,
  p_key_name text default 'metaengine-h205f22-duel-gateway'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, destruktion_meta, vault, extensions
as $$
declare
  v_secret_id uuid;
  v_sha text;
begin
  if p_vercel_key_id is null or char_length(p_vercel_key_id) < 3 or char_length(p_vercel_key_id) > 256 then
    raise exception 'invalid_vercel_key_id' using errcode='22023';
  end if;
  if p_api_key is null or char_length(p_api_key) < 20 or char_length(p_api_key) > 4096 then
    raise exception 'invalid_vercel_gateway_api_key' using errcode='22023';
  end if;
  if p_key_name is null or char_length(p_key_name) < 3 or char_length(p_key_name) > 256 then
    raise exception 'invalid_vercel_key_name' using errcode='22023';
  end if;
  v_sha := encode(extensions.digest(convert_to(p_api_key,'UTF8'),'sha256'),'hex');
  select id into v_secret_id from vault.decrypted_secrets where name='aop1_vercel_ai_gateway_key';
  if v_secret_id is null then
    perform vault.create_secret(p_api_key,'aop1_vercel_ai_gateway_key','Vercel AI Gateway API key for H205F22 dual-rail duel inference',null);
  else
    perform vault.update_secret(v_secret_id,p_api_key,'aop1_vercel_ai_gateway_key','Vercel AI Gateway API key for H205F22 dual-rail duel inference',null);
  end if;
  insert into destruktion_meta.compute_fabric_vercel_gateway_key_receipt_h205f22(vercel_key_id,vercel_key_name,team_id,api_key_sha256)
  values(p_vercel_key_id,p_key_name,'team_XUDkuhwa1WDsfM7IRPrbKv7c',v_sha)
  on conflict (vercel_key_id) do update set
    vercel_key_name=excluded.vercel_key_name,
    api_key_sha256=excluded.api_key_sha256,
    created_at=clock_timestamp();
  return jsonb_build_object(
    'schema','metaengine.compute.vercel-gateway-key-receipt.h205f22.v1',
    'vercel_key_id',p_vercel_key_id,
    'key_name',p_key_name,
    'api_key_sha256',v_sha,
    'stored',true,
    'canonical',false,
    'authority_effect',false
  );
end $$;

revoke all on function public.h205f22_aop1_vercel_gateway_bootstrap_input_v1() from public, anon, authenticated;
revoke all on function public.h205f22_aop1_store_vercel_gateway_key_v1(text,text,text) from public, anon, authenticated;
grant execute on function public.h205f22_aop1_vercel_gateway_bootstrap_input_v1() to service_role;
grant execute on function public.h205f22_aop1_store_vercel_gateway_key_v1(text,text,text) to service_role;
