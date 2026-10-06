import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

import {
  CLIENT_GOAL_JOURNAL_FILENAME,
  createClientGoalJournalFileStore,
} from '../src/client-goal-journal-file-store.mjs';

const root = new URL('..', import.meta.url);
const mainEntry = await readFile(new URL('../src/main-entry.mjs', import.meta.url), 'utf8');
const finalEntry = await readFile(new URL('../src/final-runtime-entry.mjs', import.meta.url), 'utf8');
const activationRegistry = await readFile(new URL('../src/final-runtime-activation-registry.mjs', import.meta.url), 'utf8');

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [];
    const err = [];
    child.stdout.on('data', chunk => out.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => err.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', code => resolve({
      code,
      stdout: Buffer.concat(out).toString('utf8'),
      stderr: Buffer.concat(err).toString('utf8'),
    }));
  });
}

test('installed goal journal probe is machine-readable and excludes Browser runtime/startup effects', () => {
  assert.match(mainEntry, /--metaengine-client-goal-journal-probe/);
  assert.match(mainEntry, /!clientGoalJournalProbe/);
  assert.match(mainEntry, /clientGoalJournalProbe \|\| instanceHoldProbe/);
  assert.match(mainEntry, /schema: 'metaengine\.client\.goal-journal-probe\.v1'/);
  assert.match(mainEntry, /createClientGoalJournalFileStore\(userData/);
  assert.match(mainEntry, /local_read_only: true/);
  assert.match(mainEntry, /browser_runtime_started: false/);
  assert.match(mainEntry, /native_supervisor_started: false/);
  assert.match(mainEntry, /network_started: false/);
  assert.match(mainEntry, /submit_effect_attempted: false/);
  assert.match(mainEntry, /journal_unchanged: beforeSha256 === afterSha256/);

  for (const source of [finalEntry, activationRegistry]) {
    assert.match(source, /--metaengine-client-goal-journal-probe/);
  }
});

test('shared file store uses exact profile-local journal filename and atomic temp rename path', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'metaengine-client-journal-store-'));
  try {
    const { journal, target } = createClientGoalJournalFileStore(dir);
    assert.equal(path.basename(target), CLIENT_GOAL_JOURNAL_FILENAME);
    assert.equal(target, path.join(dir, 'metaengine-client-goal-journal-v1.json'));

    await journal.load();
    await journal.begin({
      request_id: '11111111-1111-4111-8111-111111111111',
      goal: 'Persist exact local correlation',
    });
    const disk = JSON.parse(await readFile(target, 'utf8'));
    assert.equal(disk.schema, 'metaengine.client.goal-journal.v1');
    assert.equal(disk.entries.length, 1);
    assert.equal(disk.entries[0].authority_effect, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fixture writer produces valid and deliberately stale durable snapshots', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'metaengine-client-journal-fixture-'));
  const baseline = 'b'.repeat(40);
  try {
    const validPath = path.join(dir, 'valid.json');
    const valid = await runNode([
      'scripts/client-c5-installed-journal-fixture.mjs',
      '--out', validPath,
      '--baseline', baseline,
      '--mode', 'valid',
    ]);
    assert.equal(valid.code, 0, valid.stderr);
    const validDisk = JSON.parse(await readFile(validPath, 'utf8'));
    assert.equal(validDisk.entries[0].state, 'COMPLETED');
    assert.equal(validDisk.entries[0].execution_proof.lease_generation, 1);
    assert.equal(validDisk.entries[0].useful_work_proof.lease_generation, 1);
    assert.equal(validDisk.entries[0].useful_work_proof.evidence_class, 'SYNTHETIC');
    assert.equal(validDisk.entries[0].useful_work_proof.client_c5_useful_work_verified, false);

    const stalePath = path.join(dir, 'stale.json');
    const stale = await runNode([
      'scripts/client-c5-installed-journal-fixture.mjs',
      '--out', stalePath,
      '--baseline', baseline,
      '--mode', 'stale',
    ]);
    assert.equal(stale.code, 0, stale.stderr);
    const staleDisk = JSON.parse(await readFile(stalePath, 'utf8'));
    assert.equal(staleDisk.entries[0].execution_proof.lease_generation, 1);
    assert.equal(staleDisk.entries[0].useful_work_proof.lease_generation, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
