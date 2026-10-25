-- Protected native checkpoint -> actual Host Git receipt -> next W30 task.
-- No model/API caller can supply a path, permit, goal or authority assertion.
create table destruktion_meta.native_coding_commit_h205f22 (
 checkpoint_id uuid primary key references destruktion_meta.native_coding_checkpoint_h205f22(checkpoint_id),
 workspace_id uuid not null,project_id uuid not null references destruktion_meta.project_run_h205f22(project_id),
 root_identity_sha256 text not null check(root_identity_sha256 ~ '^[a-f0-9]{64}$'),
 previous_head text not null check(previous_head ~ '^[a-f0-9]{40}$'),head text not null check(head ~ '^[a-f0-9]{40}$'),
 tree text not null check(tree ~ '^[a-f0-9]{40}$'),receipt jsonb not null,
 canonical_receipt text not null check(octet_length(canonical_receipt)<=8192),
 receipt_sha256 text not null check(receipt_sha256 ~ '^[a-f0-9]{64}$'),
 next_writer_permit_id uuid not null references destruktion_meta.native_coding_operator_permit_h205f22(permit_id),
 next_critic_permit_id uuid not null references destruktion_meta.native_coding_operator_permit_h205f22(permit_id),
 followup jsonb,successor_task_id uuid references destruktion_meta.devos_fleet_task_h205f22(task_id),
 created_at timestamptz not null default clock_timestamp(),
 check(head<>previous_head and next_writer_permit_id<>next_critic_permit_id),
 check(canonical_receipt::jsonb=receipt and receipt_sha256=encode(extensions.digest(convert_to(canonical_receipt,'UTF8'),'sha256'),'hex')),
 check(coalesce(receipt->>'schema'='metaengine.native-coding.git-commit-receipt.v1' and receipt->>'state'='COMMITTED'
  and receipt->>'project_id'=project_id::text and receipt->>'checkpoint_id'=checkpoint_id::text
  and receipt->>'previous_head'=previous_head and receipt->>'head'=head and receipt->>'tree'=tree
  and receipt->>'root_identity_sha256'=root_identity_sha256
  and receipt->'working_tree_preserved'='true'::jsonb and receipt->'index_clean'='true'::jsonb
  and receipt->'ref_update_cas_verified'='true'::jsonb and receipt->'commit_object_readback_verified'='true'::jsonb
  and receipt->'production_qualified'='false'::jsonb and receipt->'successor_admitted'='false'::jsonb
  and receipt->'automatic_retry_allowed'='false'::jsonb and receipt->'authority_effect'='false'::jsonb,false))
);
alter table destruktion_meta.native_coding_commit_h205f22 enable row level security;
revoke all on destruktion_meta.native_coding_commit_h205f22 from public,anon,authenticated,service_role;
create function destruktion_meta.native_coding_commit_immutable_v1()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' or (to_jsonb(new)-'successor_task_id') is distinct from (to_jsonb(old)-'successor_task_id')
  or old.successor_task_id is not null or new.successor_task_id is null then
  raise exception 'native_coding_commit_immutable' using errcode='23514';end if;return new;
end $$;
create trigger native_coding_commit_immutable_trg before update or delete on destruktion_meta.native_coding_commit_h205f22
 for each row execute function destruktion_meta.native_coding_commit_immutable_v1();

