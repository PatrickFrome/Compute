#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:=postgresql://postgres:postgres@localhost:5432/falsifier}"
export DATABASE_URL

psqlq() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -X "$@"
}

MIGRATION="supabase/migrations/20260902103500_devos_result_ready_expiry_fence_v1.sql"
WORKSPACE="11111111-1111-1111-1111-111111111111"

cat >/tmp/devos_falsifier_prelude.sql <<'SQL'
create schema if not exists destruktion_meta;

create table public.compute_fabric_a2_supervisor_mesh_instance_h205f22 (
  status text not null,
  tab_id text,
  retired_at timestamptz,
  authority_effect boolean not null default false,
  last_seen_at timestamptz not null
);

create table destruktion_meta.devos_fleet_task_h205f22 (
  workspace_id uuid not null,
  task_id uuid primary key,
  point_id text not null,
  role text not null,
  lease_agent_id text,
  lease_generation bigint not null,
  base_sha text,
  lease_tab_id text,
  lease_target_id text,
  lease_agent_generation_epoch bigint,
  lease_expires_at timestamptz,
  result_sha256 text,
  idempotency_key text not null,
  state text not null,
  error_code text,
  updated_at timestamptz not null default clock_timestamp()
);

create table destruktion_meta.devos_fleet_claim_h205f22 (
  workspace_id uuid not null,
  claim_id uuid primary key,
  task_id uuid,
  point_id text not null,
  role text not null,
  agent_id text,
  lease_generation bigint not null,
  base_sha text,
  claim_class text,
  tab_id text,
  target_id text,
  agent_generation_epoch bigint,
  expires_at timestamptz not null,
  state text not null,
  updated_at timestamptz not null default clock_timestamp()
);

-- Deliberately no uniqueness constraint: duplicate calls from reconcile/watchdog
-- must remain observable rather than being hidden by the event sink.
create table destruktion_meta.devos_falsifier_event_g1 (
  event_id bigint generated always as identity primary key,
  workspace_id uuid not null,
  event_type text not null,
  task_id uuid,
  point_id text,
  role text,
  agent_id text,
  lease_generation bigint,
  base_sha text,
  payload jsonb not null,
  idempotency_key text not null,
  created_at timestamptz not null default clock_timestamp()
);

create or replace function destruktion_meta.devos_emit_event_h205f22(
  p_workspace_id uuid,
  p_event_type text,
  p_task_id uuid,
  p_point_id text,
  p_role text,
  p_agent_id text,
  p_lease_generation bigint,
  p_base_sha text,
  p_payload jsonb,
  p_idempotency_key text
)
returns void
language plpgsql
as $$
begin
  insert into destruktion_meta.devos_falsifier_event_g1(
    workspace_id,event_type,task_id,point_id,role,agent_id,
    lease_generation,base_sha,payload,idempotency_key
  ) values (
    p_workspace_id,p_event_type,p_task_id,p_point_id,p_role,p_agent_id,
    p_lease_generation,p_base_sha,p_payload,p_idempotency_key
  );

  -- Keep the task transaction open so the watchdog overlaps it and must
  -- negotiate the same row locks through FOR UPDATE SKIP LOCKED.
  if p_event_type = 'TASK_LEASE_EXPIRED_AMBIGUOUS' then
    perform pg_sleep(0.20);
  end if;
end
$$;
SQL

psqlq -f /tmp/devos_falsifier_prelude.sql
psqlq -f "$MIGRATION"

cat >/tmp/devos_falsifier_seed.sql <<SQL
insert into destruktion_meta.devos_fleet_task_h205f22(
  workspace_id,task_id,point_id,role,lease_agent_id,lease_generation,base_sha,
  lease_tab_id,lease_target_id,lease_agent_generation_epoch,lease_expires_at,
  result_sha256,idempotency_key,state,error_code
) values
  ('$WORKSPACE','10000000-0000-0000-0000-000000000001','p-result-digest','worker','agent-a',7,'6768a43','tab-a','target-a',101,clock_timestamp()-interval '5 minutes','sha256:result-present','task:result-present','RESULT_READY',null),
  ('$WORKSPACE','10000000-0000-0000-0000-000000000002','p-result-missing','worker','agent-b',8,'6768a43','tab-b','target-b',102,clock_timestamp()-interval '4 minutes',null,'task:result-missing','RESULT_READY',null),
  ('$WORKSPACE','10000000-0000-0000-0000-000000000003','p-blocked','worker','agent-c',9,'6768a43','tab-c','target-c',103,clock_timestamp()-interval '3 minutes','sha256:blocked-evidence','task:blocked','BLOCKED',null),
  -- Expired claim but task lease is not due: claim expiry must not synthesize a task expiry/requeue.
  ('$WORKSPACE','10000000-0000-0000-0000-000000000004','p-blocked-claim-only','worker','agent-d',10,'6768a43','tab-d','target-d',104,clock_timestamp()+interval '1 hour','sha256:block-live','task:block-live','BLOCKED',null),
  -- Stale generation claim: expiring generation 19 must not mutate generation 20 task state/evidence.
  ('$WORKSPACE','10000000-0000-0000-0000-000000000005','p-stale-generation','worker','agent-e',20,'6768a43','tab-e','target-e',105,clock_timestamp()+interval '1 hour','sha256:current-generation','task:current-generation','RESULT_READY',null);

