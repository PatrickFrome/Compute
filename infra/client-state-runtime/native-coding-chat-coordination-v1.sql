-- Additive local upgrade: protected chat-led coordination; no new scheduler.
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
  where f.oid=to_regprocedure('destruktion_meta.native_coding_seed_profile_v1(uuid,boolean)');

 if p.prosrc is null or p.lanname<>'plpgsql' or p.prosecdef is distinct from false or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, public, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in('c15e950cb8a1940c9e9af177d7a1dcf0a374a67fc61c7fca5984db43fad5ca77','6fd143ff425a752a7e5740c635f144d8249253e1922f915ab62e0ca9fa841dc7')
 then raise exception 'chat_coordination_native_coding_seed_profile_v1_requires_review' using errcode='55000';end if;
end $review$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
  where f.oid=to_regprocedure('destruktion_meta.native_coding_seed_goal_v1(uuid,uuid,text,jsonb,text,text)');

 if p.prosrc is null or p.lanname<>'plpgsql' or p.prosecdef is distinct from false or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, public, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in('685e6ace87c3c6c5be4f39a8dd126b5e0a736f36f3411407473e998bb3ccac69','0eddf8152a23399d83d0b644dc2664b360bcc22f7483b1e591baa8b8e282d38d')
 then raise exception 'chat_coordination_native_coding_seed_goal_v1_requires_review' using errcode='55000';end if;
end $review$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
  where f.oid=to_regprocedure('public.h205f22_project_spawn_v1(uuid,uuid,uuid,bigint,bigint,uuid,jsonb,uuid,text,bigint)');

 if p.prosrc is null or p.lanname<>'plpgsql' or p.prosecdef is distinct from true or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, public, destruktion_meta, extensions, pg_temp']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in('e27692ba2e072efb57a1f1979d7f5aafb90dd2e280cb85ce95984aaefc6f9e09','1df8d8ecf85c001cd9ddbad5343c7a1325b15d9db9284b6aea52b31c62dc1007')
 then raise exception 'chat_coordination_h205f22_project_spawn_v1_requires_review' using errcode='55000';end if;
end $review$;
do $review$
declare p record;
begin
 select f.prosrc,f.prosecdef,f.proconfig,f.provolatile,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
  where f.oid=to_regprocedure('destruktion_meta.native_coding_chat_child_permit_v1(uuid,uuid,text)');
 if p.prosrc is null then return;end if;
 if p.prosrc is null or p.lanname<>'plpgsql' or p.prosecdef is distinct from false or p.provolatile<>'v'
  or p.proconfig is distinct from ARRAY['search_path=pg_catalog, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') not in('5627788a3f09873f3ecd4fbd1cd04261a969af8e024d7a501e93a312d52c7499')
 then raise exception 'chat_coordination_native_coding_chat_child_permit_v1_requires_review' using errcode='55000';end if;
end $review$;
create temporary table metaengine_chat_profile_reference (like destruktion_meta.native_coding_seed_profile_h205f22) on commit drop;
alter table metaengine_chat_profile_reference add constraint prior_scope check(profile->>'schema'='metaengine.native-coding.seed-profile.v1' and profile->>'profile_id'=profile_id::text
 and profile->>'trust_namespace'='LOCAL_OPERATOR_QA' and profile->'production_qualified'='false'::jsonb
 and profile->'authority_effect'='false'::jsonb and profile->'automatic_retry_allowed'='false'::jsonb);
alter table metaengine_chat_profile_reference add constraint current_scope check((profile->>'schema'='metaengine.native-coding.seed-profile.v1'
 or (profile->>'schema'='metaengine.native-coding.seed-profile.v2' and profile->>'coordination_mode'='CHAT_LED'))
 and profile->>'profile_id'=profile_id::text and profile->>'trust_namespace'='LOCAL_OPERATOR_QA'
 and profile->'production_qualified'='false'::jsonb and profile->'authority_effect'='false'::jsonb and profile->'automatic_retry_allowed'='false'::jsonb);
