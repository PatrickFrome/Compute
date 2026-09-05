-- METAENGINE Browser / DevOS transport-promotion ACL remediation dry-run.
--
-- Source-only safety plan. This script MUST NOT be converted into an auto-applied
-- migration until staging proves the intended service-role caller and smoke tests.
-- It always ROLLBACKs. A production change window may copy the exact REVOKE/GRANT
-- statements only after direct-connection preflight and rollback review.
--
-- Live catalog finding at 2026-09-05 audit follow-up:
--   public.devos_transport_promotion_lease_v1   SECURITY DEFINER + PUBLIC EXECUTE
--   public.devos_transport_promotion_release_v1 SECURITY DEFINER + PUBLIC EXECUTE
-- All other inspected public SECURITY DEFINER functions had PUBLIC EXECUTE revoked.

begin;

-- 1. Fail closed if the exact function identities drifted.
do $$
declare
  v_count integer;
  v_public integer;
  v_owner integer;
begin
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and (
      (p.proname = 'devos_transport_promotion_lease_v1'
       and pg_get_function_identity_arguments(p.oid) = 'p_workspace uuid, p_client text, p_agent text, p_tab text, p_target text, p_epoch bigint')
      or
      (p.proname = 'devos_transport_promotion_release_v1'
       and pg_get_function_identity_arguments(p.oid) = 'p_workspace uuid, p_client text, p_lease uuid, p_agent text, p_tab text, p_target text, p_epoch bigint')
    );
  if v_count <> 2 then
    raise exception 'browser_fabric_acl_preflight_function_identity_drift:%', v_count;
  end if;

  select count(*) into v_owner
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public'
    and p.proname in ('devos_transport_promotion_lease_v1','devos_transport_promotion_release_v1')
    and r.rolname = 'postgres';
  if v_owner <> 2 then
    raise exception 'browser_fabric_acl_preflight_owner_drift:%', v_owner;
  end if;

  select count(*) into v_public
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('devos_transport_promotion_lease_v1','devos_transport_promotion_release_v1')
    and exists (
      select 1
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE'
    );
  if v_public <> 2 then
    raise exception 'browser_fabric_acl_preflight_public_execute_drift:%', v_public;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'browser_fabric_acl_preflight_service_role_missing';
  end if;
end $$;

-- 2. Exact proposed production ACL transition.
revoke execute on function public.devos_transport_promotion_lease_v1(uuid,text,text,text,text,bigint) from public;
revoke execute on function public.devos_transport_promotion_release_v1(uuid,text,uuid,text,text,text,bigint) from public;
grant execute on function public.devos_transport_promotion_lease_v1(uuid,text,text,text,text,bigint) to service_role;
grant execute on function public.devos_transport_promotion_release_v1(uuid,text,uuid,text,text,text,bigint) to service_role;

-- 3. Dry-run post-state proof: PUBLIC must be absent, service_role exact.
select p.proname as function_name,
       case when a.grantee = 0 then 'PUBLIC' else coalesce(r.rolname, a.grantee::text) end as grantee,
       a.privilege_type,
       a.is_grantable
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
left join pg_roles r on r.oid = a.grantee
where n.nspname = 'public'
  and p.proname in ('devos_transport_promotion_lease_v1','devos_transport_promotion_release_v1')
order by p.proname, grantee;

do $$
declare
  v_public integer;
  v_service integer;
begin
  select count(*) into v_public
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('devos_transport_promotion_lease_v1','devos_transport_promotion_release_v1')
    and exists (
      select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE'
    );
  if v_public <> 0 then
    raise exception 'browser_fabric_acl_dry_run_public_execute_remains:%', v_public;
  end if;

  select count(*) into v_service
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('devos_transport_promotion_lease_v1','devos_transport_promotion_release_v1')
    and exists (
      select 1
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      join pg_roles rr on rr.oid = a.grantee
      where rr.rolname = 'service_role' and a.privilege_type = 'EXECUTE'
    );
  if v_service <> 2 then
    raise exception 'browser_fabric_acl_dry_run_service_role_missing:%', v_service;
  end if;
end $$;

-- 4. Production rollback SQL, intentionally NOT executed because this file rolls
-- back the entire dry-run transaction:
--   revoke execute on function public.devos_transport_promotion_lease_v1(uuid,text,text,text,text,bigint) from service_role;
--   revoke execute on function public.devos_transport_promotion_release_v1(uuid,text,uuid,text,text,text,bigint) from service_role;
--   grant execute on function public.devos_transport_promotion_lease_v1(uuid,text,text,text,text,bigint) to public;
--   grant execute on function public.devos_transport_promotion_release_v1(uuid,text,uuid,text,text,text,bigint) to public;
--
-- Required production-window evidence before COMMIT in a future migration:
--   * direct Postgres connection proves service_role can execute exact RPCs;
--   * anon/authenticated/PUBLIC execution is denied;
--   * owner/device/target/generation binding remains exact;
--   * release/rollback receipt is captured;
--   * Supabase security advisors are re-read after DDL.

rollback;
