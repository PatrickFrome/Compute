import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindStartupManifest, captureStartupSource, persistStartupManifest, safeRuntimePolicy, sourceClosure } from './startup-source-manifest.mjs';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const here = fileURLToPath(new URL('.', import.meta.url));

test('source closure includes side-effect, re-export and dynamic literal imports', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'compute-source-closure-'));
  try {
    await writeFile(join(directory, 'entry.mjs'), "import './side.mjs'; export {value} from './export.mjs'; await import('./dynamic.mjs');\n");
    for (const name of ['side.mjs', 'export.mjs', 'dynamic.mjs']) await writeFile(join(directory, name), 'export const value=1;\n');
    const closure = await sourceClosure([join(directory, 'entry.mjs')], directory);
    assert.equal(closure.files.length, 4);
    await writeFile(join(directory, 'entry.mjs'), "import '../outside.mjs';\n");
    await assert.rejects(sourceClosure([join(directory, 'entry.mjs')], directory), /source_outside_repository/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('startup manifest hashes dependencies, binds instance and omits credential material', async () => {
  const config = { postgresMode: 'attached', databasePort: 15434, apiPort: 15432, edgePort: 15433,
    databaseUrl: 'postgres://user:never-report-password@127.0.0.1/db', apiKey: 'never-report-key' };
  const before = await captureStartupSource({ repositoryRoot, entries: [join(here, 'launcher-fixture.mjs')], fixture: true, policy: safeRuntimePolicy(config, { fixture: true }) });
  const manifest = bindStartupManifest({ before, after: structuredClone(before), instanceId: '11111111-1111-4111-8111-111111111111',
    endpoint: 'http://127.0.0.1:15433/a2-browser-native-supervisor-v1', children: [], startedAt: new Date().toISOString(), readyAt: new Date().toISOString() });
  assert.equal(manifest.stable_during_startup, true);
  assert.equal(manifest.private_material_included, false);
  assert.ok(manifest.source.files.some((file) => file.id.startsWith('node_npm/postgres@3.4.7/')));
  const text = JSON.stringify(manifest);
  assert.equal(text.includes('never-report'), false);
  assert.equal(text.includes('postgres://'), false);
  assert.equal(text.includes(repositoryRoot), false);
  await assert.rejects(persistStartupManifest(join(repositoryRoot, 'should-not-write.json'), manifest, repositoryRoot), /private_output_required/);
  const directory = await mkdtemp(join(tmpdir(), 'compute-startup-receipt-'));
  try {
    const path = join(directory, 'receipt.json');
    await persistStartupManifest(path, manifest, repositoryRoot);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).instance_id, manifest.instance_id);
    await assert.rejects(persistStartupManifest(path, manifest, repositoryRoot), { code: 'EEXIST' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('startup bytes drift cannot become readiness and dependency aliases are rejected', async () => {
  const before = { manifest_sha256: 'a', files: [] };
  assert.throws(() => bindStartupManifest({ before, after: { manifest_sha256: 'b' }, instanceId: '11111111-1111-4111-8111-111111111111' }), /source_changed_during_launch/);
  const directory = await mkdtemp(join(tmpdir(), 'compute-source-alias-'));
  try {
    await mkdir(join(directory, 'actual'));
    await writeFile(join(directory, 'actual/x.mjs'), 'export{};');
    await symlink(join(directory, 'actual'), join(directory, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(sourceClosure([join(directory, 'alias/x.mjs')], directory), /alias_path_forbidden/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
