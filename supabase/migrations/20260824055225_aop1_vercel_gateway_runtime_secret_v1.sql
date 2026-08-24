create or replace function public.h205f22_aop1_vercel_gateway_runtime_secret_v1()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, vault, extensions
as $$
declare
  v_key text;
  v_sha text;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name='aop1_vercel_ai_gateway_key';

  if v_key is null or char_length(v_key) < 20 then
    raise exception 'vercel_gateway_key_unavailable' using errcode='55000';
  end if;

  v_sha := encode(extensions.digest(convert_to(v_key,'UTF8'),'sha256'),'hex');

  return jsonb_build_object(
    'schema','metaengine.compute.vercel-gateway-runtime-secret.h205f22.v1',
    'vercel_ai_gateway_api_key',v_key,
    'api_key_sha256',v_sha,
    'canonical',false,
    'authority_effect',false
  );
end $$;

revoke all on function public.h205f22_aop1_vercel_gateway_runtime_secret_v1() from public, anon, authenticated;
grant execute on function public.h205f22_aop1_vercel_gateway_runtime_secret_v1() to service_role;
