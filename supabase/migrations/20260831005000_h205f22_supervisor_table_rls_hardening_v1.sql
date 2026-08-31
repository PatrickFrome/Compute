-- C3 supervisor storage hardening.
-- These tables carry coordination, lease, and development-gate state. Browser/user roles
-- must not have direct table authority; trusted SECURITY DEFINER/service paths mediate access.

alter table public.compute_fabric_a2_supervisor_mesh_instance_h205f22 enable row level security;
alter table public.compute_fabric_a2_supervisor_actuation_lease_h205f22 enable row level security;
alter table public.compute_fabric_development_gate_policy_h205f22 enable row level security;

revoke all privileges on table public.compute_fabric_a2_supervisor_mesh_instance_h205f22 from public, anon, authenticated;
revoke all privileges on table public.compute_fabric_a2_supervisor_actuation_lease_h205f22 from public, anon, authenticated;
revoke all privileges on table public.compute_fabric_development_gate_policy_h205f22 from public, anon, authenticated;

-- Preserve trusted server-side maintenance/readback. service_role bypasses RLS in Supabase,
-- but explicit grants make the intended trusted path auditable and independent of defaults.
grant select, insert, update, delete on table public.compute_fabric_a2_supervisor_mesh_instance_h205f22 to service_role;
grant select, insert, update, delete on table public.compute_fabric_a2_supervisor_actuation_lease_h205f22 to service_role;
grant select, insert, update, delete on table public.compute_fabric_development_gate_policy_h205f22 to service_role;
