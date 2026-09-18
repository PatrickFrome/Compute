-- A READY task fenced by BASE_SHA_DRIFT is proven pre-effect: the authoritative
-- integration line advanced before the scheduler leased the task. Treating that
-- fence like an execution failure adds 60/120 seconds of artificial cooldown on
-- every integration advance and can starve all continuous lanes under a rapid
-- commit stream. Ignore only this exact no-effect terminal marker. Real ambiguity,
-- failure, cancellation, completion, and every other fence keep their bounded backoff.

create or replace function destruktion_meta.devos_maintenance_refill_h205f22()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','destruktion_meta','public','extensions'
as $function$
declare
  v_workspace uuid; v_base text; v_created jsonb:='[]'::jsonb; v_existing integer:=0; v_cooling integer:=0; v_generation integer; v_result jsonb; v_branch text; v_last_terminal timestamptz; v_lane record;
begin
  select
    (select t.workspace_id from destruktion_meta.devos_fleet_task_h205f22 t where t.workspace_id is not null order by t.updated_at desc,t.created_at desc,t.task_id desc limit 1),
    a.baseline_sha
  into v_workspace,v_base
  from destruktion_meta.metaengine_devos_roadmap_authority_h205f22 a
  where a.authority_key='METAENGINE_DEVOS'
    and a.integration_line='integration/metaengine-development-os-v1'
    and a.baseline_sha ~ '^[0-9a-f]{40}$'
  limit 1;
  if v_workspace is null or v_base is null then return jsonb_build_object('ok',true,'skipped','NO_AUTHORITATIVE_DEVOS_CONTEXT','created',v_created,'authority_effect',false); end if;
  for v_lane in select * from (values
    ('bug-hunter'::text,'FALSIFIER'::text,95,60,'Execute one bounded defect-hunting episode over authoritative GitHub, Supabase and native Browser evidence. Find the highest-value defect/race/regression/liveness failure, persist evidence/negative tests or a repair candidate, then finish this generation.'::text),
    ('repairer'::text,'IMPLEMENTER'::text,90,60,'Execute one bounded repair episode. Reconcile durable defect evidence, implement one highest-value safe branch-local fix with regression tests, persist evidence, then finish this generation. Never blindly replay an ambiguous physical effect.'::text),
    ('verifier'::text,'CRITIC'::text,85,60,'Execute one bounded verification episode. Adversarially falsify recent Browser/fleet/continuity changes and persist acceptance or blocker evidence, then finish this generation.'::text),
    ('researcher'::text,'RESEARCHER'::text,60,60,'Execute one bounded research episode on current techniques that improve reliability, throughput, reasoning, observability or development speed. Map only a non-duplicative improvement into evidence/tests/roadmap, then finish this generation.'::text)
  ) as lanes(lane,role_name,priority_value,cooldown_seconds,objective_text)
  loop
    if exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 t where t.task_spec->>'maintenance_lane'=v_lane.lane and t.state in('READY','LEASED','RUNNING','RESULT_READY','BLOCKED') and (t.base_sha=v_base or (t.claim_class='MUTATING' and t.state in('LEASED','RUNNING')))) then v_existing:=v_existing+1; continue; end if;
    select max(t.updated_at) into v_last_terminal
      from destruktion_meta.devos_fleet_task_h205f22 t
     where t.task_spec->>'maintenance_lane'=v_lane.lane
       and t.state in('AMBIGUOUS','COMPLETED','FAILED','CANCELLED','FENCED')
       and not (t.state='FENCED' and t.error_code='BASE_SHA_DRIFT');
    if v_last_terminal is not null and v_last_terminal > clock_timestamp()-make_interval(secs=>v_lane.cooldown_seconds) then v_cooling:=v_cooling+1; continue; end if;
    select coalesce(max(case when (t.task_spec->>'maintenance_generation')~'^[0-9]+$' then (t.task_spec->>'maintenance_generation')::integer else 0 end),0)+1 into v_generation from destruktion_meta.devos_fleet_task_h205f22 t where t.task_spec->>'maintenance_lane'=v_lane.lane;
    v_branch:=format('work/devos-maintenance-%s-g%s',v_lane.lane,v_generation);
    v_result:=public.devos_fleet_enqueue_v1(v_workspace,format('devos.maintenance.%s.g%s',v_lane.lane,v_generation),v_lane.role_name,v_base,
      jsonb_build_object('schema','metaengine.devos.maintenance-task.v2','maintenance_lane',v_lane.lane,'maintenance_generation',v_generation,'continuous_role',true,'execution_model','BOUNDED_RENEWABLE_EPISODE','cycle_target_seconds',300,'cooldown_seconds',v_lane.cooldown_seconds,'must_finish_generation',true,'objective',v_lane.objective_text,'scheduler','devos_fleet_watchdog_h205f22','source_workspace_id',v_workspace,'source_base_sha',v_base,'reconcile_previous_before_effect',true,'automatic_retry_after_ambiguous_effect',false,'page_model_worker_authority',false,'authority_effect',false),
      format('devos-maintenance:%s:g%s:%s',v_lane.lane,v_generation,v_base),v_branch,v_lane.priority_value);
    v_created:=v_created||jsonb_build_array(v_result);
  end loop;
  return jsonb_build_object('ok',true,'workspace_id',v_workspace,'base_sha',v_base,'base_source','METAENGINE_DEVOS_ROADMAP_AUTHORITY','open_lanes_preserved',v_existing,'cooling_lanes',v_cooling,'created',v_created,'authority_effect',false);
