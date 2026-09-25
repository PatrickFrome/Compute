import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyManifest, compareVersions, shouldTakeUpdate, verifyFileEntry } from '../src/update/verified-manifest.mjs';

const VALID = {
  schema: 'me2.desktop-update-manifest.v1',
  version: '0.8.0-dev.2.1',
  files: [{ name: 'setup.exe', url: 'https://x/setup.exe', sha256: 'a'.repeat(64), size: 1000 }],
};

test('manifest: valid passes', () => {
  const v = verifyManifest(VALID);
  assert.equal(v.ok, true);
  assert.equal(v.manifest.version, '0.8.0-dev.2.1');
});

test('manifest: schema mismatch rejected', () => {
  const v = verifyManifest({ ...VALID, schema: 'other.v1' });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'schema_mismatch');
});

test('manifest: not json rejected', () => {
  assert.equal(verifyManifest('nope{').ok, false);
});

test('manifest: bad sha rejected', () => {
  const v = verifyManifest({ ...VALID, files: [{ ...VALID.files[0], sha256: 'zz' }] });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'file_sha256_invalid');
});

test('manifest: empty files rejected', () => {
  assert.equal(verifyManifest({ ...VALID, files: [] }).ok, false);
});

test('version compare: numeric tuples', () => {
  assert.equal(compareVersions('0.8.0-dev.1.1', '0.8.0-dev.2.1'), -1);
  assert.equal(compareVersions('0.8.0-dev.10.1', '0.8.0-dev.9.1'), 1);
  assert.equal(compareVersions('v0.8.0-dev.5.1', '0.8.0-dev.5.1'), 0);
  assert.equal(compareVersions('0.7.0-dev.99.1', '0.8.0-dev.1.1'), -1);
});

test('update decision: take newer, skip same/older, skip exact sha', () => {
  assert.equal(shouldTakeUpdate({ current: '0.8.0-dev.1.1', candidate: '0.8.0-dev.2.1' }).take, true);
  assert.equal(shouldTakeUpdate({ current: '0.8.0-dev.2.1', candidate: '0.8.0-dev.2.1' }).take, false);
  assert.equal(shouldTakeUpdate({ current: '0.8.0-dev.3.1', candidate: '0.8.0-dev.2.1' }).take, false);
  const exact = shouldTakeUpdate({ current: '0.8.0-dev.1.1', candidate: '0.8.0-dev.2.1', sourceSha: 'ABC', runningSourceSha: 'abc' });
  assert.equal(exact.take, false);
  assert.equal(exact.reason, 'exact_sha_match');
  const noShaPair = shouldTakeUpdate({ current: '0.8.0-dev.1.1', candidate: '0.8.0-dev.2.1', runningSourceSha: 'abc' });
  assert.equal(noShaPair.take, true);
});

test('file entry verify: sha + size both must match', () => {
  const entry = { name: 'x', sha256: 'a'.repeat(64), size: 5 };
  assert.equal(verifyFileEntry(entry, 'a'.repeat(64), 5).ok, true);
  assert.equal(verifyFileEntry(entry, 'b'.repeat(64), 5).reason, 'sha256_mismatch');
  assert.equal(verifyFileEntry(entry, 'a'.repeat(64), 6).reason, 'size_mismatch');
});
