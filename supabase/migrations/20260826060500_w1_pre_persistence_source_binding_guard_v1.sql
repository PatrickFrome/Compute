-- W1 pre-persistence source binding guard v1
-- PREPARED / NOT APPLIED LIVE while W1 authority is expired.
-- Closes source-identity rebinding across the pre-persistence manifest row.

do $$
begin
  if to_regclass('destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22') is null then
    raise exception 'w1_source_binding_requires_pre_persistence_manifest_v1';
  end if;
end
$$;

alter table destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22
  add constraint compute_fabric_w1_pre_persistence_source_binding_h205f22
  check (
    source_git_sha = lifecycle_bundle#>>'{evidence,source,git_sha}'
    and source_tree_sha = lifecycle_bundle#>>'{evidence,source,tree_sha}'
  );

comment on constraint compute_fabric_w1_pre_persistence_source_binding_h205f22
on destruktion_meta.compute_fabric_w1_pre_persistence_manifest_h205f22 is
'Fail-closed binding: persisted source_git_sha/source_tree_sha must exactly equal the lifecycle PRE/POST source identity embedded in lifecycle_bundle evidence.';
