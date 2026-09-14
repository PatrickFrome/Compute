import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolveComputeBridgeWorkerPath } from '../src/compute-bridge-client.mjs';

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
