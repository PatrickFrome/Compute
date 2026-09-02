-- DEVOS expired RESULT_READY successor adoption v1
-- Branch-local only. This does not complete or release the expired source lease.

create or replace function public.devos_adopt_expired_result_successor_v1(
  p_source_task_id uuid,
  p_expected_result_sha256 text,
  p_successor_base_sha text,
  p_successor_branch_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'destruktion_meta', 'extensions'
as $function$
declare
  v_source destruktion_meta.devos_fleet_task_h205f22%rowtype;
  v_successor_id uuid;
  v_key text;
  v_spec jsonb;
  v_spec_sha text;
begin
  if p_source_task_id is null then
    raise exception 'devos_source_task_required' using errcode='22023';
  end if;
  if p_expected_result_sha256 is null or p_expected_result_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'devos_exact_result_sha256_required' using errcode='22023';
  end if;
  if p_successor_base_sha is null or p_successor_base_sha !~ '^[0-9a-f]{40}$' then
    raise exception 'devos_successor_base_sha_required' using errcode='22023';
  end if;

  select * into v_source
    from destruktion_meta.devos_fleet_task_h205f22
   where task_id = p_source_task_id
   for update;

  if not found then
    raise exception 'devos_source_task_not_found';
  end if;
  if v_source.state not in ('RESULT_READY','AMBIGUOUS') then
    raise exception 'devos_source_result_not_adoptable_state:%', v_source.state;
  end if;
  if v_source.state = 'AMBIGUOUS' and coalesce(v_source.error_code,'') <> 'LEASE_EXPIRED_RESULT_UNADOPTED' then
    raise exception 'devos_source_ambiguity_not_expired_result:%', coalesce(v_source.error_code,'NULL');
  end if;
  if v_source.lease_expires_at is null or v_source.lease_expires_at > clock_timestamp() then
    raise exception 'devos_source_lease_not_expired';
  end if;
  if v_source.result_sha256 is distinct from p_expected_result_sha256 then
    raise exception 'devos_source_result_sha256_mismatch';
  end if;

  v_key := 'devos:expired-result-adoption:' || v_source.task_id::text || ':' || p_expected_result_sha256 || ':' || p_successor_base_sha;
  v_spec := jsonb_build_object(
    'schema','metaengine.devos.expired-result-successor.v1',
    'source_task_id',v_source.task_id,
    'source_result_sha256',v_source.result_sha256,
    'source_base_sha',v_source.base_sha,
    'source_branch_name',v_source.branch_name,
    'source_lease_agent_id',v_source.lease_agent_id,
    'source_lease_tab_id',v_source.lease_tab_id,
    'source_lease_target_id',v_source.lease_target_id,
    'source_agent_generation_epoch',v_source.lease_agent_generation_epoch,
    'source_lease_generation',v_source.lease_generation,
    'source_lease_expires_at',v_source.lease_expires_at,
    'verification_goal','VERIFY_AND_ADOPT_EXISTING_RESULT_WITHOUT_REPLAY',
    'automatic_retry_allowed',false,
    'browser_authority',false,
    'promotion_authority',false,
    'authority_effect',false
  );
  v_spec_sha := encode(digest(convert_to(v_spec::text,'UTF8'),'sha256'),'hex');

  insert into destruktion_meta.devos_fleet_task_h205f22(
    workspace_id,idempotency_key,point_id,role,claim_class,base_sha,branch_name,
    priority,task_spec,task_spec_sha256,state,authority_effect
  ) values (
    v_source.workspace_id,v_key,'DEVOS_EXPIRED_RESULT_SUCCESSOR_ADOPTION_V1','FALSIFIER','ADVISORY',
    p_successor_base_sha,p_successor_branch_name,greatest(v_source.priority,80),v_spec,v_spec_sha,'READY',false
  )
  on conflict (idempotency_key) do update
    set updated_at = destruktion_meta.devos_fleet_task_h205f22.updated_at
  returning task_id into v_successor_id;

  return jsonb_build_object(
    'schema','metaengine.devos.expired-result-successor-adoption.v1',
    'source_task_id',v_source.task_id,
    'source_state',v_source.state,
    'source_result_sha256',v_source.result_sha256,
    'source_lease_generation',v_source.lease_generation,
    'successor_task_id',v_successor_id,
    'successor_state','READY',
    'source_completed',false,
    'source_released',false,
    'result_replayed',false,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end
$function$;

revoke all on function public.devos_adopt_expired_result_successor_v1(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.devos_adopt_expired_result_successor_v1(uuid,text,text,text) to service_role;
