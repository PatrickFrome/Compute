-- Narrow the privileged coordination read barrier to trusted server ingress.
--
-- Evidence class: LIVE only after this migration is applied and the ACL is
-- read back from pg_proc/has_function_privilege.  Repository and CI execution
-- alone remain PREPARE_ONLY.

revoke execute on function public.coordination_read_barrier_h205f22()
  from public, anon, authenticated;

grant execute on function public.coordination_read_barrier_h205f22()
  to service_role;
