import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { applyLocalRuntimeMigrations, loadLocalRuntimeMigrationPlan } from './local-runtime-migrations.mjs';

test('migration plan pins deployed sources, unbounded defaults and the opt-in own-PG fleet guard', async () => {
  const plan = await loadLocalRuntimeMigrationPlan();
  assert.match(plan.source_manifest_sha256, /^[a-f0-9]{64}$/);
  const mandatorySources = [
    '20260901034000_meta_orchestrator_controller_lease_v1.sql',
    '20260901034500_meta_orchestrator_frontier_leader_fence_v2.sql',
    '20260902183500_devos_live_ambiguity_reconciliation_v3.sql',
    '20260902190500_devos_dispatch_admission_runtime_v2.sql',
    'cognitive-acceptor-direct-api-v1.sql',
    '20261009194157_managed_project_admission_v1.sql',
    '20261010100000_project_continuity_history_v1.sql',
    '20261012130000_project_verifier_reference_transport_v1.sql',
    '20261015123000_project_unbounded_defaults_v1.sql',
  ];
  const sources = plan.migrations.map(row => row.source);
  assert.deepEqual(sources.slice(0, mandatorySources.length), mandatorySources);
  const dispatch = plan.migrations.find(row => row.source === mandatorySources[3]);
  assert.equal(dispatch.upgrade_source, '20260903052200_devos_dispatch_admission_signed_native_v3.sql');
  assert.match(dispatch.upgrade_source_sha256, /^[a-f0-9]{64}$/);
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
    '20261025090000_native_coding_agent_project_tools_v1.sql','20261025100000_native_coding_checkpoint_commit_rotation_v1.sql',
    '20261025110000_native_coding_initial_goal_seed_v1.sql','20261025120000_native_coding_service_heartbeat_admission_v1.sql'];
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
  const seed=plan.migrations.find(row=>row.source===nativeSources[6]);
  assert.equal(seed.signatures.length,7);assert(seed.signatures.every(value=>value.startsWith('destruktion_meta.native_coding_seed_')));
  assert.deepEqual(seed.relations,['destruktion_meta.native_coding_seed_profile_h205f22','destruktion_meta.native_coding_seed_h205f22']);
  assert.deepEqual(seed.triggers.map(row=>row.name),['native_coding_seed_profile_immutable_trg','native_coding_seed_immutable_trg','native_coding_seed_browser_correlation_guard_trg']);
  const service=plan.migrations.find(row=>row.source===nativeSources[7]);
  assert.equal(service.signatures.length,3);assert(service.signatures.every(value=>value.startsWith('destruktion_meta.native_coding_service_')));
  assert.deepEqual(service.relations,['destruktion_meta.native_coding_service_heartbeat_h205f22']);
  assert(!service.signatures.some(value=>value.includes('native_coding_claim_admission_v1')||value.includes('native_coding_worktree_admissible_v1')),
    'existing gate replacements are not new-install markers');
  const upgrade=plan.migrations[mandatorySources.length+nativeSources.length];
  assert.equal(upgrade.source,'native-agent-count-unbounded-v2.sql');
  assert.deepEqual(upgrade.signatures,['destruktion_meta.native_agent_count_unbounded_v2()']);
  const running = plan.migrations[mandatorySources.length+nativeSources.length+1];
  assert.equal(running.source,'native-coding-running-agent-scope-v1.sql');
  assert.deepEqual(running.signatures,['destruktion_meta.native_coding_running_critic_admissible_v1(uuid,uuid)',
    'destruktion_meta.native_coding_agent_context_v1(uuid)']);
  const chat=plan.migrations[mandatorySources.length+nativeSources.length+2];
  assert.equal(chat.source,'native-coding-chat-coordination-v1.sql');
  assert.deepEqual(chat.signatures,['destruktion_meta.native_coding_chat_child_permit_v1(uuid,uuid,text)']);
  const extras = plan.migrations.slice(mandatorySources.length+nativeSources.length+3);
  // The W5 DAG guard is an optional source-only integration lane and must
  // never be admitted as an arbitrary migration or silently become installed.
  assert.equal(extras.length, 8, 'every extra migration requires an explicit contract');
  {
    const [guard] = extras;
    assert.equal(guard.source, 'fleet-coordination-claim-guard-v1.sql');
    assert.deepEqual(guard.signatures, ['destruktion_meta.fleet_coordination_claim_gate_v1()']);
    assert.equal(guard.triggers.length, 1);
    assert.equal(guard.triggers[0].name, 'zz_fleet_coordination_claim_gate_v1');
  }
  assert.equal(extras[2].source,'native-coding-review-observation-v1.sql');
  assert.equal(extras[3].source,'native-coding-chat-messages-v1.sql');
  assert.equal(extras[4].source,'browser-project-messages-v1.sql');
  assert.equal(extras[5].source,'project-message-ack-v1.sql');
  assert.equal(extras[6].source,'project-message-wake-v1.sql');
  const repair=extras[7];assert.equal(repair.source,'native-coding-repair-v1.sql');
  assert.equal(repair.signatures.length,5);
  assert.deepEqual(repair.relations,['destruktion_meta.native_coding_repair_h205f22']);
  assert.equal(repair.triggers[0].name,'native_coding_repair_immutable_trg');
  assert(!repair.signatures.some(value=>value.includes('project_completion_ready_h205f22(')),
    'replaced canonical consumers are not new-install markers');
  const suspension=extras[1];
  assert.equal(suspension.source,'20261026020000_browser_parent_suspension_v1.sql');
  assert.equal(suspension.signatures.length,9);
  assert.equal(suspension.signatures.filter(value=>value.startsWith('public.')).length,5);
  assert.deepEqual(suspension.relations,['destruktion_meta.browser_parent_suspension_h205f22','destruktion_meta.browser_child_retirement_h205f22']);
  assert.deepEqual(suspension.triggers.map(row=>row.name),['browser_parent_reserved_claim_trg','browser_child_retirement_immutable_trg']);
  assert(!suspension.signatures.some(value=>value.includes('devos_fleet_lease_v1(')||value.includes('project_task_projection_h205f22(')),
    'pre-existing replacement signatures must not make first suspension installation look partial');
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

test('direct Cognitive admission elevates only the exact canonical bounded body and never grants cursor or role privileges', async () => {
  const sql = await readFile(new URL('./cognitive-acceptor-direct-api-v1.sql', import.meta.url), 'utf8');
  const source = (await readFile(new URL('../../supabase/migrations/20261007063940_cognitive_durable_latest_batch_v1.sql', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const delimiter = 'AS $function$', from = source.indexOf(delimiter) + delimiter.length;
  const body = source.slice(from, source.indexOf('$function$;', from));
  assert(sql.includes(createHash('sha256').update(body).digest('hex')));
  assert.match(sql, /existing_body_requires_review/); assert.match(sql, /table_owner_requires_review/);
  assert.match(sql, /public_execution_requires_review/); assert.match(sql, /security definer/i);
  assert(!/\b(?:grant|revoke|create\s+role|alter\s+role)\b/i.test(sql));
});

test('migration catalog skip requires every required object and separately attests the browser dispatch prerequisite', async () => {
  const required = {
    devos_fleet_task_h205f22: 'task_id workspace_id point_id role base_sha lease_generation lease_agent_id lease_tab_id lease_target_id lease_agent_generation_epoch lease_expires_at state authority_effect result_summary result_sha256 error_code finished_at updated_at',
    devos_fleet_claim_h205f22: 'claim_id workspace_id task_id agent_id lease_generation base_sha tab_id target_id agent_generation_epoch state expires_at updated_at authority_effect',
  };
  const columns = Object.entries(required).flatMap(([table_name, names]) => names.split(' ').map(column_name => ({ table_name, column_name, udt_name: column_name === 'claim_id' ? 'int8' : 'text' })));
  const statements = [];
  const dispatchRows = await dispatchFixture();
  const tx = { unsafe: async (query, values) => {
    statements.push(query);
    if (query.includes('information_schema.columns')) return columns;
    if (query.includes(' AS frontier')) return [{ frontier: true, event: true, supervisor: true }];
    if (query.includes('p.prosrc AS body')) return dispatchRows.functions;
    if (query.includes('pg_get_triggerdef')) return [{ definition: dispatchRows.trigger }];
    if (query.includes('p.prosecdef AS definer')) return [{ definer: true }];
    if (query.includes("'function' AS kind")) return values.flatMap((value, index) => JSON.parse(value).map(identity => ({ identity, kind: ['function', 'relation', 'trigger'][index], installed: true })));
    return [];
  } };
  const receipt = await applyLocalRuntimeMigrations({ sql: { begin: run => run(tx) } });
  assert(receipt.migrations.every(row => row.status === 'ALREADY_PRESENT_NOT_MODIFIED'));
  assert(receipt.migrations.every(row => row.existing_bodies_attested === (row.browser_dispatch_version === 3 || row.cognitive_acceptor_direct_api === true || row.source==='native-agent-count-unbounded-v2.sql' || row.running_agent_scope_separate_from_admission===true || row.chat_coordination_opt_in===true || row.native_review_observation_only===true || row.chat_message_recipient_scope===true || row.native_repair_lineage_preserved===true)));
  assert.equal(receipt.existing_bodies_attested, false);
  assert(statements.some(query => query.includes('pg_advisory_xact_lock')));
  assert(!statements.some(query => !query.startsWith('-- Reviewed local upgrade.') && !query.startsWith('-- Additive local upgrade: active CRITIC authorization') && !query.startsWith('-- Additive local upgrade: protected chat-led coordination') && !query.startsWith('-- Additive local upgrade: report bound native CRITIC') && !query.startsWith('-- Additive local upgrade: native messages') && !query.startsWith('-- Addressed chat-to-project messages') && !query.startsWith('-- Reviewed addressed-message acknowledgements.') && !query.startsWith('-- Reviewed message-driven parent wake,') && !query.startsWith('-- Reviewed rejected-result repair:') && /^create /im.test(query)));
});

async function dispatchFixture(version = 3) {
  const read = file => readFile(new URL('../../supabase/migrations/' + file, import.meta.url), 'utf8');
  const v2 = await read('20260902190500_devos_dispatch_admission_runtime_v2.sql');
  const v3 = await read('20260903052200_devos_dispatch_admission_signed_native_v3.sql');
  const body = (source, name) => {
    const start = source.indexOf('create or replace function destruktion_meta.' + name + '(');
    const from = source.indexOf('as $$', start) + 5;
    return source.slice(from, source.indexOf('$$;', from)).replace(/\r\n/g, '\n');
  };
  const normalize = 'devos_normalize_native_supervisor_state_h205f22', gate = 'devos_fleet_claim_transport_admission_h205f22';
  return { v2, v3, functions: [
    { oid: '10', name: normalize, body: body(v2, normalize), language: 'plpgsql', definer: false, volatility: 'i', config: ['search_path=pg_catalog'], result: 'jsonb' },
    { oid: '11', name: gate, body: body(version === 2 ? v2 : v3, gate), language: 'plpgsql', definer: true, volatility: 'v', config: ['search_path=pg_catalog, public, destruktion_meta'], result: 'trigger' },
  ], trigger: 'CREATE TRIGGER devos_fleet_claim_transport_admission_trg BEFORE INSERT ON destruktion_meta.devos_fleet_claim_h205f22 FOR EACH ROW EXECUTE FUNCTION destruktion_meta.devos_fleet_claim_transport_admission_h205f22()' };
}

async function dispatchUpgradeHarness({ version = 3, absent = false, partial = false, occupiedTrigger = false, unknownBody = false, unknownTrigger = false } = {}) {
  let state = await dispatchFixture(version);
  if (unknownBody) state.functions[1].body = 'begin return new; end;';
  if (unknownTrigger) state.trigger = state.trigger.replace('BEFORE INSERT', 'AFTER INSERT');
  let dispatchInstalled = !absent;
  const ddl = [];
  const columns = {
    devos_fleet_task_h205f22: 'task_id workspace_id point_id role base_sha lease_generation lease_agent_id lease_tab_id lease_target_id lease_agent_generation_epoch lease_expires_at state authority_effect result_summary result_sha256 error_code finished_at updated_at',
    devos_fleet_claim_h205f22: 'claim_id workspace_id task_id agent_id lease_generation base_sha tab_id target_id agent_generation_epoch state expires_at updated_at authority_effect',
  };
  const tx = { unsafe: async (query, values) => {
    if (query.includes('information_schema.columns')) return Object.entries(columns).flatMap(([table_name, names]) => names.split(' ').map(column_name => ({ table_name, column_name, udt_name: column_name === 'claim_id' ? 'int8' : 'text' })));
    if (query.includes(' AS frontier')) return [{ frontier: true, event: true, supervisor: true }];
    if (query.includes('p.prosrc AS body')) return state.functions;
    if (query.includes('pg_get_triggerdef')) return [{ definition: state.trigger }];
    if (query.includes('p.prosecdef AS definer')) return [{ definer: true }];
    if (query.includes("'function' AS kind")) {
      const dispatch = JSON.parse(values[0]).includes('destruktion_meta.devos_fleet_claim_transport_admission_h205f22()');
      return values.flatMap((value, group) => JSON.parse(value).map((identity, index) => ({ identity, kind: ['function', 'relation', 'trigger'][group],
        installed: !dispatch || (dispatchInstalled && !(partial && group === 0 && index === 0)),
        occupied: !dispatch || dispatchInstalled || (occupiedTrigger && group === 2) })));
    }
    if (query === state.v2 || query === state.v3) { ddl.push(query); dispatchInstalled = true; if (query === state.v3) state = await dispatchFixture(3); }
    return [];
  } };
  return { ddl, run: () => applyLocalRuntimeMigrations({ sql: { begin: run => run(tx) } }) };
}

test('missing browser gate installs v2 and signed v3 before native admission; v2 upgrades and v3 never downgrades', async () => {
  for (const options of [{ absent: true }, { version: 2 }, { version: 3 }]) {
    const f = await dispatchUpgradeHarness(options), receipt = await f.run();
    assert.equal(f.ddl.length, options.absent ? 2 : options.version === 2 ? 1 : 0);
    const gate = receipt.migrations.find(row => row.browser_dispatch_version === 3);
    assert.equal(gate.existing_bodies_attested, true);
    assert.equal(gate.status, options.absent ? 'APPLIED_LOCAL_ONLY' : options.version === 2 ? 'UPGRADED_REVIEWED_V2_TO_V3' : 'ALREADY_PRESENT_NOT_MODIFIED');
  }
});

test('partial browser gate, occupied wrong trigger, unknown function and altered trigger stop without repair DDL', async () => {
  for (const options of [{ partial: true }, { absent: true, occupiedTrigger: true }, { unknownBody: true }, { unknownTrigger: true }]) {
    const f = await dispatchUpgradeHarness(options);
    await assert.rejects(f.run(), /partial_install|existing_(body|trigger)_requires_review/);
    assert.equal(f.ddl.length, 0);
  }
});
