-- W1 pre-persistence stopped-snapshot bridge guard v1
-- PREPARED / NOT APPLIED LIVE while W1 authority is expired.
-- Requires the lifecycle stopped-snapshot persistence guard and manifest v1.

do $$
begin
  if to_regclass('destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22') is null then
    raise exception 'w1_stopped_bridge_requires_pre_persistence_manifest_v1';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='destruktion_meta'
      and table_name='compute_fabric_worker_lifecycle_receipt_v2_h205f22'
      and column_name='stopped_provider_snapshot_sha256'
  ) then
    raise exception 'w1_stopped_bridge_requires_persisted_stopped_snapshot';
  end if;
end
$$;

create or replace function destruktion_meta.compute_fabric_w1_pre_persistence_stopped_snapshot_bridge_h205f22()
returns trigger
language plpgsql
set search_path = pg_catalog, destruktion_meta
as $$
declare
  v_lifecycle destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22%rowtype;
  v_bundle_sha text;
begin
  select * into v_lifecycle
  from destruktion_meta.compute_fabric_worker_lifecycle_receipt_v2_h205f22
  where lifecycle_receipt_id=new.lifecycle_receipt_id
    and worker_id=new.worker_id;
  if not found then
    raise exception 'w1_stopped_bridge_lifecycle_receipt_missing' using errcode='55000';
  end if;
  if v_lifecycle.provider_kind <> 'GITHUB_CODESPACES'
     or v_lifecycle.stopped_provider_snapshot_sha256 is null then
    raise exception 'w1_stopped_bridge_persisted_snapshot_missing' using errcode='55000';
  end if;

  v_bundle_sha := new.lifecycle_bundle#>>'{evidence,provider,evidence,stopped_snapshot_sha256}';
  if nullif(v_bundle_sha,'') is null
     or v_bundle_sha is distinct from v_lifecycle.stopped_provider_snapshot_sha256 then
    raise exception 'w1_stopped_bridge_hash_mismatch' using errcode='22023';
  end if;
  return new;
end
$$;

revoke all on function destruktion_meta.compute_fabric_w1_pre_persistence_stopped_snapshot_bridge_h205f22() from public, anon, authenticated;

create trigger compute_fabric_w1_pre_persistence_stopped_snapshot_bridge_h205f22
before insert on destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22
for each row execute function destruktion_meta.compute_fabric_w1_pre_persistence_stopped_snapshot_bridge_h205f22();
