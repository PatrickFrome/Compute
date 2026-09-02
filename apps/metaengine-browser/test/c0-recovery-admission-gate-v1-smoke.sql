\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

create table public.compute_fabric_a2_browser_supervisor_state_h205f22 (
  workspace_id uuid not null, client_id text not null, last_seen_at timestamptz,
  supervisor_mode text, armed boolean, state jsonb not null default '{}'::jsonb,
  primary key(workspace_id,client_id));
create table public.compute_fabric_a2_browser_device_h205f22 (
  client_id text primary key, active boolean not null default false, revoked_at timestamptz);
create table public.compute_fabric_a2_browser_architecture_checkpoint_h205f22 (
  architecture_version text not null, git_branch text not null, git_commit text not null,
  status text not null, created_at timestamptz not null default clock_timestamp());
create table public.compute_fabric_a2_supervisor_mesh_instance_h205f22 (
  workspace_id uuid not null, supervisor_instance_id text not null,
  primary key(workspace_id,supervisor_instance_id));
create table public.compute_fabric_a2_browser_supervisor_command_h205f22 (
  command_id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
  target_client_id text, status text not null, expires_at timestamptz not null);
create table public.compute_fabric_a2_supervisor_actuation_lease_h205f22 (
  lease_id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
  target_client_id text not null, holder_supervisor_instance_id text not null,
  effect_scope text not null default 'BROWSER_CLIENT_ACTUATION', effect_key text not null,
  status text not null, command_id uuid, acquired_at timestamptz default clock_timestamp(),
  expires_at timestamptz not null, released_at timestamptz, release_reason text, authority_effect boolean not null default false);

\i supabase/migrations/20260902000500_compute_unified_recovery_resume_proof_persistence_v1.sql
\i supabase/migrations/20260902004600_compute_unified_recovery_resume_proof_readback_v1.sql
\i supabase/migrations/20260902014600_compute_unified_recovery_admission_gate_v1.sql

DO $$
declare
  e jsonb; p jsonb; r jsonb; fp text;
  ws uuid := '33333333-3333-3333-3333-333333333333';
  src text := repeat('e',40);
