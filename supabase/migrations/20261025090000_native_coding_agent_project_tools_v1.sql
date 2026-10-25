-- Lease-scoped native agent collaboration over the existing project history
-- and W30 queue. No caller identity, new allocator, timers or physical effects.
create table destruktion_meta.native_coding_agent_intent_h205f22 (
  run_id uuid not null references destruktion_meta.native_coding_job_registration_h205f22(run_id), request_id uuid not null,
  workspace_id uuid not null, project_id uuid not null references destruktion_meta.project_run_h205f22(project_id),
  task_id uuid not null, lease_generation bigint not null, agent_id text not null,
  operation text not null check(operation in ('MESSAGE','SPAWN')), body jsonb not null,
  body_sha256 text not null check(body_sha256 ~ '^[a-f0-9]{64}$'), receipt jsonb,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  primary key(run_id,request_id),
  check(body_sha256=encode(extensions.digest(convert_to(body::text,'UTF8'),'sha256'),'hex'))
);
alter table destruktion_meta.native_coding_agent_intent_h205f22 enable row level security;
revoke all on destruktion_meta.native_coding_agent_intent_h205f22 from public,anon,authenticated,service_role;
create unique index native_coding_agent_semantic_intent_uq on destruktion_meta.native_coding_agent_intent_h205f22(run_id,operation,body_sha256);
create table destruktion_meta.native_coding_agent_intent_alias_h205f22 (
 run_id uuid not null,request_id uuid not null,original_request_id uuid not null,created_at timestamptz not null default clock_timestamp(),
 primary key(run_id,request_id),foreign key(run_id,original_request_id)references destruktion_meta.native_coding_agent_intent_h205f22(run_id,request_id)
);
alter table destruktion_meta.native_coding_agent_intent_alias_h205f22 enable row level security;
revoke all on destruktion_meta.native_coding_agent_intent_alias_h205f22 from public,anon,authenticated,service_role;
create function destruktion_meta.native_coding_agent_alias_immutable_v1()
returns trigger language plpgsql as $$begin raise exception 'native_agent_intent_alias_immutable' using errcode='23514';end$$;
create trigger native_coding_agent_alias_immutable_trg before update or delete on destruktion_meta.native_coding_agent_intent_alias_h205f22
 for each row execute function destruktion_meta.native_coding_agent_alias_immutable_v1();
create function destruktion_meta.native_coding_agent_intent_immutable_v1()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' or (to_jsonb(new)-'receipt'-'updated_at') is distinct from (to_jsonb(old)-'receipt'-'updated_at')
   or (old.operation='MESSAGE' and old.receipt is not null and new.receipt is distinct from old.receipt)
 then raise exception 'native_agent_intent_immutable' using errcode='23514'; end if;
 return new;
end $$;

