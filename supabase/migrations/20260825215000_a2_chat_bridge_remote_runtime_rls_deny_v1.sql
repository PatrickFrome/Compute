-- Explicit browser-role deny policies for the non-authority remote bridge state.
-- service_role bypasses RLS and remains the only granted runtime principal.

create policy a2_chat_bridge_remote_pairing_deny_browser
on public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22
for all
to anon, authenticated
using (false)
with check (false);

create policy a2_chat_bridge_remote_peer_deny_browser
on public.compute_fabric_a2_chat_bridge_remote_peer_h205f22
for all
to anon, authenticated
using (false)
with check (false);

create policy a2_chat_bridge_remote_command_deny_browser
on public.compute_fabric_a2_chat_bridge_remote_command_h205f22
for all
to anon, authenticated
using (false)
with check (false);
