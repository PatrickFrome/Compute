import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { StagedUpdater } from '../src/update/staged-updater.mjs';

let server;
let baseUrl;
const payload = Buffer.from('fake-installer-bytes-'.repeat(100));
const payloadSha = createHash('sha256').update(payload).digest('hex');
const MANIFEST = {
  schema: 'me2.desktop-update-manifest.v1',
  version: '0.8.0-dev.9.1',
  files: [{ name: 'setup.exe', url: '', sha256: payloadSha, size: payload.length }],
};

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/manifest.json') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(MANIFEST));
    } else if (req.url === '/setup.exe') {
      res.end(payload);
    } else if (req.url === '/404') {
      res.statusCode = 404;
      res.end('nope');
    } else {
      res.statusCode = 500;
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  MANIFEST.files[0].url = `${baseUrl}/setup.exe`;
});

after(() => server.close());

function newUpdater(currentVersion) {
  const dir = mkdtempSync(join(tmpdir(), 'me2-updater-'));
  return new StagedUpdater({ userDataDir: dir, currentVersion, fetchImpl: fetch });
}

test('staged updater: newer version → staged with verified sha + journal', async () => {
  const u = newUpdater('0.8.0-dev.1.1');
  const r = await u.checkOnce({ manifestUrl: `${baseUrl}/manifest.json` });
  assert.equal(r.ok, true);
  assert.equal(r.staged, true);
  assert.equal(r.version, '0.8.0-dev.9.1');
  const stagedFile = join(r.dir, 'setup.exe');
  assert.equal(existsSync(stagedFile), true);
  assert.equal(createHash('sha256').update(readFileSync(stagedFile)).digest('hex'), payloadSha);
  const history = u.journalHistory();
  const stages = history.records.map((x) => x.stage);
  assert.ok(stages.includes('staged'));
  assert.ok(stages.includes('decision'));
  assert.equal(u.stagedVersions().includes('0.8.0-dev.9.1'), true);
});

test('staged updater: same version → no-op', async () => {
  const u = newUpdater('0.8.0-dev.9.1');
  const r = await u.checkOnce({ manifestUrl: `${baseUrl}/manifest.json` });
  assert.equal(r.ok, true);
  assert.equal(r.staged, false);
  assert.equal(r.reason, 'same_version');
});

test('staged updater: manifest 404 → honest failure, no staging', async () => {
  const u = newUpdater('0.8.0-dev.1.1');
  const r = await u.checkOnce({ manifestUrl: `${baseUrl}/404` });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'http_404');
  assert.equal(u.stagedVersions().length, 0);
});

test('staged updater: schema mismatch → manifest_rejected', async () => {
  const bad = createServer((req, res) => res.end(JSON.stringify({ ...MANIFEST, schema: 'alien.v9' })));
  await new Promise((r) => bad.listen(0, '127.0.0.1', r));
  const u = newUpdater('0.8.0-dev.1.1');
  const r = await u.checkOnce({ manifestUrl: `http://127.0.0.1:${bad.address().port}/x` });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'schema_mismatch');
  bad.close();
});

test('constructor update channel is used; staging persists state without false activation proof', async () => {
  const u = newUpdater('0.8.0-dev.1.1'); u.manifestUrl = `${baseUrl}/manifest.json`;
  assert.equal((await u.checkOnce()).staged, true);
  const recreated = new StagedUpdater({ userDataDir: u.userDataDir, currentVersion: u.currentVersion });
  assert.equal(recreated.state.last_staged, MANIFEST.version);
  assert.equal(u.journalHistory().records.find(r => r.stage === 'staged').handed_off, false);
});
test('staging rejects path escape versions before writing', async () => {
  const u = newUpdater('0.8.0-dev.1.1');
  const result = await u.stageManifest({ ...MANIFEST, version: '0.8.0/../../escape' });
  assert.equal(result.reason, 'version_invalid');
  assert.equal(existsSync(u.stagedDir), false);
});
