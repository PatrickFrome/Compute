-- METAENGINE R1 continuity plane adoption (guarded replay).
-- The two statements below reference R1 continuity tables created later in the
-- migration chain (20260821044429_r1_continuity_schema_contract). The documented
-- fresh-project contract (supabase/operations/20261005191500: "Historical
-- migration IDs are intentionally not replayed ... ordering assumed
-- pre-existing R1 objects") lets us skip-with-NOTICE when the referenced
-- object is absent instead of failing the fresh migration run.

do $guard$
begin
  if to_regclass('destruktion_meta.compute_continuity_observation_h205f22') is null then
    raise notice 'skip: destruktion_meta.compute_continuity_observation_h205f22 not created yet (20260821044429)';
  else
    create index if not exists compute_continuity_observation_object_domain_idx on destruktion_meta.compute_continuity_observation_h205f22(object_id, domain_key, observation_id desc);
  end if;

  if to_regclass('destruktion_meta.compute_continuity_checkpoint_ledger_h205f22') is null then
    raise notice 'skip: destruktion_meta.compute_continuity_checkpoint_ledger_h205f22 not created yet (20260821044429)';
  else
    comment on table destruktion_meta.compute_continuity_checkpoint_ledger_h205f22 is 'H205F22 R1 append-only continuity step ledger. This is not the supervisor mainline checkpoint seal.';
  end if;
end
$guard$;
