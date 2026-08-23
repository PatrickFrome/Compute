-- H205F22 W1: bind privileged reboot ingest to the exact off-host pinned AWS IID verifier.
-- Applied live through Supabase migration 20260823085243 before this repository snapshot.

create or replace function destruktion_meta.compute_fabric_validate_signed_reboot_identity_h205f22(
  p_provider_kind text,
  p_provider_instance_id text,
  p_action_id text,
  p_evidence jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, destruktion_meta
as $$
declare
  v_identity jsonb;
  v_identity_evidence jsonb;
  v_courier jsonb;
  v_cloudtrail jsonb;
  v_preflight jsonb;
  v_caller jsonb;
  v_region text;
  v_account text;
  v_verification_sha text;
  v_calculated_sha text;
begin
  if p_provider_kind <> 'AWS_EC2' then
    raise exception 'signed_reboot_identity_provider_not_supported' using errcode='22023';
  end if;
  if p_provider_instance_id is null or p_provider_instance_id !~ '^i-[0-9a-f]+$' then
    raise exception 'signed_reboot_identity_instance_invalid' using errcode='22023';
  end if;
  if p_action_id is null or p_action_id !~ '^[A-Za-z0-9._:/-]{1,240}$' then
    raise exception 'signed_reboot_identity_action_invalid' using errcode='22023';
  end if;
  if jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'signed_reboot_identity_evidence_invalid' using errcode='22023';
  end if;
  if p_evidence->>'schema' <> 'metaengine.compute.w1-aws-provider-evidence.h205f22.v1'
     or p_evidence->>'provider_action_semantics' <> 'ASYNC_REBOOT_REQUEST_ACCEPTED'
     or p_evidence->>'schema_completed_at_semantics' <> 'CLOUDTRAIL_PROVIDER_REQUEST_EVENT_TIME' then
    raise exception 'signed_reboot_identity_provider_semantics_invalid' using errcode='22023';
  end if;

  v_identity := p_evidence->'signed_provider_identity';
  if jsonb_typeof(v_identity) <> 'object' then
    raise exception 'signed_reboot_identity_verifier_receipt_missing' using errcode='22023';
  end if;
  if not (v_identity ?& array[
      'schema','classification','identity_attestation_kind','identity_attestation_verified',
      'evidence','verification_receipt_sha256','persistent_worker_proof',
      'reboot_completion_proven','w1_verified','canonical','authority_effect'
    ]::text[])
     or (v_identity - array[
      'schema','classification','identity_attestation_kind','identity_attestation_verified',
      'evidence','verification_receipt_sha256','persistent_worker_proof',
      'reboot_completion_proven','w1_verified','canonical','authority_effect'
    ]::text[]) <> '{}'::jsonb then
    raise exception 'signed_reboot_identity_verifier_receipt_shape_invalid' using errcode='22023';
  end if;
  if v_identity->>'schema' <> 'metaengine.compute.w1-aws-signed-instance-identity.h205f22.v1'
     or v_identity->>'classification' <> 'SIGNED_PROVIDER_IDENTITY_VERIFIED_NONAUTHORITY'
     or v_identity->>'identity_attestation_kind' <> 'SIGNED_PROVIDER_IDENTITY'
     or coalesce((v_identity->>'identity_attestation_verified')::boolean,false) is not true
     or coalesce((v_identity->>'persistent_worker_proof')::boolean,true) is not false
     or coalesce((v_identity->>'reboot_completion_proven')::boolean,true) is not false
     or coalesce((v_identity->>'w1_verified')::boolean,true) is not false
     or coalesce((v_identity->>'canonical')::boolean,true) is not false
     or coalesce((v_identity->>'authority_effect')::boolean,true) is not false then
    raise exception 'signed_reboot_identity_verifier_nonclaim_invalid' using errcode='22023';
  end if;

  v_identity_evidence := v_identity->'evidence';
  if jsonb_typeof(v_identity_evidence) <> 'object' then
    raise exception 'signed_reboot_identity_core_evidence_invalid' using errcode='22023';
  end if;
  if not (v_identity_evidence ?& array[
      'provider_kind','provider_instance_id','provider_account_id','region',
      'availability_zone','architecture','image_id','private_ip','pending_time',
      'signature_format','certificate_der_sha256','document_sha256','signature_der_sha256',
      'verifier_id','verifier_contract','courier_transport'
    ]::text[])
     or (v_identity_evidence - array[
      'provider_kind','provider_instance_id','provider_account_id','region',
      'availability_zone','architecture','image_id','private_ip','pending_time',
      'signature_format','certificate_der_sha256','document_sha256','signature_der_sha256',
      'verifier_id','verifier_contract','courier_transport'
    ]::text[]) <> '{}'::jsonb then
    raise exception 'signed_reboot_identity_core_evidence_shape_invalid' using errcode='22023';
  end if;

  v_region := v_identity_evidence->>'region';
  v_account := v_identity_evidence->>'provider_account_id';
  if v_identity_evidence->>'provider_kind' <> p_provider_kind
     or v_identity_evidence->>'provider_instance_id' <> p_provider_instance_id
     or v_account !~ '^[0-9]{12}$'
     or v_region <> 'us-east-2'
     or v_identity_evidence->>'signature_format' <> 'AWS_EC2_IID_RSA2048_PKCS7_SHA256'
     or v_identity_evidence->>'certificate_der_sha256' <> 'aa6f3e8afcd5e477501fbaf9d19f0945c7d94548f5a2de6375d8bfbab744cae0'
     or v_identity_evidence->>'document_sha256' !~ '^[0-9a-f]{64}$'
     or v_identity_evidence->>'signature_der_sha256' !~ '^[0-9a-f]{64}$'
     or v_identity_evidence->>'verifier_id' <> 'metaengine-w1-aws-iid-pinned-openssl-v1'
     or v_identity_evidence->>'verifier_contract' <> 'AWS_EC2_IID_RSA2048_PINNED_CERT_NOINTERN' then
    raise exception 'signed_reboot_identity_core_binding_invalid' using errcode='22023';
  end if;

  v_courier := v_identity_evidence->'courier_transport';
  if jsonb_typeof(v_courier) <> 'object'
     or not (v_courier ?& array[
       'schema','source','transport','envelope_sha256','document_transport_sha256','rsa2048_transport_sha256'
     ]::text[])
     or (v_courier - array[
       'schema','source','transport','envelope_sha256','document_transport_sha256','rsa2048_transport_sha256'
     ]::text[]) <> '{}'::jsonb
     or v_courier->>'schema' <> 'metaengine.compute.w1-aws-iid-courier.h205f22.v1'
     or v_courier->>'source' <> 'HOST_UNTRUSTED_TRANSPORT'
     or v_courier->>'transport' <> 'AWS_IMDSV2_LINK_LOCAL_IPV4'
     or v_courier->>'envelope_sha256' !~ '^[0-9a-f]{64}$'
     or v_courier->>'document_transport_sha256' <> v_identity_evidence->>'document_sha256'
     or v_courier->>'rsa2048_transport_sha256' !~ '^[0-9a-f]{64}$' then
    raise exception 'signed_reboot_identity_courier_binding_invalid' using errcode='22023';
  end if;

  v_preflight := p_evidence->'preflight';
  v_cloudtrail := p_evidence #> '{cloudtrail,cloudtrail_event}';
  v_caller := p_evidence->'caller_identity';
  if jsonb_typeof(v_preflight) <> 'object'
     or v_preflight->>'instance_id' <> p_provider_instance_id
     or v_preflight->>'availability_zone' is null
     or v_preflight->>'availability_zone' not like v_region || '%'
     or jsonb_typeof(v_cloudtrail) <> 'object'
     or v_cloudtrail->>'eventSource' <> 'ec2.amazonaws.com'
     or v_cloudtrail->>'eventName' <> 'RebootInstances'
     or v_cloudtrail->>'eventID' <> p_action_id
     or v_cloudtrail->>'awsRegion' <> v_region
     or v_cloudtrail #>> '{requestParameters,instancesSet,items,0,instanceId}' <> p_provider_instance_id
     or jsonb_typeof(v_caller) <> 'object'
     or v_caller->>'Account' <> v_account then
    raise exception 'signed_reboot_identity_provider_cross_binding_invalid' using errcode='22023';
  end if;

  v_verification_sha := v_identity->>'verification_receipt_sha256';
  if v_verification_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'signed_reboot_identity_verification_digest_invalid' using errcode='22023';
  end if;
  v_calculated_sha := encode(
    extensions.digest(
      convert_to(destruktion_meta.compute_fabric_canonical_json_h205f22(v_identity_evidence),'UTF8'),
      'sha256'
    ),
    'hex'
  );
  if v_verification_sha <> v_calculated_sha then
    raise exception 'signed_reboot_identity_verification_digest_mismatch' using errcode='22023';
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute.w1-signed-reboot-identity-validation.h205f22.v1',
    'valid',true,
    'provider_kind',p_provider_kind,
    'provider_instance_id',p_provider_instance_id,
    'provider_account_id',v_account,
    'region',v_region,
    'verification_receipt_sha256',v_verification_sha,
    'canonical',false,
    'authority_effect',false
  );
