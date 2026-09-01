-- Branch-local C0 hardening: recover the actual Browser process incarnation from
-- the trusted perception metadata, upgrade evidence fingerprints to SHA-256,
-- and reject stale/split-incarnation checkpoint generations.

create or replace function public.h205f22_compute_unified_rollover_read_v1(p_workspace uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with params as (
  select statement_timestamp() as observed_at
), browser as (
  select jsonb_build_object(
    'present', true,
    'client_id', s.client_id,
    'last_seen_at', s.last_seen_at,
    'stale', (p.observed_at - s.last_seen_at) > interval '30 seconds',
    'runtime', jsonb_strip_nulls(jsonb_build_object(
      'process_incarnation_id', coalesce(
        s.state#>>'{perception,process_incarnation_id}',
        s.state->>'process_incarnation_id'
      ),
      'supervisor_generation', s.state#>>'{supervisor_lifecycle,supervisor_generation}',
      'quiescent', s.state#>'{supervisor_lifecycle,quiescent}',
      'keepalive', jsonb_strip_nulls(jsonb_build_object(
        'state', s.state#>>'{supervisor_lifecycle,keepalive,state}',
        'supervisor_id', s.state#>>'{supervisor_lifecycle,keepalive,supervisor_id}',
        'supervisor_epoch', s.state#>'{supervisor_lifecycle,keepalive,supervisor_epoch}',
        'active_wake_id', s.state#>>'{supervisor_lifecycle,keepalive,active_wake,wake_id}',
        'pending_wake_id', s.state#>>'{supervisor_lifecycle,keepalive,pending_wake,wake_id}',
        'queued_wake_count', jsonb_array_length(coalesce(s.state#>'{supervisor_lifecycle,keepalive,queued_wakes}', '[]'::jsonb))
      )),
      'self_update', jsonb_strip_nulls(jsonb_build_object(
        'state', s.state#>>'{self_update,state}',
        'current_version', s.state#>>'{self_update,current_version}',
        'trusted_channel', s.state#>>'{self_update,trusted_channel}',
        'restart_gate_safe', s.state#>'{self_update,restart_gate_safe}'
      ))
    )),
    'authority_effect', false
  ) as value
  from public.compute_fabric_a2_browser_supervisor_state_h205f22 s
  cross join params p
  where s.workspace_id = p_workspace
  order by s.last_seen_at desc nulls last
  limit 1
), leases as (
  select jsonb_build_object(
    'active_unreleased_count', count(*) filter (
      where l.status = 'ACTIVE'
        and l.released_at is null
        and (l.expires_at is null or l.expires_at > p.observed_at)
    ),
    'authority_effect', false
  ) as value
  from public.compute_fabric_a2_supervisor_actuation_lease_h205f22 l
  cross join params p
  where l.workspace_id = p_workspace
)
select jsonb_build_object(
  'schema', 'metaengine.compute-unified.rollover-read.v1',
  'observed_at', p.observed_at,
  'workspace_id', p_workspace,
  'browser_supervisor', coalesce((select value from browser), jsonb_build_object('present', false, 'stale', true, 'authority_effect', false)),
  'actuation_leases', coalesce((select value from leases), jsonb_build_object('active_unreleased_count', 0, 'authority_effect', false)),
  'authority_effect', false
)
from params p;
$$;

revoke all on function public.h205f22_compute_unified_rollover_read_v1(uuid) from public, anon, authenticated;
grant execute on function public.h205f22_compute_unified_rollover_read_v1(uuid) to service_role;

alter table public.h205f22_compute_unified_rollover_checkpoints_v1
  add column if not exists fingerprint_algorithm text;

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
  v_process_incarnation_id text;
  v_supervisor_epoch bigint;
  v_previous public.h205f22_compute_unified_rollover_checkpoints_v1%rowtype;
  v_row public.h205f22_compute_unified_rollover_checkpoints_v1%rowtype;
  v_inserted boolean := false;
begin
  -- Serialize only writers for this workspace. Hash collisions can at worst
  -- over-serialize unrelated workspaces; they cannot merge evidence.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace::text, 205149));

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

  v_process_incarnation_id := nullif(v_envelope#>>'{continuity_identity,process_incarnation_id}', '');
  v_supervisor_epoch := nullif(v_envelope#>>'{continuity_identity,supervisor_epoch}', '')::bigint;

  if v_process_incarnation_id is null then
    raise exception 'missing process incarnation fence';
  end if;
  if v_supervisor_epoch is null or v_supervisor_epoch < 0 then
    raise exception 'missing supervisor generation fence';
  end if;

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

  v_fingerprint := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_envelope::text, 'UTF8'), 'sha256'), 'hex');

  insert into public.h205f22_compute_unified_rollover_checkpoints_v1 (
    workspace_id, observed_at, process_incarnation_id, supervisor_id, supervisor_epoch,
    evidence_fingerprint, fingerprint_algorithm, envelope
  ) values (
    p_workspace,
    (v_envelope->>'observed_at')::timestamptz,
    v_process_incarnation_id,
    v_envelope#>>'{continuity_identity,supervisor_id}',
    v_supervisor_epoch,
    v_fingerprint,
    'sha256',
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
       or v_row.fingerprint_algorithm is distinct from 'sha256' then
      raise exception 'rollover checkpoint fingerprint collision';
    end if;
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.rollover-checkpoint-write-result.v2',
    'checkpoint_id',v_row.checkpoint_id,
    'workspace_id',v_row.workspace_id,
    'observed_at',v_row.observed_at,
    'process_incarnation_id',v_row.process_incarnation_id,
    'supervisor_epoch',v_row.supervisor_epoch,
    'evidence_fingerprint',v_row.evidence_fingerprint,
    'fingerprint_algorithm','sha256',
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