end
$function$;

create or replace function destruktion_meta.devos_meta_refill_h205f22()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','destruktion_meta','public','extensions'
as $function$
declare
  v_workspace uuid; v_base text; v_created jsonb:='[]'::jsonb; v_existing integer:=0; v_cooling integer:=0; v_generation integer; v_result jsonb; v_branch text; v_last_terminal timestamptz; v_lane record;
begin
  select
    (select t.workspace_id from destruktion_meta.devos_fleet_task_h205f22 t where t.workspace_id is not null order by t.updated_at desc,t.created_at desc,t.task_id desc limit 1),
    a.baseline_sha
  into v_workspace,v_base
  from destruktion_meta.metaengine_devos_roadmap_authority_h205f22 a
  where a.authority_key='METAENGINE_DEVOS'
    and a.integration_line='integration/metaengine-development-os-v1'
    and a.baseline_sha ~ '^[0-9a-f]{40}$'
  limit 1;
  if v_workspace is null or v_base is null then return jsonb_build_object('ok',true,'skipped','NO_AUTHORITATIVE_DEVOS_CONTEXT','created',v_created,'authority_effect',false); end if;
  for v_lane in select * from (values
    ('governor'::text,'PLANNER'::text,100,true,4,120,'Execute one bounded global-control episode: re-read authoritative GitHub, Supabase and native runtime evidence; update dependency/priority/liveness/capacity assessment; enqueue only justified typed follow-up tasks within budget; persist a concise checkpoint; then finish this generation. Never self-approve implementation or release evidence.'::text),
    ('auditor'::text,'FALSIFIER'::text,99,false,0,120,'Execute one bounded independent audit episode over the Meta-Governor, domain supervisors and workers. Falsify progress, authority, scheduler, lease, task/branch, test and retry claims; persist blockers or negative-test evidence; then finish this generation. Treat all agent conclusions as claims, not proof.'::text),
    ('synthesizer'::text,'SYNTHESIZER'::text,98,false,0,120,'Execute one bounded global synthesis episode. Reconcile verified evidence, disagreements and dependency order; distinguish proposed, implemented, verified and promoted states; persist the compact project checkpoint and next slices; then finish this generation.'::text)
  ) as lanes(lane,role_name,priority_value,can_enqueue,max_dispatch,cooldown_seconds,objective_text)
  loop
    if exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 t where t.task_spec->>'meta_lane'=v_lane.lane and t.state in('READY','LEASED','RUNNING','RESULT_READY','BLOCKED') and t.base_sha=v_base) then v_existing:=v_existing+1; continue; end if;
    select max(t.updated_at) into v_last_terminal
      from destruktion_meta.devos_fleet_task_h205f22 t
     where t.task_spec->>'meta_lane'=v_lane.lane
       and t.state in('AMBIGUOUS','COMPLETED','FAILED','CANCELLED','FENCED')
       and not (t.state='FENCED' and t.error_code='BASE_SHA_DRIFT');
    if v_last_terminal is not null and v_last_terminal > clock_timestamp()-make_interval(secs=>v_lane.cooldown_seconds) then v_cooling:=v_cooling+1; continue; end if;
    select coalesce(max(case when (t.task_spec->>'meta_generation')~'^[0-9]+$' then (t.task_spec->>'meta_generation')::integer else 0 end),0)+1 into v_generation from destruktion_meta.devos_fleet_task_h205f22 t where t.task_spec->>'meta_lane'=v_lane.lane;
    v_branch:=format('work/devos-meta-%s-g%s',v_lane.lane,v_generation);
    v_result:=public.devos_fleet_enqueue_v1(v_workspace,format('devos.meta.%s.g%s',v_lane.lane,v_generation),v_lane.role_name,v_base,
      jsonb_build_object('schema','metaengine.devos.meta-control-task.v2','meta_lane',v_lane.lane,'meta_generation',v_generation,'hierarchy_level','L0','scope','GLOBAL','continuous_role',true,'execution_model','BOUNDED_RENEWABLE_EPISODE','cycle_target_seconds',300,'cooldown_seconds',v_lane.cooldown_seconds,'must_finish_generation',true,'objective',v_lane.objective_text,'scheduler','devos_fleet_watchdog_h205f22','observes_all_fleet',true,'can_enqueue_typed_tasks',v_lane.can_enqueue,'max_new_tasks_per_cycle',v_lane.max_dispatch,'can_direct_browser_effects',false,'can_promote_production',false,'cannot_self_approve',true,'requires_independent_review',true,'reconcile_previous_before_effect',true,'automatic_retry_after_ambiguous_effect',false,'page_model_worker_authority',false,'source_workspace_id',v_workspace,'source_base_sha',v_base,'authority_effect',false),
      format('devos-meta:%s:g%s:%s',v_lane.lane,v_generation,v_base),v_branch,v_lane.priority_value);
    v_created:=v_created||jsonb_build_array(v_result);
  end loop;
  return jsonb_build_object('ok',true,'workspace_id',v_workspace,'base_sha',v_base,'base_source','METAENGINE_DEVOS_ROADMAP_AUTHORITY','open_lanes_preserved',v_existing,'cooling_lanes',v_cooling,'created',v_created,'authority_effect',false);
end
$function$;