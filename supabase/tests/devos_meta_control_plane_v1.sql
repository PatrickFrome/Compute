-- DEVOS META CONTROL PLANE V1 negative/static contract tests
-- Intended for a Supabase test database after migrations have been applied.

begin;

do $test$
declare
  v_count integer;
  v_def text;
begin
  if to_regprocedure('destruktion_meta.devos_fleet_watchdog_h205f22()') is null then
    raise exception 'missing singleton watchdog';
  end if;
  if to_regprocedure('destruktion_meta.devos_meta_refill_h205f22()') is null then
    raise exception 'missing meta refill';
  end if;
  if to_regprocedure('public.devos_meta_dispatch_v1(uuid,text,bigint,text,text,bigint,text,text,text,jsonb,text,integer)') is null then
    raise exception 'missing meta dispatch';
  end if;
  if to_regprocedure('public.devos_meta_snapshot_v1(uuid)') is null then
    raise exception 'missing meta snapshot';
  end if;

  select pg_get_functiondef(to_regprocedure('destruktion_meta.devos_fleet_watchdog_h205f22()')) into v_def;
  if v_def not like '%pg_try_advisory_xact_lock%' then
    raise exception 'watchdog lost singleton advisory lock';
  end if;
  if v_def like '%destruktion_meta.devos_supervisor_mesh_instance_h205f22%' then
    raise exception 'watchdog regressed to stale supervisor mesh relation';
  end if;
  if v_def not like '%public.compute_fabric_a2_supervisor_mesh_instance_h205f22%' then
    raise exception 'watchdog missing authoritative optional mesh relation';
  end if;

  select pg_get_functiondef(to_regprocedure('public.devos_meta_dispatch_v1(uuid,text,bigint,text,text,bigint,text,text,text,jsonb,text,integer)')) into v_def;
  if v_def not like '%meta_governor_lease_fenced%' then
    raise exception 'meta dispatch missing exact lease fence';
  end if;
  if v_def not like '%meta_dispatch_budget_exhausted%' then
    raise exception 'meta dispatch missing bounded child-task budget';
  end if;
  if v_def not like '%meta_recursive_dispatch_denied%' then
    raise exception 'meta dispatch permits recursive L0 task spawning';
  end if;
  if v_def not like '%AMBIGUOUS%' or v_def not like '%duplicate_semantic_work%' then
    raise exception 'meta dispatch missing unresolved semantic duplicate fence';
  end if;
  if v_def not like '%mutating_dispatch_requires_work_branch%' then
    raise exception 'mutating meta dispatch is not branch fenced';
  end if;

  select pg_get_functiondef(to_regprocedure('destruktion_meta.devos_meta_refill_h205f22()')) into v_def;
  if v_def not like '%BOUNDED_RENEWABLE_EPISODE%' then
    raise exception 'meta roles regressed to immortal running sessions';
  end if;
  if v_def not like '%RESULT_READY%' or v_def not like '%BLOCKED%' then
    raise exception 'meta refill can race unconsumed result or blocked generation';
  end if;
  if v_def not like '%cooldown_seconds%' then
    raise exception 'meta refill missing role-fairness cooldown';
  end if;

  select pg_get_functiondef(to_regprocedure('destruktion_meta.devos_maintenance_refill_h205f22()')) into v_def;
  if v_def not like '%BOUNDED_RENEWABLE_EPISODE%' or v_def not like '%cooldown_seconds%' then
    raise exception 'maintenance lanes missing renewable fairness semantics';
  end if;

  if has_function_privilege('anon','public.devos_meta_dispatch_v1(uuid,text,bigint,text,text,bigint,text,text,text,jsonb,text,integer)','EXECUTE') then
    raise exception 'anon may execute meta dispatch';
  end if;
  if has_function_privilege('authenticated','public.devos_meta_dispatch_v1(uuid,text,bigint,text,text,bigint,text,text,text,jsonb,text,integer)','EXECUTE') then
    raise exception 'authenticated may execute meta dispatch';
  end if;

  if to_regclass('cron.job') is not null then
    select count(*) into v_count
      from cron.job
      where jobname='metaengine-h205f22-devos-fleet-watchdog' and active;
    if v_count <> 1 then
      raise exception 'expected exactly one active DevOS fleet watchdog scheduler, got %',v_count;
    end if;
  end if;

  select count(*) into v_count
  from (
    select task_spec->>'meta_lane' as lane,count(*) as n
    from destruktion_meta.devos_fleet_task_h205f22
    where task_spec ? 'meta_lane'
      and state in('READY','LEASED','RUNNING','RESULT_READY','BLOCKED')
    group by task_spec->>'meta_lane'
    having count(*) > 1
  ) d;
  if v_count <> 0 then
    raise exception 'duplicate open meta generations detected';
  end if;

  select count(*) into v_count
  from destruktion_meta.devos_fleet_task_h205f22
  where task_spec ? 'meta_lane'
    and (
      coalesce((task_spec->>'can_direct_browser_effects')::boolean,true)
      or coalesce((task_spec->>'can_promote_production')::boolean,true)
      or not coalesce((task_spec->>'cannot_self_approve')::boolean,false)
      or not coalesce((task_spec->>'requires_independent_review')::boolean,false)
    );
  if v_count <> 0 then
    raise exception 'unsafe authority discovered in meta task spec';
  end if;
end
$test$;

rollback;
