-- Reviewed initial-anchor task fence. SQL registration does not mount execution or promote authority.
-- Existing native reconciliation retains execution identity. Confirmed commit
-- successors and rejected-review repairs enqueue NEW task IDs; browser-only
-- PRE_EFFECT_ABORTED requeue remains untouched. Never delete legacy evidence.
-- Apply inside one owned transaction. Parent task locks plus task uniqueness
-- serialize generations; a terminal state is not permission to replay a task.
lock table destruktion_meta.devos_fleet_task_h205f22,destruktion_meta.devos_fleet_claim_h205f22,
 destruktion_meta.native_coding_execution_h205f22,destruktion_meta.native_coding_job_registration_h205f22 in access exclusive mode;
do $review$
declare spec jsonb;f record;n integer;installed boolean;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_anchor_fence_migration_owner_required';end if;
 for spec in select value from jsonb_array_elements('[{"signature":"destruktion_meta.native_coding_callback_publication_guard_v1()","sha256":"25ad1c6e288ce37f872b5d7dceb4525f8bca898792e7411d6987164173b9bd38","definer":false,"volatility":"v","returns":"trigger"},{"signature":"destruktion_meta.native_coding_callback_publication_valid_v1(jsonb)","sha256":"556dff78af2f58f9680badde2897248b2208a3390421e50eb97c46511fe20797","definer":false,"volatility":"i","returns":"boolean"},{"signature":"destruktion_meta.native_coding_reserve_v1(uuid,uuid,bigint,text,text,bigint,uuid,text,text)","sha256":"46f8375181bbc7cb0aff3616a37e9341732e8e3cae65de4370f9ad381cb64277","definer":true,"volatility":"v","returns":"jsonb"},{"signature":"destruktion_meta.native_coding_advance_v1(uuid,bigint,uuid,text,text,text,text,text,text,text)","sha256":"37dd144d751feadf216bc2517d67ac540714a6b18553cc5d3a9d35172119da87","definer":true,"volatility":"v","returns":"jsonb"},{"signature":"destruktion_meta.native_coding_task_transition_guard_v1()","sha256":"b6a2dbc59dfce5e67ce4576962e4d0a64d1b80161bfc88ed8cbd37dd590d3053","definer":true,"volatility":"v","returns":"trigger"}]'::jsonb) loop
  select p.*,l.lanname into f from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(spec->>'signature');
  if f.oid is null or f.proowner<>to_regrole('state_owner') or f.lanname<>'plpgsql' or f.prokind<>'f'
   or f.prosecdef is distinct from (spec->>'definer')::boolean or f.provolatile<>spec->>'volatility' or f.prorettype<>to_regtype(spec->>'returns')
   or f.proconfig is distinct from array['search_path=pg_catalog, destruktion_meta']::text[]
   or encode(extensions.digest(convert_to(replace(f.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex')<>spec->>'sha256'
  then raise exception 'native_anchor_fence_predecessor_requires_review';end if;
 end loop;
 if exists(select 1 from destruktion_meta.native_coding_execution_h205f22 group by task_id having count(*)>1)
 then raise exception 'native_anchor_fence_duplicate_history_hold';end if;
 select exists(select 1 from pg_constraint where conrelid='destruktion_meta.native_coding_execution_h205f22'::regclass and conname='native_execution_one_task_v1') into installed;
 for spec in select value from jsonb_array_elements('[{"signature":"destruktion_meta.native_execution_task_fence_v1()","sha256":"a181b643cec866785f497b0072d2952267dbb2e546ee56d0057d280a022bb75e","table":"native_coding_execution_h205f22","trigger":"aa_native_execution_task_fence_v1","tgtype":31},{"signature":"destruktion_meta.native_job_initial_anchor_v1()","sha256":"a4e5c8eb2de226635354cbd79e38c9e26a3d8f10addd3d5bad491e67f97ef656","table":"native_coding_job_registration_h205f22","trigger":"aa_native_job_initial_anchor_v1","tgtype":31},{"signature":"destruktion_meta.native_claim_task_history_v1()","sha256":"3a4c93428e2d45d59f7aee770a82b359d2c019285fec1d347c82839ee86c708f","table":"devos_fleet_claim_h205f22","trigger":"aa_native_claim_task_history_v1","tgtype":7},{"signature":"destruktion_meta.native_running_anchor_v1()","sha256":"66dd2a4cb47830b20074856acff6c2d3ce52cf532a5956cd3f14ff80a169b4bf","table":"devos_fleet_task_h205f22","trigger":"aa_native_running_anchor_v1","tgtype":19}]'::jsonb) loop
  select p.*,l.lanname into f from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(spec->>'signature');
  if installed then
   if f.oid is null or f.proowner<>to_regrole('state_owner') or f.prosecdef or f.prorettype<>'trigger'::regtype
    or f.proconfig is distinct from array['search_path=pg_catalog, destruktion_meta']::text[]
    or f.lanname<>'plpgsql' or f.prokind<>'f' or f.provolatile<>'v' or f.proisstrict or f.proleakproof or f.proretset
    or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee<>f.proowner)
    or encode(extensions.digest(convert_to(replace(f.prosrc,E'\r\n',E'\n'),'UTF8'),'sha256'),'hex')<>spec->>'sha256'
    or not exists(select 1 from pg_trigger where tgrelid=('destruktion_meta.'||(spec->>'table'))::regclass and tgname=spec->>'trigger' and tgfoid=f.oid and tgenabled='O' and not tgisinternal and tgtype=(spec->>'tgtype')::smallint and tgnargs=0 and tgqual is null and tgattr=''::int2vector and tgconstraint=0 and tgargs=''::bytea)
   then raise exception 'native_anchor_fence_existing_requires_review';end if;
  elsif f.oid is not null or exists(select 1 from pg_trigger where tgrelid=('destruktion_meta.'||(spec->>'table'))::regclass and tgname=spec->>'trigger')
   then raise exception 'native_anchor_fence_partial_install';end if;
 end loop;
 if installed and not exists(select 1 from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attname='task_id'
  where c.conrelid='destruktion_meta.native_coding_execution_h205f22'::regclass and c.conname='native_execution_one_task_v1' and c.contype='u'
   and c.conkey=array[a.attnum]::smallint[] and c.convalidated and not c.condeferrable)
 then raise exception 'native_anchor_fence_unique_requires_review';end if;
end $review$;
do $$begin
 if not exists(select 1 from pg_constraint where conrelid='destruktion_meta.native_coding_execution_h205f22'::regclass and conname='native_execution_one_task_v1') then
  alter table destruktion_meta.native_coding_execution_h205f22 add constraint native_execution_one_task_v1 unique(task_id);
 end if;
end $$;
create or replace function destruktion_meta.native_execution_task_fence_v1() returns trigger language plpgsql security invoker set search_path=pg_catalog,destruktion_meta as $$
declare p jsonb;
begin
 if tg_op='DELETE' then raise exception 'native_execution_task_identity_retained';end if;
 if tg_op='INSERT' then
  if new.state<>'RESERVED' or new.callback_publication is not null or new.job_proof_sha256 is not null
   or new.result_sha256 is not null or new.critic_proof_sha256 is not null or new.checkpoint_sha256 is not null
  then raise exception 'native_execution_initial_reserved_required';end if;
  perform 1 from destruktion_meta.devos_fleet_task_h205f22 where task_id=new.task_id for update;
  if exists(select 1 from destruktion_meta.native_coding_execution_h205f22 where task_id=new.task_id and lease_generation<>new.lease_generation)
  then raise exception 'native_execution_task_history_hold';end if;
  return new;
 end if;
 if (to_jsonb(new)-array['callback_publication','state','updated_at','job_proof_sha256','result_sha256','critic_proof_sha256','checkpoint_sha256'])
  is distinct from (to_jsonb(old)-array['callback_publication','state','updated_at','job_proof_sha256','result_sha256','critic_proof_sha256','checkpoint_sha256'])
 then raise exception 'native_execution_task_identity_immutable';end if;
 if old.callback_publication is null and new.callback_publication is not null then
  p:=new.callback_publication;
  if p->'cursor'->'revision' is distinct from '0'::jsonb or p->'cursor'->'record_count' is distinct from '2'::jsonb
   or p->'cursor'->'intent_count' is distinct from '0'::jsonb or p->'cursor'->'dispatch_fenced' is distinct from 'false'::jsonb
   or p->'job_sha256' is distinct from 'null'::jsonb then raise exception 'native_execution_inert_anchor_required';end if;
 end if;
 if new.state='ATTEMPTED' and old.state is distinct from new.state then
  p:=old.callback_publication;
  if old.state<>'RESERVED' or p is null or not destruktion_meta.native_coding_callback_publication_valid_v1(p)
   or p->'cursor'->'revision' is distinct from '0'::jsonb or p->'cursor'->'record_count' is distinct from '2'::jsonb
   or p->'cursor'->'intent_count' is distinct from '0'::jsonb or p->'cursor'->'dispatch_fenced' is distinct from 'false'::jsonb
   or p->'job_sha256' is distinct from 'null'::jsonb then raise exception 'native_execution_inert_anchor_required';end if;
 end if;
 return new;
end $$;
revoke all on function destruktion_meta.native_execution_task_fence_v1() from public,anon,authenticated,service_role;
drop trigger if exists aa_native_execution_task_fence_v1 on destruktion_meta.native_coding_execution_h205f22;
create trigger aa_native_execution_task_fence_v1 before insert or update or delete on destruktion_meta.native_coding_execution_h205f22 for each row execute function destruktion_meta.native_execution_task_fence_v1();

create or replace function destruktion_meta.native_job_initial_anchor_v1() returns trigger language plpgsql security invoker set search_path=pg_catalog,destruktion_meta as $$
declare e destruktion_meta.native_coding_execution_h205f22;permit destruktion_meta.native_coding_operator_permit_h205f22;r jsonb;p jsonb;
begin
 if tg_op='DELETE' then raise exception 'native_job_identity_retained';end if;
 if tg_op='UPDATE' then
  if (to_jsonb(new)-array['result_receipt','canonical_result_receipt','result_receipt_sha256','result_registered_at'])
   is distinct from (to_jsonb(old)-array['result_receipt','canonical_result_receipt','result_receipt_sha256','result_registered_at'])
  then raise exception 'native_job_identity_immutable';end if;
  return new;
 end if;
 -- Same task lock used by W30/reserve/advance, before execution row locks.
 perform 1 from destruktion_meta.devos_fleet_task_h205f22 where task_id=new.task_id for update;
 select * into e from destruktion_meta.native_coding_execution_h205f22 where task_id=new.task_id and lease_generation=new.lease_generation for update;
 if new.result_receipt is not null or new.canonical_result_receipt is not null or new.result_receipt_sha256 is not null or new.result_registered_at is not null then raise exception 'native_job_initial_receipt_forbidden';end if;
 if not found or e.state<>'RESERVED' or e.callback_publication is null
  or not destruktion_meta.native_coding_callback_publication_valid_v1(e.callback_publication)
  or e.callback_publication->'cursor'->'revision' is distinct from '0'::jsonb
  or e.callback_publication->'cursor'->'record_count' is distinct from '2'::jsonb
  or e.callback_publication->'cursor'->'intent_count' is distinct from '0'::jsonb
  or e.callback_publication->'cursor'->'dispatch_fenced' is distinct from 'false'::jsonb
  or e.callback_publication->'job_sha256' is distinct from 'null'::jsonb
 then raise exception 'native_job_inert_anchor_required';end if;
 r:=e.callback_publication->'root';p:=new.job_envelope->'payload';
 select * into permit from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=new.permit_id for share;
 if not found or p->>'workspace_id' is distinct from e.workspace_id::text
  or p->>'agent_id' is distinct from e.agent_id or p->>'target_id' is distinct from e.target_id
  or p->>'agent_generation_epoch' is distinct from e.agent_generation_epoch::text
  or p->>'project_id' is distinct from permit.permit->>'project_id'
  or p->>'provider_id' is distinct from permit.provider_id::text
 then raise exception 'native_job_anchor_binding_changed';end if;
 if r->>'run_id' is distinct from new.run_id::text or r->>'permit_id' is distinct from new.permit_id::text
  or r->>'prompt_sha256' is distinct from p->>'prompt_sha256' or r->>'role' is distinct from p->>'role'
  or r->>'base_sha' is distinct from p#>>'{worktree,base_sha}' or r->>'main_birth' is distinct from p#>>'{host_process,process_incarnation_id}'
  or r->>'owner_epoch' is distinct from p->>'owner_epoch' or r->>'device_id' is distinct from p->>'device_id'
  or r#>>'{scope,task_id}' is distinct from new.task_id::text or r#>>'{scope,lease_generation}' is distinct from new.lease_generation::text
 then raise exception 'native_job_anchor_binding_changed';end if;
 return new;
end $$;
revoke all on function destruktion_meta.native_job_initial_anchor_v1() from public,anon,authenticated,service_role;
drop trigger if exists aa_native_job_initial_anchor_v1 on destruktion_meta.native_coding_job_registration_h205f22;
create trigger aa_native_job_initial_anchor_v1 before insert or update or delete on destruktion_meta.native_coding_job_registration_h205f22 for each row execute function destruktion_meta.native_job_initial_anchor_v1();

create or replace function destruktion_meta.native_claim_task_history_v1() returns trigger language plpgsql security invoker set search_path=pg_catalog,destruktion_meta as $$
begin
 if coalesce(new.target_id,'') not like 'codex-cli:%' then return new;end if;
 perform 1 from destruktion_meta.devos_fleet_task_h205f22 where task_id=new.task_id for update;
 if exists(select 1 from destruktion_meta.native_coding_execution_h205f22 where task_id=new.task_id)
 then raise exception 'native_claim_task_history_hold';end if;
 return new;
end $$;
revoke all on function destruktion_meta.native_claim_task_history_v1() from public,anon,authenticated,service_role;
drop trigger if exists aa_native_claim_task_history_v1 on destruktion_meta.devos_fleet_claim_h205f22;
create trigger aa_native_claim_task_history_v1 before insert on destruktion_meta.devos_fleet_claim_h205f22 for each row execute function destruktion_meta.native_claim_task_history_v1();

create or replace function destruktion_meta.native_running_anchor_v1() returns trigger language plpgsql security invoker set search_path=pg_catalog,destruktion_meta as $$
declare e destruktion_meta.native_coding_execution_h205f22;j destruktion_meta.native_coding_job_registration_h205f22;
begin
 if new.state<>'RUNNING' or old.state=new.state or (coalesce(new.lease_target_id,'') not like 'codex-cli:%' and not new.task_spec ? 'native_coding') then return new;end if;
 select * into e from destruktion_meta.native_coding_execution_h205f22 where task_id=new.task_id and lease_generation=new.lease_generation for share;
 select * into j from destruktion_meta.native_coding_job_registration_h205f22 where task_id=new.task_id and lease_generation=new.lease_generation for share;
 if e.callback_publication is null or not destruktion_meta.native_coding_callback_publication_valid_v1(e.callback_publication)
  or e.state not in ('ATTEMPTED','RESULT_READY') or j.run_id is null
  or e.callback_publication->>'job_sha256' is distinct from j.job_envelope_sha256
  or e.job_proof_sha256 is distinct from j.job_envelope_sha256
  or e.callback_publication#>>'{root,run_id}' is distinct from j.run_id::text
  or e.callback_publication#>'{cursor,dispatch_fenced}' is distinct from 'false'::jsonb
 then raise exception 'native_running_anchor_required';end if;
 return new;
end $$;
revoke all on function destruktion_meta.native_running_anchor_v1() from public,anon,authenticated,service_role;
drop trigger if exists aa_native_running_anchor_v1 on destruktion_meta.devos_fleet_task_h205f22;
create trigger aa_native_running_anchor_v1 before update on destruktion_meta.devos_fleet_task_h205f22 for each row execute function destruktion_meta.native_running_anchor_v1();
