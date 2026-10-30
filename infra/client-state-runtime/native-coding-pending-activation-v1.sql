-- Existing functions must be exact reviewed bodies, not presence-only markers.
do $review$
declare f record;
begin
 select p.*,l.lanname into f from pg_proc p join pg_language l on l.oid=p.prolang
 where p.oid=to_regprocedure('destruktion_meta.native_coding_activate_pending_goal_v1(jsonb,text,jsonb,text,text)');
 if not found then
  if exists(select 1 from destruktion_meta.native_coding_pending_activation_h205f22) then raise exception 'native_pending_activation_partial_install';end if;
  return;
 end if;
 if f.proowner<>to_regrole('state_owner') or f.prorettype<>to_regtype('jsonb') or f.prokind<>'f' or f.proisstrict or f.proleakproof or f.proparallel<>'u'
  or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) acl where acl.grantee<>f.proowner)
  or f.prosecdef is distinct from false or f.provolatile<>'v' or f.lanname<>'plpgsql'
  or f.proconfig is distinct from ARRAY['search_path=pg_catalog, public, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(f.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex')<>'15a34f3888a60027d1e0433ba90560ee15268f2e05a4c341fa8d2f51289603c7'
 then raise exception 'native_pending_activation_function_requires_review';end if;
end $review$;
-- Private same-project/root transition. Host must verify fresh native custody
-- under the same reserved transaction before calling this state_owner-only function.
create or replace function destruktion_meta.native_coding_activate_pending_goal_v1(p_input jsonb,p_sealed_owner_sha256 text,
 p_observation jsonb,p_canonical_observation text,p_observation_sha256 text)
