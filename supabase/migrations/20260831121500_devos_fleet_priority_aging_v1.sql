create or replace function public.devos_fleet_lease_v1(
  p_workspace uuid,
  p_agent text,
  p_role text,
  p_tab text,
  p_target text,
  p_epoch bigint,
  p_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'destruktion_meta'
as $$
declare
  v_task destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_claim bigint;
  v_secs int := greatest(60, least(3600, coalesce(p_seconds, 900)));
  v_now timestamptz := clock_timestamp();
  v_age_boost int := 0;
  v_effective_priority int := 0;
begin
  update destruktion_meta.devos_fleet_task_h205f22
     set state = 'AMBIGUOUS',
         error_code = 'LEASE_EXPIRED_EFFECT_UNKNOWN',
         updated_at = v_now
   where workspace_id = p_workspace
     and state in ('LEASED','RUNNING')
     and lease_expires_at <= v_now;

  update destruktion_meta.devos_fleet_claim_h205f22
     set state = 'EXPIRED',
         updated_at = v_now
   where workspace_id = p_workspace
     and state = 'ACTIVE'
     and expires_at <= v_now;

  with picked as (
    select t.task_id
      from destruktion_meta.devos_fleet_task_h205f22 t
     where t.workspace_id = p_workspace
       and t.state = 'READY'
       and t.role = upper(p_role)
       and not exists (
         select 1
           from destruktion_meta.devos_fleet_claim_h205f22 c
          where c.workspace_id = p_workspace
            and c.agent_id = lower(p_agent)
            and c.state = 'ACTIVE'
       )
       and (
         t.claim_class <> 'MUTATING'
         or not exists (
           select 1
             from destruktion_meta.devos_fleet_claim_h205f22 c
            where c.workspace_id = t.workspace_id
              and c.point_id = t.point_id
              and c.base_sha = t.base_sha
              and c.claim_class = 'MUTATING'
              and c.state = 'ACTIVE'
         )
       )
     order by
       (
         t.priority
         + least(
             24,
             greatest(
               0,
               floor(extract(epoch from (v_now - t.created_at)) / 900.0)::int
             )
           )
       ) desc,
       t.priority desc,
       t.created_at,
       t.task_id
     for update skip locked
     limit 1
  )
  update destruktion_meta.devos_fleet_task_h205f22 t
     set state = 'LEASED',
         lease_generation = t.lease_generation + 1,
         lease_agent_id = lower(p_agent),
         lease_tab_id = p_tab,
         lease_target_id = lower(p_target),
         lease_agent_generation_epoch = p_epoch,
         lease_expires_at = v_now + make_interval(secs => v_secs),
         updated_at = v_now
    from picked p
   where t.task_id = p.task_id
  returning t.* into v_task;

  if not found then
    return jsonb_build_object(
      'leased', false,
      'agent_id', lower(p_agent),
      'role', upper(p_role),
      'scheduler_policy', 'priority_plus_bounded_age_v1',
      'automatic_retry_allowed', false,
      'authority_effect', false
    );
  end if;

  v_age_boost := least(
    24,
    greatest(
      0,
      floor(extract(epoch from (v_now - v_task.created_at)) / 900.0)::int
    )
  );
  v_effective_priority := v_task.priority + v_age_boost;

  insert into destruktion_meta.devos_fleet_claim_h205f22(
    task_id,
    workspace_id,
    point_id,
    base_sha,
    role,
    claim_class,
    agent_id,
    tab_id,
    target_id,
    agent_generation_epoch,
    lease_generation,
    expires_at
  ) values (
    v_task.task_id,
    v_task.workspace_id,
    v_task.point_id,
    v_task.base_sha,
    v_task.role,
    v_task.claim_class,
    lower(p_agent),
    p_tab,
    lower(p_target),
    p_epoch,
    v_task.lease_generation,
    v_task.lease_expires_at
  )
  returning claim_id into v_claim;

  perform destruktion_meta.devos_emit_event_h205f22(
    v_task.workspace_id,
    'TASK_LEASED',
    v_task.task_id,
    v_task.point_id,
    v_task.role,
    lower(p_agent),
    v_task.lease_generation,
    v_task.base_sha,
    jsonb_build_object(
      'claim_id', v_claim,
      'tab_id', p_tab,
      'target_id', lower(p_target),
      'agent_generation_epoch', p_epoch,
      'lease_expires_at', v_task.lease_expires_at,
      'raw_priority', v_task.priority,
      'age_boost', v_age_boost,
      'effective_priority', v_effective_priority,
      'scheduler_policy', 'priority_plus_bounded_age_v1',
      'automatic_retry_allowed', false,
      'authority_effect', false
    ),
    v_task.idempotency_key || ':lease:' || v_task.lease_generation
  );

  return jsonb_build_object(
    'leased', true,
    'task_id', v_task.task_id,
    'claim_id', v_claim,
    'point_id', v_task.point_id,
    'role', v_task.role,
    'claim_class', v_task.claim_class,
    'base_sha', v_task.base_sha,
    'branch_name', v_task.branch_name,
    'task_spec', v_task.task_spec,
    'task_spec_sha256', v_task.task_spec_sha256,
    'lease_generation', v_task.lease_generation,
    'lease_expires_at', v_task.lease_expires_at,
    'agent_id', lower(p_agent),
    'tab_id', p_tab,
    'target_id', lower(p_target),
    'agent_generation_epoch', p_epoch,
    'raw_priority', v_task.priority,
    'age_boost', v_age_boost,
    'effective_priority', v_effective_priority,
    'scheduler_policy', 'priority_plus_bounded_age_v1',
    'automatic_retry_allowed', false,
    'authority_effect', false
  );
end
$$;

revoke all on function public.devos_fleet_lease_v1(uuid,text,text,text,text,bigint,integer) from public;
revoke all on function public.devos_fleet_lease_v1(uuid,text,text,text,text,bigint,integer) from anon;
revoke all on function public.devos_fleet_lease_v1(uuid,text,text,text,text,bigint,integer) from authenticated;
grant execute on function public.devos_fleet_lease_v1(uuid,text,text,text,text,bigint,integer) to service_role;
