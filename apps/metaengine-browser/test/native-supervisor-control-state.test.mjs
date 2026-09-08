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

test('control state round-trips atomically and OFF always restores disarmed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-control-state-'));
  const file = path.join(dir, 'control.json');
  try {
    const saved = await persistNativeSupervisorControlState(file, { supervisor_mode: 'OFF', armed: true });
    assert.equal(saved.schema, NATIVE_SUPERVISOR_CONTROL_STATE_SCHEMA);
    assert.equal(saved.supervisor_mode, 'OFF');
    assert.equal(saved.armed, false);
    const loaded = await loadNativeSupervisorControlState(file);
    assert.equal(loaded.supervisor_mode, 'OFF');
    assert.equal(loaded.armed, false);
    assert.equal(loaded.recovered_fail_closed, false);
    assert.equal(await fs.stat(`${file}.tmp`).then(() => true).catch(() => false), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('missing state preserves normal first-run bootstrap while corrupt state fails closed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-control-state-'));
  const file = path.join(dir, 'control.json');
  try {
    assert.equal(await loadNativeSupervisorControlState(file), null);
    await fs.writeFile(file, '{broken', 'utf8');
    const loaded = await loadNativeSupervisorControlState(file);
    assert.equal(loaded.supervisor_mode, 'OFF');
    assert.equal(loaded.armed, false);
    assert.equal(loaded.recovered_fail_closed, true);
    assert.equal(loaded.recovery_reason, 'CONTROL_STATE_JSON_INVALID');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('normalizer rejects schema drift and OFF cannot normalize armed', () => {
  assert.equal(normalizeNativeSupervisorControlState({ schema: 'other', supervisor_mode: 'CONTROL', armed: true }), null);
  const row = normalizeNativeSupervisorControlState({
    schema: NATIVE_SUPERVISOR_CONTROL_STATE_SCHEMA,
    supervisor_mode: 'OFF',
    armed: true,
    updated_at: '2026-09-08T00:00:00.000Z',
  });
  assert.equal(row.supervisor_mode, 'OFF');
  assert.equal(row.armed, false);
});
