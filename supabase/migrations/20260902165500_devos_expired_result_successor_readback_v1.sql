-- DEVOS expired RESULT_READY successor readback v1
-- Branch-local verification only. No source completion/release, no successor claim, no replay.

create or replace function public.devos_verify_expired_result_successor_readback_v1(
  p_source_task_id uuid,
  p_successor_task_id uuid,
  p_expected_result_sha256 text,
  p_expected_successor_base_sha text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'destruktion_meta'
as $function$
declare
  v_source destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_successor destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_spec jsonb;
begin
  if p_source_task_id is null or p_successor_task_id is null then
    raise exception 'devos_successor_readback_task_ids_required' using errcode='22023';
  end if;
  if p_expected_result_sha256 is null or p_expected_result_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'devos_exact_result_sha256_required' using errcode='22023';
  end if;
  if p_expected_successor_base_sha is null or p_expected_successor_base_sha !~ '^[0-9a-f]{40}$' then
    raise exception 'devos_exact_successor_base_sha_required' using errcode='22023';
  end if;

  select * into v_source
    from destruktion_meta.devos_fleet_task_h205f22
   where task_id = p_source_task_id;
  if not found then
    raise exception 'devos_source_task_not_found';
  end if;

  select * into v_successor
    from destruktion_meta.devos_fleet_task_h205f22
   where task_id = p_successor_task_id;
  if not found then
    raise exception 'devos_successor_task_not_found';
  end if;

  if v_source.result_sha256 is distinct from p_expected_result_sha256 then
    raise exception 'devos_source_result_sha256_mismatch';
  end if;
  if v_source.lease_expires_at is null or v_source.lease_expires_at > clock_timestamp() then
    raise exception 'devos_source_lease_not_expired';
  end if;
  if v_source.state not in ('RESULT_READY','AMBIGUOUS') then
    raise exception 'devos_source_result_not_adoptable_state:%', v_source.state;
  end if;
  if v_source.state = 'AMBIGUOUS' and coalesce(v_source.error_code,'') <> 'LEASE_EXPIRED_RESULT_UNADOPTED' then
    raise exception 'devos_source_ambiguity_not_expired_result:%', coalesce(v_source.error_code,'NULL');
  end if;

  v_spec := v_successor.task_spec;
  if v_successor.point_id <> 'DEVOS_EXPIRED_RESULT_SUCCESSOR_ADOPTION_V1'
     or v_successor.role <> 'FALSIFIER'
     or v_successor.claim_class <> 'ADVISORY'
     or v_successor.base_sha <> p_expected_successor_base_sha
     or v_successor.authority_effect is distinct from false
     or v_successor.workspace_id is distinct from v_source.workspace_id then
    raise exception 'devos_successor_identity_mismatch';
  end if;

  if v_spec->>'schema' <> 'metaengine.devos.expired-result-successor.v1'
     or v_spec->>'source_task_id' <> v_source.task_id::text
     or v_spec->>'source_result_sha256' <> p_expected_result_sha256
     or v_spec->>'source_lease_agent_id' is distinct from to_jsonb(v_source.lease_agent_id)#>>'{}'
     or v_spec->>'source_lease_tab_id' is distinct from to_jsonb(v_source.lease_tab_id)#>>'{}'
     or v_spec->>'source_lease_target_id' is distinct from to_jsonb(v_source.lease_target_id)#>>'{}'
     or v_spec->>'source_agent_generation_epoch' is distinct from to_jsonb(v_source.lease_agent_generation_epoch)#>>'{}'
     or v_spec->>'source_lease_generation' is distinct from to_jsonb(v_source.lease_generation)#>>'{}'
     or v_spec->>'verification_goal' <> 'VERIFY_AND_ADOPT_EXISTING_RESULT_WITHOUT_REPLAY'
     or coalesce((v_spec->>'automatic_retry_allowed')::boolean,true)
     or coalesce((v_spec->>'browser_authority')::boolean,true)
     or coalesce((v_spec->>'promotion_authority')::boolean,true)
     or coalesce((v_spec->>'authority_effect')::boolean,true) then
    raise exception 'devos_successor_provenance_or_authority_mismatch';
  end if;

  return jsonb_build_object(
    'schema','metaengine.devos.expired-result-successor-readback.v1',
    'source_task_id',v_source.task_id,
    'source_state',v_source.state,
    'source_result_sha256',v_source.result_sha256,
    'source_lease_generation',v_source.lease_generation,
    'source_lease_expired',true,
    'successor_task_id',v_successor.task_id,
    'successor_state',v_successor.state,
    'successor_base_sha',v_successor.base_sha,
    'successor_role',v_successor.role,
    'verification_goal','VERIFY_AND_ADOPT_EXISTING_RESULT_WITHOUT_REPLAY',
    'source_completed',false,
    'source_released',false,
    'result_replayed',false,
    'automatic_retry_allowed',false,
    'browser_authority',false,
    'promotion_authority',false,
    'authority_effect',false
  );
end
$function$;

revoke all on function public.devos_verify_expired_result_successor_readback_v1(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.devos_verify_expired_result_successor_readback_v1(uuid,uuid,text,text) to service_role;
