\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table public._c0_restart_intent_fixture (
  ready boolean not null default true,
  authority_effect boolean not null default false,
  blockers jsonb not null default '[]'::jsonb
);
insert into public._c0_restart_intent_fixture default values;

create or replace function public.h205f22_compute_unified_restart_readiness_v1(uuid,bigint,text,text,bigint,text,interval)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'restart_ready',ready,
    'state',case when ready then 'ROLLOVER' else 'RECOVERING' end,
    'blockers',blockers,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'authority_effect',authority_effect
  ) from public._c0_restart_intent_fixture limit 1
$$;

\ir ../../../supabase/migrations/20260901105000_compute_unified_restart_intent_v1.sql

DO $$
DECLARE
  w uuid := '00000000-0000-0000-0000-000000000155';
  sha text := 'a23b647220c6bdeaa4340f804575dc2009e434cb';
  r1 jsonb;
  r2 jsonb;
  r3 jsonb;
BEGIN
  r1 := public.h205f22_compute_unified_restart_intent_v1(w,7,'successor-client','proc-successor',15,sha,interval '2 minutes');
  r2 := public.h205f22_compute_unified_restart_intent_v1(w,7,'successor-client','proc-successor',15,sha,interval '2 minutes');
  if not (r1->>'intent_eligible')::boolean or r1->>'state' <> 'ROLLOVER' then raise exception 'clean intent rejected: %',r1; end if;
  if r1->>'intent_fingerprint' !~ '^[0-9a-f]{64}$' then raise exception 'bad sha256 fingerprint: %',r1; end if;
  if r1->>'intent_fingerprint' is distinct from r2->>'intent_fingerprint' then raise exception 'deterministic intent fingerprint drift'; end if;
  if (r1->>'restart_authorized')::boolean or (r1->>'wake_replay_authorized')::boolean or (r1->>'lease_mutation_authorized')::boolean or (r1->>'authority_effect')::boolean then raise exception 'intent leaked authority: %',r1; end if;

  r3 := public.h205f22_compute_unified_restart_intent_v1(w,8,'successor-client','proc-successor',15,sha,interval '2 minutes');
  if r1->>'intent_fingerprint' = r3->>'intent_fingerprint' then raise exception 'checkpoint drift did not change fingerprint'; end if;

  update public._c0_restart_intent_fixture set ready=false,blockers='["QUEUED_WAKE_PRESENT"]'::jsonb;
  r3 := public.h205f22_compute_unified_restart_intent_v1(w,7,'successor-client','proc-successor',15,sha,interval '2 minutes');
  if (r3->>'intent_eligible')::boolean or r3 ? 'intent_fingerprint' then raise exception 'blocked readiness produced intent: %',r3; end if;
  if not (r3->'blockers' ? 'QUEUED_WAKE_PRESENT') then raise exception 'blocker lost: %',r3; end if;

  update public._c0_restart_intent_fixture set ready=true,authority_effect=true,blockers='[]'::jsonb;
  begin
    perform public.h205f22_compute_unified_restart_intent_v1(w,7,'successor-client','proc-successor',15,sha,interval '2 minutes');
    raise exception 'authority-bearing readiness accepted';
  exception when others then
    if sqlerrm = 'authority-bearing readiness accepted' then raise; end if;
  end;
END $$;

DO $$ BEGIN
  if has_function_privilege('anon','public.h205f22_compute_unified_restart_intent_v1(uuid,bigint,text,text,bigint,text,interval)','EXECUTE') then raise exception 'anon execute leaked'; end if;
  if has_function_privilege('authenticated','public.h205f22_compute_unified_restart_intent_v1(uuid,bigint,text,text,bigint,text,interval)','EXECUTE') then raise exception 'authenticated execute leaked'; end if;
  if not has_function_privilege('service_role','public.h205f22_compute_unified_restart_intent_v1(uuid,bigint,text,text,bigint,text,interval)','EXECUTE') then raise exception 'service role execute missing'; end if;
END $$;