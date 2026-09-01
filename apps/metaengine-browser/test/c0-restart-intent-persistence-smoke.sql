\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

create table public._c0_restart_intent_persistence_fixture (
  eligible boolean not null default true,
  authority_effect boolean not null default false,
  blockers jsonb not null default '[]'::jsonb
);
insert into public._c0_restart_intent_persistence_fixture default values;

create or replace function public.h205f22_compute_unified_restart_intent_v1(uuid,bigint,text,text,bigint,text,interval)
returns jsonb language sql stable as $$
  select case when eligible then jsonb_build_object(
    'schema','metaengine.compute-unified.restart-intent.v1',
    'intent_eligible',true,
    'state','ROLLOVER',
    'intent_fingerprint',repeat('a',64),
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'authority_effect',authority_effect
  ) else jsonb_build_object(
    'schema','metaengine.compute-unified.restart-intent.v1',
    'intent_eligible',false,
    'state','RECOVERING',
    'blockers',blockers,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'authority_effect',authority_effect
  ) end
  from public._c0_restart_intent_persistence_fixture limit 1
$$;

\ir ../../../supabase/migrations/20260901115100_compute_unified_restart_intent_persistence_v1.sql

DO $$
DECLARE
  w uuid := '00000000-0000-0000-0000-000000000156';
  sha text := 'a23b647220c6bdeaa4340f804575dc2009e434cb';
  r1 jsonb;
  r2 jsonb;
  r3 jsonb;
  c bigint;
BEGIN
  r1 := public.h205f22_persist_compute_unified_restart_intent_v1(w,9,'successor-client','proc-successor',16,sha,interval '2 minutes');
  if not (r1->>'persisted')::boolean or (r1->>'replay')::boolean then raise exception 'first persistence failed: %',r1; end if;
  if (r1->>'restart_authorized')::boolean or (r1->>'wake_replay_authorized')::boolean or (r1->>'lease_mutation_authorized')::boolean or (r1->>'authority_effect')::boolean then raise exception 'persistence leaked authority: %',r1; end if;

  r2 := public.h205f22_persist_compute_unified_restart_intent_v1(w,9,'successor-client','proc-successor',16,sha,interval '2 minutes');
  if (r2->>'persisted')::boolean or not (r2->>'replay')::boolean then raise exception 'exact replay rewrote evidence: %',r2; end if;
  if r1->>'restart_intent_id' is distinct from r2->>'restart_intent_id' then raise exception 'replay identity drift'; end if;
  select count(*) into c from public.compute_unified_restart_intent_h205f22 where workspace_id=w;
  if c <> 1 then raise exception 'replay created duplicate row: %',c; end if;

  update public._c0_restart_intent_persistence_fixture set eligible=false, blockers='["QUEUED_WAKE_PRESENT"]'::jsonb;
  r3 := public.h205f22_persist_compute_unified_restart_intent_v1(w,10,'successor-client-2','proc-successor-2',17,sha,interval '2 minutes');
  if (r3->>'persisted')::boolean then raise exception 'blocked intent persisted: %',r3; end if;
  select count(*) into c from public.compute_unified_restart_intent_h205f22 where workspace_id=w;
  if c <> 1 then raise exception 'blocked intent changed durable row count: %',c; end if;

  update public._c0_restart_intent_persistence_fixture set eligible=true, authority_effect=true, blockers='[]'::jsonb;
  begin
    perform public.h205f22_persist_compute_unified_restart_intent_v1(w,10,'successor-client-2','proc-successor-2',17,sha,interval '2 minutes');
    raise exception 'authority-bearing intent accepted';
  exception when others then
    if sqlerrm = 'authority-bearing intent accepted' then raise; end if;
  end;
END $$;

DO $$ BEGIN
  if has_table_privilege('service_role','public.compute_unified_restart_intent_h205f22','INSERT') then raise exception 'service_role direct insert leaked'; end if;
  if has_table_privilege('service_role','public.compute_unified_restart_intent_h205f22','UPDATE') then raise exception 'service_role direct update leaked'; end if;
  if has_table_privilege('service_role','public.compute_unified_restart_intent_h205f22','DELETE') then raise exception 'service_role direct delete leaked'; end if;
  if has_function_privilege('anon','public.h205f22_persist_compute_unified_restart_intent_v1(uuid,bigint,text,text,bigint,text,interval)','EXECUTE') then raise exception 'anon execute leaked'; end if;
  if has_function_privilege('authenticated','public.h205f22_persist_compute_unified_restart_intent_v1(uuid,bigint,text,text,bigint,text,interval)','EXECUTE') then raise exception 'authenticated execute leaked'; end if;
  if not has_function_privilege('service_role','public.h205f22_persist_compute_unified_restart_intent_v1(uuid,bigint,text,text,bigint,text,interval)','EXECUTE') then raise exception 'service role execute missing'; end if;
END $$;
