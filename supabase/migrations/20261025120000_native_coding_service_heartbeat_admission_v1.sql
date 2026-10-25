-- Native QA service admission is independent of browser conversation history.
-- Only the private Host, after purpose-bound loaded-device ES256 verification
-- and actual OS/image/PG/provider scope readback, may publish this witness.
-- This relation is short-lived admission state, not a task/history allocator.
create table destruktion_meta.native_coding_service_heartbeat_h205f22 (
 workspace_id uuid not null,device_id uuid not null,client_id text not null,admin_grant_epoch bigint not null,
 host_instance_id uuid not null,host_pid integer not null check(host_pid>0),
 body jsonb not null,canonical_body text not null,body_sha256 text not null,headers jsonb not null,
 nonce_sha256 text not null,witness_sha256 text not null,
 proven_at timestamptz not null,expires_at timestamptz not null,registered_at timestamptz not null default clock_timestamp(),
 primary key(workspace_id,device_id,client_id),
 check(canonical_body::jsonb=body and body_sha256=encode(extensions.digest(convert_to(canonical_body,'UTF8'),'sha256'),'hex')),
 check(witness_sha256 ~ '^[a-f0-9]{64}$' and nonce_sha256 ~ '^[a-f0-9]{64}$'),
 check(expires_at=proven_at+interval '30 seconds')
);
alter table destruktion_meta.native_coding_service_heartbeat_h205f22 enable row level security;
revoke all on destruktion_meta.native_coding_service_heartbeat_h205f22 from public,anon,authenticated,service_role;

