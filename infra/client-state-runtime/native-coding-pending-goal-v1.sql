-- Reviewed additive admission schema; refuse unknown or partially installed definitions.
do $review$
declare o record;actual jsonb;
begin
 if to_regclass('destruktion_meta.native_coding_pending_goal_h205f22') is null and (to_regprocedure('destruktion_meta.native_coding_pending_goal_v1(jsonb,jsonb,jsonb,boolean)') is not null or to_regprocedure('destruktion_meta.native_coding_pending_goal_fence_v1()') is not null or exists(select 1 from pg_trigger where tgname='aa_native_pending_goal_fence_trg' and not tgisinternal)) then raise exception 'native_pending_goal_partial_install';end if;
 if to_regclass('destruktion_meta.native_coding_pending_goal_h205f22') is not null then
  select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) into actual from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='destruktion_meta.native_coding_pending_goal_h205f22'::regclass and a.attnum>0 and not a.attisdropped;
  if actual is distinct from '[["request_id", "uuid", true, null], ["preparation_id", "uuid", true, null], ["configuration_sha256", "text", true, null], ["input", "jsonb", true, null], ["configuration", "jsonb", true, null], ["preparation", "jsonb", true, null], ["workspace_id", "uuid", true, null], ["project_id", "uuid", true, null], ["root_task_id", "uuid", true, null], ["receipt", "jsonb", true, null], ["created_at", "timestamp with time zone", true, "clock_timestamp()"]]'::jsonb then raise exception 'native_pending_goal_table_requires_review';end if;
  select jsonb_agg(jsonb_build_object('conname',conname,'def',pg_get_constraintdef(oid)) order by conname) into actual from pg_constraint where conrelid='destruktion_meta.native_coding_pending_goal_h205f22'::regclass and convalidated and not condeferrable;
  if actual is distinct from '[{"conname": "native_coding_pending_goal_h205f22_configuration_sha256_check", "def": "CHECK ((configuration_sha256 ~ ''^[a-f0-9]{64}$''::text))"}, {"conname": "native_coding_pending_goal_h205f22_pkey", "def": "PRIMARY KEY (request_id)"}, {"conname": "native_coding_pending_goal_h205f22_preparation_id_key", "def": "UNIQUE (preparation_id)"}, {"conname": "native_coding_pending_goal_h205f22_project_id_fkey", "def": "FOREIGN KEY (project_id) REFERENCES destruktion_meta.project_run_h205f22(project_id)"}, {"conname": "native_coding_pending_goal_h205f22_project_id_key", "def": "UNIQUE (project_id)"}, {"conname": "native_coding_pending_goal_h205f22_root_task_id_fkey", "def": "FOREIGN KEY (root_task_id) REFERENCES destruktion_meta.devos_fleet_task_h205f22(task_id)"}, {"conname": "native_coding_pending_goal_h205f22_root_task_id_key", "def": "UNIQUE (root_task_id)"}]'::jsonb then raise exception 'native_pending_goal_constraints_require_review';end if;
  if (select count(*) from pg_constraint where conrelid='destruktion_meta.native_coding_pending_goal_h205f22'::regclass)<>7 or exists(select 1 from pg_policy where polrelid='destruktion_meta.native_coding_pending_goal_h205f22'::regclass) or not (select relrowsecurity from pg_class where oid='destruktion_meta.native_coding_pending_goal_h205f22'::regclass) then raise exception 'native_pending_goal_table_authority_requires_review';end if;
  if exists(select 1 from pg_class c where c.oid='destruktion_meta.native_coding_pending_goal_h205f22'::regclass and (c.relkind<>'r' or c.relowner<>to_regrole('state_owner') or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl where acl.grantee<>c.relowner))) or exists(select 1 from pg_attribute a, lateral aclexplode(a.attacl) acl where a.attrelid='destruktion_meta.native_coding_pending_goal_h205f22'::regclass and acl.grantee<>to_regrole('state_owner')) or (select count(*) from pg_trigger where tgrelid='destruktion_meta.native_coding_pending_goal_h205f22'::regclass and not tgisinternal)<>1 then raise exception 'native_pending_goal_table_authority_requires_review';end if;
 end if;
