-- FRESH DATABASE ONLY. Apply after the selected baseline and registered upgrades,
-- inside the private owner's original empty-database transaction. This is NOT an
-- upgrade migration and must never revoke permissions on an attached user DB.
-- The direct API role is provisioned afterward by db-api-grants.mjs. Private
-- enrollment approval stays callable only by the actual state_owner owner.
do $fresh_acl$
begin
  if current_user <> 'state_owner' or session_user <> 'state_owner' then
    raise exception 'fresh_schema_private_owner_required' using errcode='42501';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    join pg_catalog.pg_roles r on r.oid=p.proowner
    where n.nspname in ('public','destruktion_meta') and r.rolname <> 'state_owner'
      and not exists (select 1 from pg_catalog.pg_depend d
        where d.classid='pg_catalog.pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
  ) then
    raise exception 'fresh_schema_foreign_function_owner' using errcode='42501';
  end if;
end
$fresh_acl$;

revoke all on all functions in schema public, destruktion_meta from public, anon, authenticated, service_role;
revoke all on all tables in schema public, destruktion_meta from public, anon, authenticated, service_role;
revoke all on all sequences in schema public, destruktion_meta from public, anon, authenticated, service_role;
-- Per-schema REVOKE cannot cancel PostgreSQL's global default PUBLIC grant.
-- This owner is created only for the fresh isolated application database.
alter default privileges for role state_owner revoke execute on functions from public;
