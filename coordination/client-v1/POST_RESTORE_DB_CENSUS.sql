-- METAENGINE Client V1 post-restore read-only database census.
-- No DDL, DML, server-side filesystem access, or authority effect.

select
  clock_timestamp() as observed_at,
  current_database() as database_name,
  pg_is_in_recovery() as in_recovery,
  pg_database_size(current_database()) as database_bytes,
  pg_size_pretty(pg_database_size(current_database())) as database_size_pretty;

select
  schemaname,
  relname,
  n_live_tup,
  n_dead_tup,
  pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass) as total_bytes,
  pg_size_pretty(pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass)) as total_size
from pg_stat_user_tables
order by total_bytes desc, schemaname, relname
limit 50;

select
  slot_name,
  plugin,
  slot_type,
  active,
  restart_lsn,
  confirmed_flush_lsn
from pg_replication_slots
order by slot_name;

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname = 'devos_fleet_mark_running_v1'
order by n.nspname, identity_arguments;

select
  version,
  name
from supabase_migrations.schema_migrations
where name = 'devos_agent_origin_receipt_v1'
   or version = '20260928034500'
order by version;
