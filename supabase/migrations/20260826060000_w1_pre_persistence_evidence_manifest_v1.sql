-- W1 pre-persistence evidence manifest v1
-- PREPARED / NOT APPLIED LIVE while W1 authority is expired.
-- Depends on 20260825023000_w1_provider_neutral_lifecycle_receipt_v2.sql.
--
-- Purpose:
--   bind exact S2 runtime PASS, provider lifecycle PRE/STOP/RESUME/POST,
--   post H1-H13, and the prebound privileged outer-cgroup tree-kill witness
--   into one append-only persisted object. Ingest is permitted only under a
--   fresh current-head W1 claim + supervisor directive. Even a successful
--   ingest/readback remains NON-AUTHORITY and cannot admit/verify a worker.

do $$
begin
  if to_regclass('destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22') is null then
    raise exception 'w1_pre_persistence_requires_lifecycle_receipt_v2';
  end if;
  if to_regprocedure('destruktion_meta.compute_fabric_canonical_evidence_json_h205f22(jsonb)') is null then
    raise exception 'w1_pre_persistence_requires_evidence_canonicalizer';
  end if;
end
$$;

create table destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22 (
  pre_persistence_manifest_id uuid primary key default extensions.gen_random_uuid(),
  worker_id text not null references destruktion_meta.compute_fabric_worker_enrollment_h205f22(worker_id) on update cascade on delete restrict,
  lifecycle_receipt_id uuid not null references destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22(lifecycle_receipt_id) on update restrict on delete restrict,
  claim_id bigint not null references destruktion_meta.compute_fabric_roadmap_work_claim_h205f22(claim_id) on update restrict on delete restrict,
  directive_id bigint not null references destruktion_meta.compute_fabric_supervisor_directive_h205f22(directive_id) on update restrict on delete restrict,
  base_checkpoint_id text not null,
  source_git_sha text not null check (source_git_sha ~ '^[0-9a-f]{40}$'),
  source_tree_sha text not null check (source_tree_sha ~ '^[0-9a-f]{40}$'),
  s2_source_sha256 text not null check (s2_source_sha256 ~ '^[0-9a-f]{64}$'),
  s2_receipt_sha256 text not null check (s2_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  lifecycle_evidence_sha256 text not null check (lifecycle_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  lifecycle_bundle_sha256 text not null check (lifecycle_bundle_sha256 ~ '^[0-9a-f]{64}$'),
  post_h1_h13_sha256 text not null check (post_h1_h13_sha256 ~ '^[0-9a-f]{64}$'),
  outer_cgroup_witness_sha256 text not null check (outer_cgroup_witness_sha256 ~ '^[0-9a-f]{64}$'),
  outer_container_id_sha256 text not null check (outer_container_id_sha256 ~ '^[0-9a-f]{64}$'),
  outer_cgroup_path_sha256 text not null check (outer_cgroup_path_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text not null unique check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  lifecycle_bundle jsonb not null check (jsonb_typeof(lifecycle_bundle)='object' and octet_length(lifecycle_bundle::text) <= 1048576),
  outer_cgroup_witness jsonb not null check (jsonb_typeof(outer_cgroup_witness)='object' and octet_length(outer_cgroup_witness::text) <= 524288),
  manifest jsonb not null check (jsonb_typeof(manifest)='object' and octet_length(manifest::text) <= 262144),
  verification_status text not null default 'PENDING_PERSISTED_READBACK' check (verification_status='PENDING_PERSISTED_READBACK'),
  authenticated_provenance_verified boolean not null default false check (authenticated_provenance_verified=false),
  persisted_readback_verified boolean not null default false check (persisted_readback_verified=false),
  persistent_worker_proof boolean not null default false check (persistent_worker_proof=false),
  worker_admitted boolean not null default false check (worker_admitted=false),
  w1_verified boolean not null default false check (w1_verified=false),
  canonical boolean not null default false check (canonical=false),
  authority_effect boolean not null default false check (authority_effect=false),
  created_at timestamptz not null default clock_timestamp(),
  unique(worker_id,lifecycle_receipt_id)
);

comment on table destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22 is
'Append-only W1 causal evidence binding. Ingest requires a fresh current-head W1 claim/directive, but rows remain non-authority until authenticated provenance, persisted readback composition, and supervisor verification.';

revoke all on table destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22 from public, anon, authenticated;

create or replace function destruktion_meta.compute_fabric_w1_pre_persistence_manifest_immutable_h205f22()
returns trigger
language plpgsql
set search_path = pg_catalog, destruktion_meta
as $$
begin
  raise exception 'w1_pre_persistence_manifest_is_append_only' using errcode='55000';
end
$$;

create trigger compute_fabric_w1_pre_persistence_manifest_immutable_h205f22
before update or delete on destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22
for each row execute function destruktion_meta.compute_fabric_w1_pre_persistence_manifest_immutable_h205f22();

revoke all on function destruktion_meta.compute_fabric_w1_pre_persistence_manifest_immutable_h205f22() from public, anon, authenticated;

create or replace function public.h205f22_w1_pre_persistence_manifest_ingest_v1(
  p_worker_id text,
  p_lifecycle_receipt_id uuid,
  p_claim_id bigint,
  p_directive_id bigint,
  p_lifecycle_bundle jsonb,
  p_outer_cgroup_witness jsonb,
  p_manifest jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, destruktion_meta, extensions
as $$
declare
  v_status jsonb;
  v_head text;
  v_claim destruktion_meta.compute_fabric_roadmap_work_claim_h205f22%rowtype;
  v_directive destruktion_meta.compute_fabric_supervisor_directive_h205f22%rowtype;
  v_lifecycle destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22%rowtype;
  v_row destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22%rowtype;
  v_bindings jsonb;
  v_s2_receipt jsonb;
  v_h1 jsonb;
  v_provider jsonb;
  v_outer_cgroup jsonb;
  v_sha text;
  v_lifecycle_evidence_sha text;
  v_lifecycle_bundle_sha text;
  v_s2_receipt_sha text;
  v_h1_sha text;
  v_outer_sha text;
  v_manifest_sha text;
  v_expected_s2_source constant text := '25586bd8e0e97a78988f93d9c68c358b7eea6924015d06721afc135412d386df';
begin
  if nullif(p_worker_id,'') is null or p_lifecycle_receipt_id is null
     or p_claim_id is null or p_directive_id is null then
    raise exception 'w1_pre_persistence_identity_required' using errcode='22023';
  end if;
  if jsonb_typeof(p_lifecycle_bundle) <> 'object'
     or jsonb_typeof(p_outer_cgroup_witness) <> 'object'
     or jsonb_typeof(p_manifest) <> 'object' then
    raise exception 'w1_pre_persistence_json_object_required' using errcode='22023';
  end if;
  if octet_length(p_lifecycle_bundle::text) > 1048576
     or octet_length(p_outer_cgroup_witness::text) > 524288
     or octet_length(p_manifest::text) > 262144 then
    raise exception 'w1_pre_persistence_evidence_too_large' using errcode='22023';
  end if;

  -- Fresh authority gate. Expired rows that still say state/status=ACTIVE do not pass.
  v_status := destruktion_meta.compute_fabric_roadmap_status_h205f22();
  if not coalesce((v_status->>'definition_integrity')::boolean,false) then
    raise exception 'w1_pre_persistence_roadmap_integrity_failed' using errcode='55000';
  end if;
  v_head := v_status#>>'{semantic_head,checkpoint_id}';
  if v_head is null then raise exception 'w1_pre_persistence_semantic_head_missing' using errcode='55000'; end if;
  if not exists (
    select 1 from jsonb_array_elements(v_status->'milestones') m
    where m->>'milestone_key'='W1_PERSISTENT_LINUX_WORKER_SAFETY'
      and m->>'effective_status'='IN_PROGRESS'
  ) then
    raise exception 'w1_pre_persistence_w1_not_in_progress' using errcode='55000';
  end if;

  select * into v_claim
  from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22
  where claim_id=p_claim_id
    and roadmap_id='compute-fabric-roadmap-v1'
    and milestone_key='W1_PERSISTENT_LINUX_WORKER_SAFETY'
    and holder_id='aop1:W1_IMPLEMENTER'
    and state='ACTIVE'
    and expires_at>clock_timestamp()
    and base_checkpoint_id=v_head;
  if not found then raise exception 'w1_pre_persistence_fresh_claim_required' using errcode='55000'; end if;

  select * into v_directive
  from destruktion_meta.compute_fabric_supervisor_directive_h205f22
  where directive_id=p_directive_id
    and roadmap_id='compute-fabric-roadmap-v1'
    and milestone_key='W1_PERSISTENT_LINUX_WORKER_SAFETY'
    and status='ACTIVE'
    and (expires_at is null or expires_at>clock_timestamp())
    and directive_kind in ('OPEN','CONTINUE','REASSIGN')
    and (target_holder_id is null or target_holder_id='aop1:W1_IMPLEMENTER')
    and base_checkpoint_id=v_head;
  if not found then raise exception 'w1_pre_persistence_fresh_directive_required' using errcode='55000'; end if;
  if v_claim.claimed_at < v_directive.created_at then
    raise exception 'w1_pre_persistence_claim_predates_directive' using errcode='55000';
  end if;

  select * into v_lifecycle
  from destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22
  where lifecycle_receipt_id=p_lifecycle_receipt_id and worker_id=p_worker_id;
  if not found then raise exception 'w1_pre_persistence_lifecycle_receipt_missing' using errcode='55000'; end if;
  if v_lifecycle.provider_kind <> 'GITHUB_CODESPACES'
     or v_lifecycle.action_kind <> 'STOP_RESUME'
     or v_lifecycle.verification_status <> 'PENDING_PROVIDER_VALIDATION'
     or v_lifecycle.provider_identity_verified
     or v_lifecycle.lifecycle_action_verified
     or v_lifecycle.accepted
     or v_lifecycle.canonical
     or v_lifecycle.authority_effect then
    raise exception 'w1_pre_persistence_lifecycle_receipt_state_invalid' using errcode='55000';
  end if;

  -- Structural lifecycle bundle + exact embedded S2 PASS.
  if p_lifecycle_bundle->>'schema' <> 'metaengine.compute.w1-lifecycle-evidence-harness.h205f22.v1'
     or p_lifecycle_bundle->>'outcome' <> 'W1_LIFECYCLE_EVIDENCE_COMPOSED_NONAUTHORITY'
     or coalesce((p_lifecycle_bundle->>'canonical')::boolean,true)
     or coalesce((p_lifecycle_bundle->>'authority_effect')::boolean,true)
     or coalesce((p_lifecycle_bundle->>'persistent_worker_proof')::boolean,true)
     or coalesce((p_lifecycle_bundle->>'worker_admitted')::boolean,true)
     or coalesce((p_lifecycle_bundle->>'w1_verified')::boolean,true) then
    raise exception 'w1_pre_persistence_lifecycle_bundle_invalid' using errcode='22023';
  end if;

  v_lifecycle_evidence_sha := encode(extensions.digest(convert_to(
    destruktion_meta.compute_fabric_canonical_evidence_json_h205f22(p_lifecycle_bundle->'evidence'),'UTF8'),'sha256'),'hex');
  if p_lifecycle_bundle->>'evidence_sha256' is distinct from v_lifecycle_evidence_sha then
    raise exception 'w1_pre_persistence_lifecycle_evidence_hash_mismatch' using errcode='22023';
  end if;
  v_lifecycle_bundle_sha := encode(extensions.digest(convert_to(
    destruktion_meta.compute_fabric_canonical_evidence_json_h205f22(p_lifecycle_bundle),'UTF8'),'sha256'),'hex');

  v_s2_receipt := p_lifecycle_bundle#>'{evidence,s2_runtime}';
  if jsonb_typeof(v_s2_receipt) <> 'object'
     or v_s2_receipt->>'schema' <> 'metaengine.compute.w1-s2-runtime-canary-receipt.h205f22.v1'
     or v_s2_receipt->>'status' <> 'PASS_NONAUTHORITY'
     or v_s2_receipt#>>'{evidence,source_sha256}' <> v_expected_s2_source
     or coalesce((v_s2_receipt->>'canonical')::boolean,true)
     or coalesce((v_s2_receipt->>'authority_effect')::boolean,true)
     or coalesce((v_s2_receipt->>'persistent_worker_proof')::boolean,true)
     or coalesce((v_s2_receipt->>'worker_admitted')::boolean,true)
     or coalesce((v_s2_receipt->>'w1_verified')::boolean,true) then
    raise exception 'w1_pre_persistence_s2_receipt_invalid' using errcode='22023';
  end if;
  v_s2_receipt_sha := encode(extensions.digest(convert_to(
    destruktion_meta.compute_fabric_canonical_evidence_json_h205f22(v_s2_receipt->'evidence'),'UTF8'),'sha256'),'hex');
  if v_s2_receipt->>'receipt_sha256' is distinct from v_s2_receipt_sha then
    raise exception 'w1_pre_persistence_s2_receipt_hash_mismatch' using errcode='22023';
  end if;

  if not (
    coalesce((p_lifecycle_bundle#>>'{evidence,local_checks,source_identity_stable}')::boolean,false)
    and coalesce((p_lifecycle_bundle#>>'{evidence,local_checks,machine_identity_stable}')::boolean,false)
    and coalesce((p_lifecycle_bundle#>>'{evidence,local_checks,kernel_boot_id_changed}')::boolean,false)
    and coalesce((p_lifecycle_bundle#>>'{evidence,local_checks,persistent_sentinel_stable}')::boolean,false)
    and coalesce((p_lifecycle_bundle#>>'{evidence,local_checks,s2_runtime_receipt_pass}')::boolean,false)
    and coalesce((p_lifecycle_bundle#>>'{evidence,local_checks,post_h1_h13_prerequisites_pass}')::boolean,false)
  ) then
    raise exception 'w1_pre_persistence_local_checks_failed' using errcode='22023';
  end if;

  v_h1 := p_lifecycle_bundle#>'{evidence,post_h1_h13}';
  if v_h1->>'schema' <> 'metaengine.compute.w1-h1-h13-prereq-probe.h205f22.v1'
     or not coalesce((v_h1->>'ready_for_production_evidence')::boolean,false)
     or coalesce((v_h1->>'canonical')::boolean,true)
     or coalesce((v_h1->>'authority_effect')::boolean,true)
     or coalesce((v_h1->>'worker_admitted')::boolean,true)
     or coalesce((v_h1->>'w1_verified')::boolean,true) then
    raise exception 'w1_pre_persistence_h1_invalid' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_each(v_h1->'checks') where value <> 'true'::jsonb) then
    raise exception 'w1_pre_persistence_h1_check_failed' using errcode='22023';
  end if;
  v_h1_sha := encode(extensions.digest(convert_to(
    destruktion_meta.compute_fabric_canonical_evidence_json_h205f22(v_h1),'UTF8'),'sha256'),'hex');

  -- Bridge the local Codespaces snapshot hashes to the already-persisted v2 row.
  v_provider := p_lifecycle_bundle#>'{evidence,provider}';
  if v_provider->>'schema' <> 'metaengine.compute.w1-github-codespaces-snapshot-oracle.h205f22.v1'
     or v_provider->>'outcome' <> 'CODESPACES_SNAPSHOTS_STRUCTURALLY_ELIGIBLE_NONAUTHORITY'
     or v_provider#>>'{evidence,provider_object_name}' is distinct from v_lifecycle.provider_object_id
     or v_provider#>>'{evidence,pre_snapshot_sha256}' is distinct from v_lifecycle.pre_provider_snapshot_sha256
     or v_provider#>>'{evidence,post_snapshot_sha256}' is distinct from v_lifecycle.post_provider_snapshot_sha256 then
    raise exception 'w1_pre_persistence_provider_persisted_bridge_mismatch' using errcode='22023';
  end if;

  -- Exact outer privileged witness requirements.
  if p_outer_cgroup_witness->>'schema' <> 'metaengine.compute.w1-outer-privileged-cgroup-witness.h205f22.v2'
     or p_outer_cgroup_witness->>'mode' <> 'EXECUTE'
     or p_outer_cgroup_witness->>'outcome' <> 'ELIGIBLE_NONAUTHORITY'
     or not coalesce((p_outer_cgroup_witness->>'prebound_before_sudo')::boolean,false)
     or p_outer_cgroup_witness->>'privilege_scope' <> 'PREBOUND_EXACT_CGROUP_KILL_WRITE_ONLY'
     or coalesce((p_outer_cgroup_witness->>'sudo_before_exact_binding')::boolean,true)
     or coalesce((p_outer_cgroup_witness->>'worker_launch_via_sudo')::boolean,true)
     or coalesce((p_outer_cgroup_witness->>'worker_exec_via_sudo')::boolean,true)
     or not coalesce((p_outer_cgroup_witness#>>'{sudo,available}')::boolean,false)
     or p_outer_cgroup_witness#>>'{sudo,uid}' <> '0'
     or not coalesce((p_outer_cgroup_witness#>>'{cgroup,exact_target_valid}')::boolean,false)
     or p_outer_cgroup_witness#>'{cgroup,target_error}' <> 'null'::jsonb
     or not coalesce((p_outer_cgroup_witness#>>'{cgroup,sudo_kill_write,succeeded}')::boolean,false)
     or coalesce((p_outer_cgroup_witness#>>'{cgroup,sudo_kill_write,returncode}')::integer,-1) <> 0
     or p_outer_cgroup_witness#>>'{cgroup,sudo_kill_write,stdout}' <> '1'
     or not coalesce((p_outer_cgroup_witness#>>'{cgroup,post_unpopulated}')::boolean,false)
     or not coalesce((p_outer_cgroup_witness#>>'{cgroup,pre_processes_gone}')::boolean,false)
     or coalesce((p_outer_cgroup_witness#>>'{cgroup,docker_running_after}')::boolean,true)
     or not coalesce((p_outer_cgroup_witness#>>'{cgroup,tree_kill_proven}')::boolean,false)
     or coalesce((p_outer_cgroup_witness->>'canonical')::boolean,true)
     or coalesce((p_outer_cgroup_witness->>'authority_effect')::boolean,true)
     or coalesce((p_outer_cgroup_witness->>'worker_admitted')::boolean,true)
     or coalesce((p_outer_cgroup_witness->>'w1_verified')::boolean,true)
     or not coalesce((p_outer_cgroup_witness->>'requires_persisted_two_plane_composition')::boolean,false) then
    raise exception 'w1_pre_persistence_outer_witness_invalid' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_each(p_outer_cgroup_witness->'inner_checks') where value <> 'true'::jsonb)
     or exists (select 1 from jsonb_each(p_outer_cgroup_witness->'two_plane_checks') where value <> 'true'::jsonb)
     or exists (select 1 from jsonb_each(p_outer_cgroup_witness->'security_requests_verified') where value <> 'true'::jsonb)
     or exists (select 1 from jsonb_each(p_outer_cgroup_witness#>'{cgroup,limit_checks}') where value <> 'true'::jsonb) then
    raise exception 'w1_pre_persistence_outer_witness_checks_failed' using errcode='22023';
  end if;
  if coalesce((p_outer_cgroup_witness#>>'{cgroup,pre_process_count}')::integer,0) < 2 then
    raise exception 'w1_pre_persistence_outer_process_tree_too_small' using errcode='22023';
  end if;
  v_sha := encode(extensions.digest(convert_to(p_outer_cgroup_witness#>>'{cgroup,path}','UTF8'),'sha256'),'hex');
  if p_outer_cgroup_witness#>>'{cgroup,path_sha256}' is distinct from v_sha then
    raise exception 'w1_pre_persistence_outer_cgroup_path_hash_mismatch' using errcode='22023';
  end if;
  v_outer_sha := encode(extensions.digest(convert_to(
    destruktion_meta.compute_fabric_canonical_evidence_json_h205f22(p_outer_cgroup_witness),'UTF8'),'sha256'),'hex');

  -- Recompute every manifest binding from persisted/validated inputs.
  if p_manifest->>'schema' <> 'metaengine.compute.w1-pre-persistence-evidence-manifest.h205f22.v1'
     or p_manifest->>'status' <> 'PRE_PERSISTENCE_ELIGIBLE_NONAUTHORITY'
     or coalesce((p_manifest->>'authenticated_provenance_verified')::boolean,true)
     or coalesce((p_manifest->>'persisted_readback_verified')::boolean,true)
     or coalesce((p_manifest->>'persistent_worker_proof')::boolean,true)
     or coalesce((p_manifest->>'worker_admitted')::boolean,true)
     or coalesce((p_manifest->>'w1_verified')::boolean,true)
     or coalesce((p_manifest->>'canonical')::boolean,true)
     or coalesce((p_manifest->>'authority_effect')::boolean,true) then
    raise exception 'w1_pre_persistence_manifest_shape_invalid' using errcode='22023';
  end if;
  v_bindings := p_manifest->'bindings';
  if jsonb_typeof(v_bindings) <> 'object' then raise exception 'w1_pre_persistence_bindings_required' using errcode='22023'; end if;
  v_manifest_sha := encode(extensions.digest(convert_to(
    destruktion_meta.compute_fabric_canonical_evidence_json_h205f22(v_bindings),'UTF8'),'sha256'),'hex');
  if p_manifest->>'manifest_sha256' is distinct from v_manifest_sha then
    raise exception 'w1_pre_persistence_manifest_hash_mismatch' using errcode='22023';
  end if;

  if v_bindings#>>'{source,git_sha}' !~ '^[0-9a-f]{40}$'
     or v_bindings#>>'{source,tree_sha}' !~ '^[0-9a-f]{40}$'
     or v_bindings->>'s2_source_sha256' is distinct from v_expected_s2_source
     or v_bindings->>'s2_receipt_sha256' is distinct from v_s2_receipt_sha
     or v_bindings->>'lifecycle_evidence_sha256' is distinct from v_lifecycle_evidence_sha
     or v_bindings->>'lifecycle_bundle_sha256' is distinct from v_lifecycle_bundle_sha
     or v_bindings->>'post_h1_h13_sha256' is distinct from v_h1_sha
     or v_bindings->>'outer_cgroup_witness_sha256' is distinct from v_outer_sha
     or v_bindings->>'outer_image_id' is distinct from p_outer_cgroup_witness->>'image_id'
     or v_bindings->>'outer_container_id_sha256' is distinct from p_outer_cgroup_witness->>'container_id_sha256'
     or v_bindings->>'outer_cgroup_path_sha256' is distinct from p_outer_cgroup_witness#>>'{cgroup,path_sha256}' then
    raise exception 'w1_pre_persistence_binding_mismatch' using errcode='22023';
  end if;

  insert into destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22(
    worker_id,lifecycle_receipt_id,claim_id,directive_id,base_checkpoint_id,
    source_git_sha,source_tree_sha,s2_source_sha256,s2_receipt_sha256,
    lifecycle_evidence_sha256,lifecycle_bundle_sha256,post_h1_h13_sha256,
    outer_cgroup_witness_sha256,outer_container_id_sha256,outer_cgroup_path_sha256,
    manifest_sha256,lifecycle_bundle,outer_cgroup_witness,manifest
  ) values (
    p_worker_id,p_lifecycle_receipt_id,p_claim_id,p_directive_id,v_head,
    v_bindings#>>'{source,git_sha}',v_bindings#>>'{source,tree_sha}',v_expected_s2_source,v_s2_receipt_sha,
    v_lifecycle_evidence_sha,v_lifecycle_bundle_sha,v_h1_sha,
    v_outer_sha,p_outer_cgroup_witness->>'container_id_sha256',p_outer_cgroup_witness#>>'{cgroup,path_sha256}',
    v_manifest_sha,p_lifecycle_bundle,p_outer_cgroup_witness,p_manifest
  ) returning * into v_row;

  return jsonb_build_object(
    'schema','metaengine.compute.w1-pre-persistence-ingest-receipt.h205f22.v1',
    'pre_persistence_manifest_id',v_row.pre_persistence_manifest_id,
    'worker_id',v_row.worker_id,
    'lifecycle_receipt_id',v_row.lifecycle_receipt_id,
    'claim_id',v_row.claim_id,
    'directive_id',v_row.directive_id,
    'base_checkpoint_id',v_row.base_checkpoint_id,
    'manifest_sha256',v_row.manifest_sha256,
    'verification_status','PENDING_PERSISTED_READBACK',
    'authenticated_provenance_verified',false,
    'persisted_readback_verified',false,
    'persistent_worker_proof',false,
    'worker_admitted',false,
    'w1_verified',false,
    'canonical',false,
    'authority_effect',false,
    'requires_persisted_readback_recomposition',true,
    'requires_supervisor_verification',true
  );
end
$$;

revoke all on function public.h205f22_w1_pre_persistence_manifest_ingest_v1(text,uuid,bigint,bigint,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.h205f22_w1_pre_persistence_manifest_ingest_v1(text,uuid,bigint,bigint,jsonb,jsonb,jsonb) to service_role;

create or replace function public.h205f22_w1_pre_persistence_manifest_readback_v1(p_manifest_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, destruktion_meta, extensions
as $$
declare
  v destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22%rowtype;
  v_lifecycle_bundle_sha text;
  v_outer_sha text;
  v_manifest_sha text;
  v_match boolean;
begin
  select * into v
  from destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22
  where pre_persistence_manifest_id=p_manifest_id;
  if not found then raise exception 'w1_pre_persistence_manifest_not_found' using errcode='22023'; end if;

  v_lifecycle_bundle_sha := encode(extensions.digest(convert_to(
    destruktion_meta.compute_fabric_canonical_evidence_json_h205f22(v.lifecycle_bundle),'UTF8'),'sha256'),'hex');
  v_outer_sha := encode(extensions.digest(convert_to(
    destruktion_meta.compute_fabric_canonical_evidence_json_h205f22(v.outer_cgroup_witness),'UTF8'),'sha256'),'hex');
  v_manifest_sha := encode(extensions.digest(convert_to(
    destruktion_meta.compute_fabric_canonical_evidence_json_h205f22(v.manifest->'bindings'),'UTF8'),'sha256'),'hex');
  v_match := v_lifecycle_bundle_sha=v.lifecycle_bundle_sha256
    and v_outer_sha=v.outer_cgroup_witness_sha256
    and v_manifest_sha=v.manifest_sha256
    and v.manifest->>'manifest_sha256'=v.manifest_sha256
    and v.lifecycle_bundle->>'evidence_sha256'=v.lifecycle_evidence_sha256;

  return jsonb_build_object(
    'schema','metaengine.compute.w1-pre-persistence-readback.h205f22.v1',
    'pre_persistence_manifest_id',v.pre_persistence_manifest_id,
    'worker_id',v.worker_id,
    'lifecycle_receipt_id',v.lifecycle_receipt_id,
    'claim_id',v.claim_id,
    'directive_id',v.directive_id,
    'base_checkpoint_id',v.base_checkpoint_id,
    'manifest_sha256',v.manifest_sha256,
    'recomputed_lifecycle_bundle_sha256',v_lifecycle_bundle_sha,
    'recomputed_outer_cgroup_witness_sha256',v_outer_sha,
    'recomputed_manifest_sha256',v_manifest_sha,
    'persisted_readback_match',v_match,
    'verification_status','PENDING_PERSISTED_READBACK',
    'authenticated_provenance_verified',false,
    'persisted_readback_verified',false,
    'persistent_worker_proof',false,
    'worker_admitted',false,
    'w1_verified',false,
    'canonical',false,
    'authority_effect',false,
    'requires_authenticated_provenance_validation',true,
    'requires_supervisor_verification',true
  );
end
$$;

revoke all on function public.h205f22_w1_pre_persistence_manifest_readback_v1(uuid) from public, anon, authenticated;
grant execute on function public.h205f22_w1_pre_persistence_manifest_readback_v1(uuid) to service_role;
