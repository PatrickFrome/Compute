-- Branch-local C0 hardening: bind every durable rollover checkpoint to the
-- authoritative Compute Unified integration checkpoint without granting that
-- provenance any Browser/restart authority.

create or replace function public.h205f22_compute_unified_source_provenance_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with cp as (
  select
    c.architecture_version,
    c.status,
    c.git_repository,
    c.git_branch,
    c.git_commit,
    c.next_milestone,
    c.created_at
  from public.compute_fabric_a2_browser_architecture_checkpoint_h205f22 c
  where c.status = 'AUTHORITATIVE'
    and c.git_repository = 'PatrickFrome/Compute'
    and c.git_branch = 'integration/compute-unified-v1'
  order by c.created_at desc, c.architecture_version desc
  limit 1
)
select coalesce(
  (
    select jsonb_build_object(
      'present', true,
      'architecture_version', architecture_version,
      'status', status,
      'git_repository', git_repository,
      'git_branch', git_branch,
      'git_commit', git_commit,
      'next_milestone', next_milestone,
      'created_at', created_at,
      'authority_effect', false
    )
    from cp
  ),
  jsonb_build_object(
    'present', false,
    'git_repository', 'PatrickFrome/Compute',
    'git_branch', 'integration/compute-unified-v1',
    'authority_effect', false
  )
);
$$;

revoke all on function public.h205f22_compute_unified_source_provenance_v1() from public, anon, authenticated;
grant execute on function public.h205f22_compute_unified_source_provenance_v1() to service_role;

alter table public.h205f22_compute_unified_rollover_checkpoints_v1
  add column if not exists source_architecture_version text,
  add column if not exists source_git_branch text,
  add column if not exists source_git_commit text;

create or replace function public.h205f22_persist_compute_unified_rollover_checkpoint_v1(p_workspace uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_envelope jsonb;
  v_source jsonb;
  v_fingerprint text;
  v_process_incarnation_id text;
  v_supervisor_epoch bigint;
  v_source_architecture_version text;
  v_source_git_branch text;
  v_source_git_commit text;
  v_previous public.h205f22_compute_unified_rollover_checkpoints_v1%rowtype;
  v_row public.h205f22_compute_unified_rollover_checkpoints_v1%rowtype;
  v_inserted boolean := false;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace::text, 205151));

  v_envelope := public.h205f22_compute_unified_rollover_checkpoint_envelope_v1(p_workspace);
  v_source := public.h205f22_compute_unified_source_provenance_v1();

  if coalesce((v_envelope->>'authority_effect')::boolean, true)
     or coalesce((v_envelope->>'restart_authorized')::boolean, true)
     or coalesce((v_envelope->>'wake_replay_authorized')::boolean, true)
     or coalesce((v_envelope->>'lease_mutation_authorized')::boolean, true) then
    raise exception 'authority-bearing rollover envelope rejected';
  end if;

  if v_envelope#>>'{continuity_identity,supervisor_id}' is distinct from 'METAENGINE_SUPERVISOR' then
    raise exception 'unexpected supervisor identity';
  end if;

  v_process_incarnation_id := nullif(v_envelope#>>'{continuity_identity,process_incarnation_id}', '');
  v_supervisor_epoch := nullif(v_envelope#>>'{continuity_identity,supervisor_epoch}', '')::bigint;

  if v_process_incarnation_id is null then
    raise exception 'missing process incarnation fence';
  end if;
  if v_supervisor_epoch is null or v_supervisor_epoch < 0 then
    raise exception 'missing supervisor generation fence';
  end if;

  if not coalesce((v_source->>'present')::boolean, false)
     or v_source->>'status' is distinct from 'AUTHORITATIVE'
     or v_source->>'git_repository' is distinct from 'PatrickFrome/Compute'
     or v_source->>'git_branch' is distinct from 'integration/compute-unified-v1' then
    raise exception 'canonical integration provenance unavailable';
  end if;

  v_source_architecture_version := nullif(v_source->>'architecture_version', '');
  v_source_git_branch := nullif(v_source->>'git_branch', '');
  v_source_git_commit := nullif(v_source->>'git_commit', '');

  if v_source_architecture_version is null then
    raise exception 'missing source checkpoint identity';
  end if;
  if v_source_git_commit is null or v_source_git_commit !~ '^[0-9a-f]{40}$' then
    raise exception 'invalid canonical integration commit';
  end if;

  v_envelope := jsonb_set(v_envelope, '{source_provenance}', v_source, true);

  select * into v_previous
  from public.h205f22_compute_unified_rollover_checkpoints_v1
  where workspace_id = p_workspace
  order by supervisor_epoch desc nulls last, checkpoint_id desc
  limit 1;

  if found and v_previous.supervisor_epoch is not null then
    if v_supervisor_epoch < v_previous.supervisor_epoch then
      raise exception 'stale supervisor generation rejected';
    end if;
    if v_supervisor_epoch = v_previous.supervisor_epoch
       and v_previous.process_incarnation_id is distinct from v_process_incarnation_id then
      raise exception 'same-generation process incarnation drift rejected';
    end if;
  end if;

  v_fingerprint := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_envelope::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.h205f22_compute_unified_rollover_checkpoints_v1 (
    workspace_id,
    observed_at,
    process_incarnation_id,
    supervisor_id,
    supervisor_epoch,
    evidence_fingerprint,
    fingerprint_algorithm,
    source_architecture_version,
    source_git_branch,
    source_git_commit,
    envelope
  ) values (
    p_workspace,
    (v_envelope->>'observed_at')::timestamptz,
    v_process_incarnation_id,
    v_envelope#>>'{continuity_identity,supervisor_id}',
    v_supervisor_epoch,
    v_fingerprint,
    'sha256',
    v_source_architecture_version,
    v_source_git_branch,
    v_source_git_commit,
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

    if v_row.envelope is distinct from v_envelope
       or v_row.fingerprint_algorithm is distinct from 'sha256'
       or v_row.source_architecture_version is distinct from v_source_architecture_version
       or v_row.source_git_branch is distinct from v_source_git_branch
       or v_row.source_git_commit is distinct from v_source_git_commit then
      raise exception 'rollover checkpoint fingerprint collision';
    end if;
  end if;

  return jsonb_build_object(
    'schema', 'metaengine.compute-unified.rollover-checkpoint-write-result.v3',
    'checkpoint_id', v_row.checkpoint_id,
    'workspace_id', v_row.workspace_id,
    'observed_at', v_row.observed_at,
    'process_incarnation_id', v_row.process_incarnation_id,
    'supervisor_epoch', v_row.supervisor_epoch,
    'source_architecture_version', v_row.source_architecture_version,
    'source_git_branch', v_row.source_git_branch,
    'source_git_commit', v_row.source_git_commit,
    'evidence_fingerprint', v_row.evidence_fingerprint,
    'fingerprint_algorithm', 'sha256',
    'idempotent', true,
    'persistence_effect', v_inserted,
    'restart_authorized', false,
    'wake_replay_authorized', false,
    'lease_mutation_authorized', false,
    'authority_effect', false
  );
end;
$$;

revoke all on function public.h205f22_persist_compute_unified_rollover_checkpoint_v1(uuid) from public, anon, authenticated;
grant execute on function public.h205f22_persist_compute_unified_rollover_checkpoint_v1(uuid) to service_role;