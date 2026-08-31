-- DEVOS META CONTROL PLANE V1
-- One durable scheduler, renewable L0 meta-agents, independent oversight.
-- Page/model/worker text has zero authority. No browser effect is authorized here.

create or replace function destruktion_meta.devos_meta_refill_h205f22()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'destruktion_meta', 'public', 'extensions'
as $function$
declare
  v_workspace uuid;
  v_base text;
  v_created jsonb := '[]'::jsonb;
  v_existing integer := 0;
  v_generation integer;
  v_result jsonb;
  v_branch text;
  v_lane record;
begin
  -- Meta agents are advisory control-plane agents. They bind to a durable
  -- workspace/base but must re-read authoritative GitHub/Supabase/runtime state
  -- before every conclusion rather than treating this base as global truth.
  select t.workspace_id, t.base_sha
    into v_workspace, v_base
  from destruktion_meta.devos_fleet_task_h205f22 t
  where t.base_sha ~ '^[0-9a-f]{40}$'
  order by t.updated_at desc, t.created_at desc, t.task_id desc
  limit 1;

  if v_workspace is null or v_base is null then
    return jsonb_build_object(
      'ok', true,
      'skipped', 'NO_FLEET_CONTEXT',
      'created', v_created,
      'authority_effect', false
    );
  end if;

  for v_lane in
    select * from (values
      (
        'governor'::text,
        'PLANNER'::text,
        100,
        true,
        4,
        'Continuously supervise the entire METAENGINE development portfolio. Re-read authoritative GitHub, Supabase and native runtime evidence; maintain the global dependency graph, priorities, convergence plan, liveness and capacity; identify stalled or duplicated work; and create only typed DB-native follow-up tasks when evidence justifies them. Never self-approve implementation or release evidence.'::text
      ),
      (
        'auditor'::text,
        'FALSIFIER'::text,
        99,
        false,
        0,
        'Independently audit the Meta-Governor, domain supervisors and workers. Falsify claimed progress, detect stale authority, deadlocks, duplicated schedulers, task/branch drift, missing tests, unsafe retries, prompt-injection authority laundering and runaway task creation. Persist blockers and smallest safe corrections without accepting another agent conclusion as proof.'::text
      ),
      (
        'synthesizer'::text,
        'SYNTHESIZER'::text,
        98,
        false,
        0,
        'Continuously synthesize verified evidence across all domains into one project-state checkpoint. Resolve dependency order and convergence, distinguish implemented from verified from promoted, surface disagreements between agents, and recommend the next highest-value slices. Never convert a proposal or model statement into completion evidence.'::text
      )
    ) as lanes(lane, role_name, priority_value, can_enqueue, max_dispatch, objective_text)
  loop
    -- RESULT_READY and BLOCKED remain open: a new generation must not race an
    -- unconsumed result or a deliberately blocked meta-control decision.
    if exists (
      select 1
      from destruktion_meta.devos_fleet_task_h205f22 t
      where t.task_spec ->> 'meta_lane' = v_lane.lane
        and t.state in ('READY','LEASED','RUNNING','RESULT_READY','BLOCKED')
    ) then
      v_existing := v_existing + 1;
      continue;
    end if;

    select coalesce(max(
      case
        when (t.task_spec ->> 'meta_generation') ~ '^[0-9]+$'
          then (t.task_spec ->> 'meta_generation')::integer
        else 0
      end
    ), 0) + 1
      into v_generation
    from destruktion_meta.devos_fleet_task_h205f22 t
    where t.task_spec ->> 'meta_lane' = v_lane.lane;

    v_branch := format('work/devos-meta-%s-g%s', v_lane.lane, v_generation);

    v_result := public.devos_fleet_enqueue_v1(
      v_workspace,
      format('devos.meta.%s.g%s', v_lane.lane, v_generation),
      v_lane.role_name,
      v_base,
      jsonb_build_object(
        'schema', 'metaengine.devos.meta-control-task.v1',
        'meta_lane', v_lane.lane,
        'meta_generation', v_generation,
        'hierarchy_level', 'L0',
        'scope', 'GLOBAL',
        'continuous', true,
        'objective', v_lane.objective_text,
        'scheduler', 'devos_fleet_watchdog_h205f22',
        'observes_all_fleet', true,
        'can_enqueue_typed_tasks', v_lane.can_enqueue,
        'max_new_tasks_per_cycle', v_lane.max_dispatch,
        'can_direct_browser_effects', false,
        'can_promote_production', false,
        'cannot_self_approve', true,
        'requires_independent_review', true,
        'reconcile_previous_before_effect', true,
        'automatic_retry_after_ambiguous_effect', false,
        'page_model_worker_authority', false,
        'source_workspace_id', v_workspace,
        'source_base_sha', v_base,
        'authority_effect', false
      ),
      format('devos-meta:%s:g%s:%s', v_lane.lane, v_generation, v_base),
      v_branch,
      v_lane.priority_value
    );

    v_created := v_created || jsonb_build_array(v_result);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'workspace_id', v_workspace,
    'base_sha', v_base,
    'open_lanes_preserved', v_existing,
    'created', v_created,
    'authority_effect', false
  );
