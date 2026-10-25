-- Native result acceptance extends the existing project/W30 cycle. This is
-- LOCAL_OPERATOR_QA admission, never release authority or a second scheduler.
-- A checkpoint retains the write fence until a separately verified commit/base
-- rotation is implemented. This migration never enqueues a successor writer.
create table destruktion_meta.native_coding_worktree_fence_h205f22 (
  workspace_id uuid not null, root_identity_sha256 text not null check(root_identity_sha256 ~ '^[a-f0-9]{64}$'),
  project_id uuid not null references destruktion_meta.project_run_h205f22(project_id),
  writer_task_id uuid not null references destruktion_meta.devos_fleet_task_h205f22(task_id),
  writer_lease_generation bigint not null check(writer_lease_generation>0),
  state text not null default 'HELD' check(state in ('HELD','CHECKPOINTED_PENDING_COMMIT')),
  checkpoint_sha256 text check(checkpoint_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  primary key(workspace_id,root_identity_sha256), unique(root_identity_sha256), unique(writer_task_id,writer_lease_generation),
  check((state='HELD' and checkpoint_sha256 is null) or (state='CHECKPOINTED_PENDING_COMMIT' and checkpoint_sha256 is not null))
);
create table destruktion_meta.native_coding_checkpoint_h205f22 (
  checkpoint_id uuid primary key, workspace_id uuid not null,
  project_id uuid not null references destruktion_meta.project_run_h205f22(project_id),
  writer_task_id uuid not null, writer_lease_generation bigint not null,
  critic_task_id uuid not null, critic_lease_generation bigint not null,
  writer_run_id uuid not null, critic_run_id uuid not null,
  writer_receipt_sha256 text not null check(writer_receipt_sha256 ~ '^[a-f0-9]{64}$'),
  critic_receipt_sha256 text not null check(critic_receipt_sha256 ~ '^[a-f0-9]{64}$'),
  result_sha256 text not null check(result_sha256 ~ '^[a-f0-9]{64}$'),
  git_artifact_sha256 text not null check(git_artifact_sha256 ~ '^[a-f0-9]{64}$'),
  source_head text not null check(source_head ~ '^[a-f0-9]{40}$'),
  root_identity_sha256 text not null check(root_identity_sha256 ~ '^[a-f0-9]{64}$'),
  checkpoint jsonb not null, canonical_checkpoint text not null check(octet_length(canonical_checkpoint)<=131072),
  checkpoint_sha256 text not null check(checkpoint_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(writer_task_id,writer_lease_generation) references destruktion_meta.native_coding_execution_h205f22(task_id,lease_generation),
  foreign key(critic_task_id,critic_lease_generation) references destruktion_meta.native_coding_execution_h205f22(task_id,lease_generation),
  unique(writer_task_id,writer_lease_generation), unique(critic_task_id,critic_lease_generation),
  check(writer_task_id<>critic_task_id and writer_run_id<>critic_run_id),
  check(canonical_checkpoint::jsonb=checkpoint and checkpoint_sha256=encode(extensions.digest(convert_to(canonical_checkpoint,'UTF8'),'sha256'),'hex')),
  check(coalesce(checkpoint->>'schema'='metaengine.native-coding.checkpoint.v1' and checkpoint->>'trust_namespace'='LOCAL_OPERATOR_QA'
    and checkpoint->>'checkpoint_id'=checkpoint_id::text and checkpoint->>'workspace_id'=workspace_id::text and checkpoint->>'project_id'=project_id::text
    and checkpoint->>'writer_task_id'=writer_task_id::text and (checkpoint->>'writer_lease_generation')::bigint=writer_lease_generation
    and checkpoint->>'critic_task_id'=critic_task_id::text and (checkpoint->>'critic_lease_generation')::bigint=critic_lease_generation
    and checkpoint->>'writer_run_id'=writer_run_id::text and checkpoint->>'critic_run_id'=critic_run_id::text
    and checkpoint->>'writer_receipt_sha256'=writer_receipt_sha256 and checkpoint->>'critic_receipt_sha256'=critic_receipt_sha256
    and checkpoint->>'result_sha256'=result_sha256 and checkpoint->>'git_artifact_sha256'=git_artifact_sha256
    and checkpoint->>'source_head'=source_head and checkpoint->>'root_identity_sha256'=root_identity_sha256
    and checkpoint->'production_qualified'='false'::jsonb and checkpoint->'automatic_retry_allowed'='false'::jsonb
    and checkpoint->'successor_admitted'='false'::jsonb and checkpoint->'authority_effect'='false'::jsonb,false))
);
alter table destruktion_meta.native_coding_worktree_fence_h205f22 enable row level security;
alter table destruktion_meta.native_coding_checkpoint_h205f22 enable row level security;
revoke all on destruktion_meta.native_coding_worktree_fence_h205f22,destruktion_meta.native_coding_checkpoint_h205f22 from public,anon,authenticated,service_role;

create function destruktion_meta.native_coding_reserve_worktree_v1(p_task uuid,p_generation bigint)
returns void language plpgsql security invoker set search_path=pg_catalog,destruktion_meta as $$
declare t destruktion_meta.devos_fleet_task_h205f22; p destruktion_meta.native_coding_operator_permit_h205f22;
 f destruktion_meta.native_coding_worktree_fence_h205f22; j destruktion_meta.native_coding_job_registration_h205f22;
 writer_permit destruktion_meta.native_coding_operator_permit_h205f22;
 subject jsonb; project uuid; root text;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_coding_state_owner_required' using errcode='42501'; end if;
 select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=p_task and lease_generation=p_generation;
 select * into p from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=(t.task_spec#>>'{native_coding,permit_id}')::uuid and revoked_at is null for share;
 if t.task_id is null or p.permit_id is null or t.workspace_id<>p.workspace_id or t.lease_target_id<>'codex-cli:'||p.provider_id::text
   or t.lease_agent_id<>p.agent_id or t.role<>p.permit->>'role' or t.base_sha<>p.permit#>>'{worktree,base_sha}'
   or t.task_spec#>>'{native_coding,goal_id}' is distinct from p.permit->>'goal_id'
   or t.task_spec#>>'{native_coding,goal_sha256}' is distinct from p.permit->>'goal_sha256'
   or t.task_spec#>>'{native_coding,project_id}' is distinct from p.permit->>'project_id'
 then raise exception 'native_coding_worktree_scope_invalid' using errcode='55000'; end if;
 project:=(p.permit->>'project_id')::uuid;root:=p.permit#>>'{worktree,root_identity_sha256}';
 perform 1 from destruktion_meta.project_run_h205f22 r join destruktion_meta.project_task_h205f22 pt using(project_id)
   where r.project_id=project and pt.task_id=p_task and r.workspace_id=t.workspace_id and r.state='ACTIVE'
     and r.device_id=p.device_id and r.client_id=p.client_id and r.admin_grant_epoch=p.admin_grant_epoch;
 if not found then raise exception 'native_coding_worktree_project_invalid' using errcode='55000'; end if;
 if t.role='IMPLEMENTER' then
   insert into destruktion_meta.native_coding_worktree_fence_h205f22(workspace_id,root_identity_sha256,project_id,writer_task_id,writer_lease_generation)
     values(t.workspace_id,root,project,p_task,p_generation) on conflict do nothing;
   select * into f from destruktion_meta.native_coding_worktree_fence_h205f22 where root_identity_sha256=root for update;
   if f.state is distinct from 'HELD' or f.workspace_id is distinct from t.workspace_id or f.project_id is distinct from project or f.writer_task_id is distinct from p_task or f.writer_lease_generation is distinct from p_generation
   then raise exception 'native_coding_worktree_write_fenced' using errcode='55000'; end if;
 elsif t.role='CRITIC' then
   subject:=t.task_spec#>'{native_coding,verification_subject}';
   select * into f from destruktion_meta.native_coding_worktree_fence_h205f22 where workspace_id=t.workspace_id and root_identity_sha256=root for share;
   select * into j from destruktion_meta.native_coding_job_registration_h205f22 where task_id=f.writer_task_id and lease_generation=f.writer_lease_generation;
   select * into writer_permit from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=j.permit_id;
   if f.state is distinct from 'HELD' or f.project_id is distinct from project or j.result_receipt is null
     or not destruktion_meta.native_coding_project_result_bound_v1(f.writer_task_id)
     or writer_permit.workspace_id is distinct from p.workspace_id or writer_permit.device_id is distinct from p.device_id
     or writer_permit.client_id is distinct from p.client_id or writer_permit.admin_grant_epoch is distinct from p.admin_grant_epoch
     or writer_permit.permit->>'goal_id' is distinct from p.permit->>'goal_id' or writer_permit.permit->>'goal_sha256' is distinct from p.permit->>'goal_sha256'
     or writer_permit.permit->>'owner_epoch' is distinct from p.permit->>'owner_epoch' or writer_permit.permit->'artifact' is distinct from p.permit->'artifact'
     or j.run_id::text is distinct from subject->>'run_id' or j.result_receipt->>'result_sha256' is distinct from subject->>'result_sha256'
     or j.result_receipt#>>'{git_after,artifact_sha256}' is distinct from subject->>'git_artifact_sha256'
     or j.result_receipt#>>'{git_after,head}' is distinct from subject->>'source_head'
     or j.result_receipt#>>'{result,outcome}' is distinct from 'DONE' or j.result_receipt->>'role' is distinct from 'IMPLEMENTER'
     or j.result_receipt->>'agent_id'=t.lease_agent_id or t.base_sha is distinct from subject->>'source_head'
   then raise exception 'native_coding_critic_worktree_subject_fenced' using errcode='55000'; end if;
 else raise exception 'native_coding_worktree_role_invalid' using errcode='55000'; end if;
end $$;
create function destruktion_meta.native_coding_execution_worktree_fence_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $$
begin
 -- BEFORE reserve COMMIT / before any suspended process is created or resumed.
 perform destruktion_meta.native_coding_reserve_worktree_v1(new.task_id,new.lease_generation);return new;
end $$;
create trigger native_coding_execution_worktree_fence_trg after insert on destruktion_meta.native_coding_execution_h205f22
 for each row execute function destruktion_meta.native_coding_execution_worktree_fence_v1();

create function destruktion_meta.native_coding_project_result_bound_v1(p_task uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,destruktion_meta,extensions as $$
 select exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 t
 join destruktion_meta.native_coding_job_registration_h205f22 j on j.task_id=t.task_id and j.lease_generation=t.lease_generation
 join destruktion_meta.native_coding_execution_h205f22 e on e.task_id=t.task_id and e.lease_generation=t.lease_generation
 join destruktion_meta.native_coding_operator_permit_h205f22 p on p.permit_id=j.permit_id
 join destruktion_meta.project_task_h205f22 pt on pt.task_id=t.task_id
 where t.task_id=p_task and t.state in ('RESULT_READY','COMPLETED') and e.state in ('RESULT_READY','CHECKPOINTED')
 and t.workspace_id=p.workspace_id and e.workspace_id=t.workspace_id and pt.project_id=(p.permit->>'project_id')::uuid
 and e.agent_id=t.lease_agent_id and e.target_id=t.lease_target_id and e.agent_generation_epoch=t.lease_agent_generation_epoch
 and j.result_receipt is not null and j.result_receipt->>'state'='RESULT_READY'
 and t.result_summary->>'schema'='metaengine.native-coding.result-summary.v1'
 and t.result_summary_sha256=encode(extensions.digest(convert_to(t.result_summary::text,'UTF8'),'sha256'),'hex') and t.result_sha256=t.result_summary_sha256
 and t.result_summary->>'run_id'=j.run_id::text and t.result_summary->>'receipt_sha256'=j.result_receipt_sha256
 and t.result_summary->>'result_sha256'=e.result_sha256 and e.result_sha256=j.result_receipt->>'result_sha256'
 and t.result_summary->>'git_artifact_sha256'=j.result_receipt#>>'{git_after,artifact_sha256}'
 and t.result_summary->>'source_head'=j.result_receipt#>>'{git_after,head}'
 and j.result_receipt->>'role'=t.role and j.result_receipt->>'agent_id'=t.lease_agent_id
 and j.job_envelope#>>'{payload,agent_id}'=t.lease_agent_id and j.job_envelope#>>'{payload,role}'=t.role
 and j.job_envelope#>>'{payload,host_process,process_incarnation_id}'=e.host_incarnation
 and t.task_spec#>>'{native_coding,permit_id}'=p.permit_id::text
 and exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 c where c.task_id=t.task_id and c.lease_generation=t.lease_generation
   and c.workspace_id=t.workspace_id and c.agent_id=t.lease_agent_id and c.target_id=t.lease_target_id and c.state='CLOSED'))
$$;

-- Four selectors only. The private Host must independently verify the complete
-- pair and current native filesystem before recording any checkpoint.
create function destruktion_meta.native_coding_checkpoint_candidate_v1(p_project uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,destruktion_meta as $$
 select jsonb_build_object('writer_task_id',w.task_id,'writer_lease_generation',w.lease_generation,
   'critic_task_id',c.task_id,'critic_lease_generation',c.lease_generation)
 from destruktion_meta.project_run_h205f22 r
 join destruktion_meta.project_task_h205f22 wp on wp.project_id=r.project_id
 join destruktion_meta.devos_fleet_task_h205f22 w on w.task_id=wp.task_id
 join destruktion_meta.native_coding_job_registration_h205f22 wj on wj.task_id=w.task_id and wj.lease_generation=w.lease_generation
 join destruktion_meta.native_coding_worktree_fence_h205f22 f on f.writer_task_id=w.task_id and f.writer_lease_generation=w.lease_generation and f.state='HELD'
 join destruktion_meta.project_task_h205f22 cp on cp.project_id=r.project_id and cp.parent_task_id=w.task_id
 join destruktion_meta.devos_fleet_task_h205f22 c on c.task_id=cp.task_id
 join destruktion_meta.native_coding_job_registration_h205f22 cj on cj.task_id=c.task_id and cj.lease_generation=c.lease_generation
 where r.project_id=p_project and r.state='ACTIVE' and w.role='IMPLEMENTER' and c.role='CRITIC'
 and w.state='RESULT_READY' and c.state='RESULT_READY'
 and destruktion_meta.native_coding_project_result_bound_v1(w.task_id) and destruktion_meta.native_coding_project_result_bound_v1(c.task_id)
 and wj.result_receipt#>>'{result,outcome}'='DONE' and cj.result_receipt#>>'{result,outcome}'='DONE' and cj.result_receipt#>>'{result,verdict}'='ACCEPT'
 and cj.result_receipt->>'agent_id'<>wj.result_receipt->>'agent_id'
 and cj.job_envelope#>>'{payload,worker_process,process_incarnation_id}'<>wj.job_envelope#>>'{payload,worker_process,process_incarnation_id}'
 and c.task_spec#>'{native_coding,verification_subject}'=jsonb_build_object('run_id',wj.run_id,'result_sha256',wj.result_receipt->>'result_sha256',
   'git_artifact_sha256',wj.result_receipt#>>'{git_after,artifact_sha256}','source_head',wj.result_receipt#>>'{git_after,head}')
 and cj.result_receipt->>'subject_run_id'=wj.run_id::text and cj.result_receipt->>'subject_result_sha256'=wj.result_receipt->>'result_sha256'
 and cj.result_receipt#>>'{result,subject_result_sha256}'=wj.result_receipt->>'result_sha256'
 and cj.result_receipt->>'subject_git_artifact_sha256'=wj.result_receipt#>>'{git_after,artifact_sha256}'
 and cj.result_receipt->>'subject_source_head'=wj.result_receipt#>>'{git_after,head}'
 and cj.result_receipt#>'{git_before}'->>'artifact_sha256'=wj.result_receipt#>>'{git_after,artifact_sha256}'
 and cj.result_receipt#>'{git_after}'->>'artifact_sha256'=wj.result_receipt#>>'{git_after,artifact_sha256}'
 and cj.result_receipt#>>'{git_before,head}'=wj.result_receipt#>>'{git_after,head}' and cj.result_receipt#>>'{git_after,head}'=wj.result_receipt#>>'{git_after,head}'
 and not exists(select 1 from destruktion_meta.native_coding_checkpoint_h205f22 k where k.writer_task_id=w.task_id and k.writer_lease_generation=w.lease_generation)
 order by wp.task_seq,w.task_id,c.task_id limit 1
$$;

create function destruktion_meta.native_coding_project_reconcile_writer_v1(p_task uuid,p_client text)
returns integer language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta as $$
declare t destruktion_meta.devos_fleet_task_h205f22; j destruktion_meta.native_coding_job_registration_h205f22;
 p destruktion_meta.native_coding_operator_permit_h205f22; critic destruktion_meta.native_coding_operator_permit_h205f22;
 r destruktion_meta.project_run_h205f22; x destruktion_meta.project_task_h205f22; spec jsonb; subject jsonb; enqueued jsonb; child uuid;
begin
 select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=p_task;
 if t.role is distinct from 'IMPLEMENTER' or not destruktion_meta.native_coding_project_result_bound_v1(p_task) then return 0; end if;
 select * into j from destruktion_meta.native_coding_job_registration_h205f22 where task_id=p_task and lease_generation=t.lease_generation;
 if j.result_receipt#>>'{result,outcome}' is distinct from 'DONE' then return 0; end if;
 select * into p from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=j.permit_id;
 select * into x from destruktion_meta.project_task_h205f22 where task_id=p_task;
 select * into r from destruktion_meta.project_run_h205f22 where project_id=x.project_id and state='ACTIVE';
 if r.project_id is null or exists(select 1 from destruktion_meta.native_coding_checkpoint_h205f22 where writer_task_id=p_task and writer_lease_generation=t.lease_generation) then return 0; end if;
 perform 1 from destruktion_meta.native_coding_worktree_fence_h205f22 where writer_task_id=p_task and writer_lease_generation=t.lease_generation and state='HELD';
 if not found then return 0; end if;
 subject:=jsonb_build_object('run_id',j.run_id,'result_sha256',j.result_receipt->>'result_sha256',
   'git_artifact_sha256',j.result_receipt#>>'{git_after,artifact_sha256}','source_head',j.result_receipt#>>'{git_after,head}');
 if exists(select 1 from destruktion_meta.project_task_h205f22 cp join destruktion_meta.devos_fleet_task_h205f22 c using(task_id)
   where cp.project_id=r.project_id and cp.parent_task_id=p_task and c.role='CRITIC' and c.task_spec#>'{native_coding,verification_subject}'=subject) then return 0; end if;
 select * into critic from destruktion_meta.native_coding_operator_permit_h205f22 c where c.workspace_id=t.workspace_id and c.revoked_at is null
   and c.client_id=p.client_id and c.device_id=p.device_id and c.admin_grant_epoch=p.admin_grant_epoch and c.agent_id<>p.agent_id
   and c.permit->>'role'='CRITIC' and c.permit->>'project_id'=r.project_id::text
   and c.permit->>'goal_id'=p.permit->>'goal_id' and c.permit->>'goal_sha256'=p.permit->>'goal_sha256' and c.permit->>'owner_epoch'=p.permit->>'owner_epoch'
   and c.permit->>'user_sid'=p.permit->>'user_sid' and c.permit->'artifact'=p.permit->'artifact' and c.permit->'postgres'=p.permit->'postgres'
   and c.permit#>>'{worktree,path}'=p.permit#>>'{worktree,path}' and c.permit#>>'{worktree,root_identity_sha256}'=p.permit#>>'{worktree,root_identity_sha256}'
   and c.permit#>>'{worktree,base_sha}'=j.result_receipt#>>'{git_after,head}' and (c.permit->>'expires_at')::timestamptz>clock_timestamp()
   order by c.permit_id limit 1 for share;
 if critic.permit_id is null then return 0; end if;
 spec:=jsonb_build_object('schema','metaengine.devos.project-task-spec.v1','claim_class','READ_ONLY',
   'objective','Independently review the exact native coding artifact for task '||p_task||': '||left(t.task_spec->>'objective',3500),
   'constraints',coalesce(t.task_spec->'constraints','[]'::jsonb),
   'native_coding',jsonb_build_object('permit_id',critic.permit_id,'goal_id',critic.permit->>'goal_id','goal_sha256',critic.permit->>'goal_sha256','project_id',r.project_id,'verification_subject',subject),
   'project_continuity',jsonb_build_object('schema','metaengine.devos.project-task.v1','project_id',r.project_id,'root_task_id',r.root_task_id,'parent_task_id',p_task,'depth',x.depth+1,'root_request_id',r.request_id),
   'automatic_retry_allowed',false,'model_output_authority',false,'scheduler_authority',false,'authority_effect',false);
 enqueued:=public.devos_fleet_enqueue_v1(t.workspace_id,'native.verify.'||replace(p_task::text,'-',''),'CRITIC',subject->>'source_head',spec,
   'native-verify:'||p_task||':'||t.lease_generation||':'||(subject->>'result_sha256'),null,100);
 if (enqueued->>'accepted')::boolean is distinct from true then raise exception 'native_coding_critic_enqueue_rejected'; end if;
 child:=(enqueued->>'task_id')::uuid;
 update destruktion_meta.project_run_h205f22 set total_tasks=total_tasks+1 where project_id=r.project_id returning * into r;
 insert into destruktion_meta.project_task_h205f22 values(child,r.project_id,r.total_tasks,r.root_task_id,p_task,x.depth+1);
 perform destruktion_meta.project_append_h205f22(r.project_id,'NATIVE_CRITIC_TASK_ADMITTED',child,0,p_client,null,null,null,
   jsonb_build_object('writer_task_id',p_task,'writer_lease_generation',t.lease_generation,'verification_subject',subject),
   'DATABASE_ADMISSION',null,false,'native-critic:'||p_task||':'||t.lease_generation);
 return 1;
end $$;

create function destruktion_meta.native_coding_project_completion_ready_v1(p_task uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,destruktion_meta as $$
declare k destruktion_meta.native_coding_checkpoint_h205f22;
 w destruktion_meta.devos_fleet_task_h205f22; c destruktion_meta.devos_fleet_task_h205f22;
 we destruktion_meta.native_coding_execution_h205f22; ce destruktion_meta.native_coding_execution_h205f22;
 wj destruktion_meta.native_coding_job_registration_h205f22; cj destruktion_meta.native_coding_job_registration_h205f22;
 wp destruktion_meta.native_coding_operator_permit_h205f22; cp destruktion_meta.native_coding_operator_permit_h205f22;
 wpt destruktion_meta.project_task_h205f22; cpt destruktion_meta.project_task_h205f22;
begin
 -- Fixed primary/unique-key reads keep planning bounded. A many-way join here
 -- spent seconds in planning for every completion guard under the real PG17.
 select * into k from destruktion_meta.native_coding_checkpoint_h205f22 where writer_task_id=p_task or critic_task_id=p_task;
 if not found then return false; end if;
 select * into w from destruktion_meta.devos_fleet_task_h205f22 where task_id=k.writer_task_id and lease_generation=k.writer_lease_generation;
 select * into c from destruktion_meta.devos_fleet_task_h205f22 where task_id=k.critic_task_id and lease_generation=k.critic_lease_generation;
 select * into we from destruktion_meta.native_coding_execution_h205f22 where task_id=k.writer_task_id and lease_generation=k.writer_lease_generation;
 select * into ce from destruktion_meta.native_coding_execution_h205f22 where task_id=k.critic_task_id and lease_generation=k.critic_lease_generation;
 select * into wj from destruktion_meta.native_coding_job_registration_h205f22 where task_id=k.writer_task_id and lease_generation=k.writer_lease_generation;
 select * into cj from destruktion_meta.native_coding_job_registration_h205f22 where task_id=k.critic_task_id and lease_generation=k.critic_lease_generation;
 select * into wp from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=wj.permit_id;
 select * into cp from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=cj.permit_id;
 select * into wpt from destruktion_meta.project_task_h205f22 where task_id=k.writer_task_id;
 select * into cpt from destruktion_meta.project_task_h205f22 where task_id=k.critic_task_id;
 return coalesce(w.role='IMPLEMENTER' and c.role='CRITIC' and wpt.project_id=k.project_id and cpt.project_id=k.project_id and cpt.parent_task_id=w.task_id
 and p_task in (w.task_id,c.task_id) and we.state='CHECKPOINTED' and ce.state='CHECKPOINTED'
 and w.workspace_id=k.workspace_id and c.workspace_id=k.workspace_id
 and wp.workspace_id=k.workspace_id and cp.workspace_id=k.workspace_id
 and wp.device_id=cp.device_id and wp.client_id=cp.client_id and wp.admin_grant_epoch=cp.admin_grant_epoch
 and wp.permit->>'goal_id'=cp.permit->>'goal_id' and wp.permit->>'goal_sha256'=cp.permit->>'goal_sha256'
 and wp.permit->>'owner_epoch'=cp.permit->>'owner_epoch'
 and wp.permit->>'project_id'=k.project_id::text and cp.permit->>'project_id'=k.project_id::text
 and wp.permit->'artifact'=cp.permit->'artifact' and wp.permit->'postgres'=cp.permit->'postgres'
 and wp.permit#>>'{worktree,path}'=cp.permit#>>'{worktree,path}'
 and wp.permit#>>'{worktree,root_identity_sha256}'=k.root_identity_sha256 and cp.permit#>>'{worktree,root_identity_sha256}'=k.root_identity_sha256
 and cp.permit#>>'{worktree,base_sha}'=k.source_head
 and k.checkpoint->>'goal_id'=wp.permit->>'goal_id' and k.checkpoint->>'goal_sha256'=wp.permit->>'goal_sha256'
 and k.checkpoint->>'owner_epoch'=wp.permit->>'owner_epoch' and k.checkpoint->'artifact'=wp.permit->'artifact'
 and k.checkpoint#>>'{postgres,system_identifier}'=wp.permit#>>'{postgres,system_identifier}'
 and k.checkpoint#>>'{postgres,data_directory_identity_sha256}'=wp.permit#>>'{postgres,data_directory_identity_sha256}'
 and k.checkpoint#>>'{worktree,path}'=wp.permit#>>'{worktree,path}'
 and k.checkpoint#>>'{worktree,root_identity_sha256}'=k.root_identity_sha256 and k.checkpoint#>>'{worktree,base_sha}'=k.source_head
 and we.checkpoint_sha256=k.checkpoint_sha256 and ce.checkpoint_sha256=k.checkpoint_sha256
 and we.critic_proof_sha256=k.critic_receipt_sha256 and ce.critic_proof_sha256=k.critic_receipt_sha256
 and wj.run_id=k.writer_run_id and cj.run_id=k.critic_run_id
 and wj.result_receipt_sha256=k.writer_receipt_sha256 and cj.result_receipt_sha256=k.critic_receipt_sha256
 and wj.result_receipt->>'result_sha256'=k.result_sha256 and wj.result_receipt#>>'{git_after,artifact_sha256}'=k.git_artifact_sha256
 and wj.result_receipt#>>'{git_after,head}'=k.source_head and wj.result_receipt#>>'{result,outcome}'='DONE'
 and cj.result_receipt#>>'{result,outcome}'='DONE' and cj.result_receipt#>>'{result,verdict}'='ACCEPT'
 and cj.result_receipt->>'subject_run_id'=wj.run_id::text and cj.result_receipt->>'subject_result_sha256'=k.result_sha256
 and cj.result_receipt#>>'{result,subject_result_sha256}'=k.result_sha256
 and cj.result_receipt->>'subject_git_artifact_sha256'=k.git_artifact_sha256 and cj.result_receipt->>'subject_source_head'=k.source_head
 and c.task_spec#>'{native_coding,verification_subject}'=jsonb_build_object('run_id',k.writer_run_id,'result_sha256',k.result_sha256,
   'git_artifact_sha256',k.git_artifact_sha256,'source_head',k.source_head)
 and cj.result_receipt#>>'{git_after,artifact_sha256}'=k.git_artifact_sha256 and cj.result_receipt#>>'{git_before,artifact_sha256}'=k.git_artifact_sha256
 and cj.result_receipt#>>'{git_before,head}'=k.source_head and cj.result_receipt#>>'{git_after,head}'=k.source_head
 and c.lease_agent_id<>w.lease_agent_id and cj.job_envelope#>>'{payload,worker_process,process_incarnation_id}'<>wj.job_envelope#>>'{payload,worker_process,process_incarnation_id}'
 and destruktion_meta.native_coding_project_result_bound_v1(w.task_id) and destruktion_meta.native_coding_project_result_bound_v1(c.task_id)
 and (p_task=c.task_id or c.state='COMPLETED')
 and not exists(with recursive descendants as (select task_id from destruktion_meta.project_task_h205f22 where parent_task_id=p_task
   union all select x.task_id from destruktion_meta.project_task_h205f22 x join descendants d on x.parent_task_id=d.task_id)
   select 1 from descendants d join destruktion_meta.devos_fleet_task_h205f22 t using(task_id) where t.state<>'COMPLETED')
 and not exists(select 1 from destruktion_meta.project_child_proposal_h205f22 p where p.project_id=k.project_id and p.parent_task_id=p_task and p.child_task_id is null),false);
end $$;

create function destruktion_meta.native_coding_finalize_checkpoint_v1(p_checkpoint uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,destruktion_meta as $$
declare k destruktion_meta.native_coding_checkpoint_h205f22; candidate jsonb; writer jsonb; critic jsonb;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_coding_state_owner_required' using errcode='42501'; end if;
 if current_setting('transaction_isolation')<>'serializable' or current_setting('synchronous_commit')<>'on'
 then raise exception 'native_coding_checkpoint_durability_required' using errcode='55000'; end if;
 select * into k from destruktion_meta.native_coding_checkpoint_h205f22 where checkpoint_id=p_checkpoint for update;
 if k.checkpoint_id is null then raise exception 'native_coding_checkpoint_missing' using errcode='55000'; end if;
 -- Match the existing reconcile task -> project lock order before completing
 -- the CRITIC first. Statement/transaction loss never authorizes a retry.
 perform task_id from destruktion_meta.devos_fleet_task_h205f22 where task_id in(k.writer_task_id,k.critic_task_id) order by task_id for update;
 perform 1 from destruktion_meta.project_run_h205f22 where project_id=k.project_id and workspace_id=k.workspace_id and state='ACTIVE' for update;
 if not found then raise exception 'native_coding_checkpoint_project_fenced' using errcode='55000'; end if;
 if not destruktion_meta.native_coding_project_completion_ready_v1(k.critic_task_id) then raise exception 'native_coding_checkpoint_pair_unverified' using errcode='55000'; end if;
 select result_receipt into writer from destruktion_meta.native_coding_job_registration_h205f22 where task_id=k.writer_task_id and lease_generation=k.writer_lease_generation;
 select result_receipt into critic from destruktion_meta.native_coding_job_registration_h205f22 where task_id=k.critic_task_id and lease_generation=k.critic_lease_generation;
 if k.checkpoint->>'schema' is distinct from 'metaengine.native-coding.checkpoint.v1'
   or k.checkpoint->>'checkpoint_id' is distinct from k.checkpoint_id::text or k.checkpoint->>'project_id' is distinct from k.project_id::text
   or k.checkpoint->>'workspace_id' is distinct from k.workspace_id::text
   or k.checkpoint->>'writer_task_id' is distinct from k.writer_task_id::text or (k.checkpoint->>'writer_lease_generation')::bigint is distinct from k.writer_lease_generation
   or k.checkpoint->>'critic_task_id' is distinct from k.critic_task_id::text or (k.checkpoint->>'critic_lease_generation')::bigint is distinct from k.critic_lease_generation
   or k.checkpoint->>'writer_run_id' is distinct from k.writer_run_id::text or k.checkpoint->>'critic_run_id' is distinct from k.critic_run_id::text
   or k.checkpoint->>'writer_receipt_sha256' is distinct from k.writer_receipt_sha256 or k.checkpoint->>'critic_receipt_sha256' is distinct from k.critic_receipt_sha256
   or k.checkpoint->>'result_sha256' is distinct from k.result_sha256 or k.checkpoint->>'git_artifact_sha256' is distinct from k.git_artifact_sha256
   or k.checkpoint->>'source_head' is distinct from k.source_head or k.checkpoint->>'root_identity_sha256' is distinct from k.root_identity_sha256
   or k.checkpoint->'production_qualified' is distinct from 'false'::jsonb or k.checkpoint->'authority_effect' is distinct from 'false'::jsonb
   or k.checkpoint->'automatic_retry_allowed' is distinct from 'false'::jsonb
 then raise exception 'native_coding_checkpoint_record_mismatch' using errcode='55000'; end if;
 update destruktion_meta.devos_fleet_task_h205f22 set state='COMPLETED',finished_at=clock_timestamp(),updated_at=clock_timestamp() where task_id=k.critic_task_id and state='RESULT_READY';
 if not destruktion_meta.native_coding_project_completion_ready_v1(k.writer_task_id) then raise exception 'native_coding_checkpoint_writer_unverified' using errcode='55000'; end if;
 update destruktion_meta.devos_fleet_task_h205f22 set state='COMPLETED',finished_at=clock_timestamp(),updated_at=clock_timestamp() where task_id=k.writer_task_id and state='RESULT_READY';
 update destruktion_meta.native_coding_worktree_fence_h205f22 set state='CHECKPOINTED_PENDING_COMMIT',checkpoint_sha256=k.checkpoint_sha256,updated_at=clock_timestamp()
   where workspace_id=k.workspace_id and root_identity_sha256=k.root_identity_sha256 and project_id=k.project_id
     and writer_task_id=k.writer_task_id and writer_lease_generation=k.writer_lease_generation and state='HELD';
 if not found then raise exception 'native_coding_checkpoint_fence_mismatch' using errcode='55000'; end if;
 perform destruktion_meta.project_append_h205f22(k.project_id,'NATIVE_CODING_CHECKPOINT_COMMITTED',k.writer_task_id,k.writer_lease_generation,'PRIVATE_RUNTIME_HOST',null,null,null,
   jsonb_build_object('checkpoint_id',k.checkpoint_id,'checkpoint_sha256',k.checkpoint_sha256,'critic_task_id',k.critic_task_id,'commit_base_rotation_required',true),
   'PROTECTED_NATIVE_CHECKPOINT',null,false,'native-checkpoint:'||k.checkpoint_id);
 return jsonb_build_object('state','CHECKPOINTED_PENDING_COMMIT','checkpoint_id',k.checkpoint_id,'checkpoint_sha256',k.checkpoint_sha256,
   'writer_task_id',k.writer_task_id,'writer_lease_generation',k.writer_lease_generation,'critic_task_id',k.critic_task_id,'critic_lease_generation',k.critic_lease_generation,
   'successor_admitted',false,'production_qualified',false,'automatic_retry_allowed',false,'authority_effect',false);
end $$;

revoke all on function destruktion_meta.native_coding_reserve_worktree_v1(uuid,bigint),destruktion_meta.native_coding_execution_worktree_fence_v1(),
 destruktion_meta.native_coding_project_result_bound_v1(uuid),destruktion_meta.native_coding_checkpoint_candidate_v1(uuid),
 destruktion_meta.native_coding_project_reconcile_writer_v1(uuid,text),destruktion_meta.native_coding_project_completion_ready_v1(uuid),
 destruktion_meta.native_coding_finalize_checkpoint_v1(uuid) from public,anon,authenticated,service_role;

-- Preserve the existing browser verification contract verbatim below the typed branch.
create or replace function destruktion_meta.project_completion_ready_h205f22(p_task uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,destruktion_meta,pg_temp as $$
declare t destruktion_meta.devos_fleet_task_h205f22%rowtype; subject destruktion_meta.devos_fleet_task_h205f22%rowtype; project uuid; required text; roles text[];
begin
 if exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 n where n.task_id=p_task and n.task_spec ? 'native_coding') then
   return destruktion_meta.native_coding_project_completion_ready_v1(p_task);
 end if;
 select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=p_task;
 select project_id into project from destruktion_meta.project_task_h205f22 where task_id=p_task;
 if not found then return false; end if;
 if exists(with recursive descendants as (select task_id from destruktion_meta.project_task_h205f22 where project_id=project and parent_task_id=p_task union all select x.task_id from destruktion_meta.project_task_h205f22 x join descendants d on x.parent_task_id=d.task_id where x.project_id=project) select 1 from descendants d join destruktion_meta.devos_fleet_task_h205f22 z using(task_id) where z.state<>'COMPLETED')
   or exists(with recursive lineage as (select p_task as task_id union all select x.task_id from destruktion_meta.project_task_h205f22 x join lineage d on x.parent_task_id=d.task_id where x.project_id=project) select 1 from destruktion_meta.project_child_proposal_h205f22 p join lineage d on d.task_id=p.parent_task_id where p.project_id=project and p.child_task_id is null)
 then return false; end if;
 if jsonb_typeof(t.task_spec->'verification_subject')='object' then
   select * into subject from destruktion_meta.devos_fleet_task_h205f22 where task_id=(t.task_spec->'verification_subject'->>'task_id')::uuid;
   return coalesce(t.role in ('CRITIC','FALSIFIER') and destruktion_meta.project_result_bound_h205f22(p_task,'ACCEPT')
     and subject.workspace_id=t.workspace_id and subject.lease_agent_id is distinct from t.lease_agent_id
     and t.task_spec->'verification_subject'->>'result_sha256'=subject.result_summary->>'result_claim_sha256'
     and t.result_summary->>'result_claim_subject_task_id'=subject.task_id::text
     and t.result_summary->>'result_claim_subject_result_sha256'=subject.result_summary->>'result_claim_sha256',false);
 end if;
 if not destruktion_meta.project_result_bound_h205f22(p_task,'READY') then return false; end if;
 roles:=case when upper(coalesce(t.task_spec->>'risk',t.task_spec#>>'{meta_orchestrator,risk}','NORMAL'))='CRITICAL' then array['CRITIC','FALSIFIER'] else array['CRITIC'] end;
 foreach required in array roles loop
   if not exists(select 1 from destruktion_meta.project_task_h205f22 x join destruktion_meta.devos_fleet_task_h205f22 v using(task_id) where x.project_id=project and x.parent_task_id=p_task and v.role=required and v.state='COMPLETED'
     and v.lease_agent_id is distinct from t.lease_agent_id and v.task_spec->'verification_subject'->>'task_id'=t.task_id::text
     and v.task_spec->'verification_subject'->>'result_sha256'=t.result_summary->>'result_claim_sha256' and destruktion_meta.project_result_bound_h205f22(v.task_id,'ACCEPT')) then return false; end if;
 end loop;
 return true;
end $$;

create or replace function public.h205f22_project_reconcile_v1(p_workspace_id uuid,p_project_id uuid,p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta,pg_temp as $$
declare r destruktion_meta.project_run_h205f22%rowtype; t destruktion_meta.devos_fleet_task_h205f22%rowtype; x destruktion_meta.project_task_h205f22%rowtype;
 required text; roles text[]; spec jsonb; enqueued jsonb; child uuid; promoted integer:=0; admitted integer:=0; target uuid; outcomes jsonb:='[]';
begin
 if p_project_id is null then
   perform destruktion_meta.project_device_grant_h205f22(p_device_id,p_client_id,p_admin_grant_epoch);
   for target in select run.project_id from destruktion_meta.project_run_h205f22 run where run.workspace_id=p_workspace_id and run.device_id=p_device_id and run.client_id=p_client_id and run.admin_grant_epoch=p_admin_grant_epoch and run.state='ACTIVE'
     and exists(select 1 from destruktion_meta.project_task_h205f22 link join destruktion_meta.devos_fleet_task_h205f22 task using(task_id) where link.project_id=run.project_id and task.state='RESULT_READY')
     order by run.last_reconciled_at nulls first,run.created_at,run.project_id limit 4 loop
     outcomes:=outcomes||jsonb_build_array(public.h205f22_project_reconcile_v1(p_workspace_id,target,p_device_id,p_client_id,p_admin_grant_epoch));
   end loop;
   return jsonb_build_object('schema','metaengine.devos.project-reconcile.v1','project_id',null,'projects',outcomes,'bounded_projects',4,'automatic_retry_allowed',false,'scheduler_authority',false,'authority_effect',false);
 end if;
 r:=destruktion_meta.project_authorize_h205f22(p_workspace_id,p_project_id,p_device_id,p_client_id,p_admin_grant_epoch);
 -- Task -> project is the same lock order as DevOS updates/triggers/spawn.
 -- Lock existing rows before the project lock, so no later row acquisition can
 -- deadlock a concurrent completion holding its task and awaiting this project.
 perform task.task_id from destruktion_meta.devos_fleet_task_h205f22 task join destruktion_meta.project_task_h205f22 link using(task_id) where link.project_id=p_project_id order by task.task_id for update of task;
 select * into r from destruktion_meta.project_run_h205f22 where project_id=p_project_id for update;
 update destruktion_meta.project_run_h205f22 set last_reconciled_at=clock_timestamp() where project_id=p_project_id;
 for t in select task.* from destruktion_meta.devos_fleet_task_h205f22 task join destruktion_meta.project_task_h205f22 link using(task_id) where link.project_id=p_project_id and task.state='RESULT_READY' order by link.depth desc,link.task_seq limit 8 loop
   if t.task_spec ? 'native_coding' then
     -- Native acceptance is committed only by the private Host verifier. This
     -- public stage can admit a CRITIC; it cannot write a checkpoint or advance it.
     admitted:=admitted+destruktion_meta.native_coding_project_reconcile_writer_v1(t.task_id,p_client_id);
     continue;
   end if;
   if destruktion_meta.project_completion_ready_h205f22(t.task_id) then
     update destruktion_meta.devos_fleet_task_h205f22 set state='COMPLETED',finished_at=clock_timestamp(),updated_at=clock_timestamp() where task_id=t.task_id; promoted:=promoted+1; continue;
   end if;
   if t.task_spec ? 'verification_subject' or not destruktion_meta.project_result_bound_h205f22(t.task_id,'READY') then continue; end if;
   select * into x from destruktion_meta.project_task_h205f22 where task_id=t.task_id;
   roles:=case when upper(coalesce(t.task_spec->>'risk',t.task_spec#>>'{meta_orchestrator,risk}','NORMAL'))='CRITICAL' then array['CRITIC','FALSIFIER'] else array['CRITIC'] end;
   foreach required in array roles loop
     if exists(select 1 from destruktion_meta.project_task_h205f22 y join destruktion_meta.devos_fleet_task_h205f22 v using(task_id) where y.project_id=p_project_id and y.parent_task_id=t.task_id and v.role=required and v.task_spec->'verification_subject'->>'task_id'=t.task_id::text and v.task_spec->'verification_subject'->>'result_sha256'=t.result_summary->>'result_claim_sha256') then continue; end if;
     -- Verifiers become READY demand for the existing governor, with no lease
     -- allocated here and no model-proposal budget suppressing safety work.
     spec:=jsonb_build_object('schema','metaengine.devos.project-task-spec.v1','claim_class','READ_ONLY','objective',required||' independently verify result for '||t.task_id||': '||left(t.task_spec->>'objective',3500),
       'verification_subject',jsonb_build_object('task_id',t.task_id,'result_sha256',t.result_summary->>'result_claim_sha256',
         'deliverable_refs',coalesce(t.result_summary->'result_claim_deliverable_refs','[]'::jsonb),
         'evidence_refs',coalesce(t.result_summary->'result_claim_evidence_refs','[]'::jsonb)),
       'project_continuity',jsonb_build_object('schema','metaengine.devos.project-task.v1','project_id',p_project_id,'root_task_id',r.root_task_id,'parent_task_id',t.task_id,'depth',x.depth+1,'root_request_id',r.request_id),
       'automatic_retry_allowed',false,'model_output_authority',false,'scheduler_authority',false,'authority_effect',false);
     enqueued:=public.devos_fleet_enqueue_v1(p_workspace_id,'project.verify.'||replace(t.task_id::text,'-','')||'.'||lower(required),required,t.base_sha,spec,'project-verify:'||t.task_id||':'||t.lease_generation||':'||required||':'||(t.result_summary->>'result_claim_sha256'),null,100);
     child:=(enqueued->>'task_id')::uuid;
     update destruktion_meta.project_run_h205f22 set total_tasks=total_tasks+1 where project_id=p_project_id returning * into r;
     insert into destruktion_meta.project_task_h205f22 values(child,p_project_id,r.total_tasks,r.root_task_id,t.task_id,x.depth+1);
     perform destruktion_meta.project_append_h205f22(p_project_id,'VERIFIER_TASK_ADMITTED',child,0,p_client_id,null,null,null,jsonb_build_object('subject_task_id',t.task_id,'subject_result_sha256',t.result_summary->>'result_claim_sha256','role',required),'DATABASE_ADMISSION',null,false,'verify:'||child); admitted:=admitted+1;
   end loop;
 end loop;
 return jsonb_build_object('schema','metaengine.devos.project-reconcile.v1','project_id',p_project_id,'promoted_tasks',promoted,'admitted_verifiers',admitted,'native_checkpoint_pending',destruktion_meta.native_coding_checkpoint_candidate_v1(p_project_id) is not null,'native_checkpoint_candidate',destruktion_meta.native_coding_checkpoint_candidate_v1(p_project_id),'bounded_tasks',8,'automatic_retry_allowed',false,'scheduler_authority',false,'authority_effect',false);
end $$;
