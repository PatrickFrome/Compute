-- METAENGINE Browser / DevOS transport-promotion ACL remediation dry-run.
--
-- Source-only safety plan. This script MUST NOT be converted into an auto-applied
-- migration until staging proves the intended service-role caller and smoke tests.
-- It always ROLLBACKs. A production change window may copy the exact REVOKE/GRANT
-- statements only after direct-connection preflight and rollback review.

begin;

-- Keep exact overload identities in one relation so every catalog proof uses
-- the same allowlist rather than repeating name-only predicates.
create temporary table browser_fabric_acl_target_v1 (
  function_name text primary key,
  identity_arguments text not null
) on commit drop;

insert into browser_fabric_acl_target_v1(function_name, identity_arguments)
values
  ('devos_transport_promotion_lease_v1',
   'p_workspace uuid, p_client text, p_agent text, p_tab text, p_target text, p_epoch bigint'),
  ('devos_transport_promotion_release_v1',
   'p_workspace uuid, p_client text, p_lease uuid, p_agent text, p_tab text, p_target text, p_epoch bigint');

-- 1. Fail closed if exact SECURITY DEFINER identities, owner, target roles, or
-- pre-state drifted. The resolved OID is reused for every later assertion.
create temporary table browser_fabric_acl_resolved_v1 on commit drop as
select p.oid as function_oid,
       n.nspname as function_schema,
       p.proname as function_name,
       p.proowner as owner_oid,
       p.proacl
from browser_fabric_acl_target_v1 t
join pg_proc p
  on p.proname = t.function_name
 and pg_get_function_identity_arguments(p.oid) = t.identity_arguments
join pg_namespace n
  on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef;

do $$
declare
  v_target_count integer;
  v_wrong_owner_count integer;
  v_public_execute_count integer;
begin
  select count(*) into v_target_count
  from browser_fabric_acl_resolved_v1;
  if v_target_count <> 2 then
    raise exception 'browser_fabric_acl_preflight_function_identity_drift:%', v_target_count;
  end if;

  select count(*) into v_wrong_owner_count
  from browser_fabric_acl_resolved_v1 target
  join pg_roles owner_role on owner_role.oid = target.owner_oid
  where owner_role.rolname <> 'postgres';
  if v_wrong_owner_count <> 0 then
    raise exception 'browser_fabric_acl_preflight_owner_drift:%', v_wrong_owner_count;
  end if;

  select count(*) into v_public_execute_count
  from browser_fabric_acl_resolved_v1 target
  where exists (
    select 1
    from aclexplode(coalesce(target.proacl, acldefault('f', target.owner_oid))) acl
    where acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  );
  if v_public_execute_count <> 2 then
    raise exception 'browser_fabric_acl_preflight_public_execute_drift:%', v_public_execute_count;
  end if;

  if not exists (
    select 1
    from pg_roles
    where rolname = 'service_role'
  ) then
    raise exception 'browser_fabric_acl_preflight_service_role_missing';
  end if;
end $$;

-- 2. Exact proposed production ACL transition. Explicit API-role revokes make
-- the result safe even if a role-specific grant was added after the audit.
revoke execute on function public.devos_transport_promotion_lease_v1(uuid,text,text,text,text,bigint) from public;
revoke execute on function public.devos_transport_promotion_lease_v1(uuid,text,text,text,text,bigint) from anon, authenticated;
revoke execute on function public.devos_transport_promotion_release_v1(uuid,text,uuid,text,text,text,bigint) from public;
revoke execute on function public.devos_transport_promotion_release_v1(uuid,text,uuid,text,text,text,bigint) from anon, authenticated;
grant execute on function public.devos_transport_promotion_lease_v1(uuid,text,text,text,text,bigint) to service_role;
grant execute on function public.devos_transport_promotion_release_v1(uuid,text,uuid,text,text,text,bigint) to service_role;

-- 3. Dry-run post-state proof: PUBLIC/anon/authenticated must be absent and
-- service_role must have exact EXECUTE on both resolved overloads.
do $$
declare
  v_untrusted_execute_count integer;
  v_service_execute_count integer;
begin
  select count(*) into v_untrusted_execute_count
  from browser_fabric_acl_resolved_v1 target
  where exists (
    select 1
    from aclexplode(coalesce(
      (select p.proacl from pg_proc p where p.oid = target.function_oid),
      acldefault('f', target.owner_oid)
    )) acl
    left join pg_roles grantee_role on grantee_role.oid = acl.grantee
    where (acl.grantee = 0 or grantee_role.rolname in ('anon', 'authenticated'))
      and acl.privilege_type = 'EXECUTE'
  );
  if v_untrusted_execute_count <> 0 then
    raise exception 'browser_fabric_acl_dry_run_untrusted_execute_remains:%', v_untrusted_execute_count;
  end if;

  select count(*) into v_service_execute_count
  from browser_fabric_acl_resolved_v1 target
  where has_function_privilege(
    'service_role',
    target.function_oid,
    'EXECUTE'
  );
  if v_service_execute_count <> 2 then
    raise exception 'browser_fabric_acl_dry_run_service_role_missing:%', v_service_execute_count;
  end if;
end $$;

select target.function_name,
       case
         when acl.grantee = 0 then 'PUBLIC'
         else coalesce(grantee_role.rolname, acl.grantee::text)
       end as grantee,
       acl.privilege_type,
       acl.is_grantable
from browser_fabric_acl_resolved_v1 target
join pg_proc p on p.oid = target.function_oid
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
left join pg_roles grantee_role on grantee_role.oid = acl.grantee
order by target.function_name, grantee;

-- 4. Production rollback is not inferred here. A future committed change must
-- persist the exact pre-change proacl receipt and provide a reviewed restoration
-- script for those bytes. This transaction itself restores that pre-state.
--
-- Required production-window evidence before a separately reviewed COMMIT:
--   * direct Postgres connection proves service_role can execute exact RPCs;
--   * anon/authenticated/PUBLIC execution is denied;
--   * owner/device/target/generation binding remains exact;
--   * exact pre-change ACL and post-change receipts are captured;
--   * Supabase security advisors are re-read after DDL.

rollback;
