-- PRODUCTION CHANGE-WINDOW SCRIPT. NOT A MIGRATION.
-- Preconditions:
-- 1) legacy callers were replaced and smoke-tested against the intended service-role path;
-- 2) direct-connection preflight output was reviewed;
-- 3) rollback script is immediately available;
-- 4) operator explicitly enables this session-local guard:
--      set metaengine.promotion_rpc_caller_migration_proven = 'on';
--
-- The guard exists so copying this file into a console cannot silently revoke the legacy path.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

DO $guard$
begin
  if coalesce(current_setting('metaengine.promotion_rpc_caller_migration_proven', true), 'off') <> 'on' then
    raise exception using
      errcode = '55000',
      message = 'promotion_rpc_caller_migration_not_proven';
  end if;

  if to_regprocedure('public.devos_transport_promotion_lease_v1(text,text,integer,text,text,integer,integer)') is null
     or to_regprocedure('public.devos_transport_promotion_release_v1(text,text,text)') is null then
    raise exception using
      errcode = '42704',
      message = 'promotion_rpc_expected_signature_missing';
  end if;
end
$guard$;

revoke execute on function public.devos_transport_promotion_lease_v1(text,text,integer,text,text,integer,integer)
  from public, anon, authenticated;
revoke execute on function public.devos_transport_promotion_release_v1(text,text,text)
  from public, anon, authenticated;

grant execute on function public.devos_transport_promotion_lease_v1(text,text,integer,text,text,integer,integer)
  to service_role;
grant execute on function public.devos_transport_promotion_release_v1(text,text,text)
  to service_role;

DO $proof$
declare
  lease_oid oid := to_regprocedure('public.devos_transport_promotion_lease_v1(text,text,integer,text,text,integer,integer)');
  release_oid oid := to_regprocedure('public.devos_transport_promotion_release_v1(text,text,text)');
begin
  if has_function_privilege('public', lease_oid, 'execute')
     or has_function_privilege('anon', lease_oid, 'execute')
     or has_function_privilege('authenticated', lease_oid, 'execute')
     or has_function_privilege('public', release_oid, 'execute')
     or has_function_privilege('anon', release_oid, 'execute')
     or has_function_privilege('authenticated', release_oid, 'execute') then
    raise exception using errcode = '42501', message = 'promotion_rpc_low_privilege_execute_still_present';
  end if;

  if not has_function_privilege('service_role', lease_oid, 'execute')
     or not has_function_privilege('service_role', release_oid, 'execute') then
    raise exception using errcode = '42501', message = 'promotion_rpc_service_role_execute_missing';
  end if;
end
$proof$;

commit;

-- Required post-change smoke proof is external to this transaction:
-- service-role lease -> exact readback -> release, while anon/authenticated calls must fail.
