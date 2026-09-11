import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  NATIVE_SUPERVISOR_CONTROL_STATE_SCHEMA,
  loadNativeSupervisorControlState,
  normalizeNativeSupervisorControlState,
  persistNativeSupervisorControlState,
} from '../src/native-supervisor-control-state.mjs';

test('control state round-trips atomically only as CONTROL + armed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-control-state-'));
  const file = path.join(dir, 'control.json');
  try {
    const saved = await persistNativeSupervisorControlState(file, { supervisor_mode: 'CONTROL', armed: true });
    assert.equal(saved.schema, NATIVE_SUPERVISOR_CONTROL_STATE_SCHEMA);
    assert.equal(saved.supervisor_mode, 'CONTROL');
    assert.equal(saved.armed, true);
    const loaded = await loadNativeSupervisorControlState(file);
    assert.equal(loaded.supervisor_mode, 'CONTROL');
    assert.equal(loaded.armed, true);
    assert.equal(loaded.recovered_fail_closed, false);
    assert.equal(await fs.stat(`${file}.tmp`).then(() => true).catch(() => false), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('legacy OFF/MONITOR/disarmed state is migrated on read and rewritten canonically', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-control-state-'));
  const file = path.join(dir, 'control.json');
  try {
    await fs.writeFile(file, `${JSON.stringify({
      schema: NATIVE_SUPERVISOR_CONTROL_STATE_SCHEMA,
      supervisor_mode: 'OFF',
      armed: false,
      updated_at: '2026-09-08T00:00:00.000Z',
    })}\n`, 'utf8');
    const loaded = await loadNativeSupervisorControlState(file);
    assert.equal(loaded.supervisor_mode, 'CONTROL');
    assert.equal(loaded.armed, true);
    assert.equal(loaded.migrated_always_on, true);
    assert.match(loaded.migration_reason, /^ALWAYS_ON_CONTROL:/);
    const persisted = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(persisted.supervisor_mode, 'CONTROL');
    assert.equal(persisted.armed, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('missing state keeps first-run bootstrap while corrupt state recovers to CONTROL + armed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-control-state-'));
  const file = path.join(dir, 'control.json');
  try {
    assert.equal(await loadNativeSupervisorControlState(file), null);
    await fs.writeFile(file, '{broken', 'utf8');
    const loaded = await loadNativeSupervisorControlState(file);
    assert.equal(loaded.supervisor_mode, 'CONTROL');
    assert.equal(loaded.armed, true);
    assert.equal(loaded.recovered_fail_closed, true);
    assert.equal(loaded.recovery_reason, 'CONTROL_STATE_JSON_INVALID');
    const persisted = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(persisted.supervisor_mode, 'CONTROL');
    assert.equal(persisted.armed, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('normalizer migrates legacy authority and persistence rejects lowering attempts', async () => {
  assert.equal(normalizeNativeSupervisorControlState({ schema: 'other', supervisor_mode: 'CONTROL', armed: true }), null);
  const row = normalizeNativeSupervisorControlState({
    schema: NATIVE_SUPERVISOR_CONTROL_STATE_SCHEMA,
    supervisor_mode: 'MONITOR',
    armed: false,
    updated_at: '2026-09-08T00:00:00.000Z',
  });
  assert.equal(row.supervisor_mode, 'CONTROL');
  assert.equal(row.armed, true);
  assert.equal(row.migrated_always_on, true);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-control-state-'));
  const file = path.join(dir, 'control.json');
  try {
    await assert.rejects(
      persistNativeSupervisorControlState(file, { supervisor_mode: 'OFF', armed: false }),
      (error) => error?.code === 'NATIVE_SUPERVISOR_ALWAYS_ON_CONTROL_REQUIRED',
    );
    await assert.rejects(
      persistNativeSupervisorControlState(file, { supervisor_mode: 'CONTROL', armed: false }),
      (error) => error?.code === 'NATIVE_SUPERVISOR_ALWAYS_ON_CONTROL_REQUIRED',
    );
    assert.equal(await fs.stat(file).then(() => true).catch(() => false), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
