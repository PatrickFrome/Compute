import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';

export const LOCAL_RUNTIME_MIGRATIONS = Object.freeze([
  { path: '20260901034000_meta_orchestrator_controller_lease_v1.sql', signature: 'public.meta_orchestrator_controller_lease_v1(uuid,text,text,integer)', source_url: new URL('../../supabase/migrations/20260901034000_meta_orchestrator_controller_lease_v1.sql', import.meta.url),
    relations: Object.freeze(['destruktion_meta.meta_orchestrator_controller_lease_h205f22']) },
  { path: '20260901034500_meta_orchestrator_frontier_leader_fence_v2.sql', signature: 'public.meta_orchestrator_frontier_admit_v2(uuid,text,bigint,text[],text,bigint)', source_url: new URL('../../supabase/migrations/20260901034500_meta_orchestrator_frontier_leader_fence_v2.sql', import.meta.url) },
  { path: '20260902183500_devos_live_ambiguity_reconciliation_v3.sql', signature: 'public.devos_fleet_reconcile_ambiguous_v2(uuid,text,uuid,text,bigint,text,text,bigint,jsonb)', source_url: new URL('../../supabase/migrations/20260902183500_devos_live_ambiguity_reconciliation_v3.sql', import.meta.url) },
  { path: '20261009194157_managed_project_admission_v1.sql', signature: 'public.h205f22_a2_managed_project_admission_v1(uuid,uuid,text,bigint,bigint,uuid,bigint,uuid,text,bigint)', source_url: new URL('../../supabase/migrations/20261009194157_managed_project_admission_v1.sql', import.meta.url),
    signatures: Object.freeze([
      'public.h205f22_a2_managed_project_repository_provision_v1(uuid,uuid,text,bigint,text,text,text)',
      'public.h205f22_a2_managed_project_admission_v1(uuid,uuid,text,bigint,bigint,uuid,bigint,uuid,text,bigint)',
      'public.h205f22_a2_managed_project_binding_effect_v1(uuid,uuid,text,bigint,bigint,uuid,bigint,uuid,text,bigint,text,text,text,boolean,boolean,text)',
      'destruktion_meta.a2_managed_project_admission_read_h205f22(uuid,uuid,text,bigint,bigint,uuid,bigint,uuid,text,bigint,boolean)',
    ]), relations: Object.freeze(['public.compute_fabric_a2_managed_project_repository_h205f22']) },
  { path: '20261010100000_project_continuity_history_v1.sql', signature: 'public.h205f22_project_register_v1(uuid,uuid,uuid,text,bigint)', source_url: new URL('../../supabase/migrations/20261010100000_project_continuity_history_v1.sql', import.meta.url),
    signatures: Object.freeze([
      'public.h205f22_project_register_v1(uuid,uuid,uuid,text,bigint)',
      'public.h205f22_project_snapshot_v1(uuid,uuid,uuid,bigint,integer,uuid,text,bigint)',
      'public.h205f22_project_history_v1(uuid,uuid,bigint,bigint,integer,uuid,bigint,text,uuid,text,bigint)',
      'public.h205f22_project_spawn_v1(uuid,uuid,uuid,bigint,bigint,uuid,jsonb,uuid,text,bigint)',
      'public.h205f22_project_activity_v1(uuid,uuid,uuid,bigint,bigint,uuid,text,bigint,text,text,jsonb,bigint,uuid,text,bigint)',
      'public.h205f22_project_policy_v1(uuid,uuid,bigint,integer,bigint,bigint,uuid,text,bigint)',
      'public.h205f22_project_reconcile_v1(uuid,uuid,uuid,text,bigint)',
      'destruktion_meta.project_device_grant_h205f22(uuid,text,bigint)',
      'destruktion_meta.project_authorize_h205f22(uuid,uuid,uuid,text,bigint)',
      'destruktion_meta.project_task_projection_h205f22(uuid,uuid)',
      'destruktion_meta.project_result_bound_h205f22(uuid,text)',
      'destruktion_meta.project_completion_ready_h205f22(uuid)',
      'destruktion_meta.project_task_completion_guard_h205f22()',
      'destruktion_meta.project_append_h205f22(uuid,text,uuid,bigint,text,bigint,text,text,jsonb,text,bigint,boolean,text)',
      'destruktion_meta.project_parent_h205f22(uuid,uuid,uuid,bigint,bigint,uuid,text,bigint)',
      'destruktion_meta.project_task_state_history_h205f22()',
      'destruktion_meta.project_fleet_event_history_h205f22()',
    ]), relations: Object.freeze(['destruktion_meta.project_run_h205f22', 'destruktion_meta.project_task_h205f22', 'destruktion_meta.project_event_h205f22', 'destruktion_meta.project_child_proposal_h205f22']),
    triggers: Object.freeze([
      { relation: 'destruktion_meta.devos_fleet_task_h205f22', name: 'project_task_completion_guard_h205f22', signature: 'destruktion_meta.project_task_completion_guard_h205f22()' },
      { relation: 'destruktion_meta.devos_fleet_task_h205f22', name: 'project_task_state_history_h205f22', signature: 'destruktion_meta.project_task_state_history_h205f22()' },
      { relation: 'destruktion_meta.devos_fleet_event_h205f22', name: 'project_fleet_event_history_h205f22', signature: 'destruktion_meta.project_fleet_event_history_h205f22()' },
    ]) },
]);

