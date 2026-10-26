import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { inventoryUiContent, validateUiContentManifest } from '../../me2-ui/scripts/ui-content-inventory.mjs';
import { verifyMe2UiBundle } from '../scripts/verify-me2-ui-bundle.mjs';
const SHA = 'a'.repeat(40);
const packScripts = fileURLToPath(new URL('../../me2-ui/scripts/', import.meta.url));
const digest = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'me2-ui-content-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, 'scripts'); fs.mkdirSync(scripts);
  for (const file of ['pack-me2-ui.mjs', 'ui-content-inventory.mjs']) fs.copyFileSync(path.join(packScripts, file), path.join(scripts, file));
  const source = path.join(root, '.next', 'standalone');
  const put = (file, data) => { const full = path.join(source, file); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, data); };
  put('server.js', 'console.log("AAAA");\n'); put('package.json', JSON.stringify({ name: 'fixture', version: '1.0.0' }));
  put('.next/BUILD_ID', 'build-123456'); put('.next/static/chunk.js', 'AAAA');
  for (const name of ['next', 'react', 'react-dom']) put(`node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0' }));
  put('node_modules/next/dist/server/lib/start-server.js', 'module.exports = {};');
  execFileSync(process.execPath, [path.join(scripts, 'pack-me2-ui.mjs')], { env: { ...process.env, ME2_BUILD_SHA: SHA }, stdio: 'pipe' });
  const dist = path.join(root, 'me2-ui-dist');
  const manifestPath = path.join(dist, 'me2-ui-manifest.json');
  return { root, dist, manifestPath, manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) };
}
test('real UI packer and installed verifier bind deterministic file content', t => {
  const f = fixture(t); const proof = verifyMe2UiBundle(f.dist, SHA);
  assert.equal(proof.content_sha256, f.manifest.content_sha256);
  assert.equal(proof.content_hash_scheme, 'path-file-sha256-v1');
  assert.equal(proof.content_file_count, f.manifest.content_files.length);
  assert.deepEqual(inventoryUiContent(f.dist), inventoryUiContent(f.dist));
  assert.equal(proof.runtime_smoke, 'NOT_RUN');
});
for (const [name, mutate] of [
  ['same-size server mutation', f => fs.writeFileSync(path.join(f.dist, 'server.js'), 'console.log("BBBB");\n')],
  ['same-size static asset mutation', f => fs.writeFileSync(path.join(f.dist, '.next/static/chunk.js'), 'BBBB')],
  ['same-size dependency mutation', f => fs.writeFileSync(path.join(f.dist, 'node_modules/next/dist/server/lib/start-server.js'), 'module.exports = [];')],
  ['added empty file', f => fs.writeFileSync(path.join(f.dist, 'extra.js'), '')],
  ['removed content', f => fs.unlinkSync(path.join(f.dist, '.next/static/chunk.js'))],
  ['renamed same-byte content', f => fs.renameSync(path.join(f.dist, '.next/static/chunk.js'), path.join(f.dist, '.next/static/other.js'))],
]) test(`installed UI refuses ${name}`, t => {
  const f = fixture(t); mutate(f); assert.throws(() => verifyMe2UiBundle(f.dist, SHA), /me2_ui_content_/);
});
test('metadata-only legacy digest cannot be accepted as content binding', t => {
  const f = fixture(t); delete f.manifest.content_hash_scheme; delete f.manifest.content_files;
  fs.writeFileSync(f.manifestPath, JSON.stringify(f.manifest));
  assert.throws(() => verifyMe2UiBundle(f.dist, SHA), /me2_ui_content_scheme_invalid/);
});
test('manifest fields cannot silently authorize changed inventory', t => {
  const f = fixture(t);
  for (const change of [m => m.content_sha256 = '0'.repeat(64), m => m.content_files.reverse(),
    m => m.content_files[0].size_bytes++, m => m.content_files[0].path = '../escape',
    m => m.content_files.push(m.content_files[0]), m => m.content_files[0].unexpected = true]) {
    const m = structuredClone(f.manifest); change(m); assert.throws(() => validateUiContentManifest(m), /me2_ui_content_/);
  }
});
test('changed on-disk bytes are refused even if metadata inventory total remains equal', t => {
  const f = fixture(t); const row = f.manifest.content_files.find(x => x.path === 'server.js');
  row.sha256 = '0'.repeat(64); f.manifest.content_sha256 = digest(f.manifest.content_files);
  fs.writeFileSync(f.manifestPath, JSON.stringify(f.manifest));
  assert.throws(() => verifyMe2UiBundle(f.dist, SHA), /me2_ui_content_inventory_mismatch/);
});
test('mtime and root relocation do not change content identity', t => {
  const f = fixture(t); const before = inventoryUiContent(f.dist);
  fs.utimesSync(path.join(f.dist, 'server.js'), new Date(1), new Date(1));
  const other = path.join(f.root, 'relocated'); fs.cpSync(f.dist, other, { recursive: true });
  assert.deepEqual(inventoryUiContent(other), before);
});
test('UI inventory refuses escaping links and directory cycles', { skip: process.platform === 'win32' ? 'symlink creation needs separate Windows privilege qualification' : false }, t => {
  const f = fixture(t); const external = path.join(f.root, 'outside.js'); fs.writeFileSync(external, 'secret');
  const link = path.join(f.dist, 'link.js'); fs.symlinkSync(external, link);
  assert.throws(() => inventoryUiContent(f.dist), /me2_ui_content_outside_bundle/); fs.unlinkSync(link);
  fs.symlinkSync(f.dist, path.join(f.dist, 'cycle'));
  assert.throws(() => inventoryUiContent(f.dist), /me2_ui_content_directory_cycle/);
});
test('in-bundle file links are content-bound and cannot hide mutation', { skip: process.platform === 'win32' ? 'symlink creation needs separate Windows privilege qualification' : false }, t => {
  const f = fixture(t); fs.symlinkSync('server.js', path.join(f.dist, 'linked.js'));
  const before = inventoryUiContent(f.dist); fs.writeFileSync(path.join(f.dist, 'server.js'), 'console.log("BBBB");\n');
  assert.notEqual(inventoryUiContent(f.dist).content_sha256, before.content_sha256);
});
