-- Local operator QA scope. No RPC can create a permit or register a provider,
-- job or result. Only the migration owner / private state_owner producer writes
-- these relations. service_role/API/model callers receive bounded readbacks.
create table destruktion_meta.native_coding_operator_permit_h205f22 (
  permit_id uuid primary key, workspace_id uuid not null, client_id text not null,
  device_id uuid not null, admin_grant_epoch bigint not null check(admin_grant_epoch>0),
  provider_id uuid not null, agent_id text not null check(agent_id ~ '^agent_[a-z0-9-]{8,64}$'),
  agent_generation_epoch bigint not null check(agent_generation_epoch>0),
  permit jsonb not null, operator_record_sha256 text not null check(operator_record_sha256 ~ '^[a-f0-9]{64}$'),
  registered_at timestamptz not null default clock_timestamp(), revoked_at timestamptz,
  check(coalesce(permit->>'schema'='metaengine.native-coding.operator-permit.v1'
    and permit->>'trust_namespace'='LOCAL_OPERATOR_QA' and permit->'revoked'='false'::jsonb
    and permit->>'permit_id'=permit_id::text and permit->>'workspace_id'=workspace_id::text
    and permit->>'device_id'=device_id::text and permit->>'provider_id'=provider_id::text
    and permit->>'agent_id'=agent_id and (permit->>'agent_generation_epoch')::bigint=agent_generation_epoch
    and permit->>'record_sha256'=operator_record_sha256
    and (permit->>'physical_slot_budget')::int between 1 and 64
    and permit->>'role' in ('IMPLEMENTER','CRITIC') and permit->>'expires_at' is not null,false))
);
create unique index native_coding_one_active_permit_binding on destruktion_meta.native_coding_operator_permit_h205f22
  (workspace_id,provider_id,agent_id,agent_generation_epoch) where revoked_at is null;

create table destruktion_meta.native_coding_provider_registration_h205f22 (
  permit_id uuid primary key references destruktion_meta.native_coding_operator_permit_h205f22(permit_id),
  envelope jsonb not null, canonical_envelope text not null check(octet_length(canonical_envelope)<=131072),
  envelope_sha256 text not null check(envelope_sha256 ~ '^[a-f0-9]{64}$'),
  registered_at timestamptz not null default clock_timestamp(),
  check(coalesce(canonical_envelope::jsonb=envelope
    and envelope_sha256=encode(extensions.digest(convert_to(canonical_envelope,'UTF8'),'sha256'),'hex')
    and envelope->'payload'->>'permit_id'=permit_id::text
    and envelope->'payload'->>'schema'='metaengine.codex-cli.transport-proof.v1',false))
);
create table destruktion_meta.native_coding_job_registration_h205f22 (
  task_id uuid not null, lease_generation bigint not null check(lease_generation>0),
  permit_id uuid not null references destruktion_meta.native_coding_operator_permit_h205f22(permit_id),
  run_id uuid not null unique, job_envelope jsonb not null,
  canonical_job_envelope text not null check(octet_length(canonical_job_envelope)<=131072),
  job_envelope_sha256 text not null check(job_envelope_sha256 ~ '^[a-f0-9]{64}$'),
  registered_at timestamptz not null default clock_timestamp(),
  result_receipt jsonb, canonical_result_receipt text, result_receipt_sha256 text, result_registered_at timestamptz,
  primary key(task_id,lease_generation),
  foreign key(task_id,lease_generation) references destruktion_meta.native_coding_execution_h205f22(task_id,lease_generation),
  check(coalesce(canonical_job_envelope::jsonb=job_envelope
    and job_envelope_sha256=encode(extensions.digest(convert_to(canonical_job_envelope,'UTF8'),'sha256'),'hex')
    and job_envelope->'payload'->>'permit_id'=permit_id::text
    and job_envelope->'payload'->>'task_id'=task_id::text
    and (job_envelope->'payload'->>'lease_generation')::bigint=lease_generation
    and job_envelope->'payload'->>'run_id'=run_id::text
    and job_envelope->'payload'->>'schema'='metaengine.codex-cli.job-proof.v1',false)),
  check((result_receipt is null and canonical_result_receipt is null and result_receipt_sha256 is null and result_registered_at is null)
    or (result_receipt is not null and canonical_result_receipt is not null and result_receipt_sha256 is not null and result_registered_at is not null
      and octet_length(canonical_result_receipt)<=131072 and canonical_result_receipt::jsonb=result_receipt
      and result_receipt_sha256=encode(extensions.digest(convert_to(canonical_result_receipt,'UTF8'),'sha256'),'hex')
      and result_receipt->>'schema'='metaengine.codex-cli.run-receipt.v1' and result_receipt->>'run_id'=run_id::text
      and result_receipt->>'task_id'=task_id::text and (result_receipt->>'lease_generation')::bigint=lease_generation))
);
alter table destruktion_meta.native_coding_operator_permit_h205f22 enable row level security;
alter table destruktion_meta.native_coding_provider_registration_h205f22 enable row level security;
alter table destruktion_meta.native_coding_job_registration_h205f22 enable row level security;
revoke all on destruktion_meta.native_coding_operator_permit_h205f22,
  destruktion_meta.native_coding_provider_registration_h205f22,
  destruktion_meta.native_coding_job_registration_h205f22 from public,anon,authenticated,service_role;

