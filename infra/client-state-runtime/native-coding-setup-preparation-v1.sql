-- Additive ADMIN repository preparation. Existing v1 operation rows and their
-- ambiguous custody remain unchanged; this creates no task, lease or permit.
do $review$
declare t oid:=to_regclass('destruktion_meta.native_coding_setup_preparation_h205f22');f record;spec jsonb;actual jsonb;n integer;
 expected jsonb:='[{"signature":"destruktion_meta.native_coding_setup_preparation_v1(text,jsonb,jsonb,jsonb,jsonb)","args":["p_action","p_actor","p_selector","p_binding","p_value"],"result":"jsonb","sha256":"ab33b42cbaf56d24db6de581a21c401863453033748a8e48aa6996b03087bd4f"},{"signature":"destruktion_meta.native_coding_setup_preparation_guard_v1()","args":[],"result":"trigger","sha256":"0f87c24f67a0365702267a35edaf9fed3aeffc20340747bdd595ae2fa16825f2"}]'::jsonb;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_setup_preparation_migration_owner_required';end if;
 select count(*) into n from jsonb_array_elements(expected) x where to_regprocedure(x->>'signature') is not null;
 if t is null and n=0 then return;end if;
 if t is null or n<>jsonb_array_length(expected) then raise exception 'native_setup_preparation_partial_install';end if;
 for spec in select value from jsonb_array_elements(expected) loop
  select p.*,l.lanname into f from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(spec->>'signature');
  if f.proowner<>to_regrole('state_owner') or f.prorettype<>to_regtype(spec->>'result') or f.proretset or f.prokind<>'f'
   or f.proisstrict or f.proleakproof or f.proparallel<>'u' or f.prosecdef or f.provolatile<>'v' or f.lanname<>'plpgsql'
   or f.pronargdefaults<>0 or f.provariadic<>0 or coalesce(to_jsonb(f.proargnames),'[]'::jsonb) is distinct from spec->'args'
   or f.proconfig is distinct from array['search_path=pg_catalog, public, destruktion_meta']::text[]
   or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee<>f.proowner)
   or encode(extensions.digest(convert_to(replace(f.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex') is distinct from spec->>'sha256'
  then raise exception 'native_setup_preparation_function_requires_review';end if;
 end loop;
 select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) into actual
 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=t and a.attnum>0 and not a.attisdropped;
 if actual is distinct from '[["operation_id","uuid",true,null],["custody_id","uuid",true,null],["binding","jsonb",true,null],["state","text",true,null],["readback","jsonb",false,null],["reason","text",false,null],["created_at","timestamp with time zone",true,"clock_timestamp()"],["updated_at","timestamp with time zone",true,"clock_timestamp()"]]'::jsonb
 then raise exception 'native_setup_preparation_table_requires_review';end if;
 select jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) order by conname) into actual from pg_constraint where conrelid=t and convalidated and not condeferrable;
 if actual is distinct from '[["native_coding_setup_preparation_h205f22_operation_id_fkey","FOREIGN KEY (operation_id) REFERENCES destruktion_meta.native_coding_setup_operation_h205f22(operation_id)"],["native_coding_setup_preparation_h205f22_pkey","PRIMARY KEY (operation_id)"],["native_coding_setup_preparation_h205f22_state_check","CHECK ((state = ANY (ARRAY[''RESERVED''::text, ''PROVEN''::text, ''AMBIGUOUS''::text])))"]]'::jsonb
  or (select count(*) from pg_constraint where conrelid=t)<>3 then raise exception 'native_setup_preparation_constraints_require_review';end if;
 if exists(select 1 from pg_class c where c.oid=t and (c.relkind<>'r' or c.relispartition or not c.relrowsecurity or c.relforcerowsecurity or c.relowner<>to_regrole('state_owner')
  or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee<>c.relowner)))
  or exists(select 1 from pg_attribute a,lateral aclexplode(a.attacl) acl where a.attrelid=t and acl.grantee<>to_regrole('state_owner'))
  or exists(select 1 from pg_policy where polrelid=t) or exists(select 1 from pg_rewrite where ev_class=t)
  or (select count(*) from pg_index where indrelid=t)<>1
 then raise exception 'native_setup_preparation_authority_requires_review';end if;
 if (select count(*) from pg_trigger where tgrelid=t and not tgisinternal)<>2
  or not exists(select 1 from pg_trigger where tgrelid=t and tgname='native_setup_preparation_write_guard_v1' and tgfoid=to_regprocedure('destruktion_meta.native_coding_setup_preparation_guard_v1()')
   and tgtype=31 and tgenabled='O' and tgqual is null and tgnargs=0 and tgconstraint=0 and not tgdeferrable and not tginitdeferred)
  or not exists(select 1 from pg_trigger where tgrelid=t and tgname='native_setup_preparation_truncate_guard_v1' and tgfoid=to_regprocedure('destruktion_meta.native_coding_setup_preparation_guard_v1()')
   and tgtype=34 and tgenabled='O' and tgqual is null and tgnargs=0 and tgconstraint=0 and not tgdeferrable and not tginitdeferred)
 then raise exception 'native_setup_preparation_triggers_require_review';end if;