begin
  e := jsonb_build_object(
    'schema','metaengine.compute-unified.recovery-resume-gate.v1',
    'verified',true,'recovery_resume_eligible',true,'reason','RECOVERY_RESUME_EVIDENCE_VERIFIED',
    'workspace_id',ws,'attempt_id','attempt-admit','successor_client_id','client-admit',
    'successor_process_incarnation_id','proc-admit','successor_supervisor_epoch',11,
    'expected_source_git_commit',src,'durable_proof_fingerprint_sha256',repeat('f',64),
    'fresh_heartbeat_observed_at',statement_timestamp()-interval '5 seconds',
    'automatic_retry_allowed',false,'restart_authorized',false,'wake_replay_authorized',false,
    'lease_mutation_authorized',false,'promotion_authorized',false,'authority_effect',false);
  p := public.h205f22_persist_compute_unified_recovery_resume_proof_v1(e);
  fp := p->>'recovery_resume_fingerprint_sha256';

  insert into public.compute_fabric_a2_browser_supervisor_state_h205f22 values(
    ws,'client-admit',statement_timestamp(),'CONTROL',true,
    jsonb_build_object('perception',jsonb_build_object('process_incarnation_id','proc-admit'),
      'supervisor_lifecycle',jsonb_build_object(
        'keepalive',jsonb_build_object('supervisor_id','METAENGINE_SUPERVISOR','state','ACTIVE','supervisor_epoch',11),
        'supervisor_generation','IDLE')));
  insert into public.compute_fabric_a2_browser_device_h205f22 values('client-admit',true,null);
  insert into public.compute_fabric_a2_browser_architecture_checkpoint_h205f22
    values('COMPUTE_UNIFIED_V1','integration/compute-unified-v1',src,'AUTHORITATIVE',statement_timestamp());

  r := public.h205f22_compute_unified_recovery_admission_gate_v1(
    ws,'attempt-admit',fp,'client-admit','proc-admit',11,src,interval '120 seconds');
  if not coalesce((r->>'verified')::boolean,false)
     or r->>'reason' is distinct from 'RECOVERY_ADMISSION_EVIDENCE_VERIFIED'
     or coalesce((r->>'automatic_retry_allowed')::boolean,true)
     or coalesce((r->>'restart_authorized')::boolean,true)
     or coalesce((r->>'wake_replay_authorized')::boolean,true)
     or coalesce((r->>'lease_mutation_authorized')::boolean,true)
     or coalesce((r->>'promotion_authorized')::boolean,true)
     or coalesce((r->>'authority_effect')::boolean,true) then
    raise exception 'healthy admission rejected/leaked authority: %',r;
  end if;

  update public.compute_fabric_a2_browser_supervisor_state_h205f22
     set state=jsonb_set(state,'{perception,process_incarnation_id}','"proc-drift"')
   where workspace_id=ws and client_id='client-admit';
  r := public.h205f22_compute_unified_recovery_admission_gate_v1(ws,'attempt-admit',fp,'client-admit','proc-admit',11,src,interval '120 seconds');
  if r->>'reason' is distinct from 'SUCCESSOR_PROCESS_MISMATCH' then raise exception 'process drift admitted: %',r; end if;
  update public.compute_fabric_a2_browser_supervisor_state_h205f22
     set state=jsonb_set(state,'{perception,process_incarnation_id}','"proc-admit"')
   where workspace_id=ws and client_id='client-admit';

  insert into public.compute_fabric_a2_supervisor_mesh_instance_h205f22 values(ws,'sup_aaaaaaaaaaaaaaaaaaaaaaaa');
  insert into public.compute_fabric_a2_supervisor_actuation_lease_h205f22(
    workspace_id,target_client_id,holder_supervisor_instance_id,effect_key,status,expires_at)
  values(ws,'client-admit','sup_aaaaaaaaaaaaaaaaaaaaaaaa','effect-key-000001','ACTIVE',statement_timestamp()+interval '5 minutes');
  r := public.h205f22_compute_unified_recovery_admission_gate_v1(ws,'attempt-admit',fp,'client-admit','proc-admit',11,src,interval '120 seconds');
  if r->>'reason' is distinct from 'ACTIVE_ACTUATION_LEASE_PRESENT' then raise exception 'active lease admitted: %',r; end if;
  delete from public.compute_fabric_a2_supervisor_actuation_lease_h205f22;

  insert into public.compute_fabric_a2_browser_supervisor_command_h205f22(workspace_id,target_client_id,status,expires_at)
  values(ws,'client-admit','PENDING',statement_timestamp()+interval '5 minutes');
  r := public.h205f22_compute_unified_recovery_admission_gate_v1(ws,'attempt-admit',fp,'client-admit','proc-admit',11,src,interval '120 seconds');
  if r->>'reason' is distinct from 'UNRESOLVED_SUPERVISOR_COMMAND_PRESENT' then raise exception 'pending command admitted: %',r; end if;
end $$;

DO $$ begin
  if has_function_privilege('anon','public.h205f22_compute_unified_recovery_admission_gate_v1(uuid,text,text,text,text,bigint,text,interval)','EXECUTE') then raise exception 'anon execute leaked'; end if;
  if has_function_privilege('authenticated','public.h205f22_compute_unified_recovery_admission_gate_v1(uuid,text,text,text,text,bigint,text,interval)','EXECUTE') then raise exception 'authenticated execute leaked'; end if;
  if not has_function_privilege('service_role','public.h205f22_compute_unified_recovery_admission_gate_v1(uuid,text,text,text,text,bigint,text,interval)','EXECUTE') then raise exception 'service_role execute missing'; end if;
end $$;