create function destruktion_meta.native_coding_service_heartbeat_v1(p_device uuid,p_client text,p_epoch bigint,
 p_host_instance uuid,p_host_pid integer,p_body jsonb,p_canonical_body text,p_headers jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public,destruktion_meta as $$
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
 perform destruktion_meta.project_device_grant_h205f22(p_device,p_client,p_epoch);
 select * into d from public.compute_fabric_a2_browser_device_h205f22 where device_id=p_device and client_id=p_client for share;
 v:=p_body->'input';ctl:=v->'control';run:=v->'runtime';
 bodysha:=encode(extensions.digest(convert_to(p_canonical_body,'UTF8'),'sha256'),'hex');
 keys:=array['host_instance_id','host_pid','operation','input'];
 if coalesce(p_canonical_body::jsonb is distinct from p_body or octet_length(p_canonical_body)>65536
  or jsonb_typeof(p_body)<>'object' or not p_body ?& keys or (select count(*) from jsonb_object_keys(p_body))<>4
  or p_body->>'host_instance_id' is distinct from p_host_instance::text or (p_body->>'host_pid')::integer is distinct from p_host_pid
  or p_body->>'operation' is distinct from 'SERVICE_HEARTBEAT'
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
 keys:=array['schema','workspace_id','host_process','artifact','postgres','control','runtime','providers','production_qualified','automatic_retry_allowed','authority_effect'];
 if coalesce(jsonb_typeof(v)<>'object' or not v ?& keys or (select count(*) from jsonb_object_keys(v))<>11
  or v->>'schema' is distinct from 'metaengine.native-coding.service-heartbeat.v1'
  or v->'production_qualified' is distinct from 'false'::jsonb or v->'automatic_retry_allowed' is distinct from 'false'::jsonb
  or v->'authority_effect' is distinct from 'false'::jsonb
  or jsonb_typeof(v->'providers')<>'array' or jsonb_array_length(v->'providers') not between 1 and 64
  or jsonb_typeof(ctl)<>'object' or (select count(*) from jsonb_object_keys(ctl))<>4
  or not ctl ?& array['supervisor_mode','armed','interrupted_setup_recovery_fenced','runtime_control_generation']
  or ctl->>'supervisor_mode' is distinct from 'CONTROL' or ctl->'armed' is distinct from 'true'::jsonb
  or ctl->'interrupted_setup_recovery_fenced' is distinct from 'false'::jsonb
  or jsonb_typeof(run)<>'object' or (select count(*) from jsonb_object_keys(run))<>7
  or not run ?& array['schema','physical_slot_budget','occupied_slots','closed','shutdown_state','host_unavailable_reason','jobs']
  or run->>'schema' is distinct from 'metaengine.native-coding.runtime.v1' or run->'closed' is distinct from 'false'::jsonb
  or run->>'shutdown_state' is distinct from 'OPEN' or run->'host_unavailable_reason' is distinct from 'null'::jsonb
  or (run->>'physical_slot_budget')::integer not between 1 and 16
  or (run->>'occupied_slots')::integer not between 0 and (run->>'physical_slot_budget')::integer
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
    or (run->>'physical_slot_budget')::integer>(p.permit->>'physical_slot_budget')::integer
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
 perform pg_advisory_xact_lock(hashtextextended('native-service:'||p_device||':'||p_client,25120000));
 noncesha:=encode(extensions.digest(convert_to(p_headers->>'x-a2-device-nonce','UTF8'),'sha256'),'hex');
 witnesssha:=encode(extensions.digest(convert_to(jsonb_build_object('body',p_body,'headers',p_headers)::text,'UTF8'),'sha256'),'hex');
 select * into oldrow from destruktion_meta.native_coding_service_heartbeat_h205f22
  where workspace_id=(v->>'workspace_id')::uuid and device_id=p_device and client_id=p_client for update;
 if found then
  if oldrow.witness_sha256=witnesssha then return jsonb_build_object('schema','metaengine.native-coding.service-heartbeat-ack.v1',
    'accepted',true,'witness_sha256',witnesssha,'body_sha256',bodysha,'expires_at',oldrow.expires_at,'readback_only',true,'authority_effect',false);end if;
  if oldrow.nonce_sha256=noncesha or stamp<=oldrow.proven_at then raise exception 'native_coding_service_heartbeat_replay' using errcode='23505';end if;
 end if;
 insert into destruktion_meta.native_coding_service_heartbeat_h205f22
  (workspace_id,device_id,client_id,admin_grant_epoch,host_instance_id,host_pid,body,canonical_body,body_sha256,headers,nonce_sha256,witness_sha256,proven_at,expires_at)
 values((v->>'workspace_id')::uuid,p_device,p_client,p_epoch,p_host_instance,p_host_pid,p_body,p_canonical_body,bodysha,p_headers,noncesha,witnesssha,stamp,stamp+interval '30 seconds')
 on conflict(workspace_id,device_id,client_id) do update set admin_grant_epoch=excluded.admin_grant_epoch,host_instance_id=excluded.host_instance_id,
  host_pid=excluded.host_pid,body=excluded.body,canonical_body=excluded.canonical_body,body_sha256=excluded.body_sha256,headers=excluded.headers,
  nonce_sha256=excluded.nonce_sha256,witness_sha256=excluded.witness_sha256,proven_at=excluded.proven_at,expires_at=excluded.expires_at,registered_at=clock_timestamp();
 return jsonb_build_object('schema','metaengine.native-coding.service-heartbeat-ack.v1','accepted',true,'witness_sha256',witnesssha,
  'body_sha256',bodysha,'expires_at',stamp+interval '30 seconds','readback_only',false,'authority_effect',false);
end $$;

create function destruktion_meta.native_coding_service_heartbeat_read_v1(p_device uuid,p_client text,p_epoch bigint,p_workspace uuid,p_body_sha256 text)
returns jsonb language plpgsql set search_path=pg_catalog,public,destruktion_meta as $$
declare r destruktion_meta.native_coding_service_heartbeat_h205f22;
begin
 if current_user<>'state_owner' or session_user<>'state_owner' then raise exception 'native_coding_service_state_owner_required' using errcode='42501';end if;
 perform destruktion_meta.project_device_grant_h205f22(p_device,p_client,p_epoch);
 if coalesce(p_body_sha256,'')!~ '^[a-f0-9]{64}$' then raise exception 'native_coding_service_read_selector_invalid' using errcode='22023';end if;
 select * into r from destruktion_meta.native_coding_service_heartbeat_h205f22 where workspace_id=p_workspace and device_id=p_device and client_id=p_client
  and admin_grant_epoch=p_epoch and body_sha256=p_body_sha256;
 if not found then return null;end if;
 return jsonb_build_object('schema','metaengine.native-coding.service-heartbeat-ack.v1','accepted',true,
  'witness_sha256',r.witness_sha256,'body_sha256',r.body_sha256,'expires_at',r.expires_at,'readback_only',true,'authority_effect',false);
end $$;

create function destruktion_meta.native_coding_service_admissible_v1(p_permit uuid)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,public,destruktion_meta as $$
declare p destruktion_meta.native_coding_operator_permit_h205f22;r destruktion_meta.native_coding_service_heartbeat_h205f22;
 d public.compute_fabric_a2_browser_device_h205f22;v jsonb;control jsonb;provider jsonb;free integer;unrepresented bigint;
begin
 select * into p from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=p_permit and revoked_at is null;
 if not found then return false;end if;
 select * into r from destruktion_meta.native_coding_service_heartbeat_h205f22 where workspace_id=p.workspace_id and device_id=p.device_id and client_id=p.client_id;
 if not found or r.expires_at<=clock_timestamp() or r.proven_at>clock_timestamp()+interval '5 seconds' or r.admin_grant_epoch<>p.admin_grant_epoch then return false;end if;
 v:=r.body->'input';
 select * into d from public.compute_fabric_a2_browser_device_h205f22 where device_id=p.device_id and client_id=p.client_id and active and revoked_at is null
  and access_tier='ADMIN' and admin_revoked_at is null and admin_grant_epoch=p.admin_grant_epoch and profile='A2_DEVICE_HTTP_SIGNATURE_V1'
  and key_fingerprint_sha256=p.permit->>'device_key_fingerprint_sha256' and admin_scopes @> '["CONTROL_PLANE","DEVOS"]'::jsonb;
 if not found or not exists(select 1 from public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 where token_hash=d.enrollment_pairing_token_hash and active)
 then return false;end if;
 control:=public.devos_environment_state_v1(p.workspace_id);
 if coalesce(control->'refill_enabled' is distinct from 'true'::jsonb or control->'supervisor_admission_enabled' is distinct from 'true'::jsonb
  or control->'owner_stop' is not distinct from 'true'::jsonb or coalesce(control->>'state','')='STOPPED'
  or (v#>>'{control,runtime_control_generation}')::bigint is distinct from (control->>'generation_floor')::bigint,true) then return false;end if;
 select a.value into provider from jsonb_array_elements(v->'providers') a where a.value->>'permit_id'=p_permit::text;
 if provider is null or p.permit->'artifact' is distinct from v->'artifact' or p.permit->'postgres' is distinct from v->'postgres'
  or (p.permit->>'expires_at')::timestamptz<=clock_timestamp()
  or not exists(select 1 from destruktion_meta.native_coding_provider_registration_h205f22 pr where pr.permit_id=p_permit
    and pr.envelope_sha256=provider->>'envelope_sha256' and (pr.envelope#>>'{payload,expires_at}')::timestamptz>clock_timestamp()
    and pr.envelope#>'{payload,host_process}'=v->'host_process') then return false;end if;
 if not exists(select 1 from destruktion_meta.project_run_h205f22 pr where pr.project_id=(p.permit->>'project_id')::uuid and pr.workspace_id=p.workspace_id
   and pr.device_id=p.device_id and pr.client_id=p.client_id and pr.admin_grant_epoch=p.admin_grant_epoch and pr.state='ACTIVE') then return false;end if;
 -- Retained UNKNOWN/RESULT_READY jobs consume real pool slots even when the
 -- previous W30 claim closed. Never silently discard them to admit a new run.
 free:=(v#>>'{runtime,physical_slot_budget}')::integer-(v#>>'{runtime,occupied_slots}')::integer;
 if free<=0 or exists(select 1 from jsonb_array_elements(v#>'{runtime,jobs}') j join destruktion_meta.devos_fleet_task_h205f22 t
    on t.task_id=(j.value->>'task_id')::uuid and t.lease_generation=(j.value->>'lease_generation')::bigint
    where t.lease_target_id='codex-cli:'||p.provider_id) then return false;end if;
 select count(*) into unrepresented from destruktion_meta.devos_fleet_claim_h205f22 c
  join destruktion_meta.devos_fleet_task_h205f22 t on t.task_id=c.task_id
  join destruktion_meta.native_coding_operator_permit_h205f22 cp on cp.permit_id=(t.task_spec#>>'{native_coding,permit_id}')::uuid
  where c.workspace_id=p.workspace_id and c.state='ACTIVE' and c.expires_at>clock_timestamp() and c.target_id like 'codex-cli:%'
    and cp.device_id=p.device_id and cp.client_id=p.client_id
    and not exists(select 1 from jsonb_array_elements(v#>'{runtime,jobs}') j where j.value->>'task_id'=c.task_id::text
      and (j.value->>'lease_generation')::bigint=c.lease_generation);
 return unrepresented<free;
end $$;

revoke all on function destruktion_meta.native_coding_service_heartbeat_v1(uuid,text,bigint,uuid,integer,jsonb,text,jsonb),
 destruktion_meta.native_coding_service_admissible_v1(uuid),destruktion_meta.native_coding_service_heartbeat_read_v1(uuid,text,bigint,uuid,text)
 from public,anon,authenticated,service_role;

-- Existing root/claim functions: only the typed service gate is changed.
create or replace function destruktion_meta.native_coding_worktree_admissible_v1(p_workspace uuid,p_task uuid)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,destruktion_meta as $$
declare t destruktion_meta.devos_fleet_task_h205f22; p destruktion_meta.native_coding_operator_permit_h205f22;
 f destruktion_meta.native_coding_worktree_fence_h205f22; j destruktion_meta.native_coding_job_registration_h205f22;
 writer_permit destruktion_meta.native_coding_operator_permit_h205f22;
 root text; subject jsonb;
begin
 select * into t from destruktion_meta.devos_fleet_task_h205f22 where task_id=p_task and workspace_id=p_workspace;
 select * into p from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=(t.task_spec#>>'{native_coding,permit_id}')::uuid
   and workspace_id=p_workspace and revoked_at is null and (permit->>'expires_at')::timestamptz>clock_timestamp();
 if p.permit_id is null or t.task_id is null or t.role is distinct from p.permit->>'role' then return false; end if;
 if not destruktion_meta.native_coding_service_admissible_v1(p.permit_id) then return false;end if;
 root:=p.permit#>>'{worktree,root_identity_sha256}';
 if root is null then return false; end if;
 perform 1 from destruktion_meta.project_run_h205f22 r join destruktion_meta.project_task_h205f22 pt using(project_id)
   where r.project_id=(p.permit->>'project_id')::uuid and pt.task_id=t.task_id and r.workspace_id=p_workspace and r.state='ACTIVE'
     and r.device_id=p.device_id and r.client_id=p.client_id and r.admin_grant_epoch=p.admin_grant_epoch;
 if not found then return false; end if;
 select * into f from destruktion_meta.native_coding_worktree_fence_h205f22 where root_identity_sha256=root;
 if t.role='IMPLEMENTER' then
   if f.root_identity_sha256 is not null then return false; end if;
   -- Also cover a live claim admitted before this additive migration, where
   -- the old Host has not yet committed its RESERVED execution/fence.
   return not exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 c
     join destruktion_meta.devos_fleet_task_h205f22 claimed on claimed.task_id=c.task_id and claimed.lease_generation=c.lease_generation
     join destruktion_meta.native_coding_operator_permit_h205f22 oldp on oldp.permit_id=(claimed.task_spec#>>'{native_coding,permit_id}')::uuid
     where c.state='ACTIVE' and c.expires_at>clock_timestamp() and c.target_id like 'codex-cli:%'
       and oldp.permit#>>'{worktree,root_identity_sha256}'=root);
 elsif t.role='CRITIC' then
   subject:=t.task_spec#>'{native_coding,verification_subject}';
   if f.state is distinct from 'HELD' or f.workspace_id is distinct from p_workspace or f.project_id is distinct from (p.permit->>'project_id')::uuid then return false; end if;
   select * into j from destruktion_meta.native_coding_job_registration_h205f22 where task_id=f.writer_task_id and lease_generation=f.writer_lease_generation;
   select * into writer_permit from destruktion_meta.native_coding_operator_permit_h205f22 where permit_id=j.permit_id;
   return coalesce(destruktion_meta.native_coding_project_result_bound_v1(f.writer_task_id)
     and writer_permit.workspace_id=p.workspace_id and writer_permit.device_id=p.device_id and writer_permit.client_id=p.client_id
     and writer_permit.admin_grant_epoch=p.admin_grant_epoch and writer_permit.permit->>'goal_id'=p.permit->>'goal_id'
     and writer_permit.permit->>'goal_sha256'=p.permit->>'goal_sha256' and writer_permit.permit->>'owner_epoch'=p.permit->>'owner_epoch'
     and writer_permit.permit->'artifact'=p.permit->'artifact'
     and subject=jsonb_build_object('run_id',j.run_id,'result_sha256',j.result_receipt->>'result_sha256',
       'git_artifact_sha256',j.result_receipt#>>'{git_after,artifact_sha256}','source_head',j.result_receipt#>>'{git_after,head}')
     and j.result_receipt->>'role'='IMPLEMENTER' and j.result_receipt#>>'{result,outcome}'='DONE'
     and j.result_receipt->>'agent_id'<>p.agent_id and t.base_sha=subject->>'source_head',false);
 end if;
 return false;
end $$;
revoke all on function destruktion_meta.native_coding_worktree_admissible_v1(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function destruktion_meta.native_coding_claim_admission_v1()
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
  -- Wait before checking freshness, so a blocked root cannot age a previously
  -- validated provider proof into an admitted stale claim.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p.permit#>>'{worktree,root_identity_sha256}',25080000));
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
  if not destruktion_meta.native_coding_service_admissible_v1(p.permit_id) then
  raise exception 'native_coding_service_admission_fenced' using errcode='55000';end if;
 control:=public.devos_environment_state_v1(new.workspace_id);
  if control->'refill_enabled' is distinct from 'true'::jsonb or control->'supervisor_admission_enabled' is distinct from 'true'::jsonb then
    raise exception 'native_coding_environment_fenced' using errcode='55000'; end if;
  if (select count(*) from destruktion_meta.devos_fleet_claim_h205f22 c where c.workspace_id=new.workspace_id and c.state='ACTIVE'
      and c.expires_at>clock_timestamp() and c.target_id like 'codex-cli:%') >= (p.permit->>'physical_slot_budget')::int
    or exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 c where c.workspace_id=new.workspace_id and c.target_id=new.target_id and c.state='ACTIVE' and c.expires_at>clock_timestamp()) then
    raise exception 'native_coding_physical_capacity_fenced' using errcode='55000'; end if;
  -- Serialize physical root admission across workspaces as well as native
  -- claims within one workspace. Readback/proof checks above remain unchanged.
  if not destruktion_meta.native_coding_worktree_admissible_v1(new.workspace_id,new.task_id) then
    raise exception 'native_coding_worktree_capacity_wait' using errcode='P0N01';
  end if;
  if new.role='IMPLEMENTER' then
    -- This fixed claim trigger may run for the API role. It does not expose
    -- the private Host's state_owner-only reserve capability to that role.
    -- The task update and unique root INSERT commit or roll back together.
    begin
      insert into destruktion_meta.native_coding_worktree_fence_h205f22(workspace_id,root_identity_sha256,project_id,writer_task_id,writer_lease_generation)
        values(new.workspace_id,p.permit#>>'{worktree,root_identity_sha256}',(p.permit->>'project_id')::uuid,new.task_id,new.lease_generation)
        on conflict do nothing;
      if not found then raise exception 'native_coding_worktree_capacity_wait' using errcode='P0N01'; end if;
    exception when serialization_failure then
      -- A unique-root race cannot have dispatched anything. Translate only
      -- this bounded INSERT conflict, never retry or swallow other failures.
      raise exception 'native_coding_worktree_capacity_wait' using errcode='P0N01';
    end;
  end if;
  return new;
end $$;
