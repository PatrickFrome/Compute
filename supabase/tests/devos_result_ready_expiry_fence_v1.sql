-- DEVOS result-ready expiry fence v1 rollback self-test.
-- Synthetic task rows are rolled back; no production authority effect.

begin;

do $$
declare
  v_workspace uuid := gen_random_uuid();
  v_result_ready uuid := gen_random_uuid();
  v_blocked uuid := gen_random_uuid();
  v_reconcile jsonb;
  v_state text;
  v_error text;
  v_event_payload jsonb;
begin
  insert into destruktion_meta.devos_fleet_task_h205f22(
    task_id,workspace_id,idempotency_key,point_id,role,claim_class,base_sha,branch_name,
    priority,task_spec,task_spec_sha256,state,lease_generation,lease_agent_id,lease_tab_id,
    lease_target_id,lease_agent_generation_epoch,lease_expires_at,result_sha256,authority_effect
  ) values
  (
    v_result_ready,v_workspace,'selftest:result-ready','devos.selftest.result-ready','PLANNER','ADVISORY',
    repeat('a',40),'work/selftest-result-ready',100,'{}'::jsonb,repeat('b',64),'RESULT_READY',1,
    'agent_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee','tab_11111111-2222-4333-8444-555555555555',
    'webcontents:101',1,clock_timestamp()-interval '1 minute',repeat('e',64),false
  ),
  (
    v_blocked,v_workspace,'selftest:blocked','devos.selftest.blocked','CRITIC','ADVISORY',
    repeat('c',40),'work/selftest-blocked',90,'{}'::jsonb,repeat('d',64),'BLOCKED',1,
    'agent_bbbbbbbb-cccc-4ddd-8eee-ffffffffffff','tab_22222222-3333-4444-8555-666666666666',
    'webcontents:102',1,clock_timestamp()-interval '1 minute',null,false
  );

  v_reconcile := public.devos_fleet_reconcile_v1(v_workspace);
  if (v_reconcile->>'requeued_tasks')::integer <> 0 then
    raise exception 'expired result work was incorrectly requeued: %', v_reconcile;
  end if;
  if (v_reconcile->>'automatic_retry_allowed')::boolean then
    raise exception 'automatic retry was incorrectly allowed: %', v_reconcile;
  end if;
  if (v_reconcile->>'expired_tasks_fenced_ambiguous')::integer <> 2 then
    raise exception 'expected two expired task fences: %', v_reconcile;
  end if;

  select state,error_code into v_state,v_error
    from destruktion_meta.devos_fleet_task_h205f22 where task_id=v_result_ready;
  if v_state <> 'AMBIGUOUS' or v_error <> 'LEASE_EXPIRED_RESULT_UNADOPTED' then
    raise exception 'RESULT_READY did not fail closed: state=% error=%',v_state,v_error;
  end if;

  select payload into v_event_payload
    from destruktion_meta.devos_fleet_event_h205f22
   where workspace_id=v_workspace
     and task_id=v_result_ready
     and event_type='TASK_LEASE_EXPIRED_AMBIGUOUS'
   order by event_id desc
   limit 1;
  if v_event_payload is null then
    raise exception 'RESULT_READY expiry evidence event missing';
  end if;
  if v_event_payload->>'result_sha256' <> repeat('e',64) then
    raise exception 'RESULT_READY digest was not preserved: %',v_event_payload;
  end if;
  if coalesce((v_event_payload->>'automatic_retry_allowed')::boolean,true) then
    raise exception 'RESULT_READY expiry event incorrectly permits retry: %',v_event_payload;
  end if;
  if coalesce((v_event_payload->>'authority_effect')::boolean,true) then
    raise exception 'RESULT_READY expiry event incorrectly claims authority: %',v_event_payload;
  end if;

  select state,error_code into v_state,v_error
    from destruktion_meta.devos_fleet_task_h205f22 where task_id=v_blocked;
  if v_state <> 'AMBIGUOUS' or v_error <> 'LEASE_EXPIRED_BLOCKED_UNRESOLVED' then
    raise exception 'BLOCKED did not fail closed: state=% error=%',v_state,v_error;
  end if;
end
$$;

rollback;
