-- Branch-local C0 hardening: convert pure restart-readiness evidence into a
-- content-addressed restart intent envelope. The envelope is evidence only;
-- it never grants restart, wake replay, lease mutation, or production authority.

create or replace function public.h205f22_compute_unified_restart_intent_v1(
  p_workspace uuid,
  p_checkpoint_id bigint,
  p_successor_client_id text,
  p_successor_process_incarnation_id text,
  p_successor_epoch bigint,
  p_expected_source_git_commit text,
  p_max_heartbeat_age interval default interval '2 minutes'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_readiness jsonb;
  v_material jsonb;
  v_fingerprint text;
begin
  v_readiness := public.h205f22_compute_unified_restart_readiness_v1(
    p_workspace,
    p_checkpoint_id,
    p_successor_client_id,
    p_successor_process_incarnation_id,
    p_successor_epoch,
    p_expected_source_git_commit,
    p_max_heartbeat_age
  );

  if coalesce((v_readiness->>'authority_effect')::boolean,true)
     or coalesce((v_readiness->>'restart_authorized')::boolean,true)
     or coalesce((v_readiness->>'wake_replay_authorized')::boolean,true)
     or coalesce((v_readiness->>'lease_mutation_authorized')::boolean,true) then
    raise exception 'authority-bearing restart readiness rejected';
  end if;

  if not coalesce((v_readiness->>'restart_ready')::boolean,false) then
    return jsonb_build_object(
      'schema','metaengine.compute-unified.restart-intent.v1',
      'workspace_id',p_workspace,
      'checkpoint_id',p_checkpoint_id,
      'intent_eligible',false,
      'state','RECOVERING',
      'blockers',coalesce(v_readiness->'blockers','[]'::jsonb),
      'restart_authorized',false,
      'wake_replay_authorized',false,
      'lease_mutation_authorized',false,
      'authority_effect',false
    );
  end if;

  v_material := jsonb_build_object(
    'schema','metaengine.compute-unified.restart-intent.material.v1',
    'workspace_id',p_workspace,
    'checkpoint_id',p_checkpoint_id,
    'successor_client_id',p_successor_client_id,
    'successor_process_incarnation_id',p_successor_process_incarnation_id,
    'successor_supervisor_epoch',p_successor_epoch,
    'expected_source_git_commit',p_expected_source_git_commit,
    'restart_ready',true
  );

  v_fingerprint := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_material::text,'UTF8'),'sha256'),
    'hex'
  );

  return jsonb_build_object(
    'schema','metaengine.compute-unified.restart-intent.v1',
    'workspace_id',p_workspace,
    'checkpoint_id',p_checkpoint_id,
    'successor_client_id',p_successor_client_id,
    'successor_process_incarnation_id',p_successor_process_incarnation_id,
    'successor_supervisor_epoch',p_successor_epoch,
    'expected_source_git_commit',p_expected_source_git_commit,
    'intent_eligible',true,
    'state','ROLLOVER',
    'intent_fingerprint',v_fingerprint,
    'fingerprint_algorithm','sha256',
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_compute_unified_restart_intent_v1(uuid,bigint,text,text,bigint,text,interval) from public, anon, authenticated;
grant execute on function public.h205f22_compute_unified_restart_intent_v1(uuid,bigint,text,text,bigint,text,interval) to service_role;