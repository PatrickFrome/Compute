import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { resolveComputeBridgeWorkerPath } from '../src/compute-bridge-client.mjs';

const builder = JSON.parse(fs.readFileSync(new URL('../electron-builder.test.json', import.meta.url), 'utf8'));

test('packaged Compute client maps its executable worker to app.asar.unpacked', () => {
  const archived = path.join('C:', 'Program Files', 'METAENGINE Browser Test', 'resources', 'app.asar', 'src', 'compute-bridge-worker.cjs');
  const expected = path.join('C:', 'Program Files', 'METAENGINE Browser Test', 'resources', 'app.asar.unpacked', 'src', 'compute-bridge-worker.cjs');
  const checked = [];
  const resolved = resolveComputeBridgeWorkerPath(archived, (candidate) => {
    checked.push(candidate);
    return candidate === expected;
  });
  assert.equal(resolved, expected);
  assert.deepEqual(checked, [expected]);
});

test('development Compute worker path remains unchanged when no unpacked closure exists', () => {
  const source = path.join('/workspace', 'apps', 'metaengine-browser', 'src', 'compute-bridge-worker.cjs');
  assert.equal(resolveComputeBridgeWorkerPath(source, () => false), source);
});

test('packaged Compute runtime carries its directly imported browser-shared closure', () => {
  const resource = builder.extraResources.find((row) => row.from === '../../coordination/browser-shared' && row.to === 'browser-shared');
  assert.ok(resource, 'browser-shared extraResource must be present');
  assert.deepEqual(resource.filter, [
    'action-contract.mjs',
    'node-registry.mjs',
    'receipt-contract.mjs',
    'semantic-perception-compiler.mjs'
  ]);
});
