-- Explicit local operator QA bootstrap into the EXISTING W30 queue/project log.
-- No public API can create a profile, permit, goal, job, lease or process here.
-- This is a native goal correlation, not a fabricated meta-plan activation.
create table destruktion_meta.native_coding_seed_profile_h205f22 (
 profile_id uuid primary key, profile jsonb not null, canonical_profile text not null,
 profile_sha256 text not null check(profile_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(), revoked_at timestamptz,
 check(canonical_profile::jsonb=profile and profile_sha256=encode(extensions.digest(convert_to(canonical_profile,'UTF8'),'sha256'),'hex')),
 check(profile->>'schema'='metaengine.native-coding.seed-profile.v1' and profile->>'profile_id'=profile_id::text
   and profile->>'trust_namespace'='LOCAL_OPERATOR_QA' and profile->'production_qualified'='false'::jsonb
   and profile->'authority_effect'='false'::jsonb and profile->'automatic_retry_allowed'='false'::jsonb)
);
create table destruktion_meta.native_coding_seed_h205f22 (
 request_id uuid primary key, seed_seq bigint generated always as identity unique,
 profile_id uuid not null references destruktion_meta.native_coding_seed_profile_h205f22(profile_id),
 profile_sha256 text not null, objective text not null, body jsonb not null, body_sha256 text not null,
 goal_id uuid not null unique, goal jsonb not null, canonical_goal text not null, goal_sha256 text not null,
 workspace_id uuid not null, project_id uuid not null unique references destruktion_meta.project_run_h205f22(project_id),
 root_task_id uuid not null unique references destruktion_meta.devos_fleet_task_h205f22(task_id),
 task_spec_sha256 text not null, permit_ids jsonb not null,
 observation jsonb not null, canonical_observation text not null, observation_sha256 text not null,
 receipt jsonb not null, canonical_receipt text not null, receipt_sha256 text not null,
 created_at timestamptz not null default clock_timestamp(),
 check(profile_sha256 ~ '^[a-f0-9]{64}$' and task_spec_sha256 ~ '^[a-f0-9]{64}$'),
 check(body_sha256=encode(extensions.digest(convert_to(body::text,'UTF8'),'sha256'),'hex')),
 check(canonical_goal::jsonb=goal and goal_sha256=encode(extensions.digest(convert_to(canonical_goal,'UTF8'),'sha256'),'hex')),
 check(canonical_observation::jsonb=observation and observation_sha256=encode(extensions.digest(convert_to(canonical_observation,'UTF8'),'sha256'),'hex')),
 check(canonical_receipt::jsonb=receipt and receipt_sha256=encode(extensions.digest(convert_to(canonical_receipt,'UTF8'),'sha256'),'hex'))
);
alter table destruktion_meta.native_coding_seed_profile_h205f22 enable row level security;
alter table destruktion_meta.native_coding_seed_h205f22 enable row level security;
revoke all on destruktion_meta.native_coding_seed_profile_h205f22,destruktion_meta.native_coding_seed_h205f22 from public,anon,authenticated,service_role;

create function destruktion_meta.native_coding_seed_immutable_v1()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_table_name='native_coding_seed_profile_h205f22' and tg_op='UPDATE' then
  if (to_jsonb(old)->>'revoked_at') is null and (to_jsonb(new)->>'revoked_at') is not null
   and (to_jsonb(old)-'revoked_at')=(to_jsonb(new)-'revoked_at') then return new;end if;
 end if;
 raise exception 'native_coding_seed_immutable' using errcode='23514';
end $$;
create trigger native_coding_seed_profile_immutable_trg before update or delete on destruktion_meta.native_coding_seed_profile_h205f22
 for each row execute function destruktion_meta.native_coding_seed_immutable_v1();
create trigger native_coding_seed_immutable_trg before update or delete on destruktion_meta.native_coding_seed_h205f22
 for each row execute function destruktion_meta.native_coding_seed_immutable_v1();

-- Keep the public browser goal route intact, including its existing UUID lock.
-- The later insert must also refuse a UUID already committed as a native goal.
create function destruktion_meta.native_coding_seed_browser_correlation_guard_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('client-v1-goal:'||new.request_id::text,0));
 if exists(select 1 from destruktion_meta.native_coding_seed_h205f22 where request_id=new.request_id)
 then raise exception 'client_v1_goal_request_collision' using errcode='23505';end if;
 return new;
