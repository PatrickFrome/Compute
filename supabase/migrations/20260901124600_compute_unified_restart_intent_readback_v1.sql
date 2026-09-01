-- Branch-local C0 hardening: verify persisted restart intent evidence without
-- granting Browser restart, wake replay, lease mutation, or promotion authority.

create or replace function public.h205f22_read_compute_unified_restart_intent_v1(
  p_workspace uuid,
  p_restart_intent_id bigint,
  p_intent_fingerprint text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.compute_unified_restart_intent_h205f22%rowtype;
  v_latest_id bigint;
  v_env jsonb;
begin
  if p_workspace is null or p_restart_intent_id is null
     or p_intent_fingerprint is null
     or p_intent_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid restart intent readback key';
  end if;

  select * into v_row
  from public.compute_unified_restart_intent_h205f22 x
  where x.workspace_id = p_workspace
    and x.restart_intent_id = p_restart_intent_id
    and x.intent_fingerprint = p_intent_fingerprint;

  if not found then
    raise exception 'restart intent evidence not found';
  end if;

  select x.restart_intent_id into v_latest_id
  from public.compute_unified_restart_intent_h205f22 x
  where x.workspace_id = p_workspace
  order by x.successor_supervisor_epoch desc, x.restart_intent_id desc
  limit 1;

  if v_latest_id is distinct from v_row.restart_intent_id then
    raise exception 'stale restart intent evidence rejected';
  end if;

  v_env := v_row.intent_envelope;

  if coalesce((v_env->>'authority_effect')::boolean,true)
     or coalesce((v_env->>'restart_authorized')::boolean,true)
     or coalesce((v_env->>'wake_replay_authorized')::boolean,true)
     or coalesce((v_env->>'lease_mutation_authorized')::boolean,true)
     or not coalesce((v_env->>'intent_eligible')::boolean,false) then
    raise exception 'authority-bearing or ineligible restart intent evidence rejected';
  end if;

  if v_env->>'intent_fingerprint' is distinct from v_row.intent_fingerprint
     or (v_env->>'checkpoint_id')::bigint is distinct from v_row.checkpoint_id
     or v_env->>'successor_client_id' is distinct from v_row.successor_client_id
     or v_env->>'successor_process_incarnation_id' is distinct from v_row.successor_process_incarnation_id
     or (v_env->>'successor_supervisor_epoch')::bigint is distinct from v_row.successor_supervisor_epoch
     or v_env->>'expected_source_git_commit' is distinct from v_row.expected_source_git_commit then
    raise exception 'restart intent durable provenance mismatch';
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.restart-intent-readback.v1',
    'verified',true,
    'latest',true,
    'restart_intent_id',v_row.restart_intent_id,
    'workspace_id',v_row.workspace_id,
    'checkpoint_id',v_row.checkpoint_id,
    'successor_client_id',v_row.successor_client_id,
    'successor_process_incarnation_id',v_row.successor_process_incarnation_id,
    'successor_supervisor_epoch',v_row.successor_supervisor_epoch,
    'expected_source_git_commit',v_row.expected_source_git_commit,
    'intent_fingerprint',v_row.intent_fingerprint,
    'persisted_at',v_row.persisted_at,
    'state','ROLLOVER',
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_read_compute_unified_restart_intent_v1(uuid,bigint,text) from public, anon, authenticated;
grant execute on function public.h205f22_read_compute_unified_restart_intent_v1(uuid,bigint,text) to service_role;
