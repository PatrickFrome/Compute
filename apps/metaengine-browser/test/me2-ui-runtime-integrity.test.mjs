import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inventoryUiContent } from '../../me2-ui/scripts/ui-content-inventory.mjs';
import { smokeMe2UiBundle, verifyMe2UiBundle } from '../scripts/verify-me2-ui-bundle.mjs';

const SHA = 'a'.repeat(40);
function fixture(t, mutation = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'me2-ui-runtime-integrity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (name, bytes) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
  };
  put('package.json', JSON.stringify({ name: 'fixture', version: '1.0.0' }));
  put('.next/BUILD_ID', 'fixture-build'); put('.next/static/chunk.js', 'AAAA');
  for (const name of ['next', 'react', 'react-dom']) put(`node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0' }));
  put('node_modules/next/dist/server/lib/start-server.js', 'module.exports = {};');
  put('server.js', `
    const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
    const assert = require('node:assert/strict');
    assert.equal(process.env.ME2_HOSTED_BY_BROWSER, '1');
    assert.equal(process.env.ME2_WATCHDOG, 'off');
    const root = __dirname, asset = path.join(root, '.next/static/chunk.js');
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', req.url === '/' ? 'text/html' : 'application/javascript');
      res.end(req.url === '/' ? '<html><script src="/_next/static/chunk.js"></script></html>' : fs.readFileSync(asset));
    });
    process.once('SIGTERM', () => {
      ${mutation}
      server.close(() => process.exit(0));
    });
    server.listen(Number(process.env.PORT), process.env.HOSTNAME);
  `);
  fs.writeFileSync(path.join(root, 'me2-ui-manifest.json'), JSON.stringify({
    schema: 'me2.ui-bundle-manifest.v1', git_sha: SHA, build_id: 'fixture-build', ...inventoryUiContent(root),
  }));
  return root;
}

test('repeated smoke launches preserve the same manifest and complete inventory', async t => {
  const root = fixture(t);
  const before = verifyMe2UiBundle(root, SHA);
  for (let i = 0; i < 2; i++) {
    const proof = await smokeMe2UiBundle(root, process.execPath, 10_000, SHA);
    assert.equal(proof.runtime_smoke, 'PASS');
    assert.equal(proof.post_exit_content_verified, true);
    assert.equal(proof.post_exit_manifest_sha256, before.manifest_sha256);
    assert.deepEqual(verifyMe2UiBundle(root, SHA), before);
  }
});

for (const [name, mutation, error] of [
  ['same-size asset overwrite', "fs.writeFileSync(asset, 'BBBB');", /me2_ui_content_inventory_mismatch/],
  ['extra cache file', "fs.writeFileSync(path.join(root, 'runtime-cache'), '');", /me2_ui_content_inventory_mismatch/],
  ['deleted asset', 'fs.unlinkSync(asset);', /me2_ui_content_inventory_mismatch/],
  ['self-rehashed rewritten manifest', `
    fs.writeFileSync(asset, 'BBBB');
    const hash = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
    const file = path.join(root, 'me2-ui-manifest.json'), manifest = JSON.parse(fs.readFileSync(file));
    manifest.content_files.find(row => row.path === '.next/static/chunk.js').sha256 = hash('BBBB');
    manifest.content_sha256 = hash(JSON.stringify(manifest.content_files));
    fs.writeFileSync(file, JSON.stringify(manifest));
  `, /me2_ui_manifest_changed_during_smoke/],
]) test(`smoke rejects ${name} performed during child shutdown`, {
  skip: process.platform === 'win32' ? 'Windows termination does not execute the POSIX SIGTERM fixture handler' : false,
}, async t => {
  const root = fixture(t, mutation);
  await assert.rejects(smokeMe2UiBundle(root, process.execPath, 10_000, SHA), error);
});

test('smoke rejects the wrong expected source before launching', async t => {
  const root = fixture(t);
  await assert.rejects(smokeMe2UiBundle(root, process.execPath, 10_000, 'b'.repeat(40)), /me2_ui_source_sha_mismatch/);
});