-- This readiness read is not a Git effect permit. Host must separately inspect
-- its current OS, installed artifact, managed Git registry and actual Git bytes.
create function destruktion_meta.native_coding_commit_gate_v1(p_checkpoint uuid)
returns jsonb language plpgsql set search_path=pg_catalog,public,destruktion_meta as $$
declare k destruktion_meta.native_coding_checkpoint_h205f22;r destruktion_meta.project_run_h205f22;
 w destruktion_meta.devos_fleet_task_h205f22;c destruktion_meta.devos_fleet_task_h205f22;
 wp destruktion_meta.native_coding_operator_permit_h205f22;cp destruktion_meta.native_coding_operator_permit_h205f22;control jsonb;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_coding_state_owner_required' using errcode='42501';end if;
 select * into k from destruktion_meta.native_coding_checkpoint_h205f22 where checkpoint_id=p_checkpoint;
 if not found then raise exception 'native_coding_commit_checkpoint_missing' using errcode='55000';end if;
 select * into r from destruktion_meta.project_run_h205f22 where project_id=k.project_id and workspace_id=k.workspace_id and state='ACTIVE';
 if not found then raise exception 'native_coding_commit_project_stopped' using errcode='55000';end if;
 perform destruktion_meta.project_device_grant_h205f22(r.device_id,r.client_id,r.admin_grant_epoch);
 control:=public.devos_environment_state_v1(k.workspace_id);
 if control->'refill_enabled' is distinct from 'true'::jsonb or control->'supervisor_admission_enabled' is distinct from 'true'::jsonb
  or control->'owner_stop'='true'::jsonb or control->>'state'='STOPPED' then raise exception 'native_coding_commit_owner_stopped' using errcode='55000';end if;
 select * into w from destruktion_meta.devos_fleet_task_h205f22 where task_id=k.writer_task_id and lease_generation=k.writer_lease_generation;
 select * into c from destruktion_meta.devos_fleet_task_h205f22 where task_id=k.critic_task_id and lease_generation=k.critic_lease_generation;
 if w.state is distinct from 'COMPLETED' or c.state is distinct from 'COMPLETED'
  or not destruktion_meta.native_coding_project_completion_ready_v1(w.task_id)
  or not destruktion_meta.native_coding_project_completion_ready_v1(c.task_id) then
  raise exception 'native_coding_commit_pair_unverified' using errcode='55000';end if;
 select * into wp from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=(w.task_spec#>>'{native_coding,permit_id}')::uuid;
 select * into cp from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=(c.task_spec#>>'{native_coding,permit_id}')::uuid;
 if wp.revoked_at is not null or cp.revoked_at is not null or coalesce((wp.permit->>'expires_at')::timestamptz<=clock_timestamp(),true)
  or coalesce((cp.permit->>'expires_at')::timestamptz<=clock_timestamp(),true)
  or wp.device_id is distinct from r.device_id or cp.device_id is distinct from r.device_id
  or wp.client_id is distinct from r.client_id or cp.client_id is distinct from r.client_id
  or wp.admin_grant_epoch is distinct from r.admin_grant_epoch or cp.admin_grant_epoch is distinct from r.admin_grant_epoch
 then raise exception 'native_coding_commit_permit_unavailable' using errcode='55000';end if;
 perform 1 from destruktion_meta.native_coding_worktree_fence_h205f22 where project_id=k.project_id and workspace_id=k.workspace_id
  and root_identity_sha256=k.root_identity_sha256 and writer_task_id=k.writer_task_id and writer_lease_generation=k.writer_lease_generation
  and state='CHECKPOINTED_PENDING_COMMIT' and checkpoint_sha256=k.checkpoint_sha256;
 if not found then raise exception 'native_coding_commit_fence_mismatch' using errcode='55000';end if;
 if exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 claim
  join destruktion_meta.devos_fleet_task_h205f22 task on task.task_id=claim.task_id and task.lease_generation=claim.lease_generation
  join destruktion_meta.native_coding_operator_permit_h205f22 permit on permit.permit_id=(task.task_spec#>>'{native_coding,permit_id}')::uuid
  where claim.state='ACTIVE' and claim.expires_at>clock_timestamp() and permit.permit#>>'{worktree,root_identity_sha256}'=k.root_identity_sha256)
 then raise exception 'native_coding_commit_root_in_use' using errcode='55000';end if;
 return jsonb_build_object('schema','metaengine.native-coding.commit-gate.v1','admitted',true,'checkpoint_id',k.checkpoint_id,
  'checkpoint_sha256',k.checkpoint_sha256,'project_id',k.project_id,'workspace_id',k.workspace_id,'root_identity_sha256',k.root_identity_sha256,
  'writer_permit_id',wp.permit_id,'critic_permit_id',cp.permit_id,'authority_effect',false);
end $$;

create function destruktion_meta.native_coding_read_commit_v1(p_checkpoint uuid)
returns jsonb language plpgsql set search_path=pg_catalog,destruktion_meta as $$
declare r destruktion_meta.native_coding_commit_h205f22;k destruktion_meta.native_coding_checkpoint_h205f22;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_coding_state_owner_required' using errcode='42501';end if;
 select * into r from destruktion_meta.native_coding_commit_h205f22 where checkpoint_id=p_checkpoint;if not found then return null;end if;
 select * into k from destruktion_meta.native_coding_checkpoint_h205f22 where checkpoint_id=p_checkpoint;
 return jsonb_build_object('schema','metaengine.native-coding.commit-checkpoint.v1','project_id',r.project_id,'checkpoint_id',r.checkpoint_id,
  'checkpoint_sha256',k.checkpoint_sha256,'state',case when r.successor_task_id is not null then 'SUCCESSOR_ADMITTED'
   when r.followup is null then 'COMMITTED_NO_SUCCESSOR' else 'COMMITTED_PENDING_SUCCESSOR' end,
  'commit_receipt_sha256',r.receipt_sha256,'receipt',r.receipt,'canonical_receipt',r.canonical_receipt,
  'previous_head',r.previous_head,'head',r.head,'tree',r.tree,'next_writer_permit_id',r.next_writer_permit_id,
  'next_critic_permit_id',r.next_critic_permit_id,'successor_task_id',r.successor_task_id,'successor_admitted',r.successor_task_id is not null,
  'root_fence_released',true,'production_qualified',false,'automatic_retry_allowed',false,'authority_effect',false);
end $$;

create function destruktion_meta.native_coding_project_reconcile_commit_v1(p_project uuid,p_client text)
returns integer language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta as $$
declare v destruktion_meta.native_coding_commit_h205f22;k destruktion_meta.native_coding_checkpoint_h205f22;
 r destruktion_meta.project_run_h205f22;w destruktion_meta.devos_fleet_task_h205f22;pt destruktion_meta.project_task_h205f22;
 p destruktion_meta.native_coding_operator_permit_h205f22;spec jsonb;enqueued jsonb;child uuid;control jsonb;
begin
 select * into r from destruktion_meta.project_run_h205f22 where project_id=p_project and client_id=p_client and state='ACTIVE' for update;
 if not found then return 0;end if;
 control:=public.devos_environment_state_v1(r.workspace_id);
 if control->'refill_enabled' is distinct from 'true'::jsonb or control->'supervisor_admission_enabled' is distinct from 'true'::jsonb
  or control->'owner_stop'='true'::jsonb or control->>'state'='STOPPED' then return 0;end if;
 select * into v from destruktion_meta.native_coding_commit_h205f22 where project_id=p_project and followup is not null
  and successor_task_id is null order by created_at,checkpoint_id limit 1 for update;
 if not found then return 0;end if;
 select * into k from destruktion_meta.native_coding_checkpoint_h205f22 where checkpoint_id=v.checkpoint_id;
 select * into w from destruktion_meta.devos_fleet_task_h205f22 where task_id=k.writer_task_id;
 select * into pt from destruktion_meta.project_task_h205f22 where project_id=p_project and task_id=w.task_id;
 select * into p from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=v.next_writer_permit_id and revoked_at is null;
 if p.permit_id is null or coalesce((p.permit->>'expires_at')::timestamptz<=clock_timestamp(),true) then return 0;end if;
 if r.max_depth is not null and pt.depth+1>r.max_depth or r.max_tasks is not null and r.total_tasks>=r.max_tasks
  or r.max_children is not null and (select count(*) from destruktion_meta.project_task_h205f22 where project_id=p_project and parent_task_id=w.task_id)>=r.max_children then return 0;end if;
 spec:=jsonb_build_object('schema','metaengine.devos.project-task-spec.v1','claim_class','MUTATING','objective',v.followup->>'objective',
  'constraints',coalesce(w.task_spec->'constraints','[]'::jsonb),
  'native_coding',jsonb_build_object('permit_id',p.permit_id,'goal_id',p.permit->>'goal_id','goal_sha256',p.permit->>'goal_sha256','project_id',p_project),
  'project_continuity',jsonb_build_object('schema','metaengine.devos.project-task.v1','project_id',p_project,'root_task_id',r.root_task_id,
   'parent_task_id',w.task_id,'depth',pt.depth+1,'root_request_id',r.request_id),
  'native_continuation',jsonb_build_object('checkpoint_id',k.checkpoint_id,'checkpoint_sha256',k.checkpoint_sha256,'previous_task_id',w.task_id,'commit_head',v.head),
  'automatic_retry_allowed',false,'model_output_authority',false,'scheduler_authority',false,'authority_effect',false);
 enqueued:=public.devos_fleet_enqueue_v1(r.workspace_id,'native.continue.'||replace(k.checkpoint_id::text,'-',''),'IMPLEMENTER',v.head,spec,
  'native-successor:'||k.checkpoint_id,null,w.priority);
 if (enqueued->>'accepted')::boolean is distinct from true then raise exception 'native_coding_successor_enqueue_rejected' using errcode='55000';end if;
 child:=(enqueued->>'task_id')::uuid;
 update destruktion_meta.project_run_h205f22 set total_tasks=total_tasks+1 where project_id=p_project returning * into r;
 insert into destruktion_meta.project_task_h205f22 values(child,p_project,r.total_tasks,r.root_task_id,w.task_id,pt.depth+1);
 update destruktion_meta.native_coding_commit_h205f22 set successor_task_id=child where checkpoint_id=v.checkpoint_id and successor_task_id is null;
 perform destruktion_meta.project_append_h205f22(p_project,'NATIVE_SUCCESSOR_TASK_ADMITTED',child,0,p_client,null,null,v.head,
  jsonb_build_object('checkpoint_id',k.checkpoint_id,'checkpoint_sha256',k.checkpoint_sha256,'previous_task_id',w.task_id,'base_sha',v.head),
  'DATABASE_ADMISSION',null,false,'native-successor:'||k.checkpoint_id);
 return 1;
end $$;

create function destruktion_meta.native_coding_finish_checkpoint_v1(p_checkpoint uuid,p_receipt jsonb,p_canonical_receipt text,p_receipt_sha256 text)
returns jsonb language plpgsql set search_path=pg_catalog,public,destruktion_meta,extensions as $$
declare k destruktion_meta.native_coding_checkpoint_h205f22;prior destruktion_meta.native_coding_commit_h205f22;
 gate jsonb;r destruktion_meta.project_run_h205f22;w destruktion_meta.native_coding_operator_permit_h205f22;c destruktion_meta.native_coding_operator_permit_h205f22;
 oldp destruktion_meta.native_coding_operator_permit_h205f22;nextp jsonb;nextid uuid;nextwriter uuid;nextcritic uuid;key text;stamp text;
 result jsonb;followup jsonb;entry jsonb;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_coding_state_owner_required' using errcode='42501';end if;
 if coalesce(jsonb_typeof(p_receipt)<>'object' or p_canonical_receipt is null or octet_length(p_canonical_receipt)>8192
  or p_canonical_receipt::jsonb is distinct from p_receipt or p_receipt_sha256 !~ '^[a-f0-9]{64}$'
  or p_receipt_sha256 is distinct from encode(extensions.digest(convert_to(p_canonical_receipt,'UTF8'),'sha256'),'hex'),true)
 then raise exception 'native_coding_commit_receipt_invalid' using errcode='22023';end if;
 if current_setting('transaction_isolation')<>'serializable' or current_setting('synchronous_commit')<>'on' then
  raise exception 'native_coding_commit_durable_transaction_required' using errcode='55000';end if;
 select * into k from destruktion_meta.native_coding_checkpoint_h205f22 where checkpoint_id=p_checkpoint;
 if not found then raise exception 'native_coding_commit_checkpoint_missing' using errcode='55000';end if;
 perform pg_advisory_xact_lock(hashtextextended(k.workspace_id::text,2382533));
 perform pg_advisory_xact_lock(hashtextextended(k.root_identity_sha256,25080000));
 select * into prior from destruktion_meta.native_coding_commit_h205f22 where checkpoint_id=p_checkpoint;
 if found then
  if prior.receipt is distinct from p_receipt or prior.canonical_receipt is distinct from p_canonical_receipt or prior.receipt_sha256 is distinct from p_receipt_sha256
  then raise exception 'native_coding_commit_receipt_collision' using errcode='23505';end if;
  return destruktion_meta.native_coding_read_commit_v1(p_checkpoint);
 end if;
 perform task_id from destruktion_meta.devos_fleet_task_h205f22 where task_id in(k.writer_task_id,k.critic_task_id) order by task_id for update;
 select * into r from destruktion_meta.project_run_h205f22 where project_id=k.project_id for update;
 gate:=destruktion_meta.native_coding_commit_gate_v1(p_checkpoint);
 if coalesce(p_receipt->>'schema'<>'metaengine.native-coding.git-commit-receipt.v1' or p_receipt->>'state'<>'COMMITTED'
  or p_receipt->>'project_id'<>k.project_id::text or p_receipt->>'checkpoint_id'<>p_checkpoint::text
  or p_receipt->>'checkpoint_sha256'<>k.checkpoint_sha256 or p_receipt->>'previous_head'<>k.source_head
  or p_receipt->>'root_identity_sha256'<>k.root_identity_sha256 or p_receipt->>'reviewed_git_artifact_sha256'<>k.git_artifact_sha256
  or p_receipt->>'head' !~ '^[a-f0-9]{40}$' or p_receipt->>'head'=k.source_head or p_receipt->>'tree' !~ '^[a-f0-9]{40}$'
  or p_receipt->>'intent_sha256' !~ '^[a-f0-9]{64}$' or p_receipt->>'branch_ref' !~ '^refs/heads/[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$'
  or p_receipt->'working_tree_preserved' is distinct from 'true'::jsonb or p_receipt->'index_clean' is distinct from 'true'::jsonb
  or p_receipt->'ref_update_cas_verified' is distinct from 'true'::jsonb or p_receipt->'commit_object_readback_verified' is distinct from 'true'::jsonb
  or p_receipt->'production_qualified' is distinct from 'false'::jsonb or p_receipt->'successor_admitted' is distinct from 'false'::jsonb
  or p_receipt->'automatic_retry_allowed' is distinct from 'false'::jsonb or p_receipt->'authority_effect' is distinct from 'false'::jsonb
  or p_receipt-ARRAY['schema','project_id','checkpoint_id','checkpoint_sha256','state','previous_head','head','tree','branch_ref',
   'root_identity_sha256','reviewed_git_artifact_sha256','intent_sha256','working_tree_preserved','index_clean','ref_update_cas_verified',
   'commit_object_readback_verified','production_qualified','successor_admitted','automatic_retry_allowed','authority_effect']<>'{}'::jsonb,true)
 then raise exception 'native_coding_commit_receipt_binding_mismatch' using errcode='23514';end if;
 select * into w from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=(gate->>'writer_permit_id')::uuid for update;
 select * into c from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=(gate->>'critic_permit_id')::uuid for update;
 select result_receipt->'result' into result from destruktion_meta.native_coding_job_registration_h205f22
  where task_id=k.writer_task_id and lease_generation=k.writer_lease_generation;
 if jsonb_typeof(result->'followup_tasks') is distinct from 'array' or jsonb_array_length(result->'followup_tasks')>16 then
  raise exception 'native_coding_commit_followup_invalid' using errcode='23514';end if;
 for entry in select value from jsonb_array_elements(result->'followup_tasks') loop
  if coalesce(jsonb_typeof(entry)<>'object' or entry-ARRAY['role','objective']<>'{}'::jsonb
   or entry->>'role' not in('IMPLEMENTER','CRITIC') or jsonb_typeof(entry->'objective')<>'string'
   or char_length(entry->>'objective') not between 1 and 1000 or btrim(entry->>'objective')='',true)
  then raise exception 'native_coding_commit_followup_invalid' using errcode='23514';end if;
  if followup is null and entry->>'role'='IMPLEMENTER' then followup:=entry;end if;
 end loop;
 stamp:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 -- Historical permit JSON/signatures remain untouched. Revocation only removes
 -- their future dispatch authority; each new permit waits for actual Host proof.
 for oldp in select * from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id in(w.permit_id,c.permit_id) order by permit_id loop
  key:=encode(extensions.digest(convert_to('native-commit-permit:'||p_checkpoint||':'||oldp.permit_id,'UTF8'),'sha256'),'hex');
  nextid:=(substr(key,1,8)||'-'||substr(key,9,4)||'-5'||substr(key,14,3)||'-8'||substr(key,18,3)||'-'||substr(key,21,12))::uuid;
  nextp:=jsonb_set(oldp.permit,'{worktree,base_sha}',to_jsonb(p_receipt->>'head'),false)
   ||jsonb_build_object('permit_id',nextid,'issued_at',stamp);
  nextp:=nextp||jsonb_build_object('record_sha256',encode(extensions.digest(convert_to((nextp-'record_sha256')::text,'UTF8'),'sha256'),'hex'));
  update destruktion_meta.native_coding_operator_permit_h205f22 set revoked_at=clock_timestamp() where permit_id=oldp.permit_id and revoked_at is null;
  insert into destruktion_meta.native_coding_operator_permit_h205f22
   (permit_id,workspace_id,client_id,device_id,admin_grant_epoch,provider_id,agent_id,agent_generation_epoch,permit,operator_record_sha256)
  values(nextid,oldp.workspace_id,oldp.client_id,oldp.device_id,oldp.admin_grant_epoch,oldp.provider_id,oldp.agent_id,oldp.agent_generation_epoch,nextp,nextp->>'record_sha256');
  if oldp.permit_id=w.permit_id then nextwriter:=nextid;else nextcritic:=nextid;end if;
 end loop;
 insert into destruktion_meta.native_coding_commit_h205f22
  (checkpoint_id,workspace_id,project_id,root_identity_sha256,previous_head,head,tree,receipt,canonical_receipt,receipt_sha256,
   next_writer_permit_id,next_critic_permit_id,followup)
 values(p_checkpoint,k.workspace_id,k.project_id,k.root_identity_sha256,k.source_head,p_receipt->>'head',p_receipt->>'tree',
  p_receipt,p_canonical_receipt,p_receipt_sha256,nextwriter,nextcritic,followup);
 delete from destruktion_meta.native_coding_worktree_fence_h205f22 where writer_task_id=k.writer_task_id and writer_lease_generation=k.writer_lease_generation
  and root_identity_sha256=k.root_identity_sha256 and state='CHECKPOINTED_PENDING_COMMIT' and checkpoint_sha256=k.checkpoint_sha256;
 if not found then raise exception 'native_coding_commit_fence_release_unconfirmed' using errcode='55000';end if;
 perform destruktion_meta.project_append_h205f22(k.project_id,'NATIVE_COMMIT_RECORDED',k.writer_task_id,k.writer_lease_generation,r.client_id,null,null,p_receipt->>'head',
  jsonb_build_object('checkpoint_id',k.checkpoint_id,'checkpoint_sha256',k.checkpoint_sha256,'commit_receipt_sha256',p_receipt_sha256,
   'previous_head',k.source_head,'head',p_receipt->>'head','tree',p_receipt->>'tree'),'HOST_GIT_READBACK',null,false,'native-commit:'||k.checkpoint_id);
 perform destruktion_meta.native_coding_project_reconcile_commit_v1(k.project_id,r.client_id);
 return destruktion_meta.native_coding_read_commit_v1(p_checkpoint);
end $$;

create function destruktion_meta.native_coding_commit_candidate_v1(p_project uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,destruktion_meta as $$
 select jsonb_build_object('checkpoint_id',k.checkpoint_id,'checkpoint_sha256',k.checkpoint_sha256,
  'writer_task_id',k.writer_task_id,'writer_lease_generation',k.writer_lease_generation,
  'critic_task_id',k.critic_task_id,'critic_lease_generation',k.critic_lease_generation)
 from destruktion_meta.native_coding_checkpoint_h205f22 k join destruktion_meta.native_coding_worktree_fence_h205f22 f
  on f.writer_task_id=k.writer_task_id and f.writer_lease_generation=k.writer_lease_generation and f.checkpoint_sha256=k.checkpoint_sha256
 where k.project_id=p_project and f.state='CHECKPOINTED_PENDING_COMMIT'
  and not exists(select 1 from destruktion_meta.native_coding_commit_h205f22 m where m.checkpoint_id=k.checkpoint_id)
 order by k.created_at,k.checkpoint_id limit 1
$$;
revoke all on function destruktion_meta.native_coding_commit_immutable_v1(),destruktion_meta.native_coding_commit_gate_v1(uuid),
 destruktion_meta.native_coding_read_commit_v1(uuid),destruktion_meta.native_coding_project_reconcile_commit_v1(uuid,text),
 destruktion_meta.native_coding_finish_checkpoint_v1(uuid,jsonb,text,text),destruktion_meta.native_coding_commit_candidate_v1(uuid)
 from public,anon,authenticated,service_role;


-- Existing project sweep, with completed pending checkpoints and queued continuation.
create or replace function public.h205f22_project_reconcile_v1(p_workspace_id uuid,p_project_id uuid,p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta,pg_temp as $$
declare r destruktion_meta.project_run_h205f22%rowtype; t destruktion_meta.devos_fleet_task_h205f22%rowtype; x destruktion_meta.project_task_h205f22%rowtype;
 required text; roles text[]; spec jsonb; enqueued jsonb; child uuid; promoted integer:=0; admitted integer:=0; successors integer:=0; target uuid; outcomes jsonb:='[]';
begin
 if p_project_id is null then
   perform destruktion_meta.project_device_grant_h205f22(p_device_id,p_client_id,p_admin_grant_epoch);
   for target in select run.project_id from destruktion_meta.project_run_h205f22 run where run.workspace_id=p_workspace_id and run.device_id=p_device_id and run.client_id=p_client_id and run.admin_grant_epoch=p_admin_grant_epoch and run.state='ACTIVE'
     and (exists(select 1 from destruktion_meta.project_task_h205f22 link join destruktion_meta.devos_fleet_task_h205f22 task using(task_id) where link.project_id=run.project_id and task.state='RESULT_READY') or destruktion_meta.native_coding_commit_candidate_v1(run.project_id) is not null or exists(select 1 from destruktion_meta.native_coding_commit_h205f22 m where m.project_id=run.project_id and m.followup is not null and m.successor_task_id is null))
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
 successors:=destruktion_meta.native_coding_project_reconcile_commit_v1(p_project_id,p_client_id);
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
 return jsonb_build_object('schema','metaengine.devos.project-reconcile.v1','project_id',p_project_id,'promoted_tasks',promoted,'admitted_verifiers',admitted,'admitted_native_successors',successors,'native_commit_pending',destruktion_meta.native_coding_commit_candidate_v1(p_project_id) is not null,'native_commit_candidate',destruktion_meta.native_coding_commit_candidate_v1(p_project_id),'native_checkpoint_pending',destruktion_meta.native_coding_checkpoint_candidate_v1(p_project_id) is not null,'native_checkpoint_candidate',destruktion_meta.native_coding_checkpoint_candidate_v1(p_project_id),'bounded_tasks',8,'automatic_retry_allowed',false,'scheduler_authority',false,'authority_effect',false);
end $$;
