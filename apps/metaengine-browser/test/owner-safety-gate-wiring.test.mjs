import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OwnerSafetyGateRegistry, bindGlobalOwnerSafetyGateRegistry } from '../src/owner-safety-gate-registry.mjs';
import { confirmSelfUpdateRestartSafety } from '../src/self-update-restart-safety.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const repoRoot = path.resolve(root, '../..');

function memoryRegistry() {
  let state = null;
  const registry = new OwnerSafetyGateRegistry({
    loadState: async () => state,
    saveState: async (value) => { state = structuredClone(value); },
    clock: () => Date.parse('2026-08-30T08:30:00.000Z'),
  });
  return registry;
}

test('owner wildcard bypass reaches registered self-update restart gate', async () => {
  const gates = memoryRegistry();
  await gates.init();
  bindGlobalOwnerSafetyGateRegistry(gates);
  const blocked = await confirmSelfUpdateRestartSafety({ getState: async () => ({ downloads: { active: { id: 'download' } } }) });
  assert.equal(blocked, false);
  await gates.disable({ gate_id: '*', reason: 'OWNER_BREAK_GLASS_TEST', override_id: 'owner.override.wildcard1' });
  const allowed = await confirmSelfUpdateRestartSafety({ getState: async () => ({ downloads: { active: { id: 'download' } } }) });
  assert.equal(allowed, true);
});

test('Browser runtime exposes typed gate command surface and durable readback', () => {
  const main = fs.readFileSync(path.join(root, 'src', 'main.mjs'), 'utf8');
  for (const action of ['GATE_STATUS','GATE_DISABLE','GATE_DISABLE_ALL','GATE_ENABLE','GATE_ENABLE_ALL']) {
    assert.match(main, new RegExp(`'${action}'`));
  }
  assert.match(main, /metaengine-owner-safety-gates-v1\.json/);
  assert.match(main, /owner_safety_gates:/);
  assert.match(main, /bindGlobalOwnerSafetyGateRegistry\(ownerSafetyGates\)/);
});

test('fleet ambiguous compensating fanout remains explicitly owner-gated while wrapper handles no-effect capacity backpressure', () => {
  const wrapper = fs.readFileSync(path.join(root, 'src', 'fleet-provisioner.mjs'), 'utf8');
  const core = fs.readFileSync(path.join(root, 'src', 'fleet-provisioner-core.mjs'), 'utf8');
  assert.match(wrapper, /extends CoreFleetProvisioner/);
  assert.match(wrapper, /registerFleetRuntime\(this\)/);

  // The wrapper may reconcile deterministic tab-capacity backpressure, but it owns
  // no owner-gate lookup and therefore cannot mint break-glass authority itself.
  assert.match(wrapper, /async reconcile\s*\(/);
  assert.match(wrapper, /CAPACITY_AMBIGUITY_PREFIX\s*=\s*'CREATE_TAB_AMBIGUOUS:tab_capacity_exceeded'/);
  assert.match(wrapper, /automatic_retry_allowed:\s*false/);
  assert.doesNotMatch(wrapper, /globalOwnerGateDisabled/);
  assert.doesNotMatch(wrapper, /fleet\.ambiguous_compensating_fanout/);

  // Extra wrapper fields are discarded by the core's explicit destructuring
  // boundary. The only compensating-fanout authority remains the signed owner
  // safety-gate registry lookup inside core.
  assert.match(core, /async reconcile\s*\(\{\s*active\s*=\s*false,\s*target_agents\s*=\s*null,\s*spawn_burst_limit\s*=\s*null\s*\}\s*=\s*\{\}\)/);
  assert.match(core, /globalOwnerGateDisabled\('fleet\.ambiguous_compensating_fanout'\)/);
  assert.match(core, /PROVISIONING_AMBIGUOUS/);
});

test('server contract gives owner gate lane zero budget cost and emergency bypass', () => {
  const migration = fs.readFileSync(path.join(repoRoot, 'supabase', 'migrations', '20260830083000_owner_safety_gate_control_v1.sql'), 'utf8');
  assert.match(migration, /GATE_DISABLE_ALL/);
  assert.match(migration, /GATE_ENABLE_ALL/);
  assert.match(migration, /v_emergency := v_row\.action in \('DISARM','GATE_DISABLE','GATE_DISABLE_ALL','GATE_ENABLE','GATE_ENABLE_ALL'\)/);
  assert.match(migration, /when action in \('POLL','CAPTURE','DOWNLOAD_STATUS','SELF_UPDATE_STATUS','DISARM','GATE_STATUS','GATE_DISABLE','GATE_DISABLE_ALL','GATE_ENABLE','GATE_ENABLE_ALL'\) then 0/);
  assert.match(migration, /grant execute on function public\.h205f22_a2_browser_supervisor_issue_native_v2/);
  assert.match(migration, /to service_role/);
});

test('owner policy lane remains separate from Browser actuation singleflight', () => {
  const migration = fs.readFileSync(path.join(repoRoot, 'supabase', 'migrations', '20260830083000_owner_safety_gate_control_v1.sql'), 'utf8');
  const predicate = migration.match(/create unique index a2_browser_supervisor_one_mutating_inflight_uq[\s\S]*?;\r?\n/)?.[0] || '';
  assert.match(predicate, /GATE_STATUS/);
  assert.match(predicate, /GATE_DISABLE/);
  assert.match(predicate, /GATE_ENABLE/);
  assert.match(predicate, /SELF_UPDATE_STATUS/);
});