create function destruktion_meta.native_coding_agent_intent_begin_v1(p_context jsonb,p_run uuid,p_request uuid,p_operation text,p_body jsonb)
returns destruktion_meta.native_coding_agent_intent_h205f22 language plpgsql security invoker set search_path=pg_catalog,destruktion_meta,extensions as $$
declare intent destruktion_meta.native_coding_agent_intent_h205f22; digest text; original uuid;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_agent_state_owner_required' using errcode='42501'; end if;
 digest:=encode(extensions.digest(convert_to(p_body::text,'UTF8'),'sha256'),'hex');
 select i.* into intent from destruktion_meta.native_coding_agent_intent_h205f22 i where i.run_id=p_run and i.request_id=p_request for update;
 if not found then
   select i.* into intent from destruktion_meta.native_coding_agent_intent_alias_h205f22 a
     join destruktion_meta.native_coding_agent_intent_h205f22 i on i.run_id=a.run_id and i.request_id=a.original_request_id
     where a.run_id=p_run and a.request_id=p_request for update of i;
 end if;
 if intent.request_id is not null then
   if intent.operation<>p_operation or intent.body_sha256<>digest or intent.body<>p_body then raise exception 'native_agent_intent_collision' using errcode='23505'; end if;
   return intent;
 end if;
 insert into destruktion_meta.native_coding_agent_intent_h205f22(run_id,request_id,workspace_id,project_id,task_id,lease_generation,agent_id,operation,body,body_sha256)
   values(p_run,p_request,(p_context#>>'{task,workspace_id}')::uuid,(p_context->>'project_id')::uuid,(p_context#>>'{task,task_id}')::uuid,
     (p_context#>>'{task,lease_generation}')::bigint,p_context#>>'{task,lease_agent_id}',p_operation,p_body,digest)on conflict do nothing;
 select * into intent from destruktion_meta.native_coding_agent_intent_h205f22 where run_id=p_run and operation=p_operation and body_sha256=digest for update;
 if intent.request_id is null then raise exception 'native_agent_semantic_intent_readback_required' using errcode='55000'; end if;
 if intent.body<>p_body then raise exception 'native_agent_intent_collision' using errcode='23505'; end if;
 if intent.request_id<>p_request then
   insert into destruktion_meta.native_coding_agent_intent_alias_h205f22(run_id,request_id,original_request_id)
     values(p_run,p_request,intent.request_id)on conflict do nothing;
   select original_request_id into original from destruktion_meta.native_coding_agent_intent_alias_h205f22 where run_id=p_run and request_id=p_request;
   if original is distinct from intent.request_id then raise exception 'native_agent_intent_collision' using errcode='23505'; end if;
 end if;
 return intent;
end $$;
create trigger native_coding_agent_intent_immutable_trg before update or delete on destruktion_meta.native_coding_agent_intent_h205f22
 for each row execute function destruktion_meta.native_coding_agent_intent_immutable_v1();

create function destruktion_meta.native_coding_agent_context_v1(p_run uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta as $$
declare j destruktion_meta.native_coding_job_registration_h205f22; t destruktion_meta.devos_fleet_task_h205f22;
 c destruktion_meta.devos_fleet_claim_h205f22; e destruktion_meta.native_coding_execution_h205f22;
 p destruktion_meta.native_coding_operator_permit_h205f22; f destruktion_meta.native_coding_worktree_fence_h205f22;
 r destruktion_meta.project_run_h205f22; context jsonb; control jsonb;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_agent_state_owner_required' using errcode='42501'; end if;
 select * into j from destruktion_meta.native_coding_job_registration_h205f22 where run_id=p_run;
 select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=j.task_id and lease_generation=j.lease_generation;
 select * into e from destruktion_meta.native_coding_execution_h205f22 where task_id=j.task_id and lease_generation=j.lease_generation;
 select * into p from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=j.permit_id and revoked_at is null;
 select * into c from destruktion_meta.devos_fleet_claim_h205f22 where task_id=j.task_id and lease_generation=j.lease_generation and state='ACTIVE';
 if j.run_id is null or t.state is distinct from 'RUNNING' or e.state is distinct from 'ATTEMPTED' or j.result_receipt is not null
   or c.claim_id is null or c.expires_at<=clock_timestamp() or t.lease_expires_at<=clock_timestamp()
   or c.agent_id is distinct from t.lease_agent_id or c.target_id is distinct from t.lease_target_id or c.tab_id is distinct from t.lease_tab_id
   or c.agent_generation_epoch is distinct from t.lease_agent_generation_epoch or c.workspace_id is distinct from t.workspace_id
   or c.base_sha is distinct from t.base_sha or c.expires_at is distinct from t.lease_expires_at
   or p.permit_id is null or p.workspace_id is distinct from t.workspace_id or p.agent_id is distinct from t.lease_agent_id
   or t.lease_target_id is distinct from 'codex-cli:'||p.provider_id::text or t.role is distinct from p.permit->>'role'
   or t.task_spec#>>'{native_coding,permit_id}' is distinct from p.permit_id::text
   or t.task_spec#>>'{native_coding,project_id}' is distinct from p.permit->>'project_id'
   or t.task_spec#>>'{native_coding,goal_id}' is distinct from p.permit->>'goal_id'
   or t.task_spec#>>'{native_coding,goal_sha256}' is distinct from p.permit->>'goal_sha256'
   or e.agent_id is distinct from t.lease_agent_id or e.target_id is distinct from t.lease_target_id
   or e.host_incarnation is distinct from j.job_envelope#>>'{payload,host_process,process_incarnation_id}'
   or j.job_envelope#>>'{payload,run_id}' is distinct from p_run::text
   or j.job_envelope#>>'{payload,agent_id}' is distinct from t.lease_agent_id
   or j.job_envelope#>>'{payload,role}' is distinct from t.role
 then raise exception 'native_agent_run_not_current' using errcode='55000'; end if;
 context:=public.native_coding_admission_context_v1(t.workspace_id,p.client_id,p.permit_id);
 r:=destruktion_meta.project_authorize_h205f22(t.workspace_id,(p.permit->>'project_id')::uuid,p.device_id,p.client_id,p.admin_grant_epoch);
 if r.state<>'ACTIVE' or not exists(select 1 from destruktion_meta.project_task_h205f22 where task_id=t.task_id and project_id=r.project_id)
 then raise exception 'native_agent_project_fenced' using errcode='55000'; end if;
 select * into f from destruktion_meta.native_coding_worktree_fence_h205f22 where root_identity_sha256=p.permit#>>'{worktree,root_identity_sha256}';
 if f.state is distinct from 'HELD' or f.workspace_id is distinct from t.workspace_id or f.project_id is distinct from r.project_id
   or (t.role='IMPLEMENTER' and (f.writer_task_id is distinct from t.task_id or f.writer_lease_generation is distinct from t.lease_generation))
   or (t.role='CRITIC' and not destruktion_meta.native_coding_worktree_admissible_v1(t.workspace_id,t.task_id))
 then raise exception 'native_agent_worktree_fenced' using errcode='55000'; end if;
 control:=public.devos_environment_state_v1(t.workspace_id);
 if control->'refill_enabled' is distinct from 'true'::jsonb or control->'supervisor_admission_enabled' is distinct from 'true'::jsonb
 then raise exception 'native_agent_owner_stopped' using errcode='55000'; end if;
 return jsonb_build_object('run_id',p_run,'task',to_jsonb(t),'claim',to_jsonb(c),'permit',p.permit,
   'project_id',r.project_id,'device_id',p.device_id,'client_id',p.client_id,'admin_grant_epoch',p.admin_grant_epoch);
end $$;

create function destruktion_meta.native_coding_agent_overview_v1(p_run uuid,p_after_seq bigint default 0,p_limit integer default 32)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,destruktion_meta as $$
declare a jsonb; id uuid; rows jsonb; next_seq bigint; high bigint; n integer;
begin
 a:=destruktion_meta.native_coding_agent_context_v1(p_run);id:=(a->>'project_id')::uuid;
 if p_after_seq is null or p_after_seq<0 or p_limit is null or p_limit not between 1 and 32 then raise exception 'native_agent_overview_cursor_invalid'; end if;
 select coalesce(max(task_seq),0) into high from destruktion_meta.project_task_h205f22 where project_id=id;
 if p_after_seq>high then raise exception 'native_agent_overview_cursor_invalid'; end if;
 select coalesce(jsonb_agg(row order by task_seq),'[]'::jsonb),coalesce(max(task_seq),p_after_seq),count(*) into rows,next_seq,n from (
   select pt.task_seq,jsonb_build_object('task_seq',pt.task_seq,'task_id',t.task_id,'parent_task_id',pt.parent_task_id,'depth',pt.depth,
     'agent_id',coalesce(t.lease_agent_id,p.agent_id),'role',t.role,'state',t.state,'lease_generation',t.lease_generation,
     'claim_class',t.claim_class,'native',t.task_spec ? 'native_coding')as row
   from destruktion_meta.project_task_h205f22 pt join destruktion_meta.devos_fleet_task_h205f22 t using(task_id)
   left join destruktion_meta.native_coding_operator_permit_h205f22 p on p.permit_id=(t.task_spec#>>'{native_coding,permit_id}')::uuid
   where pt.project_id=id and pt.task_seq>p_after_seq order by pt.task_seq limit p_limit
 )page;
 return jsonb_build_object('schema','metaengine.native-coding.agent-overview.v1','project_id',id,'caller_task_id',a#>>'{task,task_id}',
   'tasks',rows,'cursor',jsonb_build_object('after_seq',p_after_seq,'next_seq',next_seq,'through_seq',high,'has_more',next_seq<high),
   'scheduler_authority',false,'automatic_retry_allowed',false,'authority_effect',false);
end $$;

create function destruktion_meta.native_coding_agent_history_v1(p_run uuid,p_after_seq bigint default 0,p_through_seq bigint default null,p_limit integer default 16)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta as $$
declare a jsonb; result jsonb;
begin
 a:=destruktion_meta.native_coding_agent_context_v1(p_run);
 if p_limit is null or p_limit not between 1 and 16 then raise exception 'native_agent_history_limit_invalid'; end if;
 result:=public.h205f22_project_history_v1((a#>>'{task,workspace_id}')::uuid,(a->>'project_id')::uuid,p_after_seq,p_through_seq,p_limit,
   null,null,null,(a->>'device_id')::uuid,a->>'client_id',(a->>'admin_grant_epoch')::bigint);
 result:=result||jsonb_build_object('native_run_bound',true,'content_is_authority',false,'full_text_returned',true);
 if octet_length(result::text)>184320 then raise exception 'native_agent_history_page_byte_budget_exceeded'; end if;
 return result;
end $$;

create function destruktion_meta.native_coding_agent_message_v1(p_run uuid,p_request uuid,p_recipient_agent text,p_text text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta,extensions as $$
declare a jsonb; id uuid; target uuid; count_targets integer; body jsonb; digest text; intent destruktion_meta.native_coding_agent_intent_h205f22;
 event_seq bigint; event jsonb; response jsonb;
begin
 a:=destruktion_meta.native_coding_agent_context_v1(p_run);id:=(a->>'project_id')::uuid;
 if p_request is null or p_recipient_agent is null or p_recipient_agent !~ '^agent_[a-z0-9-]{8,64}$'
   or p_text is null or length(btrim(p_text))=0 or octet_length(p_text)>8192 then raise exception 'native_agent_message_invalid'; end if;
 body:=jsonb_build_object('target_agent_id',p_recipient_agent,'message',p_text);
 digest:=encode(extensions.digest(convert_to(body::text,'UTF8'),'sha256'),'hex');
 intent:=destruktion_meta.native_coding_agent_intent_begin_v1(a,p_run,p_request,'MESSAGE',body);
 if intent.operation<>'MESSAGE' or intent.body_sha256<>digest or intent.body<>body then raise exception 'native_agent_intent_collision' using errcode='23505'; end if;
 if intent.receipt is not null then return intent.receipt||jsonb_build_object('intent_replayed',true,'semantic_replayed',intent.request_id<>p_request,
   'requested_request_id',p_request,'original_request_id',intent.request_id); end if;
 select min(task_id::text)::uuid,count(*) into target,count_targets from (
   select t.task_id from destruktion_meta.project_task_h205f22 pt join destruktion_meta.devos_fleet_task_h205f22 t using(task_id)
   join destruktion_meta.native_coding_operator_permit_h205f22 p on p.permit_id=(t.task_spec#>>'{native_coding,permit_id}')::uuid
   where pt.project_id=id and t.workspace_id=(a#>>'{task,workspace_id}')::uuid
     and coalesce(t.lease_agent_id,p.agent_id)=p_recipient_agent and t.state in ('READY','LEASED','RUNNING','RESULT_READY')
     and p.revoked_at is null and (p.permit->>'expires_at')::timestamptz>clock_timestamp()
 )peers;
 if count_targets<>1 then raise exception 'native_agent_recipient_not_unique' using errcode='55000'; end if;
 event_seq:=destruktion_meta.project_append_h205f22(id,'NATIVE_AGENT_MESSAGE',(a#>>'{task,task_id}')::uuid,(a#>>'{task,lease_generation}')::bigint,
   a#>>'{task,lease_agent_id}',null,'agent_send_message',null,
   body||jsonb_build_object('request_id',p_request,'sender_run_id',p_run,'recipient_task_id',target),
   'UNTRUSTED_NATIVE_AGENT_MESSAGE',null,false,'native-message:'||p_run||':'||p_request);
 select to_jsonb(e) into event from destruktion_meta.project_event_h205f22 e where project_id=id and e.seq=event_seq;
 if octet_length(event::text)>8192 then raise exception 'native_agent_message_event_byte_budget_exceeded'; end if;
 response:=jsonb_build_object('schema','metaengine.native-coding.agent-message.v1','project_id',id,'request_id',p_request,'seq',event_seq,
   'sender_agent_id',a#>>'{task,lease_agent_id}','target_agent_id',p_recipient_agent,'recipient_task_id',target,
   'stored',true,'read_by_recipient_proven',false,'intent_replayed',false,'automatic_retry_allowed',false,'authority_effect',false);
 update destruktion_meta.native_coding_agent_intent_h205f22 set receipt=response,updated_at=clock_timestamp() where run_id=p_run and request_id=p_request;
 return response;
end $$;

create function destruktion_meta.native_coding_agent_child_permit_v1(p_task uuid,p_role text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $$
declare t destruktion_meta.devos_fleet_task_h205f22; parent destruktion_meta.native_coding_operator_permit_h205f22; child jsonb;
begin
 if p_role<>'IMPLEMENTER' then return null; end if; -- CRITIC admission needs an exact completed writer subject.
 select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=p_task;
 select * into parent from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=(t.task_spec#>>'{native_coding,permit_id}')::uuid;
 select p.permit into child from destruktion_meta.native_coding_operator_permit_h205f22 p
   where p.workspace_id=parent.workspace_id and p.client_id=parent.client_id and p.device_id=parent.device_id and p.admin_grant_epoch=parent.admin_grant_epoch
     and p.revoked_at is null and (p.permit->>'expires_at')::timestamptz>clock_timestamp() and p.permit->>'role'='IMPLEMENTER'
     and p.agent_id<>parent.agent_id and p.provider_id<>parent.provider_id
     and p.permit->>'project_id'=parent.permit->>'project_id' and p.permit->>'goal_id'=parent.permit->>'goal_id'
     and p.permit->>'goal_sha256'=parent.permit->>'goal_sha256' and p.permit->>'owner_epoch'=parent.permit->>'owner_epoch'
     and p.permit->>'user_sid'=parent.permit->>'user_sid' and p.permit->'artifact'=parent.permit->'artifact' and p.permit->'postgres'=parent.permit->'postgres'
     and p.permit#>>'{worktree,base_sha}'=t.base_sha and p.permit#>>'{worktree,root_identity_sha256}'<>parent.permit#>>'{worktree,root_identity_sha256}'
     and not exists(select 1 from destruktion_meta.native_coding_worktree_fence_h205f22 f where f.root_identity_sha256=p.permit#>>'{worktree,root_identity_sha256}')
     and not exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 queued where queued.workspace_id=p.workspace_id
       and queued.task_spec#>>'{native_coding,permit_id}'=p.permit_id::text and queued.state in ('READY','LEASED','RUNNING','RESULT_READY'))
   -- The caller already holds this project's row lock. No permit row lock is
   -- needed for a logical proposal: W30 revalidates it before any allocation.
   -- This preserves the project/provider-refresh lock order.
   order by p.permit_id limit 1;
 return child;
end $$;

-- Historical write readback is evidence only. It cannot renew a lease, issue
-- another tool call or replay the old intent after a process/ACK loss.
create function destruktion_meta.native_coding_agent_intent_read_v1(p_run uuid,p_request uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,destruktion_meta as $$
declare intent destruktion_meta.native_coding_agent_intent_h205f22; j destruktion_meta.native_coding_job_registration_h205f22;
 p destruktion_meta.native_coding_operator_permit_h205f22;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_agent_state_owner_required' using errcode='42501'; end if;
 select * into j from destruktion_meta.native_coding_job_registration_h205f22 where run_id=p_run;
 select * into p from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=j.permit_id;
 if j.run_id is null or p.permit_id is null then raise exception 'native_agent_run_not_found' using errcode='55000'; end if;
 perform destruktion_meta.project_authorize_h205f22(p.workspace_id,(p.permit->>'project_id')::uuid,p.device_id,p.client_id,p.admin_grant_epoch);
 select * into intent from destruktion_meta.native_coding_agent_intent_h205f22 where run_id=p_run and request_id=p_request;
 if not found then
   select i.* into intent from destruktion_meta.native_coding_agent_intent_alias_h205f22 a
     join destruktion_meta.native_coding_agent_intent_h205f22 i on i.run_id=a.run_id and i.request_id=a.original_request_id
     where a.run_id=p_run and a.request_id=p_request;
 end if;
 return jsonb_build_object('schema','metaengine.native-coding.agent-intent.v1','found',intent.request_id is not null,'run_id',p_run,'request_id',p_request,
   'original_request_id',intent.request_id,'operation',intent.operation,'body',intent.body,'canonical_body_text',intent.body::text,'body_sha256',intent.body_sha256,'receipt',intent.receipt,
   'readback_only',true,'physical_effect_replayed',false,'automatic_retry_allowed',false,'authority_effect',false);
end $$;

create function destruktion_meta.native_coding_agent_spawn_v1(p_run uuid,p_request uuid,p_children jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta,extensions as $$
declare a jsonb; body jsonb; digest text; intent destruktion_meta.native_coding_agent_intent_h205f22; i integer; batch jsonb;
 result jsonb; results jsonb:='[]'; response jsonb; batch_request uuid; h text;
begin
 a:=destruktion_meta.native_coding_agent_context_v1(p_run);
 if p_request is null or jsonb_typeof(p_children) is distinct from 'array' or jsonb_array_length(p_children) not between 1 and 16 then raise exception 'native_agent_children_invalid'; end if;
 for body in select value from jsonb_array_elements(p_children) loop
   if jsonb_typeof(body) is distinct from 'object' or (select count(*) from jsonb_object_keys(body))<>2 or not(body ?&array['role','objective'])
     or body->>'role' not in ('IMPLEMENTER','CRITIC') or jsonb_typeof(body->'objective') is distinct from 'string'
     or length(btrim(body->>'objective')) not between 1 and 4000 then raise exception 'native_agent_child_invalid'; end if;
 end loop;
 body:=jsonb_build_object('children',p_children);digest:=encode(extensions.digest(convert_to(body::text,'UTF8'),'sha256'),'hex');
 intent:=destruktion_meta.native_coding_agent_intent_begin_v1(a,p_run,p_request,'SPAWN',body);
 if intent.operation<>'SPAWN' or intent.body_sha256<>digest or intent.body<>body then raise exception 'native_agent_intent_collision' using errcode='23505'; end if;
 -- Both batches execute in this ONE SQL transaction. Any second-batch failure
 -- rolls back first-batch admission and the intent; neither allocates leases.
 for i in 0..((jsonb_array_length(p_children)-1)/8) loop
   select jsonb_agg(value order by ordinality) into batch from jsonb_array_elements(p_children)with ordinality where ordinality>i*8 and ordinality<=i*8+8;
   h:=encode(extensions.digest(convert_to(p_run::text||':'||intent.request_id::text||':'||i,'UTF8'),'sha256'),'hex');
   batch_request:=(substr(h,1,8)||'-'||substr(h,9,4)||'-4'||substr(h,14,3)||'-a'||substr(h,18,3)||'-'||substr(h,21,12))::uuid;
   result:=public.h205f22_project_spawn_v1((a#>>'{task,workspace_id}')::uuid,(a->>'project_id')::uuid,(a#>>'{task,task_id}')::uuid,
     (a#>>'{claim,claim_id}')::bigint,(a#>>'{task,lease_generation}')::bigint,batch_request,batch,
     (a->>'device_id')::uuid,a->>'client_id',(a->>'admin_grant_epoch')::bigint);
   results:=results||jsonb_build_array(result);
 end loop;
 response:=jsonb_build_object('schema','metaengine.native-coding.agent-spawn.v1','project_id',a->>'project_id','request_id',intent.request_id,
   'requested_request_id',p_request,'original_request_id',intent.request_id,'semantic_replayed',intent.request_id<>p_request,
   'batches',results,'intent_replayed',intent.receipt is not null,'leases_allocated',false,'physical_agents_created',false,
   'scheduler_authority',false,'automatic_retry_allowed',false,'authority_effect',false);
 update destruktion_meta.native_coding_agent_intent_h205f22 set receipt=response,updated_at=clock_timestamp() where run_id=p_run and request_id=intent.request_id;
 return response;
end $$;

revoke all on function destruktion_meta.native_coding_agent_alias_immutable_v1(),destruktion_meta.native_coding_agent_intent_begin_v1(jsonb,uuid,uuid,text,jsonb),
 destruktion_meta.native_coding_agent_intent_immutable_v1(),destruktion_meta.native_coding_agent_context_v1(uuid),destruktion_meta.native_coding_agent_overview_v1(uuid,bigint,integer),
 destruktion_meta.native_coding_agent_history_v1(uuid,bigint,bigint,integer),destruktion_meta.native_coding_agent_message_v1(uuid,uuid,text,text),
 destruktion_meta.native_coding_agent_child_permit_v1(uuid,text),destruktion_meta.native_coding_agent_spawn_v1(uuid,uuid,jsonb)
 ,destruktion_meta.native_coding_agent_intent_read_v1(uuid,uuid)
 from public,anon,authenticated,service_role;

-- Native private Host branch; the existing browser claim proof remains unchanged.
create or replace function destruktion_meta.project_parent_h205f22(p_workspace uuid,p_project uuid,p_task uuid,p_claim bigint,p_generation bigint,p_device uuid,p_client text,p_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta,pg_temp as $$
declare t destruktion_meta.devos_fleet_task_h205f22%rowtype; c destruktion_meta.devos_fleet_claim_h205f22%rowtype;
  d public.compute_fabric_a2_browser_device_h205f22%rowtype; s jsonb; a jsonb; proof jsonb; seen timestamptz; r destruktion_meta.project_run_h205f22%rowtype; native_run uuid; native_context jsonb;
begin
  select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=p_task and workspace_id=p_workspace for update;
  if not found or t.state not in ('LEASED','RUNNING') or t.authority_effect is distinct from false then raise exception 'PROJECT_PARENT_NOT_CURRENT'; end if;
  if t.lease_target_id like 'codex-cli:%' then
    select run_id into native_run from destruktion_meta.native_coding_job_registration_h205f22 where task_id=p_task and lease_generation=p_generation;
    native_context:=destruktion_meta.native_coding_agent_context_v1(native_run);
    if native_context->>'project_id' is distinct from p_project::text or native_context#>>'{task,workspace_id}' is distinct from p_workspace::text
      or (native_context#>>'{claim,claim_id}')::bigint is distinct from p_claim or native_context->>'device_id' is distinct from p_device::text
      or native_context->>'client_id' is distinct from p_client or (native_context->>'admin_grant_epoch')::bigint is distinct from p_epoch
    then raise exception 'PROJECT_NATIVE_PARENT_SCOPE_DENIED' using errcode='42501'; end if;
    return jsonb_build_object('task',native_context->'task','claim',native_context->'claim');
  end if;
  select * into c from destruktion_meta.devos_fleet_claim_h205f22 where claim_id=p_claim for share;
  if not found or c.task_id is distinct from p_task or c.workspace_id is distinct from p_workspace or c.state is distinct from 'ACTIVE'
    or c.expires_at<=clock_timestamp() or c.lease_generation is distinct from p_generation or t.lease_generation is distinct from c.lease_generation
    or t.lease_agent_id is distinct from c.agent_id or t.lease_tab_id is distinct from c.tab_id or t.lease_target_id is distinct from c.target_id
    or t.lease_agent_generation_epoch is distinct from c.agent_generation_epoch or t.lease_expires_at is distinct from c.expires_at
    or t.base_sha is distinct from c.base_sha or t.point_id is distinct from c.point_id or c.authority_effect is distinct from false
  then raise exception 'PROJECT_PARENT_CLAIM_FENCED' using errcode='55000'; end if;
  r:=destruktion_meta.project_authorize_h205f22(p_workspace,p_project,p_device,p_client,p_epoch);
  if r.state<>'ACTIVE' or not exists(select 1 from destruktion_meta.project_task_h205f22 where project_id=p_project and task_id=p_task)
  then raise exception 'PROJECT_PARENT_SCOPE_DENIED' using errcode='42501'; end if;
  select * into d from public.compute_fabric_a2_browser_device_h205f22 where device_id=p_device;
  select destruktion_meta.devos_normalize_native_supervisor_state_h205f22(state),last_seen_at into s,seen
    from public.compute_fabric_a2_browser_supervisor_state_h205f22 where client_id=p_client and workspace_id=p_workspace for share;
  if not found or seen<clock_timestamp()-interval '45 seconds' or seen>clock_timestamp()+interval '5 seconds'
    or s->>'schema' is distinct from 'metaengine.native-browser-supervisor.state.v1'
    or s->>'client_kind' is distinct from 'METAENGINE_BROWSER_ELECTRON_NATIVE'
    or s->'transport_identity'->>'device_id' is distinct from p_device::text
    or s->'transport_identity'->>'profile' is distinct from d.profile
    or s->'transport_identity'->>'key_fingerprint_sha256' is distinct from d.key_fingerprint_sha256
    or s->'transport_identity'->>'access_tier' is distinct from 'ADMIN'
    or (s->'transport_identity'->>'admin_grant_epoch')::bigint is distinct from p_epoch
    or (s->'transport_identity'->>'admin_ready')::boolean is distinct from true
    or s->'fleet'->>'readiness_contract' is distinct from 'TRANSPORT_PROOF_REQUIRED'
    or s->'fleet'->>'schema' is distinct from 'metaengine.browser.fleet-snapshot.v1'
    or jsonb_typeof(s->'fleet'->'agents') is distinct from 'array'
  then raise exception 'PROJECT_PARENT_DEVICE_SNAPSHOT_FENCED' using errcode='55000'; end if;
  if (select count(*) from jsonb_array_elements(s->'fleet'->'agents') v where v->>'agent_id'=c.agent_id)<>1 then raise exception 'PROJECT_PARENT_AGENT_AMBIGUOUS'; end if;
  select v into a from jsonb_array_elements(s->'fleet'->'agents') v where v->>'agent_id'=c.agent_id;
  proof:=a->'transport_proof';
  if a->>'ownership' is distinct from 'FLEET_OWNED' or a->>'lifecycle_state' is distinct from 'ACTIVE'
    or (a->>'authority_effect')::boolean is distinct from false or (a->>'automatic_retry_allowed')::boolean is distinct from false
    or a->>'tab_id' is distinct from c.tab_id or a->>'target_id' is distinct from c.target_id or a->>'role' is distinct from c.role
    or (a->>'generation_epoch')::bigint is distinct from c.agent_generation_epoch
    or proof->>'schema' is distinct from 'metaengine.browser.fleet-transport-proof.v1' or (proof->>'authority_effect')::boolean is distinct from false
    or proof->>'tab_id' is distinct from c.tab_id or proof->>'target_id' is distinct from c.target_id
    or (proof->>'generation_epoch')::bigint is distinct from c.agent_generation_epoch
    or coalesce(proof->>'conversation_url_sha256','') !~ '^[0-9a-f]{64}$'
    or coalesce(proof->>'proven_at','')=''
    or (proof->>'proven_at')::timestamptz>clock_timestamp()+interval '5 seconds'
  then raise exception 'PROJECT_PARENT_AGENT_FENCED' using errcode='55000'; end if;
  return jsonb_build_object('task',to_jsonb(t),'claim',to_jsonb(c));
end $$;

create or replace function public.h205f22_project_spawn_v1(p_workspace_id uuid,p_project_id uuid,p_parent_task_id uuid,p_claim_id bigint,p_lease_generation bigint,
  p_request_id uuid,p_children jsonb,p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta,extensions,pg_temp as $$
declare auth jsonb; r destruktion_meta.project_run_h205f22%rowtype; parent destruktion_meta.project_task_h205f22%rowtype;
  proposal destruktion_meta.project_child_proposal_h205f22%rowtype; child jsonb; idx integer:=0; digest text; capacity jsonb;
  count_children bigint; result jsonb:='[]'; spec jsonb; enqueued jsonb; id uuid; reason text; replay boolean:=true; native_child jsonb;
begin
  if p_request_id is null or jsonb_typeof(p_children) is distinct from 'array' or jsonb_array_length(p_children) not between 1 and 8 then raise exception 'PROJECT_SPAWN_REQUEST_INVALID'; end if;
  r:=destruktion_meta.project_authorize_h205f22(p_workspace_id,p_project_id,p_device_id,p_client_id,p_admin_grant_epoch);
  digest:=encode(extensions.digest(convert_to(jsonb_build_object('parent_task_id',p_parent_task_id,'children',p_children)::text,'UTF8'),'sha256'),'hex');
  if exists(select 1 from destruktion_meta.project_child_proposal_h205f22 where project_id=p_project_id and request_id=p_request_id and request_sha256<>digest)
  then raise exception 'PROJECT_SPAWN_REQUEST_COLLISION' using errcode='23505'; end if;
  if (select count(*) from destruktion_meta.project_child_proposal_h205f22 where project_id=p_project_id and request_id=p_request_id and status='ADMITTED')=jsonb_array_length(p_children) then
    select jsonb_agg(jsonb_build_object('child_index',child_index,'task_id',child_task_id,'depth',depth,'role',role,'status',status,'wait_reason',wait_reason) order by child_index) into result from destruktion_meta.project_child_proposal_h205f22 where project_id=p_project_id and request_id=p_request_id;
    return jsonb_build_object('schema','metaengine.devos.project-spawn.v1','project_id',p_project_id,'parent_task_id',p_parent_task_id,'request_id',p_request_id,'replayed',true,'children',result,'proposals_preserved',true,'leases_allocated',false,'automatic_retry_allowed',false,'scheduler_authority',false,'authority_effect',false);
  end if;
  auth:=destruktion_meta.project_parent_h205f22(p_workspace_id,p_project_id,p_parent_task_id,p_claim_id,p_lease_generation,p_device_id,p_client_id,p_admin_grant_epoch);
  select * into r from destruktion_meta.project_run_h205f22 where project_id=p_project_id for update;
  select * into parent from destruktion_meta.project_task_h205f22 where task_id=p_parent_task_id and project_id=p_project_id;
  digest:=encode(extensions.digest(convert_to(jsonb_build_object('parent_task_id',p_parent_task_id,'children',p_children)::text,'UTF8'),'sha256'),'hex');
  if exists(select 1 from destruktion_meta.project_child_proposal_h205f22 where project_id=p_project_id and request_id=p_request_id and request_sha256<>digest)
  then raise exception 'PROJECT_SPAWN_REQUEST_COLLISION' using errcode='23505'; end if;
  for child in select value from jsonb_array_elements(p_children) loop
    if jsonb_typeof(child) is distinct from 'object' or (select count(*) from jsonb_object_keys(child))<>2 or not (child ?& array['objective','role'])
      or jsonb_typeof(child->'objective') is distinct from 'string' or length(btrim(child->>'objective')) not between 1 and 4000
      or child->>'role' not in ('PLANNER','RESEARCHER','IMPLEMENTER','CRITIC','FALSIFIER','SYNTHESIZER','CODER','INTEGRATOR') then raise exception 'PROJECT_CHILD_PROPOSAL_INVALID' using errcode='22023'; end if;
    insert into destruktion_meta.project_child_proposal_h205f22(project_id,request_id,child_index,request_sha256,parent_task_id,depth,role,objective,status)
      values(p_project_id,p_request_id,idx,digest,p_parent_task_id,parent.depth+1,case child->>'role' when 'CODER' then 'IMPLEMENTER' when 'INTEGRATOR' then 'SYNTHESIZER' else child->>'role' end,btrim(child->>'objective'),'BUDGET_WAIT')
      on conflict do nothing returning * into proposal;
    if not found then select * into proposal from destruktion_meta.project_child_proposal_h205f22 where project_id=p_project_id and request_id=p_request_id and child_index=idx;
    else replay:=false; end if;
    if proposal.child_task_id is null then
      reason:=null;
      select count(*) into count_children from destruktion_meta.project_task_h205f22 where project_id=p_project_id and parent_task_id=p_parent_task_id;
      if r.max_depth is not null and proposal.depth>r.max_depth then reason:='DEPTH_BUDGET';
      elsif r.max_tasks is not null and r.total_tasks>=r.max_tasks then reason:='TASK_BUDGET';
      elsif r.max_children is not null and count_children>=r.max_children then reason:='CHILD_BUDGET'; end if;
      -- READY is logical demand for the existing fleet governor. Requiring an
      -- idle agent here would prevent the governor from seeing new role demand.
      -- Only the existing scheduler can allocate a physical lease.
      native_child:=null;
      if reason is null and auth->'task'->'task_spec' ? 'native_coding' then
        native_child:=destruktion_meta.native_coding_agent_child_permit_v1(p_parent_task_id,proposal.role);
        if native_child is null then reason:='NATIVE_CHILD_PROTECTED_CAPACITY_WAIT'; end if;
      end if;
      if reason is not null then
        update destruktion_meta.project_child_proposal_h205f22 set status=case when reason like '%BUDGET' then 'BUDGET_WAIT' else 'CAPACITY_WAIT' end,wait_reason=reason
          where project_id=p_project_id and request_id=p_request_id and child_index=idx returning * into proposal;
        perform destruktion_meta.project_append_h205f22(p_project_id,'CHILD_PROPOSAL_WAIT',p_parent_task_id,p_lease_generation,auth->'claim'->>'agent_id',null,null,null,
          jsonb_build_object('request_id',p_request_id,'child_index',idx,'role',proposal.role,'objective',proposal.objective,'reason',reason),'UNTRUSTED_PROPOSAL',null,false,'wait:'||p_request_id||':'||idx||':'||reason||':'||r.policy_generation);
      else
        spec:=jsonb_build_object('schema','metaengine.devos.project-task-spec.v1','claim_class',case when proposal.role in ('RESEARCHER','CRITIC','FALSIFIER') then 'READ_ONLY' else 'MUTATING' end,
          'objective',proposal.objective,'deliverable',coalesce(auth->'task'->'task_spec'->>'deliverable',r.goal),
          'constraints',coalesce(auth->'task'->'task_spec'->'constraints','[]'::jsonb),'source_branch',auth->'task'->>'branch_name',
          'project_continuity',jsonb_build_object('schema','metaengine.devos.project-task.v1','project_id',p_project_id,'root_task_id',r.root_task_id,'parent_task_id',p_parent_task_id,
            'depth',proposal.depth,'root_request_id',r.request_id,'spawn_request_id',p_request_id,'child_index',idx),
          'automatic_retry_allowed',false,'model_output_authority',false,'scheduler_authority',false,'authority_effect',false);
        if auth->'task'->'task_spec' ? 'native_coding' then
          if native_child is null then raise exception 'PROJECT_NATIVE_CHILD_PERMIT_REQUIRED'; end if;
          spec:=spec||jsonb_build_object('native_coding',jsonb_build_object('permit_id',native_child->>'permit_id','goal_id',native_child->>'goal_id',
            'goal_sha256',native_child->>'goal_sha256','project_id',native_child->>'project_id'));
        end if;
        enqueued:=public.devos_fleet_enqueue_v1(p_workspace_id,'project.'||replace(p_project_id::text,'-','')||'.'||replace(p_request_id::text,'-','')||'.'||idx,proposal.role,
          auth->'task'->>'base_sha',spec,'project-child:'||p_project_id||':'||p_request_id||':'||idx,
          'work/project-'||replace(p_project_id::text,'-','')||'-'||replace(p_request_id::text,'-','')||'-'||idx,50);
        if (enqueued->>'accepted')::boolean is distinct from true then raise exception 'PROJECT_CHILD_ENQUEUE_REJECTED'; end if;
        id:=(enqueued->>'task_id')::uuid;
        update destruktion_meta.project_run_h205f22 set total_tasks=total_tasks+1 where project_id=p_project_id returning * into r;
        insert into destruktion_meta.project_task_h205f22 values(id,p_project_id,r.total_tasks,r.root_task_id,p_parent_task_id,proposal.depth);
        update destruktion_meta.project_child_proposal_h205f22 set child_task_id=id,status='ADMITTED',wait_reason=null where project_id=p_project_id and request_id=p_request_id and child_index=idx returning * into proposal;
        perform destruktion_meta.project_append_h205f22(p_project_id,'CHILD_TASK_ADMITTED',id,0,auth->'claim'->>'agent_id',null,null,null,
          jsonb_build_object('request_id',p_request_id,'child_index',idx,'parent_task_id',p_parent_task_id,'depth',proposal.depth,'role',proposal.role,'objective',proposal.objective),'DATABASE_ADMISSION',null,false,'child:'||p_request_id||':'||idx);
      end if;
    end if;
    result:=result||jsonb_build_array(jsonb_build_object('child_index',idx,'task_id',proposal.child_task_id,'depth',proposal.depth,'role',proposal.role,'status',proposal.status,'wait_reason',proposal.wait_reason));
    idx:=idx+1;
  end loop;
  return jsonb_build_object('schema','metaengine.devos.project-spawn.v1','project_id',p_project_id,'parent_task_id',p_parent_task_id,'request_id',p_request_id,'replayed',replay,
    'children',result,'proposals_preserved',true,'leases_allocated',false,'automatic_retry_allowed',false,'scheduler_authority',false,'authority_effect',false);
end $$;
