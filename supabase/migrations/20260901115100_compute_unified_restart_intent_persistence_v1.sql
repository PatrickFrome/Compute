-- Branch-local C0 hardening: persist restart intent evidence without granting
-- Browser restart, wake replay, lease mutation, or promotion authority.

create table if not exists public.compute_unified_restart_intent_h205f22 (
  restart_intent_id bigint generated always as identity primary key,
  workspace_id uuid not null,
  checkpoint_id bigint not null,
  successor_client_id text not null,
  successor_process_incarnation_id text not null,
  successor_supervisor_epoch bigint not null check (successor_supervisor_epoch > 0),
  expected_source_git_commit text not null check (expected_source_git_commit ~ '^[0-9a-f]{40}$'),
  intent_fingerprint text not null check (intent_fingerprint ~ '^[0-9a-f]{64}$'),
  intent_envelope jsonb not null,
  persisted_at timestamptz not null default clock_timestamp(),
  authority_effect boolean not null default false check (authority_effect = false),
  unique (workspace_id, intent_fingerprint)
);

revoke all on table public.compute_unified_restart_intent_h205f22 from public, anon, authenticated, service_role;

create or replace function public.h205f22_persist_compute_unified_restart_intent_v1(
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
volatile
security definer
set search_path = ''
as $$
declare
  v_intent jsonb;
  v_fingerprint text;
  v_inserted_id bigint;
  v_existing public.compute_unified_restart_intent_h205f22%rowtype;
begin
  v_intent := public.h205f22_compute_unified_restart_intent_v1(
    p_workspace,
    p_checkpoint_id,
    p_successor_client_id,
    p_successor_process_incarnation_id,
    p_successor_epoch,
    p_expected_source_git_commit,
    p_max_heartbeat_age
  );

  if coalesce((v_intent->>'authority_effect')::boolean,true)
     or coalesce((v_intent->>'restart_authorized')::boolean,true)
     or coalesce((v_intent->>'wake_replay_authorized')::boolean,true)
     or coalesce((v_intent->>'lease_mutation_authorized')::boolean,true) then
    raise exception 'authority-bearing restart intent rejected';
  end if;

  if not coalesce((v_intent->>'intent_eligible')::boolean,false) then
    return jsonb_build_object(
      'schema','metaengine.compute-unified.restart-intent-persistence.v1',
      'persisted',false,
      'state',coalesce(v_intent->>'state','RECOVERING'),
      'blockers',coalesce(v_intent->'blockers','[]'::jsonb),
      'restart_authorized',false,
      'wake_replay_authorized',false,
      'lease_mutation_authorized',false,
      'authority_effect',false
    );
  end if;

  v_fingerprint := v_intent->>'intent_fingerprint';
  if v_fingerprint is null or v_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid restart intent fingerprint';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace::text, 0));

  if exists (
    select 1
    from public.compute_unified_restart_intent_h205f22 x
    where x.workspace_id = p_workspace
      and x.successor_supervisor_epoch > p_successor_epoch
  ) then
    raise exception 'stale successor epoch rejected';
  end if;

  insert into public.compute_unified_restart_intent_h205f22(
    workspace_id, checkpoint_id, successor_client_id,
    successor_process_incarnation_id, successor_supervisor_epoch,
    expected_source_git_commit, intent_fingerprint, intent_envelope
  ) values (
    p_workspace, p_checkpoint_id, p_successor_client_id,
    p_successor_process_incarnation_id, p_successor_epoch,
    p_expected_source_git_commit, v_fingerprint, v_intent
  )
  on conflict (workspace_id, intent_fingerprint) do nothing
  returning restart_intent_id into v_inserted_id;

  select * into v_existing
  from public.compute_unified_restart_intent_h205f22 x
  where x.workspace_id = p_workspace and x.intent_fingerprint = v_fingerprint;

  if v_existing.intent_envelope is distinct from v_intent
     or v_existing.checkpoint_id is distinct from p_checkpoint_id
     or v_existing.successor_client_id is distinct from p_successor_client_id
     or v_existing.successor_process_incarnation_id is distinct from p_successor_process_incarnation_id
     or v_existing.successor_supervisor_epoch is distinct from p_successor_epoch
     or v_existing.expected_source_git_commit is distinct from p_expected_source_git_commit then
    raise exception 'restart intent fingerprint collision or provenance drift';
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.restart-intent-persistence.v1',
    'restart_intent_id',v_existing.restart_intent_id,
    'intent_fingerprint',v_fingerprint,
    'persisted',v_inserted_id is not null,
    'replay',v_inserted_id is null,
    'state','ROLLOVER',
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_persist_compute_unified_restart_intent_v1(uuid,bigint,text,text,bigint,text,interval) from public, anon, authenticated;
grant execute on function public.h205f22_persist_compute_unified_restart_intent_v1(uuid,bigint,text,text,bigint,text,interval) to service_role;
