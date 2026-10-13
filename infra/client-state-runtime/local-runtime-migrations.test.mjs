import assert from 'node:assert/strict';
import test from 'node:test';
import { applyLocalRuntimeMigrations, loadLocalRuntimeMigrationPlan } from './local-runtime-migrations.mjs';

test('migration plan pins the six deployed sources and recognizes only the opt-in own-PG fleet guard', async () => {
  const plan = await loadLocalRuntimeMigrationPlan();
  assert.match(plan.source_manifest_sha256, /^[a-f0-9]{64}$/);
  const mandatorySources = [
    '20260901034000_meta_orchestrator_controller_lease_v1.sql',
    '20260901034500_meta_orchestrator_frontier_leader_fence_v2.sql',
    '20260902183500_devos_live_ambiguity_reconciliation_v3.sql',
    '20261009194157_managed_project_admission_v1.sql',
    '20261010100000_project_continuity_history_v1.sql',
    '20261012130000_project_verifier_reference_transport_v1.sql',
  ];
  const sources = plan.migrations.map(row => row.source);
  assert.deepEqual(sources.slice(0, mandatorySources.length), mandatorySources);
  assert.equal(new Set(sources).size, sources.length, 'duplicate migration paths are forbidden');
  const project = plan.migrations.find(row => row.source === '20261010100000_project_continuity_history_v1.sql');
  assert(project);
  assert.equal(project.signatures.filter(value => value.startsWith('public.')).length, 7);
  assert.equal(project.relations.length, 4);
  assert.equal(project.triggers.length, 3);
  const verifier = plan.migrations.find(row => row.source === mandatorySources.at(-1));
  assert(verifier);
  assert.deepEqual(verifier.signatures,
    ['destruktion_meta.project_verifier_reference_transport_h205f22()']);
  const extras = plan.migrations.slice(mandatorySources.length);
  // The W5 DAG guard is an optional source-only integration lane and must
  // never be admitted as an arbitrary migration or silently become installed.
  assert(extras.length <= 1, 'unrecognized extra migration requires an explicit contract');
  if (extras.length === 1) {
    const [guard] = extras;
    assert.equal(guard.source, 'fleet-coordination-claim-guard-v1.sql');
    assert.deepEqual(guard.signatures, ['destruktion_meta.fleet_coordination_claim_gate_v1()']);
    assert.equal(guard.triggers.length, 1);
    assert.equal(guard.triggers[0].name, 'zz_fleet_coordination_claim_gate_v1');
  }
  for (const row of plan.migrations) {
    assert.match(row.source_sha256, /^[a-f0-9]{64}$/);
    assert(row.signatures.length >= 1);
  }
  assert.deepEqual(await loadLocalRuntimeMigrationPlan(), plan);
});

test('mismatched source pin rejects before opening a database transaction', async () => {
  let opened = 0;
  const sql = { begin: () => { opened++; throw new Error('must_not_open'); } };
  for (const expectedMigrationSourcesSha256 of ['bad', '0'.repeat(64), null]) {
    await assert.rejects(applyLocalRuntimeMigrations({ sql, expectedMigrationSourcesSha256 }), /migration_source_pin_mismatch/);
  }
  assert.equal(opened, 0);
});

test('migration catalog skip requires every required object and labels existing bodies unattested', async () => {
  const required = {
    devos_fleet_task_h205f22: 'task_id workspace_id point_id role base_sha lease_generation lease_agent_id lease_tab_id lease_target_id lease_agent_generation_epoch lease_expires_at state authority_effect result_summary result_sha256 error_code finished_at updated_at',
    devos_fleet_claim_h205f22: 'claim_id workspace_id task_id agent_id lease_generation base_sha tab_id target_id agent_generation_epoch state expires_at updated_at authority_effect',
  };
  const columns = Object.entries(required).flatMap(([table_name, names]) => names.split(' ').map(column_name => ({ table_name, column_name, udt_name: column_name === 'claim_id' ? 'int8' : 'text' })));
  const statements = [];
  const tx = { unsafe: async (query, values) => {
    statements.push(query);
    if (query.includes('information_schema.columns')) return columns;
    if (query.includes(' AS frontier')) return [{ frontier: true, event: true, supervisor: true }];
    if (query.includes("'function' AS kind")) return values.flatMap((value, index) => JSON.parse(value).map(identity => ({ identity, kind: ['function', 'relation', 'trigger'][index], installed: true })));
    return [];
  } };
  const receipt = await applyLocalRuntimeMigrations({ sql: { begin: run => run(tx) } });
  assert(receipt.migrations.every(row => row.status === 'ALREADY_PRESENT_NOT_MODIFIED' && row.existing_bodies_attested === false));
  assert.equal(receipt.existing_bodies_attested, false);
  assert(statements.some(query => query.includes('pg_advisory_xact_lock')));
  assert(!statements.some(query => /^create /im.test(query)));
});
