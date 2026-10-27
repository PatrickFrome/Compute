// Disposable filesystem fixtures only: no native runtime, installation or key custody.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { capturePackageCodeW68, verifyPackageCodeW68, validatePackageCodeManifestW68,
  serializePackageCodeManifestW68, PACKAGE_CODE_FILE_W68 } from '../src/installed-package-code-w68.mjs';
import { writePackagedCodeInventoryW77 } from '../scripts/release-proof-producer-w77.mjs';

const expected = { sourceSha: 'a'.repeat(40), version: '0.7.0-dev.999900004.1',
  exeName: 'METAENGINE Browser Test.exe' };
const runtimeFiles = [expected.exeName, 'resources/app.asar',
  'resources/app.asar.unpacked/src/compute-bridge-worker.cjs',
  'resources/guardian-native/guardian.exe', 'resources/guardian-bootstrap/bootstrap.exe',
  'resources/client-state-runtime/bin/postgres.exe', 'resources/client-state-runtime/runtime-host.mjs',
  'resources/native-coding/agent-mcp/native-coding-agent-mcp-entry.mjs',
  'resources/native-coding/codex-cli-job-runner.ps1',
  'resources/a2-compute-browser/src/index.mjs', 'resources/browser-shared/action-contract.mjs',
  'resources/me2-daemon/server.js', 'resources/me2-ui/node_modules/example/index.js',
  'resources/devos-source-snapshot/index.json', 'locales/en-US.pak',
  'v8_context_snapshot.bin', 'libEGL.dll'];

async function fixture(t) {
  const outDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'w68-code-STAGING-')));
  t.after(() => fs.rm(outDir, { recursive:true, force:true }));
  const root = path.join(outDir, 'win-unpacked');
  for (const name of runtimeFiles) {
    const file = path.join(root, name);
    await fs.mkdir(path.dirname(file), { recursive:true });
    await fs.writeFile(file, 'fixture bytes: ' + name);
  }
  const capture = () => capturePackageCodeW68(root, expected);
  return { outDir, root, capture, code: await capture() };
}

test('entire physical packaged tree, not an extension allowlist, is deterministic and byte-bound', async t => {
  const f = await fixture(t);
  assert.equal(f.code.fileCount, runtimeFiles.length);
  assert.deepEqual(f.code.bytes, (await f.capture()).bytes);
  assert.deepEqual(f.code.manifest.entries.filter(e => e.kind === 'file').map(e => e.path).sort(), runtimeFiles.sort());
  assert.equal((await verifyPackageCodeW68(f.root, f.code.bytes, expected)).sha256, f.code.sha256);
  for (const name of runtimeFiles) {
    const target = path.join(f.root, name), original = await fs.readFile(target);
    const edited = Buffer.from(original); edited[0] ^= 1;
    await fs.writeFile(target, edited);
    await assert.rejects(() => verifyPackageCodeW68(f.root, f.code.bytes, expected), /tree_mismatch/);
    await fs.writeFile(target, original);
  }
});

test('added, missing and fallback executable code are rejected, including outside resources', async t => {
  const f = await fixture(t);
  for (const name of ['resources/extra.js', 'unexpected.dll', 'resources/app/index.js']) {
    const target = path.join(f.root, name);
    await fs.mkdir(path.dirname(target), { recursive:true }); await fs.writeFile(target, 'extra');
    await assert.rejects(() => verifyPackageCodeW68(f.root, f.code.bytes, expected), /tree_mismatch|manifest_path/);
    await fs.rm(target);
    if (name.includes('/app/')) await fs.rmdir(path.dirname(target));
  }
  await fs.rm(path.join(f.root, 'resources/app.asar'));
  await assert.rejects(f.capture, /required_code_missing/);
});

test('producer writes actual code bytes outside package and refuses overwrite or packaged proof files', async t => {
  const f = await fixture(t);
  const write = () => writePackagedCodeInventoryW77({ appOutDir:f.root, outDir:f.outDir, ...expected });
  const result = await write();
  assert.equal(result.path, path.join(f.outDir, PACKAGE_CODE_FILE_W68));
  assert.equal(result.package_code_sha256, f.code.sha256);
  assert.deepEqual(await fs.readFile(result.path), f.code.bytes);
  assert.equal(result.installed_authority, false);
  await assert.rejects(write, /EEXIST/);
  await fs.writeFile(path.join(f.root, PACKAGE_CODE_FILE_W68), f.code.bytes);
  await assert.rejects(f.capture, /reserved_package_entry/);
  assert.ok(await verifyPackageCodeW68(f.root, f.code.bytes, expected));
});

