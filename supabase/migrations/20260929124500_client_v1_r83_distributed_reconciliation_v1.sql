-- Client V1 C3 distributed reconciliation.
-- Compares independently observed GitHub + Edge state against the immutable R83
-- physical evidence seal, while re-verifying durable DB facts. It reports drift;
-- it never promotes, schedules, leases, actuates Browser effects, or retries them.

create table if not exists public.client_v1_r83_reconciliation_receipt_h205f22 (
  receipt_id uuid primary key default gen_random_uuid(),
  subject_sha text not null check (subject_sha ~ '^[0-9a-f]{40}$'),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  observation_sha256 text not null check (observation_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('VERIFIED','DRIFTED')),
  drift jsonb not null default '[]'::jsonb check (jsonb_typeof(drift)='array'),
  observation jsonb not null check (jsonb_typeof(observation)='object'),
  recorded_by text not null check (char_length(recorded_by) between 3 and 160),
  recorded_at timestamptz not null default clock_timestamp(),
  authority_effect boolean not null default false check (authority_effect=false),
  promotion_authority boolean not null default false check (promotion_authority=false),
  scheduler_authority boolean not null default false check (scheduler_authority=false),
  automatic_retry_allowed boolean not null default false check (automatic_retry_allowed=false),
  unique(subject_sha,observation_sha256)
);

alter table public.client_v1_r83_reconciliation_receipt_h205f22 enable row level security;
revoke all on table public.client_v1_r83_reconciliation_receipt_h205f22
  from public, anon, authenticated, service_role;