create function public.native_coding_admission_context_v1(p_workspace uuid,p_client text,p_permit uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $$
declare p destruktion_meta.native_coding_operator_permit_h205f22; d public.compute_fabric_a2_browser_device_h205f22;
  r destruktion_meta.native_coding_provider_registration_h205f22; cluster_id text;
begin
  select * into p from destruktion_meta.native_coding_operator_permit_h205f22
    where permit_id=p_permit and workspace_id=p_workspace and client_id=p_client and revoked_at is null;
  if not found or coalesce((p.permit->>'expires_at')::timestamptz<=clock_timestamp(),true) then
    raise exception 'native_coding_scope_unavailable' using errcode='55000'; end if;
  select * into d from public.compute_fabric_a2_browser_device_h205f22
    where device_id=p.device_id and client_id=p.client_id and active and revoked_at is null
      and access_tier='ADMIN' and admin_revoked_at is null and admin_grant_epoch=p.admin_grant_epoch
      and profile='A2_DEVICE_HTTP_SIGNATURE_V1'
      and key_fingerprint_sha256=p.permit->>'device_key_fingerprint_sha256'
      and admin_scopes @> '["CONTROL_PLANE","DEVOS"]'::jsonb;
  if not found then raise exception 'native_coding_device_unavailable' using errcode='55000'; end if;
  select system_identifier::text into cluster_id from pg_catalog.pg_control_system();
  if cluster_id is distinct from p.permit->'postgres'->>'system_identifier' then
    raise exception 'native_coding_postgres_mismatch' using errcode='55000'; end if;
  select * into r from destruktion_meta.native_coding_provider_registration_h205f22 where permit_id=p_permit;
  return jsonb_build_object('schema','metaengine.native-coding.admission-context.v1','source','PROTECTED_OWN_PG_OPERATOR_REGISTRY',
    'permit',p.permit,'registration',case when r.permit_id is null then null else jsonb_build_object('envelope_sha256',r.envelope_sha256,'registered_at',r.registered_at) end,
    'device',jsonb_build_object('device_id',d.device_id,'client_id',d.client_id,'profile',d.profile,'public_jwk',d.public_jwk,
      'key_fingerprint_sha256',d.key_fingerprint_sha256,'admin_grant_epoch',d.admin_grant_epoch),
    'postgres_system_identifier',cluster_id,'authority_effect',false);
end $$;

create function public.native_coding_execution_context_v1(p_workspace uuid,p_client text,p_task uuid,p_generation bigint)
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
    'execution',to_jsonb(e));
end $$;

create function destruktion_meta.native_coding_claim_admission_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $$
declare p destruktion_meta.native_coding_operator_permit_h205f22; r destruktion_meta.native_coding_provider_registration_h205f22;
  proof jsonb; context jsonb; s jsonb; seen timestamptz; control jsonb; task destruktion_meta.devos_fleet_task_h205f22;
