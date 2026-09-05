-- READ-ONLY preflight for the legacy transport-promotion SECURITY DEFINER surface.
-- Run with a direct database connection before the separate production change window.
-- Expected current drift at the 2026-09-05 audit follow-up: both functions SECURITY DEFINER
-- and executable through PUBLIC. This script intentionally changes nothing.

begin transaction read only;

with targets(signature) as (
  values
    ('public.devos_transport_promotion_lease_v1(text,text,integer,text,text,integer,integer)'::text),
    ('public.devos_transport_promotion_release_v1(text,text,text)'::text)
), resolved as (
  select signature, to_regprocedure(signature) as oid
  from targets
)
select
  signature,
  oid is not null as exists,
  case when oid is null then null else (select p.prosecdef from pg_proc p where p.oid = resolved.oid) end as security_definer,
  case when oid is null then null else has_function_privilege('public', oid, 'execute') end as public_execute,
  case when oid is null then null else has_function_privilege('anon', oid, 'execute') end as anon_execute,
  case when oid is null then null else has_function_privilege('authenticated', oid, 'execute') end as authenticated_execute,
  case when oid is null then null else has_function_privilege('service_role', oid, 'execute') end as service_role_execute
from resolved
order by signature;

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_args,
  p.prosecdef as security_definer,
  pg_get_userbyid(p.proowner) as owner,
  p.proconfig as function_gucs
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.oid in (
  to_regprocedure('public.devos_transport_promotion_lease_v1(text,text,integer,text,text,integer,integer)'),
  to_regprocedure('public.devos_transport_promotion_release_v1(text,text,text)')
)
order by p.proname;

rollback;