insert into destruktion_meta.devos_fleet_claim_h205f22(
  workspace_id,claim_id,task_id,point_id,role,agent_id,lease_generation,base_sha,
  claim_class,tab_id,target_id,agent_generation_epoch,expires_at,state
) values
  ('$WORKSPACE','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','p-result-digest','worker','agent-a',7,'6768a43','EXECUTION','tab-a','target-a',101,clock_timestamp()-interval '5 minutes','ACTIVE'),
  ('$WORKSPACE','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','p-result-missing','worker','agent-b',8,'6768a43','EXECUTION','tab-b','target-b',102,clock_timestamp()-interval '4 minutes','ACTIVE'),
  ('$WORKSPACE','20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','p-blocked','worker','agent-c',9,'6768a43','EXECUTION','tab-c','target-c',103,clock_timestamp()-interval '3 minutes','ACTIVE'),
  ('$WORKSPACE','20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004','p-blocked-claim-only','worker','agent-d',10,'6768a43','EXECUTION','tab-d','target-d',104,clock_timestamp()-interval '2 minutes','ACTIVE'),
  ('$WORKSPACE','20000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000005','p-stale-generation','worker','agent-e',19,'6768a43','EXECUTION','tab-old','target-old',99,clock_timestamp()-interval '1 minute','ACTIVE');
SQL
psqlq -f /tmp/devos_falsifier_seed.sql

# Start direct reconciliation first; its event sink sleep keeps its task locks open.
# The watchdog then sees the same due workspace and races the same recovery surface.
psqlq -Atc "select public.devos_fleet_reconcile_v1('$WORKSPACE');" >/tmp/reconcile_first.json &
reconcile_pid=$!
sleep 0.05
psqlq -Atc "select destruktion_meta.devos_fleet_watchdog_h205f22();" >/tmp/watchdog_first.json &
watchdog_pid=$!
wait "$reconcile_pid"
wait "$watchdog_pid"

# Duplicate pressure after the first race. Neither path may emit a second event or requeue.
psqlq -Atc "select public.devos_fleet_reconcile_v1('$WORKSPACE');" >/tmp/reconcile_second.json &
reconcile2_pid=$!
psqlq -Atc "select destruktion_meta.devos_fleet_watchdog_h205f22();" >/tmp/watchdog_second.json &
watchdog2_pid=$!
wait "$reconcile2_pid"
wait "$watchdog2_pid"

cat >/tmp/devos_falsifier_assert.sql <<'SQL'
do $$
declare
  v_count integer;