begin
  if new.target_id !~ '^codex-cli:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or new.state<>'ACTIVE' then raise exception 'native_coding_claim_invalid' using errcode='23514'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.workspace_id::text,2382533));
  select * into p from destruktion_meta.native_coding_operator_permit_h205f22
    where workspace_id=new.workspace_id and provider_id=substring(new.target_id from 11)::uuid
      and agent_id=new.agent_id and agent_generation_epoch=new.agent_generation_epoch and revoked_at is null for share;
  if not found then raise exception 'native_coding_scope_unavailable' using errcode='55000'; end if;
  context:=public.native_coding_admission_context_v1(new.workspace_id,p.client_id,p.permit_id);
  select * into r from destruktion_meta.native_coding_provider_registration_h205f22 where permit_id=p.permit_id for share;
  proof:=r.envelope->'payload';
  if coalesce(r.permit_id is null or proof->>'schema'<>'metaengine.codex-cli.transport-proof.v1'
    or proof->>'trust_namespace'<>'LOCAL_OPERATOR_QA' or proof->>'state'<>'READY'
    or r.envelope->>'algorithm'<>'ES256' or r.envelope->>'issuer_key_fingerprint_sha256'<>p.permit->>'device_key_fingerprint_sha256'
    or proof->>'target_id'<>new.target_id or proof->>'agent_id'<>new.agent_id or proof->>'role'<>new.role
    or (proof->>'agent_generation_epoch')::bigint<>new.agent_generation_epoch
    or new.tab_id<>'native-coding:'||p.provider_id::text
    or (proof->>'expires_at')::timestamptz<=clock_timestamp()
    or (proof->>'proven_at')::timestamptz<clock_timestamp()-interval '60 seconds'
    or (proof->>'proven_at')::timestamptz>clock_timestamp()+interval '5 seconds'
    or (proof->>'expires_at')::timestamptz>(proof->>'proven_at')::timestamptz+interval '60 seconds'
    or (proof->>'expires_at')::timestamptz>(p.permit->>'expires_at')::timestamptz
    or (proof-'schema'-'state'-'physical_slot_budget'-'target_id'-'issuer'-'audience'-'provider'-'host_process'-'sandbox'-'proven_at'-'expires_at'-'automatic_retry_allowed'-'production_qualified'-'authority_effect')
      is distinct from (p.permit-'schema'-'physical_slot_budget'-'issued_at'-'expires_at'-'revoked'-'storage_evidence_sha256'-'record_sha256')
    or proof->'automatic_retry_allowed' is distinct from 'false'::jsonb
    or proof->'authority_effect' is distinct from 'false'::jsonb or proof->'production_qualified' is distinct from 'false'::jsonb,true) then
    raise exception 'native_coding_provider_unregistered' using errcode='55000'; end if;
  select * into task from destruktion_meta.devos_fleet_task_h205f22 where task_id=new.task_id and workspace_id=new.workspace_id;
  if task.base_sha is distinct from p.permit->'worktree'->>'base_sha'
    or not coalesce(task.task_spec->'native_coding' @> jsonb_build_object('permit_id',p.permit_id,'goal_id',p.permit->>'goal_id',
      'goal_sha256',p.permit->>'goal_sha256','project_id',p.permit->>'project_id'),false) then
    raise exception 'native_coding_task_scope_mismatch' using errcode='55000'; end if;
  select destruktion_meta.devos_normalize_native_supervisor_state_h205f22(state),last_seen_at into s,seen
    from public.compute_fabric_a2_browser_supervisor_state_h205f22 where workspace_id=new.workspace_id and client_id=p.client_id order by last_seen_at desc limit 1;
  if coalesce(s is null or s->>'schema'<>'metaengine.native-browser-supervisor.state.v1' or s->>'client_kind'<>'METAENGINE_BROWSER_ELECTRON_NATIVE'
    or seen<clock_timestamp()-interval '45 seconds' or s->'transport_identity'->>'device_id'<>p.device_id::text
    or s->'transport_identity'->>'profile'<>'A2_DEVICE_HTTP_SIGNATURE_V1'
    or s->'transport_identity'->>'key_fingerprint_sha256'<>p.permit->>'device_key_fingerprint_sha256'
    or s->'supervisor_lifecycle'->'continuous_service'->'enabled' is distinct from 'true'::jsonb
    or s->'supervisor_lifecycle'->'actuation_enabled' is distinct from 'true'::jsonb
    or upper(coalesce(s->'supervisor_lifecycle'->'keepalive'->>'state','UNKNOWN')) in ('WAKE_AMBIGUOUS','ROLLOVER_DEFERRED','ROLLOVER_REQUIRED','ROLLOVER_AMBIGUOUS','RECOVERING'),true) then
    raise exception 'native_coding_continuity_fenced' using errcode='55000'; end if;
  control:=public.devos_environment_state_v1(new.workspace_id);
  if control->'refill_enabled' is distinct from 'true'::jsonb or control->'supervisor_admission_enabled' is distinct from 'true'::jsonb then
    raise exception 'native_coding_environment_fenced' using errcode='55000'; end if;
  if (select count(*) from destruktion_meta.devos_fleet_claim_h205f22 c where c.workspace_id=new.workspace_id and c.state='ACTIVE'
      and c.expires_at>clock_timestamp() and c.target_id like 'codex-cli:%') >= (p.permit->>'physical_slot_budget')::int
    or exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 c where c.workspace_id=new.workspace_id and c.target_id=new.target_id and c.state='ACTIVE' and c.expires_at>clock_timestamp()) then
    raise exception 'native_coding_physical_capacity_fenced' using errcode='55000'; end if;
  return new;
