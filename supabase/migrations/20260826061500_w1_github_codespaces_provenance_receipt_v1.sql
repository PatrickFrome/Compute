-- W1 authenticated GitHub Codespaces lifecycle provenance receipt v1
-- PREPARED / NOT APPLIED LIVE while W1 authority is expired.
-- Depends on lifecycle v2, pre-persistence manifest and Codespaces storage receipt.
-- A row records successful authenticated REST observations but remains NON-AUTHORITY
-- until persisted readback + supervisor verification.

do $$
begin
  if to_regclass('destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22') is null then
    raise exception 'w1_provenance_requires_lifecycle_v2';
  end if;
  if to_regclass('destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22') is null then
    raise exception 'w1_provenance_requires_pre_persistence_manifest';
  end if;
  if to_regclass('destruktion_meta.compute_fabric_w1_codespaces_storage_receipt_h205f22') is null then
    raise exception 'w1_provenance_requires_storage_receipt';
  end if;
  if to_regprocedure('destruktion_meta.compute_fabric_canonical_evidence_json_h205f22(jsonb)') is null then
    raise exception 'w1_provenance_requires_evidence_canonicalizer';
  end if;
end
$$;

create table destruktion_meta.compute_fabric_w1_codespaces_provenance_receipt_h205f22 (
  provenance_receipt_id uuid primary key default extensions.gen_random_uuid(),
  storage_receipt_id uuid not null unique references destruktion_meta.compute_fabric_w1_codespaces_storage_receipt_h205f22(storage_receipt_id) on update restrict on delete restrict,
  pre_persistence_manifest_id uuid not null references destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22(pre_persistence_manifest_id) on update restrict on delete restrict,
  lifecycle_receipt_id uuid not null references destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22(lifecycle_receipt_id) on update restrict on delete restrict,
  worker_id text not null references destruktion_meta.compute_fabric_worker_enrollment_h205f22(worker_id) on update cascade on delete restrict,
  claim_id bigint not null references destruktion_meta.compute_fabric_roadmap_work_claim_h205f22(claim_id) on update restrict on delete restrict,
  directive_id bigint not null references destruktion_meta.compute_fabric_supervisor_directive_h205f22(directive_id) on update restrict on delete restrict,
  base_checkpoint_id text not null,
  codespace_name text not null check (codespace_name ~ '^[A-Za-z0-9._-]{1,240}$'),
  repository_full_name text not null check (repository_full_name ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  api_version text not null check (api_version='2026-03-10'),
  provider_oracle_sha256 text not null check (provider_oracle_sha256 ~ '^[0-9a-f]{64}$'),
  pre_snapshot_sha256 text not null check (pre_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  stopped_snapshot_sha256 text not null check (stopped_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  post_snapshot_sha256 text not null check (post_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  stop_response_body_sha256 text not null check (stop_response_body_sha256 ~ '^[0-9a-f]{64}$'),
  start_response_body_sha256 text not null check (start_response_body_sha256 ~ '^[0-9a-f]{64}$'),
  receipt jsonb not null check (jsonb_typeof(receipt)='object' and octet_length(receipt::text)<=524288),
  receipt_sha256 text not null unique check (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  verification_status text not null default 'PENDING_PROVIDER_PROVENANCE_READBACK' check (verification_status='PENDING_PROVIDER_PROVENANCE_READBACK'),
  api_authentication_observed boolean not null default true check (api_authentication_observed=true),
  provider_identity_verified boolean not null default false check (provider_identity_verified=false),
  provider_action_verified boolean not null default false check (provider_action_verified=false),
  authenticated_provider_provenance_verified boolean not null default false check (authenticated_provider_provenance_verified=false),
  persisted_readback_verified boolean not null default false check (persisted_readback_verified=false),
  provider_storage_contract_verified boolean not null default false check (provider_storage_contract_verified=false),
  persistent_worker_proof boolean not null default false check (persistent_worker_proof=false),
  worker_admitted boolean not null default false check (worker_admitted=false),
  w1_verified boolean not null default false check (w1_verified=false),
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  created_at timestamptz not null default clock_timestamp(),
  unique(worker_id,lifecycle_receipt_id)
);

comment on table destruktion_meta.compute_fabric_w1_codespaces_provenance_receipt_h205f22 is
'Append-only non-authority GitHub Codespaces GET/STOP/GET-Shutdown/START/GET-Available provenance bound to persisted lifecycle/storage evidence.';

revoke all on table destruktion_meta.compute_fabric_w1_codespaces_provenance_receipt_h205f22 from public, anon, authenticated;

create or replace function destruktion_meta.compute_fabric_w1_codespaces_provenance_immutable_h205f22()
returns trigger
language plpgsql
set search_path=pg_catalog,destruktion_meta
as $$
begin
  raise exception 'w1_codespaces_provenance_receipt_is_append_only' using errcode='55000';
end
$$;
revoke all on function destruktion_meta.compute_fabric_w1_codespaces_provenance_immutable_h205f22() from public, anon, authenticated;
create trigger compute_fabric_w1_codespaces_provenance_immutable_h205f22
before update or delete on destruktion_meta.compute_fabric_w1_codespaces_provenance_receipt_h205f22
for each row execute function destruktion_meta.compute_fabric_w1_codespaces_provenance_immutable_h205f22();

create or replace function public.h205f22_w1_codespaces_provenance_ingest_v1(
  p_storage_receipt_id uuid,
  p_receipt jsonb
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,destruktion_meta,extensions
as $$
declare
  v_status jsonb;
  v_head text;
  v_storage destruktion_meta.compute_fabric_w1_codespaces_storage_receipt_h205f22%rowtype;
  v_manifest destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22%rowtype;
  v_lifecycle destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22%rowtype;
  v_claim destruktion_meta.compute_fabric_roadmap_work_claim_h205f22%rowtype;
  v_directive destruktion_meta.compute_fabric_supervisor_directive_h205f22%rowtype;
  v_evidence jsonb;
  v_oracle jsonb;
  v_oracle_evidence jsonb;
  v_obs jsonb;
  v_receipt_sha text;
  v_oracle_sha text;
  v_pre_sha text;
  v_stop_sha text;
  v_post_sha text;
  v_base_url text;
  v_row destruktion_meta.compute_fabric_w1_codespaces_provenance_receipt_h205f22%rowtype;
begin
  if p_storage_receipt_id is null or jsonb_typeof(p_receipt)<>'object' then
    raise exception 'w1_provenance_input_required' using errcode='22023';
  end if;
  if octet_length(p_receipt::text)>524288 then raise exception 'w1_provenance_receipt_too_large' using errcode='22023'; end if;

  select * into v_storage from destruktion_meta.compute_fabric_w1_codespaces_storage_receipt_h205f22
   where storage_receipt_id=p_storage_receipt_id;
  if not found then raise exception 'w1_provenance_storage_receipt_missing' using errcode='55000'; end if;
  if v_storage.verification_status<>'PENDING_STORAGE_PROVENANCE_READBACK'
     or v_storage.provider_storage_contract_verified
     or v_storage.authenticated_github_provenance_verified
     or v_storage.persisted_readback_verified
     or v_storage.persistent_worker_proof or v_storage.worker_admitted
     or v_storage.w1_verified or v_storage.canonical or v_storage.authority_effect then
    raise exception 'w1_provenance_storage_state_invalid' using errcode='55000';
  end if;

  select * into v_manifest from destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22
   where pre_persistence_manifest_id=v_storage.pre_persistence_manifest_id
     and lifecycle_receipt_id=v_storage.lifecycle_receipt_id
     and worker_id=v_storage.worker_id;
  if not found then raise exception 'w1_provenance_manifest_bridge_missing' using errcode='55000'; end if;

  select * into v_lifecycle from destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22
   where lifecycle_receipt_id=v_storage.lifecycle_receipt_id and worker_id=v_storage.worker_id;
  if not found or v_lifecycle.provider_kind<>'GITHUB_CODESPACES' then
    raise exception 'w1_provenance_lifecycle_bridge_invalid' using errcode='55000';
  end if;

  -- Repeat fresh authority at the actual provenance persistence boundary.
  v_status:=destruktion_meta.compute_fabric_roadmap_status_h205f22();
  if not coalesce((v_status->>'definition_integrity')::boolean,false) then raise exception 'w1_provenance_roadmap_integrity_failed' using errcode='55000'; end if;
  v_head:=v_status#>>'{semantic_head,checkpoint_id}';
  if v_head is null or v_head is distinct from v_storage.base_checkpoint_id or v_head is distinct from v_manifest.base_checkpoint_id then
    raise exception 'w1_provenance_semantic_head_mismatch' using errcode='55000';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_status->'milestones') m where m->>'milestone_key'='W1_PERSISTENT_LINUX_WORKER_SAFETY' and m->>'effective_status'='IN_PROGRESS') then
    raise exception 'w1_provenance_w1_not_in_progress' using errcode='55000';
  end if;
  select * into v_claim from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22
   where claim_id=v_storage.claim_id and claim_id=v_manifest.claim_id
     and roadmap_id='compute-fabric-roadmap-v1' and milestone_key='W1_PERSISTENT_LINUX_WORKER_SAFETY'
     and holder_id='aop1:W1_IMPLEMENTER' and state='ACTIVE' and expires_at>clock_timestamp() and base_checkpoint_id=v_head;
  if not found then raise exception 'w1_provenance_fresh_claim_required' using errcode='55000'; end if;
  select * into v_directive from destruktion_meta.compute_fabric_supervisor_directive_h205f22
   where directive_id=v_storage.directive_id and directive_id=v_manifest.directive_id
     and roadmap_id='compute-fabric-roadmap-v1' and milestone_key='W1_PERSISTENT_LINUX_WORKER_SAFETY'
     and status='ACTIVE' and (expires_at is null or expires_at>clock_timestamp())
     and directive_kind in ('OPEN','CONTINUE','REASSIGN')
     and (target_holder_id is null or target_holder_id='aop1:W1_IMPLEMENTER') and base_checkpoint_id=v_head;
  if not found then raise exception 'w1_provenance_fresh_directive_required' using errcode='55000'; end if;

  if p_receipt->>'schema'<>'metaengine.compute.w1-github-codespaces-lifecycle-provenance.h205f22.v1'
     or p_receipt->>'mode'<>'EXECUTE' or p_receipt->>'outcome'<>'CAPTURED_NONAUTHORITY'
     or not coalesce((p_receipt->>'api_authentication_observed')::boolean,false)
     or coalesce((p_receipt->>'provider_identity_verified')::boolean,true)
     or coalesce((p_receipt->>'provider_action_verified')::boolean,true)
     or coalesce((p_receipt->>'authenticated_provider_provenance_verified')::boolean,true)
     or coalesce((p_receipt->>'persisted_readback_verified')::boolean,true)
     or coalesce((p_receipt->>'persistent_worker_proof')::boolean,true)
     or coalesce((p_receipt->>'worker_admitted')::boolean,true)
     or coalesce((p_receipt->>'w1_verified')::boolean,true)
     or coalesce((p_receipt->>'canonical')::boolean,true)
     or coalesce((p_receipt->>'authority_effect')::boolean,true)
     or not coalesce((p_receipt->>'requires_supabase_persisted_readback')::boolean,false)
     or not coalesce((p_receipt->>'requires_supervisor_verification')::boolean,false) then
    raise exception 'w1_provenance_receipt_shape_invalid' using errcode='22023';
  end if;

  v_evidence:=p_receipt->'evidence';
  if jsonb_typeof(v_evidence)<>'object'
     or v_evidence->>'api_base'<>'https://api.github.com'
     or v_evidence->>'api_version'<>'2026-03-10'
     or v_evidence->>'accept'<>'application/vnd.github+json'
     or v_evidence->>'codespace_name' is distinct from v_lifecycle.provider_object_id
     or v_evidence->>'repository_full_name' is distinct from v_lifecycle.pre_provider_snapshot#>>'{repository,full_name}'
     or v_evidence->>'transport'<>'HTTPS_DEFAULT_CA_HOSTNAME_VALIDATION'
     or coalesce((v_evidence->>'token_material_persisted')::boolean,true) then
    raise exception 'w1_provenance_evidence_identity_invalid' using errcode='22023';
  end if;
  v_receipt_sha:=encode(extensions.digest(convert_to(destruktion_meta.compute_fabric_canonical_evidence_json_h205f22(v_evidence),'UTF8'),'sha256'),'hex');
  if p_receipt->>'receipt_sha256' is distinct from v_receipt_sha then raise exception 'w1_provenance_receipt_hash_mismatch' using errcode='22023'; end if;

  v_oracle:=v_evidence->'provider_oracle';
  v_oracle_evidence:=v_oracle->'evidence';
  if v_oracle->>'schema'<>'metaengine.compute.w1-github-codespaces-snapshot-oracle.h205f22.v1'
     or v_oracle->>'outcome'<>'CODESPACES_SNAPSHOTS_STRUCTURALLY_ELIGIBLE_NONAUTHORITY'
     or jsonb_typeof(v_oracle_evidence)<>'object' then
    raise exception 'w1_provenance_provider_oracle_invalid' using errcode='22023';
  end if;
  v_oracle_sha:=encode(extensions.digest(convert_to(destruktion_meta.compute_fabric_canonical_evidence_json_h205f22(v_oracle_evidence),'UTF8'),'sha256'),'hex');
  if v_oracle->>'oracle_sha256' is distinct from v_oracle_sha
     or v_evidence->>'provider_oracle_sha256' is distinct from v_oracle_sha
     or v_oracle_sha is distinct from v_storage.receipt#>>'{evidence,provider_oracle_sha256}' then
    raise exception 'w1_provenance_provider_oracle_hash_mismatch' using errcode='22023';
  end if;

  v_pre_sha:=v_oracle_evidence->>'pre_snapshot_sha256';
  v_stop_sha:=v_oracle_evidence->>'stopped_snapshot_sha256';
  v_post_sha:=v_oracle_evidence->>'post_snapshot_sha256';
  if v_pre_sha is distinct from v_lifecycle.pre_provider_snapshot_sha256
     or v_stop_sha is distinct from v_lifecycle.stopped_provider_snapshot_sha256
     or v_post_sha is distinct from v_lifecycle.post_provider_snapshot_sha256
     or v_stop_sha is distinct from v_storage.stopped_snapshot_sha256
     or v_evidence->>'pre_snapshot_sha256' is distinct from v_pre_sha
     or v_evidence->>'stopped_snapshot_sha256' is distinct from v_stop_sha
     or v_evidence->>'post_snapshot_sha256' is distinct from v_post_sha then
    raise exception 'w1_provenance_snapshot_bridge_mismatch' using errcode='22023';
  end if;

  if jsonb_typeof(v_evidence->'checks')<>'object'
     or exists (select 1 from jsonb_each(v_evidence->'checks') where value<>'true'::jsonb) then
    raise exception 'w1_provenance_checks_failed' using errcode='22023';
  end if;

  v_base_url:='https://api.github.com/user/codespaces/'||v_lifecycle.provider_object_id;
  foreach v_obs in array array[
    v_evidence#>'{observations,pre_get}',v_evidence#>'{observations,stop_post}',v_evidence#>'{observations,stopped_get}',
    v_evidence#>'{observations,start_post}',v_evidence#>'{observations,post_get}'
  ] loop
    if jsonb_typeof(v_obs)<>'object' or (v_obs->>'http_status')::int<>200 then
      raise exception 'w1_provenance_observation_http_invalid' using errcode='22023';
    end if;
    if (v_obs->>'response_body_sha256') !~ '^[0-9a-f]{64}$'
       or (v_obs->>'selected_snapshot_sha256') !~ '^[0-9a-f]{64}$' then
      raise exception 'w1_provenance_observation_hash_invalid' using errcode='22023';
    end if;
  end loop;
  if v_evidence#>>'{observations,pre_get,method}'<>'GET' or v_evidence#>>'{observations,pre_get,url}'<>v_base_url
     or v_evidence#>>'{observations,stopped_get,method}'<>'GET' or v_evidence#>>'{observations,stopped_get,url}'<>v_base_url
     or v_evidence#>>'{observations,post_get,method}'<>'GET' or v_evidence#>>'{observations,post_get,url}'<>v_base_url
     or v_evidence#>>'{observations,stop_post,method}'<>'POST' or v_evidence#>>'{observations,stop_post,url}'<>v_base_url||'/stop'
     or v_evidence#>>'{observations,start_post,method}'<>'POST' or v_evidence#>>'{observations,start_post,url}'<>v_base_url||'/start' then
    raise exception 'w1_provenance_observation_endpoint_invalid' using errcode='22023';
  end if;
  if v_evidence#>>'{observations,pre_get,selected_snapshot_sha256}' is distinct from v_pre_sha
     or v_evidence#>>'{observations,stopped_get,selected_snapshot_sha256}' is distinct from v_stop_sha
     or v_evidence#>>'{observations,post_get,selected_snapshot_sha256}' is distinct from v_post_sha then
    raise exception 'w1_provenance_get_snapshot_hash_mismatch' using errcode='22023';
  end if;

  insert into destruktion_meta.compute_fabric_w1_codespaces_provenance_receipt_h205f22(
    storage_receipt_id,pre_persistence_manifest_id,lifecycle_receipt_id,worker_id,claim_id,directive_id,base_checkpoint_id,
    codespace_name,repository_full_name,api_version,provider_oracle_sha256,pre_snapshot_sha256,stopped_snapshot_sha256,
    post_snapshot_sha256,stop_response_body_sha256,start_response_body_sha256,receipt,receipt_sha256
  ) values (
    v_storage.storage_receipt_id,v_storage.pre_persistence_manifest_id,v_storage.lifecycle_receipt_id,v_storage.worker_id,
    v_storage.claim_id,v_storage.directive_id,v_storage.base_checkpoint_id,v_lifecycle.provider_object_id,
    v_lifecycle.pre_provider_snapshot#>>'{repository,full_name}','2026-03-10',v_oracle_sha,v_pre_sha,v_stop_sha,v_post_sha,
    v_evidence#>>'{observations,stop_post,response_body_sha256}',v_evidence#>>'{observations,start_post,response_body_sha256}',p_receipt,v_receipt_sha
  ) returning * into v_row;

  return jsonb_build_object(
    'schema','metaengine.compute.w1-github-codespaces-provenance-ingest.h205f22.v1',
    'provenance_receipt_id',v_row.provenance_receipt_id,
    'storage_receipt_id',v_row.storage_receipt_id,
    'pre_persistence_manifest_id',v_row.pre_persistence_manifest_id,
    'lifecycle_receipt_id',v_row.lifecycle_receipt_id,
    'worker_id',v_row.worker_id,
    'claim_id',v_row.claim_id,
    'directive_id',v_row.directive_id,
    'base_checkpoint_id',v_row.base_checkpoint_id,
    'receipt_sha256',v_row.receipt_sha256,
    'verification_status','PENDING_PROVIDER_PROVENANCE_READBACK',
    'api_authentication_observed',true,
    'provider_identity_verified',false,
    'provider_action_verified',false,
    'authenticated_provider_provenance_verified',false,
    'persisted_readback_verified',false,
    'persistent_worker_proof',false,'worker_admitted',false,'w1_verified',false,'canonical',false,'authority_effect',false,
    'requires_persisted_readback_recomposition',true,
    'requires_supervisor_verification',true
  );
end
$$;
revoke all on function public.h205f22_w1_codespaces_provenance_ingest_v1(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.h205f22_w1_codespaces_provenance_ingest_v1(uuid,jsonb) to service_role;

create or replace function public.h205f22_w1_codespaces_provenance_readback_v1(p_provenance_receipt_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path=pg_catalog,destruktion_meta,extensions
as $$
declare
  v destruktion_meta.compute_fabric_w1_codespaces_provenance_receipt_h205f22%rowtype;
  v_sha text;
  v_oracle_sha text;
  v_match boolean;
begin
  select * into v from destruktion_meta.compute_fabric_w1_codespaces_provenance_receipt_h205f22
   where provenance_receipt_id=p_provenance_receipt_id;
  if not found then raise exception 'w1_provenance_receipt_not_found' using errcode='22023'; end if;
  v_sha:=encode(extensions.digest(convert_to(destruktion_meta.compute_fabric_canonical_evidence_json_h205f22(v.receipt->'evidence'),'UTF8'),'sha256'),'hex');
  v_oracle_sha:=encode(extensions.digest(convert_to(destruktion_meta.compute_fabric_canonical_evidence_json_h205f22(v.receipt#>'{evidence,provider_oracle,evidence}'),'UTF8'),'sha256'),'hex');
  v_match:=v_sha=v.receipt_sha256
    and v.receipt->>'receipt_sha256'=v.receipt_sha256
    and v_oracle_sha=v.provider_oracle_sha256
    and v.receipt#>>'{evidence,pre_snapshot_sha256}'=v.pre_snapshot_sha256
    and v.receipt#>>'{evidence,stopped_snapshot_sha256}'=v.stopped_snapshot_sha256
    and v.receipt#>>'{evidence,post_snapshot_sha256}'=v.post_snapshot_sha256
    and v.receipt#>>'{evidence,observations,stop_post,response_body_sha256}'=v.stop_response_body_sha256
    and v.receipt#>>'{evidence,observations,start_post,response_body_sha256}'=v.start_response_body_sha256;
  return jsonb_build_object(
    'schema','metaengine.compute.w1-github-codespaces-provenance-readback.h205f22.v1',
    'provenance_receipt_id',v.provenance_receipt_id,'storage_receipt_id',v.storage_receipt_id,
    'pre_persistence_manifest_id',v.pre_persistence_manifest_id,'lifecycle_receipt_id',v.lifecycle_receipt_id,
    'worker_id',v.worker_id,'base_checkpoint_id',v.base_checkpoint_id,'receipt_sha256',v.receipt_sha256,
    'recomputed_receipt_sha256',v_sha,'recomputed_provider_oracle_sha256',v_oracle_sha,
    'persisted_readback_match',v_match,'verification_status','PENDING_PROVIDER_PROVENANCE_READBACK',
    'api_authentication_observed',true,
    'provider_identity_verified',false,'provider_action_verified',false,
    'authenticated_provider_provenance_verified',false,'persisted_readback_verified',false,
    'provider_storage_contract_verified',false,'persistent_worker_proof',false,
    'worker_admitted',false,'w1_verified',false,'canonical',false,'authority_effect',false,
    'requires_supervisor_verification',true
  );
end
$$;
revoke all on function public.h205f22_w1_codespaces_provenance_readback_v1(uuid) from public, anon, authenticated;
grant execute on function public.h205f22_w1_codespaces_provenance_readback_v1(uuid) to service_role;