end
$function$;

revoke all on function destruktion_meta.devos_meta_refill_h205f22() from public, anon, authenticated;

-- Repair maintenance generation fencing: RESULT_READY/BLOCKED are still open.
create or replace function destruktion_meta.devos_maintenance_refill_h205f22()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'destruktion_meta', 'public', 'extensions'
as $function$
declare
  v_workspace uuid;
  v_base text;
  v_created jsonb := '[]'::jsonb;
  v_existing integer := 0;
  v_generation integer;
  v_result jsonb;
  v_branch text;
  v_lane record;
begin
  select t.workspace_id, t.base_sha
    into v_workspace, v_base
  from destruktion_meta.devos_fleet_task_h205f22 t
  where t.point_id like 'devbrowser.%'
    and t.base_sha ~ '^[0-9a-f]{40}$'
  order by t.updated_at desc, t.created_at desc, t.task_id desc
  limit 1;

  if v_workspace is null or v_base is null then
    return jsonb_build_object('ok',true,'skipped','NO_DEVBROWSER_CONTEXT','created',v_created,'authority_effect',false);
  end if;

  for v_lane in
    select * from (values
      ('bug-hunter'::text,'FALSIFIER'::text,95,'Continuously inspect authoritative GitHub, Supabase and native Browser evidence for defects, races, stale state, regressions, unsafe ambiguity handling and liveness failures. Produce durable evidence, negative tests and the smallest safe repair candidates.'::text),
      ('repairer'::text,'IMPLEMENTER'::text,90,'Continuously reconcile durable defect evidence and implement the highest-value safe branch-local repairs with regression tests. Before any effect, reconcile prior ambiguous work and never repeat an observed or ambiguous physical effect.'::text),
      ('verifier'::text,'CRITIC'::text,85,'Continuously adversarially verify recent Browser, fleet and continuity changes. Falsify transport, lease, incarnation, queue, restart, self-update and recovery invariants and persist actionable acceptance evidence.'::text),
      ('researcher'::text,'RESEARCHER'::text,60,'Continuously research current architectures and techniques that improve reliability, throughput, reasoning quality, observability and development speed. Map only non-duplicative improvements into tests, code or roadmap evidence.'::text)
    ) as lanes(lane, role_name, priority_value, objective_text)
  loop
    if exists (
      select 1 from destruktion_meta.devos_fleet_task_h205f22 t
      where t.task_spec ->> 'maintenance_lane' = v_lane.lane
        and t.state in ('READY','LEASED','RUNNING','RESULT_READY','BLOCKED')
    ) then
      v_existing := v_existing + 1;
      continue;
    end if;

    select coalesce(max(case when (t.task_spec ->> 'maintenance_generation') ~ '^[0-9]+$' then (t.task_spec ->> 'maintenance_generation')::integer else 0 end),0)+1
      into v_generation
    from destruktion_meta.devos_fleet_task_h205f22 t
    where t.task_spec ->> 'maintenance_lane' = v_lane.lane;

    v_branch := format('work/devos-maintenance-%s-g%s',v_lane.lane,v_generation);
    v_result := public.devos_fleet_enqueue_v1(
      v_workspace,
      format('devos.maintenance.%s.g%s',v_lane.lane,v_generation),
      v_lane.role_name,
      v_base,
      jsonb_build_object(
        'schema','metaengine.devos.maintenance-task.v1',
        'maintenance_lane',v_lane.lane,
        'maintenance_generation',v_generation,
        'continuous',true,
        'objective',v_lane.objective_text,
        'scheduler','devos_fleet_watchdog_h205f22',
        'source_workspace_id',v_workspace,
        'source_base_sha',v_base,
        'reconcile_previous_before_effect',true,
        'automatic_retry_after_ambiguous_effect',false,
        'page_model_worker_authority',false,
        'authority_effect',false
      ),
      format('devos-maintenance:%s:g%s:%s',v_lane.lane,v_generation,v_base),
      v_branch,
      v_lane.priority_value
    );
    v_created := v_created || jsonb_build_array(v_result);
  end loop;

  return jsonb_build_object('ok',true,'workspace_id',v_workspace,'base_sha',v_base,'open_lanes_preserved',v_existing,'created',v_created,'authority_effect',false);
