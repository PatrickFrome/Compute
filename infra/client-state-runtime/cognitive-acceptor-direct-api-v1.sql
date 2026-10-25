-- The restricted direct API can call the bounded ingress RPC, but must never
-- receive cursor-table access. Elevate only the exact reviewed function body.
-- An unknown definition, changed owner or public exposure requires review.
do $cognitive_direct_api$
declare
  f record;
  cursor_relation record;
begin
  select p.*, l.lanname into f
    from pg_catalog.pg_proc p join pg_catalog.pg_language l on l.oid=p.prolang
    where p.oid=pg_catalog.to_regprocedure('public.h205f22_a2_browser_cognitive_accept_v1(uuid,text,text,uuid,bigint,bigint,jsonb,boolean)');
  if not found then
    raise exception 'cognitive_direct_api_reviewed_rpc_missing' using errcode='55000';
  end if;
  select c.relowner,c.relkind,c.relrowsecurity,c.relforcerowsecurity into cursor_relation
    from pg_catalog.pg_class c where c.oid=pg_catalog.to_regclass('public.compute_fabric_a2_browser_cognitive_cursor_h205f22');
  if not found or cursor_relation.relowner<>f.proowner or cursor_relation.relkind not in ('r','p')
    or not cursor_relation.relrowsecurity or cursor_relation.relforcerowsecurity then
    raise exception 'cognitive_direct_api_table_owner_requires_review' using errcode='55000';
  end if;
  if f.prokind<>'f' or f.lanname<>'plpgsql' or f.provolatile<>'v'
    or f.proretset or f.prorettype<>'jsonb'::pg_catalog.regtype
    or f.pronargs<>8 or f.pronargdefaults<>1 or f.provariadic<>0 or f.proargmodes is not null
    or f.proconfig is distinct from array['search_path=pg_catalog']::text[]
    or pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.replace(f.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex')
      <>'7398ddccedee15a20dd83b46f6336713072670f7ec3fe2318a1774f2a6fe22db' then
    raise exception 'cognitive_direct_api_existing_body_requires_review' using errcode='55000';
  end if;
  if exists (select 1 from pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a
    where a.privilege_type='EXECUTE' and (a.grantee=0 or a.grantee in
      (select oid from pg_catalog.pg_roles where rolname in ('anon','authenticated')))) then
    raise exception 'cognitive_direct_api_public_execution_requires_review' using errcode='55000';
  end if;
  if not f.prosecdef then
    alter function public.h205f22_a2_browser_cognitive_accept_v1(uuid,text,text,uuid,bigint,bigint,jsonb,boolean) security definer;
  end if;
end;
$cognitive_direct_api$;
