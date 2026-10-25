import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { agentBridgePins } from './fixtures/native-coding-agent-bridge-pins.mjs';

async function aliasedTemporary(t) {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.realpath(await fs.mkdtemp(path.join(parent, 'metaengine-fixture-alias-')));
  t.after(async () => {
    assert.equal(await fs.realpath(root), root);
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith('metaengine-fixture-alias-'));
    await fs.rm(root, { recursive: true, force: false });
  });
  const physical = path.join(root, 'physical'), alias = path.join(root, 'alias');
  await fs.mkdir(physical);
  await fs.symlink(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const previous = Object.fromEntries(['TMPDIR', 'TMP', 'TEMP'].map(key => [key, process.env[key]]));
  const cleanup = [];
  let pins;
  try {
    for (const key of Object.keys(previous)) process.env[key] = alias;
    pins = await agentBridgePins({ after: fn => cleanup.push(fn) });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  assert.equal(cleanup.length, 1);
  return { pins, physical, cleanup: cleanup[0] };
}

test('bridge fixture derives pins from physical temporary paths and cleans after temp environment restoration', async t => {
  const f = await aliasedTemporary(t);
  try {
    assert.equal(f.pins.entrypointPath, await fs.realpath(f.pins.entrypointPath));
    assert.equal(path.dirname(path.dirname(f.pins.entrypointPath)), f.physical);
  } finally { await f.cleanup(); }
});

test('bridge fixture cleanup refuses a redirected root even when target has the same fixture prefix', async t => {
  const f = await aliasedTemporary(t);
  const directory = path.dirname(f.pins.entrypointPath);
  const retained = directory + '-retained', unrelated = path.join(f.physical, 'metaengine-agent-bridge-pins-unrelated');
  await fs.rename(directory, retained);
  await fs.mkdir(unrelated);
  const marker = path.join(unrelated, 'keep.txt'); await fs.writeFile(marker, 'not the owned fixture');
  await fs.symlink(unrelated, directory, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.cleanup(), /fixture_cleanup_scope/);
  assert.equal(await fs.readFile(marker, 'utf8'), 'not the owned fixture');
  await fs.rm(directory, { recursive: true, force: false });
  await fs.rename(retained, directory);
  await f.cleanup();
});
