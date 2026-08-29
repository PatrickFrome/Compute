-- A2 peer processes must not receive privileged Postgres/Vault access.
-- This NOLOGIN role is used only inside the trusted ingress via SET LOCAL ROLE.

do $$
begin
  if not exists(select 1 from pg_roles where rolname='a2_peer_runtime') then
    create role a2_peer_runtime nologin nosuperuser nocreatedb nocreaterole noinherit noreplication;
  end if;
end $$;

revoke all on schema destruktion_meta from a2_peer_runtime;
revoke all on schema vault from a2_peer_runtime;
revoke all on all tables in schema destruktion_meta from a2_peer_runtime;
revoke all on all tables in schema vault from a2_peer_runtime;

grant execute on function public.h205f22_a2_register_peer_session_v1(uuid,text,text,text,text,text,jsonb,bigint,text) to a2_peer_runtime;
grant execute on function public.h205f22_a2_close_peer_session_v1(uuid) to a2_peer_runtime;
grant execute on function public.h205f22_a2_create_visibility_proof_v1(uuid,bigint,bigint,bigint,jsonb,text[]) to a2_peer_runtime;
grant execute on function public.h205f22_a2_next_agent_seq_v1(uuid) to a2_peer_runtime;
grant execute on function public.h205f22_a2_read_frontier_v1(uuid) to a2_peer_runtime;
grant execute on function public.h205f22_a2_read_frontier_at_v1(uuid,bigint) to a2_peer_runtime;
grant execute on function public.h205f22_a2_prepare_event_v1(uuid,uuid,bigint,text,text,smallint,text[],jsonb,uuid,jsonb) to a2_peer_runtime;
grant execute on function public.h205f22_a2_update_cursor_v1(uuid,bigint,bigint,text) to a2_peer_runtime;
grant execute on function public.h205f22_a2_read_events_v1(uuid,bigint,integer) to a2_peer_runtime;
grant execute on function public.h205f22_a2_read_snapshot_v1(uuid,integer) to a2_peer_runtime;
grant execute on function public.h205f22_a2_read_visibility_proof_v1(uuid) to a2_peer_runtime;
grant execute on function public.h205f22_a2_read_event_ancestry_v1(uuid,integer) to a2_peer_runtime;

revoke execute on function public.h205f22_a2_emit_agent_event_v1(uuid,uuid,bigint,text,text,smallint,text[],jsonb,uuid,jsonb,text,text,text,boolean) from a2_peer_runtime;
revoke execute on function public.h205f22_a2_emit_agent_event_v2(uuid,uuid,bigint,text,text,smallint,text[],jsonb,uuid,jsonb,text,text,text,text,timestamptz,timestamptz,text,text) from a2_peer_runtime;
revoke execute on function public.h205f22_a2_open_conflict_v1(uuid,text,text,text,text,text) from a2_peer_runtime;
revoke execute on function public.h205f22_a2_attach_duel_v1(uuid,uuid) from a2_peer_runtime;
revoke execute on function public.h205f22_a2_resolve_conflict_v1(uuid,text) from a2_peer_runtime;
revoke execute on function public.h205f22_duel_create_same_point_v4(text,text,text,jsonb,text,text,text) from a2_peer_runtime;