test('NSIS uninstaller is the only non-proof installed-only exclusion and cannot be a directory', async t => {
  const f = await fixture(t), uninstaller = path.join(f.root, 'Uninstall METAENGINE Browser Test.exe');
  await fs.writeFile(uninstaller, 'fixture NSIS uninstaller, never app runtime');
  assert.ok(await verifyPackageCodeW68(f.root, f.code.bytes, expected));
  await assert.rejects(f.capture, /reserved_package_entry/);
  await fs.rm(uninstaller); await fs.mkdir(uninstaller);
  await assert.rejects(() => verifyPackageCodeW68(f.root, f.code.bytes, expected), /reserved_package_entry/);
});

test('hardlinks, file/directory symlinks, alias roots and Windows ambiguous filenames fail closed', async t => {
  const f = await fixture(t), worker = path.join(f.root, runtimeFiles.find(n => n.endsWith('.cjs')));
  const link = path.join(f.outDir, 'linked-worker');
  await fs.link(worker, link);
  await assert.rejects(f.capture, /nonphysical_path/); await fs.rm(link);
  for (const [target, name, type] of [[worker, 'resources/linked.cjs', 'file'],
    [path.join(f.root, 'resources'), 'linked-resources', 'junction']]) {
    const alias = path.join(f.root, name);
    try { await fs.symlink(target, alias, type); }
    catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.diagnostic('symlinks unavailable'); continue; } throw error; }
    await assert.rejects(f.capture, /nonphysical_path/); await fs.rm(alias);
  }
  if (process.platform !== 'win32') {
    for (const name of ['evil.js:stream', 'alias. ', 'CON.js', 'resources/APP.asar']) {
      const file = path.join(f.root, name); await fs.writeFile(file, 'ambiguous');
      await assert.rejects(f.capture, /filename|case_alias/); await fs.rm(file);
    }
    const alias = path.join(f.outDir, 'root-alias'); await fs.symlink(f.root, alias, 'dir');
    await assert.rejects(() => capturePackageCodeW68(alias, expected), /nonphysical_path/);
  }
});

test('late same-length worker mutation, new files and replaced directories invalidate capture fence', async t => {
  const f = await fixture(t);
  const worker = path.join(f.root, 'resources/me2-daemon/server.js');
  const original = await fs.readFile(worker), changed = Buffer.from(original); changed[0] ^= 1;
  await fs.writeFile(worker, changed); await assert.rejects(f.code.fence, /tree_toctou/);
  await fs.writeFile(worker, original);
  const beforeAdd = await f.capture();
  await fs.writeFile(path.join(f.root, 'resources/new.js'), 'new');
  await assert.rejects(beforeAdd.fence, /tree_toctou/);
  await fs.rm(path.join(f.root, 'resources/new.js'));
  const beforeSwap = await f.capture(), old = path.join(f.outDir, 'old-daemon');
  await fs.rename(path.dirname(worker), old); await fs.mkdir(path.dirname(worker));
  await fs.writeFile(worker, original); await assert.rejects(beforeSwap.fence, /tree_toctou/);
});

test('manifest traversal, duplicates, case aliases, metadata drift, noncanonical bytes are refused', async t => {
  const f = await fixture(t);
  for (const name of ['../escape', '/absolute', 'resources/../escape', 'resources/worker.js:ads', 'resources/con']) {
    const doc = structuredClone(f.code.manifest); doc.entries[0].path = name;
    assert.throws(() => validatePackageCodeManifestW68(doc, expected), /manifest_path/);
  }
  for (const override of [{ sourceSha:'b'.repeat(40) }, { version:'0.7.0-dev.999900005.1' }, { exeName:'other.exe' }]) {
    await assert.rejects(() => verifyPackageCodeW68(f.root, f.code.bytes, { ...expected, ...override }), /manifest_schema/);
  }
  const dupe = structuredClone(f.code.manifest); dupe.entries.push(dupe.entries[0]);
  assert.throws(() => serializePackageCodeManifestW68(dupe), /manifest_path/);
  await assert.rejects(() => verifyPackageCodeW68(f.root, Buffer.concat([f.code.bytes, Buffer.from(' ')]), expected), /noncanonical_manifest/);
});

