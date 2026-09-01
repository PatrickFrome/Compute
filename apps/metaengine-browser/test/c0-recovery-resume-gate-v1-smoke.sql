\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

create table if not exists public.compute_fabric_a2_browser_supervisor_state_h205f22 (
  workspace_id uuid not null,
  client_id text not null,
  last_seen_at timestamptz,
  supervisor_mode text,
  armed boolean,
  state jsonb not null default '{}'::jsonb,
  primary key(workspace_id,client_id)
);
create table if not exists public.compute_fabric_a2_browser_device_h205f22 (
  client_id text primary key,
  active boolean not null default false,
  revoked_at timestamptz
);
create table if not exists public.compute_fabric_a2_browser_architecture_checkpoint_h205f22 (
  architecture_version text not null,
  git_branch text not null,
  git_commit text not null,
  status text not null,
  created_at timestamptz not null default clock_timestamp()
);

\i supabase/migrations/20260901214500_compute_unified_post_successor_continuity_persistence_v1.sql
\i supabase/migrations/20260901225000_compute_unified_post_successor_continuity_readback_v2.sql
\i supabase/migrations/20260901234500_compute_unified_recovery_resume_gate_v1.sql

DO $$
declare
  p jsonb; persisted jsonb; gate jsonb; fp text;
  ws uuid:='11111111-1111-1111-1111-111111111111';
  src text:=repeat('a',40);
begin
  p:=jsonb_build_object(
    'schema','metaengine.compute-unified.post-successor-continuity-readback.v1','verified',true,
    'reason','POST_SUCCESSOR_CONTINUITY_VERIFIED','workspace_id',ws,
    'successor_client_id','client-new','successor_process_incarnation_id','proc-new','successor_supervisor_epoch',8,
    'expected_source_git_commit',src,'heartbeat_observed_at',statement_timestamp()-interval '5 seconds','enrollment_active',true,
    'automatic_retry_allowed',false,'restart_authorized',false,'wake_replay_authorized',false,
    'lease_mutation_authorized',false,'authority_effect',false);
  persisted:=public.h205f22_persist_compute_unified_post_successor_continuity_v1('attempt-1',p);
  fp:=persisted->>'proof_fingerprint_sha256';

  insert into public.compute_fabric_a2_browser_supervisor_state_h205f22(workspace_id,client_id,last_seen_at,supervisor_mode,armed,state)
  values(ws,'client-new',statement_timestamp(),'CONTROL',true,jsonb_build_object(
    'perception',jsonb_build_object('process_incarnation_id','proc-new'),
    'supervisor_lifecycle',jsonb_build_object(
      'keepalive',jsonb_build_object('supervisor_id','METAENGINE_SUPERVISOR','state','ACTIVE','supervisor_epoch',8),
      'supervisor_generation','IDLE')));
  insert into public.compute_fabric_a2_browser_device_h205f22(client_id,active,revoked_at) values('client-new',true,null);
  insert into public.compute_fabric_a2_browser_architecture_checkpoint_h205f22(architecture_version,git_branch,git_commit,status)
  values('COMPUTE_UNIFIED_V1','integration/compute-unified-v1',src,'AUTHORITATIVE');

  gate:=public.h205f22_compute_unified_recovery_resume_gate_v1(ws,'attempt-1',fp,'client-new','proc-new',8,src,interval '120 seconds');
  if not coalesce((gate->>'verified')::boolean,false)
     or not coalesce((gate->>'recovery_resume_eligible')::boolean,false)
     or gate->>'reason' is distinct from 'RECOVERY_RESUME_EVIDENCE_VERIFIED'
     or coalesce((gate->>'automatic_retry_allowed')::boolean,true)
     or coalesce((gate->>'restart_authorized')::boolean,true)
     or coalesce((gate->>'wake_replay_authorized')::boolean,true)
     or coalesce((gate->>'lease_mutation_authorized')::boolean,true)
     or coalesce((gate->>'promotion_authorized')::boolean,true)
     or coalesce((gate->>'authority_effect')::boolean,true) then
    raise exception 'healthy recovery-resume evidence rejected/leaked authority: %',gate;
  end if;

  gate:=public.h205f22_compute_unified_recovery_resume_gate_v1(ws,'attempt-1',repeat('b',64),'client-new','proc-new',8,src,interval '120 seconds');
  if gate->>'reason' is distinct from 'DURABLE_PROOF_REJECTED' or coalesce((gate->>'recovery_resume_eligible')::boolean,true) then
    raise exception 'wrong durable fingerprint accepted: %',gate;
  end if;

  gate:=public.h205f22_compute_unified_recovery_resume_gate_v1(ws,'attempt-1',fp,'other-client','proc-new',8,src,interval '120 seconds');
  if gate->>'reason' is distinct from 'DURABLE_PROVENANCE_MISMATCH' or coalesce((gate->>'recovery_resume_eligible')::boolean,true) then
    raise exception 'client provenance drift accepted: %',gate;
  end if;

  update public.compute_fabric_a2_browser_supervisor_state_h205f22 set last_seen_at=statement_timestamp()-interval '20 minutes' where workspace_id=ws and client_id='client-new';
  gate:=public.h205f22_compute_unified_recovery_resume_gate_v1(ws,'attempt-1',fp,'client-new','proc-new',8,src,interval '120 seconds');
  if gate->>'reason' is distinct from 'SUCCESSOR_HEARTBEAT_STALE' then raise exception 'stale heartbeat accepted: %',gate; end if;

  update public.compute_fabric_a2_browser_supervisor_state_h205f22 set last_seen_at=statement_timestamp(), state=jsonb_set(state,'{perception,process_incarnation_id}','"proc-drift"') where workspace_id=ws and client_id='client-new';
  gate:=public.h205f22_compute_unified_recovery_resume_gate_v1(ws,'attempt-1',fp,'client-new','proc-new',8,src,interval '120 seconds');
  if gate->>'reason' is distinct from 'SUCCESSOR_PROCESS_MISMATCH' then raise exception 'process drift accepted: %',gate; end if;

  update public.compute_fabric_a2_browser_supervisor_state_h205f22 set state=jsonb_set(state,'{perception,process_incarnation_id}','"proc-new"') where workspace_id=ws and client_id='client-new';
  update public.compute_fabric_a2_browser_architecture_checkpoint_h205f22 set git_commit=repeat('c',40) where status='AUTHORITATIVE';
  gate:=public.h205f22_compute_unified_recovery_resume_gate_v1(ws,'attempt-1',fp,'client-new','proc-new',8,src,interval '120 seconds');
  if gate->>'reason' is distinct from 'INTEGRATION_HEAD_MISMATCH' then raise exception 'integration drift accepted: %',gate; end if;
end $$;

DO $$ begin
 if has_function_privilege('anon','public.h205f22_compute_unified_recovery_resume_gate_v1(uuid,text,text,text,text,bigint,text,interval)','EXECUTE') then raise exception 'anon execute leaked'; end if;
 if has_function_privilege('authenticated','public.h205f22_compute_unified_recovery_resume_gate_v1(uuid,text,text,text,text,bigint,text,interval)','EXECUTE') then raise exception 'authenticated execute leaked'; end if;
 if not has_function_privilege('service_role','public.h205f22_compute_unified_recovery_resume_gate_v1(uuid,text,text,text,text,bigint,text,interval)','EXECUTE') then raise exception 'service_role execute missing'; end if;
end $$;
