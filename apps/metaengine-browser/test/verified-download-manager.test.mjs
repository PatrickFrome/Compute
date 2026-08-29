import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { VerifiedDownloadManager, validateVerifiedDownloadRequest } from '../src/verified-download-manager.mjs';

class FakeDownloadItem extends EventEmitter {
  constructor(url, body) {
    super();
    this.url = url;
    this.body = Buffer.from(body);
    this.savePath = null;
    this.cancelled = false;
    this.received = 0;
  }
  getURLChain() { return [this.url]; }
  setSavePath(value) { this.savePath = value; }
  getReceivedBytes() { return this.received; }
  cancel() { this.cancelled = true; }
}

class FakeSession extends EventEmitter {
  constructor(body = Buffer.from('verified-body')) {
    super();
    this.body = Buffer.from(body);
    this.lastItem = null;
  }
  downloadURL(url) {
    const item = new FakeDownloadItem(url, this.body);
    this.lastItem = item;
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    this.emit('will-download', event, item);
    if (event.prevented) return;
    setImmediate(async () => {
      await fs.writeFile(item.savePath, item.body);
      item.received = item.body.length;
      item.emit('updated', {}, 'progressing');
      item.emit('done', {}, item.cancelled ? 'cancelled' : 'completed');
    });
  }
}

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function tempRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-download-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('validated download requires https, safe filename, digest and bounded size', () => {
  const body = Buffer.from('x');
  const row = validateVerifiedDownloadRequest({
    url: 'https://example.com/build.exe?token=opaque',
    filename: 'build.exe',
    expected_sha256: digest(body),
    max_bytes: 1024,
  });
  assert.equal(row.url, 'https://example.com/build.exe?token=opaque');
  assert.equal(row.filename, 'build.exe');
  assert.throws(() => validateVerifiedDownloadRequest({ url: 'http://example.com/a', filename: 'a', expected_sha256: digest(body) }), /https_required/);
  assert.throws(() => validateVerifiedDownloadRequest({ url: 'https://localhost/a', filename: 'a', expected_sha256: digest(body) }), /loopback_blocked/);
  assert.throws(() => validateVerifiedDownloadRequest({ url: 'https://example.com/a', filename: '../a', expected_sha256: digest(body) }), /filename_invalid/);
  assert.throws(() => validateVerifiedDownloadRequest({ url: 'https://example.com/a', filename: 'a' }), /sha256_required/);
});

test('typed download persists only after exact sha256 verification', async (t) => {
  const body = Buffer.from('physical verified bytes');
  const root = await tempRoot(t);
  const session = new FakeSession(body);
  const manager = new VerifiedDownloadManager({ session, rootPath: root });
  t.after(() => manager.close());
  const receipt = await manager.download({
    url: 'https://example.com/METAENGINE.exe',
    filename: 'METAENGINE.exe',
    expected_sha256: digest(body),
    max_bytes: 4096,
  });
  assert.equal(receipt.schema, 'metaengine.verified-download-receipt.v1');
  assert.equal(receipt.sha256, digest(body));
  assert.equal(receipt.executable_started, false);
  assert.equal(await fs.readFile(path.join(root, 'METAENGINE.exe'), 'utf8'), body.toString());
  assert.equal(manager.snapshot().active, null);
});

test('digest mismatch fails closed and removes partial bytes', async (t) => {
  const body = Buffer.from('unexpected');
  const root = await tempRoot(t);
  const session = new FakeSession(body);
  const manager = new VerifiedDownloadManager({ session, rootPath: root });
  t.after(() => manager.close());
  await assert.rejects(manager.download({
    url: 'https://example.com/build.exe',
    filename: 'build.exe',
    expected_sha256: digest(Buffer.from('expected')),
    max_bytes: 4096,
  }), /digest_mismatch/);
  await assert.rejects(fs.stat(path.join(root, 'build.exe.partial')), /ENOENT/);
  await assert.rejects(fs.stat(path.join(root, 'build.exe')), /ENOENT/);
  assert.equal(manager.snapshot().last.authority_effect, false);
});

test('page-originated download without typed intent is blocked', async (t) => {
  const root = await tempRoot(t);
  const session = new FakeSession();
  const manager = new VerifiedDownloadManager({ session, rootPath: root });
  t.after(() => manager.close());
  const item = new FakeDownloadItem('https://example.com/untrusted.exe', Buffer.from('x'));
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  session.emit('will-download', event, item);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(event.prevented, true);
  assert.equal(item.cancelled, true);
  assert.equal(manager.snapshot().active, null);
});
