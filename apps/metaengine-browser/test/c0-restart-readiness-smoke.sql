\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

create table public._c0_restart_fixture (
  successor_verified boolean not null default true,
  client_id text not null default 'successor-client',
  process_id text not null default 'proc-successor',
  stale boolean not null default false,
  leases integer not null default 0,
  generation text not null default 'IDLE',
  quiescent boolean not null default true,
  active_wake text,
  pending_wake text,
  queued_wakes integer not null default 0,
  update_state text not null default 'CURRENT',
  trusted_channel text,
  restart_gate_safe boolean not null default true
);
insert into public._c0_restart_fixture(trusted_channel) values ('dev');

create or replace function public.h205f22_compute_unified_successor_readback_v1(uuid,bigint,text,text,bigint,text,interval)
returns jsonb language sql stable as $$
  select jsonb_build_object('verified',successor_verified,'authority_effect',false) from public._c0_restart_fixture limit 1
$$;

create or replace function public.h205f22_compute_unified_rollover_read_v1(uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'browser_supervisor',jsonb_build_object(
      'client_id',client_id,
      'stale',stale,
      'runtime',jsonb_build_object(
        'process_incarnation_id',process_id,
        'supervisor_generation',generation,
        'quiescent',quiescent,
        'keepalive',jsonb_build_object(
          'active_wake_id',active_wake,
          'pending_wake_id',pending_wake,
          'queued_wake_count',queued_wakes
        ),
        'self_update',jsonb_build_object(
          'state',update_state,
          'trusted_channel',trusted_channel,
          'restart_gate_safe',restart_gate_safe
        )
      )
    ),
    'actuation_leases',jsonb_build_object('active_unreleased_count',leases),
    'authority_effect',false
  ) from public._c0_restart_fixture limit 1
$$;

\ir ../../../supabase/migrations/20260901094000_compute_unified_restart_readiness_v1.sql

DO $$
DECLARE
  w uuid := '00000000-0000-0000-0000-000000000154';
  sha text := 'a23b647220c6bdeaa4340f804575dc2009e434cb';
  r jsonb;
BEGIN
  r := public.h205f22_compute_unified_restart_readiness_v1(w,1,'successor-client','proc-successor',14,sha,interval '2 minutes');
  if not (r->>'restart_ready')::boolean or r->>'state' <> 'ROLLOVER' then raise exception 'clean readiness rejected: %',r; end if;
  if (r->>'restart_authorized')::boolean or (r->>'wake_replay_authorized')::boolean or (r->>'lease_mutation_authorized')::boolean or (r->>'authority_effect')::boolean then raise exception 'readiness leaked authority: %',r; end if;

  update public._c0_restart_fixture set queued_wakes=1;
  r := public.h205f22_compute_unified_restart_readiness_v1(w,1,'successor-client','proc-successor',14,sha,interval '2 minutes');
  if (r->>'restart_ready')::boolean or not (r->'blockers' ? 'QUEUED_WAKE_PRESENT') then raise exception 'queued wake accepted: %',r; end if;

  update public._c0_restart_fixture set queued_wakes=0,restart_gate_safe=false;
  r := public.h205f22_compute_unified_restart_readiness_v1(w,1,'successor-client','proc-successor',14,sha,interval '2 minutes');
  if (r->>'restart_ready')::boolean or not (r->'blockers' ? 'SELF_UPDATE_RESTART_GATE_UNSAFE') then raise exception 'unsafe update gate accepted: %',r; end if;

  update public._c0_restart_fixture set restart_gate_safe=true,successor_verified=false;
  r := public.h205f22_compute_unified_restart_readiness_v1(w,1,'successor-client','proc-successor',14,sha,interval '2 minutes');
  if (r->>'restart_ready')::boolean or not (r->'blockers' ? 'SUCCESSOR_READBACK_NOT_VERIFIED') then raise exception 'unverified successor accepted: %',r; end if;

  update public._c0_restart_fixture set successor_verified=true,process_id='wrong-process';
  r := public.h205f22_compute_unified_restart_readiness_v1(w,1,'successor-client','proc-successor',14,sha,interval '2 minutes');
  if (r->>'restart_ready')::boolean or not (r->'blockers' ? 'SUCCESSOR_PROCESS_NOT_CURRENT') then raise exception 'process drift accepted: %',r; end if;

  update public._c0_restart_fixture set process_id='proc-successor',trusted_channel=null;
  r := public.h205f22_compute_unified_restart_readiness_v1(w,1,'successor-client','proc-successor',14,sha,interval '2 minutes');
  if (r->>'restart_ready')::boolean or not (r->'blockers' ? 'TRUSTED_UPDATE_CHANNEL_MISSING') then raise exception 'missing trusted channel accepted: %',r; end if;
END $$;

DO $$ BEGIN
  if has_function_privilege('anon','public.h205f22_compute_unified_restart_readiness_v1(uuid,bigint,text,text,bigint,text,interval)','EXECUTE') then raise exception 'anon execute leaked'; end if;
  if has_function_privilege('authenticated','public.h205f22_compute_unified_restart_readiness_v1(uuid,bigint,text,text,bigint,text,interval)','EXECUTE') then raise exception 'authenticated execute leaked'; end if;
  if not has_function_privilege('service_role','public.h205f22_compute_unified_restart_readiness_v1(uuid,bigint,text,text,bigint,text,interval)','EXECUTE') then raise exception 'service role execute missing'; end if;
END $$;