do $upgrade$
declare old_expr text;new_expr text;actual text;constraint_name text;n integer;
begin
 select pg_get_expr(conbin,conrelid) into old_expr from pg_constraint where conrelid='pg_temp.metaengine_chat_profile_reference'::regclass and conname='prior_scope';
 select pg_get_expr(conbin,conrelid) into new_expr from pg_constraint where conrelid='pg_temp.metaengine_chat_profile_reference'::regclass and conname='current_scope';
 select count(*) into n from pg_constraint where conrelid='destruktion_meta.native_coding_seed_profile_h205f22'::regclass and contype='c' and pg_get_expr(conbin,conrelid) like '%seed-profile.v%';
 if n<>1 then raise exception 'chat_profile_constraint_requires_review';end if;
 select conname,pg_get_expr(conbin,conrelid) into constraint_name,actual from pg_constraint where conrelid='destruktion_meta.native_coding_seed_profile_h205f22'::regclass and contype='c' and pg_get_expr(conbin,conrelid) like '%seed-profile.v%';
 if actual not in(old_expr,new_expr) then raise exception 'chat_profile_constraint_requires_review';end if;
 if actual=old_expr then
  execute format('alter table destruktion_meta.native_coding_seed_profile_h205f22 drop constraint %I',constraint_name);
  alter table destruktion_meta.native_coding_seed_profile_h205f22 add constraint native_coding_chat_profile_scope_v1 check((profile->>'schema'='metaengine.native-coding.seed-profile.v1'
   or (profile->>'schema'='metaengine.native-coding.seed-profile.v2' and profile->>'coordination_mode'='CHAT_LED'))
   and profile->>'profile_id'=profile_id::text and profile->>'trust_namespace'='LOCAL_OPERATOR_QA'
   and profile->'production_qualified'='false'::jsonb and profile->'authority_effect'='false'::jsonb and profile->'automatic_retry_allowed'='false'::jsonb);
 end if;
end $upgrade$;

