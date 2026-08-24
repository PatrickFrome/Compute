create or replace function public.h205f22_aop1_vercel_gateway_key_receipt_v1()
returns jsonb
language sql
security definer
set search_path = pg_catalog, destruktion_meta
as $$
  select coalesce(
    (select jsonb_build_object(
      'schema','metaengine.compute.vercel-gateway-key-receipt.h205f22.v1',
      'vercel_key_id',r.vercel_key_id,
      'key_name',r.vercel_key_name,
      'team_id',r.team_id,
      'api_key_sha256',r.api_key_sha256,
      'created_at',r.created_at,
      'canonical',false,
      'authority_effect',false
    ) from destruktion_meta.compute_fabric_vercel_gateway_key_receipt_h205f22 r order by r.receipt_id desc limit 1),
    jsonb_build_object('schema','metaengine.compute.vercel-gateway-key-receipt.h205f22.v1','provisioned',false,'canonical',false,'authority_effect',false)
  )
$$;

revoke all on function public.h205f22_aop1_vercel_gateway_key_receipt_v1() from public, anon, authenticated;
grant execute on function public.h205f22_aop1_vercel_gateway_key_receipt_v1() to service_role;