end $$;

-- Keep the existing browser function byte-for-byte. Its original strict gate
-- still receives every non-native target, including malformed/unknown targets.
drop trigger devos_fleet_claim_transport_admission_trg on destruktion_meta.devos_fleet_claim_h205f22;
create trigger devos_fleet_claim_transport_admission_trg before insert on destruktion_meta.devos_fleet_claim_h205f22
  for each row when(new.target_id is null or new.target_id not like 'codex-cli:%')
  execute function destruktion_meta.devos_fleet_claim_transport_admission_h205f22();
create trigger native_coding_claim_admission_trg before insert on destruktion_meta.devos_fleet_claim_h205f22
  for each row when(new.target_id like 'codex-cli:%') execute function destruktion_meta.native_coding_claim_admission_v1();

create function destruktion_meta.native_coding_task_transition_guard_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,destruktion_meta as $$
declare j destruktion_meta.native_coding_job_registration_h205f22; e destruktion_meta.native_coding_execution_h205f22; p destruktion_meta.native_coding_operator_permit_h205f22; proof jsonb;
begin
  if new.state not in ('RUNNING','RESULT_READY','COMPLETED') or new.state is not distinct from old.state then return new; end if;
  select * into j from destruktion_meta.native_coding_job_registration_h205f22 where task_id=new.task_id and lease_generation=new.lease_generation for share;
  if not found then raise exception 'native_coding_job_unregistered' using errcode='55000'; end if;
  select * into p from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=j.permit_id for share;
  perform public.native_coding_admission_context_v1(new.workspace_id,p.client_id,p.permit_id);
  select * into e from destruktion_meta.native_coding_execution_h205f22 where task_id=new.task_id and lease_generation=new.lease_generation for share;
  proof:=j.job_envelope->'payload';
  if e.workspace_id is distinct from new.workspace_id or e.agent_id is distinct from new.lease_agent_id
    or e.target_id is distinct from new.lease_target_id or e.agent_generation_epoch is distinct from new.lease_agent_generation_epoch
    or e.host_incarnation is distinct from proof->'host_process'->>'process_incarnation_id'
    or proof->>'agent_id' is distinct from new.lease_agent_id or proof->>'target_id' is distinct from new.lease_target_id
    or proof->>'role' is distinct from new.role then raise exception 'native_coding_job_binding_mismatch' using errcode='55000'; end if;
  if new.state='RUNNING' then
    if coalesce(e.state not in ('ATTEMPTED','RESULT_READY') or (proof->>'expires_at')::timestamptz<=clock_timestamp()
      or new.lease_expires_at<=clock_timestamp(),true) then raise exception 'native_coding_attempt_unregistered' using errcode='55000'; end if;
  else
    if j.result_receipt is null or e.state not in ('RESULT_READY','CHECKPOINTED') or (new.state='COMPLETED' and e.state<>'CHECKPOINTED')
      or j.result_receipt->>'state'<>'RESULT_READY' or j.result_receipt->>'result_sha256' is distinct from e.result_sha256
      or new.result_summary->>'receipt_sha256' is distinct from j.result_receipt_sha256
      or new.result_summary->>'run_id' is distinct from j.run_id::text
      or new.result_summary->>'git_artifact_sha256' is distinct from j.result_receipt->'git_after'->>'artifact_sha256'
      or new.result_summary->>'source_head' is distinct from j.result_receipt->'git_after'->>'head' then
      raise exception 'native_coding_result_unregistered' using errcode='55000'; end if;
  end if;
  return new;
end $$;
create trigger native_coding_task_transition_guard_trg before update on destruktion_meta.devos_fleet_task_h205f22
  for each row when(old.lease_target_id like 'codex-cli:%' or new.lease_target_id like 'codex-cli:%')
  execute function destruktion_meta.native_coding_task_transition_guard_v1();

revoke all on function public.native_coding_admission_context_v1(uuid,text,uuid),
  public.native_coding_execution_context_v1(uuid,text,uuid,bigint),
  destruktion_meta.native_coding_claim_admission_v1(),destruktion_meta.native_coding_task_transition_guard_v1() from public,anon,authenticated;
grant execute on function public.native_coding_admission_context_v1(uuid,text,uuid),
  public.native_coding_execution_context_v1(uuid,text,uuid,bigint) to service_role;
