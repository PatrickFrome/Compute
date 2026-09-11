import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ensureRuntimeGenesis,
  RUNTIME_GENESIS_GENERATION,
  RUNTIME_GENESIS_MARKER,
  RUNTIME_GENESIS_RESET_FILES,
} from '../src/runtime-genesis.mjs';

async function exists(target) {
  try { await fs.access(target); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

test('clean genesis quarantines stale runtime topology while preserving always-on authority and auth identity', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-clean-genesis-'));
  try {
    for (const relative of RUNTIME_GENESIS_RESET_FILES) {
      await fs.writeFile(path.join(root, relative), JSON.stringify({ stale: true }));
    }
    await fs.writeFile(path.join(root, 'metaengine-native-supervisor-device-v1.json'), '{"identity":"keep"}\n');
    const persistentSessionRoot = path.join(root, 'chromium-persistent-user-session');
    await fs.mkdir(persistentSessionRoot, { recursive: true });
    await fs.writeFile(path.join(persistentSessionRoot, 'Cookies'), 'keep-session');

    const result = await ensureRuntimeGenesis({
      userDataPath: root,
      now: '2026-09-08T14:30:00.000Z',
    });

    assert.equal(result.applied, true);
    assert.equal(result.generation, RUNTIME_GENESIS_GENERATION);
    assert.equal(result.initial_tabs, 0);
    assert.equal(result.initial_fleet_agents, 0);
    assert.equal(result.supervisor_mode, 'CONTROL');
    assert.equal(result.armed, true);
    assert.equal(result.automatic_actuation_after_genesis, false);
    assert.equal(result.preserves_browser_auth_session, true);
    assert.equal(result.preserves_supervisor_device_identity, true);
    assert.equal(result.stale_tab_topology_restored, false);
    assert.equal(result.stale_fleet_intent_restored, false);

    const control = JSON.parse(await fs.readFile(path.join(root, 'metaengine-native-supervisor-control-state-v1.json'), 'utf8'));
    assert.equal(control.supervisor_mode, 'CONTROL');
    assert.equal(control.armed, true);

    for (const relative of RUNTIME_GENESIS_RESET_FILES.filter((row) => row !== 'metaengine-native-supervisor-control-state-v1.json')) {
      assert.equal(await exists(path.join(root, relative)), false, relative);
    }
    assert.equal(await fs.readFile(path.join(root, 'metaengine-native-supervisor-device-v1.json'), 'utf8'), '{"identity":"keep"}\n');
    assert.equal(await fs.readFile(path.join(persistentSessionRoot, 'Cookies'), 'utf8'), 'keep-session');
    assert.equal(await exists(path.join(root, RUNTIME_GENESIS_MARKER)), true);
    assert.ok(result.quarantined_files.includes('metaengine-fleet-state-v2.json'));
    assert.ok(result.quarantined_files.includes('metaengine-self-update-session-continuity-v1.json'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('clean genesis is exactly-once for a runtime generation and preserves zero topology with always-on authority', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-clean-genesis-once-'));
  try {
    const first = await ensureRuntimeGenesis({ userDataPath: root, now: '2026-09-08T14:31:00.000Z' });
    await fs.writeFile(path.join(root, 'metaengine-fleet-state-v2.json'), '{"new":true}\n');
    const second = await ensureRuntimeGenesis({ userDataPath: root, now: '2026-09-08T14:32:00.000Z' });
    assert.equal(first.applied, true);
    assert.equal(second.applied, false);
    assert.equal(second.reason, 'ALREADY_APPLIED');
    assert.equal(second.initial_tabs, 0);
    assert.equal(second.initial_fleet_agents, 0);
    assert.equal(second.supervisor_mode, 'CONTROL');
    assert.equal(second.armed, true);
    assert.equal(await exists(path.join(root, 'metaengine-fleet-state-v2.json')), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