end
$$;

revoke all on function destruktion_meta.compute_fabric_validate_signed_reboot_identity_h205f22(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function destruktion_meta.compute_fabric_validate_signed_reboot_identity_h205f22(text,text,text,jsonb) to service_role;

create or replace function destruktion_meta.compute_fabric_record_worker_reboot_receipt_h205f22(
  p_worker_id text,
  p_provider_kind text,
  p_provider_instance_id text,
  p_action_id text,
  p_requested_at timestamptz,
  p_completed_at timestamptz,
  p_evidence jsonb default '{}'::jsonb,
  p_identity_attestation_kind text default 'NONE',
  p_identity_attestation_verified boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, destruktion_meta
as $$
declare
  v_receipt_id uuid;
  v_sha text;
  v_duplicate boolean := false;
  v_existing_sha text;
begin
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9._:-]{3,160}$' then
    raise exception 'invalid_worker_id' using errcode='22023';
  end if;
  if p_provider_kind not in ('AWS_EC2','DIGITALOCEAN','HETZNER_CLOUD','GENERIC_CLOUD') then
    raise exception 'invalid_provider_kind' using errcode='22023';
  end if;
  if p_provider_instance_id is null or p_provider_instance_id !~ '^[A-Za-z0-9._:/-]{1,200}$' then
    raise exception 'invalid_provider_instance_id' using errcode='22023';
  end if;
  if p_action_id is null or p_action_id !~ '^[A-Za-z0-9._:/-]{1,240}$' then
    raise exception 'invalid_action_id' using errcode='22023';
  end if;
  if p_requested_at is null or p_completed_at is null or p_completed_at < p_requested_at then
    raise exception 'invalid_reboot_action_window' using errcode='22023';
  end if;
  if p_completed_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'future_reboot_receipt_forbidden' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(p_evidence,'{}'::jsonb)) <> 'object'
     or octet_length(coalesce(p_evidence,'{}'::jsonb)::text) > 262144 then
    raise exception 'invalid_reboot_evidence' using errcode='22023';
  end if;
  if p_identity_attestation_kind not in ('NONE','PROVIDER_METADATA','SIGNED_PROVIDER_IDENTITY') then
    raise exception 'invalid_identity_attestation_kind' using errcode='22023';
  end if;
  if p_identity_attestation_verified and p_identity_attestation_kind <> 'SIGNED_PROVIDER_IDENTITY' then
    raise exception 'verified_attestation_requires_signed_provider_identity' using errcode='22023';
  end if;
  if p_identity_attestation_kind = 'SIGNED_PROVIDER_IDENTITY' and not p_identity_attestation_verified then
    raise exception 'signed_provider_identity_must_be_verified' using errcode='22023';
  end if;
  if p_identity_attestation_kind <> 'SIGNED_PROVIDER_IDENTITY' and coalesce(p_evidence ? 'signed_provider_identity',false) then
    raise exception 'signed_provider_identity_evidence_requires_signed_kind' using errcode='22023';
  end if;
  if p_identity_attestation_verified then
    perform destruktion_meta.compute_fabric_validate_signed_reboot_identity_h205f22(
      p_provider_kind,p_provider_instance_id,p_action_id,p_evidence
    );
  end if;
  if not exists (
    select 1 from destruktion_meta.compute_fabric_worker_enrollment_h205f22 e where e.worker_id=p_worker_id
  ) then
    raise exception 'worker_enrollment_required' using errcode='23503';
  end if;

  v_sha := encode(extensions.digest(convert_to(jsonb_build_object(
    'worker_id',p_worker_id,
    'provider_kind',p_provider_kind,
    'provider_instance_id',p_provider_instance_id,
    'action_kind','REBOOT',
    'action_id',p_action_id,
    'requested_at',p_requested_at,
    'completed_at',p_completed_at,
    'identity_attestation_kind',p_identity_attestation_kind,
    'identity_attestation_verified',p_identity_attestation_verified,
    'evidence',coalesce(p_evidence,'{}'::jsonb)
  )::text,'UTF8'),'sha256'),'hex');

  insert into destruktion_meta.compute_fabric_worker_reboot_receipt_h205f22(
    worker_id,provider_kind,provider_instance_id,action_kind,action_id,
    requested_at,completed_at,identity_attestation_kind,identity_attestation_verified,
    evidence,evidence_sha256,accepted,canonical,authority_effect
  ) values (
    p_worker_id,p_provider_kind,p_provider_instance_id,'REBOOT',p_action_id,
    p_requested_at,p_completed_at,p_identity_attestation_kind,p_identity_attestation_verified,
    coalesce(p_evidence,'{}'::jsonb),v_sha,true,false,false
  )
  on conflict (provider_kind,provider_instance_id,action_id) do nothing
  returning reboot_receipt_id into v_receipt_id;

  if v_receipt_id is null then
    v_duplicate := true;
    select r.reboot_receipt_id,r.evidence_sha256
      into v_receipt_id,v_existing_sha
    from destruktion_meta.compute_fabric_worker_reboot_receipt_h205f22 r
    where r.provider_kind=p_provider_kind
      and r.provider_instance_id=p_provider_instance_id
      and r.action_id=p_action_id;
    if v_existing_sha is distinct from v_sha then
      raise exception 'reboot_receipt_idempotency_conflict' using errcode='23505';
    end if;
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute.w1-provider-reboot-receipt.h205f22.v1',
    'reboot_receipt_id',v_receipt_id,
    'worker_id',p_worker_id,
    'provider_kind',p_provider_kind,
    'provider_instance_id',p_provider_instance_id,
    'action_id',p_action_id,
    'requested_at',p_requested_at,
    'completed_at',p_completed_at,
    'identity_attestation_kind',p_identity_attestation_kind,
    'identity_attestation_verified',p_identity_attestation_verified,
    'evidence_sha256',v_sha,
    'duplicate',v_duplicate,
    'accepted',true,
    'canonical',false,
    'authority_effect',false
  );
end
$$;

revoke all on function destruktion_meta.compute_fabric_record_worker_reboot_receipt_h205f22(text,text,text,text,timestamptz,timestamptz,jsonb,text,boolean) from public, anon, authenticated;
grant execute on function destruktion_meta.compute_fabric_record_worker_reboot_receipt_h205f22(text,text,text,text,timestamptz,timestamptz,jsonb,text,boolean) to service_role;

-- Force privileged writers through the SECURITY DEFINER RPC and its proof validator.
revoke insert on table destruktion_meta.compute_fabric_worker_reboot_receipt_h205f22 from service_role;
