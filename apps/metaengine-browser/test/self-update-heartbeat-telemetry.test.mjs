import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, '../src/native-supervisor-client.mjs');

function source() {
  return fs.readFileSync(sourcePath, 'utf8');
}

test('native supervisor heartbeat exports shell version and self-update state for live upgrade observation', () => {
  const raw = source();
  assert.match(raw, /shell_version:\s*this\.#version/);
  assert.match(raw, /self_update:\s*this\.#selfUpdate\?\.snapshot\(\)\s*\|\|\s*null/);
  assert.match(raw, /await this\.#heartbeat\(\)/);
  assert.match(raw, /response\.status !== 202/);
});

test('typed self-update status check and apply remain owned by native supervisor', () => {
  const raw = source();
  assert.match(raw, /action === 'SELF_UPDATE_STATUS'/);
  assert.match(raw, /action === 'SELF_UPDATE_CHECK'/);
  assert.match(raw, /action === 'SELF_UPDATE_APPLY'/);
  assert.match(raw, /native_supervisor_control_required/);
  assert.match(raw, /native_supervisor_disarmed/);
  assert.match(raw, /applyWhenSafe\(\)/);
});
