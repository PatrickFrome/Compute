-- METAENGINE supervisor mesh RLS hardening.
-- Branch-local only until evidence-gated promotion.
-- Existing mesh RPCs are SECURITY DEFINER and direct table access was already revoked from PUBLIC.
-- Enabling RLS here closes PostgREST exposure while preserving owner/service-role execution paths.

alter table public.compute_fabric_a2_supervisor_mesh_instance_h205f22
  enable row level security;

alter table public.compute_fabric_a2_supervisor_actuation_lease_h205f22
  enable row level security;

revoke all on table public.compute_fabric_a2_supervisor_mesh_instance_h205f22 from anon, authenticated;
revoke all on table public.compute_fabric_a2_supervisor_actuation_lease_h205f22 from anon, authenticated;

comment on table public.compute_fabric_a2_supervisor_mesh_instance_h205f22
is 'Supervisor mesh registry. RLS enabled fail-closed; direct anon/authenticated table access is forbidden. Access is only through trusted server-side SECURITY DEFINER RPCs or service-role maintenance.';

comment on table public.compute_fabric_a2_supervisor_actuation_lease_h205f22
is 'Shared Browser actuation lease. RLS enabled fail-closed; direct anon/authenticated table access is forbidden. Lease effects remain mediated by trusted server-side SECURITY DEFINER RPCs.';
