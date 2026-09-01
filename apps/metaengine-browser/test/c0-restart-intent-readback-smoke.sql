\set ON_ERROR_STOP on

create role anon;
create role authenticated;
create role service_role;

create table public.compute_unified_restart_intent_h205f22 (
  restart_intent_id bigint generated always as identity primary key,
  workspace_id uuid not null,
  checkpoint_id bigint not null,
  successor_client_id text not null,
  successor_process_incarnation_id text not null,
  successor_supervisor_epoch bigint not null,
  expected_source_git_commit text not null,
  intent_fingerprint text not null,
  intent_envelope jsonb not null,
  persisted_at timestamptz not null default clock_timestamp(),
  authority_effect boolean not null default false
);

\i supabase/migrations/20260901124600_compute_unified_restart_intent_readback_v1.sql

DO $$
DECLARE
  w uuid := '11111111-1111-1111-1111-111111111111';
  fp1 text := repeat('a',64);
  fp2 text := repeat('b',64);
  id1 bigint;
  id2 bigint;
  out jsonb;
BEGIN
  insert into public.compute_unified_restart_intent_h205f22(
    workspace_id,checkpoint_id,successor_client_id,successor_process_incarnation_id,
    successor_supervisor_epoch,expected_source_git_commit,intent_fingerprint,intent_envelope
  ) values (
    w,10,'browser-a','proc-a',2,repeat('c',40),fp1,
    jsonb_build_object(
      'intent_eligible',true,'authority_effect',false,'restart_authorized',false,
      'wake_replay_authorized',false,'lease_mutation_authorized',false,
      'intent_fingerprint',fp1,'checkpoint_id',10,'successor_client_id','browser-a',
      'successor_process_incarnation_id','proc-a','successor_supervisor_epoch',2,
      'expected_source_git_commit',repeat('c',40)
    )
  ) returning restart_intent_id into id1;

  out := public.h205f22_read_compute_unified_restart_intent_v1(w,id1,fp1);
  if not coalesce((out->>'verified')::boolean,false)
     or coalesce((out->>'authority_effect')::boolean,true)
     or coalesce((out->>'restart_authorized')::boolean,true) then
    raise exception 'valid zero-authority readback did not verify safely: %',out;
  end if;

  insert into public.compute_unified_restart_intent_h205f22(
    workspace_id,checkpoint_id,successor_client_id,successor_process_incarnation_id,
    successor_supervisor_epoch,expected_source_git_commit,intent_fingerprint,intent_envelope
  ) values (
    w,11,'browser-b','proc-b',3,repeat('d',40),fp2,
    jsonb_build_object(
      'intent_eligible',true,'authority_effect',false,'restart_authorized',false,
      'wake_replay_authorized',false,'lease_mutation_authorized',false,
      'intent_fingerprint',fp2,'checkpoint_id',11,'successor_client_id','browser-b',
      'successor_process_incarnation_id','proc-b','successor_supervisor_epoch',3,
      'expected_source_git_commit',repeat('d',40)
    )
  ) returning restart_intent_id into id2;

  begin
    perform public.h205f22_read_compute_unified_restart_intent_v1(w,id1,fp1);
    raise exception 'stale intent unexpectedly accepted';
  exception when others then
    if sqlerrm = 'stale intent unexpectedly accepted' then raise; end if;
  end;

  update public.compute_unified_restart_intent_h205f22
  set intent_envelope = jsonb_set(intent_envelope,'{restart_authorized}','true'::jsonb)
  where restart_intent_id=id2;
  begin
    perform public.h205f22_read_compute_unified_restart_intent_v1(w,id2,fp2);
    raise exception 'authority-bearing envelope unexpectedly accepted';
  exception when others then
    if sqlerrm = 'authority-bearing envelope unexpectedly accepted' then raise; end if;
  end;

  update public.compute_unified_restart_intent_h205f22
  set intent_envelope = jsonb_set(intent_envelope,'{restart_authorized}','false'::jsonb),
      successor_process_incarnation_id='proc-tampered'
  where restart_intent_id=id2;
  begin
    perform public.h205f22_read_compute_unified_restart_intent_v1(w,id2,fp2);
    raise exception 'provenance drift unexpectedly accepted';
  exception when others then
    if sqlerrm = 'provenance drift unexpectedly accepted' then raise; end if;
  end;
END $$;

DO $$
BEGIN
  if has_function_privilege('anon','public.h205f22_read_compute_unified_restart_intent_v1(uuid,bigint,text)','EXECUTE') then
    raise exception 'anon unexpectedly has EXECUTE';
  end if;
  if has_function_privilege('authenticated','public.h205f22_read_compute_unified_restart_intent_v1(uuid,bigint,text)','EXECUTE') then
    raise exception 'authenticated unexpectedly has EXECUTE';
  end if;
  if not has_function_privilege('service_role','public.h205f22_read_compute_unified_restart_intent_v1(uuid,bigint,text)','EXECUTE') then
    raise exception 'service_role missing EXECUTE';
  end if;
END $$;
