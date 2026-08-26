-- W1 GitHub Codespaces persistent-storage receipt v1
-- PREPARED / NOT APPLIED LIVE while W1 authority is expired.
-- Depends on lifecycle receipt v2 + stopped-snapshot guard + pre-persistence manifest.
--
-- This stores a hash-bound proof that the lifecycle sentinel was the fixed file
-- /workspaces/.metaengine-w1/persistent-sentinel.bin, cross-bound to the same
-- lifecycle boot IDs, provider oracle and persisted Shutdown snapshot.
-- A successful row is still NON-AUTHORITY.

do $$
begin
  if to_regclass('destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22') is null then
    raise exception 'w1_storage_receipt_requires_lifecycle_v2';
  end if;
  if to_regclass('destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22') is null then
    raise exception 'w1_storage_receipt_requires_pre_persistence_manifest';
  end if;
  if to_regprocedure('destruktion_meta.compute_fabric_canonical_evidence_json_h205f22(jsonb)') is null then
    raise exception 'w1_storage_receipt_requires_evidence_canonicalizer';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='destruktion_meta'
      and table_name='compute_fabric_worker_lifecycle_receipt_v2_h205f22'
      and column_name='stopped_provider_snapshot_sha256'
  ) then
    raise exception 'w1_storage_receipt_requires_raw_stopped_snapshot';
  end if;
end
$$;