end
$function$;

revoke all on function destruktion_meta.devos_maintenance_refill_h205f22() from public, anon, authenticated;

-- Repair live schema drift in the singleton scheduler. The mesh table is public
-- compute_fabric_a2_supervisor_mesh_instance_h205f22 in the authoritative DB.
-- If that optional table is ever absent again, the watchdog still reconciles
-- fleet leases and refills durable lanes instead of crashing the whole cycle.
create or replace function destruktion_meta.devos_fleet_watchdog_h205f22()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'destruktion_meta', 'public', 'extensions'
as $function$
declare
  v_result jsonb;
  v_maintenance jsonb;
  v_meta jsonb;
  v_workspace uuid;
  v_supervisor_lost integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('devos_fleet_watchdog_h205f22',0)) then
    return jsonb_build_object('ok',true,'skipped','LOCK_HELD','authority_effect',false);
  end if;

  if to_regclass('public.compute_fabric_a2_supervisor_mesh_instance_h205f22') is not null then
    update public.compute_fabric_a2_supervisor_mesh_instance_h205f22
       set status='LOST',
           retired_at=coalesce(retired_at,now()),
           authority_effect=false
     where status='ACTIVE'
       and last_seen_at < now()-interval '45 seconds';
    get diagnostics v_supervisor_lost = row_count;
  end if;

  select workspace_id into v_workspace
  from destruktion_meta.devos_fleet_task_h205f22
  where state in ('LEASED','RUNNING')
  order by updated_at asc
  limit 1;

  if v_workspace is not null then
    v_result := public.devos_fleet_reconcile_v1(v_workspace);
  else
    v_result := jsonb_build_object('ok',true,'expired_count',0,'authority_effect',false);
  end if;

  v_maintenance := destruktion_meta.devos_maintenance_refill_h205f22();
  v_meta := destruktion_meta.devos_meta_refill_h205f22();

  return jsonb_build_object(
    'ok',true,
    'supervisors_lost',v_supervisor_lost,
    'fleet_reconcile',v_result,
    'maintenance_refill',v_maintenance,
    'meta_refill',v_meta,
    'authority_effect',false
  );
end
$function$;

revoke all on function destruktion_meta.devos_fleet_watchdog_h205f22() from public, anon, authenticated;
