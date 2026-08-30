-- Fail-closed hardening for development gate policy storage and readback RPC.
-- Browser/page/model/worker surfaces must not gain policy authority through direct Data API access.

alter table public.compute_fabric_development_gate_policy_h205f22 enable row level security;

revoke all on table public.compute_fabric_development_gate_policy_h205f22 from anon;
revoke all on table public.compute_fabric_development_gate_policy_h205f22 from authenticated;

-- SECURITY DEFINER functions in public can receive EXECUTE through default privileges independently of PUBLIC.
-- Keep this authoritative policy readback server-side only.
revoke execute on function public.h205f22_development_gate_policy_v1() from public;
revoke execute on function public.h205f22_development_gate_policy_v1() from anon;
revoke execute on function public.h205f22_development_gate_policy_v1() from authenticated;

-- Intentionally no permissive RLS policy. Trusted server-side owner/service-role paths remain the only access path.
