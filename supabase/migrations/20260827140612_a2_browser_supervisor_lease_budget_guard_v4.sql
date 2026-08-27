create or replace function public.h205f22_a2_browser_supervisor_lease_v3(
  p_workspace_id uuid,
  p_client_id text,
  p_supervisor_mode text default 'OFF',
  p_lease_timeout_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_row public.compute_fabric_a2_browser_supervisor_command_h205f22%rowtype;
  v_client text := left(trim(coalesce(p_client_id,'')),160);
  v_mode text := upper(coalesce(p_supervisor_mode,'OFF'));
  v_lease_timeout integer := greatest(30, least(600, coalesce(p_lease_timeout_seconds,120)));
  v_now timestamptz := clock_timestamp();
  v_window interval := interval '60 seconds';
  v_budget_limit integer := 24;
  v_failure_limit integer := 5;
  v_used_cost integer := 0;
  v_recent_failures integer := 0;
  v_requested_cost integer := 0;
  v_emergency boolean := false;
  v_guard jsonb;
begin
  if v_client = '' then raise exception 'supervisor_client_id_required'; end if;
  if v_mode not in ('OFF','MONITOR','CONTROL') then raise exception 'supervisor_mode_invalid'; end if;

  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status='EXPIRED', completed_at=v_now, error='command_expired_before_lease'
   where workspace_id=p_workspace_id and status='PENDING' and expires_at <= v_now;

  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status='EXPIRED', completed_at=v_now, error='lease_timeout_no_retry'
   where workspace_id=p_workspace_id
     and status='LEASED'
     and (expires_at <= v_now or leased_at is null
          or leased_at <= v_now - make_interval(secs=>v_lease_timeout));

  select
    coalesce(sum(case
      when action in ('POLL','CAPTURE','DISARM') then 0
      when action='SET_SUPERVISOR_MODE' and upper(coalesce(payload->>'mode',''))='OFF' then 0
      when action in ('SCROLL','SEMANTIC_FOCUS') then 1
      when action in ('ARM','SET_SUPERVISOR_MODE','SET_MODE','STOP_GENERATION') then 2
      when action='SEMANTIC_TYPE' then 3
      when action='RESOLVE_PROMPT' then 4
      else 4
    end),0)::integer,
    count(*) filter (where status in ('FAILED','EXPIRED'))::integer
  into v_used_cost, v_recent_failures
  from public.compute_fabric_a2_browser_supervisor_command_h205f22
  where workspace_id=p_workspace_id
    and leased_by=v_client
    and leased_at >= v_now - v_window
    and status in ('LEASED','COMPLETED','FAILED','EXPIRED');

  select * into v_row
  from public.compute_fabric_a2_browser_supervisor_command_h205f22
  where workspace_id=p_workspace_id
    and status='PENDING'
    and expires_at > v_now
    and (target_client_id is null or target_client_id=v_client)
    and (v_mode='CONTROL' or action in ('SET_SUPERVISOR_MODE','ARM','DISARM'))
  order by issued_at asc
  for update skip locked
  limit 1;

  if not found then
    return jsonb_build_object('command',null,'guard',jsonb_build_object(
      'schema','metaengine.a2-browser-supervisor.action-budget.v1',
      'window_seconds',60,'limit',v_budget_limit,'used_cost',v_used_cost,
      'failure_limit',v_failure_limit,'recent_failures',v_recent_failures,'circuit_open',false));
  end if;

  v_emergency := v_row.action='DISARM'
    or (v_row.action='SET_SUPERVISOR_MODE' and upper(coalesce(v_row.payload->>'mode',''))='OFF');
  v_requested_cost := case
    when v_row.action in ('POLL','CAPTURE','DISARM') then 0
    when v_row.action='SET_SUPERVISOR_MODE' and upper(coalesce(v_row.payload->>'mode',''))='OFF' then 0
    when v_row.action in ('SCROLL','SEMANTIC_FOCUS') then 1
    when v_row.action in ('ARM','SET_SUPERVISOR_MODE','SET_MODE','STOP_GENERATION') then 2
    when v_row.action='SEMANTIC_TYPE' then 3
    when v_row.action='RESOLVE_PROMPT' then 4
    else 4
  end;

  if not v_emergency and v_recent_failures >= v_failure_limit then
    v_guard := jsonb_build_object(
      'schema','metaengine.a2-browser-supervisor.action-budget.v1',
      'blocked',true,'reason','FAILURE_CIRCUIT_OPEN','window_seconds',60,
      'failure_limit',v_failure_limit,'recent_failures',v_recent_failures,
      'used_cost',v_used_cost,'requested_cost',v_requested_cost,'limit',v_budget_limit);
    update public.compute_fabric_a2_browser_supervisor_command_h205f22
       set status='FAILED', completed_at=v_now, error='supervisor_failure_circuit_open',
           receipt=v_guard, authority_effect=false
     where command_id=v_row.command_id;
    return jsonb_build_object('command',null,'guard',v_guard);
  end if;

  if not v_emergency and v_requested_cost > 0 and v_used_cost + v_requested_cost > v_budget_limit then
    v_guard := jsonb_build_object(
      'schema','metaengine.a2-browser-supervisor.action-budget.v1',
      'blocked',true,'reason','ACTION_BUDGET_EXCEEDED','window_seconds',60,
      'used_cost',v_used_cost,'requested_cost',v_requested_cost,'limit',v_budget_limit,
      'failure_limit',v_failure_limit,'recent_failures',v_recent_failures);
    update public.compute_fabric_a2_browser_supervisor_command_h205f22
       set status='FAILED', completed_at=v_now, error='supervisor_action_budget_exceeded',
           receipt=v_guard, authority_effect=false
     where command_id=v_row.command_id;
    return jsonb_build_object('command',null,'guard',v_guard);
  end if;

  update public.compute_fabric_a2_browser_supervisor_command_h205f22
     set status='LEASED', leased_by=v_client, leased_at=v_now
   where command_id=v_row.command_id;

  return jsonb_build_object(
    'command',jsonb_build_object(
      'command_id',v_row.command_id,
      'idempotency_key',v_row.idempotency_key,
      'action',v_row.action,
      'platform',v_row.platform,
      'payload',v_row.payload,
      'issued_at',v_row.issued_at,
      'expires_at',v_row.expires_at,
      'issued_by',v_row.issued_by,
      'authority_effect',false
    ),
    'guard',jsonb_build_object(
      'schema','metaengine.a2-browser-supervisor.action-budget.v1',
      'blocked',false,'window_seconds',60,'used_cost',v_used_cost,
      'requested_cost',v_requested_cost,'limit',v_budget_limit,
      'failure_limit',v_failure_limit,'recent_failures',v_recent_failures,
      'emergency_bypass',v_emergency)
  );
end;
$$;

revoke all on function public.h205f22_a2_browser_supervisor_lease_v3(uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.h205f22_a2_browser_supervisor_lease_v3(uuid,text,text,integer) to service_role;
comment on function public.h205f22_a2_browser_supervisor_lease_v3(uuid,text,text,integer) is 'A2 Browser Supervisor v3 lease with v4 rolling weighted action budget, failure circuit breaker, stale-command expiry, and emergency DISARM/OFF bypass.';
