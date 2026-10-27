import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadLocalRuntimeMigrationPlan } from './local-runtime-migrations.mjs';

// An inventory of a tested candidate, NOT authorization to replay historical SQL.
// No caller may infer enrollment, readiness or production qualification from it.
export const FRESH_SCHEMA_CANDIDATE_RESOURCE = new URL('./fresh-schema-candidate-plan.json', import.meta.url);
const root = new URL('../../', import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function loadFreshSchemaCandidatePlan() {
  const bytes = await readFile(FRESH_SCHEMA_CANDIDATE_RESOURCE);
  const candidate = JSON.parse(bytes);
  for (const entry of [...candidate.baseline, ...candidate.upgrades]) {
    if (!/^(supabase\/migrations|infra\/client-state-runtime)\/[a-zA-Z0-9_-]+\.sql$/.test(entry.path)
      || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('fresh_schema_invalid_resource');
    if (digest(await readFile(new URL(entry.path, root))) !== entry.sha256)
      throw new Error(`fresh_schema_source_pin_mismatch:${entry.path}`);
  }
  const upgrades = await loadLocalRuntimeMigrationPlan();
  const actual = upgrades.migrations.flatMap(m => [
    { path: m.source, sha256: m.source_sha256 },
    ...(m.upgrade_source ? [{ path: m.upgrade_source, sha256: m.upgrade_source_sha256 }] : []),
  ]);
  const expected = candidate.upgrades.map(m => ({ path: m.path.split('/').at(-1), sha256: m.sha256 }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('fresh_schema_upgrade_plan_changed');
  return { ...candidate, candidate_sha256: digest(bytes),
    upgrade_sources_sha256: upgrades.source_manifest_sha256,
    status: 'BLOCKED_PENDING_BASELINE_REVIEW', production_qualified: false,
    authority_effect: false, automatic_population_required: true, atomic_baseline: false };
}

// Include types as well as functions/relations: even an empty table, partial
// function-only install or orphan application enum means this is NOT fresh.
// Extension-owned objects (e.g. pgcrypto) are prerequisites, not application data.
export const FRESH_SCHEMA_OCCUPANCY_QUERY = `
SELECT n.nspname AS schema_name, c.relname AS object_name, 'relation' AS kind
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','destruktion_meta','vault')
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
UNION ALL
SELECT n.nspname, p.proname, 'function'
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','destruktion_meta','vault')
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
UNION ALL
SELECT n.nspname, t.typname, 'type'
FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
WHERE n.nspname IN ('public','destruktion_meta','vault')
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_type'::regclass AND d.objid=t.oid AND d.deptype='e')`;

export async function inspectFreshSchemaCandidate({ sql, expectedCandidateSha256 } = {}) {
  const plan = await loadFreshSchemaCandidatePlan();
  if (expectedCandidateSha256 !== undefined && expectedCandidateSha256 !== plan.candidate_sha256)
    throw new Error('fresh_schema_candidate_pin_mismatch');
  if (typeof sql?.begin !== 'function') throw new Error('fresh_schema_transaction_required');
  return sql.begin(async tx => {
    await tx.unsafe("SET LOCAL lock_timeout = '3s'");
    await tx.unsafe("SET LOCAL statement_timeout = '30s'");
    // Same database-scoped key as the current upgrade runner; no DDL is applied.
    await tx.unsafe("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(current_database() || ':compute.local-runtime-migrations.v1', 0))");
    const occupied = await tx.unsafe(FRESH_SCHEMA_OCCUPANCY_QUERY);
    return { ...plan, status: occupied.length ? 'REFUSED_NONEMPTY_APPLICATION_SCHEMA' : plan.status,
      empty_application_schema: occupied.length === 0, occupied,
      schema_applied: false, application_rows_seeded: false,
      blockers: ['REVIEW_CANONICAL_BASELINE_AND_LEGACY_DEPENDENCIES',
        'REVIEW_TRANSACTION_FREE_BASELINE_RESOURCE',
        'REVIEW_FRESH_ONLY_PUBLIC_EXECUTE_ACL', 'NATIVE_PG17_QUALIFICATION',
        'GENUINE_OWNER_ENROLLMENT_AND_GOAL_POPULATION'] };
  });
}