end $$;
create trigger native_coding_seed_browser_correlation_guard_trg before insert or update on destruktion_meta.client_v1_goal_request_h205f22
 for each row execute function destruktion_meta.native_coding_seed_browser_correlation_guard_v1();

create function destruktion_meta.native_coding_seed_uuid_v1(p_key text)
returns uuid language sql immutable set search_path=pg_catalog as $$
 select (substr(h,1,8)||'-'||substr(h,9,4)||'-5'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12))::uuid
 from (select encode(extensions.digest(convert_to(p_key,'UTF8'),'sha256'),'hex') h) x
$$;

-- Private readonly profile/current ADMIN gate. Historical readback may outlive
-- profile expiry/revocation; it still requires the exact current device grant.
create function destruktion_meta.native_coding_seed_profile_v1(p_profile uuid,p_require_active boolean default true)
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
 if coalesce(jsonb_typeof(v)<>'object' or (select count(*) from jsonb_object_keys(v))<>cardinality(keys) or not v ?& keys
  or v->>'schema'<>'metaengine.native-coding.seed-profile.v1' or v->>'profile_id'<>p_profile::text
  or v->>'trust_namespace'<>'LOCAL_OPERATOR_QA' or v->'production_qualified' is distinct from 'false'::jsonb
  or v->'automatic_retry_allowed' is distinct from 'false'::jsonb or v->'authority_effect' is distinct from 'false'::jsonb
  or coalesce(v->>'user_sid','')!~ '^S-1-[0-9]+(-[0-9]+){1,15}$' or coalesce(v->>'storage_evidence_sha256','')!~ '^[a-f0-9]{64}$'
  or (v->>'owner_epoch')::bigint<1 or (v->>'admin_grant_epoch')::bigint<1
  or (v->>'physical_slot_budget')::int not between 1 and 64 or (v->>'expires_at')::timestamptz is null
  or coalesce(v->>'branch_name','')!~ '^[A-Za-z0-9][A-Za-z0-9/_.-]{1,190}$' or v->>'branch_name' like '%..%' or v->>'branch_name' like '%//%'
  or jsonb_typeof(v->'agents')<>'array' or jsonb_array_length(v->'agents') not between 2 and 64
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

create function destruktion_meta.native_coding_seed_read_v1(p_profile uuid,p_request uuid)
returns jsonb language plpgsql set search_path=pg_catalog,destruktion_meta as $$
declare r destruktion_meta.native_coding_seed_h205f22;
begin
 perform destruktion_meta.native_coding_seed_profile_v1(p_profile,false);
 select * into r from destruktion_meta.native_coding_seed_h205f22 where request_id=p_request and profile_id=p_profile;
 if not found then return null;end if;
 return jsonb_build_object('schema','metaengine.native-coding.seed-readback.v1','request_id',r.request_id,'profile_id',r.profile_id,
  'body',r.body,'canonical_body_text',r.body::text,'body_sha256',r.body_sha256,'receipt',r.receipt,
  'canonical_receipt',r.canonical_receipt,'receipt_sha256',r.receipt_sha256,'readback_only',true,'physical_effect_replayed',false,'authority_effect',false);
end $$;

create function destruktion_meta.native_coding_seed_list_v1(p_profile uuid,p_after_seq bigint default 0,p_limit integer default 16)
returns jsonb language plpgsql set search_path=pg_catalog,destruktion_meta as $$
declare rows jsonb;last_seq bigint;
begin
 perform destruktion_meta.native_coding_seed_profile_v1(p_profile,false);
 if p_after_seq is null or p_limit is null or p_after_seq<0 or p_limit not between 1 and 16 then raise exception 'native_coding_seed_page_invalid' using errcode='22023';end if;
 select coalesce(jsonb_agg(x.row order by x.seed_seq),'[]'::jsonb),coalesce(max(x.seed_seq),p_after_seq) into rows,last_seq from (
  select seed_seq,jsonb_build_object('seed_seq',seed_seq,'request_id',request_id,'project_id',project_id,'root_task_id',root_task_id,
   'goal_id',goal_id,'goal_sha256',goal_sha256,'objective',objective,'task_spec_sha256',task_spec_sha256,'receipt_sha256',receipt_sha256,'created_at',created_at) row
  from destruktion_meta.native_coding_seed_h205f22 where profile_id=p_profile and seed_seq>p_after_seq order by seed_seq limit p_limit
 ) x;
 return jsonb_build_object('schema','metaengine.native-coding.seed-catalog.v1','entries',rows,'next_after_seq',last_seq,
  'has_more',exists(select 1 from destruktion_meta.native_coding_seed_h205f22 where profile_id=p_profile and seed_seq>last_seq),
  'authority_effect',false,'automatic_retry_allowed',false);
end $$;

create function destruktion_meta.native_coding_seed_goal_v1(p_profile uuid,p_request uuid,p_objective text,
 p_observation jsonb,p_canonical_observation text,p_observation_sha256 text)
returns jsonb language plpgsql set search_path=pg_catalog,public,destruktion_meta as $$
declare cfg jsonb;p jsonb;a jsonb;actual jsonb;primary_agent jsonb;r destruktion_meta.native_coding_seed_h205f22;
 project uuid;goalid uuid;permitid uuid;root_task uuid;body jsonb;bodysha text;goal jsonb;goalsha text;profile_sha text;
 spec jsonb;enqueued jsonb;permit jsonb;permitids jsonb:='[]';primary_permit uuid;stamp text;receipt jsonb;control jsonb;point text;
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
 point:='native.goal.'||replace(p_request::text,'-','');
 spec:=jsonb_build_object('schema','metaengine.devos.project-task-spec.v1','objective',p_objective,'claim_class','MUTATING',
  'native_coding',jsonb_build_object('permit_id',primary_permit,'goal_id',goalid,'goal_sha256',goalsha,'project_id',project),
  'native_goal',jsonb_build_object('schema','metaengine.native-coding.goal-binding.v1','request_id',p_request,'profile_id',p_profile,
   'profile_sha256',profile_sha,'goal_sha256',goalsha),'automatic_retry_allowed',false,'authority_effect',false);
 enqueued:=public.devos_fleet_enqueue_v1((p->>'workspace_id')::uuid,point,'IMPLEMENTER',primary_agent#>>'{worktree,base_sha}',spec,
  'native-goal:'||p_request::text,p->>'branch_name',50);
 root_task:=(enqueued->>'task_id')::uuid;
 if enqueued->'accepted' is distinct from 'true'::jsonb or not exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 t
  where t.task_id=root_task and t.workspace_id=(p->>'workspace_id')::uuid and t.task_spec=spec and t.state='READY' and t.lease_generation=0
    and t.base_sha=primary_agent#>>'{worktree,base_sha}' and t.role='IMPLEMENTER' and t.point_id=point
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

revoke all on function destruktion_meta.native_coding_seed_immutable_v1(),destruktion_meta.native_coding_seed_browser_correlation_guard_v1(),destruktion_meta.native_coding_seed_uuid_v1(text),
 destruktion_meta.native_coding_seed_profile_v1(uuid,boolean),destruktion_meta.native_coding_seed_read_v1(uuid,uuid),
 destruktion_meta.native_coding_seed_list_v1(uuid,bigint,integer),destruktion_meta.native_coding_seed_goal_v1(uuid,uuid,text,jsonb,text,text)
 from public,anon,authenticated,service_role;
