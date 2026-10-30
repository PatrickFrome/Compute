-- Additive-only source: never silently repair a partial, widened or unknown install.
do $review$
declare t oid:=to_regclass('destruktion_meta.native_coding_setup_operation_h205f22');
 f record;actual jsonb;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_setup_migration_owner_required';end if;
 select p.*,l.lanname into f from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure('destruktion_meta.native_coding_setup_operation_v1(text,jsonb,jsonb,jsonb)');
 if (t is null) is distinct from (f.oid is null) then raise exception 'native_setup_partial_install';end if;
 if t is null then return;end if;
 if f.proowner<>to_regrole('state_owner') or f.prorettype<>to_regtype('jsonb') or f.prokind<>'f' or f.proisstrict or f.proleakproof
  or f.proparallel<>'u' or f.prosecdef or f.provolatile<>'v' or f.lanname<>'plpgsql' or f.pronargdefaults<>0
  or f.proargnames is distinct from array['p_action','p_actor','p_input','p_value']::text[]
  or f.proconfig is distinct from array['search_path=pg_catalog, public, destruktion_meta']::text[]
  or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee<>f.proowner)
  or encode(extensions.digest(convert_to(replace(f.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex')<>'c170255b61a4ced28c8ff9573fbbec8f58cf920d888f68531a5afaed03773b44'
 then raise exception 'native_setup_function_requires_review';end if;
 select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) into actual
 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=t and a.attnum>0 and not a.attisdropped;
 if actual is distinct from '[["operation_id","uuid",true,null],["intent","jsonb",true,null],["state","text",true,null],["custody_id","uuid",false,null],["reason","text",false,null],["cleanup_state","text",true,"''HOLD''::text"],["created_at","timestamp with time zone",true,"clock_timestamp()"],["updated_at","timestamp with time zone",true,"clock_timestamp()"]]'::jsonb then raise exception 'native_setup_table_requires_review';end if;
 select jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) order by conname) into actual from pg_constraint where conrelid=t and convalidated and not condeferrable;
 if actual is distinct from '[["native_coding_setup_operation_h205f22_cleanup_state_check","CHECK ((cleanup_state = ANY (ARRAY[''HOLD''::text, ''DRAINED''::text])))"],["native_coding_setup_operation_h205f22_pkey","PRIMARY KEY (operation_id)"],["native_coding_setup_operation_h205f22_state_check","CHECK ((state = ANY (ARRAY[''INTENT''::text, ''RUNNING''::text, ''CANCEL_REQUESTED''::text, ''HOLD''::text, ''STOPPED''::text])))"]]'::jsonb or (select count(*) from pg_constraint where conrelid=t)<>3 then raise exception 'native_setup_constraints_require_review';end if;
 if exists(select 1 from pg_class c where c.oid=t and (c.relkind<>'r' or c.relispartition or not c.relrowsecurity or c.relforcerowsecurity or c.relowner<>to_regrole('state_owner')
  or exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee<>c.relowner)))
  or exists(select 1 from pg_attribute a,lateral aclexplode(a.attacl) acl where a.attrelid=t and acl.grantee<>to_regrole('state_owner'))
  or exists(select 1 from pg_policy where polrelid=t) or exists(select 1 from pg_trigger where tgrelid=t and not tgisinternal)
  or exists(select 1 from pg_rewrite where ev_class=t) or (select count(*) from pg_index where indrelid=t)<>1
 then raise exception 'native_setup_authority_requires_review';end if;
