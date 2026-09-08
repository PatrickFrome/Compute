import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(ROOT, '../..');
const source = (relative) => fs.readFile(path.join(ROOT, relative), 'utf8');

test('new DevOS runtime requires batch leasing and disables the legacy single-command fastlane', async () => {
  const main = await source('src/main.mjs');
  assert.match(main, /commandBatchSize:\s*64/);
  assert.match(main, /commandReadConcurrency:\s*32/);
  assert.match(main, /commandMutationConcurrency:\s*16/);
  assert.match(main, /commandBatchWaitMs:\s*15000/);
  assert.match(main, /legacySingleLeaseFallback:\s*false/);
  assert.match(main, /commandFastlane:\s*false/);
});

test('batch-required client retries batch capability and never silently falls through to /commands/next', async () => {
  const client = await source('src/native-supervisor-client-base.mjs');
  assert.match(client, /legacySingleLeaseFallback\s*=\s*true/);
  assert.match(client, /#legacySingleLeaseFallback/);
  assert.match(client, /native_supervisor_batch_transport_required/);
  assert.match(client, /REQUIRED_UNAVAILABLE/);
  assert.match(client, /legacy_single_lease_fallback_enabled:/);
  assert.match(client, /batch_transport_required:/);
  assert.match(client, /commandFastlane === true && this\.#legacySingleLeaseFallback/);
});

test('command lane scheduler keeps distinct-tab mutation parallelism while serializing same-tab effects', async () => {
  const lanes = await source('src/native-supervisor-command-lanes.mjs');
  assert.match(lanes, /distinct_tab_mutation_parallelism_allowed:\s*true/);
  assert.match(lanes, /same_tab_mutation_parallelism_allowed:\s*false/);
  assert.match(lanes, /cross_tab_read_parallelism_allowed:\s*true/);
  assert.match(lanes, /global_mutation_parallelism_allowed:\s*false/);
  assert.match(lanes, /exact_tab_mutation_execution_required:\s*true/);
});

test('clean product head contains no finalizer authority and bounded deadlines remain live until settlement', async () => {
  const supervisorFetch = await source('src/native-supervisor-client-core.mjs');
  const optionalFetch = await source('src/bounded-network-fetch.mjs');
  assert.doesNotMatch(supervisorFetch, /timer\.unref\?\.\(\)/);
  assert.doesNotMatch(optionalFetch, /timer\.unref\?\.\(\)/);

  await assert.rejects(
    fs.stat(path.join(REPO_ROOT, '.github/workflows/devos-clean-genesis-batch-temp.yml')),
    (error) => error?.code === 'ENOENT',
  );
  await assert.rejects(
    fs.stat(path.join(ROOT, 'scripts/patch-clean-genesis-batch-temp.mjs')),
    (error) => error?.code === 'ENOENT',
  );
});
