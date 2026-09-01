\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Typed dependency stubs isolate the composition contract. Upstream functions
-- have their own terminal-GREEN PostgreSQL gates on the exact stacked lineage.
create or replace function public.h205f22_read_compute_unified_restart_effect_receipt_v1(
  p_workspace_id uuid,p_attempt_id text,p_effect_key text,p_fingerprint text
) returns jsonb language plpgsql stable as $$
begin
  if p_attempt_id='ambiguous' then
    return jsonb_build_object(
      'disposition','HOLD_AMBIGUOUS','outcome','AMBIGUOUS','consumption_state','HOLD_NO_RETRY',
      'hold_ambiguous',true,'automatic_retry_allowed',false,'restart_authorized',false,
      'wake_replay_authorized',false,'lease_mutation_authorized',false,'authority_effect',false,
      'successor_process_incarnation_id',null,'successor_supervisor_epoch',null,
      'expected_source_git_commit',repeat('a',40));
  end if;
  return jsonb_build_object(
    'disposition','VERIFIED_RESTART','outcome','VERIFIED_SUCCESS','consumption_state','VERIFIED_READBACK_ONLY',
    'hold_ambiguous',false,'automatic_retry_allowed',false,'restart_authorized',false,
    'wake_replay_authorized',false,'lease_mutation_authorized',false,'authority_effect',false,
    'successor_process_incarnation_id','proc-new','successor_supervisor_epoch',8,
    'expected_source_git_commit',repeat('a',40));
end;
$$;

create or replace function public.h205f22_compute_unified_successor_acceptance_v1(
  p_workspace uuid,p_checkpoint_id bigint,p_successor_process text,p_successor_epoch bigint,p_sha text
) returns jsonb language plpgsql stable as $$
begin
  return jsonb_build_object(
    'accepted',p_checkpoint_id<>999,
    'reason',case when p_checkpoint_id=999 then 'CHECKPOINT_NOT_LATEST' else 'SUCCESSOR_IDENTITY_ACCEPTABLE' end,
    'workspace_id',p_workspace,'checkpoint_id',p_checkpoint_id,
    'successor_process_incarnation_id',p_successor_process,
    'successor_supervisor_epoch',p_successor_epoch,
    'source_git_commit',p_sha,
    'restart_authorized',false,'wake_replay_authorized',false,
    'lease_mutation_authorized',false,'authority_effect',false);
end;
$$;

\i supabase/migrations/20260901175000_compute_unified_verified_restart_successor_continuity_v1.sql

DO $$
DECLARE
  w uuid := '11111111-1111-1111-1111-111111111111';
  sha text := repeat('a',40);
  r jsonb;
BEGIN
  r := public.h205f22_compute_unified_verified_restart_successor_continuity_v1(
    w,'attempt-ok','restart:attempt-ok',repeat('1',64),42,'proc-new',8,sha);
  if not coalesce((r->>'continuity_accepted')::boolean,false)
     or r->>'reason' is distinct from 'VERIFIED_RESTART_SUCCESSOR_CONTINUITY_ACCEPTED'
     or coalesce((r->>'automatic_retry_allowed')::boolean,true)
     or coalesce((r->>'restart_authorized')::boolean,true)
     or coalesce((r->>'authority_effect')::boolean,true) then
    raise exception 'valid continuity composition rejected or leaked authority: %',r;
  end if;

  r := public.h205f22_compute_unified_verified_restart_successor_continuity_v1(
    w,'ambiguous','restart:ambiguous',repeat('2',64),42,'proc-new',8,sha);
  if coalesce((r->>'continuity_accepted')::boolean,true)
     or r->>'reason' is distinct from 'RESTART_NOT_DURABLY_VERIFIED'
     or coalesce((r->>'automatic_retry_allowed')::boolean,true) then
    raise exception 'ambiguous restart crossed no-retry fence: %',r;
  end if;

  r := public.h205f22_compute_unified_verified_restart_successor_continuity_v1(
    w,'attempt-ok','restart:attempt-ok',repeat('3',64),42,'proc-drift',8,sha);
  if coalesce((r->>'continuity_accepted')::boolean,true)
     or r->>'reason' is distinct from 'SUCCESSOR_PROCESS_MISMATCH' then
    raise exception 'successor process drift accepted: %',r;
  end if;

  r := public.h205f22_compute_unified_verified_restart_successor_continuity_v1(
    w,'attempt-ok','restart:attempt-ok',repeat('4',64),42,'proc-new',9,sha);
  if coalesce((r->>'continuity_accepted')::boolean,true)
     or r->>'reason' is distinct from 'SUCCESSOR_EPOCH_MISMATCH' then
    raise exception 'successor epoch drift accepted: %',r;
  end if;

  r := public.h205f22_compute_unified_verified_restart_successor_continuity_v1(
    w,'attempt-ok','restart:attempt-ok',repeat('5',64),999,'proc-new',8,sha);
  if coalesce((r->>'continuity_accepted')::boolean,true)
     or r->>'reason' is distinct from 'SUCCESSOR_ACCEPTANCE_REJECTED:CHECKPOINT_NOT_LATEST' then
    raise exception 'rejected successor acceptance crossed continuity gate: %',r;
  end if;
END $$;

DO $$ BEGIN
  if has_function_privilege('anon','public.h205f22_compute_unified_verified_restart_successor_continuity_v1(uuid,text,text,text,bigint,text,bigint,text)','EXECUTE') then raise exception 'anon execute leaked'; end if;
  if has_function_privilege('authenticated','public.h205f22_compute_unified_verified_restart_successor_continuity_v1(uuid,text,text,text,bigint,text,bigint,text)','EXECUTE') then raise exception 'authenticated execute leaked'; end if;
  if not has_function_privilege('service_role','public.h205f22_compute_unified_verified_restart_successor_continuity_v1(uuid,text,text,text,bigint,text,bigint,text)','EXECUTE') then raise exception 'service_role execute missing'; end if;
END $$;
