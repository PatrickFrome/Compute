// Source-only, inert fixture checks. This file never locates installed user data.
// Model diagnostics are NOT authority and do NOT qualify a PostgreSQL restore.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const DOMAINS = Object.freeze({
  profile: 'profiles/session.bin',
  postgres: 'pgdata/cluster.bin',
  project: 'projects/project.bin',
  message: 'messages/message.bin',
  result: 'results/outbox.bin',
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function makeFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-preservation-fixture-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  for (const [domain, relative] of Object.entries(DOMAINS)) {
    const destination = path.join(root, relative);
    await fs.mkdir(path.dirname(destination), {recursive: true});
    await fs.writeFile(destination, Buffer.from(`synthetic-${domain}-not-user-data\u0000`));
  }
  return root;
}

async function capture(root) {
  const rows = {};
  for (const [domain, relative] of Object.entries(DOMAINS)) {
    try {
      const bytes = await fs.readFile(path.join(root, relative));
      rows[domain] = {relative, size: bytes.byteLength, sha256: hash(bytes)};
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      rows[domain] = {relative, missing: true};
    }
  }
  return rows;
}

function assessPreservation(before, after, {attemptState, exactReadback} = {}) {
  const unresolved = new Set(['PREPARED', 'INSTALLING', 'AMBIGUOUS_INSTALL', 'QUARANTINED']);
  if (unresolved.has(attemptState) || exactReadback !== true)
    return {state: 'HOLD', reason: 'unresolved_attempt_or_no_exact_readback'};
  for (const domain of Object.keys(DOMAINS)) {
    const a = before[domain], b = after[domain];
    if (!a || !b || a.missing || b.missing || a.relative !== b.relative
      || a.size !== b.size || a.sha256 !== b.sha256)
      return {state: 'HOLD', reason: `domain_mismatch:${domain}`};
  }
  return {state: 'FIXTURE_MATCH_ONLY', authority_effect: false};
}

test('synthetic five-surface byte-for-byte readback is accepted only as a fixture match', async t => {
  const root = await makeFixture(t), before = await capture(root);
  assert.deepEqual(assessPreservation(before, await capture(root), {
    attemptState: 'QUALIFIED', exactReadback: true,
  }), {state: 'FIXTURE_MATCH_ONLY', authority_effect: false});
});

for (const domain of Object.keys(DOMAINS)) {
  test(`synthetic ${domain} mutation is detected before any preservation claim`, async t => {
    const root = await makeFixture(t), before = await capture(root);
    await fs.appendFile(path.join(root, DOMAINS[domain]), 'deliberate-mutation');
    assert.deepEqual(assessPreservation(before, await capture(root), {
      attemptState: 'QUALIFIED', exactReadback: true,
    }), {state: 'HOLD', reason: `domain_mismatch:${domain}`});
  });
}

test('a missing synthetic result cannot be counted as a preserved delivery', async t => {
  const root = await makeFixture(t), before = await capture(root);
  await fs.unlink(path.join(root, DOMAINS.result));
  assert.deepEqual(assessPreservation(before, await capture(root), {
    attemptState: 'QUALIFIED', exactReadback: true,
  }), {state: 'HOLD', reason: 'domain_mismatch:result'});
});

test('PREPARED and INSTALLING remain HOLD even if synthetic files appear unchanged', async t => {
  const root = await makeFixture(t), before = await capture(root);
  for (const attemptState of ['PREPARED', 'INSTALLING', 'AMBIGUOUS_INSTALL', 'QUARANTINED']) {
    assert.deepEqual(assessPreservation(before, await capture(root), {
      attemptState, exactReadback: true,
    }), {state: 'HOLD', reason: 'unresolved_attempt_or_no_exact_readback'});
  }
});

test('a missing readback cannot be repaired by a matching synthetic file digest', async t => {
  const root = await makeFixture(t), before = await capture(root);
  assert.deepEqual(assessPreservation(before, await capture(root), {
    attemptState: 'QUALIFIED', exactReadback: false,
  }), {state: 'HOLD', reason: 'unresolved_attempt_or_no_exact_readback'});
});
