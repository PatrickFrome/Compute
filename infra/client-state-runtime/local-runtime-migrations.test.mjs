import assert from 'node:assert/strict';
import test from 'node:test';
import { applyLocalRuntimeMigrations, loadLocalRuntimeMigrationPlan } from './local-runtime-migrations.mjs';

test('migration plan pins deployed sources, unbounded defaults and the opt-in own-PG fleet guard', async () => {
  const plan = await loadLocalRuntimeMigrationPlan();
  assert.match(plan.source_manifest_sha256, /^[a-f0-9]{64}$/);
  const mandatorySources = [
    '20260901034000_meta_orchestrator_controller_lease_v1.sql',
    '20260901034500_meta_orchestrator_frontier_leader_fence_v2.sql',
    '20260902183500_devos_live_ambiguity_reconciliation_v3.sql',
    '20261009194157_managed_project_admission_v1.sql',
    '20261010100000_project_continuity_history_v1.sql',
    '20261012130000_project_verifier_reference_transport_v1.sql',
    '20261015123000_project_unbounded_defaults_v1.sql',
  ];
  const sources = plan.migrations.map(row => row.source);
  assert.deepEqual(sources.slice(0, mandatorySources.length), mandatorySources);
  assert.equal(new Set(sources).size, sources.length, 'duplicate migration paths are forbidden');
  const project = plan.migrations.find(row => row.source === '20261010100000_project_continuity_history_v1.sql');
  assert(project);
  assert.equal(project.signatures.filter(value => value.startsWith('public.')).length, 7);
  assert.equal(project.relations.length, 4);
  assert.equal(project.triggers.length, 3);
  const verifier = plan.migrations.find(row => row.source === '20261012130000_project_verifier_reference_transport_v1.sql');
  assert(verifier);
  assert.deepEqual(verifier.signatures,
    ['destruktion_meta.project_verifier_reference_transport_h205f22()']);
  const unbounded = plan.migrations.find(row => row.source === mandatorySources.at(-1));
  assert.deepEqual(unbounded.signatures, ['destruktion_meta.project_unbounded_defaults_h205f22()']);
  const nativeSources=['20261022070000_native_coding_execution_ledger_v1.sql','20261023082533_native_coding_operator_qa_admission_v1.sql',
    '20261025070000_native_coding_project_continuation_v1.sql','20261025080000_native_coding_worktree_lease_admission_v1.sql',
    '20261025090000_native_coding_agent_project_tools_v1.sql','20261025100000_native_coding_checkpoint_commit_rotation_v1.sql'];
  assert.deepEqual(sources.slice(mandatorySources.length,mandatorySources.length+nativeSources.length),nativeSources);
  const ledger=plan.migrations.find(row=>row.source===nativeSources[0]),admission=plan.migrations.find(row=>row.source===nativeSources[1]);
  assert.equal(ledger.signatures.length,3);assert(ledger.signatures.every(value=>value.startsWith('destruktion_meta.')));
  assert.equal(ledger.relations.length,1);assert.equal(admission.relations.length,3);
  assert.equal(admission.signatures.filter(value=>value.startsWith('public.')).length,2);
  assert.deepEqual(admission.triggers.map(row=>row.name),['native_coding_claim_admission_trg','native_coding_task_transition_guard_trg']);
  const checkpoint=plan.migrations.find(row=>row.source===nativeSources[2]);
  assert.equal(checkpoint.relations.length,2);assert.equal(checkpoint.signatures.length,7);
  assert(checkpoint.signatures.every(value=>value.startsWith('destruktion_meta.')));
  assert.deepEqual(checkpoint.triggers.map(row=>row.name),['native_coding_execution_worktree_fence_trg']);
  assert.deepEqual(plan.migrations.find(row=>row.source===nativeSources[3]).signatures,
    ['destruktion_meta.native_coding_worktree_admissible_v1(uuid,uuid)']);
  const agentTools=plan.migrations.find(row=>row.source===nativeSources[4]);
  assert.equal(agentTools.signatures.length,10);
  assert(agentTools.signatures.every(value=>value.startsWith('destruktion_meta.native_coding_agent_')));
  assert.deepEqual(agentTools.relations,['destruktion_meta.native_coding_agent_intent_h205f22','destruktion_meta.native_coding_agent_intent_alias_h205f22']);
  assert.deepEqual(agentTools.triggers.map(row=>row.name),['native_coding_agent_intent_immutable_trg','native_coding_agent_alias_immutable_trg']);
  assert(!agentTools.signatures.some(value=>value.includes('project_parent_h205f22')||value.includes('h205f22_project_spawn_v1')),
    'pre-existing replacement signatures must not make the new migration look partially installed');
  const commit=plan.migrations.find(row=>row.source===nativeSources[5]);
  assert.equal(commit.signatures.length,6);assert(commit.signatures.every(value=>value.startsWith('destruktion_meta.native_coding_')));
  assert.deepEqual(commit.relations,['destruktion_meta.native_coding_commit_h205f22']);
  assert.deepEqual(commit.triggers.map(row=>row.name),['native_coding_commit_immutable_trg']);
  assert(!commit.signatures.some(value=>value.includes('h205f22_project_reconcile_v1')));
  const extras = plan.migrations.slice(mandatorySources.length+nativeSources.length);
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
