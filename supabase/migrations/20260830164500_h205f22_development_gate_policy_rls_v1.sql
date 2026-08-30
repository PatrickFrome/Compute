-- Fail-closed hardening for development gate policy storage.
-- Browser/page/model/worker surfaces must not gain policy authority through direct table access.

alter table public.compute_fabric_development_gate_policy_h205f22 enable row level security;

revoke all on table public.compute_fabric_development_gate_policy_h205f22 from anon;
revoke all on table public.compute_fabric_development_gate_policy_h205f22 from authenticated;

-- Intentionally no permissive RLS policy. Trusted server-side owner/service-role paths remain the only mutation path.
