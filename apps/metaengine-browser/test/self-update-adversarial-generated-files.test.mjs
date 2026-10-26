import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  beginSelfUpdateTransaction,
  markSelfUpdateInstallEffectAttempted,
  readSelfUpdateTransaction,
  SELF_UPDATE_TRANSACTION_FILE,
  transitionSelfUpdateTransaction,
} from '../src/self-update-transaction-journal.mjs';

const require = createRequire(import.meta.url);
const fsp = require('node:fs/promises');
const { durableWriteJson } = require('../src/durable-json-file.cjs');
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const fixtureRoot = path.join(repoRoot, '.rollback-verifier-fixtures');
const targetVersion = '0.6.3-dev.169.1';
const receipt = () => ({
  version: targetVersion,
  available_version: targetVersion,
  metadata_verified: true,
  restart_gate_safe: true,
  authority_effect: false,
});
const injectedError = (code) => Object.assign(new Error(`synthetic_${code}`), { code });
const isPath = (value, expected) => typeof value === 'string' && path.resolve(value) === path.resolve(expected);

async function fixture(t) {
  await fs.mkdir(fixtureRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(fixtureRoot, 'self-update-'));
  assert.ok(path.resolve(directory).startsWith(`${path.resolve(fixtureRoot)}${path.sep}`));
  t.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  const preserved = {
    'dummy-owner.json': '{"synthetic_owner":"unchanged"}\n',
    'dummy-token.txt': 'SYNTHETIC_TOKEN_NEVER_A_CREDENTIAL\n',
    'bridge/config.json': '{"synthetic_bridge":"retained"}\n',
    'profile/Preferences': '{"synthetic_profile":"retained"}\n',
    'unrelated-journal.json': '{"synthetic_journal":"do_not_erase"}\n',
  };
  for (const [relative, bytes] of Object.entries(preserved)) {
    const file = path.join(directory, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
  }
  const app = {
    getPath(name) { assert.equal(name, 'userData'); return directory; },
    getVersion() { return '0.6.3-dev.168.1'; },
  };
  return {
    app,
    journal: path.join(directory, SELF_UPDATE_TRANSACTION_FILE),
    async assertPreserved() {
      for (const [relative, bytes] of Object.entries(preserved)) {
        assert.equal(await fs.readFile(path.join(directory, relative), 'utf8'), bytes, relative);
      }
    },
  };
}

function deferred() {
  let resolve;
  let timer;
  const promise = new Promise((done, reject) => {
    resolve = () => { clearTimeout(timer); done(); };
    timer = setTimeout(() => reject(new Error('synthetic_read_barrier_timed_out')), 5000);
  });
  return { promise, resolve };
}

// These are generated-file contract probes. They exercise real exported helpers;
// receipt booleans are synthetic inputs, never proof of native readiness.
test('lost begin ACK retains the committed PREPARED journal and fences a second begin', { concurrency: false }, async (t) => {
  const f = await fixture(t);
  const realOpen = fsp.open;
  let injected = false;
  fsp.open = async (file, flags, ...rest) => {
    if (!injected && isPath(file, f.journal) && flags === 'r+') {
      injected = true;
      throw injectedError('EIO');
    }
    return realOpen(file, flags, ...rest);
  };
  try {
    await assert.rejects(() => beginSelfUpdateTransaction(f.app, receipt()), /synthetic_EIO/);
  } finally { fsp.open = realOpen; }
  assert.equal(injected, true);
  const committed = await fs.readFile(f.journal, 'utf8');
  assert.equal((await readSelfUpdateTransaction(f.app)).state, 'PREPARED');
  await assert.rejects(() => beginSelfUpdateTransaction(f.app, receipt()), /unresolved_prior:PREPARED/);
  assert.equal(await fs.readFile(f.journal, 'utf8'), committed);
  await f.assertPreserved();
});

test('lost install barrier ACK retains INSTALLING and fences a second effect admission', { concurrency: false }, async (t) => {
  const f = await fixture(t);
  await beginSelfUpdateTransaction(f.app, receipt());
  const realOpen = fsp.open;
  let injected = false;
  fsp.open = async (file, flags, ...rest) => {
    if (!injected && isPath(file, f.journal) && flags === 'r+') {
      injected = true;
      throw injectedError('EIO');
    }
    return realOpen(file, flags, ...rest);
  };
  try {
    await assert.rejects(() => markSelfUpdateInstallEffectAttempted(f.app, { targetVersion }), /synthetic_EIO/);
  } finally { fsp.open = realOpen; }
  assert.equal(injected, true);
  const committed = await fs.readFile(f.journal, 'utf8');
  assert.equal((await readSelfUpdateTransaction(f.app)).state, 'INSTALLING');
  await assert.rejects(() => markSelfUpdateInstallEffectAttempted(f.app, { targetVersion }), /barrier_state_invalid:INSTALLING/);
  assert.equal(await fs.readFile(f.journal, 'utf8'), committed);
  await f.assertPreserved();
});

test('an unreadable final-path readback must not replay a rename with unknown outcome', { concurrency: false }, async (t) => {
  const f = await fixture(t);
  const realRename = fsp.rename;
  const realReadFile = fsp.readFile;
  const payload = { synthetic: true, generation: 2, authority_effect: false };
  let renameCalls = 0;
  let unreadable = false;
  fsp.rename = async (from, to) => {
    if (!isPath(to, f.journal)) return realRename(from, to);
    renameCalls += 1;
    await realRename(from, to);
    unreadable = true;
    throw injectedError('EPERM');
  };
  fsp.readFile = async (file, ...rest) => {
    if (unreadable && isPath(file, f.journal)) throw injectedError('EACCES');
    return realReadFile(file, ...rest);
  };
  let outcome;
  try { outcome = await Promise.allSettled([durableWriteJson(f.journal, payload)]); }
  finally { fsp.rename = realRename; fsp.readFile = realReadFile; }
  assert.equal(outcome[0].status, 'rejected');
  assert.deepEqual(JSON.parse(await fs.readFile(f.journal, 'utf8')), payload);
  await f.assertPreserved();
  assert.equal(renameCalls, 1, 'unknown readback cannot authorize another mutation attempt');
});

test('simultaneous begin calls must admit only one journal transaction', { concurrency: false }, async (t) => {
  const f = await fixture(t);
  const realReadFile = fsp.readFile;
  const bothRead = deferred();
  let arrivals = 0;
  let completedReads = 0;
  fsp.readFile = async (file, ...rest) => {
    if (!isPath(file, f.journal) || arrivals >= 2) return realReadFile(file, ...rest);
    arrivals += 1;
    let bytes;
    let error;
    try { bytes = await realReadFile(file, ...rest); } catch (caught) { error = caught; }
    completedReads += 1;
    if (completedReads === 2) bothRead.resolve();
    await bothRead.promise;
    if (error) throw error;
    return bytes;
  };
  syncBuiltinESMExports();
  let outcomes;
  try {
    outcomes = await Promise.allSettled([
      beginSelfUpdateTransaction(f.app, receipt()),
      beginSelfUpdateTransaction(f.app, receipt()),
    ]);
  } finally { fsp.readFile = realReadFile; syncBuiltinESMExports(); }
  assert.equal(arrivals, 2);
  const admitted = outcomes.filter((row) => row.status === 'fulfilled');
  const persisted = await readSelfUpdateTransaction(f.app);
  assert.ok(admitted.some((row) => row.value.transaction_id === persisted.transaction_id));
  await f.assertPreserved();
  assert.equal(admitted.length, 1, 'a second begin must not overwrite the first unresolved transaction');
});

test('independent module instances must not both cross the same install effect barrier', { concurrency: false }, async (t) => {
  const f = await fixture(t);
  await beginSelfUpdateTransaction(f.app, receipt());
  const url = new URL('../src/self-update-transaction-journal.mjs', import.meta.url);
  const first = await import(`${url.href}?adversarial=${randomUUID()}`);
  const second = await import(`${url.href}?adversarial=${randomUUID()}`);
  const realReadFile = fsp.readFile;
  const gates = [deferred(), deferred()];
  const arrivals = [0, 0];
  let readCount = 0;
  fsp.readFile = async (file, ...rest) => {
    if (!isPath(file, f.journal) || readCount >= 4) return realReadFile(file, ...rest);
    const index = readCount++;
    const group = Math.floor(index / 2);
    const snapshot = await realReadFile(file, ...rest);
    arrivals[group] += 1;
    if (arrivals[group] === 2) gates[group].resolve();
    await gates[group].promise;
    return snapshot;
  };
  syncBuiltinESMExports();
  let outcomes;
  try {
    outcomes = await Promise.allSettled([
      first.markSelfUpdateInstallEffectAttempted(f.app, { targetVersion }),
      second.markSelfUpdateInstallEffectAttempted(f.app, { targetVersion }),
    ]);
  } finally { fsp.readFile = realReadFile; syncBuiltinESMExports(); }
  assert.deepEqual(arrivals, [2, 2]);
  assert.equal((await readSelfUpdateTransaction(f.app)).state, 'INSTALLING');
  await f.assertPreserved();
  assert.equal(outcomes.filter((row) => row.status === 'fulfilled').length, 1,
    'module-local queues cannot grant two admissions for one durable barrier');
});

test('a concurrent journal preimage change must survive a stale transition', { concurrency: false }, async (t) => {
  const f = await fixture(t);
  const before = await beginSelfUpdateTransaction(f.app, receipt());
  const concurrent = { ...before, transaction_id: randomUUID(), evidence: { synthetic_concurrent_writer: true } };
  const concurrentBytes = `${JSON.stringify(concurrent, null, 2)}\n`;
  const realLink = fsp.link;
  let injected = false;
  // Publication now uses an absent-only hard link. Race the actual commit
  // syscall, retaining the same assertion that concurrent bytes survive.
  fsp.link = async (from, to) => {
    if (!injected && isPath(to, f.journal)) {
      injected = true;
      await fs.writeFile(f.journal, concurrentBytes);
    }
    return realLink(from, to);
  };
  try {
    await Promise.allSettled([transitionSelfUpdateTransaction(f.app, 'INSTALLING', { requireTargetVersion: targetVersion })]);
  } finally { fsp.link = realLink; }
  assert.equal(injected, true);
  const persisted = await readSelfUpdateTransaction(f.app);
  await f.assertPreserved();
  assert.equal(persisted.transaction_id, concurrent.transaction_id,
    'stale transition must not erase a concurrent transaction even when its target version matches');
  assert.equal(await fs.readFile(f.journal, 'utf8'), concurrentBytes);
});
