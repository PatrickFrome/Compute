
-- METAENGINE RSI -> DevOS prepared-request admission v1
-- Source-only migration. Applying this migration does not enqueue work.
-- Invocation is service-role-only and delegates task creation to the existing DevOS scheduler.

create or replace function public.rsi_devos_admit_prepared_request_v1(
  p_workspace uuid,
  p_envelope jsonb
) returns jsonb
language plpgsql
security definer
set search_path = 'pg_catalog','public','destruktion_meta','extensions'
as $function$
declare
  v_control destruktion_meta.devos_fleet_runtime_control_h205f22%rowtype;
  v_request jsonb;
  v_variant jsonb;
  v_task_spec jsonb;
  v_request_material jsonb;
  v_request_material_text text;
  v_task_spec_text text;
  v_request_digest text;
  v_task_spec_digest text;
  v_source_sha text;
  v_target_branch text;
  v_point text;
  v_key text;
  v_task_spec_admitted jsonb;
  v_result jsonb;
begin
  if p_workspace is null or jsonb_typeof(p_envelope) <> 'object' then
    raise exception 'rsi_devos_admission_invalid_input';
  end if;

  if p_envelope->>'schema' <> 'metaengine.rsi.devos-admission-envelope.v1'
     or coalesce((p_envelope->>'version')::integer,0) <> 1
     or p_envelope->>'rpc_name' <> 'rsi_devos_admit_prepared_request_v1'
     or coalesce((p_envelope->>'existing_devos_scheduler_required')::boolean,false) is not true
     or coalesce((p_envelope->>'service_role_execution_required')::boolean,false) is not true
     or coalesce((p_envelope->>'runtime_control_admission_required')::boolean,false) is not true
     or p_envelope->>'task_role' <> 'IMPLEMENTER'
     or p_envelope->>'task_claim_class' <> 'MUTATING'
     or coalesce((p_envelope->>'task_creation_requested')::boolean,false) is not true
     or coalesce((p_envelope->>'task_creation_is_browser_effect')::boolean,true) is not false
     or coalesce((p_envelope->>'direct_browser_effect_enabled')::boolean,true) is not false
     or coalesce((p_envelope->>'admission_retry_idempotent_by_request_digest')::boolean,false) is not true
     or coalesce((p_envelope->>'downstream_physical_effect_retry_allowed')::boolean,true) is not false
     or coalesce((p_envelope->>'execution_authority')::boolean,true) is not false
     or coalesce((p_envelope->>'browser_authority')::boolean,true) is not false
     or coalesce((p_envelope->>'scheduler_authority')::boolean,true) is not false
     or coalesce((p_envelope->>'task_authority')::boolean,true) is not false
     or coalesce((p_envelope->>'production_mutation_authority')::boolean,true) is not false
     or coalesce((p_envelope->>'promotion_authority')::boolean,true) is not false
     or coalesce((p_envelope->>'self_update_authority')::boolean,true) is not false
     or coalesce((p_envelope->>'automatic_retry_allowed')::boolean,true) is not false
     or coalesce((p_envelope->>'authority_effect')::boolean,true) is not false then
    raise exception 'rsi_devos_admission_envelope_policy_invalid';
  end if;

  if lower(coalesce(p_envelope->>'workspace_id','')) <> lower(p_workspace::text) then
    raise exception 'rsi_devos_admission_workspace_mismatch';
  end if;

  select * into v_control
    from destruktion_meta.devos_fleet_runtime_control_h205f22
   where workspace_id = p_workspace
   for share;

  if not found then
    return jsonb_build_object(
      'accepted',false,
      'enqueued',false,
      'reason','RUNTIME_CONTROL_MISSING',
      'workspace_id',p_workspace,
      'automatic_retry_allowed',false,
      'authority_effect',false
    );
  end if;

  if not v_control.refill_enabled or not v_control.supervisor_admission_enabled then
    return jsonb_build_object(
      'accepted',false,
      'enqueued',false,
      'reason','CONTINUOUS_SERVICE_ADMISSION_FENCED',
      'workspace_id',p_workspace,
      'generation_floor',v_control.generation_floor,
      'refill_enabled',v_control.refill_enabled,
      'supervisor_admission_enabled',v_control.supervisor_admission_enabled,
      'automatic_retry_allowed',false,
      'authority_effect',false
    );
  end if;

  v_request := p_envelope->'request';
  v_variant := p_envelope->'search_variant';
  if jsonb_typeof(v_request) <> 'object' or jsonb_typeof(v_variant) <> 'object' then
    raise exception 'rsi_devos_admission_request_or_variant_invalid';
  end if;

  if v_request->>'schema' <> 'metaengine.rsi.episode-devos-candidate-request.v1'
     or coalesce((v_request->>'version')::integer,0) <> 1
     or coalesce((v_request->>'request_generation')::integer,0) <> 1
     or coalesce((v_request->>'requires_existing_devos_scheduler')::boolean,false) is not true
     or coalesce((v_request->>'external_scheduler_owner_required')::boolean,false) is not true
     or coalesce((v_request->>'dispatch_authorized')::boolean,true) is not false
     or coalesce((v_request->>'lease_created')::boolean,true) is not false
     or coalesce((v_request->>'workspace_created')::boolean,true) is not false
     or coalesce((v_request->>'task_created')::boolean,true) is not false
     or coalesce((v_request->>'one_attempt_effect_semantics_required')::boolean,false) is not true
     or coalesce((v_request->>'ambiguous_result_requires_reconciliation')::boolean,false) is not true
     or coalesce((v_request->>'repeat_after_ambiguous_result_allowed')::boolean,true) is not false
     or coalesce((v_request->>'candidate_effect_executor_exposed')::boolean,true) is not false
     or coalesce((v_request->>'execution_authority')::boolean,true) is not false
     or coalesce((v_request->>'browser_authority')::boolean,true) is not false
     or coalesce((v_request->>'scheduler_authority')::boolean,true) is not false
     or coalesce((v_request->>'task_authority')::boolean,true) is not false
     or coalesce((v_request->>'production_mutation_authority')::boolean,true) is not false
     or coalesce((v_request->>'promotion_authority')::boolean,true) is not false
     or coalesce((v_request->>'self_update_authority')::boolean,true) is not false
     or coalesce((v_request->>'automatic_retry_allowed')::boolean,true) is not false
     or coalesce((v_request->>'authority_effect')::boolean,true) is not false then
    raise exception 'rsi_devos_admission_request_policy_invalid';
  end if;

  v_request_digest := lower(coalesce(v_request->>'request_digest',''));
  v_task_spec_digest := lower(coalesce(v_request->>'task_spec_digest',''));
  v_source_sha := lower(coalesce(v_request->>'source_sha',''));
  v_target_branch := coalesce(v_request->>'target_branch','');
  v_task_spec := v_request->'task_spec';

  if v_request_digest !~ '^[0-9a-f]{64}$'
     or v_task_spec_digest !~ '^[0-9a-f]{64}$'
     or v_source_sha !~ '^[0-9a-f]{40}$'
     or v_target_branch !~ '^work/rsi/[a-z0-9][a-z0-9._/-]{2,220}$'
     or jsonb_typeof(v_task_spec) <> 'object' then
    raise exception 'rsi_devos_admission_identity_invalid';
  end if;

  if coalesce(v_variant->>'variant_digest','') !~ '^[0-9a-f]{64}$'
     or coalesce(v_variant->>'routing_digest','') !~ '^(sha256:)?[0-9a-f]{64}$'
     or coalesce(v_variant->>'search_mode','') !~ '^[A-Z0-9][A-Z0-9_.:-]{0,95}$'
     or coalesce(v_variant->>'allocation_role','') not in ('EXPLOIT','EXPLORE','ONLY_COMPATIBLE')
     or coalesce((v_variant->>'scheduler_action_authorized')::boolean,true) is not false
     or coalesce((v_variant->>'candidate_can_choose_search_mode')::boolean,true) is not false
     or coalesce((v_variant->>'authority_effect')::boolean,true) is not false then
    raise exception 'rsi_devos_admission_variant_policy_invalid';
  end if;

  v_request_material_text := p_envelope->>'request_material_canonical_json';
  v_task_spec_text := p_envelope->>'task_spec_canonical_json';
  if v_request_material_text is null or v_task_spec_text is null then
    raise exception 'rsi_devos_admission_canonical_material_missing';
  end if;

  begin
    v_request_material := v_request_material_text::jsonb;
  exception when others then
    raise exception 'rsi_devos_admission_request_material_json_invalid';
  end;

  if v_request_material <> jsonb_build_object(
      'episode_id',v_request->>'episode_id',
      'source_sha',v_request->>'source_sha',
      'trust_root_set_digest',v_request->>'trust_root_set_digest',
      'experiment_id',v_request->>'experiment_id',
      'plan_digest',v_request->>'plan_digest',
      'task_spec_digest',v_request->>'task_spec_digest',
      'target_branch',v_request->>'target_branch',
      'request_generation',(v_request->>'request_generation')::integer
    ) then
    raise exception 'rsi_devos_admission_request_material_mismatch';
  end if;

  if encode(extensions.digest(convert_to(v_request_material_text,'UTF8'),'sha256'),'hex') <> v_request_digest then
    raise exception 'rsi_devos_admission_request_digest_mismatch';
  end if;

  begin
    if v_task_spec_text::jsonb <> v_task_spec then
      raise exception 'rsi_devos_admission_task_spec_canonical_mismatch';
    end if;
  exception when invalid_text_representation then
    raise exception 'rsi_devos_admission_task_spec_json_invalid';
  end;

  if encode(extensions.digest(convert_to(v_task_spec_text,'UTF8'),'sha256'),'hex') <> v_task_spec_digest then
    raise exception 'rsi_devos_admission_task_spec_digest_mismatch';
  end if;

  if lower(coalesce(v_task_spec->'rsi'->>'source_sha','')) <> v_source_sha
     or coalesce(v_task_spec->>'target_branch','') <> v_target_branch
     or coalesce(v_task_spec->'rsi'->'search_variant'->>'variant_digest','') <> v_variant->>'variant_digest'
     or coalesce(v_task_spec->'rsi'->'search_variant'->>'search_mode','') <> v_variant->>'search_mode'
     or coalesce(v_task_spec->'rsi'->'search_variant'->>'allocation_role','') <> v_variant->>'allocation_role'
     or coalesce((v_task_spec->'rsi'->'search_variant'->>'scheduler_action_authorized')::boolean,true) is not false
     or coalesce((v_task_spec->'rsi'->'search_variant'->>'candidate_can_choose_search_mode')::boolean,true) is not false then
    raise exception 'rsi_devos_admission_task_spec_binding_invalid';
  end if;

  if lower(coalesce(p_envelope->>'controller_plan_digest','')) !~ '^[0-9a-f]{64}$'
     or lower(coalesce(p_envelope->>'routing_digest','')) !~ '^[0-9a-f]{64}$' then
    raise exception 'rsi_devos_admission_controller_binding_invalid';
  end if;

  v_point := 'rsi.browser.' || substr(v_request_digest,1,24);
  v_key := 'rsi-browser:' || v_request_digest;

  v_task_spec_admitted := jsonb_set(
    v_task_spec,
    '{rsi,admission}',
    jsonb_build_object(
      'schema','metaengine.rsi.devos-admission-receipt-binding.v1',
      'request_id',v_request->>'request_id',
      'request_digest',v_request_digest,
      'controller_plan_digest',lower(p_envelope->>'controller_plan_digest'),
      'routing_digest',lower(p_envelope->>'routing_digest'),
      'variant_digest',v_variant->>'variant_digest',
      'search_mode',v_variant->>'search_mode',
      'allocation_role',v_variant->>'allocation_role',
      'workspace_id',p_workspace,
      'existing_devos_scheduler_only',true,
      'automatic_retry_after_ambiguous_effect',false,
      'candidate_effect_executor_exposed',false,
      'authority_effect',false
    ),
    true
  );

  v_result := public.devos_fleet_enqueue_v1(
    p_workspace,
    v_point,
    'IMPLEMENTER',
    v_source_sha,
    v_task_spec_admitted,
    v_key,
    v_target_branch,
    80
  );

  return jsonb_build_object(
    'accepted',true,
    'enqueued',true,
    'workspace_id',p_workspace,
    'point_id',v_point,
    'request_id',v_request->>'request_id',
    'request_digest',v_request_digest,
    'source_sha',v_source_sha,
    'target_branch',v_target_branch,
    'role','IMPLEMENTER',
    'claim_class','MUTATING',
    'priority',80,
    'existing_devos_scheduler_used',true,
    'admission_retry_idempotent',true,
    'downstream_physical_effect_retry_allowed',false,
    'scheduler_result',v_result,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end
$function$;

revoke all on function public.rsi_devos_admit_prepared_request_v1(uuid,jsonb) from public;
revoke all on function public.rsi_devos_admit_prepared_request_v1(uuid,jsonb) from anon;
revoke all on function public.rsi_devos_admit_prepared_request_v1(uuid,jsonb) from authenticated;
grant execute on function public.rsi_devos_admit_prepared_request_v1(uuid,jsonb) to service_role;