end $review$;
do $review$
declare f record;
begin
 select p.*,l.lanname into f from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure('destruktion_meta.native_coding_pending_goal_fence_v1()');
 if not found then
  if to_regclass('destruktion_meta.native_coding_pending_goal_h205f22') is not null then raise exception 'native_pending_goal_partial_install';end if;
  return;
 end if;
 if f.proowner<>to_regrole('state_owner') or f.prorettype<>to_regtype('trigger') or f.prokind<>'f' or f.proisstrict or f.proleakproof or f.proparallel<>'u' or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) acl where acl.grantee<>f.proowner) or f.prosecdef is distinct from true or f.provolatile<>'v' or f.lanname<>'plpgsql' or f.proconfig is distinct from ARRAY['search_path=pg_catalog, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(f.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex')<>'a15afc875e0480f839c200a2f4596e955b752ac6d151f1a7c7e8e5d468eb4073'
 then raise exception 'native_pending_goal_function_requires_review:destruktion_meta.native_coding_pending_goal_fence_v1()';end if;
end $review$;
do $review$
declare f record;
begin
 select p.*,l.lanname into f from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure('destruktion_meta.native_coding_pending_goal_v1(jsonb,jsonb,jsonb,boolean)');
 if not found then
  if to_regclass('destruktion_meta.native_coding_pending_goal_h205f22') is not null then raise exception 'native_pending_goal_partial_install';end if;
  return;
 end if;
 if f.proowner<>to_regrole('state_owner') or f.prorettype<>to_regtype('jsonb') or f.prokind<>'f' or f.proisstrict or f.proleakproof or f.proparallel<>'u' or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) acl where acl.grantee<>f.proowner) or f.prosecdef is distinct from false or f.provolatile<>'v' or f.lanname<>'plpgsql' or f.proconfig is distinct from ARRAY['search_path=pg_catalog, public, destruktion_meta']::text[]
  or encode(extensions.digest(convert_to(replace(f.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex')<>'41935d9113f68e4d96f7893a807d505d153304728787a66b3fc63a81b3139b5c'
 then raise exception 'native_pending_goal_function_requires_review:destruktion_meta.native_coding_pending_goal_v1(jsonb,jsonb,jsonb,boolean)';end if;
end $review$;
do $review$
declare t record;
begin
 select * into t from pg_trigger where tgrelid=to_regclass('destruktion_meta.native_coding_pending_goal_h205f22') and tgname='aa_native_pending_goal_fence_trg' and not tgisinternal;
 if not found then
  if to_regclass('destruktion_meta.native_coding_pending_goal_h205f22') is not null then raise exception 'native_pending_goal_partial_install';end if;
  return;
 end if;
 if t.tgfoid is distinct from to_regprocedure('destruktion_meta.native_coding_pending_goal_fence_v1()') or t.tgtype<>27 or t.tgenabled<>'O' or t.tgnargs<>0 or t.tgqual is not null or t.tgattr<>''::int2vector
 then raise exception 'native_pending_goal_trigger_requires_review:destruktion_meta.native_coding_pending_goal_h205f22';end if;
end $review$;
do $review$
declare t record;
begin
 select * into t from pg_trigger where tgrelid=to_regclass('destruktion_meta.devos_fleet_task_h205f22') and tgname='aa_native_pending_goal_fence_trg' and not tgisinternal;
 if not found then
  if to_regclass('destruktion_meta.native_coding_pending_goal_h205f22') is not null then raise exception 'native_pending_goal_partial_install';end if;
  return;
 end if;
 if t.tgfoid is distinct from to_regprocedure('destruktion_meta.native_coding_pending_goal_fence_v1()') or t.tgtype<>31 or t.tgenabled<>'O' or t.tgnargs<>0 or t.tgqual is not null or t.tgattr<>''::int2vector
 then raise exception 'native_pending_goal_trigger_requires_review:destruktion_meta.devos_fleet_task_h205f22';end if;
end $review$;
do $review$
declare t record;
begin
 select * into t from pg_trigger where tgrelid=to_regclass('destruktion_meta.project_run_h205f22') and tgname='aa_native_pending_goal_fence_trg' and not tgisinternal;
 if not found then
  if to_regclass('destruktion_meta.native_coding_pending_goal_h205f22') is not null then raise exception 'native_pending_goal_partial_install';end if;
  return;
 end if;
 if t.tgfoid is distinct from to_regprocedure('destruktion_meta.native_coding_pending_goal_fence_v1()') or t.tgtype<>31 or t.tgenabled<>'O' or t.tgnargs<>0 or t.tgqual is not null or t.tgattr<>''::int2vector
 then raise exception 'native_pending_goal_trigger_requires_review:destruktion_meta.project_run_h205f22';end if;
end $review$;
do $review$
declare t record;
begin
 select * into t from pg_trigger where tgrelid=to_regclass('destruktion_meta.project_task_h205f22') and tgname='aa_native_pending_goal_fence_trg' and not tgisinternal;
 if not found then
  if to_regclass('destruktion_meta.native_coding_pending_goal_h205f22') is not null then raise exception 'native_pending_goal_partial_install';end if;
  return;
 end if;
 if t.tgfoid is distinct from to_regprocedure('destruktion_meta.native_coding_pending_goal_fence_v1()') or t.tgtype<>31 or t.tgenabled<>'O' or t.tgnargs<>0 or t.tgqual is not null or t.tgattr<>''::int2vector
 then raise exception 'native_pending_goal_trigger_requires_review:destruktion_meta.project_task_h205f22';end if;
end $review$;
do $review$
declare t record;
begin
 select * into t from pg_trigger where tgrelid=to_regclass('destruktion_meta.devos_fleet_claim_h205f22') and tgname='aa_native_pending_goal_fence_trg' and not tgisinternal;
 if not found then
  if to_regclass('destruktion_meta.native_coding_pending_goal_h205f22') is not null then raise exception 'native_pending_goal_partial_install';end if;
  return;
 end if;
 if t.tgfoid is distinct from to_regprocedure('destruktion_meta.native_coding_pending_goal_fence_v1()') or t.tgtype<>23 or t.tgenabled<>'O' or t.tgnargs<>0 or t.tgqual is not null or t.tgattr<>''::int2vector
 then raise exception 'native_pending_goal_trigger_requires_review:destruktion_meta.devos_fleet_claim_h205f22';end if;
end $review$;
do $review$
declare t record;
begin
 select * into t from pg_trigger where tgrelid=to_regclass('destruktion_meta.client_v1_goal_request_h205f22') and tgname='aa_native_pending_goal_fence_trg' and not tgisinternal;
 if not found then
  if to_regclass('destruktion_meta.native_coding_pending_goal_h205f22') is not null then raise exception 'native_pending_goal_partial_install';end if;
  return;
 end if;
 if t.tgfoid is distinct from to_regprocedure('destruktion_meta.native_coding_pending_goal_fence_v1()') or t.tgtype<>23 or t.tgenabled<>'O' or t.tgnargs<>0 or t.tgqual is not null or t.tgattr<>''::int2vector
 then raise exception 'native_pending_goal_trigger_requires_review:destruktion_meta.client_v1_goal_request_h205f22';end if;
end $review$;
do $review$
declare t record;
begin
 select * into t from pg_trigger where tgrelid=to_regclass('destruktion_meta.native_coding_seed_h205f22') and tgname='aa_native_pending_goal_fence_trg' and not tgisinternal;
 if not found then
  if to_regclass('destruktion_meta.native_coding_pending_goal_h205f22') is not null then raise exception 'native_pending_goal_partial_install';end if;
  return;
 end if;
 if t.tgfoid is distinct from to_regprocedure('destruktion_meta.native_coding_pending_goal_fence_v1()') or t.tgtype<>23 or t.tgenabled<>'O' or t.tgnargs<>0 or t.tgqual is not null or t.tgattr<>''::int2vector
 then raise exception 'native_pending_goal_trigger_requires_review:destruktion_meta.native_coding_seed_h205f22';end if;
end $review$;
do $review$
declare t record;
begin
 select * into t from pg_trigger where tgrelid=to_regclass('destruktion_meta.project_child_proposal_h205f22') and tgname='aa_native_pending_goal_fence_trg' and not tgisinternal;
 if not found then
  if to_regclass('destruktion_meta.native_coding_pending_goal_h205f22') is not null then raise exception 'native_pending_goal_partial_install';end if;
  return;
 end if;
 if t.tgfoid is distinct from to_regprocedure('destruktion_meta.native_coding_pending_goal_fence_v1()') or t.tgtype<>23 or t.tgenabled<>'O' or t.tgnargs<>0 or t.tgqual is not null or t.tgattr<>''::int2vector
 then raise exception 'native_pending_goal_trigger_requires_review:destruktion_meta.project_child_proposal_h205f22';end if;
end $review$;
-- Private PREPARED workspace admission only. No Owner, permit, lease or activation.
create table if not exists destruktion_meta.native_coding_pending_goal_h205f22 (
 request_id uuid primary key, preparation_id uuid not null unique,
 configuration_sha256 text not null check(configuration_sha256 ~ '^[a-f0-9]{64}$'),
 input jsonb not null, configuration jsonb not null, preparation jsonb not null,
 workspace_id uuid not null, project_id uuid not null unique references destruktion_meta.project_run_h205f22(project_id),
 root_task_id uuid not null unique references destruktion_meta.devos_fleet_task_h205f22(task_id),
 receipt jsonb not null, created_at timestamptz not null default clock_timestamp()
);
alter table destruktion_meta.native_coding_pending_goal_h205f22 enable row level security;
revoke all on destruktion_meta.native_coding_pending_goal_h205f22 from public,anon,authenticated,service_role;

create or replace function destruktion_meta.native_coding_pending_goal_fence_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $fn$
declare pending boolean:=false;
begin
 if TG_TABLE_NAME='native_coding_pending_goal_h205f22' then
  raise exception 'native_pending_goal_binding_immutable' using errcode='55000';
 elsif TG_TABLE_NAME='devos_fleet_task_h205f22' then
  if TG_OP<>'INSERT' then
   pending:=OLD.task_spec ? 'native_pending_goal' or exists(select 1 from destruktion_meta.native_coding_pending_goal_h205f22 where root_task_id=OLD.task_id);
   if pending and (TG_OP='DELETE' or (to_jsonb(NEW)-'updated_at') is distinct from (to_jsonb(OLD)-'updated_at'))
   then raise exception 'native_pending_goal_activation_required' using errcode='55000';end if;
  end if;
  if TG_OP<>'DELETE' and exists(select 1 from destruktion_meta.native_coding_pending_goal_h205f22 g where g.root_task_id<>NEW.task_id
    and (g.project_id::text=NEW.task_spec#>>'{project_continuity,project_id}' or g.project_id::text=NEW.task_spec#>>'{native_coding,project_id}'
      or g.project_id::text=NEW.task_spec#>>'{native_pending_goal,project_id}' or g.root_task_id::text=NEW.task_spec#>>'{project_continuity,parent_task_id}' or g.root_task_id::text=NEW.task_spec#>>'{project_continuity,root_task_id}' or g.request_id::text=NEW.task_spec#>>'{project_continuity,root_request_id}'))
   then raise exception 'native_pending_goal_child_forbidden' using errcode='55000';end if;
  if TG_OP<>'DELETE' and NEW.task_spec ? 'native_pending_goal' then
   if NEW.state<>'BLOCKED' or NEW.lease_generation<>0 or NEW.lease_agent_id is not null or NEW.lease_target_id is not null
    or NEW.lease_tab_id is not null or NEW.lease_agent_generation_epoch is not null or NEW.lease_expires_at is not null
    or NEW.result_checkpoint_id is not null or NEW.result_summary is not null or NEW.result_sha256 is not null
   then raise exception 'native_pending_goal_nonrunnable_required' using errcode='55000';end if;
  end if;
 elsif TG_TABLE_NAME='project_run_h205f22' then
  if TG_OP<>'INSERT' then
   pending:=exists(select 1 from destruktion_meta.native_coding_pending_goal_h205f22 where project_id=OLD.project_id)
    or exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 where task_id=OLD.root_task_id and task_spec ? 'native_pending_goal');
   if pending and (TG_OP='DELETE' or (to_jsonb(NEW)-'last_seq'-'last_reconciled_at') is distinct from (to_jsonb(OLD)-'last_seq'-'last_reconciled_at'))
   then raise exception 'native_pending_goal_activation_required' using errcode='55000';end if;
  end if;
  if TG_OP<>'DELETE' and NEW.state<>'PAUSED' and exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 where task_id=NEW.root_task_id and task_spec ? 'native_pending_goal')
  then raise exception 'native_pending_goal_paused_required' using errcode='55000';end if;
 elsif TG_TABLE_NAME='project_task_h205f22' then
  if TG_OP<>'INSERT' and exists(select 1 from destruktion_meta.native_coding_pending_goal_h205f22 where project_id=OLD.project_id)
   and (TG_OP='DELETE' or NEW is distinct from OLD) then raise exception 'native_pending_goal_activation_required' using errcode='55000';end if;
  if TG_OP<>'DELETE' and exists(select 1 from destruktion_meta.project_run_h205f22 p join destruktion_meta.devos_fleet_task_h205f22 t on t.task_id=p.root_task_id
   where p.project_id=NEW.project_id and t.task_spec ? 'native_pending_goal' and (NEW.task_id<>p.root_task_id or NEW.root_task_id<>p.root_task_id or NEW.parent_task_id is not null or NEW.depth<>0 or NEW.task_seq<>1))
  then raise exception 'native_pending_goal_activation_required' using errcode='55000';end if;
  if TG_OP<>'DELETE' and exists(select 1 from destruktion_meta.native_coding_pending_goal_h205f22 g
   where (g.root_task_id=NEW.parent_task_id or g.root_task_id=NEW.root_task_id) and g.project_id<>NEW.project_id)
  then raise exception 'native_pending_goal_child_forbidden' using errcode='55000';end if;
 elsif TG_TABLE_NAME='project_child_proposal_h205f22' then
  if exists(select 1 from destruktion_meta.native_coding_pending_goal_h205f22 g where g.project_id=NEW.project_id or g.root_task_id=NEW.parent_task_id or g.root_task_id=NEW.child_task_id)
  then raise exception 'native_pending_goal_child_forbidden' using errcode='55000';end if;
 elsif TG_TABLE_NAME='devos_fleet_claim_h205f22' then
  if exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 where task_id=NEW.task_id and task_spec ? 'native_pending_goal')
   or exists(select 1 from destruktion_meta.native_coding_pending_goal_h205f22 where root_task_id=NEW.task_id)
  then raise exception 'native_pending_goal_claim_forbidden' using errcode='55000';end if;
 else
  -- Shared UUID domain with Browser and legacy native goal admissions.
  perform pg_advisory_xact_lock(hashtextextended('client-v1-goal:'||NEW.request_id::text,0));
  if exists(select 1 from destruktion_meta.native_coding_pending_goal_h205f22 where request_id=NEW.request_id)
  then raise exception 'native_pending_goal_request_collision' using errcode='23505';end if;
 end if;
 if TG_OP='DELETE' then return OLD;end if;return NEW;
end $fn$;

create or replace function destruktion_meta.native_coding_pending_goal_v1(p_input jsonb,p_configuration jsonb,p_preparation jsonb,p_write boolean)
returns jsonb language plpgsql set search_path=pg_catalog,public,destruktion_meta as $fn$
declare d uuid;client text;epoch bigint;workspace uuid;request uuid;prep uuid;r destruktion_meta.native_coding_pending_goal_h205f22%rowtype;
 project uuid;root uuid;spec jsonb;specsha text;receipt jsonb;control jsonb;repository record;current_device record;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_pending_goal_state_owner_required' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'serializable' or current_setting('synchronous_commit')<>'on'
 then raise exception 'native_pending_goal_durable_transaction_required' using errcode='25000';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_input))<>4
  or not p_input ?& array['request_id','objective','preparation_id','configuration_sha256']
  or exists(select 1 from jsonb_each(p_input) where jsonb_typeof(value)<>'string')
  or nullif(p_input->>'objective','') is null or p_input->>'objective'<>btrim(p_input->>'objective')
  or char_length(p_input->>'objective')>480 or octet_length(p_input->>'objective')>1920
  or coalesce(p_input->>'configuration_sha256','') !~ '^[a-f0-9]{64}$'
 then raise exception 'native_pending_goal_input_invalid' using errcode='22023';end if;
 request:=(p_input->>'request_id')::uuid;prep:=(p_input->>'preparation_id')::uuid;
 d:=(p_preparation->>'device_id')::uuid;client:=p_preparation->>'client_id';epoch:=(p_preparation->>'preparation_grant_epoch')::bigint;
 workspace:=(p_configuration->>'workspace_id')::uuid;
 if request is null or prep is null or d is null or client is null or epoch is null or workspace is null
  or p_preparation->>'schema' is distinct from 'metaengine.native-coding.workspace-preparation-intent.v1'
  or p_preparation->>'preparation_id' is distinct from prep::text or p_configuration->>'preparation_id' is distinct from prep::text
  or p_preparation->>'configuration_sha256' is distinct from p_input->>'configuration_sha256'
  or p_preparation->>'workspace_id' is distinct from workspace::text
  or p_configuration->>'expires_at' is null or (p_configuration->>'expires_at')::timestamptz<=clock_timestamp()
  or coalesce(p_configuration#>>'{agents,0,worktree,base_sha}','') !~ '^[a-f0-9]{40}$'
 then raise exception 'native_pending_goal_preparation_invalid' using errcode='23514';end if;
 perform destruktion_meta.project_device_grant_h205f22(d,client,epoch);
 select dev.key_fingerprint_sha256 into current_device from public.compute_fabric_a2_browser_device_h205f22 dev
 join public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 pairing on pairing.token_hash=dev.enrollment_pairing_token_hash
 where dev.device_id=d and dev.client_id=client and pairing.active for share of dev,pairing;
 if not found or current_device.key_fingerprint_sha256 is distinct from p_preparation->>'device_key_fingerprint_sha256'
 then raise exception 'native_pending_goal_device_changed' using errcode='42501';end if;
 select * into repository from public.compute_fabric_a2_managed_project_repository_h205f22
 where coordination_workspace_id=workspace and device_id=d and client_id=client for share;
 if not found or repository.admin_grant_epoch<>epoch or repository.repo_id is distinct from p_configuration->>'repo_id'
  or repository.repo_root is distinct from p_configuration->>'repo_root' or repository.managed_root is distinct from p_configuration->>'managed_root'
 then raise exception 'native_pending_goal_workspace_denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('client-v1-goal:'||request::text,0));
 perform pg_advisory_xact_lock(hashtextextended('native-pending-preparation:'||prep::text,0));
 select * into r from destruktion_meta.native_coding_pending_goal_h205f22 where request_id=request or preparation_id=prep;
 if found then
  if r.input is distinct from p_input or r.configuration is distinct from p_configuration or r.preparation is distinct from p_preparation
  then raise exception 'native_pending_goal_request_collision' using errcode='23505';end if;
  if not exists(select 1 from destruktion_meta.devos_fleet_task_h205f22 t join destruktion_meta.project_run_h205f22 p on p.root_task_id=t.task_id
   where t.task_id=r.root_task_id and t.state='BLOCKED' and t.lease_generation=0 and p.project_id=r.project_id and p.state='PAUSED'
   and t.task_spec_sha256=r.receipt->>'task_spec_sha256' and p.goal=p_input->>'objective')
  then raise exception 'native_pending_goal_binding_changed' using errcode='23514';end if;
  return r.receipt;
 end if;
 if exists(select 1 from destruktion_meta.client_v1_goal_request_h205f22 where request_id=request)
  or exists(select 1 from destruktion_meta.native_coding_seed_h205f22 where request_id=request)
 then raise exception 'native_pending_goal_request_collision' using errcode='23505';end if;
 if p_write is not true then return null;end if;
 control:=public.devos_environment_state_v1(workspace);
 if control->'owner_stop'='true'::jsonb or control->>'state'='STOPPED' or control->'refill_enabled' is distinct from 'true'::jsonb
  or control->'supervisor_admission_enabled' is distinct from 'true'::jsonb
 then raise exception 'native_pending_goal_environment_fenced' using errcode='55000';end if;
 project:=gen_random_uuid();root:=gen_random_uuid();
 spec:=jsonb_build_object('schema','metaengine.devos.project-task-spec.v1','objective',p_input->>'objective','claim_class','READ_ONLY',
  'native_pending_goal',jsonb_build_object('schema','metaengine.native-coding.pending-goal-binding.v1','preparation_id',prep,'request_id',request,
   'configuration_sha256',p_input->>'configuration_sha256','project_id',project), 'automatic_retry_allowed',false,'authority_effect',false);
 specsha:=encode(extensions.digest(convert_to(spec::text,'UTF8'),'sha256'),'hex');
 -- Insert nonrunnable initially: never enqueue READY and pause afterward.
 insert into destruktion_meta.devos_fleet_task_h205f22(task_id,workspace_id,point_id,role,claim_class,base_sha,task_spec,task_spec_sha256,idempotency_key,state)
 values(root,workspace,'native.pending.'||replace(request::text,'-',''),'PLANNER','READ_ONLY',p_configuration#>>'{agents,0,worktree,base_sha}',spec,specsha,'native-pending:'||request,'BLOCKED');
 insert into destruktion_meta.project_run_h205f22(project_id,workspace_id,request_id,root_task_id,device_id,client_id,admin_grant_epoch,goal,state,max_depth,max_tasks,max_children)
 values(project,workspace,request,root,d,client,epoch,p_input->>'objective','PAUSED',null,null,null);
 insert into destruktion_meta.project_task_h205f22(task_id,project_id,task_seq,root_task_id,parent_task_id,depth) values(root,project,1,root,null,0);
 receipt:=jsonb_build_object('schema','metaengine.native-coding.pending-goal-admission.v1','state','PENDING_ACTIVATION',
  'preparation_id',prep,'configuration_sha256',p_input->>'configuration_sha256','request_id',request,'objective',p_input->>'objective',
  'workspace_id',workspace,'project_id',project,'root_task_id',root,'task_spec_sha256',specsha,'preparation_grant_epoch',epoch,
  'root_state','BLOCKED','project_state','PAUSED','owner_incarnation_verified',false,'execution_ready',false,
  'production_qualified',false,'automatic_retry_allowed',false,'authority_effect',false);
 insert into destruktion_meta.native_coding_pending_goal_h205f22(request_id,preparation_id,configuration_sha256,input,configuration,preparation,workspace_id,project_id,root_task_id,receipt)
 values(request,prep,p_input->>'configuration_sha256',p_input,p_configuration,p_preparation,workspace,project,root,receipt);
 perform destruktion_meta.project_append_h205f22(project,'NATIVE_GOAL_PENDING_ACTIVATION',root,0,client,null,null,null,
  receipt,'PRIVATE_NATIVE_PREPARED_GOAL',null,false,'pending:'||request);
 return receipt;
end $fn$;
create or replace trigger aa_native_pending_goal_fence_trg before update or delete on destruktion_meta.native_coding_pending_goal_h205f22 for each row execute function destruktion_meta.native_coding_pending_goal_fence_v1();
create or replace trigger aa_native_pending_goal_fence_trg before insert or update or delete on destruktion_meta.devos_fleet_task_h205f22 for each row execute function destruktion_meta.native_coding_pending_goal_fence_v1();
create or replace trigger aa_native_pending_goal_fence_trg before insert or update or delete on destruktion_meta.project_run_h205f22 for each row execute function destruktion_meta.native_coding_pending_goal_fence_v1();
create or replace trigger aa_native_pending_goal_fence_trg before insert or update or delete on destruktion_meta.project_task_h205f22 for each row execute function destruktion_meta.native_coding_pending_goal_fence_v1();
create or replace trigger aa_native_pending_goal_fence_trg before insert or update on destruktion_meta.devos_fleet_claim_h205f22 for each row execute function destruktion_meta.native_coding_pending_goal_fence_v1();
create or replace trigger aa_native_pending_goal_fence_trg before insert or update on destruktion_meta.client_v1_goal_request_h205f22 for each row execute function destruktion_meta.native_coding_pending_goal_fence_v1();
create or replace trigger aa_native_pending_goal_fence_trg before insert or update on destruktion_meta.native_coding_seed_h205f22 for each row execute function destruktion_meta.native_coding_pending_goal_fence_v1();
create or replace trigger aa_native_pending_goal_fence_trg before insert or update on destruktion_meta.project_child_proposal_h205f22 for each row execute function destruktion_meta.native_coding_pending_goal_fence_v1();
revoke all on function destruktion_meta.native_coding_pending_goal_fence_v1(),destruktion_meta.native_coding_pending_goal_v1(jsonb,jsonb,jsonb,boolean) from public,anon,authenticated,service_role;
