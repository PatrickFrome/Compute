import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fsp = require('node:fs/promises');
const { durableWriteJson } = require('../src/durable-json-file.cjs');

async function tempTarget(name) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-durable-json-'));
  return { directory, target: path.join(directory, name) };
}

function transientError(code = 'EPERM') {
  const error = new Error(`simulated ${code}`);
  error.code = code;
  return error;
}

test('durableWriteJson retries a transient rename only after exact target readback proves no commit', async () => {
  const { directory, target } = await tempTarget('state.json');
  const originalRename = fsp.rename;
  let calls = 0;
  fsp.rename = async (...args) => {
    calls += 1;
    if (calls === 1) throw transientError('EPERM');
    return originalRename(...args);
  };

  try {
    const result = await durableWriteJson(target, { generation: 7, authority_effect: false }, { sequence: 7 });
    const persisted = JSON.parse(await fs.readFile(target, 'utf8'));
    assert.deepEqual(persisted, { generation: 7, authority_effect: false });
    assert.equal(calls, 2);
    assert.equal(result.rename_committed, true);
    assert.equal(result.rename_attempts, 2);
    assert.equal(result.rename_recovered_via_readback, false);
  } finally {
    fsp.rename = originalRename;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('durableWriteJson never replays an ambiguous rename when exact target readback proves the payload committed', async () => {
  const { directory, target } = await tempTarget('state.json');
  const originalRename = fsp.rename;
  let calls = 0;
  fsp.rename = async (...args) => {
    calls += 1;
    await originalRename(...args);
    throw transientError('EPERM');
  };

  try {
    const result = await durableWriteJson(target, { generation: 8, authority_effect: false }, { sequence: 8 });
    const persisted = JSON.parse(await fs.readFile(target, 'utf8'));
    assert.deepEqual(persisted, { generation: 8, authority_effect: false });
    assert.equal(calls, 1);
    assert.equal(result.rename_committed, true);
    assert.equal(result.rename_attempts, 1);
    assert.equal(result.rename_recovered_via_readback, true);
  } finally {
    fsp.rename = originalRename;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
