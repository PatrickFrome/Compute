-- UNREGISTERED. Attest BEFORE any change; refuse partial/tampered replay.
do $review$
declare expected jsonb:='[{"signature":"destruktion_meta.native_coding_callback_publication_valid_v1(jsonb)","args":["v"],"return_type":"boolean","language":"plpgsql","definer":false,"volatile":"i","defaults":0,"sha256":"556dff78af2f58f9680badde2897248b2208a3390421e50eb97c46511fe20797","old_sha256":null,"public_context":false},{"signature":"destruktion_meta.native_coding_callback_publication_guard_v1()","args":[],"return_type":"trigger","language":"plpgsql","definer":false,"volatile":"v","defaults":0,"sha256":"25ad1c6e288ce37f872b5d7dceb4525f8bca898792e7411d6987164173b9bd38","old_sha256":null,"public_context":false},{"signature":"destruktion_meta.native_coding_callback_publication_cas_v1(uuid,bigint,uuid,jsonb,jsonb)","args":["p_task","p_generation","p_reservation","p_expected","p_value"],"return_type":"jsonb","language":"plpgsql","definer":false,"volatile":"v","defaults":0,"sha256":"e127166f1f1754affaeb2a40707a0064fb799cf3ef672080a43a0ae8b5685cfa","old_sha256":null,"public_context":false},{"signature":"destruktion_meta.native_coding_callback_publication_read_v1(uuid,bigint,uuid)","args":["p_task","p_generation","p_reservation"],"return_type":"jsonb","language":"plpgsql","definer":false,"volatile":"v","defaults":0,"sha256":"120566f6e16f0a6529177b1c840cc6a7b5d1d810db579ad91ee729705914d455","old_sha256":null,"public_context":false},{"signature":"destruktion_meta.native_coding_reserve_v1(uuid,uuid,bigint,text,text,bigint,uuid,text,text)","args":["p_workspace","p_task","p_generation","p_agent","p_target","p_epoch","p_reservation","p_host_incarnation","p_scope_sha256"],"return_type":"jsonb","language":"plpgsql","definer":true,"volatile":"v","defaults":0,"sha256":"46f8375181bbc7cb0aff3616a37e9341732e8e3cae65de4370f9ad381cb64277","old_sha256":"648bcb43281432c67fe83d9e47f3dfdd828ab8b6f4e095bf6bf6e998747343c9","public_context":false},{"signature":"destruktion_meta.native_coding_advance_v1(uuid,bigint,uuid,text,text,text,text,text,text,text)","args":["p_task","p_generation","p_reservation","p_scope_sha256","p_host_incarnation","p_from","p_to","p_evidence_sha256","p_critic_sha256","p_checkpoint_sha256"],"return_type":"jsonb","language":"plpgsql","definer":true,"volatile":"v","defaults":2,"sha256":"37dd144d751feadf216bc2517d67ac540714a6b18553cc5d3a9d35172119da87","old_sha256":"17d8aeebee4b0609d7645d22ba303221abe654491649a16bcb62101e9a7a112f","public_context":false},{"signature":"destruktion_meta.native_coding_read_v1(uuid,uuid,bigint)","args":["p_workspace","p_task","p_generation"],"return_type":"jsonb","language":"sql","definer":true,"volatile":"s","defaults":0,"sha256":"81b06429e44cd7688ceacd48af4f7de6500402f6eb46020178c732e5cedb2c9e","old_sha256":"d0165f2d09e78fdddaee82a132a51b9c7ba025fd5e7052c96da185cb6c4c094c","public_context":false},{"signature":"public.native_coding_execution_context_v1(uuid,text,uuid,bigint)","args":["p_workspace","p_client","p_task","p_generation"],"return_type":"jsonb","language":"plpgsql","definer":true,"volatile":"v","defaults":0,"sha256":"f9c590be915d6994f348fa825d337e70c467094e8eae724a2e11f07e5f7fa57d","old_sha256":"1c4cbad72b47952872baa4cfedc5467192dab5b0c9bf8c46ba6ced2c0835f428","public_context":true}]'::jsonb;
 spec jsonb;f record;tr record;col boolean;n integer;hash text;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_callback_migration_owner_required';end if;
 if not exists(select 1 from pg_class c where c.oid='destruktion_meta.native_coding_execution_h205f22'::regclass
  and c.relowner=to_regrole('state_owner') and c.relkind='r' and c.relpersistence='p' and not c.relispartition and c.relrowsecurity and not c.relforcerowsecurity
  and not exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee<>c.relowner))
  or exists(select 1 from pg_policy where polrelid='destruktion_meta.native_coding_execution_h205f22'::regclass)
  or exists(select 1 from pg_attribute a,lateral aclexplode(a.attacl) x where a.attrelid='destruktion_meta.native_coding_execution_h205f22'::regclass and x.grantee<>to_regrole('state_owner'))
 then raise exception 'native_callback_execution_authority_requires_review';end if;
 select exists(select 1 from pg_attribute where attrelid='destruktion_meta.native_coding_execution_h205f22'::regclass and attname='callback_publication' and not attisdropped) into col;
 select count(*) into n from jsonb_array_elements(expected) x where x->>'old_sha256' is null and to_regprocedure(x->>'signature') is not null;
 select * into tr from pg_trigger where tgrelid='destruktion_meta.native_coding_execution_h205f22'::regclass and tgname='native_callback_publication_guard_v1';
 if (col and (n<>4 or tr.oid is null)) or (not col and (n<>0 or tr.oid is not null)) then raise exception 'native_callback_partial_install';end if;
 for spec in select value from jsonb_array_elements(expected) loop
  if not col and spec->>'old_sha256' is null then continue;end if;
  select p.*,l.lanname into f from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(spec->>'signature');
  hash:=case when col then spec->>'sha256' else spec->>'old_sha256' end;
  if f.oid is null or f.proowner<>to_regrole('state_owner') or f.prorettype<>to_regtype(spec->>'return_type') or f.proretset or f.prokind<>'f'
   or f.proisstrict or f.proleakproof or f.proparallel<>'u' or f.provolatile<>spec->>'volatile' or f.lanname<>spec->>'language'
   or f.prosecdef is distinct from (spec->>'definer')::boolean or f.pronargdefaults<>(spec->>'defaults')::int or f.provariadic<>0
   or coalesce(to_jsonb(f.proargnames),'[]'::jsonb) is distinct from spec->'args'
   or f.proconfig is distinct from array['search_path=pg_catalog, destruktion_meta']::text[]
   or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee<>f.proowner and not ((spec->>'public_context')::boolean and a.grantee=to_regrole('service_role') and a.privilege_type='EXECUTE' and not a.is_grantable))
   or ((spec->>'public_context')::boolean and not has_function_privilege('service_role',f.oid,'EXECUTE'))
   or encode(extensions.digest(convert_to(replace(f.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex')<>hash
   or ((spec->>'defaults')::int>0 and pg_get_expr(f.proargdefaults,0) is distinct from 'NULL::text, NULL::text')
  then raise exception 'native_callback_function_requires_review:%',spec->>'signature';end if;
 end loop;
 if not col then return;end if;
 if exists(select 1 from pg_attribute a where a.attrelid='destruktion_meta.native_coding_execution_h205f22'::regclass and a.attname='callback_publication'
  and (a.atttypid<>to_regtype('jsonb') or a.attnotnull or a.attidentity<>'' or a.attgenerated<>''
   or exists(select 1 from pg_attrdef d where d.adrelid=a.attrelid and d.adnum=a.attnum)))
 then raise exception 'native_callback_column_requires_review';end if;
 if not exists(select 1 from pg_constraint where conrelid='destruktion_meta.native_coding_execution_h205f22'::regclass and conname='native_callback_publication_shape_v1'
  and contype='c' and convalidated and not condeferrable and not connoinherit
  and pg_get_expr(conbin,conrelid)='destruktion_meta.native_coding_callback_publication_valid_v1(callback_publication)')
 then raise exception 'native_callback_constraint_requires_review';end if;
 if tr.tgfoid<>to_regprocedure('destruktion_meta.native_coding_callback_publication_guard_v1()') or tr.tgtype<>31 or tr.tgenabled<>'O' or tr.tgisinternal
  or tr.tgqual is not null or tr.tgnargs<>0 or tr.tgconstraint<>0 or tr.tgdeferrable or tr.tginitdeferred
 then raise exception 'native_callback_trigger_requires_review';end if;
end $review$;
-- END CALLBACK PUBLICATION REPLAY ATTESTATION
-- UNREGISTERED SOURCE PREREQUISITE. No IPC action or effect/send capability.
-- A WAL anchor in the EXISTING execution evidence row, not a new allocator.
alter table destruktion_meta.native_coding_execution_h205f22 add column if not exists callback_publication jsonb;

create or replace function destruktion_meta.native_coding_callback_publication_valid_v1(v jsonb)
returns boolean language plpgsql immutable security invoker set search_path=pg_catalog,destruktion_meta as $$
declare r jsonb;c jsonb;k text;
begin
 if v is null then return true;end if;
 if jsonb_typeof(v)<>'object' or octet_length(v::text)>16384
  or (select array_agg(key order by key) from jsonb_object_keys(v) key)<>array['cursor','job_sha256','root','schema']
  or v->>'schema' is distinct from 'metaengine.native-coding.callback-publication.v1' then return false;end if;
 r:=v->'root';c:=v->'cursor';
 if jsonb_typeof(r)<>'object' or jsonb_typeof(c)<>'object'
  or (select array_agg(key order by key) from jsonb_object_keys(r) key)<>array['admin_grant_epoch','attempt_sha256','base_sha','bound_sha256','client_id','device_id','header_sha256','host_birth','host_instance_id','host_pid','key_sha256','lease_binding_sha256','main_birth','owner_epoch','owner_sha256','permit_id','permit_sha256','pg_identity','prefix_identity_sha256','prompt_sha256','reserve_request_id','role','run_id','scope']
  or (select array_agg(key order by key) from jsonb_object_keys(c) key)<>array['dispatch_fenced','head_sha256','intent_count','record_count','revision']
  or jsonb_typeof(r->'scope')<>'object' or jsonb_typeof(r->'pg_identity')<>'object'
  or (select array_agg(key order by key) from jsonb_object_keys(r->'scope') key)<>array['agent_generation_epoch','agent_id','host_incarnation','lease_generation','reservation_id','scope_sha256','target_id','task_id','workspace_id']
  or (select array_agg(key order by key) from jsonb_object_keys(r->'pg_identity') key)<>array['data_directory_identity_sha256','pid','process_incarnation_id','started_at','system_identifier'] then return false;end if;
 foreach k in array array['run_id','device_id','permit_id','host_instance_id','reserve_request_id'] loop
  if coalesce(r->>k,'')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then return false;end if;
 end loop;
 foreach k in array array['attempt_sha256','header_sha256','bound_sha256','key_sha256','lease_binding_sha256','owner_sha256','permit_sha256','prefix_identity_sha256','prompt_sha256'] loop
  if coalesce(r->>k,'')!~'^[a-f0-9]{64}$' then return false;end if;
 end loop;
 foreach k in array array['host_pid','owner_epoch','admin_grant_epoch'] loop
  if jsonb_typeof(r->k)<>'number' or coalesce(r->>k,'')!~'^[1-9][0-9]{0,14}$' then return false;end if;
 end loop;
 foreach k in array array['host_birth','main_birth'] loop
  if coalesce(r->>k,'')!~'^pid:[1-9][0-9]*:created_100ns:[1-9][0-9]{16,18}$' then return false;end if;
 end loop;
 if r->>'host_birth' not like 'pid:'||(r->>'host_pid')||':created_100ns:%'
  or r->>'main_birth' is distinct from r->'scope'->>'host_incarnation'
  or coalesce(r->>'base_sha','')!~'^[a-f0-9]{40}$' or coalesce(r->>'role','') not in ('IMPLEMENTER','CRITIC')
  or length(coalesce(r->>'client_id','')) not between 1 and 256
  or coalesce(r->'pg_identity'->>'system_identifier','')!~'^[0-9]{1,20}$'
  or coalesce(r->'pg_identity'->>'started_at','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
  or jsonb_typeof(r->'pg_identity'->'pid') is distinct from 'number'
  or coalesce(r->'pg_identity'->>'pid','')!~'^[1-9][0-9]{0,9}$'
  or coalesce(r->'pg_identity'->>'process_incarnation_id','')!~'^pid:[1-9][0-9]*:created_100ns:[1-9][0-9]{16,18}$'
  or coalesce(r->'pg_identity'->>'data_directory_identity_sha256','')!~'^[a-f0-9]{64}$'
  or coalesce(c->>'head_sha256','')!~'^[a-f0-9]{64}$' or jsonb_typeof(c->'dispatch_fenced')<>'boolean'
  or not(v->'job_sha256'='null'::jsonb or coalesce(v->>'job_sha256','')~'^[a-f0-9]{64}$') then return false;end if;
 foreach k in array array['revision','record_count','intent_count'] loop
  if jsonb_typeof(c->k)<>'number' or coalesce(c->>k,'')!~'^(0|[1-9][0-9]{0,14})$' then return false;end if;
 end loop;
 return (c->>'record_count')::bigint>=2 and (c->>'intent_count')::bigint<=(c->>'record_count')::bigint-2;
end $$;

do $$begin
 if not exists(select 1 from pg_constraint where conrelid='destruktion_meta.native_coding_execution_h205f22'::regclass and conname='native_callback_publication_shape_v1') then
  alter table destruktion_meta.native_coding_execution_h205f22 add constraint native_callback_publication_shape_v1
   check(destruktion_meta.native_coding_callback_publication_valid_v1(callback_publication));
 end if;
end $$;

create or replace function destruktion_meta.native_coding_callback_publication_guard_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog,destruktion_meta as $$
declare a jsonb;b jsonb;r jsonb;j destruktion_meta.native_coding_job_registration_h205f22;p jsonb;
begin
 if tg_op='DELETE' then
  if old.callback_publication is not null then raise exception 'native_callback_publication_immutable';end if;
  return old;
 end if;
 if tg_op='INSERT' then
  if new.callback_publication is not null then raise exception 'native_callback_publication_requires_reserved';end if;
  return new;
 end if;
 if old.callback_publication is null and new.callback_publication is null then return new;end if;
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_callback_publication_owner_required' using errcode='42501';end if;
 if new.callback_publication is null or not destruktion_meta.native_coding_callback_publication_valid_v1(new.callback_publication) then raise exception 'native_callback_publication_invalid';end if;
 r:=new.callback_publication->'root';a:=old.callback_publication->'cursor';b:=new.callback_publication->'cursor';
 if r->'scope' is distinct from jsonb_build_object('workspace_id',new.workspace_id,'task_id',new.task_id,'lease_generation',new.lease_generation,
   'reservation_id',new.reservation_id,'agent_id',new.agent_id,'target_id',new.target_id,'agent_generation_epoch',new.agent_generation_epoch,
   'host_incarnation',new.host_incarnation,'scope_sha256',new.scope_sha256)
  or (to_jsonb(old)-array['callback_publication','state','updated_at','job_proof_sha256','result_sha256','critic_proof_sha256','checkpoint_sha256'])
     is distinct from (to_jsonb(new)-array['callback_publication','state','updated_at','job_proof_sha256','result_sha256','critic_proof_sha256','checkpoint_sha256'])
 then raise exception 'native_callback_publication_scope_changed';end if;
 if old.callback_publication is null then
  if old.state<>'RESERVED' or new.state<>'RESERVED' or new.job_proof_sha256 is not null or new.callback_publication->'job_sha256'<>'null'::jsonb
   or (b->>'revision')::bigint<>0 then raise exception 'native_callback_publication_initial_invalid';end if;
 elsif old.callback_publication->'root' is distinct from r then raise exception 'native_callback_publication_root_immutable';
 elsif new.callback_publication is distinct from old.callback_publication then
  if old.callback_publication->'job_sha256' is distinct from new.callback_publication->'job_sha256'
   or (b->>'revision')::bigint<>(a->>'revision')::bigint+1 or (b->>'record_count')::bigint<=(a->>'record_count')::bigint
   or (b->>'intent_count')::bigint<(a->>'intent_count')::bigint
   or (a->>'dispatch_fenced')::boolean and not (b->>'dispatch_fenced')::boolean
  then raise exception 'native_callback_publication_cursor_invalid';end if;
 end if;
 -- Existing signed-job registration is authoritative only in its original
 -- ATTEMPTED transition; no prelaunch fake job and no changed signed envelope.
 if old.state='RESERVED' and new.state='ATTEMPTED' then
  select * into j from destruktion_meta.native_coding_job_registration_h205f22 where task_id=new.task_id and lease_generation=new.lease_generation;
  p:=j.job_envelope->'payload';
  if not found or j.run_id::text<>r->>'run_id' or j.permit_id::text<>r->>'permit_id' or j.job_envelope_sha256<>new.job_proof_sha256
   or p->>'prompt_sha256'<>r->>'prompt_sha256' or p->>'role'<>r->>'role'
   or p->'worktree'->>'base_sha'<>r->>'base_sha' or p->'host_process'->>'process_incarnation_id'<>r->>'main_birth'
   or p->>'owner_epoch'<>r->>'owner_epoch' or p->>'device_id'<>r->>'device_id'
  then raise exception 'native_callback_publication_job_changed';end if;
  new.callback_publication:=jsonb_set(new.callback_publication,'{job_sha256}',to_jsonb(j.job_envelope_sha256));
 elsif new.job_proof_sha256 is distinct from old.job_proof_sha256 or new.callback_publication->'job_sha256' is distinct from old.callback_publication->'job_sha256' and old.callback_publication is not null then
  raise exception 'native_callback_publication_job_immutable';
 end if;
 return new;
end $$;
drop trigger if exists native_callback_publication_guard_v1 on destruktion_meta.native_coding_execution_h205f22;
create trigger native_callback_publication_guard_v1 before insert or update or delete on destruktion_meta.native_coding_execution_h205f22
 for each row execute function destruktion_meta.native_coding_callback_publication_guard_v1();

create or replace function destruktion_meta.native_coding_callback_publication_cas_v1(p_task uuid,p_generation bigint,p_reservation uuid,p_expected jsonb,p_value jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,destruktion_meta as $$
declare e destruktion_meta.native_coding_execution_h205f22;p destruktion_meta.native_coding_operator_permit_h205f22;d record;t destruktion_meta.devos_fleet_task_h205f22;r jsonb;control jsonb;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_callback_publication_owner_required' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'serializable' or current_setting('synchronous_commit')<>'on'
  or current_setting('fsync')<>'on' or current_setting('full_page_writes')<>'on'
  or not exists(select 1 from pg_class where oid='destruktion_meta.native_coding_execution_h205f22'::regclass and relkind='r' and relpersistence='p' and not relispartition)
 then raise exception 'native_callback_publication_wal_unqualified';end if;
 -- Existing allocator order: task, claim, execution. Never a second pool/lease.
 select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=p_task for share;
 if not found or t.lease_generation<>p_generation or t.state not in ('LEASED','RUNNING') or t.lease_expires_at<=clock_timestamp() then raise exception 'native_callback_publication_lease_changed';end if;
 perform 1 from destruktion_meta.devos_fleet_claim_h205f22 where task_id=p_task and lease_generation=p_generation and state='ACTIVE'
  and workspace_id=t.workspace_id and agent_id=t.lease_agent_id and target_id=t.lease_target_id and agent_generation_epoch=t.lease_agent_generation_epoch and expires_at>clock_timestamp() for share;
 if not found then raise exception 'native_callback_publication_claim_changed';end if;
 select * into e from destruktion_meta.native_coding_execution_h205f22 where task_id=p_task and lease_generation=p_generation for update;
 if not found or e.reservation_id<>p_reservation or e.state not in ('RESERVED','ATTEMPTED') or e.callback_publication is distinct from p_expected
  or e.workspace_id<>t.workspace_id or e.agent_id<>t.lease_agent_id or e.target_id<>t.lease_target_id or e.agent_generation_epoch<>t.lease_agent_generation_epoch then raise exception 'native_callback_publication_cas_mismatch' using errcode='40001';end if;
 if not destruktion_meta.native_coding_callback_publication_valid_v1(p_value) or p_value is null then raise exception 'native_callback_publication_invalid';end if;
 r:=p_value->'root';
 select * into p from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=(r->>'permit_id')::uuid for share;
 if not found or p.revoked_at is not null or p.permit_id::text is distinct from t.task_spec#>>'{native_coding,permit_id}' or p.agent_generation_epoch<>e.agent_generation_epoch or p.workspace_id<>e.workspace_id or p.device_id::text<>r->>'device_id' or p.client_id<>r->>'client_id'
  or p.admin_grant_epoch::text<>r->>'admin_grant_epoch' or p.permit->>'owner_epoch'<>r->>'owner_epoch'
  or (p.permit->>'expires_at')::timestamptz<=clock_timestamp() or p.agent_id<>e.agent_id or 'codex-cli:'||p.provider_id::text<>e.target_id
 then raise exception 'native_callback_publication_permit_changed';end if;
 select * into d from public.compute_fabric_a2_browser_device_h205f22 where device_id=p.device_id and client_id=p.client_id for share;
 if not found or not d.active or d.revoked_at is not null or d.access_tier<>'ADMIN' or d.admin_revoked_at is not null or d.admin_grant_epoch<>p.admin_grant_epoch
  or d.key_fingerprint_sha256<>r->>'key_sha256' or not(d.admin_scopes @> '["CONTROL_PLANE","DEVOS"]'::jsonb)
 then raise exception 'native_callback_publication_grant_changed';end if;
 perform 1 from destruktion_meta.project_task_h205f22 pt join destruktion_meta.project_run_h205f22 pr using(project_id)
  where pt.task_id=p_task and pr.project_id::text=p.permit->>'project_id' and pr.workspace_id=p.workspace_id
   and pr.device_id=p.device_id and pr.client_id=p.client_id and pr.admin_grant_epoch=p.admin_grant_epoch and pr.state='ACTIVE' for share of pt,pr;
 if not found then raise exception 'native_callback_publication_project_changed';end if;
 control:=public.devos_environment_state_v1(p.workspace_id);
 if control->'refill_enabled' is distinct from 'true'::jsonb or control->'supervisor_admission_enabled' is distinct from 'true'::jsonb
  or control->'owner_stop'='true'::jsonb or control->>'state'='STOPPED' then raise exception 'native_callback_publication_control_changed';end if;
 if r->'pg_identity'->>'system_identifier'<>(select system_identifier::text from pg_catalog.pg_control_system())
  or r->'pg_identity'->>'started_at'<>to_char(pg_postmaster_start_time() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
 then raise exception 'native_callback_publication_pg_changed';end if;
 update destruktion_meta.native_coding_execution_h205f22 set callback_publication=p_value where task_id=p_task and lease_generation=p_generation returning * into e;
 return e.callback_publication;
end $$;

create or replace function destruktion_meta.native_coding_callback_publication_read_v1(p_task uuid,p_generation bigint,p_reservation uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,destruktion_meta as $$
declare v jsonb;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_callback_publication_owner_required' using errcode='42501';end if;
 select callback_publication into v from destruktion_meta.native_coding_execution_h205f22 where task_id=p_task and lease_generation=p_generation and reservation_id=p_reservation;
 if not found then raise exception 'native_callback_publication_reservation_missing';end if;
 return v;
end $$;

-- V1 algorithms/signatures/shape preserved. New private column never enters v1 wire.
create or replace function destruktion_meta.native_coding_reserve_v1(
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
  return jsonb_build_object('inserted',v_new,'execution',(to_jsonb(v_row)-'callback_publication'));
end $$;

create or replace function destruktion_meta.native_coding_advance_v1(
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
  return (to_jsonb(v_row)-'callback_publication');
end $$;

create or replace function destruktion_meta.native_coding_read_v1(p_workspace uuid,p_task uuid,p_generation bigint)
returns jsonb language sql stable security definer
set search_path = pg_catalog,destruktion_meta as $$
  select (to_jsonb(e)-'callback_publication') from destruktion_meta.native_coding_execution_h205f22 e
    where workspace_id=p_workspace and task_id=p_task and lease_generation=p_generation
$$;
revoke all on function destruktion_meta.native_coding_callback_publication_valid_v1(jsonb),
 destruktion_meta.native_coding_callback_publication_guard_v1(),
 destruktion_meta.native_coding_callback_publication_cas_v1(uuid,bigint,uuid,jsonb,jsonb),
 destruktion_meta.native_coding_callback_publication_read_v1(uuid,bigint,uuid),
 destruktion_meta.native_coding_reserve_v1(uuid,uuid,bigint,text,text,bigint,uuid,text,text),
 destruktion_meta.native_coding_advance_v1(uuid,bigint,uuid,text,text,text,text,text,text,text),
 destruktion_meta.native_coding_read_v1(uuid,uuid,bigint) from public,anon,authenticated,service_role;

-- Public v1 context keeps its existing service_role EXECUTE grant and exact shape.
create or replace function public.native_coding_execution_context_v1(p_workspace uuid,p_client text,p_task uuid,p_generation bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $$
declare j destruktion_meta.native_coding_job_registration_h205f22; t destruktion_meta.devos_fleet_task_h205f22;
  e destruktion_meta.native_coding_execution_h205f22; context jsonb;
begin
  select * into j from destruktion_meta.native_coding_job_registration_h205f22 where task_id=p_task and lease_generation=p_generation;
  if not found then raise exception 'native_coding_job_unregistered' using errcode='55000'; end if;
  context:=public.native_coding_admission_context_v1(p_workspace,p_client,j.permit_id);
  select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=p_task and workspace_id=p_workspace and lease_generation=p_generation;
  if not found then raise exception 'native_coding_lease_fenced' using errcode='55000'; end if;
  perform 1 from destruktion_meta.devos_fleet_claim_h205f22 c where c.task_id=p_task and c.workspace_id=p_workspace
    and c.lease_generation=p_generation and c.state='ACTIVE' and c.expires_at>clock_timestamp()
    and c.agent_id=t.lease_agent_id and c.target_id=t.lease_target_id and c.tab_id=t.lease_tab_id
    and c.agent_generation_epoch=t.lease_agent_generation_epoch;
  if not found then raise exception 'native_coding_lease_fenced' using errcode='55000'; end if;
  select * into e from destruktion_meta.native_coding_execution_h205f22 where task_id=p_task and lease_generation=p_generation and workspace_id=p_workspace;
  return context||jsonb_build_object('job_registration',to_jsonb(j)-'canonical_job_envelope'-'canonical_result_receipt',
    'lease',jsonb_build_object('workspace_id',t.workspace_id,'task_id',t.task_id,'agent_id',t.lease_agent_id,
      'lease_generation',t.lease_generation,'target_id',t.lease_target_id,'tab_id',t.lease_tab_id,
      'agent_generation_epoch',t.lease_agent_generation_epoch,'expires_at',t.lease_expires_at,'state',t.state),
    'execution',(to_jsonb(e)-'callback_publication'));
end $$;