-- The old ledger is now a private native Host capability as well. Its public
-- API role cannot invent attempt/result/checkpoint digests.
revoke all on function destruktion_meta.native_coding_reserve_v1(uuid,uuid,bigint,text,text,bigint,uuid,text,text),
  destruktion_meta.native_coding_advance_v1(uuid,bigint,uuid,text,text,text,text,text,text,text),
  destruktion_meta.native_coding_read_v1(uuid,uuid,bigint),
  destruktion_meta.native_coding_claim_admission_v1(),destruktion_meta.native_coding_task_transition_guard_v1() from service_role;

-- The SAME W30 allocator and signature. Only the picked-task eligibility is
-- extended: a native permit cannot claim a foreign task, and browser workers
-- cannot consume native QA work. Reconciliation/generation/claim logic remains.
create or replace function public.devos_fleet_lease_v1(
 p_workspace uuid,p_agent text,p_role text,p_tab text,p_target text,p_epoch bigint,p_seconds integer default 900
) returns jsonb language plpgsql security definer
set search_path='pg_catalog','destruktion_meta'
as $$
declare v_task destruktion_meta.devos_fleet_task_h205f22%rowtype; v_claim bigint;
 v_now timestamptz:=clock_timestamp(); v_secs int:=greatest(60,least(3600,coalesce(p_seconds,900)));
begin
 perform public.devos_fleet_reconcile_v1(p_workspace);
 with picked as (
   select task_id from destruktion_meta.devos_fleet_task_h205f22 t
   where workspace_id=p_workspace and state='READY' and role=upper(p_role)
     and ((p_target not like 'codex-cli:%' and not (t.task_spec ? 'native_coding'))
       or (p_target like 'codex-cli:%' and exists (
         select 1 from destruktion_meta.native_coding_operator_permit_h205f22 p
         join destruktion_meta.native_coding_provider_registration_h205f22 r using(permit_id)
         where p.workspace_id=p_workspace and p.provider_id::text=substring(p_target from 11)
           and p.agent_id=lower(p_agent) and p.agent_generation_epoch=p_epoch and p.revoked_at is null
           and (p.permit->>'expires_at')::timestamptz>clock_timestamp()
           and t.base_sha=p.permit->'worktree'->>'base_sha'
           and t.task_spec->'native_coding' @> jsonb_build_object('permit_id',p.permit_id,'goal_id',p.permit->>'goal_id',
             'goal_sha256',p.permit->>'goal_sha256','project_id',p.permit->>'project_id')
       )))
   order by priority desc,created_at,task_id for update skip locked limit 1
 )
 update destruktion_meta.devos_fleet_task_h205f22 t
 set state='LEASED',lease_generation=t.lease_generation+1,lease_agent_id=lower(p_agent),
     lease_tab_id=p_tab,lease_target_id=lower(p_target),lease_agent_generation_epoch=p_epoch,
     lease_expires_at=v_now+make_interval(secs=>v_secs),updated_at=v_now
 from picked p where t.task_id=p.task_id returning t.* into v_task;
 if not found then return jsonb_build_object('leased',false,'agent_id',lower(p_agent),'role',upper(p_role),
   'automatic_retry_allowed',false,'authority_effect',false); end if;
 insert into destruktion_meta.devos_fleet_claim_h205f22(
  task_id,workspace_id,point_id,base_sha,role,claim_class,agent_id,tab_id,target_id,
  agent_generation_epoch,lease_generation,expires_at
 ) values (
  v_task.task_id,v_task.workspace_id,v_task.point_id,v_task.base_sha,v_task.role,v_task.claim_class,
  lower(p_agent),p_tab,lower(p_target),p_epoch,v_task.lease_generation,v_task.lease_expires_at
 ) returning claim_id into v_claim;
 return jsonb_build_object('leased',true,'task_id',v_task.task_id,'claim_id',v_claim,'point_id',v_task.point_id,
  'role',v_task.role,'claim_class',v_task.claim_class,'base_sha',v_task.base_sha,'branch_name',v_task.branch_name,
  'task_spec',v_task.task_spec,'task_spec_sha256',v_task.task_spec_sha256,'lease_generation',v_task.lease_generation,
  'lease_expires_at',v_task.lease_expires_at,'agent_id',lower(p_agent),'tab_id',p_tab,'target_id',lower(p_target),
  'agent_generation_epoch',p_epoch,'automatic_retry_allowed',false,'authority_effect',false);
end $$;
revoke all on function public.devos_fleet_lease_v1(uuid,text,text,text,text,bigint,integer) from public,anon,authenticated;
grant execute on function public.devos_fleet_lease_v1(uuid,text,text,text,text,bigint,integer) to service_role;
