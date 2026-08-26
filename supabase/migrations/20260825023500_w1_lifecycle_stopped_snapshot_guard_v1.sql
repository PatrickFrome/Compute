-- W1 lifecycle stopped-snapshot persistence guard v1
-- PREPARED / NOT APPLIED LIVE while W1 authority is expired.
-- Depends on provider-neutral lifecycle receipt v2.
--
-- The local Codespaces oracle verifies PRE -> Shutdown -> POST. Persist the raw
-- Shutdown snapshot too; a string claim such as intermediate_state='Shutdown'
-- is insufficient evidence of the provider middle state.

do $$
begin
  if to_regclass('destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22') is null then
    raise exception 'w1_stopped_snapshot_requires_lifecycle_receipt_v2';
  end if;
  if to_regprocedure('destruktion_meta.compute_fabric_canonical_evidence_json_h205f22(jsonb)') is null then
    raise exception 'w1_stopped_snapshot_requires_evidence_canonicalizer';
  end if;
end
$$;

alter table destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22
  add column stopped_provider_snapshot jsonb,
  add column stopped_provider_snapshot_sha256 text,
  add constraint compute_fabric_worker_lifecycle_v2_stopped_snapshot_shape_h205f22
  check (
    provider_kind <> 'GITHUB_CODESPACES'
    or (
      jsonb_typeof(stopped_provider_snapshot)='object'
      and stopped_provider_snapshot_sha256 ~ '^[0-9a-f]{64}$'
      and stopped_provider_snapshot->>'state'='Shutdown'
      and stopped_provider_snapshot->>'name'=provider_object_id
    )
  );

create or replace function destruktion_meta.compute_fabric_w1_lifecycle_stopped_snapshot_bind_h205f22()
returns trigger
language plpgsql
set search_path = pg_catalog, destruktion_meta, extensions
as $$
declare
  v_stopped jsonb;
  v_sha text;
  v_pre_id text;
  v_stop_id text;
  v_post_id text;
  v_pre_at timestamptz;
  v_stop_at timestamptz;
  v_post_at timestamptz;
begin
  if new.provider_kind <> 'GITHUB_CODESPACES' then
    return new;
  end if;

  v_stopped := new.evidence->'stopped_provider_snapshot';
  if jsonb_typeof(v_stopped) <> 'object' then
    raise exception 'w1_codespaces_raw_stopped_snapshot_required' using errcode='22023';
  end if;
  if v_stopped->>'state' <> 'Shutdown'
     or v_stopped->>'name' is distinct from new.provider_object_id
     or v_stopped#>>'{repository,full_name}' is distinct from new.pre_provider_snapshot#>>'{repository,full_name}'
     or v_stopped#>>'{repository,full_name}' is distinct from new.post_provider_snapshot#>>'{repository,full_name}' then
    raise exception 'w1_codespaces_raw_stopped_snapshot_identity_invalid' using errcode='22023';
  end if;

  v_pre_id := new.pre_provider_snapshot->>'id';
  v_stop_id := v_stopped->>'id';
  v_post_id := new.post_provider_snapshot->>'id';
  if nullif(v_pre_id,'') is null or v_stop_id is distinct from v_pre_id or v_post_id is distinct from v_pre_id then
    raise exception 'w1_codespaces_raw_stopped_snapshot_id_mismatch' using errcode='22023';
  end if;

  begin
    v_pre_at := (new.pre_provider_snapshot->>'updated_at')::timestamptz;
    v_stop_at := (v_stopped->>'updated_at')::timestamptz;
    v_post_at := (new.post_provider_snapshot->>'updated_at')::timestamptz;
  exception when others then
    raise exception 'w1_codespaces_raw_stopped_snapshot_time_invalid' using errcode='22023';
  end;
  if not (v_pre_at < v_stop_at and v_stop_at < v_post_at) then
    raise exception 'w1_codespaces_raw_stopped_snapshot_time_not_between' using errcode='22023';
  end if;

  v_sha := encode(extensions.digest(convert_to(
    destruktion_meta.compute_fabric_canonical_evidence_json_h205f22(v_stopped),'UTF8'),'sha256'),'hex');
  new.stopped_provider_snapshot := v_stopped;
  new.stopped_provider_snapshot_sha256 := v_sha;
  return new;
end
$$;

revoke all on function destruktion_meta.compute_fabric_w1_lifecycle_stopped_snapshot_bind_h205f22() from public, anon, authenticated;

create trigger compute_fabric_w1_lifecycle_stopped_snapshot_bind_h205f22
before insert on destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22
for each row execute function destruktion_meta.compute_fabric_w1_lifecycle_stopped_snapshot_bind_h205f22();

create or replace function destruktion_meta.compute_fabric_w1_lifecycle_receipt_immutable_h205f22()
returns trigger
language plpgsql
set search_path = pg_catalog, destruktion_meta
as $$
begin
  raise exception 'w1_lifecycle_receipt_v2_is_append_only' using errcode='55000';
end
$$;

revoke all on function destruktion_meta.compute_fabric_w1_lifecycle_receipt_immutable_h205f22() from public, anon, authenticated;

create trigger compute_fabric_w1_lifecycle_receipt_immutable_h205f22
before update or delete on destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22
for each row execute function destruktion_meta.compute_fabric_w1_lifecycle_receipt_immutable_h205f22();