create or replace function public.client_v1_r83_external_reconcile_v1(
  p_subject_sha text,
  p_observation jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_subject text := lower(trim(coalesce(p_subject_sha,'')));
  v_o jsonb := coalesce(p_observation,'{}'::jsonb);
  v_seal public.client_v1_r83_physical_evidence_seal_h205f22%rowtype;
  v_e jsonb;
  v_db jsonb;
  v_drift jsonb := '[]'::jsonb;
  v_obs_sha text;
  v_state text;
begin
  if v_subject !~ '^[0-9a-f]{40}$' then
    raise exception 'client_v1_r83_reconcile_subject_invalid' using errcode='22023';
  end if;

  select * into v_seal
    from public.client_v1_r83_physical_evidence_seal_h205f22
   where subject_sha=v_subject;
  if not found then
    return jsonb_build_object(
      'schema','metaengine.client-v1.r83-distributed-reconciliation.v1',
      'subject_sha',v_subject,
      'state','UNSEALED',
      'drift',jsonb_build_array('DB_EVIDENCE_SEAL_MISSING'),
      'promotion_authority',false,
      'scheduler_authority',false,
      'browser_actuation_authority',false,
      'automatic_retry_allowed',false,
      'authority_effect',false
    );
  end if;

  v_db := public.client_v1_r83_physical_evidence_readback_v1(v_subject);
  if coalesce((v_db->>'sealed')::boolean,false) is not true
     or coalesce((v_db->>'durable_db_verified')::boolean,false) is not true
     or v_db->>'evidence_sha256' is distinct from v_seal.evidence_sha256 then
    return jsonb_build_object(
      'schema','metaengine.client-v1.r83-distributed-reconciliation.v1',
      'subject_sha',v_subject,
      'state','DB_DRIFTED',
      'drift',jsonb_build_array('DB_DURABLE_READBACK_MISMATCH'),
      'evidence_sha256',v_seal.evidence_sha256,
      'promotion_authority',false,
      'scheduler_authority',false,
      'browser_actuation_authority',false,
      'automatic_retry_allowed',false,
      'authority_effect',false
    );
  end if;

  if jsonb_typeof(v_o) <> 'object'
     or v_o->>'schema' is distinct from 'metaengine.client-v1.r83-external-observation.v1'
     or lower(coalesce(v_o->>'subject_sha','')) is distinct from v_subject
     or coalesce((v_o->>'authority_effect')::boolean,true) is not false
     or jsonb_typeof(v_o->'github') <> 'object'
     or jsonb_typeof(v_o->'edge') <> 'object'
     or jsonb_typeof(v_o->'rollback_restore') <> 'object' then
    raise exception 'client_v1_r83_external_observation_invalid' using errcode='22023';
  end if;

  v_e := v_seal.evidence;

  -- GitHub exact-run reconciliation.
  if lower(coalesce(v_o->'github'->'package_smoke'->>'head_sha','')) is distinct from v_subject
     or v_o->'github'->'package_smoke'->>'run_id' is distinct from v_e->'installer'->>'producer_run_id'
     or v_o->'github'->'package_smoke'->>'run_attempt' is distinct from v_e->'installer'->>'producer_run_attempt'
     or upper(coalesce(v_o->'github'->'package_smoke'->>'conclusion','')) is distinct from 'SUCCESS' then
    v_drift := v_drift || jsonb_build_array('GITHUB_PACKAGE_SMOKE');
  end if;

  if lower(coalesce(v_o->'github'->'installed_electron'->>'head_sha','')) is distinct from v_subject
     or v_o->'github'->'installed_electron'->>'run_id' is distinct from v_e->'installed_electron'->>'workflow_run_id'
     or v_o->'github'->'installed_electron'->>'run_attempt' is distinct from v_e->'installed_electron'->>'run_attempt'
     or upper(coalesce(v_o->'github'->'installed_electron'->>'conclusion','')) is distinct from 'SUCCESS' then
    v_drift := v_drift || jsonb_build_array('GITHUB_INSTALLED_ELECTRON');
  end if;

  if lower(coalesce(v_o->'github'->'edge_probe'->>'head_sha','')) is distinct from v_subject
     or v_o->'github'->'edge_probe'->>'run_id' is distinct from v_e->'health_probe'->>'run_id'
     or v_o->'github'->'edge_probe'->>'run_attempt' is distinct from v_e->'health_probe'->>'run_attempt'
     or upper(coalesce(v_o->'github'->'edge_probe'->>'conclusion','')) is distinct from 'SUCCESS' then
    v_drift := v_drift || jsonb_build_array('GITHUB_EDGE_PROBE');
  end if;

  -- Current Edge management/readback reconciliation.
  if v_o->'edge'->'stable'->>'slug' is distinct from v_e->'edge'->'stable'->>'slug'
     or v_o->'edge'->'stable'->>'version' is distinct from v_e->'edge'->'stable'->>'version'
     or lower(coalesce(v_o->'edge'->'stable'->>'digest','')) is distinct from v_e->'edge'->'stable'->>'digest'
     or lower(coalesce(v_o->'edge'->'stable'->>'source_head','')) is distinct from v_subject
     or coalesce((v_o->'edge'->'stable'->>'health_ok')::boolean,false) is not true then
    v_drift := v_drift || jsonb_build_array('EDGE_STABLE');
  end if;

  if v_o->'edge'->'canary'->>'slug' is distinct from v_e->'edge'->'canary'->>'slug'
     or v_o->'edge'->'canary'->>'version' is distinct from v_e->'edge'->'canary'->>'version'
     or lower(coalesce(v_o->'edge'->'canary'->>'digest','')) is distinct from v_e->'edge'->'canary'->>'digest'
     or lower(coalesce(v_o->'edge'->'canary'->>'source_head','')) is distinct from v_subject
     or coalesce((v_o->'edge'->'canary'->>'health_ok')::boolean,false) is not true then
    v_drift := v_drift || jsonb_build_array('EDGE_CANARY');
  end if;

  if lower(coalesce(v_o->'edge'->'stable'->>'digest','')) is distinct from lower(coalesce(v_o->'edge'->'canary'->>'digest','')) then
    v_drift := v_drift || jsonb_build_array('EDGE_STABLE_CANARY_DIGEST_DIVERGENCE');
  end if;

  -- Historical rollback/restore attestation reconciliation.
  if v_o->'rollback_restore'->>'rollback_canary_version' is distinct from v_e->'rollback_restore'->>'rollback_canary_version'
     or lower(coalesce(v_o->'rollback_restore'->>'rollback_source_pin','')) is distinct from v_e->'rollback_restore'->>'rollback_source_pin'
     or lower(coalesce(v_o->'rollback_restore'->>'rollback_digest','')) is distinct from v_e->'rollback_restore'->>'rollback_digest'
     or v_o->'rollback_restore'->>'restore_canary_version' is distinct from v_e->'rollback_restore'->>'restore_canary_version'
     or lower(coalesce(v_o->'rollback_restore'->>'restore_source_pin','')) is distinct from v_subject
     or lower(coalesce(v_o->'rollback_restore'->>'restore_digest','')) is distinct from v_e->'rollback_restore'->>'restore_digest'
     or coalesce((v_o->'rollback_restore'->>'health_success')::boolean,false) is not true then
    v_drift := v_drift || jsonb_build_array('EDGE_ROLLBACK_RESTORE');
  end if;

  v_obs_sha := encode(extensions.digest(convert_to(v_o::text,'utf8'),'sha256'),'hex');
  v_state := case when jsonb_array_length(v_drift)=0 then 'VERIFIED' else 'DRIFTED' end;

  return jsonb_build_object(
    'schema','metaengine.client-v1.r83-distributed-reconciliation.v1',
    'subject_sha',v_subject,
    'state',v_state,
    'drift',v_drift,
    'evidence_sha256',v_seal.evidence_sha256,
    'observation_sha256',v_obs_sha,
    'durable_db_verified',true,
    'github_bound',true,
    'edge_bound',true,
    'promotion_authority',false,
    'scheduler_authority',false,
    'browser_actuation_authority',false,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end;
$$;

create or replace function public.client_v1_r83_external_reconciliation_record_v1(
  p_subject_sha text,
  p_observation jsonb,
  p_recorded_by text default 'CHATGPT_SUPERVISOR_EXTERNAL_RECONCILER'
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_subject text := lower(trim(coalesce(p_subject_sha,'')));
  v_by text := left(trim(coalesce(p_recorded_by,'')),160);
  v_result jsonb;
  v_state text;
  v_evidence_sha text;
  v_observation_sha text;
  v_row public.client_v1_r83_reconciliation_receipt_h205f22%rowtype;
begin
  if char_length(v_by)<3 then
    raise exception 'client_v1_r83_reconciliation_recorded_by_invalid' using errcode='22023';
  end if;

  v_result := public.client_v1_r83_external_reconcile_v1(v_subject,p_observation);
  v_state := v_result->>'state';
  if v_state not in ('VERIFIED','DRIFTED') then
    return v_result;
  end if;

  v_evidence_sha := v_result->>'evidence_sha256';
  v_observation_sha := v_result->>'observation_sha256';

  insert into public.client_v1_r83_reconciliation_receipt_h205f22(
    subject_sha,evidence_sha256,observation_sha256,state,drift,observation,recorded_by,
    authority_effect,promotion_authority,scheduler_authority,automatic_retry_allowed
  ) values (
    v_subject,v_evidence_sha,v_observation_sha,v_state,
    coalesce(v_result->'drift','[]'::jsonb),p_observation,v_by,
    false,false,false,false
  )
  on conflict(subject_sha,observation_sha256) do nothing;

  select * into v_row
    from public.client_v1_r83_reconciliation_receipt_h205f22
   where subject_sha=v_subject and observation_sha256=v_observation_sha;

  return jsonb_build_object(
    'schema','metaengine.client-v1.r83-reconciliation-receipt.v1',
    'receipt_id',v_row.receipt_id,
    'subject_sha',v_row.subject_sha,
    'state',v_row.state,
    'drift',v_row.drift,
    'evidence_sha256',v_row.evidence_sha256,
    'observation_sha256',v_row.observation_sha256,
    'recorded_at',v_row.recorded_at,
    'recorded_by',v_row.recorded_by,
    'promotion_authority',false,
    'scheduler_authority',false,
    'browser_actuation_authority',false,
    'automatic_retry_allowed',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.client_v1_r83_external_reconcile_v1(text,jsonb)
  from public, anon, authenticated;
revoke all on function public.client_v1_r83_external_reconciliation_record_v1(text,jsonb,text)
  from public, anon, authenticated;

grant execute on function public.client_v1_r83_external_reconcile_v1(text,jsonb)
  to service_role;
grant execute on function public.client_v1_r83_external_reconciliation_record_v1(text,jsonb,text)
  to service_role;

comment on table public.client_v1_r83_reconciliation_receipt_h205f22 is
  'Append-only GitHub/Edge/DB reconciliation receipts. A VERIFIED row is evidence only and never grants release promotion or Browser execution authority.';
comment on function public.client_v1_r83_external_reconcile_v1(text,jsonb) is
  'Read-only distributed reconciliation of sealed DB evidence against externally observed GitHub and Edge state. Reports VERIFIED/DRIFTED only.';
comment on function public.client_v1_r83_external_reconciliation_record_v1(text,jsonb,text) is
  'Idempotently records one reconciliation observation digest. Receipt existence never grants promotion, scheduling, Browser actuation, or automatic retry authority.';
