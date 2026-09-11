-- Harden Workspace Reincarnation replay identity without changing the transition authority boundary.
-- Source-only migration. Do not deploy from this PR.

alter function public.h205f22_a2_workspace_reincarnation_transition_v1(
  uuid,uuid,uuid,bigint,bigint,text,text,bigint,bigint,bigint,text,text,bigint,bigint,text
) rename to h205f22_a2_workspace_reincarnation_transition_core_v1;

revoke all on function public.h205f22_a2_workspace_reincarnation_transition_core_v1(
  uuid,uuid,uuid,bigint,bigint,text,text,bigint,bigint,bigint,text,text,bigint,bigint,text
) from public, anon, authenticated, service_role;

create or replace function public.h205f22_a2_workspace_reincarnation_transition_v1(
  p_transition_id uuid,
  p_binding_id uuid,
  p_workspace_id uuid,
  p_expected_workspace_generation bigint,
  p_expected_claim_id bigint,
  p_expected_tab_id text,
  p_expected_target_id text,
  p_expected_agent_generation_epoch bigint,
  p_expected_lease_generation bigint,
  p_successor_claim_id bigint,
  p_successor_tab_id text,
  p_successor_target_id text,
  p_successor_agent_generation_epoch bigint,
  p_successor_lease_generation bigint,
  p_verified_head_sha text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing public.compute_fabric_a2_workspace_reincarnation_receipt_h205f22%rowtype;
  v_expected_tab text := lower(trim(coalesce(p_expected_tab_id,'')));
  v_expected_target text := lower(trim(coalesce(p_expected_target_id,'')));
  v_successor_tab text := lower(trim(coalesce(p_successor_tab_id,'')));
  v_successor_target text := lower(trim(coalesce(p_successor_target_id,'')));
  v_verified_head text := lower(trim(coalesce(p_verified_head_sha,'')));
begin
  if p_transition_id is null or p_binding_id is null or p_workspace_id is null then
    raise exception 'workspace_reincarnation_identity_required' using errcode = '22023';
  end if;

  select * into v_existing
    from public.compute_fabric_a2_workspace_reincarnation_receipt_h205f22
   where transition_id = p_transition_id;

  if found then
    if v_existing.binding_id <> p_binding_id
       or v_existing.workspace_id <> p_workspace_id
       or v_existing.predecessor_workspace_generation <> p_expected_workspace_generation
       or v_existing.successor_workspace_generation <> p_expected_workspace_generation + 1
       or v_existing.predecessor_claim_id <> p_expected_claim_id
       or lower(v_existing.predecessor_tab_id) <> v_expected_tab
       or lower(v_existing.predecessor_target_id) <> v_expected_target
       or v_existing.predecessor_agent_generation_epoch <> p_expected_agent_generation_epoch
       or v_existing.predecessor_lease_generation <> p_expected_lease_generation
       or v_existing.successor_claim_id <> p_successor_claim_id
       or lower(v_existing.successor_tab_id) <> v_successor_tab
       or lower(v_existing.successor_target_id) <> v_successor_target
       or v_existing.successor_agent_generation_epoch <> p_successor_agent_generation_epoch
       or v_existing.successor_lease_generation <> p_successor_lease_generation
       or v_existing.verified_head_sha <> v_verified_head then
      raise exception 'workspace_reincarnation_transition_id_collision' using errcode = '23505';
    end if;

    return jsonb_build_object(
      'schema','metaengine.devos.workspace-reincarnation-transition.v1',
      'transition_id',v_existing.transition_id,
      'binding_id',v_existing.binding_id,
      'workspace_id',v_existing.workspace_id,
      'workspace_generation',v_existing.successor_workspace_generation,
      'claim_id',v_existing.successor_claim_id,
      'tab_id',v_existing.successor_tab_id,
      'target_id',v_existing.successor_target_id,
      'agent_generation_epoch',v_existing.successor_agent_generation_epoch,
      'lease_generation',v_existing.successor_lease_generation,
      'transition_already_performed',true,
      'reconciled_from_durable_receipt',true,
      'automatic_retry_allowed',false,
      'authority_effect',false
    );
  end if;

  return public.h205f22_a2_workspace_reincarnation_transition_core_v1(
    p_transition_id,
    p_binding_id,
    p_workspace_id,
    p_expected_workspace_generation,
    p_expected_claim_id,
    p_expected_tab_id,
    p_expected_target_id,
    p_expected_agent_generation_epoch,
    p_expected_lease_generation,
    p_successor_claim_id,
    p_successor_tab_id,
    p_successor_target_id,
    p_successor_agent_generation_epoch,
    p_successor_lease_generation,
    p_verified_head_sha
  );
end;
$$;

revoke all on function public.h205f22_a2_workspace_reincarnation_transition_v1(
  uuid,uuid,uuid,bigint,bigint,text,text,bigint,bigint,bigint,text,text,bigint,bigint,text
) from public, anon, authenticated;
grant execute on function public.h205f22_a2_workspace_reincarnation_transition_v1(
  uuid,uuid,uuid,bigint,bigint,text,text,bigint,bigint,bigint,text,text,bigint,bigint,text
) to service_role;