const REQUIRED_COLUMNS = {
  devos_fleet_task_h205f22: ['task_id', 'workspace_id', 'point_id', 'role', 'base_sha', 'lease_generation', 'lease_agent_id', 'lease_tab_id', 'lease_target_id', 'lease_agent_generation_epoch', 'lease_expires_at', 'state', 'authority_effect', 'result_summary', 'result_sha256', 'error_code', 'finished_at', 'updated_at'],
  devos_fleet_claim_h205f22: ['claim_id', 'workspace_id', 'task_id', 'agent_id', 'lease_generation', 'base_sha', 'tab_id', 'target_id', 'agent_generation_epoch', 'state', 'expires_at', 'updated_at', 'authority_effect'],
};

async function loadSources() {
  return Promise.all(LOCAL_RUNTIME_MIGRATIONS.map(async (migration) => {
    const source = await readFile(migration.source_url, 'utf8');
    return { ...migration, source, sha256: createHash('sha256').update(source).digest('hex') };
  }));
}

function sourcePlan(sources) {
  const migrations = sources.map(migration => ({ source: migration.path, source_sha256: migration.sha256,
    signature: migration.signature, signatures: [...(migration.signatures || [migration.signature])],
    relations: [...(migration.relations || [])], triggers: [...(migration.triggers || [])] }));
  return { schema: 'compute.local-runtime-migration-plan.v1',
    source_manifest_sha256: createHash('sha256').update(JSON.stringify(migrations)).digest('hex'), migrations };
}

// This hashes disk sources only. A source pin is not an attestation of existing SQL bodies.
export async function loadLocalRuntimeMigrationPlan() { return sourcePlan(await loadSources()); }

async function inspectMigrationObjects(tx, migration) {
  const rows = await tx.unsafe(`SELECT 'function' AS kind, value AS identity,
      pg_catalog.to_regprocedure(value) IS NOT NULL AS installed
    FROM pg_catalog.jsonb_array_elements_text($1::text::jsonb)
    UNION ALL SELECT 'relation', value, EXISTS (SELECT 1 FROM pg_catalog.pg_class c
      WHERE c.oid=pg_catalog.to_regclass(value) AND c.relkind IN ('r','p') AND c.relrowsecurity)
    FROM pg_catalog.jsonb_array_elements_text($2::text::jsonb)
    UNION ALL SELECT 'trigger', value->>'relation' || ':' || (value->>'name'), EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=pg_catalog.to_regclass(value->>'relation')
      AND t.tgname=value->>'name' AND t.tgfoid=pg_catalog.to_regprocedure(value->>'signature')
      AND NOT t.tgisinternal AND t.tgenabled IN ('O','A'))
    FROM pg_catalog.jsonb_array_elements($3::text::jsonb)`,
  [JSON.stringify(migration.signatures || [migration.signature]), JSON.stringify(migration.relations || []), JSON.stringify(migration.triggers || [])]);
  const expected = (migration.signatures || [migration.signature]).length + (migration.relations || []).length + (migration.triggers || []).length;
  if (rows.length !== expected) throw new Error('local_runtime_migration_catalog_invalid:' + migration.path);
  return { complete: rows.every(row => row.installed), present: rows.some(row => row.installed),
    missing: rows.filter(row => !row.installed).map(row => row.kind + ':' + row.identity) };
}

export async function applyLocalRuntimeMigrations({ sql, expectedMigrationSourcesSha256 } = {}) {
  if (typeof sql?.begin !== 'function') throw new Error('local_runtime_migration_connection_required');
  const sources = await loadSources();
  const plan = sourcePlan(sources);
  if (expectedMigrationSourcesSha256 !== undefined && (!/^[a-f0-9]{64}$/.test(expectedMigrationSourcesSha256)
    || expectedMigrationSourcesSha256 !== plan.source_manifest_sha256)) throw new Error('local_runtime_migration_source_pin_mismatch');
  return sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout = '3s'");
    await tx.unsafe("SET LOCAL statement_timeout = '30s'");
    // Serialize installers in this database, including the no-objects-yet case.
    await tx.unsafe("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(current_database() || ':compute.local-runtime-migrations.v1', 0))");
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
      const before = await inspectMigrationObjects(tx, migration);
      if (before.complete) {
        receipts.push({ source: migration.path, source_sha256: migration.sha256, signature: migration.signature,
          signatures: migration.signatures || [migration.signature], status: 'ALREADY_PRESENT_NOT_MODIFIED', existing_bodies_attested: false });
        continue;
      }
      // These migrations create tables/triggers and cannot repair a partially installed owner schema safely.
      if (before.present) throw new Error('local_runtime_migration_partial_install:' + migration.path + ':' + before.missing.join(','));
      await tx.unsafe(migration.source);
      const after = await inspectMigrationObjects(tx, migration);
      if (!after.complete) throw new Error('local_runtime_migration_readback_failed:' + migration.path);
      receipts.push({ source: migration.path, source_sha256: migration.sha256, signature: migration.signature,
        signatures: migration.signatures || [migration.signature], status: 'APPLIED_LOCAL_ONLY', existing_bodies_attested: false });
    }
    return { schema: 'compute.local-runtime-migrations.v1', source_manifest_sha256: plan.source_manifest_sha256,
      migrations: receipts, local_only: true, original_dump_modified: false, existing_bodies_attested: false };
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
