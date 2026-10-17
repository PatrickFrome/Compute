-- R1 continuity plane adoption bootstrap.
--
-- Fresh-replay repair (2026-10-17): this migration historically carried an index and a
-- table comment for objects created only in 20260821044429_r1_continuity_schema_contract,
-- which made a from-scratch replay fail (missing schema and missing tables). The index is
-- already created with `create index if not exists` inside the schema contract migration
-- and the table comment now lives there too, so this file only guarantees that the owning
-- schema exists before any later R1 continuity DDL runs.
create schema if not exists destruktion_meta;
