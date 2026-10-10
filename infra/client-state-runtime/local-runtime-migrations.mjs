import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';

export const LOCAL_RUNTIME_MIGRATIONS = Object.freeze([
  { path: '20260901034000_meta_orchestrator_controller_lease_v1.sql', signature: 'public.meta_orchestrator_controller_lease_v1(uuid,text,text,integer)', source_url: new URL('../../supabase/migrations/20260901034000_meta_orchestrator_controller_lease_v1.sql', import.meta.url) },
  { path: '20260901034500_meta_orchestrator_frontier_leader_fence_v2.sql', signature: 'public.meta_orchestrator_frontier_admit_v2(uuid,text,bigint,text[],text,bigint)', source_url: new URL('../../supabase/migrations/20260901034500_meta_orchestrator_frontier_leader_fence_v2.sql', import.meta.url) },
  { path: '20260902183500_devos_live_ambiguity_reconciliation_v3.sql', signature: 'public.devos_fleet_reconcile_ambiguous_v2(uuid,text,uuid,text,bigint,text,text,bigint,jsonb)', source_url: new URL('../../supabase/migrations/20260902183500_devos_live_ambiguity_reconciliation_v3.sql', import.meta.url) },
  { path: '20261009194157_managed_project_admission_v1.sql', signature: 'public.h205f22_a2_managed_project_admission_v1(uuid,uuid,text,bigint,bigint,uuid,bigint,uuid,text,bigint)', source_url: new URL('../../supabase/migrations/20261009194157_managed_project_admission_v1.sql', import.meta.url) },
  { path: '20261010100000_project_continuity_history_v1.sql', signature: 'public.h205f22_project_register_v1(uuid,uuid,uuid,text,bigint)', source_url: new URL('../../supabase/migrations/20261010100000_project_continuity_history_v1.sql', import.meta.url) },
]);

const REQUIRED_COLUMNS = {
  devos_fleet_task_h205f22: ['task_id', 'workspace_id', 'point_id', 'role', 'base_sha', 'lease_generation', 'lease_agent_id', 'lease_tab_id', 'lease_target_id', 'lease_agent_generation_epoch', 'lease_expires_at', 'state', 'authority_effect', 'result_summary', 'result_sha256', 'error_code', 'finished_at', 'updated_at'],
  devos_fleet_claim_h205f22: ['claim_id', 'workspace_id', 'task_id', 'agent_id', 'lease_generation', 'base_sha', 'tab_id', 'target_id', 'agent_generation_epoch', 'state', 'expires_at', 'updated_at', 'authority_effect'],
};

export async function applyLocalRuntimeMigrations({ sql }) {
  const sources = await Promise.all(LOCAL_RUNTIME_MIGRATIONS.map(async (migration) => {
    const source = await readFile(migration.source_url, 'utf8');
    return { ...migration, source, sha256: createHash('sha256').update(source).digest('hex') };
  }));
  return sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout = '3s'");
    await tx.unsafe("SET LOCAL statement_timeout = '30s'");
    const columns = await tx.unsafe(`SELECT c.table_name, c.column_name, c.udt_name
      FROM information_schema.columns c WHERE c.table_schema = 'destruktion_meta'
      AND c.table_name IN ('devos_fleet_task_h205f22','devos_fleet_claim_h205f22')`);
    for (const [table, names] of Object.entries(REQUIRED_COLUMNS)) {
      const absent = names.filter((name) => !columns.some((column) => column.table_name === table && column.column_name === name));
      if (absent.length) throw new Error('local_runtime_dependency_columns_missing:' + table + ':' + absent.join(','));
    }
    if (!columns.some((column) => column.table_name === 'devos_fleet_claim_h205f22' && column.column_name === 'claim_id' && column.udt_name === 'int8')) throw new Error('local_runtime_bigint_claim_schema_required');
    const [dependencies] = await tx.unsafe(`SELECT
      pg_catalog.to_regprocedure('public.meta_orchestrator_frontier_admit_v1(uuid,text,bigint,text[])') IS NOT NULL AS frontier,
      pg_catalog.to_regprocedure('destruktion_meta.devos_emit_event_h205f22(uuid,text,uuid,text,text,text,bigint,text,jsonb,text)') IS NOT NULL AS event,
      pg_catalog.to_regclass('public.compute_fabric_a2_browser_supervisor_state_h205f22') IS NOT NULL AS supervisor`);
    if (!dependencies.frontier || !dependencies.event || !dependencies.supervisor) throw new Error('local_runtime_dependency_functions_missing');
    const receipts = [];
    for (const migration of sources) {
      const [before] = await tx.unsafe('SELECT pg_catalog.to_regprocedure($1::text) IS NOT NULL AS installed', [migration.signature]);
      if (before.installed) {
        receipts.push({ source: migration.path, source_sha256: migration.sha256, signature: migration.signature, status: 'ALREADY_PRESENT_NOT_MODIFIED' });
        continue;
      }
      await tx.unsafe(migration.source);
      const [after] = await tx.unsafe('SELECT pg_catalog.to_regprocedure($1::text) IS NOT NULL AS installed', [migration.signature]);
      if (!after.installed) throw new Error('local_runtime_migration_readback_failed:' + migration.path);
      receipts.push({ source: migration.path, source_sha256: migration.sha256, signature: migration.signature, status: 'APPLIED_LOCAL_ONLY' });
    }
    return { schema: 'compute.local-runtime-migrations.v1', migrations: receipts, local_only: true, original_dump_modified: false };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.LOCAL_STATE_ADMIN_DATABASE_URL;
  if (!url || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) throw new Error('local_state_loopback_database_required');
  const sql = postgres(url, { max: 1, prepare: false });
  try { console.log(JSON.stringify(await applyLocalRuntimeMigrations({ sql }))); }
  catch (error) { console.error(JSON.stringify({ event: 'local_runtime_migration_failed', code: error.code || error.message })); process.exitCode = 1; }
  finally { await sql.end({ timeout: 5 }); }
}
