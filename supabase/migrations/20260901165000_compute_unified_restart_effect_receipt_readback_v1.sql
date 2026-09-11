-- Branch-local C0 hardening: exact durable readback for restart-effect receipts.
-- HOLD_AMBIGUOUS remains a cross-generation no-blind-retry fence; this function grants no authority.

create or replace function public.h205f22_read_compute_unified_restart_effect_receipt_v1(
  p_workspace_id uuid,
  p_attempt_id text,
  p_effect_key text,
  p_receipt_fingerprint_sha256 text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.compute_unified_restart_effect_receipt_h205f22%rowtype;
  v_recomputed text;
begin
  if p_workspace_id is null
     or nullif(p_attempt_id,'') is null
     or nullif(p_effect_key,'') is null
     or p_receipt_fingerprint_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'restart effect receipt readback identity incomplete';
  end if;

  select * into v_row
  from public.compute_unified_restart_effect_receipt_h205f22
  where workspace_id=p_workspace_id
    and attempt_id=p_attempt_id
    and effect_key=p_effect_key
    and receipt_fingerprint_sha256=p_receipt_fingerprint_sha256;

  if v_row.effect_receipt_id is null then
    raise exception 'restart effect receipt durable readback missing';
  end if;

  if v_row.automatic_retry_allowed
     or v_row.authority_effect
     or coalesce((v_row.verified_receipt->>'authority_effect')::boolean,true)
     or coalesce((v_row.verified_receipt->>'restart_authorized')::boolean,true)
     or coalesce((v_row.verified_receipt->>'wake_replay_authorized')::boolean,true)
     or coalesce((v_row.verified_receipt->>'lease_mutation_authorized')::boolean,true)
     or coalesce((v_row.verified_receipt->>'automatic_retry_allowed')::boolean,true) then
    raise exception 'restart effect receipt durable envelope carries authority/retry';
  end if;

  if v_row.verified_receipt->>'schema' is distinct from 'metaengine.compute-unified.restart-effect-receipt.v1'
     or not coalesce((v_row.verified_receipt->>'verified')::boolean,false)
     or v_row.verified_receipt->>'workspace_id' is distinct from v_row.workspace_id::text
     or v_row.verified_receipt->>'attempt_id' is distinct from v_row.attempt_id
     or v_row.verified_receipt->>'effect_key' is distinct from v_row.effect_key
     or v_row.verified_receipt->>'lease_id' is distinct from v_row.lease_id
     or v_row.verified_receipt->>'disposition' is distinct from v_row.disposition
     or v_row.verified_receipt->>'outcome' is distinct from v_row.outcome
     or v_row.verified_receipt->>'target_client_id' is distinct from v_row.target_client_id
     or v_row.verified_receipt->>'prior_process_incarnation_id' is distinct from v_row.prior_process_incarnation_id
     or (v_row.verified_receipt->>'prior_supervisor_epoch')::bigint is distinct from v_row.prior_supervisor_epoch
     or nullif(v_row.verified_receipt->>'successor_process_incarnation_id','') is distinct from v_row.successor_process_incarnation_id
     or nullif(v_row.verified_receipt->>'successor_supervisor_epoch','')::bigint is distinct from v_row.successor_supervisor_epoch
     or v_row.verified_receipt->>'expected_source_git_commit' is distinct from v_row.expected_source_git_commit then
    raise exception 'restart effect receipt durable provenance drift';
  end if;

  v_recomputed := encode(public.digest(convert_to(v_row.verified_receipt::text,'UTF8'),'sha256'),'hex');
  if v_recomputed is distinct from v_row.receipt_fingerprint_sha256 then
    raise exception 'restart effect receipt fingerprint mismatch';
  end if;

  if (v_row.disposition,v_row.outcome) not in (
       ('NO_EFFECT','NOT_ATTEMPTED'),
       ('VERIFYING','ACTUATED_UNVERIFIED'),
       ('HOLD_AMBIGUOUS','AMBIGUOUS'),
       ('VERIFIED_RESTART','VERIFIED_SUCCESS')
     ) then
    raise exception 'restart effect receipt durable disposition/outcome mismatch';
  end if;

  if v_row.disposition='VERIFIED_RESTART' then
    if v_row.successor_process_incarnation_id is null
       or v_row.successor_process_incarnation_id=v_row.prior_process_incarnation_id
       or v_row.successor_supervisor_epoch is distinct from v_row.prior_supervisor_epoch+1 then
      raise exception 'verified restart durable successor provenance rejected';
    end if;
  elsif v_row.successor_process_incarnation_id is not null or v_row.successor_supervisor_epoch is not null then
    raise exception 'non-verified durable receipt unexpectedly carries successor provenance';
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.restart-effect-receipt-readback.v1',
    'effect_receipt_id',v_row.effect_receipt_id,
    'workspace_id',v_row.workspace_id,
    'attempt_id',v_row.attempt_id,
    'effect_key',v_row.effect_key,
    'lease_id',v_row.lease_id,
    'disposition',v_row.disposition,
    'outcome',v_row.outcome,
    'target_client_id',v_row.target_client_id,
    'prior_process_incarnation_id',v_row.prior_process_incarnation_id,
    'prior_supervisor_epoch',v_row.prior_supervisor_epoch,
    'successor_process_incarnation_id',v_row.successor_process_incarnation_id,
    'successor_supervisor_epoch',v_row.successor_supervisor_epoch,
    'expected_source_git_commit',v_row.expected_source_git_commit,
    'receipt_fingerprint_sha256',v_row.receipt_fingerprint_sha256,
    'hold_ambiguous',v_row.disposition='HOLD_AMBIGUOUS',
    'consumption_state',case
      when v_row.disposition='HOLD_AMBIGUOUS' then 'HOLD_NO_RETRY'
      when v_row.disposition='VERIFYING' then 'VERIFY_ONLY'
      when v_row.disposition='VERIFIED_RESTART' then 'VERIFIED_READBACK_ONLY'
      else 'NO_EFFECT_READBACK_ONLY'
    end,
    'automatic_retry_allowed',false,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_read_compute_unified_restart_effect_receipt_v1(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.h205f22_read_compute_unified_restart_effect_receipt_v1(uuid,text,text,text) to service_role;