returns jsonb language plpgsql set search_path=pg_catalog,public,destruktion_meta as $$
declare p_profile uuid:=(p_input->>'profile_id')::uuid;p_request uuid:=(p_input->>'request_id')::uuid;p_objective text:=p_input->>'objective';
 pending destruktion_meta.native_coding_pending_goal_h205f22;activated destruktion_meta.native_coding_pending_activation_h205f22;
 activation uuid:=(p_input->>'activation_id')::uuid;activation_receipt jsonb;cfg jsonb;p jsonb;a jsonb;actual jsonb;primary_agent jsonb;
 project uuid;goalid uuid;permitid uuid;root_task uuid;body jsonb;bodysha text;goal jsonb;goalsha text;profile_sha text;
 spec jsonb;enqueued jsonb;permit jsonb;permitids jsonb:='[]';stamp text;receipt jsonb;control jsonb;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_coding_seed_state_owner_required' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'serializable' or current_setting('synchronous_commit')<>'on'
 then raise exception 'native_coding_seed_durable_transaction_required' using errcode='25000';end if;
 if p_request is null or p_profile is null or p_objective is null or p_objective<>btrim(p_objective) or char_length(p_objective) not between 1 and 480
  or octet_length(p_objective)>1920 then raise exception 'native_coding_seed_request_invalid' using errcode='22023';end if;
 -- Same lock key as public goal submission: a UUID cannot name two goal kinds.
 perform pg_advisory_xact_lock(hashtextextended('client-v1-goal:'||p_request::text,0));
 if jsonb_typeof(p_input) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_input))<>7
  or not p_input ?& array['preparation_id','configuration_sha256','request_id','objective','activation_id','profile_id','profile_sha256']
  or activation is null or p_sealed_owner_sha256 is null or p_sealed_owner_sha256 !~ '^[a-f0-9]{64}$'
 then raise exception 'native_pending_activation_input_invalid' using errcode='22023';end if;
 select * into activated from destruktion_meta.native_coding_pending_activation_h205f22 where request_id=p_request or activation_id=activation;
 -- A write is never resumed, including a previous committed identical request.
 if found then raise exception 'native_pending_activation_readback_required' using errcode='55000';end if;
 select * into pending from destruktion_meta.native_coding_pending_goal_h205f22 where request_id=p_request for update;
 if not found or pending.input is distinct from (p_input-'activation_id'-'profile_id'-'profile_sha256')
 then raise exception 'native_pending_activation_pending_required' using errcode='55000';end if;
 perform destruktion_meta.native_coding_pending_goal_v1(pending.input,pending.configuration,pending.preparation,false);
 perform 1 from destruktion_meta.project_run_h205f22 where project_id=pending.project_id for update;
 perform 1 from destruktion_meta.devos_fleet_task_h205f22 where task_id=pending.root_task_id for update;
 if exists(select 1 from destruktion_meta.native_coding_seed_h205f22 where request_id=p_request)
  or exists(select 1 from destruktion_meta.client_v1_goal_request_h205f22 where request_id=p_request)
 then raise exception 'native_pending_activation_request_collision' using errcode='23505';end if;
 cfg:=destruktion_meta.native_coding_seed_profile_v1(p_profile,true);p:=cfg->'profile';profile_sha:=cfg->>'profile_sha256';
 body:=jsonb_build_object('request_id',p_request,'objective',p_objective);bodysha:=encode(extensions.digest(convert_to(body::text,'UTF8'),'sha256'),'hex');
 if p->>'schema' is distinct from 'metaengine.native-coding.seed-profile.v2' or p->>'coordination_mode' is distinct from 'CHAT_LED'
  or profile_sha is distinct from p_input->>'profile_sha256' or p->>'workspace_id' is distinct from pending.workspace_id::text
  or p->>'device_id' is distinct from pending.preparation->>'device_id' or p->>'client_id' is distinct from pending.preparation->>'client_id'
  or p->>'admin_grant_epoch' is distinct from pending.preparation->>'preparation_grant_epoch'
  or p->>'owner_epoch' is distinct from p->>'admin_grant_epoch'
  or p->>'device_key_fingerprint_sha256' is distinct from pending.preparation->>'device_key_fingerprint_sha256'
  or p->'artifact' is distinct from pending.configuration->'artifact' or p->'postgres' is distinct from pending.configuration->'postgres'
  or p->'agents' is distinct from pending.configuration->'agents' or p->>'user_sid' is distinct from pending.configuration->>'user_sid'
  or p->>'expires_at' is distinct from pending.configuration->>'expires_at'
 then raise exception 'native_pending_activation_profile_scope_changed' using errcode='23514';end if;
 -- Serialize publication for this explicit profile; retained history has no
 -- lifetime count limit. It does not reserve a physical W30 slot/root.
 perform 1 from destruktion_meta.native_coding_seed_profile_h205f22 where profile_id=p_profile for share;
 control:=public.devos_environment_state_v1((p->>'workspace_id')::uuid);
 if control->'refill_enabled' is distinct from 'true'::jsonb or control->'supervisor_admission_enabled' is distinct from 'true'::jsonb
  or control->'owner_stop'='true'::jsonb or control->>'state'='STOPPED'
 then raise exception 'native_coding_seed_environment_fenced' using errcode='55000';end if;
 if coalesce(p_canonical_observation::jsonb is distinct from p_observation
  or encode(extensions.digest(convert_to(p_canonical_observation,'UTF8'),'sha256'),'hex') is distinct from p_observation_sha256
  or jsonb_typeof(p_observation)<>'object' or (select count(*) from jsonb_object_keys(p_observation))<>13
  or not p_observation ?& array['schema','profile_id','profile_sha256','observed_at','host_process','user_sid','artifact','postgres','agents','production_qualified','automatic_retry_allowed','authority_effect','installed_execution_proven']
  or p_observation->>'schema' is distinct from 'metaengine.native-coding.seed-observation.v1'
  or p_observation->>'profile_id' is distinct from p_profile::text or p_observation->>'profile_sha256' is distinct from profile_sha
  or p_observation->'production_qualified' is distinct from 'false'::jsonb or p_observation->'automatic_retry_allowed' is distinct from 'false'::jsonb
  or p_observation->'authority_effect' is distinct from 'false'::jsonb or p_observation->'installed_execution_proven' is distinct from 'false'::jsonb
  or (p_observation->>'observed_at')::timestamptz not between clock_timestamp()-interval '30 seconds' and clock_timestamp()+interval '5 seconds'
  or p_observation->'artifact' is distinct from p->'artifact' or p_observation->'postgres' is distinct from p->'postgres'
  or p_observation->>'user_sid' is distinct from p->>'user_sid' or jsonb_typeof(p_observation->'agents')<>'array'
  or jsonb_array_length(p_observation->'agents')<>jsonb_array_length(p->'agents')
  or coalesce(p_observation#>>'{host_process,process_incarnation_id}','')!~ '^pid:[1-9][0-9]*:created_100ns:[1-9][0-9]*$'
  or (p_observation#>>'{host_process,created_at}')::timestamptz>(p_observation->>'observed_at')::timestamptz,true)
 then raise exception 'native_coding_seed_physical_scope_changed' using errcode='23514';end if;
 for a in select value from jsonb_array_elements(p->'agents') loop
  select x.value into actual from jsonb_array_elements(p_observation->'agents') x where x.value->>'provider_id'=a->>'provider_id';
  if actual is distinct from jsonb_build_object('provider_id',a->>'provider_id','worktree',a->'worktree','sandbox',a->'sandbox')
   or (select count(*) from jsonb_array_elements(p_observation->'agents') x where x.value->>'provider_id'=a->>'provider_id')<>1
  then raise exception 'native_coding_seed_agent_scope_changed' using errcode='23514';end if;
  if exists(select 1 from destruktion_meta.native_coding_operator_permit_h205f22 oldp where oldp.workspace_id=(p->>'workspace_id')::uuid
    and oldp.provider_id=(a->>'provider_id')::uuid and oldp.agent_id=a->>'agent_id' and oldp.revoked_at is null)
  then raise exception 'native_coding_seed_profile_in_use' using errcode='55000';end if;
 end loop;
 project:=pending.project_id;root_task:=pending.root_task_id;
 goalid:=destruktion_meta.native_coding_seed_uuid_v1('native-seed-goal:'||p_profile||':'||p_request);
 goal:=jsonb_build_object('schema','metaengine.native-coding.goal.v1','goal_id',goalid,'request_id',p_request,
  'workspace_id',p->>'workspace_id','project_id',project,'profile_id',p_profile,'profile_sha256',profile_sha,'objective',p_objective);
 goalsha:=encode(extensions.digest(convert_to(goal::text,'UTF8'),'sha256'),'hex');
 stamp:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 for a in select value from jsonb_array_elements(p->'agents') loop
  permitid:=destruktion_meta.native_coding_seed_uuid_v1('native-seed-permit:'||p_profile||':'||p_request||':'||(a->>'provider_id'));
  permit:=jsonb_build_object('schema','metaengine.native-coding.operator-permit.v1','trust_namespace','LOCAL_OPERATOR_QA',
   'permit_id',permitid,'goal_id',goalid,'goal_sha256',goalsha,'owner_epoch',p->'owner_epoch','user_sid',p->'user_sid',
   'device_id',p->'device_id','device_key_fingerprint_sha256',p->'device_key_fingerprint_sha256','workspace_id',p->'workspace_id','project_id',project,
   'provider_id',a->'provider_id','agent_id',a->'agent_id','role',a->'role','agent_generation_epoch',a->'agent_generation_epoch',
   'physical_slot_budget',p->'physical_slot_budget','artifact',p->'artifact','postgres',p->'postgres','worktree',a->'worktree',
   'issued_at',stamp,'expires_at',p->'expires_at','revoked',false,'storage_evidence_sha256',p->'storage_evidence_sha256');
  permit:=permit||jsonb_build_object('record_sha256',encode(extensions.digest(convert_to(permit::text,'UTF8'),'sha256'),'hex'));
  insert into destruktion_meta.native_coding_operator_permit_h205f22
   (permit_id,workspace_id,client_id,device_id,admin_grant_epoch,provider_id,agent_id,agent_generation_epoch,permit,operator_record_sha256)
  values(permitid,(p->>'workspace_id')::uuid,p->>'client_id',(p->>'device_id')::uuid,(p->>'admin_grant_epoch')::bigint,
   (a->>'provider_id')::uuid,a->>'agent_id',(a->>'agent_generation_epoch')::bigint,permit,permit->>'record_sha256');
  permitids:=permitids||jsonb_build_array(permitid);
  if a->>'provider_id'=p->>'primary_provider_id' then primary_agent:=a;end if;
 end loop;
 spec:=jsonb_build_object('schema','metaengine.devos.project-task-spec.v1','objective',p_objective,'claim_class','READ_ONLY',
  'native_goal',jsonb_build_object('schema','metaengine.native-coding.goal-binding.v1','request_id',p_request,'profile_id',p_profile,
   'profile_sha256',profile_sha,'goal_sha256',goalsha),'automatic_retry_allowed',false,'authority_effect',false,
  'project_continuity',jsonb_build_object('schema','metaengine.devos.project-task.v1','project_id',project,'parent_task_id',null,'depth',0,'root_request_id',p_request),
  'coordination_mode','CHAT_LED');
 if primary_agent#>>'{worktree,base_sha}' is distinct from pending.configuration#>>'{agents,0,worktree,base_sha}'
 then raise exception 'native_pending_activation_root_base_changed' using errcode='23514';end if;
 enqueued:=jsonb_build_object('task_spec_sha256',encode(extensions.digest(convert_to(spec::text,'UTF8'),'sha256'),'hex'));
 receipt:=jsonb_build_object('schema','metaengine.native-coding.goal-admission.v1','state','ADMITTED','request_id',p_request,'profile_id',p_profile,
  'profile_sha256',profile_sha,'workspace_id',p->>'workspace_id','project_id',project,'root_task_id',root_task,'goal_id',goalid,'goal_sha256',goalsha,
  'objective',p_objective,'task_spec_sha256',enqueued->>'task_spec_sha256','permit_ids',permitids,'logical_policy',p->'policy',
  'physical_execution_proven',false,'global_actuation_granted',false,'production_qualified',false,'automatic_retry_allowed',false,'authority_effect',false);
 activation_receipt:=jsonb_build_object('schema','metaengine.native-coding.pending-activation-receipt.v1','state','ACTIVATED',
  'input',p_input,'workspace_id',pending.workspace_id,'project_id',project,'root_task_id',root_task,
  'profile_id',p_profile,'profile_sha256',profile_sha,'task_spec_sha256',enqueued->>'task_spec_sha256',
  'root_state','READY','project_state','ACTIVE','permit_ids',permitids,'loaded_runtime_code_attested',false,
  'production_qualified',false,'automatic_retry_allowed',false,'authority_effect',false);
 insert into destruktion_meta.native_coding_pending_activation_h205f22
  (activation_id,request_id,input,profile_id,profile_sha256,workspace_id,project_id,root_task_id,initial_task_spec_sha256,
   task_spec,task_spec_sha256,branch_name,policy,sealed_owner_sha256,seed_receipt,receipt)
 values(activation,p_request,p_input,p_profile,profile_sha,pending.workspace_id,project,root_task,pending.receipt->>'task_spec_sha256',
  spec,enqueued->>'task_spec_sha256',p->>'branch_name',p->'policy',p_sealed_owner_sha256,receipt,activation_receipt);
 insert into destruktion_meta.native_coding_seed_h205f22(request_id,profile_id,profile_sha256,objective,body,body_sha256,goal_id,goal,canonical_goal,goal_sha256,
  workspace_id,project_id,root_task_id,task_spec_sha256,permit_ids,observation,canonical_observation,observation_sha256,receipt,canonical_receipt,receipt_sha256)
 values(p_request,p_profile,profile_sha,p_objective,body,bodysha,goalid,goal,goal::text,goalsha,(p->>'workspace_id')::uuid,project,root_task,
  enqueued->>'task_spec_sha256',permitids,p_observation,p_canonical_observation,p_observation_sha256,receipt,receipt::text,
  encode(extensions.digest(convert_to(receipt::text,'UTF8'),'sha256'),'hex'));
 -- Project first: root retains its pending marker while its exact new policy
 -- and ACTIVE state are checked by the immutable activation ledger guard.
 update destruktion_meta.project_run_h205f22 set state='ACTIVE',max_depth=(p#>>'{policy,max_depth}')::int,
  max_tasks=(p#>>'{policy,max_tasks}')::bigint,max_children=(p#>>'{policy,max_children}')::bigint where project_id=project;
 update destruktion_meta.devos_fleet_task_h205f22 set state='READY',task_spec=spec,
  task_spec_sha256=enqueued->>'task_spec_sha256',branch_name=p->>'branch_name' where task_id=root_task;
 perform destruktion_meta.project_append_h205f22(project,'NATIVE_GOAL_ACTIVATED',root_task,0,p->>'client_id',null,null,null,
  activation_receipt,'PRIVATE_NATIVE_PENDING_ACTIVATION',null,false,'activate:'||activation);
 return activation_receipt;
end $$;

revoke all on function destruktion_meta.native_coding_activate_pending_goal_v1(jsonb,text,jsonb,text,text) from public,anon,authenticated,service_role;
