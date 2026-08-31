\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create role service_role;

create table public.compute_fabric_a2_browser_supervisor_state_h205f22 (
  workspace_id uuid not null,
  client_id text not null,
  last_seen_at timestamptz not null,
  state jsonb not null default '{}'::jsonb
);
create table public.compute_fabric_a2_supervisor_actuation_lease_h205f22 (
  workspace_id uuid not null,
  status text not null,
  released_at timestamptz,
  expires_at timestamptz
);

\ir ../../../supabase/migrations/20260901000100_compute_unified_rollover_read_v1.sql
\ir ../../../supabase/migrations/20260831205000_compute_unified_supervisor_rollover_decision_v1.sql

DO $$
DECLARE
  w uuid := '11111111-1111-1111-1111-111111111111';
  snap jsonb;
  decision jsonb;
BEGIN
  insert into public.compute_fabric_a2_browser_supervisor_state_h205f22 values (
    w, 'browser-1', statement_timestamp() - interval '2 minutes',
    jsonb_build_object(
      'process_incarnation_id','proc-1',
      'supervisor_lifecycle', jsonb_build_object(
        'supervisor_generation','IDLE','quiescent',true,
        'keepalive',jsonb_build_object('state','ACTIVE','supervisor_id','METAENGINE_SUPERVISOR','supervisor_epoch',7,'queued_wakes','[]'::jsonb)
      ),
      'self_update',jsonb_build_object('state','CURRENT','current_version','0.6.3','trusted_channel','dev','restart_gate_safe',false),
      'tabs',jsonb_build_array(jsonb_build_object('url','https://private.example','text_excerpt','sensitive page text'))
    )
  );
  insert into public.compute_fabric_a2_supervisor_actuation_lease_h205f22 values
    (w,'ACTIVE',null,statement_timestamp() - interval '1 second');

  snap := public.h205f22_compute_unified_rollover_read_v1(w);
  if snap->>'schema' <> 'metaengine.compute-unified.rollover-read.v1' then raise exception 'schema mismatch: %', snap; end if;
  if not (snap#>>'{browser_supervisor,stale}')::boolean then raise exception 'expected stale browser: %', snap; end if;
  if (snap#>>'{actuation_leases,active_unreleased_count}')::integer <> 0 then raise exception 'expired lease counted active: %', snap; end if;
  if snap::text like '%private.example%' or snap::text like '%sensitive page text%' then raise exception 'raw page data leaked: %', snap; end if;
  decision := public.h205f22_compute_unified_supervisor_rollover_decision_v1(snap);
  if decision->>'state' <> 'ROLLOVER_READY' then raise exception 'expected rollover ready: %', decision; end if;
  if (decision->>'restart_authorized')::boolean then raise exception 'read path authorized restart'; end if;
END $$;

DO $$
DECLARE v char;
BEGIN
  select provolatile into v from pg_proc where oid='public.h205f22_compute_unified_rollover_read_v1(uuid)'::regprocedure;
  if v <> 's' then raise exception 'rollover read must be STABLE, got %', v; end if;
  if has_function_privilege('anon','public.h205f22_compute_unified_rollover_read_v1(uuid)','EXECUTE') then raise exception 'anon execute leaked'; end if;
  if has_function_privilege('authenticated','public.h205f22_compute_unified_rollover_read_v1(uuid)','EXECUTE') then raise exception 'authenticated execute leaked'; end if;
  if not has_function_privilege('service_role','public.h205f22_compute_unified_rollover_read_v1(uuid)','EXECUTE') then raise exception 'service role execute missing'; end if;
END $$;