begin
  -- Three task leases were truly expired. They must fail-close, never requeue.
  if exists (
    select 1 from destruktion_meta.devos_fleet_task_h205f22
    where task_id in (
      '10000000-0000-0000-0000-000000000001'::uuid,
      '10000000-0000-0000-0000-000000000002'::uuid,
      '10000000-0000-0000-0000-000000000003'::uuid
    ) and state <> 'AMBIGUOUS'
  ) then
    raise exception 'falsified: expired RESULT_READY/BLOCKED task escaped AMBIGUOUS fence';
  end if;

  if exists (select 1 from destruktion_meta.devos_fleet_task_h205f22 where state='AVAILABLE') then
    raise exception 'falsified: automatic requeue produced AVAILABLE work';
  end if;

  if (select result_sha256 from destruktion_meta.devos_fleet_task_h205f22 where task_id='10000000-0000-0000-0000-000000000001') <> 'sha256:result-present' then
    raise exception 'falsified: RESULT_READY digest evidence changed';
  end if;
  if (select result_sha256 is not null from destruktion_meta.devos_fleet_task_h205f22 where task_id='10000000-0000-0000-0000-000000000002') then
    raise exception 'falsified: missing RESULT_READY digest was synthesized';
  end if;
  if (select result_sha256 from destruktion_meta.devos_fleet_task_h205f22 where task_id='10000000-0000-0000-0000-000000000003') <> 'sha256:blocked-evidence' then
    raise exception 'falsified: BLOCKED result evidence changed';
  end if;

  if (select error_code from destruktion_meta.devos_fleet_task_h205f22 where task_id='10000000-0000-0000-0000-000000000001') <> 'LEASE_EXPIRED_RESULT_UNADOPTED' then
    raise exception 'falsified: RESULT_READY reason code incorrect';
  end if;
  if (select error_code from destruktion_meta.devos_fleet_task_h205f22 where task_id='10000000-0000-0000-0000-000000000003') <> 'LEASE_EXPIRED_BLOCKED_UNRESOLVED' then
    raise exception 'falsified: BLOCKED reason code incorrect';
  end if;

  -- Claim-only expiry must close the claim without fabricating task lease expiry.
  if (select state from destruktion_meta.devos_fleet_task_h205f22 where task_id='10000000-0000-0000-0000-000000000004') <> 'BLOCKED' then
    raise exception 'falsified: claim-only expiry mutated non-expired BLOCKED task';
  end if;
  if (select result_sha256 from destruktion_meta.devos_fleet_task_h205f22 where task_id='10000000-0000-0000-0000-000000000004') <> 'sha256:block-live' then
    raise exception 'falsified: claim-only expiry changed BLOCKED evidence';
  end if;

  -- Stale generation 19 claim must not mutate current generation 20 RESULT_READY task.
  if (select lease_generation from destruktion_meta.devos_fleet_task_h205f22 where task_id='10000000-0000-0000-0000-000000000005') <> 20
     or (select state from destruktion_meta.devos_fleet_task_h205f22 where task_id='10000000-0000-0000-0000-000000000005') <> 'RESULT_READY'
     or (select result_sha256 from destruktion_meta.devos_fleet_task_h205f22 where task_id='10000000-0000-0000-0000-000000000005') <> 'sha256:current-generation' then
    raise exception 'falsified: stale claim generation mutated current task generation/evidence';
  end if;

  if exists (select 1 from destruktion_meta.devos_fleet_claim_h205f22 where state <> 'EXPIRED') then
    raise exception 'falsified: expired ACTIVE claim survived reconcile/watchdog race';
  end if;

  select count(*) into v_count
  from destruktion_meta.devos_falsifier_event_g1
  where event_type='TASK_LEASE_EXPIRED_AMBIGUOUS';
  if v_count <> 3 then
    raise exception 'falsified: expected exactly 3 task expiry events, saw %', v_count;
  end if;

  if exists (
    select idempotency_key from destruktion_meta.devos_falsifier_event_g1
    group by idempotency_key having count(*) <> 1
  ) then
    raise exception 'falsified: duplicate expiry event call observed';
  end if;

  if (select payload->>'result_sha256' from destruktion_meta.devos_falsifier_event_g1 where task_id='10000000-0000-0000-0000-000000000001' and event_type='TASK_LEASE_EXPIRED_AMBIGUOUS') <> 'sha256:result-present' then
    raise exception 'falsified: event lost preserved result digest';
  end if;
  if (select payload->'result_sha256' from destruktion_meta.devos_falsifier_event_g1 where task_id='10000000-0000-0000-0000-000000000002' and event_type='TASK_LEASE_EXPIRED_AMBIGUOUS') <> 'null'::jsonb then
    raise exception 'falsified: missing digest event was not explicit JSON null';
  end if;
  if exists (
    select 1 from destruktion_meta.devos_falsifier_event_g1
    where event_type='TASK_LEASE_EXPIRED_AMBIGUOUS'
      and ((payload->>'automatic_retry_allowed')::boolean is distinct from false
        or (payload->>'authority_effect')::boolean is distinct from false)
  ) then
    raise exception 'falsified: expiry event advertised retry or authority effect';
  end if;
end
$$;
SQL
psqlq -f /tmp/devos_falsifier_assert.sql

echo '=== first concurrent reconcile ==='
cat /tmp/reconcile_first.json
echo '=== first concurrent watchdog ==='
cat /tmp/watchdog_first.json
echo '=== duplicate-pressure reconcile ==='
cat /tmp/reconcile_second.json
echo '=== duplicate-pressure watchdog ==='
cat /tmp/watchdog_second.json

echo '=== final task evidence ==='
psqlq -P pager=off -c "select task_id,state,lease_generation,error_code,result_sha256 from destruktion_meta.devos_fleet_task_h205f22 order by task_id;"
echo '=== final claim evidence ==='
psqlq -P pager=off -c "select claim_id,task_id,state,lease_generation from destruktion_meta.devos_fleet_claim_h205f22 order by claim_id;"
echo '=== event evidence ==='
psqlq -P pager=off -c "select event_type,task_id,lease_generation,idempotency_key,payload->'result_sha256' as result_sha256,payload->>'automatic_retry_allowed' as automatic_retry_allowed,payload->>'authority_effect' as authority_effect from destruktion_meta.devos_falsifier_event_g1 order by event_id;"
echo 'RESULT_READY: falsifier g1 did not falsify the tested expiry/reconcile invariant'
