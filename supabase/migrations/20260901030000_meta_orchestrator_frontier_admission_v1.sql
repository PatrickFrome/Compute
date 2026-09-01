-- METAENGINE Meta-Orchestrator atomic frontier admission v1.
-- Branch-local migration only. Do not apply to production from this audit task.
--
-- A Meta superstep may require a safety group (primary + critic/falsifier). Admitting those
-- points one HTTP request at a time can leave a partial group after process/network failure.
-- This RPC materializes the complete semantic frontier in one Postgres transaction while
-- reusing the existing canonical meta_orchestrator_task_admit_v1 -> devos_fleet_enqueue_v1
-- ingress for every point. It allocates no lease, agent, tab, target, workspace or Browser
-- authority and starts no scheduler/poller.

create or replace function public.meta_orchestrator_frontier_admit_v1(
  p_workspace_id uuid,
  p_roadmap_id text,
  p_plan_generation bigint,
  p_point_ids text[]
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, destruktion_meta, pg_temp
as $$
declare
  v_roadmap_id text := lower(trim(coalesce(p_roadmap_id,'')));
  v_point_raw text;
  v_point text;
  v_seen text[] := array[]::text[];
  v_one jsonb;
  v_results jsonb := '[]'::jsonb;
  v_count integer := coalesce(array_length(p_point_ids,1),0);
begin
  if p_workspace_id is null then
    raise exception 'meta_frontier_workspace_required' using errcode = '22023';
  end if;
  if v_roadmap_id !~ '^[a-z0-9][a-z0-9._:-]{2,159}$' then
    raise exception 'meta_frontier_roadmap_invalid' using errcode = '22023';
  end if;
  if coalesce(p_plan_generation,0) < 1 then
    raise exception 'meta_frontier_plan_generation_invalid' using errcode = '22023';
  end if;
  if v_count < 1 or v_count > 8 then
    raise exception 'meta_frontier_size_invalid' using errcode = '22023';
  end if;

  -- Serialize one plan-generation frontier. Nested task-admission locks keep individual points
  -- idempotent as well. Any exception below aborts this entire transaction, so the caller can
  -- never observe a newly-created partial safety group from this invocation.
  perform pg_advisory_xact_lock(hashtextextended(
    'meta-frontier-admit:' || p_workspace_id::text || ':' || v_roadmap_id || ':' || p_plan_generation::text,
    0
  ));

  foreach v_point_raw in array p_point_ids
  loop
    v_point := lower(trim(coalesce(v_point_raw,'')));
    if v_point !~ '^[a-z0-9][a-z0-9._:-]{2,191}$' then
      raise exception 'meta_frontier_point_invalid' using errcode = '22023';
    end if;
    if v_point = any(v_seen) then
      raise exception 'meta_frontier_duplicate_point' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen,v_point);

    v_one := public.meta_orchestrator_task_admit_v1(
      p_workspace_id,
      v_roadmap_id,
      p_plan_generation,
      v_point
    );

    if v_one->>'schema' <> 'metaengine.meta-orchestrator.task-admission.v1'
       or coalesce(v_one->>'task_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce((v_one->>'authority_effect')::boolean,true) <> false
       or coalesce((v_one->>'scheduler_authority')::boolean,true) <> false
       or coalesce((v_one->>'browser_authority')::boolean,true) <> false then
      raise exception 'meta_frontier_task_admission_readback_invalid';
    end if;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'point_id',v_point,
      'task_id',v_one->>'task_id',
      'duplicate',coalesce((v_one->>'duplicate')::boolean,false),
      'task_spec_sha256',v_one->>'task_spec_sha256',
      'authority_effect',false
    ));
  end loop;

  return jsonb_build_object(
    'schema','metaengine.meta-orchestrator.frontier-admission.v1',
    'workspace_id',p_workspace_id,
    'roadmap_id',v_roadmap_id,
    'plan_generation',p_plan_generation,
    'point_count',v_count,
    'points',v_results,
    'atomic_transaction',true,
    'all_or_none_new_admission',true,
    'task_payload_returned',false,
    'scheduler_identity_returned',false,
    'second_scheduler_loop',false,
    'automatic_retry_allowed',false,
    'task_content_authority',false,
    'scheduler_authority',false,
    'browser_authority',false,
    'release_authority',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.meta_orchestrator_frontier_admit_v1(uuid,text,bigint,text[]) from public, anon, authenticated;
grant execute on function public.meta_orchestrator_frontier_admit_v1(uuid,text,bigint,text[]) to service_role;
