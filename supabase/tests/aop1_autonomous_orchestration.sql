-- Rollback-only AOP1 behavioral canaries.
-- Requires the H205F22 baseline plus 20260821060500_aop1_clean_replay.sql.

begin;

insert into destruktion_meta.compute_fabric_aop_role_h205f22(
  role_key,role_kind,milestone_key,mutation_domains,executor_profile,max_attempts,config
) values (
  'AOP1_SELFTEST_ANALYST','ANALYST',null,array[]::text[],'SELFTEST',4,'{}'::jsonb
) on conflict(role_key) do update set enabled=true,updated_at=clock_timestamp();

-- Event idempotency: same key -> same event, second call reports duplicate.
do $$
declare a jsonb; b jsonb;
begin
  a:=destruktion_meta.compute_fabric_aop_emit_event_h205f22(
    'AOP1_SELFTEST',null,null,'AOP1_SELFTEST_ANALYST','SELFTEST',
    jsonb_build_object('case','event-idempotency'),'aop1:selftest:event-idempotency',null
  );
  b:=destruktion_meta.compute_fabric_aop_emit_event_h205f22(
    'AOP1_SELFTEST',null,null,'AOP1_SELFTEST_ANALYST','SELFTEST',
    jsonb_build_object('case','event-idempotency'),'aop1:selftest:event-idempotency',null
  );
  if a->>'event_id' is distinct from b->>'event_id' or coalesce((b->>'duplicate')::boolean,false) is not true then
    raise exception 'event_idempotency_failed';
  end if;
end $$;

-- Run enqueue idempotency.
do $$
declare a jsonb; b jsonb;
begin
  a:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22(
    'AOP1_SELFTEST_ANALYST',null,null,null,jsonb_build_object('case','run-idempotency'),
    'aop1:selftest:run-idempotency',null,'READY',null
  );
  b:=destruktion_meta.compute_fabric_aop_enqueue_role_h205f22(
    'AOP1_SELFTEST_ANALYST',null,null,null,jsonb_build_object('case','run-idempotency'),
    'aop1:selftest:run-idempotency',null,'READY',null
  );
  if a->>'run_id' is distinct from b->>'run_id' or coalesce((b->>'duplicate')::boolean,false) is not true then
    raise exception 'run_idempotency_failed';
  end if;
end $$;

-- Lease generation fencing and terminal immutability.
do $$
declare l1 jsonb; l2 jsonb; rid uuid; g1 bigint; g2 bigint; completed jsonb;
begin
  perform destruktion_meta.compute_fabric_aop_enqueue_role_h205f22(
    'AOP1_SELFTEST_ANALYST',null,null,null,jsonb_build_object('case','lease-fencing'),
    'aop1:selftest:lease-fencing',null,'READY',null
  );
  l1:=public.h205f22_aop1_lease_run_v1('aop1-selftest-worker-a','AOP1_SELFTEST_ANALYST',30);
  if coalesce((l1->>'leased')::boolean,false) is not true then raise exception 'first_lease_failed'; end if;
  rid:=(l1->>'run_id')::uuid; g1:=(l1->>'lease_generation')::bigint;

  update destruktion_meta.compute_fabric_aop_run_h205f22 set lease_expires_at=clock_timestamp()-interval '1 second' where run_id=rid;
  l2:=public.h205f22_aop1_lease_run_v1('aop1-selftest-worker-b','AOP1_SELFTEST_ANALYST',30);
  if coalesce((l2->>'leased')::boolean,false) is not true or (l2->>'run_id')::uuid<>rid then raise exception 'second_lease_failed'; end if;
  g2:=(l2->>'lease_generation')::bigint;
  if g2<=g1 then raise exception 'lease_generation_not_advanced'; end if;

  begin
    perform public.h205f22_aop1_complete_run_v1(rid,'aop1-selftest-worker-a',g1,'ACCEPT',jsonb_build_object('case','stale-lease'),null,null);
    raise exception 'stale_lease_was_not_fenced';
  exception when sqlstate '55000' then null;
  end;

  completed:=public.h205f22_aop1_complete_run_v1(rid,'aop1-selftest-worker-b',g2,'ACCEPT',jsonb_build_object('case','fresh-lease'),null,null);
  if completed->>'state'<>'COMPLETED' then raise exception 'fresh_completion_failed'; end if;

  begin
    update destruktion_meta.compute_fabric_aop_run_h205f22 set result_code='MUTATED' where run_id=rid;
    raise exception 'terminal_run_was_mutable';
  exception when sqlstate '55000' then null;
  end;
end $$;

-- Append-only event guard.
do $$
declare eid bigint;
begin
  select event_id into eid from destruktion_meta.compute_fabric_aop_event_h205f22 where idempotency_key='aop1:selftest:event-idempotency';
  begin
    update destruktion_meta.compute_fabric_aop_event_h205f22 set event_type='MUTATED' where event_id=eid;
    raise exception 'event_was_mutable';
  exception when sqlstate '55000' then null;
  end;
end $$;

rollback;
