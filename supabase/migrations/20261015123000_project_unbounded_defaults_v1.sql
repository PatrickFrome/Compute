-- Historical path only: this migration is for METAENGINE-owned PostgreSQL.
-- Logical project growth has no product-wide task/child/depth ceiling.
-- Existing projects retain their explicitly stored policy and generation.
-- Physical leases, per-request payload bounds and the single scheduler remain
-- unchanged; NULL is the existing project's unbounded policy representation.
alter table destruktion_meta.project_run_h205f22
  alter column max_depth set default null,
  alter column max_tasks set default null,
  alter column max_children set default null;

-- A private migration marker lets the existing source-pinned migration runner
-- distinguish upgraded schemas without rewriting a historical migration.
create function destruktion_meta.project_unbounded_defaults_h205f22()
returns text language sql immutable set search_path=pg_catalog as $$
  select 'metaengine.project.unbounded-defaults.v1'::text
$$;
revoke all on function destruktion_meta.project_unbounded_defaults_h205f22()
  from public,anon,authenticated,service_role;
