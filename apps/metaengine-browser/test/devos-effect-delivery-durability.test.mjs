import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DevOsEffectDeliveryJournal,
  DEVOS_EFFECT_JOURNAL_PRE_EFFECT_BARRIER_CONTRACT,
  DEVOS_EFFECT_JOURNAL_STORAGE_DURABILITY_CONTRACT,
} from '../src/devos-effect-delivery-journal.mjs';

const sourceUrl = new URL('../src/devos-effect-delivery-journal.mjs', import.meta.url);
const binding = {
  task_id: '09f2e414-5c31-4fc7-87a3-f5de1315cb81',
  lease_generation: 3,
  agent_id: 'agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510',
  tab_id: 'tab_ff91dce7-eeb3-425d-9052-94d521c2dfa6',
  target_id: 'webcontents:10',
  agent_generation_epoch: 9,
  prompt_sha256: crypto.createHash('sha256').update('durability-test').digest('hex'),
};

const POSIX_DIRSYNC = new Set(['linux', 'darwin', 'freebsd', 'openbsd', 'netbsd']);

test('journal advertises only durability actually implemented on this platform', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-devos-durability-'));
  const journal = new DevOsEffectDeliveryJournal({ statePath: path.join(dir, 'journal.json') });
  await journal.init();
  const entry = await journal.beginExecution(binding, {
    phase: 'BEFORE_SEMANTIC_TYPE',
    effect_barrier_contract: 'WRITE_AHEAD_V1',
  });

  if (POSIX_DIRSYNC.has(process.platform)) {
    assert.equal(DEVOS_EFFECT_JOURNAL_STORAGE_DURABILITY_CONTRACT, 'FILE_FSYNC_RENAME_DIR_FSYNC_V1');
    assert.equal(DEVOS_EFFECT_JOURNAL_PRE_EFFECT_BARRIER_CONTRACT, 'WRITE_AHEAD_V1');
    assert.equal(entry.evidence.effect_barrier_contract, 'WRITE_AHEAD_V1');
  } else {
    assert.equal(DEVOS_EFFECT_JOURNAL_STORAGE_DURABILITY_CONTRACT, 'FILE_FSYNC_RENAME_PLATFORM_UNVERIFIED_V1');
    assert.equal(DEVOS_EFFECT_JOURNAL_PRE_EFFECT_BARRIER_CONTRACT, 'WRITE_AHEAD_PLATFORM_UNVERIFIED_V1');
    assert.notEqual(entry.evidence.effect_barrier_contract, 'WRITE_AHEAD_V1');
  }
  assert.equal(entry.evidence.storage_durability_contract, DEVOS_EFFECT_JOURNAL_STORAGE_DURABILITY_CONTRACT);
  assert.equal(entry.evidence.physical_effect_attempted, false);
  assert.equal(entry.evidence.effect_barrier_crossed, false);
});

test('source orders file fsync before rename and parent-directory fsync after rename', async () => {
  const source = await fs.readFile(sourceUrl, 'utf8');
  const fileSync = source.indexOf('await handle.sync();');
  const rename = source.indexOf('await fs.rename(temp, target);');
  const directorySync = source.indexOf('await syncParentDirectory(target);');
  assert.ok(fileSync >= 0 && rename > fileSync && directorySync > rename);
  assert.match(source, /const DIRECTORY_FSYNC_PLATFORMS = new Set\(\['linux', 'darwin', 'freebsd', 'openbsd', 'netbsd'\]\)/);
  assert.match(source, /WRITE_AHEAD_PLATFORM_UNVERIFIED_V1/);
  assert.match(source, /FILE_FSYNC_RENAME_PLATFORM_UNVERIFIED_V1/);
});

test('effect-attempted barrier preserves storage durability evidence and is never downgraded', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-devos-durability-'));
  const journal = new DevOsEffectDeliveryJournal({ statePath: path.join(dir, 'journal.json') });
  await journal.init();
  await journal.beginExecution(binding, { phase: 'BEFORE_SEMANTIC_TYPE' });
  const attempted = await journal.markEffectAttempted(binding, {
    phase: 'BEFORE_TYPED_CLICK',
    physical_effect_attempted: false,
    effect_barrier_crossed: false,
  });
  assert.equal(attempted.state, 'EFFECT_ATTEMPTED');
  assert.equal(attempted.evidence.storage_durability_contract, DEVOS_EFFECT_JOURNAL_STORAGE_DURABILITY_CONTRACT);
  assert.equal(attempted.evidence.physical_effect_attempted, true);
  assert.equal(attempted.evidence.effect_barrier_crossed, true);
});
