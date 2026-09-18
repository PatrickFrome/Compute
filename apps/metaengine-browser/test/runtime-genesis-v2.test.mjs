import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ensureRuntimeGenesis,
  RUNTIME_GENESIS_GENERATION,
  RUNTIME_GENESIS_MARKER,
  RUNTIME_GENESIS_PRESERVED,
  RUNTIME_GENESIS_RESET_FILES,
} from '../src/runtime-genesis.mjs';

async function writeJson(root, name, value) {
  await fs.writeFile(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

test('clean genesis v2 removes stale local fleet and supervisor topology while preserving identity', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-genesis-v2-'));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));

  await writeJson(root, RUNTIME_GENESIS_MARKER, {
    schema: 'metaengine.browser.runtime-genesis.v1',
    generation: 'DEVOS_CLEAN_GENESIS_V1',
    clean_start: true,
    initial_tabs: 0,
    initial_fleet_agents: 0,
  });
  await writeJson(root, 'metaengine-fleet-state-v2.json', {
    schema: 'metaengine.browser.fleet-state.v1',
    agents: [{ agent_id: 'agent_stale0001', lifecycle_state: 'ACTIVE', tab_id: 'old-tab' }],
  });
  await writeJson(root, 'metaengine-supervisor-keepalive-v1.json', {
    schema: 'metaengine.supervisor-keepalive.state.v1',
    supervisor_id: 'METAENGINE_SUPERVISOR',
    state: 'WAKE_AMBIGUOUS',
    pending_wake: { wake_id: 'wake_stale', automatic_retry_allowed: false },
  });
  await writeJson(root, 'metaengine-supervisor-mesh-v2.json', {
    schema: 'metaengine.supervisor-mesh.state.v2',
    supervisors: [{ supervisor_id: 'old-supervisor', status: 'ACTIVE' }],
  });
  await writeJson(root, 'metaengine-devos-session-layout-registry-v1.json', { stale: true });
  await writeJson(root, 'metaengine-owner-safety-gates-v1.json', { stale: true });
  await writeJson(root, 'metaengine-self-update-session-continuity-v1.json', { stale: true });
  await writeJson(root, 'metaengine-native-supervisor-control-state-v1.json', {
    schema: 'metaengine.native-supervisor.control-state.v1',
    supervisor_mode: 'MONITOR',
    armed: false,
  });
  await writeJson(root, 'metaengine-native-supervisor-device-v1.json', {
    schema: 'test.device.identity',
    device_id: 'preserve-me',
  });

  assert.equal(RUNTIME_GENESIS_GENERATION, 'DEVOS_CLEAN_GENESIS_V2');
  assert.ok(RUNTIME_GENESIS_RESET_FILES.includes('metaengine-fleet-state-v2.json'));
  assert.ok(RUNTIME_GENESIS_RESET_FILES.includes('metaengine-supervisor-keepalive-v1.json'));
  assert.ok(RUNTIME_GENESIS_RESET_FILES.includes('metaengine-supervisor-mesh-v2.json'));
  assert.ok(RUNTIME_GENESIS_PRESERVED.includes('metaengine-native-supervisor-device-v1.json'));
  assert.ok(!RUNTIME_GENESIS_RESET_FILES.includes('metaengine-native-supervisor-device-v1.json'));

  const result = await ensureRuntimeGenesis({
    userDataPath: root,
    now: '2026-09-13T20:00:00.000Z',
  });

  assert.equal(result.applied, true);
  assert.equal(result.reason, 'GENERATION_RESET_APPLIED');
  assert.equal(result.clean_start, true);
  assert.equal(result.initial_tabs, 0);
  assert.equal(result.initial_fleet_agents, 0);
  assert.equal(result.stale_supervisor_keepalive_restored, false);
  assert.equal(result.stale_supervisor_mesh_restored, false);
  assert.equal(result.automatic_actuation_after_genesis, false);
  assert.ok(result.quarantined_files.includes('metaengine-fleet-state-v2.json'));
  assert.ok(result.quarantined_files.includes('metaengine-supervisor-keepalive-v1.json'));
  assert.ok(result.quarantined_files.includes('metaengine-supervisor-mesh-v2.json'));

  assert.equal(await exists(path.join(root, 'metaengine-fleet-state-v2.json')), false);
  assert.equal(await exists(path.join(root, 'metaengine-supervisor-keepalive-v1.json')), false);
  assert.equal(await exists(path.join(root, 'metaengine-supervisor-mesh-v2.json')), false);

  const device = JSON.parse(await fs.readFile(path.join(root, 'metaengine-native-supervisor-device-v1.json'), 'utf8'));
  assert.equal(device.device_id, 'preserve-me');

  const control = JSON.parse(await fs.readFile(path.join(root, 'metaengine-native-supervisor-control-state-v1.json'), 'utf8'));
  assert.equal(control.schema, 'metaengine.native-supervisor.control-state.v1');
  assert.equal(control.supervisor_mode, 'CONTROL');
  assert.equal(control.armed, true);

  const marker = JSON.parse(await fs.readFile(path.join(root, RUNTIME_GENESIS_MARKER), 'utf8'));
  assert.equal(marker.generation, 'DEVOS_CLEAN_GENESIS_V2');
  assert.equal(marker.stale_tab_topology_restored, false);
  assert.equal(marker.stale_fleet_intent_restored, false);
  assert.equal(marker.stale_supervisor_keepalive_restored, false);
  assert.equal(marker.stale_supervisor_mesh_restored, false);
  assert.equal(marker.preserves_browser_auth_session, true);
  assert.equal(marker.preserves_supervisor_device_identity, true);

  const second = await ensureRuntimeGenesis({
    userDataPath: root,
    now: '2026-09-13T20:01:00.000Z',
  });
  assert.equal(second.applied, false);
  assert.equal(second.reason, 'ALREADY_APPLIED');
  assert.equal(second.generation, 'DEVOS_CLEAN_GENESIS_V2');
  assert.equal(second.stale_supervisor_keepalive_restored, false);
  assert.equal(second.stale_supervisor_mesh_restored, false);

  const deviceAfterSecondStart = JSON.parse(await fs.readFile(path.join(root, 'metaengine-native-supervisor-device-v1.json'), 'utf8'));
  assert.deepEqual(deviceAfterSecondStart, device);
});
