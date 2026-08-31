-- DEVOS META DISPATCH V1
-- Typed, lease-fenced and budgeted child-task creation for the L0 Meta-Governor.
-- This function cannot directly actuate Browser state or promote production.

create or replace function public.devos_meta_dispatch_v1(
  p_meta_task uuid,
  p_agent text,
  p_generation bigint,
  p_tab text,
  p_target text,
  p_epoch bigint,
  p_point text,
  p_role text,
  p_base text,
  p_spec jsonb,
  p_branch text default null,
  p_priority integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'destruktion_meta', 'public', 'extensions'
as $function$
declare
  v_meta destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_role text := upper(trim(p_role));
  v_point text := lower(trim(p_point));
  v_base text := lower(trim(p_base));
  v_budget integer;
  v_used integer;
  v_key text;
  v_spec jsonb;
  v_existing uuid;
  v_result jsonb;
begin
  if p_meta_task is null
     or lower(coalesce(p_agent,'')) !~ '^[a-z0-9][a-z0-9._:-]{2,159}$'
     or coalesce(p_tab,'') = ''
     or lower(coalesce(p_target,'')) = ''
     or p_generation is null
     or p_epoch is null
     or v_point !~ '^[a-z0-9][a-z0-9._:-]{2,127}$'
     or v_base !~ '^[0-9a-f]{40}$'
     or jsonb_typeof(coalesce(p_spec,'{}'::jsonb)) <> 'object'
     or v_role not in ('PLANNER','IMPLEMENTER','RESEARCHER','CRITIC','FALSIFIER','SYNTHESIZER') then
    raise exception 'invalid_meta_dispatch';
  end if;

  if v_point like 'devos.meta.%' then
    raise exception 'meta_recursive_dispatch_denied';
  end if;

  if p_branch is not null and p_branch !~ '^work/[A-Za-z0-9][A-Za-z0-9._/-]{2,120}$' then
    raise exception 'invalid_work_branch';
  end if;
  if v_role = 'IMPLEMENTER' and p_branch is null then
    raise exception 'mutating_dispatch_requires_work_branch';
  end if;

  select * into v_meta
  from destruktion_meta.devos_fleet_task_h205f22
  where task_id = p_meta_task
  for update;

  if not found
     or v_meta.task_spec ->> 'meta_lane' <> 'governor'
     or coalesce((v_meta.task_spec ->> 'can_enqueue_typed_tasks')::boolean,false) is not true
     or v_meta.state not in ('LEASED','RUNNING')
     or v_meta.lease_agent_id <> lower(p_agent)
     or v_meta.lease_generation <> p_generation
     or v_meta.lease_tab_id <> p_tab
     or v_meta.lease_target_id <> lower(p_target)
     or v_meta.lease_agent_generation_epoch <> p_epoch
     or v_meta.lease_expires_at <= clock_timestamp() then
    raise exception 'meta_governor_lease_fenced';
  end if;

  v_budget := greatest(0, least(16, coalesce((v_meta.task_spec ->> 'max_new_tasks_per_cycle')::integer,0)));
  if v_budget = 0 then
    raise exception 'meta_dispatch_disabled';
  end if;

  select count(*) into v_used
  from destruktion_meta.devos_fleet_task_h205f22 t
  where t.task_spec ->> 'parent_meta_task_id' = p_meta_task::text
    and t.task_spec ->> 'parent_meta_generation' = p_generation::text;

  if v_used >= v_budget then
    raise exception 'meta_dispatch_budget_exhausted';
  end if;

  -- Same semantic point/base remains occupied while unresolved, including
  -- AMBIGUOUS. Recovery must use a distinct reconciliation point instead of a
  -- blind replay of the same task.
  select t.task_id into v_existing
  from destruktion_meta.devos_fleet_task_h205f22 t
  where t.workspace_id = v_meta.workspace_id
    and t.point_id = v_point
    and t.base_sha = v_base
    and t.state in ('READY','LEASED','RUNNING','RESULT_READY','BLOCKED','AMBIGUOUS')
  order by t.created_at desc
  limit 1;

  if v_existing is not null then
    return jsonb_build_object(
      'enqueued', false,
      'duplicate_semantic_work', true,
      'existing_task_id', v_existing,
      'point_id', v_point,
      'base_sha', v_base,
      'budget', v_budget,
      'budget_used', v_used,
      'authority_effect', false
    );
  end if;

  v_spec := coalesce(p_spec,'{}'::jsonb) || jsonb_build_object(
    'schema','metaengine.devos.meta-dispatched-task.v1',
    'parent_meta_task_id',p_meta_task,
    'parent_meta_generation',p_generation,
    'dispatched_by_agent_id',lower(p_agent),
    'dispatched_by_meta_lane','governor',
    'source_workspace_id',v_meta.workspace_id,
    'source_meta_base_sha',v_meta.base_sha,
    'reconcile_previous_before_effect',true,
    'automatic_retry_after_ambiguous_effect',false,
    'page_model_worker_authority',false,
    'can_promote_production',false,
    'authority_effect',false
  );

  v_key := format('meta-dispatch:%s:g%s:%s:%s',p_meta_task,p_generation,v_point,v_base);
  v_result := public.devos_fleet_enqueue_v1(
    v_meta.workspace_id,
    v_point,
    v_role,
    v_base,
    v_spec,
    v_key,
    p_branch,
    greatest(0,least(100,coalesce(p_priority,50)))
  );

  return jsonb_build_object(
    'enqueued', true,
    'dispatch', v_result,
    'budget', v_budget,
    'budget_used_before', v_used,
    'budget_remaining', greatest(0,v_budget-v_used-1),
    'authority_effect', false
  );
end
$function$;

revoke all on function public.devos_meta_dispatch_v1(uuid,text,bigint,text,text,bigint,text,text,text,jsonb,text,integer) from public, anon, authenticated;