end $review$;
-- Own-PG lifecycle custody only. No task, lease, Owner, permit or readiness effects.
-- Existing ADMIN + repository registration remains the authority root.
create table if not exists destruktion_meta.native_coding_setup_operation_h205f22(
 operation_id uuid primary key,
 intent jsonb not null,
 state text not null check(state in ('INTENT','RUNNING','CANCEL_REQUESTED','HOLD','STOPPED')),
 custody_id uuid,
 reason text,
 cleanup_state text not null default 'HOLD' check(cleanup_state in ('HOLD','DRAINED')),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
alter table destruktion_meta.native_coding_setup_operation_h205f22 enable row level security;
revoke all on destruktion_meta.native_coding_setup_operation_h205f22 from public,anon,authenticated,service_role;

create or replace function destruktion_meta.native_coding_setup_operation_v1(p_action text,p_actor jsonb,p_input jsonb,p_value jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public,destruktion_meta as $function$
declare
 d uuid:=(p_actor->>'device_id')::uuid;client text:=p_actor->>'client_id';epoch bigint:=(p_actor->>'admin_grant_epoch')::bigint;
 op uuid:=(p_input->>'operation_id')::uuid;workspace uuid:=(p_input->>'workspace_id')::uuid;
 repository record;device record;r destruktion_meta.native_coding_setup_operation_h205f22%rowtype;inserted boolean:=false;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_setup_state_owner_required' using errcode='42501';end if;
 if coalesce(p_action,'') not in ('BEGIN','READ','CLAIM','CANCEL','TERMINAL') or op is null or workspace is null then raise exception 'native_setup_input_invalid' using errcode='23514';end if;
 perform destruktion_meta.project_device_grant_h205f22(d,client,epoch);
 select dev.key_fingerprint_sha256 into device from public.compute_fabric_a2_browser_device_h205f22 dev
 join public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 pairing on pairing.token_hash=dev.enrollment_pairing_token_hash
 where dev.device_id=d and dev.client_id=client and pairing.active for share of dev,pairing;
 if not found or device.key_fingerprint_sha256 is distinct from p_actor->>'key_fingerprint_sha256' then raise exception 'native_setup_device_changed' using errcode='42501';end if;
 select * into repository from public.compute_fabric_a2_managed_project_repository_h205f22
 where coordination_workspace_id=workspace and device_id=d and client_id=client and admin_grant_epoch=epoch for share;
 if not found then raise exception 'native_setup_repository_denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('native-setup-operation:'||op::text,0));
 -- Repository lock is only a short intent/transition lock, never held across a cold job.
 perform pg_advisory_xact_lock(hashtextextended('native-setup-repository:'||workspace::text,0));
 perform pg_advisory_xact_lock(hashtextextended('native-setup-physical-roots',0));
 select * into r from destruktion_meta.native_coding_setup_operation_h205f22 where operation_id=op for update;
 if found then
  if r.intent->'actor' is distinct from p_actor or r.intent->>'workspace_id' is distinct from workspace::text
   or r.intent#>>'{repository,repo_id}' is distinct from repository.repo_id
   or r.intent#>>'{repository,repo_root}' is distinct from repository.repo_root
   or r.intent#>>'{repository,managed_root}' is distinct from repository.managed_root
  then raise exception 'native_setup_operation_scope_changed' using errcode='42501';end if;
  if p_action='BEGIN' and r.intent is distinct from p_input then raise exception 'native_setup_operation_conflict' using errcode='23505';end if;
 elsif p_action='BEGIN' then
  if p_input->'actor' is distinct from p_actor or p_input#>>'{repository,repo_id}' is distinct from repository.repo_id
   or p_input#>>'{repository,repo_root}' is distinct from repository.repo_root or p_input#>>'{repository,managed_root}' is distinct from repository.managed_root
   or coalesce(p_input->>'repository_scope_sha256','')!~'^[a-f0-9]{64}$'
   or coalesce(p_input->>'repo_root_identity_sha256','')!~'^[a-f0-9]{64}$'
   or coalesce(p_input->>'managed_root_identity_sha256','')!~'^[a-f0-9]{64}$'
   or (p_input->>'host_instance_id')::uuid is null or coalesce((p_input->>'host_pid')::integer,0)<1
  then raise exception 'native_setup_intent_invalid' using errcode='23514';end if;
  -- Filesystem/drive/share roots are never permissible setup targets. Normalize
  -- separators and trim suffixes for overlap comparison, not path authority.
  if exists(select 1 from unnest(array[repository.repo_root,repository.managed_root]) r(root)
   where coalesce(root,'')='' or replace(root,chr(92),'/')~'^/+$|^[a-zA-Z]:/*$|^//[^/]+/[^/]+/*$')
  then raise exception 'native_setup_repository_roots_invalid' using errcode='23514';end if;
  if exists(select 1 from destruktion_meta.native_coding_setup_operation_h205f22 x,
   lateral unnest(array[x.intent#>>'{repository,repo_root}',x.intent#>>'{repository,managed_root}']) a(root),
   lateral unnest(array[p_input#>>'{repository,repo_root}',p_input#>>'{repository,managed_root}']) b(root)
   where x.cleanup_state='HOLD' and (position(rtrim(replace(lower(a.root),chr(92),'/'),'/')||'/' in rtrim(replace(lower(b.root),chr(92),'/'),'/')||'/')=1
    or position(rtrim(replace(lower(b.root),chr(92),'/'),'/')||'/' in rtrim(replace(lower(a.root),chr(92),'/'),'/')||'/')=1
    or x.intent->>'repo_root_identity_sha256' in (p_input->>'repo_root_identity_sha256',p_input->>'managed_root_identity_sha256')
    or x.intent->>'managed_root_identity_sha256' in (p_input->>'repo_root_identity_sha256',p_input->>'managed_root_identity_sha256')))
  then raise exception 'native_setup_physical_scope_held' using errcode='55000';end if;
  insert into destruktion_meta.native_coding_setup_operation_h205f22(operation_id,intent,state)values(op,p_input,'INTENT')returning * into r;inserted:=true;
 else return jsonb_build_object('created',false,'operation',null);
 end if;
 if p_action='CLAIM' then
  if r.state<>'INTENT' or r.custody_id is not null or r.intent->>'host_instance_id' is distinct from p_value->>'host_instance_id'
   or r.intent->>'host_pid' is distinct from p_value->>'host_pid' or (p_value->>'custody_id')::uuid is null
  then raise exception 'native_setup_custody_changed' using errcode='23514';end if;
  update destruktion_meta.native_coding_setup_operation_h205f22 set state='RUNNING',custody_id=(p_value->>'custody_id')::uuid,updated_at=clock_timestamp()where operation_id=op returning * into r;
 elsif p_action='CANCEL' and r.state in ('INTENT','RUNNING') then
  update destruktion_meta.native_coding_setup_operation_h205f22 set state='CANCEL_REQUESTED',reason='CANCEL_REQUESTED',updated_at=clock_timestamp()where operation_id=op returning * into r;
 elsif p_action='TERMINAL' then
  if r.state not in ('RUNNING','CANCEL_REQUESTED') or r.custody_id is distinct from (p_value->>'custody_id')::uuid
   or coalesce(p_value->>'state','') not in ('HOLD','STOPPED') or coalesce(p_value->>'cleanup_state','') not in ('HOLD','DRAINED')
   or coalesce(p_value->>'reason','') not in ('MATERIALIZATION_UNAVAILABLE','EVIDENCE_REQUIRED','CANCELLED','JOB_FAILED','CLEANUP_UNCONFIRMED')
   or p_value->>'state'='STOPPED' and (p_value->>'cleanup_state'<>'DRAINED' or p_value->>'reason'<>'CANCELLED')
  then raise exception 'native_setup_terminal_invalid' using errcode='23514';end if;
  update destruktion_meta.native_coding_setup_operation_h205f22 set state=p_value->>'state',reason=p_value->>'reason',cleanup_state=p_value->>'cleanup_state',updated_at=clock_timestamp()where operation_id=op returning * into r;
 end if;
 return jsonb_build_object('created',inserted,'operation',to_jsonb(r));
end $function$;
revoke all on function destruktion_meta.native_coding_setup_operation_v1(text,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
