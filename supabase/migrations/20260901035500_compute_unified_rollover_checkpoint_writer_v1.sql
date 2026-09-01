-- Branch-local C0 continuity writer. Persists only zero-authority rollover envelopes.
create table if not exists public.h205f22_compute_unified_rollover_checkpoints_v1 (
  checkpoint_id bigint generated always as identity primary key,
  workspace_id uuid not null,
  observed_at timestamptz not null,
  process_incarnation_id text,
  supervisor_id text not null,
  supervisor_epoch bigint,
  evidence_fingerprint text not null,
  envelope jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint h205f22_rollover_checkpoint_zero_authority_v1 check (
    coalesce((envelope->>'authority_effect')::boolean, true) = false
    and coalesce((envelope->>'restart_authorized')::boolean, true) = false
    and coalesce((envelope->>'wake_replay_authorized')::boolean, true) = false
    and coalesce((envelope->>'lease_mutation_authorized')::boolean, true) = false
  ),
  unique (workspace_id, evidence_fingerprint)
);

revoke all on table public.h205f22_compute_unified_rollover_checkpoints_v1 from public, anon, authenticated;
revoke all on sequence public.h205f22_compute_unified_rollover_checkpoints_v1_checkpoint_id_seq from public, anon, authenticated;
grant select, insert on table public.h205f22_compute_unified_rollover_checkpoints_v1 to service_role;
grant usage, select on sequence public.h205f22_compute_unified_rollover_checkpoints_v1_checkpoint_id_seq to service_role;

create or replace function public.h205f22_persist_compute_unified_rollover_checkpoint_v1(p_workspace uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_envelope jsonb;
  v_fingerprint text;
  v_row public.h205f22_compute_unified_rollover_checkpoints_v1%rowtype;
  v_inserted boolean := false;
begin
  v_envelope := public.h205f22_compute_unified_rollover_checkpoint_envelope_v1(p_workspace);

  if coalesce((v_envelope->>'authority_effect')::boolean, true)
     or coalesce((v_envelope->>'restart_authorized')::boolean, true)
     or coalesce((v_envelope->>'wake_replay_authorized')::boolean, true)
     or coalesce((v_envelope->>'lease_mutation_authorized')::boolean, true) then
    raise exception 'authority-bearing rollover envelope rejected';
  end if;

  if v_envelope#>>'{continuity_identity,supervisor_id}' is distinct from 'METAENGINE_SUPERVISOR' then
    raise exception 'unexpected supervisor identity';
  end if;

  v_fingerprint := md5(v_envelope::text);

  insert into public.h205f22_compute_unified_rollover_checkpoints_v1 (
    workspace_id, observed_at, process_incarnation_id, supervisor_id, supervisor_epoch, evidence_fingerprint, envelope
  ) values (
    p_workspace,
    (v_envelope->>'observed_at')::timestamptz,
    v_envelope#>>'{continuity_identity,process_incarnation_id}',
    v_envelope#>>'{continuity_identity,supervisor_id}',
    nullif(v_envelope#>>'{continuity_identity,supervisor_epoch}','')::bigint,
    v_fingerprint,
    v_envelope
  )
  on conflict (workspace_id, evidence_fingerprint) do nothing
  returning * into v_row;

  v_inserted := found;

  if not v_inserted then
    select * into strict v_row
    from public.h205f22_compute_unified_rollover_checkpoints_v1
    where workspace_id = p_workspace
      and evidence_fingerprint = v_fingerprint;

    if v_row.envelope is distinct from v_envelope then
      raise exception 'rollover checkpoint fingerprint collision';
    end if;
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.rollover-checkpoint-write-result.v1',
    'checkpoint_id',v_row.checkpoint_id,
    'workspace_id',v_row.workspace_id,
    'observed_at',v_row.observed_at,
    'evidence_fingerprint',v_row.evidence_fingerprint,
    'idempotent',true,
    'persistence_effect',v_inserted,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_persist_compute_unified_rollover_checkpoint_v1(uuid) from public, anon, authenticated;
grant execute on function public.h205f22_persist_compute_unified_rollover_checkpoint_v1(uuid) to service_role;
