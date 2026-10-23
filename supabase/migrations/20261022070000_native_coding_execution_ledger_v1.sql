-- Execution evidence for a lease already issued by W30. This table does not
-- admit a provider, acquire a lease, schedule work, or grant effect authority.
-- Native coding admission must be bound separately before these functions run.
create table destruktion_meta.native_coding_execution_h205f22 (
  workspace_id uuid not null,
  task_id uuid not null,
  lease_generation bigint not null check (lease_generation > 0),
  reservation_id uuid not null unique,
  agent_id text not null,
  target_id text not null check (target_id ~ '^codex-cli:[0-9a-f-]{36}$'),
  agent_generation_epoch bigint not null check (agent_generation_epoch > 0),
  host_incarnation text not null check (host_incarnation ~ '^pid:[1-9][0-9]*:created_100ns:[1-9][0-9]{16,18}$'),
  scope_sha256 text not null check (scope_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null default 'RESERVED'
    check (state in ('RESERVED','ATTEMPTED','RESULT_READY','FAILED','AMBIGUOUS','CHECKPOINTED')),
  job_proof_sha256 text check (job_proof_sha256 ~ '^[a-f0-9]{64}$'),
  result_sha256 text check (result_sha256 ~ '^[a-f0-9]{64}$'),
  critic_proof_sha256 text check (critic_proof_sha256 ~ '^[a-f0-9]{64}$'),
  checkpoint_sha256 text check (checkpoint_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  automatic_retry_allowed boolean not null default false check (not automatic_retry_allowed),
  authority_effect boolean not null default false check (not authority_effect),
  primary key (task_id,lease_generation),
  foreign key (task_id) references destruktion_meta.devos_fleet_task_h205f22(task_id)
);
alter table destruktion_meta.native_coding_execution_h205f22 enable row level security;
revoke all on destruktion_meta.native_coding_execution_h205f22 from public,anon,authenticated,service_role;

create function destruktion_meta.native_coding_reserve_v1(
  p_workspace uuid,p_task uuid,p_generation bigint,p_agent text,p_target text,
  p_epoch bigint,p_reservation uuid,p_host_incarnation text,p_scope_sha256 text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog,destruktion_meta as $$
declare v_task destruktion_meta.devos_fleet_task_h205f22; v_row destruktion_meta.native_coding_execution_h205f22; v_new boolean;
begin
  -- Lock the same task/claim that W30 owns; never fabricate an execution claim.
  select * into v_task from destruktion_meta.devos_fleet_task_h205f22
    where task_id=p_task and workspace_id=p_workspace for update;
  if not found or v_task.state not in ('LEASED','RUNNING')
     or v_task.lease_generation is distinct from p_generation
     or v_task.lease_agent_id is distinct from p_agent
     or v_task.lease_target_id is distinct from p_target
     or v_task.lease_agent_generation_epoch is distinct from p_epoch
     or v_task.lease_expires_at <= clock_timestamp()
     or v_task.lease_expires_at is null then
    raise exception 'native_coding_lease_not_live' using errcode='55000';
  end if;
  perform 1 from destruktion_meta.devos_fleet_claim_h205f22
    where task_id=p_task and workspace_id=p_workspace and lease_generation=p_generation
      and agent_id=p_agent and target_id=p_target and agent_generation_epoch=p_epoch
      and state='ACTIVE' and expires_at>clock_timestamp() for share;
  if not found then raise exception 'native_coding_claim_not_live' using errcode='55000'; end if;
  insert into destruktion_meta.native_coding_execution_h205f22
    (workspace_id,task_id,lease_generation,reservation_id,agent_id,target_id,
     agent_generation_epoch,host_incarnation,scope_sha256)
    values(p_workspace,p_task,p_generation,p_reservation,p_agent,p_target,p_epoch,p_host_incarnation,p_scope_sha256)
    on conflict(task_id,lease_generation) do nothing returning * into v_row;
  v_new := found;
  if not v_new then select * into strict v_row from destruktion_meta.native_coding_execution_h205f22
    where task_id=p_task and lease_generation=p_generation; end if;
  return jsonb_build_object('inserted',v_new,'execution',to_jsonb(v_row));
end $$;

create function destruktion_meta.native_coding_advance_v1(
  p_task uuid,p_generation bigint,p_reservation uuid,p_scope_sha256 text,
  p_host_incarnation text,p_from text,p_to text,p_evidence_sha256 text,
  p_critic_sha256 text default null,p_checkpoint_sha256 text default null
) returns jsonb language plpgsql security definer
set search_path = pg_catalog,destruktion_meta as $$
declare v_row destruktion_meta.native_coding_execution_h205f22;
begin
  if p_evidence_sha256 is null or p_evidence_sha256 !~ '^[a-f0-9]{64}$'
     or not ((p_from='RESERVED' and p_to in ('ATTEMPTED','AMBIGUOUS'))
       or (p_from='ATTEMPTED' and p_to in ('RESULT_READY','FAILED','AMBIGUOUS'))
       or (p_from='RESULT_READY' and p_to='CHECKPOINTED')) then
    raise exception 'native_coding_transition_invalid' using errcode='23514';
  end if;
  if p_to='CHECKPOINTED' and (p_critic_sha256 is null or p_critic_sha256 !~ '^[a-f0-9]{64}$'
      or p_checkpoint_sha256 is null or p_checkpoint_sha256 !~ '^[a-f0-9]{64}$') then
    raise exception 'native_coding_checkpoint_proof_missing' using errcode='23514';
  end if;
  -- Only launch requires a still-live W30 claim. A late result is evidence,
  -- never permission to resume an expired task or acquire another lease.
  if p_to='ATTEMPTED' then
    perform 1 from destruktion_meta.devos_fleet_task_h205f22 t
      join destruktion_meta.devos_fleet_claim_h205f22 c using(task_id,workspace_id)
      join destruktion_meta.native_coding_execution_h205f22 e on e.task_id=t.task_id
        and e.lease_generation=t.lease_generation and e.workspace_id=t.workspace_id
      where t.task_id=p_task and t.lease_generation=p_generation
        and e.reservation_id=p_reservation and e.scope_sha256=p_scope_sha256
        and e.host_incarnation=p_host_incarnation and e.state=p_from
        and c.lease_generation=p_generation and c.state='ACTIVE'
        and t.state in ('LEASED','RUNNING')
        and t.lease_expires_at>clock_timestamp() and c.expires_at>clock_timestamp()
        and c.agent_id=t.lease_agent_id and c.target_id=t.lease_target_id
        and c.agent_generation_epoch=t.lease_agent_generation_epoch
        and t.lease_agent_id=e.agent_id and t.lease_target_id=e.target_id
        and t.lease_agent_generation_epoch=e.agent_generation_epoch
      for update of t,e for share of c;
    if not found then raise exception 'native_coding_lease_not_live' using errcode='55000'; end if;
  end if;
  update destruktion_meta.native_coding_execution_h205f22 set
    state=p_to,updated_at=clock_timestamp(),
    job_proof_sha256=case when p_to='ATTEMPTED' then p_evidence_sha256 else job_proof_sha256 end,
    result_sha256=case when p_to in ('RESULT_READY','FAILED','AMBIGUOUS') then p_evidence_sha256 else result_sha256 end,
    critic_proof_sha256=case when p_to='CHECKPOINTED' then p_critic_sha256 else critic_proof_sha256 end,
    checkpoint_sha256=case when p_to='CHECKPOINTED' then p_checkpoint_sha256 else checkpoint_sha256 end
    where task_id=p_task and lease_generation=p_generation and reservation_id=p_reservation
      and scope_sha256=p_scope_sha256 and host_incarnation=p_host_incarnation and state=p_from
    returning * into v_row;
  if not found then raise exception 'native_coding_execution_cas_mismatch' using errcode='40001'; end if;
  return to_jsonb(v_row);
end $$;

create function destruktion_meta.native_coding_read_v1(p_workspace uuid,p_task uuid,p_generation bigint)
returns jsonb language sql stable security definer
set search_path = pg_catalog,destruktion_meta as $$
  select to_jsonb(e) from destruktion_meta.native_coding_execution_h205f22 e
    where workspace_id=p_workspace and task_id=p_task and lease_generation=p_generation
$$;
revoke all on function destruktion_meta.native_coding_reserve_v1(uuid,uuid,bigint,text,text,bigint,uuid,text,text) from public,anon,authenticated;
revoke all on function destruktion_meta.native_coding_advance_v1(uuid,bigint,uuid,text,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function destruktion_meta.native_coding_read_v1(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function destruktion_meta.native_coding_reserve_v1(uuid,uuid,bigint,text,text,bigint,uuid,text,text) to service_role;
grant execute on function destruktion_meta.native_coding_advance_v1(uuid,bigint,uuid,text,text,text,text,text,text,text) to service_role;
grant execute on function destruktion_meta.native_coding_read_v1(uuid,uuid,bigint) to service_role;
