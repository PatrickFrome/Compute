\set ON_ERROR_STOP on

create role anon;
create role authenticated;
create role service_role;

\i supabase/migrations/20260901134500_compute_unified_restart_actuator_precondition_v1.sql

DO $$
DECLARE
  r jsonb := jsonb_build_object(
    'verified',true,'latest',true,'authority_effect',false,'restart_authorized',false,
    'wake_replay_authorized',false,'lease_mutation_authorized',false,'state','ROLLOVER',
    'workspace_id','11111111-1111-1111-1111-111111111111','restart_intent_id',42,
    'successor_client_id','browser-a','successor_process_incarnation_id','proc-a',
    'successor_supervisor_epoch',7,'expected_source_git_commit',repeat('a',40)
  );
  a jsonb := jsonb_build_object(
    'typed_actuator_verified',true,'lease_verified',true,'authority_effect',false,
    'effect_scope','BROWSER_RESTART','actuator_type','NATIVE_BROWSER_TYPED_ACTUATOR',
    'lease_id','lease-1','workspace_id','11111111-1111-1111-1111-111111111111',
    'target_client_id','browser-a','target_process_incarnation_id','proc-a',
    'supervisor_epoch',7,'expected_source_git_commit',repeat('a',40)
  );
  out jsonb;
BEGIN
  out := public.h205f22_compute_unified_restart_actuator_precondition_v1(r,a);
  if not coalesce((out->>'preconditions_verified')::boolean,false)
     or coalesce((out->>'authority_effect')::boolean,true)
     or coalesce((out->>'restart_authorized')::boolean,true)
     or coalesce((out->>'automatic_retry_allowed')::boolean,true)
     or not coalesce((out->>'post_effect_readback_required')::boolean,false) then
    raise exception 'valid precondition evidence did not remain fail-closed: %',out;
  end if;

  begin
    perform public.h205f22_compute_unified_restart_actuator_precondition_v1(
      r, jsonb_set(a,'{lease_verified}','false'::jsonb));
    raise exception 'unverified lease unexpectedly accepted';
  exception when others then
    if sqlerrm='unverified lease unexpectedly accepted' then raise; end if;
  end;

  begin
    perform public.h205f22_compute_unified_restart_actuator_precondition_v1(
      r, jsonb_set(a,'{target_process_incarnation_id}',to_jsonb('proc-drift'::text)));
    raise exception 'process drift unexpectedly accepted';
  exception when others then
    if sqlerrm='process drift unexpectedly accepted' then raise; end if;
  end;

  begin
    perform public.h205f22_compute_unified_restart_actuator_precondition_v1(
      jsonb_set(r,'{restart_authorized}','true'::jsonb), a);
    raise exception 'authority-bearing readback unexpectedly accepted';
  exception when others then
    if sqlerrm='authority-bearing readback unexpectedly accepted' then raise; end if;
  end;

  begin
    perform public.h205f22_compute_unified_restart_actuator_precondition_v1(
      r, jsonb_set(a,'{effect_scope}',to_jsonb('BROWSER_CLIENT_ACTUATION'::text)));
    raise exception 'wrong effect scope unexpectedly accepted';
  exception when others then
    if sqlerrm='wrong effect scope unexpectedly accepted' then raise; end if;
  end;
END $$;

DO $$
BEGIN
  if has_function_privilege('anon','public.h205f22_compute_unified_restart_actuator_precondition_v1(jsonb,jsonb)','EXECUTE') then
    raise exception 'anon unexpectedly has EXECUTE';
  end if;
  if has_function_privilege('authenticated','public.h205f22_compute_unified_restart_actuator_precondition_v1(jsonb,jsonb)','EXECUTE') then
    raise exception 'authenticated unexpectedly has EXECUTE';
  end if;
  if not has_function_privilege('service_role','public.h205f22_compute_unified_restart_actuator_precondition_v1(jsonb,jsonb)','EXECUTE') then
    raise exception 'service_role missing EXECUTE';
  end if;
END $$;
