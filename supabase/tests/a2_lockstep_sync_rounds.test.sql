-- Deterministic A2 lockstep + session-liveness contract test. No canary and no persisted fixtures.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = pg_catalog, public, destruktion_meta, extensions;

select plan(18);

select ok(to_regclass('destruktion_meta.compute_fabric_a2_sync_round_h205f22') is not null,
  'private sync-round ledger exists');
select ok(to_regprocedure('public.h205f22_a2_join_sync_round_v1(uuid,integer)') is not null,
  'join-round RPC exists');
select ok(to_regprocedure('public.h205f22_a2_abandon_sync_round_v1(uuid,uuid,text)') is not null,
  'abandon-round RPC exists');
select ok(to_regprocedure('public.h205f22_a2_read_sync_state_v1(uuid)') is not null,
  'observer sync-state RPC exists');
select is((select relrowsecurity from pg_class where oid='destruktion_meta.compute_fabric_a2_sync_round_h205f22'::regclass),true,
  'sync-round ledger has RLS enabled');
select is((select count(*)::integer from pg_indexes where schemaname='destruktion_meta' and indexname='compute_fabric_a2_sync_round_one_open_idx'),1,
  'one-open-round partial unique index exists');
select ok((select pg_get_functiondef('public.h205f22_a2_emit_agent_event_v1(uuid,uuid,bigint,text,text,smallint,text[],jsonb,uuid,jsonb,text,text,text,boolean)'::regprocedure) like '%a2_sync_round_visibility_frontier_mismatch%',
  'event acceptance fences the exact shared frontier');
select ok((select pg_get_functiondef('public.h205f22_a2_emit_agent_event_v1(uuid,uuid,bigint,text,text,smallint,text[],jsonb,uuid,jsonb,text,text,text,boolean)'::regprocedure) like '%a2_model_event_stale_frontier%',
  'event acceptance rejects late mandatory peer events');
select ok((select pg_get_functiondef('public.h205f22_a2_emit_agent_event_v1(uuid,uuid,bigint,text,text,smallint,text[],jsonb,uuid,jsonb,text,text,text,boolean)'::regprocedure) like '%a2_sync_round_model_priority_must_be_p2%',
  'paired model results cannot invalidate the peer as mandatory traffic');
select is(has_table_privilege('anon','destruktion_meta.compute_fabric_a2_sync_round_h205f22','select'),false,
  'anon cannot read the private round ledger');
select is(has_table_privilege('authenticated','destruktion_meta.compute_fabric_a2_sync_round_h205f22','select'),false,
  'authenticated clients cannot read the private round ledger');

select ok(exists(select 1 from information_schema.columns where table_schema='destruktion_meta' and table_name='compute_fabric_a2_peer_session_h205f22' and column_name='lease_expires_at' and is_nullable='NO'),
  'peer sessions carry a non-null lease expiry');
select ok(to_regprocedure('public.h205f22_a2_heartbeat_peer_session_v1(uuid,integer)') is not null,
  'peer heartbeat RPC exists');
select ok(to_regprocedure('public.h205f22_a2_reap_stale_sessions_v1(uuid)') is not null,
  'service stale-session reaper exists');
select ok(to_regprocedure('destruktion_meta.compute_fabric_a2_assert_live_session_h205f22(uuid)') is not null,
  'private live-session assertion exists');
select ok((select pg_get_functiondef('public.h205f22_a2_heartbeat_peer_session_v1(uuid,integer)'::regprocedure) like '%pg_advisory_xact_lock%'),
  'heartbeat is fenced by the same advisory ownership lock as takeover');
select ok((select pg_get_functiondef('destruktion_meta.compute_fabric_a2_reap_stale_sessions_h205f22(uuid)'::regprocedure) like '%SESSION_EXPIRED%'),
  'stale-session recovery abandons an in-flight round explicitly');
select is(has_function_privilege('a2_peer_runtime','public.h205f22_a2_reap_stale_sessions_v1(uuid)','execute'),false,
  'model peer capability role cannot reap sessions directly');

select * from finish();
rollback;
