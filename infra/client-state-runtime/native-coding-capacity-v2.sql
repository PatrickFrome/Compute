-- New additive source. Attest exact complete replay; never repair a partial or widened installation.
do $review$
declare expected jsonb:='[{"signature":"destruktion_meta.native_coding_capacity_lock_v1(uuid,text)","args":["p_device","p_client"],"return_type":"void","setof":false,"definer":false,"sha256":"32a2fe4283f742b13842e0719e1851501d89ea30f45e11757b9d2efe41b0360c"},{"signature":"destruktion_meta.native_coding_capacity_effect_fence_v1(uuid,text)","args":["p_device","p_client"],"return_type":"void","setof":false,"definer":false,"sha256":"ae5ed2e4a2d18f1fe8577b4a457d6d28a29709ac4604dcc4b9ecde8d7235f510"},{"signature":"destruktion_meta.native_coding_capacity_rows_v1(uuid,text)","args":["p_device","p_client"],"return_type":"jsonb","setof":true,"definer":false,"sha256":"82788907bde21ce3c0bb96ab0adfe52cf9b1cd3648c9368103872ee98bfa6104"},{"signature":"destruktion_meta.native_coding_capacity_evidence_v1(uuid,text,bigint,jsonb)","args":["p_device","p_client","p_epoch","p_evidence"],"return_type":"void","setof":false,"definer":false,"sha256":"35e5797bf013392a6892b5a84fc351d11c5b1fc62ea68fc19df7e53bc4384747"},{"signature":"destruktion_meta.native_coding_capacity_counts_v1(uuid,text,bigint,jsonb)","args":["p_device","p_client","p_epoch","p_evidence"],"return_type":"jsonb","setof":false,"definer":false,"sha256":"ff71b8844d5e33ba020f8d141cbef252686f60cc8436e3b49ecac0c6f0585e1c"},{"signature":"destruktion_meta.native_coding_capacity_census_v1(uuid,text,bigint,jsonb)","args":["p_device","p_client","p_epoch","p_evidence"],"return_type":"jsonb","setof":false,"definer":false,"sha256":"e814c4daa3d40e6e35890b61d71b793dd8d167c2a8edd70212e4a9402e4f1ac6"},{"signature":"destruktion_meta.native_coding_setup_operation_v2(text,jsonb,jsonb,jsonb,jsonb,bigint)","args":["p_action","p_actor","p_input","p_value","p_evidence","p_ceiling"],"return_type":"jsonb","setof":false,"definer":false,"sha256":"da9e2445b05112c9927a57fc1e7aa42845cea2fbc72a9d56837918db0fd5e68e"},{"signature":"destruktion_meta.native_coding_capacity_claim_gate_v2()","args":[],"return_type":"trigger","setof":false,"definer":true,"sha256":"2cbee313c0689061b29dadfdd4b70a7df354ed570277648ae5b807b7ffa12c0c"},{"signature":"destruktion_meta.native_coding_capacity_snapshot_v1(uuid,text,bigint,uuid,integer,jsonb,jsonb)","args":["p_device","p_client","p_epoch","p_host_instance","p_host_pid","p_input","p_evidence"],"return_type":"void","setof":false,"definer":false,"sha256":"96e601363a59c363dbef44c36cf0c312d902908379148aa5669f076eb5ea4151"},{"signature":"destruktion_meta.native_coding_service_heartbeat_v2(uuid,text,bigint,uuid,integer,jsonb,text,jsonb,jsonb)","args":["p_device","p_client","p_epoch","p_host_instance","p_host_pid","p_body","p_canonical_body","p_headers","p_capacity_evidence"],"return_type":"jsonb","setof":false,"definer":false,"sha256":"b9abe41c127c49e9c89f16bf53346d80b9b8a4a4658d4373ba8bcef8f51decd5"},{"signature":"destruktion_meta.native_coding_service_heartbeat_read_v2(uuid,text,bigint,uuid,text)","args":["p_device","p_client","p_epoch","p_workspace","p_body_sha256"],"return_type":"jsonb","setof":false,"definer":false,"sha256":"fb8a6ee8ccba89baf724c7cc1f67b2848ff4d849f4c5e6d3426b5e4ba968d449"}]'::jsonb;spec jsonb;f record;n integer;column_exists boolean;tr record;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_capacity_migration_owner_required';end if;
 if exists(select 1 from pg_class c where c.oid='destruktion_meta.native_coding_service_heartbeat_h205f22'::regclass
  and (c.relowner<>to_regrole('state_owner') or not c.relrowsecurity or c.relforcerowsecurity or c.relkind<>'r'
   or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee<>c.relowner)))
  or exists(select 1 from pg_policy where polrelid='destruktion_meta.native_coding_service_heartbeat_h205f22'::regclass)
  or exists(select 1 from pg_trigger where tgrelid='destruktion_meta.native_coding_service_heartbeat_h205f22'::regclass and not tgisinternal)
 then raise exception 'native_capacity_heartbeat_authority_requires_review';end if;
 select exists(select 1 from pg_attribute where attrelid='destruktion_meta.native_coding_service_heartbeat_h205f22'::regclass and attname='capacity_evidence' and not attisdropped) into column_exists;
 select count(*) into n from jsonb_array_elements(expected) x where to_regprocedure(x->>'signature') is not null;
 select * into tr from pg_trigger where tgrelid='destruktion_meta.devos_fleet_claim_h205f22'::regclass and tgname='aa_native_capacity_claim_guard_v2';
 if n=0 and not column_exists and tr.oid is null then return;end if;
 if n<>jsonb_array_length(expected) or not column_exists or tr.oid is null then raise exception 'native_capacity_partial_install';end if;
 for spec in select value from jsonb_array_elements(expected) loop
  select p.*,l.lanname into f from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(spec->>'signature');
  if f.proowner<>to_regrole('state_owner') or f.prorettype<>to_regtype(spec->>'return_type') or f.proretset is distinct from (spec->>'setof')::boolean
   or f.prokind<>'f' or f.proisstrict or f.proleakproof or f.proparallel<>'u' or f.provolatile<>'v' or f.lanname<>'plpgsql'
   or f.prosecdef is distinct from (spec->>'definer')::boolean or f.pronargdefaults<>0 or f.provariadic<>0
   or coalesce(to_jsonb(f.proargnames),'[]'::jsonb) is distinct from spec->'args'
   or f.proconfig is distinct from array['search_path=pg_catalog, public, destruktion_meta']::text[]
   or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee<>f.proowner)
   or encode(extensions.digest(convert_to(replace(f.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex')<>spec->>'sha256'
  then raise exception 'native_capacity_function_requires_review:%',spec->>'signature';end if;
 end loop;
 if exists(select 1 from pg_attribute a where a.attrelid='destruktion_meta.native_coding_service_heartbeat_h205f22'::regclass and a.attname='capacity_evidence'
  and (a.atttypid<>to_regtype('jsonb') or a.attnotnull or a.attidentity<>'' or a.attgenerated<>''
   or exists(select 1 from pg_attrdef d where d.adrelid=a.attrelid and d.adnum=a.attnum)
   or exists(select 1 from aclexplode(a.attacl) acl where acl.grantee<>to_regrole('state_owner'))))
 then raise exception 'native_capacity_evidence_column_requires_review';end if;
 if not exists(select 1 from pg_constraint where conrelid='destruktion_meta.native_coding_service_heartbeat_h205f22'::regclass and conname='native_capacity_evidence_budget_v1'
   and contype='c' and convalidated and not condeferrable and pg_get_expr(conbin,conrelid)='((capacity_evidence IS NULL) OR (octet_length((capacity_evidence)::text) <= 262144))')
 then raise exception 'native_capacity_evidence_constraint_requires_review';end if;
 if tr.tgfoid<>to_regprocedure('destruktion_meta.native_coding_capacity_claim_gate_v2()') or tr.tgtype<>7 or tr.tgenabled<>'O' or tr.tgisinternal
  or tr.tgqual is not null or tr.tgnargs<>0 or tr.tgconstraint<>0 or tr.tgdeferrable or tr.tginitdeferred
 then raise exception 'native_capacity_trigger_requires_review';end if;
end $review$;
-- END CAPACITY REPLAY ATTESTATION
-- Additive native CLI/setup census. No scheduler, slot relation or task allocator.
-- Private evidence is an expiring Host-read cache, NEVER caller authority.
-- Function/column/trigger replay attestation is prefixed below before registration.

alter table destruktion_meta.native_coding_service_heartbeat_h205f22
 add column if not exists capacity_evidence jsonb;
do $$begin
 if not exists(select 1 from pg_constraint where conrelid='destruktion_meta.native_coding_service_heartbeat_h205f22'::regclass and conname='native_capacity_evidence_budget_v1') then
  alter table destruktion_meta.native_coding_service_heartbeat_h205f22 add constraint native_capacity_evidence_budget_v1
   check(capacity_evidence is null or octet_length(capacity_evidence::text)<=262144);
 end if;
end $$;

-- This internal helper also executes inside the fixed SECURITY DEFINER trigger.
-- Only authenticated Host entrypoints require session_user as well. API EXECUTE
-- is revoked; no session flag, GUC, supplied path or caller digest grants access.
create or replace function destruktion_meta.native_coding_capacity_lock_v1(p_device uuid,p_client text)
returns void language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta as $$
begin
 if current_user<>'state_owner' then raise exception 'native_capacity_state_owner_required' using errcode='42501';end if;
 if p_device is null or coalesce(p_client,'')='' then raise exception 'native_capacity_scope_invalid' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-capacity:'||p_device::text,303001));
end $$;

-- Effect-side MVCC fence for mixed READ COMMITTED W30 / SERIALIZABLE Host
-- transactions. Advisory exclusion alone does not refresh an old snapshot.
-- Same-value updates never renew TTL/provenance/nonce/generation. No new row.
create or replace function destruktion_meta.native_coding_capacity_effect_fence_v1(p_device uuid,p_client text)
returns void language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta as $$
declare r record;
begin
 perform destruktion_meta.native_coding_capacity_lock_v1(p_device,p_client);
 for r in select client_id from destruktion_meta.native_coding_service_heartbeat_h205f22 where device_id=p_device
  union select p_client order by client_id loop
  perform pg_advisory_xact_lock(hashtextextended('native-service:'||p_device||':'||r.client_id,25120000));
 end loop;
 for r in select client_id,workspace_id from destruktion_meta.native_coding_service_heartbeat_h205f22 where device_id=p_device order by client_id,workspace_id loop
  update destruktion_meta.native_coding_service_heartbeat_h205f22 set capacity_evidence=capacity_evidence
   where workspace_id=r.workspace_id and device_id=p_device and client_id=r.client_id;
 end loop;
end $$;

create or replace function destruktion_meta.native_coding_capacity_rows_v1(p_device uuid,p_client text)
returns setof jsonb language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta as $$
begin
 if current_user<>'state_owner' then raise exception 'native_capacity_state_owner_required' using errcode='42501';end if;
 return query
 with owned_permits as (
  select p.* from destruktion_meta.native_coding_operator_permit_h205f22 p where p.device_id=p_device
 ), task_keys as (
  select e.task_id,e.lease_generation from destruktion_meta.native_coding_execution_h205f22 e where exists(
   select 1 from owned_permits p where p.workspace_id=e.workspace_id and 'codex-cli:'||p.provider_id::text=e.target_id
    and p.agent_id=e.agent_id and p.agent_generation_epoch=e.agent_generation_epoch)
  union
  select c.task_id,c.lease_generation from destruktion_meta.devos_fleet_claim_h205f22 c where exists(
   select 1 from owned_permits p where p.workspace_id=c.workspace_id and 'codex-cli:'||p.provider_id::text=c.target_id
    and p.agent_id=c.agent_id and p.agent_generation_epoch=c.agent_generation_epoch)
 ), task_rows as (
  select k.*,to_jsonb(e) as execution,to_jsonb(j) as registration,to_jsonb(t) as task,
   (select jsonb_agg(to_jsonb(c) order by c.claim_id) from destruktion_meta.devos_fleet_claim_h205f22 c
    where c.task_id=k.task_id and c.lease_generation=k.lease_generation) as claims,
   exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 c where c.task_id=k.task_id and c.lease_generation=k.lease_generation
    and c.state='ACTIVE' and c.expires_at>clock_timestamp()) as claim_active,
   candidates.permits,case when jsonb_array_length(candidates.permits)=1 then candidates.permits->0 end as permit,
   coalesce(e.host_incarnation,r.envelope#>>'{payload,host_process,process_incarnation_id}') as incarnation
  from task_keys k join destruktion_meta.devos_fleet_task_h205f22 t on t.task_id=k.task_id
  left join destruktion_meta.native_coding_execution_h205f22 e on e.task_id=k.task_id and e.lease_generation=k.lease_generation
  left join destruktion_meta.native_coding_job_registration_h205f22 j on j.task_id=k.task_id and j.lease_generation=k.lease_generation
  left join lateral (select coalesce(jsonb_agg(to_jsonb(p) order by p.permit_id),'[]'::jsonb) as permits from owned_permits p
   where (j.permit_id is not null and p.permit_id=j.permit_id)
    or (j.permit_id is null and e.task_id is not null and p.workspace_id=e.workspace_id and 'codex-cli:'||p.provider_id::text=e.target_id
     and p.agent_id=e.agent_id and p.agent_generation_epoch=e.agent_generation_epoch)
    or (j.permit_id is null and e.task_id is null and p.permit_id=(t.task_spec#>>'{native_coding,permit_id}')::uuid)) candidates on true
  left join destruktion_meta.native_coding_provider_registration_h205f22 r on r.permit_id=case when jsonb_array_length(candidates.permits)=1 then (candidates.permits#>>'{0,permit_id}')::uuid end
 )
 select jsonb_build_object('kind','TASK','key',task_id::text||':'||lease_generation::text,
  'task_id',task_id,'lease_generation',lease_generation,'has_execution',execution is not null,'claim_active',claim_active,
  'host_incarnation',incarnation,'client_id',permit->>'client_id','admin_grant_epoch',permit->'admin_grant_epoch','execution_state',execution->>'state',
  'permit_current',permit is not null and permit->'revoked_at'='null'::jsonb,
  'current_task_generation',(task->>'lease_generation')::bigint=lease_generation,
  'durable_sha256',encode(extensions.digest(convert_to(jsonb_build_object('execution',execution,'registration',registration,'task',task,'claims',claims,'permits',permits)::text,'UTF8'),'sha256'),'hex'),
  'selector',jsonb_build_object('workspace_id',permit->>'workspace_id','project_id',permit#>>'{permit,project_id}',
    'task_id',task_id,'lease_generation',lease_generation,'provider_id',permit->>'provider_id','agent_id',permit->>'agent_id','agent_generation_epoch',permit->'agent_generation_epoch'))
 from task_rows
 union all
 select jsonb_build_object('kind','SETUP','key',operation_id::text,'host_instance_id',intent->>'host_instance_id',
  'host_pid',intent->'host_pid','client_id',intent#>>'{actor,client_id}','custody_id',custody_id,'state',state,'cleanup_state',cleanup_state,'admin_grant_epoch',intent#>'{actor,admin_grant_epoch}',
  'durable_sha256',encode(extensions.digest(convert_to(to_jsonb(s)::text,'UTF8'),'sha256'),'hex'))
 from destruktion_meta.native_coding_setup_operation_h205f22 s
 where s.intent#>>'{actor,device_id}'=p_device::text;
end $$;

create or replace function destruktion_meta.native_coding_capacity_evidence_v1(p_device uuid,p_client text,p_epoch bigint,p_evidence jsonb)
returns void language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta as $$
declare d public.compute_fabric_a2_browser_device_h205f22;keys text[];v jsonb:=p_evidence;item jsonb;started timestamptz;expires timestamptz;
begin
 if current_user<>'state_owner' then raise exception 'native_capacity_state_owner_required' using errcode='42501';end if;
 perform destruktion_meta.project_device_grant_h205f22(p_device,p_client,p_epoch);
 select * into d from public.compute_fabric_a2_browser_device_h205f22 where device_id=p_device and client_id=p_client;
 if not found or not d.active or d.revoked_at is not null or d.access_tier<>'ADMIN' or d.admin_revoked_at is not null or d.admin_grant_epoch<>p_epoch
  or not exists(select 1 from public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 p where p.token_hash=d.enrollment_pairing_token_hash and p.active)
 then raise exception 'native_capacity_current_device_required' using errcode='42501';end if;
 keys:=array['schema','host_instance_id','host_pid','device_key_fingerprint_sha256','admin_grant_epoch','main_incarnation','postgres_scope_sha256',
  'postgres_system_identifier','postgres_started_at_us','generation','observed_at','expires_at','owned_tasks','owned_setup','resolved'];
 if coalesce(jsonb_typeof(v)<>'object' or not v ?& keys or (select count(*) from jsonb_object_keys(v))<>cardinality(keys)
  or octet_length(v::text)>262144 or v->>'schema'<>'metaengine.native-coding.capacity-evidence.v1'
  or coalesce(v->>'host_instance_id','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  or jsonb_typeof(v->'host_pid')<>'number' or jsonb_typeof(v->'generation')<>'number' or jsonb_typeof(v->'admin_grant_epoch')<>'number'
  or (v->>'host_pid')::bigint not between 1 and 2147483647 or (v->>'generation')::bigint not between 1 and 9007199254740991
  or v->>'device_key_fingerprint_sha256' is distinct from d.key_fingerprint_sha256 or (v->>'admin_grant_epoch')::bigint is distinct from p_epoch
  or coalesce(v->>'main_incarnation','')!~'^pid:[1-9][0-9]*:created_100ns:[1-9][0-9]{16,18}$'
  or coalesce(v->>'postgres_scope_sha256','')!~'^[a-f0-9]{64}$'
  or v->>'postgres_system_identifier' is distinct from (select system_identifier::text from pg_control_system())
  or (v->>'postgres_started_at_us')::timestamptz is distinct from pg_postmaster_start_time()
  or jsonb_typeof(v->'owned_tasks')<>'array' or jsonb_typeof(v->'owned_setup')<>'array' or jsonb_typeof(v->'resolved')<>'array',true)
 then raise exception 'native_capacity_evidence_invalid' using errcode='23514';end if;
 started:=(v->>'observed_at')::timestamptz;expires:=(v->>'expires_at')::timestamptz;
 if started is null or expires is null or expires<>started+interval '10 seconds' or started>clock_timestamp()+interval '5 seconds' or expires<=clock_timestamp()
 then raise exception 'native_capacity_evidence_stale' using errcode='55000';end if;
 for item in select value from jsonb_array_elements(v->'owned_tasks') loop
  if coalesce(jsonb_typeof(item)<>'object' or not item ?& array['task_id','lease_generation'] or (select count(*) from jsonb_object_keys(item))<>2
   or coalesce(item->>'task_id','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
   or jsonb_typeof(item->'lease_generation')<>'number' or (item->>'lease_generation')::bigint not between 1 and 9007199254740991,true)
  then raise exception 'native_capacity_owned_task_invalid' using errcode='23514';end if;
 end loop;
 if (select count(*) from jsonb_array_elements(v->'owned_tasks'))<>(select count(distinct (x->>'task_id')||':'||(x->>'lease_generation')) from jsonb_array_elements(v->'owned_tasks') x)
 then raise exception 'native_capacity_owned_task_duplicate' using errcode='23514';end if;
 for item in select value from jsonb_array_elements(v->'owned_setup') loop
  if coalesce(jsonb_typeof(item)<>'object' or not item ?& array['operation_id','custody_id','durable_sha256'] or (select count(*) from jsonb_object_keys(item))<>3
   or coalesce(item->>'operation_id','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' or coalesce(item->>'custody_id','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
   or coalesce(item->>'durable_sha256','')!~'^[a-f0-9]{64}$',true)
  then raise exception 'native_capacity_owned_setup_invalid' using errcode='23514';end if;
 end loop;
 for item in select value from jsonb_array_elements(v->'resolved') loop
  if coalesce(jsonb_typeof(item)<>'object' or not item ?& array['kind','key','durable_sha256'] or (select count(*) from jsonb_object_keys(item))<>3
   or item->>'kind' not in('TASK','SETUP') or coalesce(item->>'key','')='' or length(item->>'key')>80
   or coalesce(item->>'durable_sha256','')!~'^[a-f0-9]{64}$',true)
  then raise exception 'native_capacity_physical_witness_invalid' using errcode='23514';end if;
 end loop;
 if (select count(*) from jsonb_array_elements(v->'owned_setup'))<>(select count(distinct x->>'operation_id') from jsonb_array_elements(v->'owned_setup') x)
  or (select count(*) from jsonb_array_elements(v->'resolved'))<>(select count(distinct (x->>'kind')||':'||(x->>'key')) from jsonb_array_elements(v->'resolved') x)
 then raise exception 'native_capacity_witness_duplicate' using errcode='23514';end if;
end $$;

create or replace function destruktion_meta.native_coding_capacity_counts_v1(p_device uuid,p_client text,p_epoch bigint,p_evidence jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta as $$
declare rows jsonb;row jsonb;owned boolean;known boolean;task_count bigint:=0;setup_count bigint:=0;claims bigint:=0;represented bigint:=0;unresolved bigint:=0;
begin
 perform destruktion_meta.native_coding_capacity_evidence_v1(p_device,p_client,p_epoch,p_evidence);
 select coalesce(jsonb_agg(r order by r->>'kind',r->>'key'),'[]'::jsonb) into rows from destruktion_meta.native_coding_capacity_rows_v1(p_device,p_client) r;
 for row in select value from jsonb_array_elements(rows) loop
  -- Only the fixed private Host may supply independently verified witnesses.
  -- Match exact unchanged row; an SQL terminal bit is deliberately irrelevant.
  if exists(select 1 from jsonb_array_elements(p_evidence->'resolved') r where r->>'kind'=row->>'kind' and r->>'key'=row->>'key' and r->>'durable_sha256'=row->>'durable_sha256') then continue;end if;
  if row->>'kind'='SETUP' then
   setup_count:=setup_count+1;
   known:=coalesce(row->>'client_id'=p_client and row->>'host_instance_id'=p_evidence->>'host_instance_id' and row->'host_pid'=p_evidence->'host_pid'
    and row->'admin_grant_epoch'=p_evidence->'admin_grant_epoch' and row->>'state' in('RUNNING','CANCEL_REQUESTED')
    and exists(select 1 from jsonb_array_elements(p_evidence->'owned_setup') x where x->>'operation_id'=row->>'key'
     and x->>'custody_id'=row->>'custody_id' and x->>'durable_sha256'=row->>'durable_sha256'),false);
   if not known then unresolved:=unresolved+1;end if;continue;
  end if;
  task_count:=task_count+1;
  owned:=exists(select 1 from jsonb_array_elements(p_evidence->'owned_tasks') o where o->>'task_id'=row->>'task_id' and o->>'lease_generation'=row->>'lease_generation');
  if owned then represented:=represented+1;end if;
  if row->'claim_active'='true'::jsonb and not owned then claims:=claims+1;end if;
  known:=coalesce(row->>'client_id'=p_client and row->>'host_incarnation'=p_evidence->>'main_incarnation' and row->'admin_grant_epoch'=p_evidence->'admin_grant_epoch'
   and row->'permit_current'='true'::jsonb and row->'current_task_generation'='true'::jsonb
   and ((owned and row->>'execution_state' in('RESERVED','ATTEMPTED','RESULT_READY','CHECKPOINTED'))
    or row->'has_execution'='false'::jsonb and row->'claim_active'='true'::jsonb),false);
  if not known then unresolved:=unresolved+1;end if;
 end loop;
 -- Foreign/changed proof selectors cannot manufacture absence.
 if exists(select 1 from jsonb_array_elements(p_evidence->'resolved') r where not exists(select 1 from jsonb_array_elements(rows) x
   where x->>'kind'=r->>'kind' and x->>'key'=r->>'key' and x->>'durable_sha256'=r->>'durable_sha256'))
 then raise exception 'native_capacity_physical_witness_changed' using errcode='55000';end if;
 return jsonb_build_object('census_sha256',encode(extensions.digest(convert_to(jsonb_build_object('rows',rows,'resolved',p_evidence->'resolved','owned_setup',p_evidence->'owned_setup')::text,'UTF8'),'sha256'),'hex'),
  'counts',jsonb_build_object('task_slots',task_count,'setup_slots',setup_count,'unrepresented_claims',claims,'represented_tasks',represented,'unresolved_slots',unresolved));
end $$;

create or replace function destruktion_meta.native_coding_capacity_census_v1(p_device uuid,p_client text,p_epoch bigint,p_evidence jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta as $$
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_capacity_state_owner_required' using errcode='42501';end if;
 perform destruktion_meta.native_coding_capacity_lock_v1(p_device,p_client);
 return destruktion_meta.native_coding_capacity_counts_v1(p_device,p_client,p_epoch,p_evidence);
end $$;

create or replace function destruktion_meta.native_coding_setup_operation_v2(p_action text,p_actor jsonb,p_input jsonb,p_value jsonb,p_evidence jsonb,p_ceiling bigint)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta as $$
declare d uuid:=(p_actor->>'device_id')::uuid;client text:=p_actor->>'client_id';epoch bigint:=(p_actor->>'admin_grant_epoch')::bigint;observation jsonb;ceiling bigint;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_capacity_state_owner_required' using errcode='42501';end if;
 if p_action='READ' then perform destruktion_meta.native_coding_capacity_lock_v1(d,client);
 else perform destruktion_meta.native_coding_capacity_effect_fence_v1(d,client);end if;
 if p_action='BEGIN' and not exists(select 1 from destruktion_meta.native_coding_setup_operation_h205f22 where operation_id=(p_input->>'operation_id')::uuid) then
  if current_setting('transaction_isolation')<>'serializable' or current_setting('synchronous_commit')<>'on' then raise exception 'native_capacity_durable_transaction_required' using errcode='25000';end if;
  if p_ceiling is null or p_ceiling not between 1 and 9007199254740991
   or p_evidence->>'host_instance_id' is distinct from p_input->>'host_instance_id' or p_evidence->'host_pid' is distinct from p_input->'host_pid'
   or p_evidence->>'device_key_fingerprint_sha256' is distinct from p_actor->>'key_fingerprint_sha256'
  then raise exception 'native_capacity_setup_scope_changed' using errcode='23514';end if;
  observation:=destruktion_meta.native_coding_capacity_counts_v1(d,client,epoch,p_evidence);
  select least(p_ceiling,coalesce(min((permit->>'physical_slot_budget')::bigint),p_ceiling)) into ceiling
   from destruktion_meta.native_coding_operator_permit_h205f22 where device_id=d and client_id=client and admin_grant_epoch=epoch and revoked_at is null;
  if (observation#>>'{counts,unresolved_slots}')::bigint>0
   or (observation#>>'{counts,task_slots}')::bigint+(observation#>>'{counts,setup_slots}')::bigint>=ceiling
  then raise exception 'native_capacity_setup_hold' using errcode='55000';end if;
 end if;
 return destruktion_meta.native_coding_setup_operation_v1(p_action,p_actor,p_input,p_value);
end $$;

create or replace function destruktion_meta.native_coding_capacity_claim_gate_v2()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,destruktion_meta as $$
declare p destruktion_meta.native_coding_operator_permit_h205f22;r destruktion_meta.native_coding_service_heartbeat_h205f22;observation jsonb;ceiling bigint;v jsonb;
begin
 if coalesce(new.target_id,'') not like 'codex-cli:%' then return new;end if;
 select permit.* into p from destruktion_meta.native_coding_operator_permit_h205f22 permit
  join destruktion_meta.devos_fleet_task_h205f22 t on permit.permit_id=(t.task_spec#>>'{native_coding,permit_id}')::uuid
  where t.task_id=new.task_id and permit.workspace_id=new.workspace_id and 'codex-cli:'||permit.provider_id::text=new.target_id
   and permit.agent_id=new.agent_id and permit.agent_generation_epoch=new.agent_generation_epoch and permit.revoked_at is null;
 if not found then raise exception 'native_capacity_claim_scope_changed' using errcode='55000';end if;
 perform destruktion_meta.native_coding_capacity_effect_fence_v1(p.device_id,p.client_id);
 select * into r from destruktion_meta.native_coding_service_heartbeat_h205f22 where workspace_id=p.workspace_id and device_id=p.device_id and client_id=p.client_id;
 v:=r.body->'input';
 if r.capacity_evidence is null or r.admin_grant_epoch<>p.admin_grant_epoch or r.expires_at<=clock_timestamp()
  or v->>'schema' is distinct from 'metaengine.native-coding.service-heartbeat.v2'
  or r.body->>'operation' is distinct from 'SERVICE_HEARTBEAT_V2'
  or r.capacity_evidence->>'host_instance_id' is distinct from r.host_instance_id::text or (r.capacity_evidence->>'host_pid')::integer is distinct from r.host_pid
  or r.capacity_evidence->>'main_incarnation' is distinct from v#>>'{host_process,process_incarnation_id}'
  or not exists(select 1 from destruktion_meta.native_coding_provider_registration_h205f22 pr where pr.permit_id=p.permit_id and pr.envelope#>'{payload,host_process}'=v->'host_process')
 then raise exception 'native_capacity_v2_witness_required' using errcode='55000';end if;
 observation:=destruktion_meta.native_coding_capacity_counts_v1(p.device_id,p.client_id,p.admin_grant_epoch,r.capacity_evidence);
 ceiling:=least((p.permit->>'physical_slot_budget')::bigint,(v#>>'{capacity,projection,configured_ceiling}')::bigint,(v#>>'{capacity,projection,resource_ceiling}')::bigint);
 if ceiling is null or ceiling<1 or (observation#>>'{counts,unresolved_slots}')::bigint>0
  or (observation#>>'{counts,task_slots}')::bigint+(observation#>>'{counts,setup_slots}')::bigint>=ceiling
 then raise exception 'native_capacity_claim_hold' using errcode='55000';end if;
 return new;
end $$;

create or replace function destruktion_meta.native_coding_capacity_snapshot_v1(p_device uuid,p_client text,p_epoch bigint,p_host_instance uuid,p_host_pid integer,p_input jsonb,p_evidence jsonb)
returns void language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta as $$
declare v jsonb:=p_input;c jsonb:=p_input#>'{capacity,census}';p jsonb:=p_input#>'{capacity,projection}';actual jsonb;tasks jsonb;principal text;owned_sha text;occupied bigint;free bigint;keys text[];
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_capacity_state_owner_required' using errcode='42501';end if;
 actual:=destruktion_meta.native_coding_capacity_counts_v1(p_device,p_client,p_epoch,p_evidence);
 select coalesce(jsonb_agg(jsonb_build_object('task_id',j->>'task_id','lease_generation',(j->>'lease_generation')::bigint) order by j->>'task_id',(j->>'lease_generation')::bigint),'[]'::jsonb) into tasks
  from jsonb_array_elements(v#>'{runtime,jobs}') j;
 select encode(extensions.digest(convert_to('['||coalesce(string_agg('{"lease_generation":'||(j->>'lease_generation')::bigint::text||',"task_id":"'||(j->>'task_id')||'"}',',' order by j->>'task_id',(j->>'lease_generation')::bigint),'')||']','UTF8'),'sha256'),'hex') into owned_sha
  from jsonb_array_elements(tasks) j;
 principal:=encode(extensions.digest(convert_to('metaengine.native-coding.capacity-principal.v1'||chr(10)||p_device::text||chr(10)||p_client||chr(10)||p_epoch::text||chr(10)||(p_evidence->>'device_key_fingerprint_sha256'),'UTF8'),'sha256'),'hex');
 keys:=array['schema','host_instance_id','host_pid','principal_sha256','postgres_scope_sha256','generation','owned_tasks_sha256','observed_at','expires_at','census_sha256','complete','state','counts','automatic_retry_allowed','authority_effect'];
 if coalesce(jsonb_typeof(v->'capacity')<>'object' or not v->'capacity' ?& array['census','projection'] or (select count(*) from jsonb_object_keys(v->'capacity'))<>2
  or jsonb_typeof(c)<>'object' or not c ?& keys or (select count(*) from jsonb_object_keys(c))<>cardinality(keys)
  or c->>'schema'<>'metaengine.native-coding.capacity-census.v1' or c->>'host_instance_id'<>p_host_instance::text or (c->>'host_pid')::integer<>p_host_pid
  or c->>'host_instance_id' is distinct from p_evidence->>'host_instance_id' or c->'host_pid' is distinct from p_evidence->'host_pid'
  or c->'generation' is distinct from p_evidence->'generation' or c->'observed_at' is distinct from p_evidence->'observed_at' or c->'expires_at' is distinct from p_evidence->'expires_at'
  or c->>'postgres_scope_sha256' is distinct from p_evidence->>'postgres_scope_sha256' or c->>'principal_sha256' is distinct from principal
  or c->'complete' is distinct from 'true'::jsonb or c->>'state' is distinct from case when (actual#>>'{counts,unresolved_slots}')::bigint=0 then 'CURRENT' else 'HOLD' end
  or c->>'census_sha256' is distinct from actual->>'census_sha256' or c->'counts' is distinct from actual->'counts'
  or c->'automatic_retry_allowed' is distinct from 'false'::jsonb or c->'authority_effect' is distinct from 'false'::jsonb
  or c->>'owned_tasks_sha256' is distinct from owned_sha or tasks is distinct from p_evidence->'owned_tasks'
  or p_evidence->>'main_incarnation' is distinct from v#>>'{host_process,process_incarnation_id}',true)
 then raise exception 'native_capacity_census_changed' using errcode='55000';end if;
 occupied:=jsonb_array_length(tasks)+(actual#>>'{counts,task_slots}')::bigint-(actual#>>'{counts,represented_tasks}')::bigint;
 keys:=array['schema','configured_ceiling','resource_ceiling','occupied_task_slots','occupied_setup_slots','unresolved_slots','state','generation','census_sha256','local_revision','free_slots','authority_effect'];
 free:=case when c->>'state'='CURRENT' then greatest(0,least((p->>'configured_ceiling')::bigint,(p->>'resource_ceiling')::bigint)-occupied-(actual#>>'{counts,setup_slots}')::bigint) else 0 end;
 if coalesce(jsonb_typeof(p)<>'object' or not p ?& keys or (select count(*) from jsonb_object_keys(p))<>cardinality(keys)
  or p->>'schema'<>'metaengine.native-coding.capacity-projection.v1' or p->'authority_effect' is distinct from 'false'::jsonb
  or exists(select 1 from unnest(array['configured_ceiling','resource_ceiling','occupied_task_slots','occupied_setup_slots','unresolved_slots','generation','local_revision','free_slots']) k
   where jsonb_typeof(p->k)<>'number' or (p->>k)::numeric<>trunc((p->>k)::numeric) or (p->>k)::numeric not between 0 and 9007199254740991)
  or p->'configured_ceiling' is distinct from v#>'{runtime,physical_slot_budget}' or (p->>'configured_ceiling')::bigint<1
  or (p->>'occupied_task_slots')::bigint is distinct from occupied or p->'occupied_setup_slots' is distinct from actual#>'{counts,setup_slots}'
  or p->'unresolved_slots' is distinct from actual#>'{counts,unresolved_slots}' or p->'state' is distinct from c->'state'
  or p->'generation' is distinct from c->'generation' or p->'census_sha256' is distinct from c->'census_sha256'
  or (p->>'free_slots')::bigint is distinct from free,true)
 then raise exception 'native_capacity_projection_invalid' using errcode='23514';end if;
end $$;

-- Additive exact v2 publication. v1 bodies/shapes remain unchanged.
create or replace function destruktion_meta.native_coding_service_heartbeat_v2(p_device uuid,p_client text,p_epoch bigint,
 p_host_instance uuid,p_host_pid integer,p_body jsonb,p_canonical_body text,p_headers jsonb,p_capacity_evidence jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta as $$
declare v jsonb;ctl jsonb;run jsonb;a jsonb;j jsonb;d public.compute_fabric_a2_browser_device_h205f22;
 p destruktion_meta.native_coding_operator_permit_h205f22;r destruktion_meta.native_coding_provider_registration_h205f22;
 oldrow destruktion_meta.native_coding_service_heartbeat_h205f22;t destruktion_meta.devos_fleet_task_h205f22;
 stamp timestamptz;bodysha text;witnesssha text;noncesha text;keys text[];seen text[]:=array[]::text[];
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_coding_service_state_owner_required' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'serializable' or current_setting('synchronous_commit')<>'on'
 then raise exception 'native_coding_service_durable_transaction_required' using errcode='25000';end if;
 -- Identity and Host instance/PID arguments come from the trusted verifier's
 -- private closure/ALS, never the model or a claimed JSON device identity.
 perform destruktion_meta.native_coding_capacity_effect_fence_v1(p_device,p_client);
 perform destruktion_meta.project_device_grant_h205f22(p_device,p_client,p_epoch);
 select * into d from public.compute_fabric_a2_browser_device_h205f22 where device_id=p_device and client_id=p_client for share;
 v:=p_body->'input';ctl:=v->'control';run:=v->'runtime';
 bodysha:=encode(extensions.digest(convert_to(p_canonical_body,'UTF8'),'sha256'),'hex');
 keys:=array['host_instance_id','host_pid','operation','input'];
 if coalesce(p_canonical_body::jsonb is distinct from p_body or octet_length(p_canonical_body)>65536
  or jsonb_typeof(p_body)<>'object' or not p_body ?& keys or (select count(*) from jsonb_object_keys(p_body))<>4
  or p_body->>'host_instance_id' is distinct from p_host_instance::text or (p_body->>'host_pid')::integer is distinct from p_host_pid
  or p_body->>'operation' is distinct from 'SERVICE_HEARTBEAT_V2'
  or p_headers->>'content-type' is distinct from 'application/json' or p_headers->>'x-a2-device-profile' is distinct from 'A2_DEVICE_HTTP_SIGNATURE_V1'
  or p_headers->>'x-a2-device-id' is distinct from p_device::text or p_headers->>'x-a2-chat-bridge-client' is distinct from p_client
  or p_headers->>'x-a2-device-body-sha256' is distinct from bodysha
  or coalesce(p_headers->>'x-a2-device-signature','')!~ '^[A-Za-z0-9_-]{86}$'
  or coalesce(p_headers->>'x-a2-device-nonce','')!~ '^[A-Za-z0-9_-]{32,96}$'
  or d.profile is distinct from 'A2_DEVICE_HTTP_SIGNATURE_V1' or coalesce(d.key_fingerprint_sha256,'')!~ '^[a-f0-9]{64}$',true)
 then raise exception 'native_coding_service_authenticated_request_invalid' using errcode='23514';end if;
 stamp:=(p_headers->>'x-a2-device-timestamp')::timestamptz;
 if stamp is null or stamp<clock_timestamp()-interval '30 seconds' or stamp>clock_timestamp()+interval '5 seconds'
 then raise exception 'native_coding_service_heartbeat_stale' using errcode='55000';end if;
 keys:=array['capacity','schema','workspace_id','host_process','artifact','postgres','control','runtime','providers','production_qualified','automatic_retry_allowed','authority_effect'];
 if coalesce(jsonb_typeof(v)<>'object' or not v ?& keys or (select count(*) from jsonb_object_keys(v))<>12
  or v->>'schema' is distinct from 'metaengine.native-coding.service-heartbeat.v2'
  or v->'production_qualified' is distinct from 'false'::jsonb or v->'automatic_retry_allowed' is distinct from 'false'::jsonb
  or v->'authority_effect' is distinct from 'false'::jsonb
  or jsonb_typeof(v->'providers')<>'array' or jsonb_array_length(v->'providers')<1
  or jsonb_typeof(ctl)<>'object' or (select count(*) from jsonb_object_keys(ctl))<>4
  or not ctl ?& array['supervisor_mode','armed','interrupted_setup_recovery_fenced','runtime_control_generation']
  or ctl->>'supervisor_mode' is distinct from 'CONTROL' or ctl->'armed' is distinct from 'true'::jsonb
  or ctl->'interrupted_setup_recovery_fenced' is distinct from 'false'::jsonb
  or jsonb_typeof(run)<>'object' or (select count(*) from jsonb_object_keys(run))<>7
  or not run ?& array['schema','physical_slot_budget','occupied_slots','closed','shutdown_state','host_unavailable_reason','jobs']
  or run->>'schema' is distinct from 'metaengine.native-coding.runtime.v1' or run->'closed' is distinct from 'false'::jsonb
  or run->>'shutdown_state' is distinct from 'OPEN' or run->'host_unavailable_reason' is distinct from 'null'::jsonb
  or (run->>'physical_slot_budget')::bigint<1
  or (run->>'occupied_slots')::integer not between 0 and (run->>'physical_slot_budget')::bigint
  or jsonb_typeof(run->'jobs')<>'array' or jsonb_array_length(run->'jobs')<>(run->>'occupied_slots')::integer
  or coalesce(v#>>'{host_process,process_incarnation_id}','')!~ '^pid:[1-9][0-9]*:created_100ns:[1-9][0-9]*$'
  or (v#>>'{host_process,created_at}')::timestamptz>stamp
  or v#>>'{postgres,system_identifier}' is distinct from (select system_identifier::text from pg_control_system()),true)
 then raise exception 'native_coding_service_scope_invalid' using errcode='23514';end if;
 a:=public.devos_environment_state_v1((v->>'workspace_id')::uuid);
 if coalesce(a->'refill_enabled' is distinct from 'true'::jsonb or a->'supervisor_admission_enabled' is distinct from 'true'::jsonb
  or a->'owner_stop' is not distinct from 'true'::jsonb or coalesce(a->>'state','')='STOPPED'
  or (ctl->>'runtime_control_generation')::bigint is null or (a->>'generation_floor')::bigint is null
  or (ctl->>'runtime_control_generation')::bigint is distinct from (a->>'generation_floor')::bigint,true)
 then raise exception 'native_coding_service_environment_fenced' using errcode='55000';end if;
 for a in select value from jsonb_array_elements(v->'providers') loop
  keys:=array['permit_id','provider_id','agent_id','role','agent_generation_epoch','envelope_sha256'];
  if coalesce(jsonb_typeof(a)<>'object' or not a ?& keys or (select count(*) from jsonb_object_keys(a))<>6
    or a->>'permit_id'=any(seen) or coalesce(a->>'envelope_sha256','')!~ '^[a-f0-9]{64}$',true)
  then raise exception 'native_coding_service_provider_invalid' using errcode='23514';end if;
  seen:=array_append(seen,a->>'permit_id');
  select * into p from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=(a->>'permit_id')::uuid and revoked_at is null for share;
  select * into r from destruktion_meta.native_coding_provider_registration_h205f22 where permit_id=p.permit_id for share;
  if coalesce(p.permit_id is null or r.permit_id is null or p.workspace_id<>(v->>'workspace_id')::uuid or p.device_id<>p_device or p.client_id<>p_client
    or p.admin_grant_epoch<>p_epoch or p.permit->>'device_key_fingerprint_sha256' is distinct from d.key_fingerprint_sha256
    or p.provider_id::text is distinct from a->>'provider_id' or p.agent_id is distinct from a->>'agent_id' or p.permit->>'role' is distinct from a->>'role'
    or p.agent_generation_epoch is distinct from (a->>'agent_generation_epoch')::bigint
    or r.envelope_sha256 is distinct from a->>'envelope_sha256'
    or r.envelope->'payload'->'host_process' is distinct from v->'host_process'
    or p.permit->'artifact' is distinct from v->'artifact' or p.permit->'postgres' is distinct from v->'postgres'
    or (r.envelope#>>'{payload,expires_at}')::timestamptz<=clock_timestamp()
    or (p.permit->>'expires_at')::timestamptz<=clock_timestamp()
    or (run->>'physical_slot_budget')::bigint>(p.permit->>'physical_slot_budget')::bigint
    or not exists(select 1 from destruktion_meta.project_run_h205f22 pr where pr.project_id=(p.permit->>'project_id')::uuid and pr.workspace_id=p.workspace_id
      and pr.device_id=p_device and pr.client_id=p_client and pr.admin_grant_epoch=p_epoch and pr.state='ACTIVE'),true)
  then raise exception 'native_coding_service_registered_provider_changed' using errcode='55000';end if;
 end loop;
 seen:=array[]::text[];
 for j in select value from jsonb_array_elements(run->'jobs') loop
  if coalesce(jsonb_typeof(j)<>'object' or (select count(*) from jsonb_object_keys(j))<>3
    or not j ?& array['task_id','lease_generation','state'] or j->>'task_id'=any(seen)
    or j->>'state' not in('PREPARING','RUNNING','RESULT_READY','READBACK_REQUIRED','READBACK_ONLY','AMBIGUOUS','PHYSICAL_POOL_BUSY'),true)
  then raise exception 'native_coding_service_held_job_invalid' using errcode='23514';end if;
  seen:=array_append(seen,j->>'task_id');
  select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=(j->>'task_id')::uuid and workspace_id=(v->>'workspace_id')::uuid
    and lease_generation=(j->>'lease_generation')::bigint and lease_target_id like 'codex-cli:%';
  select * into p from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=(t.task_spec#>>'{native_coding,permit_id}')::uuid;
  if t.task_id is null or p.device_id is distinct from p_device or p.client_id is distinct from p_client
   or p.admin_grant_epoch is distinct from p_epoch or p.provider_id::text is distinct from substring(t.lease_target_id from 11)
  then raise exception 'native_coding_service_held_job_unbound' using errcode='23514';end if;
 end loop;
 perform destruktion_meta.native_coding_capacity_snapshot_v1(p_device,p_client,p_epoch,p_host_instance,p_host_pid,v,p_capacity_evidence);
 perform pg_advisory_xact_lock(hashtextextended('native-service:'||p_device||':'||p_client,25120000));
 noncesha:=encode(extensions.digest(convert_to(p_headers->>'x-a2-device-nonce','UTF8'),'sha256'),'hex');
 witnesssha:=encode(extensions.digest(convert_to(jsonb_build_object('body',p_body,'headers',p_headers)::text,'UTF8'),'sha256'),'hex');
 select * into oldrow from destruktion_meta.native_coding_service_heartbeat_h205f22
  where workspace_id=(v->>'workspace_id')::uuid and device_id=p_device and client_id=p_client for update;
 if found then
  if oldrow.witness_sha256=witnesssha then return jsonb_build_object('schema','metaengine.native-coding.service-heartbeat-ack.v2',
    'accepted',true,'witness_sha256',witnesssha,'body_sha256',bodysha,'expires_at',least(oldrow.expires_at,(oldrow.capacity_evidence->>'expires_at')::timestamptz),'readback_only',true,'authority_effect',false);end if;
  if oldrow.nonce_sha256=noncesha or stamp<=oldrow.proven_at then raise exception 'native_coding_service_heartbeat_replay' using errcode='23505';end if;
 end if;
 if exists(select 1 from destruktion_meta.native_coding_service_heartbeat_h205f22 h where h.device_id=p_device
  and h.host_instance_id=p_host_instance and h.host_pid=p_host_pid and h.capacity_evidence is not null
  and (h.capacity_evidence->>'generation')::bigint>=(p_capacity_evidence->>'generation')::bigint)
 then raise exception 'native_capacity_generation_replay' using errcode='23505';end if;
 insert into destruktion_meta.native_coding_service_heartbeat_h205f22
  (workspace_id,device_id,client_id,admin_grant_epoch,host_instance_id,host_pid,body,canonical_body,body_sha256,headers,nonce_sha256,witness_sha256,proven_at,expires_at,capacity_evidence)
 values((v->>'workspace_id')::uuid,p_device,p_client,p_epoch,p_host_instance,p_host_pid,p_body,p_canonical_body,bodysha,p_headers,noncesha,witnesssha,stamp,stamp+interval '30 seconds',p_capacity_evidence)
 on conflict(workspace_id,device_id,client_id) do update set admin_grant_epoch=excluded.admin_grant_epoch,host_instance_id=excluded.host_instance_id,
  host_pid=excluded.host_pid,body=excluded.body,canonical_body=excluded.canonical_body,body_sha256=excluded.body_sha256,headers=excluded.headers,
  nonce_sha256=excluded.nonce_sha256,witness_sha256=excluded.witness_sha256,proven_at=excluded.proven_at,expires_at=excluded.expires_at,registered_at=clock_timestamp(),capacity_evidence=excluded.capacity_evidence;
 return jsonb_build_object('schema','metaengine.native-coding.service-heartbeat-ack.v2','accepted',true,'witness_sha256',witnesssha,
  'body_sha256',bodysha,'expires_at',least(stamp+interval '30 seconds',(p_capacity_evidence->>'expires_at')::timestamptz),'readback_only',false,'authority_effect',false);
end $$;

create or replace function destruktion_meta.native_coding_service_heartbeat_read_v2(p_device uuid,p_client text,p_epoch bigint,p_workspace uuid,p_body_sha256 text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta as $$
declare r destruktion_meta.native_coding_service_heartbeat_h205f22;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_coding_service_state_owner_required' using errcode='42501';end if;
 perform destruktion_meta.project_device_grant_h205f22(p_device,p_client,p_epoch);
 if coalesce(p_body_sha256,'')!~ '^[a-f0-9]{64}$' then raise exception 'native_coding_service_read_selector_invalid' using errcode='22023';end if;
 select * into r from destruktion_meta.native_coding_service_heartbeat_h205f22 where workspace_id=p_workspace and device_id=p_device and client_id=p_client
  and admin_grant_epoch=p_epoch and body_sha256=p_body_sha256
  and body#>>'{input,schema}'='metaengine.native-coding.service-heartbeat.v2' and capacity_evidence is not null;
 if not found then return null;end if;
 return jsonb_build_object('schema','metaengine.native-coding.service-heartbeat-ack.v2','accepted',true,
  'witness_sha256',r.witness_sha256,'body_sha256',r.body_sha256,'expires_at',least(r.expires_at,(r.capacity_evidence->>'expires_at')::timestamptz),'readback_only',true,'authority_effect',false);
end $$;

-- CAPACITY ACLS AND TRIGGER
revoke all on function destruktion_meta.native_coding_capacity_lock_v1(uuid,text) from public,anon,authenticated,service_role;
revoke all on function destruktion_meta.native_coding_capacity_effect_fence_v1(uuid,text) from public,anon,authenticated,service_role;
revoke all on function destruktion_meta.native_coding_capacity_rows_v1(uuid,text) from public,anon,authenticated,service_role;
revoke all on function destruktion_meta.native_coding_capacity_evidence_v1(uuid,text,bigint,jsonb) from public,anon,authenticated,service_role;
revoke all on function destruktion_meta.native_coding_capacity_counts_v1(uuid,text,bigint,jsonb) from public,anon,authenticated,service_role;
revoke all on function destruktion_meta.native_coding_capacity_census_v1(uuid,text,bigint,jsonb) from public,anon,authenticated,service_role;
revoke all on function destruktion_meta.native_coding_setup_operation_v2(text,jsonb,jsonb,jsonb,jsonb,bigint) from public,anon,authenticated,service_role;
revoke all on function destruktion_meta.native_coding_capacity_claim_gate_v2() from public,anon,authenticated,service_role;
revoke all on function destruktion_meta.native_coding_capacity_snapshot_v1(uuid,text,bigint,uuid,integer,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function destruktion_meta.native_coding_service_heartbeat_v2(uuid,text,bigint,uuid,integer,jsonb,text,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function destruktion_meta.native_coding_service_heartbeat_read_v2(uuid,text,bigint,uuid,text) from public,anon,authenticated,service_role;
do $$begin
 if not exists(select 1 from pg_trigger where tgrelid='destruktion_meta.devos_fleet_claim_h205f22'::regclass and tgname='aa_native_capacity_claim_guard_v2') then
  create trigger aa_native_capacity_claim_guard_v2 before insert on destruktion_meta.devos_fleet_claim_h205f22
   for each row execute function destruktion_meta.native_coding_capacity_claim_gate_v2();
 end if;
end $$;