test('ordinary configured packaging awaits inventory emission and existing candidate workflow retains artifact', async () => {
  const app = fileURLToPath(new URL('..', import.meta.url));
  const config = JSON.parse(await fs.readFile(path.join(app, 'electron-builder.test.json')));
  assert.equal(config.afterAllArtifactBuild, './scripts/electron-builder-after-all-artifact-build.cjs');
  const hook = await fs.readFile(path.join(app, config.afterAllArtifactBuild), 'utf8');
  assert.match(hook, /await writePackagedCodeInventoryW77\(\{ appOutDir, outDir,/);
  assert.ok(hook.indexOf('await writePackagedCodeInventoryW77') > hook.indexOf('packaged_asar_only_fuse_not_enabled'));
  const workflow = await fs.readFile(path.join(app, '../../.github/workflows/browser-windows-package-smoke.yml'), 'utf8');
  assert.match(workflow, /\$\{\{ runner\.temp \}\}\/metaengine-installed-package-code\.v1\.json/);
  const candidate = workflow.slice(workflow.indexOf('name: Publish immutable candidate for parallel'),
    workflow.indexOf('name: Publish immutable candidate for parallel') + 3300);
  assert.doesNotMatch(candidate.slice(0,candidate.indexOf('if-no-files-found')), /github\.workspace/,
    'candidate artifact must preserve the existing runner.temp sibling layout');
  assert.match(hook,/const inventoryTarget = path\.join\(runnerTemp, path\.basename\(packageCode\.path\)\)/);
  assert.match(hook,/packaged_code_inventory_stage_readback_mismatch/);
});

test('Electron selection hashes physical ASAR bytes through original-fs, never patched fs or a global toggle', async t => {
  const f = await fixture(t);
  const original = path.join(f.outDir, 'original-fs-fixture.cjs');
  await fs.writeFile(original, "module.exports = require('node:fs');\n");
  const moduleUrl = new URL('../src/installed-package-code-w68.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {registerHooks} from 'node:module';
    Object.defineProperty(process.versions,'electron',{value:'fixture-only'});
    Object.defineProperty(process,'noAsar',{get(){throw Error('global_ASAR_toggle_forbidden')},
      set(){throw Error('global_ASAR_toggle_forbidden')}});
    let physicalReads=0;
    registerHooks({resolve(specifier,context,next){
      if(specifier==='original-fs'){physicalReads++;return {shortCircuit:true,format:'commonjs',url:${JSON.stringify(pathToFileURL(original).href)}};}
      if(specifier==='node:fs/promises') return {shortCircuit:true,url:
        'data:text/javascript,'+encodeURIComponent('export default new Proxy({}, {get(){throw Error("patched_fs_forbidden")}})')};
      return next(specifier,context);
    }});
    const {capturePackageCodeW68}=await import(${JSON.stringify(moduleUrl)});
    const code=await capturePackageCodeW68(${JSON.stringify(f.root)},${JSON.stringify(expected)});
    assert.equal(code.sha256,${JSON.stringify(f.code.sha256)});
    assert.equal(physicalReads,1);
  `], { encoding:'utf8', timeout:15000 });
  assert.equal(child.status,0,child.stdout + child.stderr);
});

test('case variants cannot bypass app fallback refusal, canonical ASAR entrypoint or reserved names', async t => {
  const f = await fixture(t);
  const fallback = path.join(f.root, 'resources/App');
  await fs.mkdir(fallback); await fs.writeFile(path.join(fallback,'index.js'),'fallback');
  await assert.rejects(f.capture,/manifest_path/);
  await fs.rm(fallback,{recursive:true});
  await fs.rename(path.join(f.root,'resources/app.asar'),path.join(f.root,'resources/APP.ASAR'));
  await fs.writeFile(path.join(f.root,'resources/APP.ASAR'),'');
  await assert.rejects(f.capture,/required_code_missing/);
  await fs.rename(path.join(f.root,'resources/APP.ASAR'),path.join(f.root,'resources/app.asar'));
  await fs.writeFile(path.join(f.root,'resources/app.asar'),'nonempty fixture');
  for (const alias of ['UNINSTALL METAENGINE BROWSER TEST.EXE','METAENGINE-INSTALLED-PACKAGE-CODE.V1.JSON']) {
    const target=path.join(f.root,alias);await fs.writeFile(target,'alias');
    await assert.rejects(()=>capturePackageCodeW68(f.root,{...expected,installed:true}),/reserved_package_entry/);
    await assert.rejects(f.capture,/reserved_package_entry/);await fs.rm(target);
  }
});
