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
\ir ../../../supabase/migrations/20260901025000_compute_unified_rollover_checkpoint_envelope_v1.sql

DO $$
DECLARE
  w uuid := '22222222-2222-2222-2222-222222222222';
  env jsonb;
BEGIN
  insert into public.compute_fabric_a2_browser_supervisor_state_h205f22 values (
    w, 'browser-checkpoint', statement_timestamp() - interval '3 minutes',
    jsonb_build_object(
      'process_incarnation_id','proc-checkpoint-1',
      'supervisor_lifecycle', jsonb_build_object(
        'supervisor_generation','IDLE','quiescent',false,
        'keepalive',jsonb_build_object(
          'state','ACTIVE','supervisor_id','METAENGINE_SUPERVISOR','supervisor_epoch',8,
          'active_wake',jsonb_build_object('wake_id','wake-blocking-1'),
          'queued_wakes',jsonb_build_array(jsonb_build_object('reason','WORKER_RESULT_READY'))
        )
      ),
      'self_update',jsonb_build_object(
        'state','CURRENT','current_version','0.6.3-dev.test','trusted_channel','dev','restart_gate_safe',false
      ),
      'tabs',jsonb_build_array(jsonb_build_object('url','https://private.example/secret','text_excerpt','sensitive page text')),
      'perception',jsonb_build_object('semantic_target','private-control')
    )
  );

  env := public.h205f22_compute_unified_rollover_checkpoint_envelope_v1(w);
  if env->>'schema' <> 'metaengine.compute-unified.rollover-checkpoint-envelope.v1' then raise exception 'schema mismatch: %', env; end if;
  if env#>>'{decision,state}' <> 'RECOVERING' then raise exception 'active wake must block rollover: %', env; end if;
  if not (env#>>'{decision,active_wake_present}')::boolean then raise exception 'active wake evidence missing: %', env; end if;
  if env#>>'{continuity_identity,process_incarnation_id}' <> 'proc-checkpoint-1' then raise exception 'incarnation binding lost: %', env; end if;
  if env#>>'{continuity_identity,supervisor_id}' <> 'METAENGINE_SUPERVISOR' then raise exception 'logical supervisor identity lost: %', env; end if;
  if env->'observed_at' is distinct from env#>'{evidence,observed_at}' then raise exception 'checkpoint/evidence time drift: %', env; end if;
  if coalesce((env->>'persistence_authorized')::boolean,true) then raise exception 'checkpoint envelope authorized persistence'; end if;
  if coalesce((env->>'restart_authorized')::boolean,true) then raise exception 'checkpoint envelope authorized restart'; end if;
  if coalesce((env->>'wake_replay_authorized')::boolean,true) then raise exception 'checkpoint envelope authorized wake replay'; end if;
  if coalesce((env->>'lease_mutation_authorized')::boolean,true) then raise exception 'checkpoint envelope authorized lease mutation'; end if;
  if coalesce((env->>'authority_effect')::boolean,true) then raise exception 'checkpoint envelope has authority effect'; end if;
  if env::text like '%private.example%' or env::text like '%sensitive page text%' or env::text like '%private-control%' then raise exception 'raw page/model-derived data leaked: %', env; end if;
END $$;

DO $$
DECLARE v char;
BEGIN
  select provolatile into v from pg_proc where oid='public.h205f22_compute_unified_rollover_checkpoint_envelope_v1(uuid)'::regprocedure;
  if v <> 's' then raise exception 'checkpoint envelope must be STABLE, got %', v; end if;
  if has_function_privilege('anon','public.h205f22_compute_unified_rollover_checkpoint_envelope_v1(uuid)','EXECUTE') then raise exception 'anon execute leaked'; end if;
  if has_function_privilege('authenticated','public.h205f22_compute_unified_rollover_checkpoint_envelope_v1(uuid)','EXECUTE') then raise exception 'authenticated execute leaked'; end if;
  if not has_function_privilege('service_role','public.h205f22_compute_unified_rollover_checkpoint_envelope_v1(uuid)','EXECUTE') then raise exception 'service role execute missing'; end if;
END $$;
