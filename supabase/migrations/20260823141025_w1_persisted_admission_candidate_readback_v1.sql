-- H205F22 W1: production admission candidate must be composed from persisted
-- rows by immutable receipt IDs. Caller-supplied JSON projections are not
-- trusted as persisted readback provenance.
-- Applied live as Supabase migration 20260823141025.

revoke insert on table destruktion_meta.compute_fabric_worker_probe_receipt_h205f22 from service_role;

drop function if exists public.h205f22_w1_admission_candidate_readback_v1(uuid,uuid,bigint,bigint);

create function public.h205f22_w1_admission_candidate_readback_v1(
  p_safety_verification_id uuid,
  p_reboot_receipt_id uuid,
  p_pre_probe_receipt_id bigint,
  p_post_probe_receipt_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, destruktion_meta
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_safety destruktion_meta.compute_fabric_linux_worker_safety_verification_h205f22%rowtype;
  v_enrollment destruktion_meta.compute_fabric_worker_enrollment_h205f22%rowtype;
  v_binding destruktion_meta.compute_fabric_linux_worker_backend_binding_h205f22%rowtype;
  v_reboot destruktion_meta.compute_fabric_worker_reboot_receipt_h205f22%rowtype;
  v_pre destruktion_meta.compute_fabric_worker_probe_receipt_h205f22%rowtype;
  v_post destruktion_meta.compute_fabric_worker_probe_receipt_h205f22%rowtype;
  v_required jsonb;
  v_body jsonb;
  v_calc text;
  v_provider_kind text;
  v_provider_instance_id text;
  v_pre_boot text;
  v_post_boot text;
  v_evidence jsonb;
begin
  if p_safety_verification_id is null or p_reboot_receipt_id is null
     or p_pre_probe_receipt_id is null or p_post_probe_receipt_id is null
     or p_pre_probe_receipt_id = p_post_probe_receipt_id then
    raise exception 'w1_admission_receipt_ids_invalid' using errcode='22023';
  end if;

  select * into v_safety
  from destruktion_meta.compute_fabric_linux_worker_safety_verification_h205f22
  where verification_id=p_safety_verification_id
  for share;
  if not found then raise exception 'w1_safety_verification_not_found' using errcode='P0002'; end if;
  if v_safety.verification_status <> 'VERIFIED'
     or v_safety.expires_at <= v_now
     or v_safety.canonical is not false
     or v_safety.authority_effect is not false then
    raise exception 'w1_safety_verification_not_current' using errcode='22023';
  end if;
  v_body := jsonb_build_object(
    'schema','metaengine.compute.linux-worker-safety-verification.h205f22.v1',
    'observation_id',v_safety.observation_id,
    'enrollment_id',v_safety.enrollment_id,
    'worker_id',v_safety.worker_id,
    'probe_sha256',v_safety.probe_sha256,
    'policy_key',v_safety.policy_key,
    'policy_sha256',v_safety.policy_sha256,
    'verifier_id',v_safety.verifier_id,
    'verifier_kind',v_safety.verifier_kind,
    'verification_proof_sha256',v_safety.verification_proof_sha256,
    'verification_status',v_safety.verification_status,
    'verified_at',v_safety.verified_at,
    'expires_at',v_safety.expires_at,
    'evidence',v_safety.evidence,
    'canonical',false,
    'authority_effect',false
  );
  v_calc := encode(extensions.digest(convert_to(v_body::text,'UTF8'),'sha256'),'hex');
  if v_calc is distinct from v_safety.receipt_sha256 then
    raise exception 'w1_safety_receipt_digest_mismatch' using errcode='22023';
  end if;

  select * into v_enrollment
  from destruktion_meta.compute_fabric_worker_enrollment_h205f22
  where enrollment_id=v_safety.enrollment_id
  for share;
  if not found
     or v_enrollment.worker_id is distinct from v_safety.worker_id
     or v_enrollment.state <> 'PROBED'
     or not v_enrollment.probe_verified
     or v_enrollment.latest_probe_sha256 is distinct from v_safety.probe_sha256 then
    raise exception 'w1_enrollment_binding_invalid' using errcode='22023';
  end if;

  select required_capabilities into v_required
  from destruktion_meta.compute_fabric_node_class_h205f22
  where node_class_id=v_enrollment.node_class_id;
  if v_required is null or jsonb_typeof(v_required) <> 'object' then
    raise exception 'w1_node_class_policy_missing' using errcode='22023';
  end if;

  select * into v_binding
  from destruktion_meta.compute_fabric_linux_worker_backend_binding_h205f22
  where enrollment_id=v_enrollment.enrollment_id
  for share;
  if not found
     or v_binding.worker_id is distinct from v_enrollment.worker_id
     or v_binding.backend_kind not in ('NATIVE_LINUX','SELF_HOSTED_VM')
     or v_binding.persistence_mode not in ('NATIVE_PERSISTENT','PERSISTENT_SNAPSHOT')
     or v_binding.execution_state not in ('LIVE_SESSION_OBSERVED','PROBED')
     or v_binding.canonical is not false
     or v_binding.authority_effect is not false
     or jsonb_typeof(v_binding.endpoint_ref) <> 'object' then
    raise exception 'w1_persistent_backend_binding_invalid' using errcode='22023';
  end if;
  v_provider_kind := nullif(v_binding.endpoint_ref->>'provider_kind','');
  v_provider_instance_id := nullif(v_binding.endpoint_ref->>'provider_instance_id','');
  if v_provider_kind is null or v_provider_instance_id is null
     or v_binding.backend_instance_name is distinct from v_provider_instance_id then
    raise exception 'w1_backend_provider_identity_invalid' using errcode='22023';
  end if;

  select * into v_reboot
  from destruktion_meta.compute_fabric_worker_reboot_receipt_h205f22
  where reboot_receipt_id=p_reboot_receipt_id
  for share;
  if not found
     or v_reboot.worker_id is distinct from v_enrollment.worker_id
     or v_reboot.provider_kind is distinct from v_provider_kind
     or v_reboot.provider_instance_id is distinct from v_provider_instance_id
     or v_reboot.action_kind <> 'REBOOT'
     or not v_reboot.accepted
     or v_reboot.identity_attestation_kind <> 'SIGNED_PROVIDER_IDENTITY'
     or not v_reboot.identity_attestation_verified
     or v_reboot.canonical is not false
     or v_reboot.authority_effect is not false
     or v_reboot.completed_at < v_reboot.requested_at
     or v_reboot.completed_at > v_now
     or v_reboot.evidence->>'provider_action_semantics' <> 'ASYNC_REBOOT_REQUEST_ACCEPTED'
     or v_reboot.evidence->>'schema_completed_at_semantics' <> 'CLOUDTRAIL_PROVIDER_REQUEST_EVENT_TIME' then
    raise exception 'w1_reboot_receipt_invalid' using errcode='22023';
  end if;
  perform destruktion_meta.compute_fabric_validate_signed_reboot_identity_h205f22(
    v_reboot.provider_kind,v_reboot.provider_instance_id,v_reboot.action_id,v_reboot.evidence
  );
  v_calc := encode(extensions.digest(convert_to(jsonb_build_object(
    'worker_id',v_reboot.worker_id,
    'provider_kind',v_reboot.provider_kind,
    'provider_instance_id',v_reboot.provider_instance_id,
    'action_kind','REBOOT',
    'action_id',v_reboot.action_id,
    'requested_at',v_reboot.requested_at,
    'completed_at',v_reboot.completed_at,
    'identity_attestation_kind',v_reboot.identity_attestation_kind,
    'identity_attestation_verified',v_reboot.identity_attestation_verified,
    'evidence',v_reboot.evidence
  )::text,'UTF8'),'sha256'),'hex');
  if v_calc is distinct from v_reboot.evidence_sha256 then
    raise exception 'w1_reboot_receipt_digest_mismatch' using errcode='22023';
  end if;

  select * into v_pre
  from destruktion_meta.compute_fabric_worker_probe_receipt_h205f22
  where receipt_id=p_pre_probe_receipt_id
  for share;
  if not found then raise exception 'w1_pre_probe_not_found' using errcode='P0002'; end if;
  select * into v_post
  from destruktion_meta.compute_fabric_worker_probe_receipt_h205f22
  where receipt_id=p_post_probe_receipt_id
  for share;
  if not found then raise exception 'w1_post_probe_not_found' using errcode='P0002'; end if;

  if v_pre.enrollment_id is distinct from v_enrollment.enrollment_id
     or v_post.enrollment_id is distinct from v_enrollment.enrollment_id
     or v_pre.probe_schema <> 'metaengine.compute.worker-host-probe.h205f22.v2'
     or v_post.probe_schema <> 'metaengine.compute.worker-host-probe.h205f22.v2'
     or v_pre.verdict <> 'PASS' or v_post.verdict <> 'PASS'
     or jsonb_typeof(v_pre.probe_payload) <> 'object'
     or jsonb_typeof(v_post.probe_payload) <> 'object'
     or v_pre.probe_payload->>'schema' <> 'metaengine.compute.worker-host-probe.h205f22.v2'
     or v_post.probe_payload->>'schema' <> 'metaengine.compute.worker-host-probe.h205f22.v2'
     or v_pre.probe_payload->>'os' <> 'linux'
     or v_post.probe_payload->>'os' <> 'linux'
     or coalesce(v_pre.probe_payload->>'arch','') = ''
     or v_pre.probe_payload->>'arch' is distinct from v_post.probe_payload->>'arch'
     or jsonb_typeof(coalesce(v_pre.probe_payload->'capabilities','null'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(v_post.probe_payload->'capabilities','null'::jsonb)) <> 'object'
     or not ((v_pre.probe_payload->'capabilities') @> v_required)
     or not ((v_post.probe_payload->'capabilities') @> v_required) then
    raise exception 'w1_probe_binding_invalid' using errcode='22023';
  end if;

  v_calc := encode(extensions.digest(convert_to(v_pre.probe_payload::text,'UTF8'),'sha256'),'hex');
  if v_calc is distinct from v_pre.probe_sha256 then raise exception 'w1_pre_probe_digest_mismatch' using errcode='22023'; end if;
  v_body := jsonb_build_object(
    'schema','metaengine.compute.worker-probe-receipt.h205f22.v2',
    'enrollment_id',v_pre.enrollment_id,
    'worker_id',v_enrollment.worker_id,
    'node_class_id',v_enrollment.node_class_id,
    'probe_sha256',v_pre.probe_sha256,
    'verdict',v_pre.verdict,
    'class_required_capabilities',v_required,
    'class_match',true,
    'reasons',v_pre.reasons,
    'authority_effect',false
  );
  v_calc := encode(extensions.digest(convert_to(v_body::text,'UTF8'),'sha256'),'hex');
  if v_calc is distinct from v_pre.receipt_sha256 then raise exception 'w1_pre_probe_receipt_digest_mismatch' using errcode='22023'; end if;

  v_calc := encode(extensions.digest(convert_to(v_post.probe_payload::text,'UTF8'),'sha256'),'hex');
  if v_calc is distinct from v_post.probe_sha256 then raise exception 'w1_post_probe_digest_mismatch' using errcode='22023'; end if;
  v_body := jsonb_build_object(
    'schema','metaengine.compute.worker-probe-receipt.h205f22.v2',
    'enrollment_id',v_post.enrollment_id,
    'worker_id',v_enrollment.worker_id,
    'node_class_id',v_enrollment.node_class_id,
    'probe_sha256',v_post.probe_sha256,
    'verdict',v_post.verdict,
    'class_required_capabilities',v_required,
    'class_match',true,
    'reasons',v_post.reasons,
    'authority_effect',false
  );
  v_calc := encode(extensions.digest(convert_to(v_body::text,'UTF8'),'sha256'),'hex');
  if v_calc is distinct from v_post.receipt_sha256 then raise exception 'w1_post_probe_receipt_digest_mismatch' using errcode='22023'; end if;

  v_pre_boot := v_pre.probe_payload->>'boot_id';
  v_post_boot := v_post.probe_payload->>'boot_id';
  if v_pre_boot is null or v_post_boot is null
     or v_pre_boot !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_post_boot !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_pre_boot = v_post_boot then
    raise exception 'w1_boot_id_change_not_proven' using errcode='22023';
  end if;
  if not (v_pre.created_at < v_reboot.requested_at
          and v_reboot.requested_at <= v_reboot.completed_at
          and v_reboot.completed_at < v_post.created_at
          and v_post.created_at <= v_now
          and v_safety.verified_at >= v_post.created_at) then
    raise exception 'w1_reboot_probe_order_invalid' using errcode='22023';
  end if;
  if v_safety.probe_sha256 is distinct from v_post.probe_sha256 then
    raise exception 'w1_safety_not_bound_to_post_probe' using errcode='22023';
  end if;

  v_evidence := jsonb_build_object(
    'enrollment_id',v_enrollment.enrollment_id,
    'worker_id',v_enrollment.worker_id,
    'provider_kind',v_provider_kind,
    'provider_instance_id',v_provider_instance_id,
    'backend_persistence_mode',v_binding.persistence_mode,
    'safety_verification_id',v_safety.verification_id,
    'safety_verification_receipt_sha256',v_safety.receipt_sha256,
    'reboot_receipt_id',v_reboot.reboot_receipt_id,
    'reboot_evidence_sha256',v_reboot.evidence_sha256,
    'pre_probe_receipt_id',v_pre.receipt_id,
    'pre_probe_receipt_sha256',v_pre.receipt_sha256,
    'pre_boot_id',v_pre_boot,
    'post_probe_receipt_id',v_post.receipt_id,
    'post_probe_receipt_sha256',v_post.receipt_sha256,
    'post_boot_id',v_post_boot,
    'provider_identity_attestation_verified',true,
    'provider_action_completion_proven',false,
    'provider_request_observed',true
  );

  return jsonb_build_object(
    'schema','metaengine.compute.w1-admission-candidate-readback.h205f22.v1',
    'source','SUPABASE_PERSISTED_READBACK',
    'outcome','ADMISSION_CANDIDATE_NON_AUTHORITY',
    'evaluated_at',v_now,
    'evidence',v_evidence,
    'candidate_sha256',encode(extensions.digest(convert_to(v_evidence::text,'UTF8'),'sha256'),'hex'),
    'admission_candidate',true,
    'worker_admitted',false,
    'persistent_worker_proof',false,
    'w1_verified',false,
    'canonical',false,
    'authority_effect',false,
    'requires_supervisor_verification',true
  );
end
$$;

revoke all on function public.h205f22_w1_admission_candidate_readback_v1(uuid,uuid,bigint,bigint) from public, anon, authenticated;
grant execute on function public.h205f22_w1_admission_candidate_readback_v1(uuid,uuid,bigint,bigint) to service_role;