end $review$;

create table if not exists destruktion_meta.native_coding_setup_preparation_h205f22(
 operation_id uuid primary key references destruktion_meta.native_coding_setup_operation_h205f22(operation_id),
 custody_id uuid not null,
 binding jsonb not null,
 state text not null check(state in ('RESERVED','PROVEN','AMBIGUOUS')),
 readback jsonb,
 reason text,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
alter table destruktion_meta.native_coding_setup_preparation_h205f22 enable row level security;
revoke all on destruktion_meta.native_coding_setup_preparation_h205f22 from public,anon,authenticated,service_role;

create or replace function destruktion_meta.native_coding_setup_preparation_guard_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta as $guard$
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_setup_preparation_state_owner_required' using errcode='42501';end if;
 if tg_op in ('DELETE','TRUNCATE') then raise exception 'native_setup_preparation_history_retained' using errcode='55000';end if;
 if tg_op='INSERT' then
  if new.state<>'RESERVED' or new.readback is not null or new.reason is not null then raise exception 'native_setup_preparation_initial_state_invalid' using errcode='23514';end if;
 elsif old.state<>'RESERVED' or new.state not in ('PROVEN','AMBIGUOUS')
  or new.operation_id is distinct from old.operation_id or new.custody_id is distinct from old.custody_id
  or new.binding is distinct from old.binding or new.created_at is distinct from old.created_at
 then raise exception 'native_setup_preparation_history_immutable' using errcode='55000';end if;
 return new;
end $guard$;
revoke all on function destruktion_meta.native_coding_setup_preparation_guard_v1() from public,anon,authenticated,service_role;

create or replace function destruktion_meta.native_coding_setup_preparation_v1(p_action text,p_actor jsonb,p_selector jsonb,p_binding jsonb,p_value jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta as $preparation$
declare op jsonb;intent jsonb;approved jsonb;original jsonb;expected jsonb;keys text[];deadline bigint;stamp timestamptz;target text;
 r destruktion_meta.native_coding_setup_preparation_h205f22%rowtype;inserted boolean:=false;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_setup_preparation_state_owner_required' using errcode='42501';end if;
 if coalesce(p_action,'') not in ('READ','AUTHORIZE','RESERVE','TERMINAL') then raise exception 'native_setup_preparation_action_invalid' using errcode='23514';end if;
 -- Reuse only the existing current ADMIN/repository lifecycle authority. No
 -- managed admission, claim lookup or fabricated leased PROJECT_CREATE route.
 op:=destruktion_meta.native_coding_setup_operation_v1('READ',p_actor,p_selector,'{}'::jsonb)->'operation';
 if op is null or op='null'::jsonb then raise exception 'native_setup_preparation_operation_required' using errcode='42501';end if;
 intent:=op->'intent';approved:=intent->'preparation';original:=intent->'original_request';
 if coalesce(jsonb_typeof(approved)<>'object' or not approved ?& array['schema','source','choices']
  or (select count(*) from jsonb_object_keys(approved))<>3 or approved->>'schema'<>'metaengine.native-coding.repository-preparation.v1'
  or jsonb_typeof(approved->'source')<>'object' or not approved->'source' ?& array['head','artifact_sha256']
  or (select count(*) from jsonb_object_keys(approved->'source'))<>2
  or coalesce(approved#>>'{source,head}','')!~'^[a-f0-9]{40}$' or coalesce(approved#>>'{source,artifact_sha256}','')!~'^[a-f0-9]{64}$'
  or approved->'choices' is distinct from '{"worktree":"CREATE_LOCKED_OPERATION_WORKTREE","branch":"CREATE_OPERATION_BRANCH"}'::jsonb,true)
 then raise exception 'native_setup_preparation_approval_required' using errcode='42501';end if;
 keys:=array['schema','action','requestId','requestDigest','bodyDigest','signedAt','deadlineAt','hostInstanceId','hostPid'];
 if coalesce(jsonb_typeof(original)<>'object' or not original ?& keys or (select count(*) from jsonb_object_keys(original))<>cardinality(keys)
  or original->>'schema'<>'metaengine.native-coding.setup-original-request.v1' or original->>'action'<>'BEGIN_NATIVE_SETUP_V1'
  or (original->>'requestId')::uuid is null or coalesce(original->>'requestDigest','')!~'^[a-f0-9]{64}$'
  or coalesce(original->>'bodyDigest','')!~'^[a-f0-9]{64}$' or original->>'hostInstanceId' is distinct from intent->>'host_instance_id'
  or original->'hostPid' is distinct from intent->'host_pid' or jsonb_typeof(original->'deadlineAt')<>'number'
  or coalesce(original->>'signedAt','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$',true)
 then raise exception 'native_setup_preparation_original_request_required' using errcode='42501';end if;
 deadline:=(original->>'deadlineAt')::bigint;stamp:=(original->>'signedAt')::timestamptz;
 if deadline<1 or deadline>9007199254740991 or deadline>floor(extract(epoch from stamp)*1000)::bigint+30000
 then raise exception 'native_setup_preparation_deadline_invalid' using errcode='23514';end if;
 expected:=jsonb_build_object('schema','metaengine.native-coding.repository-preparation-binding.v1',
  'operation_id',op->'operation_id','custody_id',op->'custody_id','workspace_id',intent->'workspace_id','actor',intent->'actor',
  'repository',intent->'repository','repository_scope_sha256',intent->'repository_scope_sha256',
  'repo_root_identity_sha256',intent->'repo_root_identity_sha256','managed_root_identity_sha256',intent->'managed_root_identity_sha256',
  'source',approved->'source','choices',approved->'choices','original_request',original,'postgres',intent->'postgres',
  'host_instance_id',intent->'host_instance_id','host_pid',intent->'host_pid');
 if op->>'custody_id' is null or expected is distinct from p_binding then raise exception 'native_setup_preparation_binding_changed' using errcode='42501';end if;
 if p_action in ('AUTHORIZE','RESERVE') and (op->>'state'<>'RUNNING' or deadline<=floor(extract(epoch from clock_timestamp())*1000)::bigint)
 then raise exception 'native_setup_preparation_authority_expired' using errcode='55000';end if;
 select * into r from destruktion_meta.native_coding_setup_preparation_h205f22 where operation_id=(op->>'operation_id')::uuid for update;
 if found and (r.binding is distinct from expected or r.custody_id is distinct from (op->>'custody_id')::uuid)
 then raise exception 'native_setup_preparation_effect_conflict' using errcode='23505';end if;
 if p_action='RESERVE' and not found then
  insert into destruktion_meta.native_coding_setup_preparation_h205f22(operation_id,custody_id,binding,state)
   values((op->>'operation_id')::uuid,(op->>'custody_id')::uuid,expected,'RESERVED') returning * into r;inserted:=true;
 elsif p_action='TERMINAL' then
  if r.operation_id is null or r.state<>'RESERVED' or coalesce(p_value->>'state','') not in ('PROVEN','AMBIGUOUS')
   or coalesce(p_value->>'state'='PROVEN' and p_value->'reason' is distinct from 'null'::jsonb,false)
   or coalesce(length(p_value->>'reason')>240,false)
  then raise exception 'native_setup_preparation_terminal_invalid' using errcode='23514';end if;
  if p_value->>'state'='PROVEN' then
   -- This is a recorded outcome from the original producer's readback, never
   -- permission, descendant settlement, prepared state or historical release.
   target:=intent#>>'{repository,managed_root}'||case when position(chr(92) in intent#>>'{repository,managed_root}')>0 then chr(92) else '/' end||'native-setup--'||(op->>'operation_id');
   keys:=array['schema','operation_id','custody_id','worktree_path','head','branch','lock_reason','preparation_binding_sha256','automatic_retry_allowed','authority_effect'];
   if coalesce(jsonb_typeof(p_value->'readback')<>'object' or not p_value->'readback' ?& keys
    or (select count(*) from jsonb_object_keys(p_value->'readback'))<>cardinality(keys)
    or p_value#>>'{readback,schema}'<>'metaengine.native-coding.repository-preparation-readback.v1'
    or p_value#>>'{readback,operation_id}' is distinct from op->>'operation_id' or p_value#>>'{readback,custody_id}' is distinct from op->>'custody_id'
    or p_value#>>'{readback,worktree_path}' is distinct from target or p_value#>>'{readback,head}' is distinct from approved#>>'{source,head}'
    or p_value#>>'{readback,branch}' is distinct from 'refs/heads/metaengine/setup/'||(op->>'operation_id')
    or p_value#>>'{readback,lock_reason}' is distinct from 'METAENGINE:setup:'||(op->>'operation_id')||':custody:'||(op->>'custody_id')
    or coalesce(p_value#>>'{readback,preparation_binding_sha256}','')!~'^[a-f0-9]{64}$'
    or p_value#>'{readback,automatic_retry_allowed}' is distinct from 'false'::jsonb or p_value#>'{readback,authority_effect}' is distinct from 'false'::jsonb,true)
   then raise exception 'native_setup_preparation_readback_invalid' using errcode='23514';end if;
  end if;
  update destruktion_meta.native_coding_setup_preparation_h205f22 set state=p_value->>'state',readback=p_value->'readback',reason=p_value->>'reason',updated_at=clock_timestamp()
   where operation_id=r.operation_id returning * into r;
 end if;
 return jsonb_build_object('binding',expected,'created',inserted,'effect',case when r.operation_id is null then null else to_jsonb(r) end);
end $preparation$;
revoke all on function destruktion_meta.native_coding_setup_preparation_v1(text,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

do $triggers$begin
 if not exists(select 1 from pg_trigger where tgrelid='destruktion_meta.native_coding_setup_preparation_h205f22'::regclass and tgname='native_setup_preparation_write_guard_v1') then
  create trigger native_setup_preparation_write_guard_v1 before insert or update or delete on destruktion_meta.native_coding_setup_preparation_h205f22
   for each row execute function destruktion_meta.native_coding_setup_preparation_guard_v1();
 end if;
 if not exists(select 1 from pg_trigger where tgrelid='destruktion_meta.native_coding_setup_preparation_h205f22'::regclass and tgname='native_setup_preparation_truncate_guard_v1') then
  create trigger native_setup_preparation_truncate_guard_v1 before truncate on destruktion_meta.native_coding_setup_preparation_h205f22
   for each statement execute function destruktion_meta.native_coding_setup_preparation_guard_v1();
 end if;
end $triggers$;
