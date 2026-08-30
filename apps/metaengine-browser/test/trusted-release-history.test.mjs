import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TrustedReleaseHistory, TRUSTED_RELEASE_HISTORY_FILE } from '../src/trusted-release-history.mjs';

function release(version, seed) {
  return {
    schema: 'metaengine.trusted-dev-release.v1',
    version,
    tag: `v${version}`,
    git_sha: seed.repeat(40).slice(0, 40),
    manifest_sha256: seed.repeat(64).slice(0, 64),
    dev_yml_sha256: String((Number.parseInt(seed, 16) + 1) % 16).repeat(64),
    authority_effect: false,
  };
}

async function tempState() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-release-history-'));
  return { dir, file: path.join(dir, TRUSTED_RELEASE_HISTORY_FILE) };
}

test('trusted release history persists the highest verified dev build across runtime instances', async (t) => {
  const { dir, file } = await tempState();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const first = new TrustedReleaseHistory({ statePath: file, clock: () => new Date('2026-08-30T06:00:00Z') });
  await first.observe(release('0.6.3-dev.89.1', 'a'));
  assert.equal(first.snapshot().highest_build, 89);

  const successor = new TrustedReleaseHistory({ statePath: file });
  const loaded = await successor.load();
  assert.equal(loaded.highest_version, '0.6.3-dev.89.1');
  assert.equal(loaded.authority_effect, false);
});

test('trusted release history rejects rollback below a previously observed build', async (t) => {
  const { dir, file } = await tempState();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const history = new TrustedReleaseHistory({ statePath: file });
  await history.observe(release('0.6.3-dev.89.1', 'a'));
  await assert.rejects(history.observe(release('0.6.3-dev.88.1', 'b')), /trusted_release_rollback_detected/);
  assert.equal(history.snapshot().highest_version, '0.6.3-dev.89.1');
});

test('trusted release history rejects same-version metadata or source equivocation', async (t) => {
  const { dir, file } = await tempState();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const history = new TrustedReleaseHistory({ statePath: file });
  await history.observe(release('0.6.3-dev.89.1', 'a'));
  await assert.rejects(history.observe(release('0.6.3-dev.89.1', 'b')), /trusted_release_equivocation_detected/);
});

test('trusted release history accepts a strictly newer verified build and advances atomically', async (t) => {
  const { dir, file } = await tempState();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const history = new TrustedReleaseHistory({ statePath: file });
  await history.observe(release('0.6.3-dev.89.1', 'a'));
  await history.observe(release('0.6.3-dev.90.1', 'b'));
  assert.equal(history.snapshot().highest_version, '0.6.3-dev.90.1');
  const persisted = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(persisted.highest_build, 90);
});
