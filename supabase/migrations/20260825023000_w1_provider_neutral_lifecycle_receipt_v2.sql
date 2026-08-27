-- W1 provider-neutral lifecycle receipt v2
-- PREPARED / NON-AUTHORITY. Additive to the AWS-specific reboot receipt v1.
-- Stores raw lifecycle evidence bound to one exact enrollment/probe/policy/source
-- incarnation. It cannot verify a provider, admit a worker, or assert W1.

create table destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22 (
  lifecycle_receipt_id uuid primary key default extensions.gen_random_uuid(),
  enrollment_id uuid not null references destruktion_meta.compute_fabric_worker_enrollment_h205f22(enrollment_id) on update restrict on delete restrict,
  worker_id text not null references destruktion_meta.compute_fabric_worker_enrollment_h205f22(worker_id) on update cascade on delete restrict,
  probe_sha256 text not null check (probe_sha256 ~ '^[0-9a-f]{64}$'),
  policy_key text not null check (policy_key ~ '^[A-Za-z0-9._:/-]{1,160}$'),
  policy_sha256 text not null check (policy_sha256 ~ '^[0-9a-f]{64}$'),
  source_github_sha text not null check (source_github_sha ~ '^[0-9a-f]{40}$'),
  provider_kind text not null check (provider_kind in ('GITHUB_CODESPACES','VERCEL_SANDBOX','AWS_EC2')),
  provider_object_id text not null check (provider_object_id ~ '^[A-Za-z0-9._:/-]{1,240}$'),
  pre_runtime_session_id text not null check (pre_runtime_session_id ~ '^[A-Za-z0-9._:/-]{1,240}$'),
  post_runtime_session_id text not null check (post_runtime_session_id ~ '^[A-Za-z0-9._:/-]{1,240}$'),
  action_kind text not null,
  action_id text not null check (action_id ~ '^[A-Za-z0-9._:/-]{1,240}$'),
  requested_at timestamptz not null,
  completed_at timestamptz not null,
  pre_provider_snapshot jsonb not null check (jsonb_typeof(pre_provider_snapshot)='object'),
  post_provider_snapshot jsonb not null check (jsonb_typeof(post_provider_snapshot)='object'),
  pre_provider_snapshot_sha256 text not null check (pre_provider_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  post_provider_snapshot_sha256 text not null check (post_provider_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  provider_readback_sha256 text not null check (provider_readback_sha256 ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null check (jsonb_typeof(evidence)='object' and octet_length(evidence::text) <= 262144),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  verification_status text not null default 'PENDING_PROVIDER_VALIDATION' check (verification_status='PENDING_PROVIDER_VALIDATION'),
  provider_identity_verified boolean not null default false check (provider_identity_verified=false),
  lifecycle_action_verified boolean not null default false check (lifecycle_action_verified=false),
  accepted boolean not null default false check (accepted=false),
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  created_at timestamptz not null default clock_timestamp(),
  constraint compute_fabric_worker_lifecycle_v2_time_check check (completed_at >= requested_at),
  constraint compute_fabric_worker_lifecycle_v2_session_change_check check (pre_runtime_session_id <> post_runtime_session_id),
  constraint compute_fabric_worker_lifecycle_v2_action_check check (
    (provider_kind in ('GITHUB_CODESPACES','VERCEL_SANDBOX') and action_kind='STOP_RESUME')
    or (provider_kind='AWS_EC2' and action_kind='REBOOT')
  ),
  unique(enrollment_id, provider_kind, provider_object_id, action_id)
);

comment on table destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22 is
'Non-authority raw provider lifecycle evidence bound to one exact enrollment/latest-probe/policy/source incarnation. Rows remain PENDING_PROVIDER_VALIDATION and cannot prove W1 without a separate authenticated provider validator plus persisted readback composition.';

-- Direct writes are forbidden even to service_role. Reads are allowed so the
-- dedicated compositor can be inspected through the service connector; writes
-- must pass the SECURITY DEFINER validator below.
revoke all on table destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22 from public, anon, authenticated, service_role;
grant select on table destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22 to service_role;

create or replace function public.h205f22_w1_lifecycle_receipt_ingest_v2(
  p_enrollment_id uuid,
  p_worker_id text,
  p_probe_sha256 text,
  p_policy_key text,
  p_policy_sha256 text,
  p_source_github_sha text,
  p_provider_kind text,
  p_provider_object_id text,
  p_pre_runtime_session_id text,
  p_post_runtime_session_id text,
  p_action_kind text,
  p_action_id text,
  p_requested_at timestamptz,
  p_completed_at timestamptz,
  p_pre_provider_snapshot jsonb,
  p_post_provider_snapshot jsonb,
  p_provider_readback_sha256 text,
  p_evidence jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, destruktion_meta, extensions
as $$
declare
  v_pre_sha text;
  v_post_sha text;
  v_evidence_sha text;
  v_receipt destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22%rowtype;
  v_enrollment destruktion_meta.compute_fabric_worker_enrollment_h205f22%rowtype;
  v_policy destruktion_meta.compute_fabric_linux_worker_safety_policy_h205f22%rowtype;
  v_forbidden text;
begin
  if p_enrollment_id is null or p_worker_id is null or p_provider_object_id is null or p_action_id is null then
    raise exception 'w1_lifecycle_identity_required' using errcode='22023';
  end if;
  if p_probe_sha256 !~ '^[0-9a-f]{64}$'
     or p_policy_sha256 !~ '^[0-9a-f]{64}$'
     or p_source_github_sha !~ '^[0-9a-f]{40}$'
     or p_provider_readback_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'w1_lifecycle_binding_digest_invalid' using errcode='22023';
  end if;
  if p_policy_key !~ '^[A-Za-z0-9._:/-]{1,160}$'
     or p_provider_object_id !~ '^[A-Za-z0-9._:/-]{1,240}$'
     or p_pre_runtime_session_id !~ '^[A-Za-z0-9._:/-]{1,240}$'
     or p_post_runtime_session_id !~ '^[A-Za-z0-9._:/-]{1,240}$'
     or p_action_id !~ '^[A-Za-z0-9._:/-]{1,240}$' then
    raise exception 'w1_lifecycle_identity_invalid' using errcode='22023';
  end if;
  if p_pre_runtime_session_id = p_post_runtime_session_id then
    raise exception 'w1_lifecycle_session_change_required' using errcode='22023';
  end if;

  select * into v_enrollment
  from destruktion_meta.compute_fabric_worker_enrollment_h205f22
  where enrollment_id=p_enrollment_id
  for share;
  if not found
     or v_enrollment.worker_id is distinct from p_worker_id
     or not v_enrollment.probe_verified
     or v_enrollment.latest_probe_sha256 is distinct from p_probe_sha256 then
    raise exception 'w1_lifecycle_enrollment_probe_binding_invalid' using errcode='22023';
  end if;

  select * into v_policy
  from destruktion_meta.compute_fabric_linux_worker_safety_policy_h205f22
  where policy_key=p_policy_key and enabled
  for share;
  if not found
     or v_policy.policy_sha256 is distinct from p_policy_sha256
     or not (v_enrollment.node_class_id = any(v_policy.applies_to_node_classes)) then
    raise exception 'w1_lifecycle_safety_policy_binding_invalid' using errcode='22023';
  end if;

  if p_provider_kind not in ('GITHUB_CODESPACES','VERCEL_SANDBOX','AWS_EC2') then
    raise exception 'w1_lifecycle_provider_unsupported' using errcode='22023';
  end if;
  if not ((p_provider_kind in ('GITHUB_CODESPACES','VERCEL_SANDBOX') and p_action_kind='STOP_RESUME')
          or (p_provider_kind='AWS_EC2' and p_action_kind='REBOOT')) then
    raise exception 'w1_lifecycle_action_unsupported' using errcode='22023';
  end if;
  if p_requested_at is null or p_completed_at is null or p_completed_at < p_requested_at
     or p_completed_at > clock_timestamp() then
    raise exception 'w1_lifecycle_time_invalid' using errcode='22023';
  end if;
  if jsonb_typeof(p_pre_provider_snapshot) <> 'object'
     or jsonb_typeof(p_post_provider_snapshot) <> 'object'
     or jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'w1_lifecycle_json_object_required' using errcode='22023';
  end if;
  if octet_length(p_evidence::text) > 262144 then
    raise exception 'w1_lifecycle_evidence_too_large' using errcode='22023';
  end if;

  foreach v_forbidden in array array[
    'canonical','authority_effect','persistent_worker_proof','worker_admitted','w1_verified',
    'provider_identity_verified','lifecycle_action_verified','accepted'
  ] loop
    if p_evidence ? v_forbidden then
      raise exception 'w1_lifecycle_evidence_forbidden_claim:%', v_forbidden using errcode='22023';
    end if;
  end loop;

  if p_provider_kind='GITHUB_CODESPACES' then
    if p_evidence->>'provider_api' <> 'GITHUB_CODESPACES_REST'
       or p_pre_provider_snapshot->>'name' is distinct from p_provider_object_id
       or p_post_provider_snapshot->>'name' is distinct from p_provider_object_id
       or nullif(p_pre_provider_snapshot->>'id','') is null
       or p_pre_provider_snapshot->>'id' is distinct from p_post_provider_snapshot->>'id'
       or p_pre_provider_snapshot->>'state' <> 'Available'
       or p_post_provider_snapshot->>'state' <> 'Available'
       or p_evidence->>'intermediate_state' <> 'Shutdown'
       or nullif(p_evidence->>'stop_request_id','') is null
       or nullif(p_evidence->>'start_request_id','') is null then
      raise exception 'w1_codespaces_lifecycle_shape_invalid' using errcode='22023';
    end if;
  end if;

  v_pre_sha := encode(extensions.digest(convert_to(destruktion_meta.compute_fabric_canonical_json_h205f22(p_pre_provider_snapshot),'UTF8'),'sha256'),'hex');
  v_post_sha := encode(extensions.digest(convert_to(destruktion_meta.compute_fabric_canonical_json_h205f22(p_post_provider_snapshot),'UTF8'),'sha256'),'hex');
  v_evidence_sha := encode(extensions.digest(convert_to(destruktion_meta.compute_fabric_canonical_json_h205f22(jsonb_build_object(
    'enrollment_id',p_enrollment_id,
    'worker_id',p_worker_id,
    'probe_sha256',p_probe_sha256,
    'policy_key',p_policy_key,
    'policy_sha256',p_policy_sha256,
    'source_github_sha',p_source_github_sha,
    'provider_kind',p_provider_kind,
    'provider_object_id',p_provider_object_id,
    'pre_runtime_session_id',p_pre_runtime_session_id,
    'post_runtime_session_id',p_post_runtime_session_id,
    'action_kind',p_action_kind,
    'action_id',p_action_id,
    'requested_at',p_requested_at,
    'completed_at',p_completed_at,
    'pre_provider_snapshot_sha256',v_pre_sha,
    'post_provider_snapshot_sha256',v_post_sha,
    'provider_readback_sha256',p_provider_readback_sha256,
    'evidence',p_evidence,
    'verification_status','PENDING_PROVIDER_VALIDATION',
    'provider_identity_verified',false,
    'lifecycle_action_verified',false,
    'accepted',false,
    'canonical',false,
    'authority_effect',false
  )),'UTF8'),'sha256'),'hex');

  insert into destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22(
    enrollment_id,worker_id,probe_sha256,policy_key,policy_sha256,source_github_sha,
    provider_kind,provider_object_id,pre_runtime_session_id,post_runtime_session_id,
    action_kind,action_id,requested_at,completed_at,
    pre_provider_snapshot,post_provider_snapshot,pre_provider_snapshot_sha256,post_provider_snapshot_sha256,
    provider_readback_sha256,evidence,evidence_sha256
  ) values (
    p_enrollment_id,p_worker_id,p_probe_sha256,p_policy_key,p_policy_sha256,p_source_github_sha,
    p_provider_kind,p_provider_object_id,p_pre_runtime_session_id,p_post_runtime_session_id,
    p_action_kind,p_action_id,p_requested_at,p_completed_at,
    p_pre_provider_snapshot,p_post_provider_snapshot,v_pre_sha,v_post_sha,
    p_provider_readback_sha256,p_evidence,v_evidence_sha
  ) returning * into v_receipt;

  return jsonb_build_object(
    'schema','metaengine.compute.w1-provider-lifecycle-receipt.h205f22.v2',
    'lifecycle_receipt_id',v_receipt.lifecycle_receipt_id,
    'enrollment_id',v_receipt.enrollment_id,
    'worker_id',v_receipt.worker_id,
    'probe_sha256',v_receipt.probe_sha256,
    'policy_key',v_receipt.policy_key,
    'policy_sha256',v_receipt.policy_sha256,
    'source_github_sha',v_receipt.source_github_sha,
    'provider_kind',v_receipt.provider_kind,
    'provider_object_id',v_receipt.provider_object_id,
    'pre_runtime_session_id',v_receipt.pre_runtime_session_id,
    'post_runtime_session_id',v_receipt.post_runtime_session_id,
    'action_kind',v_receipt.action_kind,
    'provider_readback_sha256',v_receipt.provider_readback_sha256,
    'pre_provider_snapshot_sha256',v_receipt.pre_provider_snapshot_sha256,
    'post_provider_snapshot_sha256',v_receipt.post_provider_snapshot_sha256,
    'evidence_sha256',v_receipt.evidence_sha256,
    'verification_status','PENDING_PROVIDER_VALIDATION',
    'provider_identity_verified',false,
    'lifecycle_action_verified',false,
    'accepted',false,
    'persistent_worker_proof',false,
    'worker_admitted',false,
    'w1_verified',false,
    'canonical',false,
    'authority_effect',false,
    'requires_authenticated_provider_validation',true,
    'requires_persisted_readback_composition',true
  );
end
$$;

revoke all on function public.h205f22_w1_lifecycle_receipt_ingest_v2(uuid,text,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.h205f22_w1_lifecycle_receipt_ingest_v2(uuid,text,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,jsonb,jsonb,text,jsonb) to service_role;
