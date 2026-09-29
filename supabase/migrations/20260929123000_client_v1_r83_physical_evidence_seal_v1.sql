-- Client V1 C2 external physical-evidence seal.
-- Keeps post-hoc release evidence outside the already-qualified artifact subject.
-- Durable Browser enrollment/command facts are re-read from DB on every verify.
-- GitHub/Edge observations are bound into the immutable evidence payload but are
-- intentionally not granted promotion, scheduler, Browser, or retry authority.

create table if not exists public.client_v1_r83_physical_evidence_seal_h205f22 (
  seal_id uuid primary key default gen_random_uuid(),
  subject_sha text not null unique check (subject_sha ~ '^[0-9a-f]{40}$'),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  sealed_by text not null check (char_length(sealed_by) between 3 and 160),
  sealed_at timestamptz not null default clock_timestamp(),
  authority_effect boolean not null default false check (authority_effect = false),
  promotion_authority boolean not null default false check (promotion_authority = false),
  automatic_retry_allowed boolean not null default false check (automatic_retry_allowed = false)
);

alter table public.client_v1_r83_physical_evidence_seal_h205f22 enable row level security;
revoke all on table public.client_v1_r83_physical_evidence_seal_h205f22
  from public, anon, authenticated, service_role;

create or replace function public.client_v1_r83_physical_evidence_verify_v1(
  p_subject_sha text,
  p_evidence jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_subject text := lower(trim(coalesce(p_subject_sha,'')));
  v_e jsonb := coalesce(p_evidence,'{}'::jsonb);
  v_installer jsonb := v_e->'installer';
  v_installed jsonb := v_e->'installed_electron';
  v_roundtrip jsonb := v_e->'command_roundtrip';
  v_edge jsonb := v_e->'edge';
  v_rollback jsonb := v_e->'rollback_restore';
  v_health jsonb := v_e->'health_probe';
  v_request_id uuid;
  v_device_id uuid;
  v_command_id uuid;
  v_client_id text;
  v_fingerprint text;
  v_installed_run_id text;
  v_enrollment public.compute_fabric_a2_browser_device_enrollment_request_h205f22%rowtype;
  v_device public.compute_fabric_a2_browser_device_h205f22%rowtype;
  v_command public.compute_fabric_a2_browser_supervisor_command_h205f22%rowtype;
  v_digest text;
begin
  if v_subject !~ '^[0-9a-f]{40}$' then
    raise exception 'client_v1_r83_subject_sha_invalid' using errcode='22023';
  end if;
  if jsonb_typeof(v_e) <> 'object'
     or v_e->>'schema' is distinct from 'metaengine.client-v1.r83-physical-evidence.v1'
     or lower(coalesce(v_e->>'subject_sha','')) is distinct from v_subject
     or coalesce((v_e->>'authority_effect')::boolean,true) is not false
     or coalesce((v_e->>'promotion_authority')::boolean,true) is not false
     or coalesce((v_e->>'automatic_retry_allowed')::boolean,true) is not false then
    raise exception 'client_v1_r83_evidence_envelope_invalid' using errcode='22023';
  end if;

  if jsonb_typeof(v_installer) <> 'object'
     or coalesce(v_installer->>'sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(v_installer->>'producer_run_id','') !~ '^[0-9]{1,20}$'
     or coalesce(v_installer->>'producer_run_number','') !~ '^[0-9]{1,20}$'
     or coalesce(v_installer->>'producer_run_attempt','') !~ '^[1-9][0-9]{0,8}$'
     or coalesce(v_installer->>'package_version','') !~ '^[0-9]+\.[0-9]+\.[0-9]+-dev\.[0-9]+\.1$' then
    raise exception 'client_v1_r83_installer_evidence_invalid' using errcode='22023';
  end if;

  if jsonb_typeof(v_installed) <> 'object'
     or coalesce(v_installed->>'workflow_run_id','') !~ '^[0-9]{1,20}$'
     or coalesce(v_installed->>'run_attempt','') !~ '^[1-9][0-9]{0,8}$'
     or coalesce(v_installed->>'enrollment_request_id','') !~ '^[0-9a-f-]{36}$'
     or coalesce(v_installed->>'client_id','') !~ '^[0-9a-f-]{36}$'
     or coalesce(v_installed->>'device_id','') !~ '^[0-9a-f-]{36}$'
     or coalesce(v_installed->>'key_fingerprint_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce((v_installed->>'signed_transport_ready')::boolean,false) is not true
     or coalesce((v_installed->>'exact_checkout_unchanged')::boolean,false) is not true
     or coalesce((v_installed->>'private_key_exported')::boolean,true) is not false then
    raise exception 'client_v1_r83_installed_electron_evidence_invalid' using errcode='22023';
  end if;

  if jsonb_typeof(v_roundtrip) <> 'object'
     or coalesce(v_roundtrip->>'command_id','') !~ '^[0-9a-f-]{36}$'
     or v_roundtrip->>'action' is distinct from 'POLL'
     or v_roundtrip->>'lane' is distinct from 'READ_ONLY'
     or v_roundtrip->>'terminal_status' is distinct from 'COMPLETED'
     or coalesce(v_roundtrip->>'idempotency_key','') !~ '^[A-Za-z0-9._:-]{16,160}$'
     or coalesce((v_roundtrip->>'receipt_authority_effect')::boolean,true) is not false
     or lower(coalesce(v_roundtrip->>'receipt_runtime_source_sha','')) is distinct from v_subject then
    raise exception 'client_v1_r83_roundtrip_evidence_invalid' using errcode='22023';
  end if;

  if jsonb_typeof(v_edge) <> 'object'
     or jsonb_typeof(v_edge->'stable') <> 'object'
     or jsonb_typeof(v_edge->'canary') <> 'object'
     or v_edge->'stable'->>'slug' is distinct from 'a2-browser-native-supervisor-v1'
     or v_edge->'canary'->>'slug' is distinct from 'a2-browser-native-supervisor-v14-canary'
     or coalesce(v_edge->'stable'->>'version','') !~ '^[1-9][0-9]*$'
     or coalesce(v_edge->'canary'->>'version','') !~ '^[1-9][0-9]*$'
     or coalesce(v_edge->'stable'->>'digest','') !~ '^[0-9a-f]{64}$'
     or coalesce(v_edge->'canary'->>'digest','') !~ '^[0-9a-f]{64}$'
     or v_edge->'stable'->>'digest' is distinct from v_edge->'canary'->>'digest' then
    raise exception 'client_v1_r83_edge_evidence_invalid' using errcode='22023';
  end if;

  if jsonb_typeof(v_rollback) <> 'object'
     or coalesce((v_rollback->>'completed')::boolean,false) is not true
     or coalesce(v_rollback->>'rollback_canary_version','') !~ '^[1-9][0-9]*$'
     or coalesce(v_rollback->>'rollback_source_pin','') !~ '^[0-9a-f]{40}$'
     or coalesce(v_rollback->>'rollback_digest','') !~ '^[0-9a-f]{64}$'
     or coalesce(v_rollback->>'restore_canary_version','') !~ '^[1-9][0-9]*$'
     or lower(coalesce(v_rollback->>'restore_source_pin','')) is distinct from v_subject
     or coalesce(v_rollback->>'restore_digest','') !~ '^[0-9a-f]{64}$'
     or v_rollback->>'restore_digest' is distinct from v_edge->'canary'->>'digest'
     or v_rollback->>'restore_canary_version' is distinct from v_edge->'canary'->>'version'
     or coalesce((v_rollback->>'health_success')::boolean,false) is not true then
    raise exception 'client_v1_r83_rollback_evidence_invalid' using errcode='22023';
  end if;

  if jsonb_typeof(v_health) <> 'object'
     or coalesce(v_health->>'run_id','') !~ '^[0-9]{1,20}$'
     or coalesce(v_health->>'run_attempt','') !~ '^[1-9][0-9]{0,8}$'
     or lower(coalesce(v_health->>'head_sha','')) is distinct from v_subject
     or upper(coalesce(v_health->>'conclusion','')) is distinct from 'SUCCESS' then
    raise exception 'client_v1_r83_health_probe_evidence_invalid' using errcode='22023';
  end if;

  v_request_id := (v_installed->>'enrollment_request_id')::uuid;
  v_device_id := (v_installed->>'device_id')::uuid;
  v_command_id := (v_roundtrip->>'command_id')::uuid;
  v_client_id := v_installed->>'client_id';
  v_fingerprint := lower(v_installed->>'key_fingerprint_sha256');
  v_installed_run_id := v_installed->>'workflow_run_id';

  select * into v_enrollment
    from public.compute_fabric_a2_browser_device_enrollment_request_h205f22
   where request_id=v_request_id;
  if not found
     or v_enrollment.client_id is distinct from v_client_id
     or v_enrollment.status is distinct from 'CLAIMED'
     or v_enrollment.device_id is distinct from v_device_id
     or lower(v_enrollment.key_fingerprint_sha256) is distinct from v_fingerprint
     or lower(coalesce(v_enrollment.metadata->>'source_head','')) is distinct from v_subject
     or v_enrollment.metadata->>'qualification_kind' is distinct from 'INSTALLED_ELECTRON'
     or v_enrollment.metadata->>'qualification_run_id' is distinct from v_installed_run_id
     or v_enrollment.authority_effect is not false then
    raise exception 'client_v1_r83_enrollment_readback_mismatch' using errcode='23514';
  end if;

  select * into v_device
    from public.compute_fabric_a2_browser_device_h205f22
   where device_id=v_device_id;
  if not found
     or v_device.client_id is distinct from v_client_id
     or v_device.active is not true
     or v_device.revoked_at is not null
     or lower(v_device.key_fingerprint_sha256) is distinct from v_fingerprint then
    raise exception 'client_v1_r83_device_readback_mismatch' using errcode='23514';
  end if;

  select * into v_command
    from public.compute_fabric_a2_browser_supervisor_command_h205f22
   where command_id=v_command_id;
  if not found
     or v_command.target_client_id is distinct from v_client_id
     or v_command.issued_by is distinct from 'CLIENT_V1_INSTALLED_ELECTRON_QUALIFIER'
     or v_command.action is distinct from 'POLL'
     or v_command.status is distinct from 'COMPLETED'
     or v_command.command_lane is distinct from 'READ_ONLY'
     or v_command.leased_by is distinct from v_client_id
     or v_command.idempotency_key is distinct from v_roundtrip->>'idempotency_key'
     or v_command.authority_effect is not false
     or jsonb_typeof(v_command.receipt) <> 'object'
     or coalesce((v_command.receipt->>'authority_effect')::boolean,true) is not false
     or lower(coalesce(v_command.receipt->'result'->'snapshot'->'rsi'->>'source_sha','')) is distinct from v_subject then
    raise exception 'client_v1_r83_command_readback_mismatch' using errcode='23514';
  end if;

  v_digest := encode(extensions.digest(convert_to(v_e::text,'utf8'),'sha256'),'hex');

  return jsonb_build_object(
    'schema','metaengine.client-v1.r83-physical-evidence-verification.v1',
    'subject_sha',v_subject,
    'evidence_sha256',v_digest,
    'durable_db_verified',true,
    'external_readback_bound',true,
    'external_readback_requires_reconciliation',true,
    'promotion_authority',false,
    'scheduler_authority',false,
    'browser_actuation_authority',false,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end;
$$;

create or replace function public.client_v1_r83_physical_evidence_seal_v1(
  p_subject_sha text,
  p_evidence jsonb,
  p_sealed_by text default 'CHATGPT_SUPERVISOR_EXTERNAL_READBACK'
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_subject text := lower(trim(coalesce(p_subject_sha,'')));
  v_by text := left(trim(coalesce(p_sealed_by,'')),160);
  v_verified jsonb;
  v_digest text;
  v_existing public.client_v1_r83_physical_evidence_seal_h205f22%rowtype;
  v_row public.client_v1_r83_physical_evidence_seal_h205f22%rowtype;
begin
  if char_length(v_by) < 3 then
    raise exception 'client_v1_r83_sealed_by_invalid' using errcode='22023';
  end if;
  v_verified := public.client_v1_r83_physical_evidence_verify_v1(v_subject,p_evidence);
  v_digest := v_verified->>'evidence_sha256';

  select * into v_existing
    from public.client_v1_r83_physical_evidence_seal_h205f22
   where subject_sha=v_subject;
  if found then
    if v_existing.evidence_sha256 is distinct from v_digest
       or v_existing.evidence is distinct from p_evidence then
      raise exception 'client_v1_r83_evidence_seal_collision' using errcode='23514';
    end if;
    v_row := v_existing;
  else
    insert into public.client_v1_r83_physical_evidence_seal_h205f22(
      subject_sha,evidence,evidence_sha256,sealed_by,
      authority_effect,promotion_authority,automatic_retry_allowed
    ) values (
      v_subject,p_evidence,v_digest,v_by,false,false,false
    ) returning * into v_row;
  end if;

  return jsonb_build_object(
    'schema','metaengine.client-v1.r83-physical-evidence-seal.v1',
    'seal_id',v_row.seal_id,
    'subject_sha',v_row.subject_sha,
    'evidence_sha256',v_row.evidence_sha256,
    'sealed_at',v_row.sealed_at,
    'sealed_by',v_row.sealed_by,
    'durable_db_verified',true,
    'external_readback_bound',true,
    'promotion_authority',false,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end;
$$;

create or replace function public.client_v1_r83_physical_evidence_readback_v1(
  p_subject_sha text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_subject text := lower(trim(coalesce(p_subject_sha,'')));
  v_row public.client_v1_r83_physical_evidence_seal_h205f22%rowtype;
  v_verified jsonb;
begin
  select * into v_row
    from public.client_v1_r83_physical_evidence_seal_h205f22
   where subject_sha=v_subject;
  if not found then
    return jsonb_build_object(
      'schema','metaengine.client-v1.r83-physical-evidence-readback.v1',
      'subject_sha',v_subject,
      'sealed',false,
      'durable_db_verified',false,
      'promotion_authority',false,
      'authority_effect',false
    );
  end if;

  v_verified := public.client_v1_r83_physical_evidence_verify_v1(v_subject,v_row.evidence);
  if v_verified->>'evidence_sha256' is distinct from v_row.evidence_sha256 then
    raise exception 'client_v1_r83_evidence_digest_mismatch' using errcode='23514';
  end if;

  return jsonb_build_object(
    'schema','metaengine.client-v1.r83-physical-evidence-readback.v1',
    'seal_id',v_row.seal_id,
    'subject_sha',v_row.subject_sha,
    'sealed',true,
    'evidence_sha256',v_row.evidence_sha256,
    'sealed_at',v_row.sealed_at,
    'sealed_by',v_row.sealed_by,
    'durable_db_verified',true,
    'external_readback_bound',true,
    'external_readback_requires_reconciliation',true,
    'promotion_authority',false,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.client_v1_r83_physical_evidence_verify_v1(text,jsonb)
  from public, anon, authenticated;
revoke all on function public.client_v1_r83_physical_evidence_seal_v1(text,jsonb,text)
  from public, anon, authenticated;
revoke all on function public.client_v1_r83_physical_evidence_readback_v1(text)
  from public, anon, authenticated;

grant execute on function public.client_v1_r83_physical_evidence_verify_v1(text,jsonb)
  to service_role;
grant execute on function public.client_v1_r83_physical_evidence_seal_v1(text,jsonb,text)
  to service_role;
grant execute on function public.client_v1_r83_physical_evidence_readback_v1(text)
  to service_role;

comment on table public.client_v1_r83_physical_evidence_seal_h205f22 is
  'Append-only Client V1 R83 physical qualification evidence. No promotion, scheduling, Browser actuation, or retry authority.';
comment on function public.client_v1_r83_physical_evidence_verify_v1(text,jsonb) is
  'Fail-closed evidence verifier. Re-reads durable enrollment/device/command facts; external GitHub/Edge observations remain independently reconcilable and confer no authority.';
comment on function public.client_v1_r83_physical_evidence_seal_v1(text,jsonb,text) is
  'Idempotently seals one exact physical evidence payload per immutable artifact subject after DB readback. Evidence existence is never promotion authority.';
comment on function public.client_v1_r83_physical_evidence_readback_v1(text) is
  'Re-verifies the stored evidence digest and current durable DB facts. Returns observation only and never promotes or retries.';
