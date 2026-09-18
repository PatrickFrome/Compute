-- Branch-local C0 hardening: classify a typed Browser restart effect receipt
-- after the precondition fence, without granting restart or retry authority.

create or replace function public.h205f22_compute_unified_restart_effect_receipt_v1(
  p_preconditions jsonb,
  p_receipt jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_outcome text;
  v_attempted boolean;
  v_readback boolean;
  v_prior_epoch bigint;
  v_successor_epoch bigint;
  v_prior_process text;
  v_successor_process text;
begin
  if p_preconditions is null or p_receipt is null then
    raise exception 'restart effect receipt evidence required';
  end if;

  if not coalesce((p_preconditions->>'preconditions_verified')::boolean,false)
     or coalesce((p_preconditions->>'authority_effect')::boolean,true)
     or coalesce((p_preconditions->>'restart_authorized')::boolean,true)
     or coalesce((p_preconditions->>'automatic_retry_allowed')::boolean,true)
     or not coalesce((p_preconditions->>'effect_must_be_single_shot')::boolean,false)
     or not coalesce((p_preconditions->>'post_effect_readback_required')::boolean,false)
     or p_preconditions->>'effect_scope' is distinct from 'BROWSER_RESTART'
     or p_preconditions->>'actuator_type' is distinct from 'NATIVE_BROWSER_TYPED_ACTUATOR' then
    raise exception 'restart preconditions are not clean typed single-shot evidence';
  end if;

  if coalesce((p_receipt->>'authority_effect')::boolean,true)
     or coalesce((p_receipt->>'automatic_retry_allowed')::boolean,true)
     or p_receipt->>'effect_scope' is distinct from 'BROWSER_RESTART'
     or p_receipt->>'actuator_type' is distinct from 'NATIVE_BROWSER_TYPED_ACTUATOR'
     or nullif(p_receipt->>'attempt_id','') is null
     or nullif(p_receipt->>'effect_key','') is null then
    raise exception 'restart receipt authority or identity rejected';
  end if;

  if p_receipt->>'workspace_id' is distinct from p_preconditions->>'workspace_id'
     or p_receipt->>'lease_id' is distinct from p_preconditions->>'lease_id'
     or p_receipt->>'target_client_id' is distinct from p_preconditions->>'target_client_id'
     or p_receipt->>'target_process_incarnation_id' is distinct from p_preconditions->>'target_process_incarnation_id'
     or (p_receipt->>'supervisor_epoch')::bigint is distinct from (p_preconditions->>'supervisor_epoch')::bigint
     or p_receipt->>'expected_source_git_commit' is distinct from p_preconditions->>'expected_source_git_commit' then
    raise exception 'restart receipt provenance mismatch';
  end if;

  v_outcome := p_receipt->>'outcome';
  v_attempted := coalesce((p_receipt->>'effect_attempted')::boolean,false);
  v_readback := coalesce((p_receipt->>'post_effect_readback_verified')::boolean,false);
  v_prior_epoch := (p_preconditions->>'supervisor_epoch')::bigint;
  v_prior_process := p_preconditions->>'target_process_incarnation_id';

  if v_outcome not in ('NOT_ATTEMPTED','ACTUATED_UNVERIFIED','AMBIGUOUS','VERIFIED_SUCCESS') then
    raise exception 'unsupported restart receipt outcome';
  end if;

  if v_outcome='NOT_ATTEMPTED' and (v_attempted or v_readback) then
    raise exception 'not-attempted receipt is inconsistent';
  elsif v_outcome in ('ACTUATED_UNVERIFIED','AMBIGUOUS') and (not v_attempted or v_readback) then
    raise exception 'unverified restart receipt is inconsistent';
  elsif v_outcome='VERIFIED_SUCCESS' then
    if not v_attempted or not v_readback then
      raise exception 'verified restart requires effect plus post-effect readback';
    end if;
    v_successor_process := p_receipt->>'observed_successor_process_incarnation_id';
    v_successor_epoch := (p_receipt->>'observed_successor_supervisor_epoch')::bigint;
    if nullif(v_successor_process,'') is null
       or v_successor_process = v_prior_process
       or v_successor_epoch is distinct from v_prior_epoch + 1 then
      raise exception 'verified restart successor identity rejected';
    end if;
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.restart-effect-receipt.v1',
    'verified',true,
    'disposition',case
      when v_outcome='NOT_ATTEMPTED' then 'NO_EFFECT'
      when v_outcome='AMBIGUOUS' then 'HOLD_AMBIGUOUS'
      when v_outcome='ACTUATED_UNVERIFIED' then 'VERIFYING'
      else 'VERIFIED_RESTART'
    end,
    'outcome',v_outcome,
    'workspace_id',p_preconditions->>'workspace_id',
    'lease_id',p_preconditions->>'lease_id',
    'attempt_id',p_receipt->>'attempt_id',
    'effect_key',p_receipt->>'effect_key',
    'target_client_id',p_preconditions->>'target_client_id',
    'prior_process_incarnation_id',v_prior_process,
    'prior_supervisor_epoch',v_prior_epoch,
    'successor_process_incarnation_id',case when v_outcome='VERIFIED_SUCCESS' then v_successor_process else null end,
    'successor_supervisor_epoch',case when v_outcome='VERIFIED_SUCCESS' then v_successor_epoch else null end,
    'expected_source_git_commit',p_preconditions->>'expected_source_git_commit',
    'automatic_retry_allowed',false,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_compute_unified_restart_effect_receipt_v1(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.h205f22_compute_unified_restart_effect_receipt_v1(jsonb,jsonb) to service_role;