create table destruktion_meta.compute_fabric_w1_codespaces_storage_receipt_h205f22 (
  storage_receipt_id uuid primary key default extensions.gen_random_uuid(),
  pre_persistence_manifest_id uuid not null references destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22(pre_persistence_manifest_id) on update restrict on delete restrict,
  lifecycle_receipt_id uuid not null references destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22(lifecycle_receipt_id) on update restrict on delete restrict,
  worker_id text not null references destruktion_meta.compute_fabric_worker_enrollment_h205f22(worker_id) on update cascade on delete restrict,
  claim_id bigint not null references destruktion_meta.compute_fabric_roadmap_work_claim_h205f22(claim_id) on update restrict on delete restrict,
  directive_id bigint not null references destruktion_meta.compute_fabric_supervisor_directive_h205f22(directive_id) on update restrict on delete restrict,
  base_checkpoint_id text not null,
  provider_object_id text not null check (provider_object_id ~ '^[A-Za-z0-9._-]{1,240}$'),
  source_git_sha text not null check (source_git_sha ~ '^[0-9a-f]{40}$'),
  source_tree_sha text not null check (source_tree_sha ~ '^[0-9a-f]{40}$'),
  persistent_root text not null check (persistent_root='/workspaces'),
  sentinel_path text not null check (sentinel_path='/workspaces/.metaengine-w1/persistent-sentinel.bin'),
  sentinel_path_sha256 text not null check (sentinel_path_sha256 ~ '^[0-9a-f]{64}$'),
  sentinel_sha256 text not null check (sentinel_sha256 ~ '^[0-9a-f]{64}$'),
  pre_boot_id text not null check (pre_boot_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  post_boot_id text not null check (post_boot_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  provider_oracle_sha256 text not null check (provider_oracle_sha256 ~ '^[0-9a-f]{64}$'),
  stopped_snapshot_sha256 text not null check (stopped_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  receipt jsonb not null check (jsonb_typeof(receipt)='object' and octet_length(receipt::text) <= 262144),
  receipt_sha256 text not null unique check (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  verification_status text not null default 'PENDING_STORAGE_PROVENANCE_READBACK' check (verification_status='PENDING_STORAGE_PROVENANCE_READBACK'),
  provider_storage_contract_verified boolean not null default false check (provider_storage_contract_verified=false),
  authenticated_github_provenance_verified boolean not null default false check (authenticated_github_provenance_verified=false),
  persisted_readback_verified boolean not null default false check (persisted_readback_verified=false),
  persistent_worker_proof boolean not null default false check (persistent_worker_proof=false),
  worker_admitted boolean not null default false check (worker_admitted=false),
  w1_verified boolean not null default false check (w1_verified=false),
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  created_at timestamptz not null default clock_timestamp(),
  unique(pre_persistence_manifest_id),
  unique(worker_id,lifecycle_receipt_id),
  constraint compute_fabric_w1_codespaces_storage_boot_change_h205f22 check (pre_boot_id<>post_boot_id)
);

comment on table destruktion_meta.compute_fabric_w1_codespaces_storage_receipt_h205f22 is
'Append-only non-authority proof that the W1 lifecycle sentinel is the fixed GitHub Codespaces /workspaces persistent file and is cross-bound to the same lifecycle/provider evidence.';

revoke all on table destruktion_meta.compute_fabric_w1_codespaces_storage_receipt_h205f22 from public, anon, authenticated;

create or replace function destruktion_meta.compute_fabric_w1_codespaces_storage_receipt_immutable_h205f22()
returns trigger
language plpgsql
set search_path = pg_catalog, destruktion_meta
as $$
begin
  raise exception 'w1_codespaces_storage_receipt_is_append_only' using errcode='55000';
end
$$;

revoke all on function destruktion_meta.compute_fabric_w1_codespaces_storage_receipt_immutable_h205f22() from public, anon, authenticated;

create trigger compute_fabric_w1_codespaces_storage_receipt_immutable_h205f22
before update or delete on destruktion_meta.compute_fabric_w1_codespaces_storage_receipt_h205f22
for each row execute function destruktion_meta.compute_fabric_w1_codespaces_storage_receipt_immutable_h205f22();

create or replace function public.h205f22_w1_codespaces_storage_receipt_ingest_v1(
  p_pre_persistence_manifest_id uuid,
  p_receipt jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, destruktion_meta, extensions
as $$
declare
  v_status jsonb;
  v_head text;
  v_manifest destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22%rowtype;
  v_lifecycle destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22%rowtype;
  v_claim destruktion_meta.compute_fabric_roadmap_work_claim_h205f22%rowtype;
  v_directive destruktion_meta.compute_fabric_supervisor_directive_h205f22%rowtype;
  v_evidence jsonb;
  v_checks jsonb;
  v_receipt_sha text;
  v_path_sha text;
  v_row destruktion_meta.compute_fabric_w1_codespaces_storage_receipt_h205f22%rowtype;
  v_expected_path constant text := '/workspaces/.metaengine-w1/persistent-sentinel.bin';
begin
  if p_pre_persistence_manifest_id is null or jsonb_typeof(p_receipt)<>'object' then
    raise exception 'w1_storage_receipt_input_required' using errcode='22023';
  end if;
  if octet_length(p_receipt::text)>262144 then
    raise exception 'w1_storage_receipt_too_large' using errcode='22023';
  end if;

  select * into v_manifest
  from destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22
  where pre_persistence_manifest_id=p_pre_persistence_manifest_id;
  if not found then raise exception 'w1_storage_receipt_manifest_missing' using errcode='55000'; end if;
  if v_manifest.verification_status<>'PENDING_PERSISTED_READBACK'
     or v_manifest.authenticated_provenance_verified
     or v_manifest.persisted_readback_verified
     or v_manifest.persistent_worker_proof
     or v_manifest.worker_admitted
     or v_manifest.w1_verified
     or v_manifest.canonical
     or v_manifest.authority_effect then
    raise exception 'w1_storage_receipt_manifest_state_invalid' using errcode='55000';
  end if;

  -- Repeat the authority gate: a stale manifest cannot be extended after lease expiry.
  v_status := destruktion_meta.compute_fabric_roadmap_status_h205f22();
  if not coalesce((v_status->>'definition_integrity')::boolean,false) then
    raise exception 'w1_storage_receipt_roadmap_integrity_failed' using errcode='55000';
  end if;
  v_head := v_status#>>'{semantic_head,checkpoint_id}';
  if v_head is null or v_head is distinct from v_manifest.base_checkpoint_id then
    raise exception 'w1_storage_receipt_semantic_head_mismatch' using errcode='55000';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_status->'milestones') m
    where m->>'milestone_key'='W1_PERSISTENT_LINUX_WORKER_SAFETY'
      and m->>'effective_status'='IN_PROGRESS'
  ) then
    raise exception 'w1_storage_receipt_w1_not_in_progress' using errcode='55000';
  end if;

  select * into v_claim
  from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22
  where claim_id=v_manifest.claim_id
    and roadmap_id='compute-fabric-roadmap-v1'
    and milestone_key='W1_PERSISTENT_LINUX_WORKER_SAFETY'
    and holder_id='aop1:W1_IMPLEMENTER'
    and state='ACTIVE'
    and expires_at>clock_timestamp()
    and base_checkpoint_id=v_head;
  if not found then raise exception 'w1_storage_receipt_fresh_claim_required' using errcode='55000'; end if;

  select * into v_directive
  from destruktion_meta.compute_fabric_supervisor_directive_h205f22
  where directive_id=v_manifest.directive_id
    and roadmap_id='compute-fabric-roadmap-v1'
    and milestone_key='W1_PERSISTENT_LINUX_WORKER_SAFETY'
    and status='ACTIVE'
    and (expires_at is null or expires_at>clock_timestamp())
    and directive_kind in ('OPEN','CONTINUE','REASSIGN')
    and (target_holder_id is null or target_holder_id='aop1:W1_IMPLEMENTER')
    and base_checkpoint_id=v_head;
  if not found then raise exception 'w1_storage_receipt_fresh_directive_required' using errcode='55000'; end if;

  select * into v_lifecycle
  from destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22
  where lifecycle_receipt_id=v_manifest.lifecycle_receipt_id
    and worker_id=v_manifest.worker_id;
  if not found then raise exception 'w1_storage_receipt_lifecycle_missing' using errcode='55000'; end if;
  if v_lifecycle.provider_kind<>'GITHUB_CODESPACES'
     or v_lifecycle.provider_object_id is null
     or v_lifecycle.stopped_provider_snapshot_sha256 is null then
    raise exception 'w1_storage_receipt_lifecycle_state_invalid' using errcode='55000';
  end if;

  if p_receipt->>'schema'<>'metaengine.compute.w1-codespaces-persistent-storage-receipt.h205f22.v1'
     or p_receipt->>'outcome'<>'CODESPACES_PERSISTENT_STORAGE_BOUND_NONAUTHORITY'
     or coalesce((p_receipt->>'provider_storage_contract_verified')::boolean,true)
     or coalesce((p_receipt->>'persisted_readback_verified')::boolean,true)
     or coalesce((p_receipt->>'persistent_worker_proof')::boolean,true)
     or coalesce((p_receipt->>'worker_admitted')::boolean,true)
     or coalesce((p_receipt->>'w1_verified')::boolean,true)
     or coalesce((p_receipt->>'canonical')::boolean,true)
     or coalesce((p_receipt->>'authority_effect')::boolean,true)
     or not coalesce((p_receipt->>'requires_authenticated_github_provenance')::boolean,false)
     or not coalesce((p_receipt->>'requires_persisted_db_composition')::boolean,false) then
    raise exception 'w1_storage_receipt_shape_invalid' using errcode='22023';
  end if;

  v_evidence := p_receipt->'evidence';
  if jsonb_typeof(v_evidence)<>'object' then raise exception 'w1_storage_receipt_evidence_required' using errcode='22023'; end if;
  v_receipt_sha := encode(extensions.digest(convert_to(
    destruktion_meta.compute_fabric_canonical_evidence_json_h205f22(v_evidence),'UTF8'),'sha256'),'hex');
  if p_receipt->>'receipt_sha256' is distinct from v_receipt_sha then
    raise exception 'w1_storage_receipt_hash_mismatch' using errcode='22023';
  end if;

  v_checks := v_evidence->'checks';
  if jsonb_typeof(v_checks)<>'object'
     or not (v_checks ?& array[
       'persistent_root_is_workspaces','sentinel_path_stable','sentinel_path_hash_stable',
       'sentinel_content_stable','source_identity_stable','kernel_boot_id_changed','provider_sequence_eligible'
     ])
     or exists (select 1 from jsonb_each(v_checks) where value<>'true'::jsonb) then
    raise exception 'w1_storage_receipt_checks_failed' using errcode='22023';
  end if;

  v_path_sha := encode(extensions.digest(convert_to(v_expected_path,'UTF8'),'sha256'),'hex');
  if v_evidence->>'provider_kind'<>'GITHUB_CODESPACES'
     or v_evidence->>'provider_object_id' is distinct from v_lifecycle.provider_object_id
     or v_evidence->>'provider_object_name' is distinct from v_lifecycle.provider_object_id
     or v_evidence->>'persistent_root'<>'/workspaces'
     or v_evidence->>'sentinel_path' is distinct from v_expected_path
     or v_evidence->>'sentinel_path_sha256' is distinct from v_path_sha
     or v_evidence#>>'{source,git_sha}' is distinct from v_manifest.source_git_sha
     or v_evidence#>>'{source,tree_sha}' is distinct from v_manifest.source_tree_sha
     or v_evidence->>'pre_boot_id' is distinct from v_manifest.lifecycle_bundle#>>'{evidence,lifecycle,evidence,pre_boot_id}'
     or v_evidence->>'post_boot_id' is distinct from v_manifest.lifecycle_bundle#>>'{evidence,lifecycle,evidence,post_boot_id}'
     or v_evidence->>'sentinel_sha256' is distinct from v_manifest.lifecycle_bundle#>>'{evidence,lifecycle,evidence,sentinel_sha256}'
     or v_evidence->>'provider_oracle_sha256' is distinct from v_manifest.lifecycle_bundle#>>'{evidence,provider,oracle_sha256}'
     or v_evidence->>'stopped_snapshot_sha256' is distinct from v_lifecycle.stopped_provider_snapshot_sha256
     or v_evidence->>'stopped_snapshot_sha256' is distinct from v_manifest.lifecycle_bundle#>>'{evidence,provider,evidence,stopped_snapshot_sha256}' then
    raise exception 'w1_storage_receipt_cross_binding_mismatch' using errcode='22023';
  end if;
  if v_evidence->>'pre_boot_id'=v_evidence->>'post_boot_id' then
    raise exception 'w1_storage_receipt_boot_id_unchanged' using errcode='22023';
  end if;

  insert into destruktion_meta.compute_fabric_w1_codespaces_storage_receipt_h205f22(
    pre_persistence_manifest_id,lifecycle_receipt_id,worker_id,claim_id,directive_id,base_checkpoint_id,
    provider_object_id,source_git_sha,source_tree_sha,persistent_root,sentinel_path,
    sentinel_path_sha256,sentinel_sha256,pre_boot_id,post_boot_id,provider_oracle_sha256,
    stopped_snapshot_sha256,receipt,receipt_sha256
  ) values (
    v_manifest.pre_persistence_manifest_id,v_manifest.lifecycle_receipt_id,v_manifest.worker_id,
    v_manifest.claim_id,v_manifest.directive_id,v_manifest.base_checkpoint_id,
    v_lifecycle.provider_object_id,v_manifest.source_git_sha,v_manifest.source_tree_sha,
    '/workspaces',v_expected_path,v_path_sha,v_evidence->>'sentinel_sha256',
    v_evidence->>'pre_boot_id',v_evidence->>'post_boot_id',v_evidence->>'provider_oracle_sha256',
    v_evidence->>'stopped_snapshot_sha256',p_receipt,v_receipt_sha
  ) returning * into v_row;

  return jsonb_build_object(
    'schema','metaengine.compute.w1-codespaces-storage-ingest-receipt.h205f22.v1',
    'storage_receipt_id',v_row.storage_receipt_id,
    'pre_persistence_manifest_id',v_row.pre_persistence_manifest_id,
    'worker_id',v_row.worker_id,
    'lifecycle_receipt_id',v_row.lifecycle_receipt_id,
    'claim_id',v_row.claim_id,
    'directive_id',v_row.directive_id,
    'base_checkpoint_id',v_row.base_checkpoint_id,
    'receipt_sha256',v_row.receipt_sha256,
    'verification_status','PENDING_STORAGE_PROVENANCE_READBACK',
    'provider_storage_contract_verified',false,
    'authenticated_github_provenance_verified',false,
    'persisted_readback_verified',false,
    'persistent_worker_proof',false,
    'worker_admitted',false,
    'w1_verified',false,
    'canonical',false,
    'authority_effect',false,
    'requires_authenticated_github_provenance',true,
    'requires_persisted_readback_recomposition',true,
    'requires_supervisor_verification',true
  );
end
$$;

revoke all on function public.h205f22_w1_codespaces_storage_receipt_ingest_v1(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.h205f22_w1_codespaces_storage_receipt_ingest_v1(uuid,jsonb) to service_role;

create or replace function public.h205f22_w1_codespaces_storage_receipt_readback_v1(p_storage_receipt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, destruktion_meta, extensions
as $$
declare
  v destruktion_meta.compute_fabric_w1_codespaces_storage_receipt_h205f22%rowtype;
  v_receipt_sha text;
  v_path_sha text;
  v_match boolean;
begin
  select * into v
  from destruktion_meta.compute_fabric_w1_codespaces_storage_receipt_h205f22
  where storage_receipt_id=p_storage_receipt_id;
  if not found then raise exception 'w1_storage_receipt_not_found' using errcode='22023'; end if;

  v_receipt_sha := encode(extensions.digest(convert_to(
    destruktion_meta.compute_fabric_canonical_evidence_json_h205f22(v.receipt->'evidence'),'UTF8'),'sha256'),'hex');
  v_path_sha := encode(extensions.digest(convert_to(v.sentinel_path,'UTF8'),'sha256'),'hex');
  v_match := v_receipt_sha=v.receipt_sha256
    and v.receipt->>'receipt_sha256'=v.receipt_sha256
    and v_path_sha=v.sentinel_path_sha256
    and v.receipt#>>'{evidence,sentinel_path_sha256}'=v.sentinel_path_sha256
    and v.receipt#>>'{evidence,sentinel_sha256}'=v.sentinel_sha256
    and v.receipt#>>'{evidence,pre_boot_id}'=v.pre_boot_id
    and v.receipt#>>'{evidence,post_boot_id}'=v.post_boot_id
    and v.receipt#>>'{evidence,stopped_snapshot_sha256}'=v.stopped_snapshot_sha256;

  return jsonb_build_object(
    'schema','metaengine.compute.w1-codespaces-storage-readback.h205f22.v1',
    'storage_receipt_id',v.storage_receipt_id,
    'pre_persistence_manifest_id',v.pre_persistence_manifest_id,
    'worker_id',v.worker_id,
    'lifecycle_receipt_id',v.lifecycle_receipt_id,
    'base_checkpoint_id',v.base_checkpoint_id,
    'receipt_sha256',v.receipt_sha256,
    'recomputed_receipt_sha256',v_receipt_sha,
    'recomputed_sentinel_path_sha256',v_path_sha,
    'persisted_readback_match',v_match,
    'verification_status','PENDING_STORAGE_PROVENANCE_READBACK',
    'provider_storage_contract_verified',false,
    'authenticated_github_provenance_verified',false,
    'persisted_readback_verified',false,
    'persistent_worker_proof',false,
    'worker_admitted',false,
    'w1_verified',false,
    'canonical',false,
    'authority_effect',false,
    'requires_authenticated_github_provenance',true,
    'requires_supervisor_verification',true
  );
end
$$;

revoke all on function public.h205f22_w1_codespaces_storage_receipt_readback_v1(uuid) from public, anon, authenticated;
grant execute on function public.h205f22_w1_codespaces_storage_receipt_readback_v1(uuid) to service_role;