-- Caller must already hold the project's row lock and authenticate its browser
-- parent through project_parent_h205f22. This private helper allocates no lease.
create or replace function destruktion_meta.native_coding_chat_child_permit_v1(p_project uuid,p_task uuid,p_role text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,destruktion_meta as $$
declare seed destruktion_meta.native_coding_seed_h205f22; profile destruktion_meta.native_coding_seed_profile_h205f22;
 t destruktion_meta.devos_fleet_task_h205f22; child jsonb;
begin
 if p_role is distinct from 'IMPLEMENTER' then return null;end if;
 select * into seed from destruktion_meta.native_coding_seed_h205f22 where project_id=p_project;
 select * into profile from destruktion_meta.native_coding_seed_profile_h205f22 where profile_id=seed.profile_id;
 select t0.* into t from destruktion_meta.devos_fleet_task_h205f22 t0
  join destruktion_meta.project_task_h205f22 pt using(task_id) where pt.project_id=p_project and t0.task_id=p_task;
 if seed.request_id is null or profile.profile_id is null or t.task_id is null
  or profile.profile_sha256 is distinct from seed.profile_sha256 or profile.revoked_at is not null
  or profile.profile->>'schema' is distinct from 'metaengine.native-coding.seed-profile.v2'
  or profile.profile->>'coordination_mode' is distinct from 'CHAT_LED'
  or (profile.profile->>'expires_at')::timestamptz<=clock_timestamp()
  or t.workspace_id is distinct from seed.workspace_id or t.task_spec ? 'native_coding'
 then return null;end if;
 with recursive permitted(permit_id) as (
  select value::uuid from jsonb_array_elements_text(seed.permit_ids)
  union
  select commit.next_writer_permit_id from permitted prior
   join destruktion_meta.devos_fleet_task_h205f22 writer on writer.task_spec#>>'{native_coding,permit_id}'=prior.permit_id::text
   join destruktion_meta.native_coding_checkpoint_h205f22 checkpoint on checkpoint.writer_task_id=writer.task_id and checkpoint.project_id=p_project
   join destruktion_meta.native_coding_commit_h205f22 commit on commit.checkpoint_id=checkpoint.checkpoint_id and commit.project_id=p_project
 )
 select p.permit into child from destruktion_meta.native_coding_operator_permit_h205f22 p
 where p.workspace_id=seed.workspace_id and p.client_id=profile.profile->>'client_id'
  and p.device_id=(profile.profile->>'device_id')::uuid and p.admin_grant_epoch=(profile.profile->>'admin_grant_epoch')::bigint
  and p.permit_id in(select permit_id from permitted)
  and p.revoked_at is null and (p.permit->>'expires_at')::timestamptz>clock_timestamp()
  and p.permit->>'role'='IMPLEMENTER' and p.permit->>'project_id'=p_project::text
  and p.permit->>'goal_id'=seed.goal_id::text and p.permit->>'goal_sha256'=seed.goal_sha256
  and p.permit->'artifact'=profile.profile->'artifact' and p.permit->'postgres'=profile.profile->'postgres'
  and p.permit->>'owner_epoch'=profile.profile->>'owner_epoch' and p.permit->>'user_sid'=profile.profile->>'user_sid'
  and not exists(select 1 from destruktion_meta.native_coding_worktree_fence_h205f22 fence
   where fence.root_identity_sha256=p.permit#>>'{worktree,root_identity_sha256}')
  and not exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 queued
   where queued.workspace_id=p.workspace_id and queued.task_spec#>>'{native_coding,permit_id}'=p.permit_id::text
    and queued.state in ('READY','LEASED','RUNNING','RESULT_READY'))
 order by p.permit_id limit 1;
 return child;
end $$;
revoke all on function destruktion_meta.native_coding_chat_child_permit_v1(uuid,uuid,text) from public,anon,authenticated,service_role;

-- Explicit protected v2 profiles select chat-led coordination. Legacy v1 remains CLI-led.
create or replace function destruktion_meta.native_coding_seed_profile_v1(p_profile uuid,p_require_active boolean default true)
returns jsonb language plpgsql set search_path=pg_catalog,public,destruktion_meta as $$
declare r destruktion_meta.native_coding_seed_profile_h205f22;v jsonb;d public.compute_fabric_a2_browser_device_h205f22;
 a jsonb;b jsonb;keys text[];seen text[]:=array[]::text[];providers text[]:=array[]::text[];root text;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_coding_seed_state_owner_required' using errcode='42501';end if;
 select * into r from destruktion_meta.native_coding_seed_profile_h205f22 where profile_id=p_profile;
 if not found or (p_require_active and (r.revoked_at is not null or (r.profile->>'expires_at')::timestamptz<=clock_timestamp()))
 then raise exception 'native_coding_seed_profile_unavailable' using errcode='55000';end if;
 v:=r.profile;
 keys:=array['schema','trust_namespace','profile_id','workspace_id','device_id','client_id','admin_grant_epoch','device_key_fingerprint_sha256',
  'owner_epoch','user_sid','artifact','postgres','agents','primary_provider_id','physical_slot_budget','expires_at','storage_evidence_sha256','branch_name','policy',
  'production_qualified','automatic_retry_allowed','authority_effect'];
 if v->>'schema'='metaengine.native-coding.seed-profile.v2' then keys:=keys||array['coordination_mode'];end if;
 if coalesce(jsonb_typeof(v)<>'object' or (select count(*) from jsonb_object_keys(v))<>cardinality(keys) or not v ?& keys
  or v->>'schema' not in ('metaengine.native-coding.seed-profile.v1','metaengine.native-coding.seed-profile.v2')
  or (v->>'schema'='metaengine.native-coding.seed-profile.v2' and v->>'coordination_mode' is distinct from 'CHAT_LED') or v->>'profile_id'<>p_profile::text
  or v->>'trust_namespace'<>'LOCAL_OPERATOR_QA' or v->'production_qualified' is distinct from 'false'::jsonb
  or v->'automatic_retry_allowed' is distinct from 'false'::jsonb or v->'authority_effect' is distinct from 'false'::jsonb
  or coalesce(v->>'user_sid','')!~ '^S-1-[0-9]+(-[0-9]+){1,15}$' or coalesce(v->>'storage_evidence_sha256','')!~ '^[a-f0-9]{64}$'
  or (v->>'owner_epoch')::bigint<1 or (v->>'admin_grant_epoch')::bigint<1
  or (v->>'physical_slot_budget')::bigint<1 or (v->>'expires_at')::timestamptz is null
  or coalesce(v->>'branch_name','')!~ '^[A-Za-z0-9][A-Za-z0-9/_.-]{1,190}$' or v->>'branch_name' like '%..%' or v->>'branch_name' like '%//%'
  or jsonb_typeof(v->'agents')<>'array' or jsonb_array_length(v->'agents')<2
  or jsonb_typeof(v->'artifact')<>'object' or jsonb_typeof(v->'postgres')<>'object' or jsonb_typeof(v->'policy')<>'object',true)
 then raise exception 'native_coding_seed_profile_invalid' using errcode='23514';end if;
 keys:=array['installed_exe_sha256','installed_asar_sha256','runtime_bundle_sha256','source_sha','cli_executable_sha256'];
 if coalesce(not v->'artifact' ?& keys or (select count(*) from jsonb_object_keys(v->'artifact'))<>5
  or exists(select 1 from jsonb_each_text(v->'artifact') x where x.value !~ case when x.key='source_sha' then '^[a-f0-9]{40}$' else '^[a-f0-9]{64}$' end)
  or v#>>'{postgres,system_identifier}' is distinct from (select system_identifier::text from pg_control_system())
  or coalesce(v#>>'{postgres,data_directory_identity_sha256}','')!~ '^[a-f0-9]{64}$'
  or not v->'policy' ?& array['max_depth','max_tasks','max_children'] or (select count(*) from jsonb_object_keys(v->'policy'))<>3
  or exists(select 1 from jsonb_each(v->'policy') x where x.value<>'null'::jsonb and (jsonb_typeof(x.value)<>'number' or x.value::text!~ '^[0-9]+$'
    or x.value::text::bigint<case when x.key='max_depth' then 0 else 1 end)),true)
 then raise exception 'native_coding_seed_profile_scope_invalid' using errcode='23514';end if;
 perform destruktion_meta.project_device_grant_h205f22((v->>'device_id')::uuid,v->>'client_id',(v->>'admin_grant_epoch')::bigint);
 select * into d from public.compute_fabric_a2_browser_device_h205f22 where device_id=(v->>'device_id')::uuid and client_id=v->>'client_id';
 if d.profile is distinct from 'A2_DEVICE_HTTP_SIGNATURE_V1' or d.key_fingerprint_sha256 is distinct from v->>'device_key_fingerprint_sha256'
 then raise exception 'native_coding_seed_device_changed' using errcode='42501';end if;
 for a in select value from jsonb_array_elements(v->'agents') loop
  keys:=array['provider_id','agent_id','role','agent_generation_epoch','worktree','sandbox'];
  if coalesce(jsonb_typeof(a)<>'object' or not a ?& keys or (select count(*) from jsonb_object_keys(a))<>6
   or coalesce(a->>'provider_id','')!~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
   or coalesce(a->>'agent_id','')!~ '^agent_[a-z0-9-]{8,64}$' or a->>'role' not in('IMPLEMENTER','CRITIC')
   or (a->>'agent_generation_epoch')::bigint<1 or a->>'agent_id'=any(seen) or a->>'provider_id'=any(providers)
   or jsonb_typeof(a->'worktree')<>'object' or not a->'worktree' ?& array['path','root_identity_sha256','base_sha']
   or (select count(*) from jsonb_object_keys(a->'worktree'))<>3 or coalesce(a#>>'{worktree,path}','')!~ '^[A-Za-z]:\\'
   or coalesce(a#>>'{worktree,root_identity_sha256}','')!~ '^[a-f0-9]{64}$' or coalesce(a#>>'{worktree,base_sha}','')!~ '^[a-f0-9]{40}$'
   or jsonb_typeof(a->'sandbox')<>'object' or not a->'sandbox' ?& array['backend','mode','evidence_sha256','outside_write_denied','worktree_write_denied']
   or (select count(*) from jsonb_object_keys(a->'sandbox'))<>5 or a#>>'{sandbox,backend}' not in('CODEX_WINDOWS_ELEVATED','WINDOWS_RESTRICTED_TOKEN','WINDOWS_APPCONTAINER')
   or a#>>'{sandbox,mode}' is distinct from case when a->>'role'='CRITIC' then 'read-only' else 'workspace-write' end
   or a#>'{sandbox,outside_write_denied}' is distinct from 'true'::jsonb
   or a#>'{sandbox,worktree_write_denied}' is distinct from to_jsonb(a->>'role'='CRITIC')
   or coalesce(a#>>'{sandbox,evidence_sha256}','')!~ '^[a-f0-9]{64}$',true)
  then raise exception 'native_coding_seed_agent_invalid' using errcode='23514';end if;
  seen:=array_append(seen,a->>'agent_id');providers:=array_append(providers,a->>'provider_id');
  root:=a#>>'{worktree,root_identity_sha256}';
  if not exists(select 1 from jsonb_array_elements(v->'agents') x where x.value->>'role'='IMPLEMENTER' and x.value->'worktree'=a->'worktree')
    or not exists(select 1 from jsonb_array_elements(v->'agents') x where x.value->>'role'='CRITIC' and x.value->'worktree'=a->'worktree')
    or exists(select 1 from jsonb_array_elements(v->'agents') x where x.value#>>'{worktree,root_identity_sha256}'=root and x.value->'worktree'<>a->'worktree')
  then raise exception 'native_coding_seed_independent_pair_required' using errcode='23514';end if;
 end loop;
 if not exists(select 1 from jsonb_array_elements(v->'agents') x where x.value->>'provider_id'=v->>'primary_provider_id' and x.value->>'role'='IMPLEMENTER')
 then raise exception 'native_coding_seed_primary_writer_required' using errcode='23514';end if;
 return jsonb_build_object('schema','metaengine.native-coding.seed-profile-readback.v1','profile',v,'canonical_profile',r.canonical_profile,
  'profile_sha256',r.profile_sha256,'revoked_at',r.revoked_at,'authority_effect',false);
end $$;

create or replace function destruktion_meta.native_coding_seed_goal_v1(p_profile uuid,p_request uuid,p_objective text,
 p_observation jsonb,p_canonical_observation text,p_observation_sha256 text)
returns jsonb language plpgsql set search_path=pg_catalog,public,destruktion_meta as $$
declare cfg jsonb;p jsonb;a jsonb;actual jsonb;primary_agent jsonb;r destruktion_meta.native_coding_seed_h205f22;
 project uuid;goalid uuid;permitid uuid;root_task uuid;body jsonb;bodysha text;goal jsonb;goalsha text;profile_sha text;
 spec jsonb;enqueued jsonb;permit jsonb;permitids jsonb:='[]';primary_permit uuid;stamp text;receipt jsonb;control jsonb;point text;chat_led boolean;root_role text;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_coding_seed_state_owner_required' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'serializable' or current_setting('synchronous_commit')<>'on'
 then raise exception 'native_coding_seed_durable_transaction_required' using errcode='25000';end if;
 if p_request is null or p_profile is null or p_objective is null or p_objective<>btrim(p_objective) or char_length(p_objective) not between 1 and 480
  or octet_length(p_objective)>1920 then raise exception 'native_coding_seed_request_invalid' using errcode='22023';end if;
 -- Same lock key as public goal submission: a UUID cannot name two goal kinds.
 perform pg_advisory_xact_lock(hashtextextended('client-v1-goal:'||p_request::text,0));
 cfg:=destruktion_meta.native_coding_seed_profile_v1(p_profile,false);p:=cfg->'profile';profile_sha:=cfg->>'profile_sha256';
 body:=jsonb_build_object('request_id',p_request,'objective',p_objective);bodysha:=encode(extensions.digest(convert_to(body::text,'UTF8'),'sha256'),'hex');
 select * into r from destruktion_meta.native_coding_seed_h205f22 where request_id=p_request;
 if found then
  if r.profile_id<>p_profile or r.body_sha256<>bodysha or r.body<>body then raise exception 'native_coding_seed_request_collision' using errcode='23505';end if;
  return destruktion_meta.native_coding_seed_read_v1(p_profile,p_request);
 end if;
 if exists(select 1 from destruktion_meta.client_v1_goal_request_h205f22 where request_id=p_request)
 then raise exception 'native_coding_seed_request_collision' using errcode='23505';end if;
 cfg:=destruktion_meta.native_coding_seed_profile_v1(p_profile,true);
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
 project:=destruktion_meta.native_coding_seed_uuid_v1('native-seed-project:'||p_profile||':'||p_request);
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
  if a->>'provider_id'=p->>'primary_provider_id' then primary_permit:=permitid;primary_agent:=a;end if;
 end loop;
 chat_led:=p->>'schema'='metaengine.native-coding.seed-profile.v2' and p->>'coordination_mode'='CHAT_LED';
 root_role:=case when chat_led then 'PLANNER' else 'IMPLEMENTER' end;
 point:='native.goal.'||replace(p_request::text,'-','');
 spec:=jsonb_build_object('schema','metaengine.devos.project-task-spec.v1','objective',p_objective,'claim_class','MUTATING',
  'native_coding',jsonb_build_object('permit_id',primary_permit,'goal_id',goalid,'goal_sha256',goalsha,'project_id',project),
  'native_goal',jsonb_build_object('schema','metaengine.native-coding.goal-binding.v1','request_id',p_request,'profile_id',p_profile,
   'profile_sha256',profile_sha,'goal_sha256',goalsha),'automatic_retry_allowed',false,'authority_effect',false);
 if chat_led then
  spec:=(spec-'native_coding')||jsonb_build_object('claim_class','READ_ONLY',
   'project_continuity',jsonb_build_object('schema','metaengine.devos.project-task.v1','project_id',project,'parent_task_id',null,'depth',0,'root_request_id',p_request),
   'coordination_mode','CHAT_LED');
 end if;
 enqueued:=public.devos_fleet_enqueue_v1((p->>'workspace_id')::uuid,point,root_role,primary_agent#>>'{worktree,base_sha}',spec,
  'native-goal:'||p_request::text,p->>'branch_name',50);
 root_task:=(enqueued->>'task_id')::uuid;
 if enqueued->'accepted' is distinct from 'true'::jsonb or not exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 t
  where t.task_id=root_task and t.workspace_id=(p->>'workspace_id')::uuid and t.task_spec=spec and t.state='READY' and t.lease_generation=0
    and t.base_sha=primary_agent#>>'{worktree,base_sha}' and t.role=root_role and t.point_id=point
    and t.task_spec_sha256=enqueued->>'task_spec_sha256')
 then raise exception 'native_coding_seed_enqueue_binding_changed' using errcode='23514';end if;
 insert into destruktion_meta.project_run_h205f22(project_id,workspace_id,request_id,root_task_id,device_id,client_id,admin_grant_epoch,goal,max_depth,max_tasks,max_children)
 values(project,(p->>'workspace_id')::uuid,p_request,root_task,(p->>'device_id')::uuid,p->>'client_id',(p->>'admin_grant_epoch')::bigint,p_objective,
  (p#>>'{policy,max_depth}')::int,(p#>>'{policy,max_tasks}')::bigint,(p#>>'{policy,max_children}')::bigint);
 insert into destruktion_meta.project_task_h205f22(task_id,project_id,task_seq,root_task_id,parent_task_id,depth) values(root_task,project,1,root_task,null,0);
 perform destruktion_meta.project_append_h205f22(project,'PROJECT_REGISTERED',root_task,0,p->>'client_id',null,null,null,
  jsonb_build_object('request_id',p_request,'goal',p_objective,'goal_id',goalid,'goal_sha256',goalsha,'native',true),
  'PRIVATE_NATIVE_OPERATOR_ADMISSION',null,false,'register:'||p_request);
 perform destruktion_meta.project_append_h205f22(project,'NATIVE_GOAL_ADMITTED',root_task,0,p->>'client_id',null,null,null,
  jsonb_build_object('request_id',p_request,'profile_id',p_profile,'profile_sha256',profile_sha,'goal_sha256',goalsha,
   'task_spec_sha256',enqueued->>'task_spec_sha256','physical_execution_proven',false),'PRIVATE_NATIVE_OPERATOR_ADMISSION',null,false,'native-seed:'||p_request);
 receipt:=jsonb_build_object('schema','metaengine.native-coding.goal-admission.v1','state','ADMITTED','request_id',p_request,'profile_id',p_profile,
  'profile_sha256',profile_sha,'workspace_id',p->>'workspace_id','project_id',project,'root_task_id',root_task,'goal_id',goalid,'goal_sha256',goalsha,
  'objective',p_objective,'task_spec_sha256',enqueued->>'task_spec_sha256','permit_ids',permitids,'logical_policy',p->'policy',
  'physical_execution_proven',false,'global_actuation_granted',false,'production_qualified',false,'automatic_retry_allowed',false,'authority_effect',false);
 insert into destruktion_meta.native_coding_seed_h205f22(request_id,profile_id,profile_sha256,objective,body,body_sha256,goal_id,goal,canonical_goal,goal_sha256,
  workspace_id,project_id,root_task_id,task_spec_sha256,permit_ids,observation,canonical_observation,observation_sha256,receipt,canonical_receipt,receipt_sha256)
 values(p_request,p_profile,profile_sha,p_objective,body,bodysha,goalid,goal,goal::text,goalsha,(p->>'workspace_id')::uuid,project,root_task,
  enqueued->>'task_spec_sha256',permitids,p_observation,p_canonical_observation,p_observation_sha256,receipt,receipt::text,
  encode(extensions.digest(convert_to(receipt::text,'UTF8'),'sha256'),'hex'));
 return destruktion_meta.native_coding_seed_read_v1(p_profile,p_request);
end $$;

create or replace function public.h205f22_project_spawn_v1(p_workspace_id uuid,p_project_id uuid,p_parent_task_id uuid,p_claim_id bigint,p_lease_generation bigint,
  p_request_id uuid,p_children jsonb,p_device_id uuid,p_client_id text,p_admin_grant_epoch bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta,extensions,pg_temp as $$
declare auth jsonb; r destruktion_meta.project_run_h205f22%rowtype; parent destruktion_meta.project_task_h205f22%rowtype;
  proposal destruktion_meta.project_child_proposal_h205f22%rowtype; child jsonb; idx integer:=0; digest text; capacity jsonb;
  count_children bigint; result jsonb:='[]'; spec jsonb; enqueued jsonb; id uuid; reason text; replay boolean:=true; native_child jsonb;chat_led boolean:=false;native_route boolean:=false;
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
  select exists(select 1 from destruktion_meta.native_coding_seed_h205f22 seed
    join destruktion_meta.native_coding_seed_profile_h205f22 profile using(profile_id)
    where seed.project_id=p_project_id and seed.profile_sha256=profile.profile_sha256
      and profile.profile->>'schema'='metaengine.native-coding.seed-profile.v2'
      and profile.profile->>'coordination_mode'='CHAT_LED') into chat_led;
  if chat_led and exists(select 1 from jsonb_array_elements(p_children) item where item->>'role'='CRITIC') then
    raise exception 'PROJECT_NATIVE_REVIEW_SUBJECT_REQUIRED' using errcode='22023';
  end if;
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
      native_route:=(auth->'task'->'task_spec' ? 'native_coding') or (chat_led and proposal.role in ('IMPLEMENTER','CRITIC'));
      if reason is null and chat_led and not (auth->'task'->'task_spec' ? 'native_coding') and native_route then
        native_child:=destruktion_meta.native_coding_chat_child_permit_v1(p_project_id,p_parent_task_id,proposal.role);
        if native_child is null then reason:='NATIVE_CHILD_PROTECTED_CAPACITY_WAIT';end if;
      elsif reason is null and auth->'task'->'task_spec' ? 'native_coding' then
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
        if native_route then
          if native_child is null then raise exception 'PROJECT_NATIVE_CHILD_PERMIT_REQUIRED'; end if;
          spec:=spec||jsonb_build_object('native_coding',jsonb_build_object('permit_id',native_child->>'permit_id','goal_id',native_child->>'goal_id',
            'goal_sha256',native_child->>'goal_sha256','project_id',native_child->>'project_id'));
        end if;
        enqueued:=public.devos_fleet_enqueue_v1(p_workspace_id,'project.'||replace(p_project_id::text,'-','')||'.'||replace(p_request_id::text,'-','')||'.'||idx,proposal.role,
          case when native_route then native_child#>>'{worktree,base_sha}' else auth->'task'->>'base_sha' end,spec,'project-child:'||p_project_id||':'||p_request_id||':'||idx,
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
