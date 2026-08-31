-- DEVOS META SNAPSHOT V1
-- Compact, read-only project-control summary for L0 meta agents.

create or replace function public.devos_meta_snapshot_v1(p_workspace uuid)
returns jsonb
language sql
security definer
set search_path to 'pg_catalog','destruktion_meta','public','cron'
as $function$
with
state_counts as (
  select coalesce(jsonb_object_agg(state,cnt order by state),'{}'::jsonb) as value
  from (
    select state,count(*)::bigint as cnt
    from destruktion_meta.devos_fleet_task_h205f22
    where workspace_id=p_workspace
    group by state
  ) s
),
role_pressure as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'role',d.role,
    'ready',d.ready,
    'active',d.active,
    'result_ready',d.result_ready,
    'blocked',d.blocked,
    'ambiguous',d.ambiguous,
    'active_agents',coalesce(s.active_agents,0)
  ) order by d.ready desc,d.role),'[]'::jsonb) as value
  from (
    select role,
      count(*) filter(where state='READY')::bigint as ready,
      count(*) filter(where state in('LEASED','RUNNING'))::bigint as active,
      count(*) filter(where state='RESULT_READY')::bigint as result_ready,
      count(*) filter(where state='BLOCKED')::bigint as blocked,
      count(*) filter(where state='AMBIGUOUS')::bigint as ambiguous
    from destruktion_meta.devos_fleet_task_h205f22
    where workspace_id=p_workspace
      and state not in('COMPLETED','FAILED','CANCELLED','FENCED')
    group by role
  ) d
  left join (
    select role,count(distinct agent_id)::bigint as active_agents
    from destruktion_meta.devos_fleet_claim_h205f22
    where workspace_id=p_workspace and state='ACTIVE'
    group by role
  ) s using(role)
),
meta_lanes as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'lane',task_spec->>'meta_lane',
    'generation',task_spec->>'meta_generation',
    'role',role,
    'state',state,
    'priority',priority,
    'lease_generation',lease_generation,
    'updated_at',updated_at
  ) order by priority desc,created_at desc),'[]'::jsonb) as value
  from destruktion_meta.devos_fleet_task_h205f22
  where workspace_id=p_workspace and task_spec ? 'meta_lane'
    and state not in('COMPLETED','FAILED','CANCELLED','FENCED')
),
maintenance_lanes as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'lane',task_spec->>'maintenance_lane',
    'generation',task_spec->>'maintenance_generation',
    'role',role,
    'state',state,
    'priority',priority,
    'lease_generation',lease_generation,
    'updated_at',updated_at
  ) order by priority desc,created_at desc),'[]'::jsonb) as value
  from destruktion_meta.devos_fleet_task_h205f22
  where workspace_id=p_workspace and task_spec ? 'maintenance_lane'
    and state not in('COMPLETED','FAILED','CANCELLED','FENCED')
),
health as (
  select jsonb_build_object(
    'ambiguous_tasks',count(*) filter(where state='AMBIGUOUS'),
    'running_over_30m',count(*) filter(where state='RUNNING' and updated_at < clock_timestamp()-interval '30 minutes'),
    'leased_over_30m',count(*) filter(where state='LEASED' and updated_at < clock_timestamp()-interval '30 minutes'),
    'oldest_ready_at',min(created_at) filter(where state='READY'),
    'oldest_active_update_at',min(updated_at) filter(where state in('LEASED','RUNNING'))
  ) as value
  from destruktion_meta.devos_fleet_task_h205f22
  where workspace_id=p_workspace
),
scheduler as (
  select coalesce((
    select jsonb_build_object(
      'job_id',j.jobid,
      'job_name',j.jobname,
      'schedule',j.schedule,
      'active',j.active,
      'last_status',r.status,
      'last_start_time',r.start_time,
      'last_end_time',r.end_time
    )
    from cron.job j
    left join lateral (
      select status,start_time,end_time
      from cron.job_run_details d
      where d.jobid=j.jobid
      order by start_time desc
      limit 1
    ) r on true
    where j.jobname='metaengine-h205f22-devos-fleet-watchdog'
    limit 1
  ),'{}'::jsonb) as value
)
select jsonb_build_object(
  'schema','metaengine.devos.meta-snapshot.v1',
  'workspace_id',p_workspace,
  'observed_at',clock_timestamp(),
  'task_state_counts',(select value from state_counts),
  'role_pressure',(select value from role_pressure),
  'meta_lanes',(select value from meta_lanes),
  'maintenance_lanes',(select value from maintenance_lanes),
  'health',(select value from health),
  'scheduler',(select value from scheduler),
  'task_specs_exposed',false,
  'authority_effect',false
);
$function$;

revoke all on function public.devos_meta_snapshot_v1(uuid) from public, anon, authenticated;
