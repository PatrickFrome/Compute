-- Branch-local C0 hardening: durably persist verified restart-effect receipts
-- so ambiguous/no-retry outcomes survive supervisor/process loss.
-- Audit integration note: the table creation deliberately fails on a pre-existing relation;
-- an authority/evidence ledger must never silently adopt an unknown schema.

create extension if not exists pgcrypto;

create table public.compute_unified_restart_effect_receipt_h205f22 (
  effect_receipt_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  attempt_id text not null,
  effect_key text not null,
  lease_id text not null,
  disposition text not null check (disposition in ('NO_EFFECT','VERIFYING','HOLD_AMBIGUOUS','VERIFIED_RESTART')),
  outcome text not null check (outcome in ('NOT_ATTEMPTED','ACTUATED_UNVERIFIED','AMBIGUOUS','VERIFIED_SUCCESS')),
  target_client_id text not null,
  prior_process_incarnation_id text not null,
  prior_supervisor_epoch bigint not null,
  successor_process_incarnation_id text,
  successor_supervisor_epoch bigint,
  expected_source_git_commit text not null check (expected_source_git_commit ~ '^[0-9a-f]{40}$'),
  receipt_fingerprint_sha256 text not null check (receipt_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  verified_receipt jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  automatic_retry_allowed boolean not null default false check (automatic_retry_allowed = false),
  authority_effect boolean not null default false check (authority_effect = false),
  unique (workspace_id, attempt_id),
  unique (workspace_id, effect_key)
);

alter table public.compute_unified_restart_effect_receipt_h205f22 enable row level security;
revoke all on table public.compute_unified_restart_effect_receipt_h205f22 from public, anon, authenticated, service_role;

create or replace function public.h205f22_persist_compute_unified_restart_effect_receipt_v1(
  p_verified_receipt jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_attempt_id text;
  v_effect_key text;
  v_lease_id text;
  v_disposition text;
  v_outcome text;
  v_client text;
  v_prior_process text;
  v_prior_epoch bigint;
  v_successor_process text;
  v_successor_epoch bigint;
  v_source_commit text;
  v_fingerprint text;
  v_inserted_id uuid;
  v_existing public.compute_unified_restart_effect_receipt_h205f22%rowtype;
begin
  if p_verified_receipt is null
     or p_verified_receipt->>'schema' is distinct from 'metaengine.compute-unified.restart-effect-receipt.v1'
     or not coalesce((p_verified_receipt->>'verified')::boolean,false)
     or coalesce((p_verified_receipt->>'authority_effect')::boolean,true)
     or coalesce((p_verified_receipt->>'restart_authorized')::boolean,true)
     or coalesce((p_verified_receipt->>'wake_replay_authorized')::boolean,true)
     or coalesce((p_verified_receipt->>'lease_mutation_authorized')::boolean,true)
     or coalesce((p_verified_receipt->>'automatic_retry_allowed')::boolean,true) then
    raise exception 'restart effect receipt is not clean zero-authority verified evidence';
  end if;

  v_workspace := (p_verified_receipt->>'workspace_id')::uuid;
  v_attempt_id := nullif(p_verified_receipt->>'attempt_id','');
  v_effect_key := nullif(p_verified_receipt->>'effect_key','');
  v_lease_id := nullif(p_verified_receipt->>'lease_id','');
  v_disposition := p_verified_receipt->>'disposition';
  v_outcome := p_verified_receipt->>'outcome';
  v_client := nullif(p_verified_receipt->>'target_client_id','');
  v_prior_process := nullif(p_verified_receipt->>'prior_process_incarnation_id','');
  v_prior_epoch := (p_verified_receipt->>'prior_supervisor_epoch')::bigint;
  v_successor_process := nullif(p_verified_receipt->>'successor_process_incarnation_id','');
  v_successor_epoch := nullif(p_verified_receipt->>'successor_supervisor_epoch','')::bigint;
  v_source_commit := p_verified_receipt->>'expected_source_git_commit';

  if v_attempt_id is null or v_effect_key is null or v_lease_id is null or v_client is null
     or v_prior_process is null or v_prior_epoch is null
     or v_source_commit !~ '^[0-9a-f]{40}$' then
    raise exception 'restart effect receipt identity/provenance incomplete';
  end if;

  if (v_disposition,v_outcome) not in (
       ('NO_EFFECT','NOT_ATTEMPTED'),
       ('VERIFYING','ACTUATED_UNVERIFIED'),
       ('HOLD_AMBIGUOUS','AMBIGUOUS'),
       ('VERIFIED_RESTART','VERIFIED_SUCCESS')
     ) then
    raise exception 'restart effect receipt disposition/outcome mismatch';
  end if;

  if v_disposition='VERIFIED_RESTART' then
    if v_successor_process is null or v_successor_process = v_prior_process
       or v_successor_epoch is distinct from v_prior_epoch + 1 then
      raise exception 'verified restart successor provenance rejected';
    end if;
  elsif v_successor_process is not null or v_successor_epoch is not null then
    raise exception 'non-verified restart unexpectedly carries successor provenance';
  end if;

  v_fingerprint := encode(public.digest(convert_to(p_verified_receipt::text,'UTF8'),'sha256'),'hex');

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_workspace::text,0));

  insert into public.compute_unified_restart_effect_receipt_h205f22 (
    workspace_id,attempt_id,effect_key,lease_id,disposition,outcome,target_client_id,
    prior_process_incarnation_id,prior_supervisor_epoch,successor_process_incarnation_id,
    successor_supervisor_epoch,expected_source_git_commit,receipt_fingerprint_sha256,
    verified_receipt,automatic_retry_allowed,authority_effect
  ) values (
    v_workspace,v_attempt_id,v_effect_key,v_lease_id,v_disposition,v_outcome,v_client,
    v_prior_process,v_prior_epoch,v_successor_process,v_successor_epoch,v_source_commit,
    v_fingerprint,p_verified_receipt,false,false
  )
  on conflict (workspace_id,attempt_id) do nothing
  returning effect_receipt_id into v_inserted_id;

  select * into v_existing
  from public.compute_unified_restart_effect_receipt_h205f22
  where workspace_id=v_workspace and attempt_id=v_attempt_id;

  if v_existing.effect_receipt_id is null then
    raise exception 'restart effect receipt durable readback missing';
  end if;

  if v_existing.receipt_fingerprint_sha256 is distinct from v_fingerprint
     or v_existing.effect_key is distinct from v_effect_key
     or v_existing.lease_id is distinct from v_lease_id
     or v_existing.disposition is distinct from v_disposition
     or v_existing.outcome is distinct from v_outcome
     or v_existing.target_client_id is distinct from v_client
     or v_existing.prior_process_incarnation_id is distinct from v_prior_process
     or v_existing.prior_supervisor_epoch is distinct from v_prior_epoch
     or v_existing.successor_process_incarnation_id is distinct from v_successor_process
     or v_existing.successor_supervisor_epoch is distinct from v_successor_epoch
     or v_existing.expected_source_git_commit is distinct from v_source_commit
     or v_existing.verified_receipt is distinct from p_verified_receipt then
    raise exception 'restart effect receipt replay/provenance collision';
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.restart-effect-receipt-persistence.v1',
    'effect_receipt_id',v_existing.effect_receipt_id,
    'workspace_id',v_workspace,
    'attempt_id',v_attempt_id,
    'effect_key',v_effect_key,
    'disposition',v_disposition,
    'receipt_fingerprint_sha256',v_fingerprint,
    'persistence_effect',v_inserted_id is not null,
    'automatic_retry_allowed',false,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_persist_compute_unified_restart_effect_receipt_v1(jsonb) from public, anon, authenticated;
grant execute on function public.h205f22_persist_compute_unified_restart_effect_receipt_v1(jsonb) to service_role;
