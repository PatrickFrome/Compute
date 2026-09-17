import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildMonacoAssets } = require('../scripts/build-monaco-assets.cjs');

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(TEST_DIR, '..');

async function source(relative) {
  return readFile(path.join(APP_ROOT, relative), 'utf8');
}

test('Monaco toolchain is exact, build-only, local and ESM', async () => {
  const pkg = JSON.parse(await source('package.json'));
  assert.equal(pkg.dependencies?.['monaco-editor'], undefined);
  assert.equal(pkg.devDependencies?.['monaco-editor'], '0.56.0');
  assert.equal(pkg.devDependencies?.esbuild, '0.28.2');
  assert.equal(pkg.scripts?.['build:ide'], 'node scripts/build-monaco-assets.cjs');
  assert.equal(pkg.scripts?.prestart, 'npm run build:ide');

  const entry = await source('src/ide/monaco-entry.mjs');
  assert.match(entry, /from 'monaco-editor\/editor'/);
  assert.match(entry, /monaco-editor\/features\/register\.all/);
  assert.match(entry, /monaco-editor\/languages\/definitions\/register\.all/);
  assert.match(entry, /metaengine:\/\/shell\/ide\/editor\.worker\.js/);
  assert.doesNotMatch(entry, /https?:\/\//);
  assert.doesNotMatch(entry, /\beval\s*\(|new Function\s*\(/);
  assert.match(entry, /amd: false/);
  assert.match(entry, /remote_assets: false/);
  assert.match(entry, /automatic_save: false/);
});

test('Monaco bundle builds locally with JS, CSS and dedicated worker assets', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'metaengine-monaco-build-'));
  try {
    const receipt = await buildMonacoAssets({ appRoot: APP_ROOT, outputDir });
    assert.equal(receipt.schema, 'metaengine.devos.ide.monaco-build.v1');
    assert.equal(receipt.monaco_version, '0.56.0');
    assert.equal(receipt.remote_assets, false);
    assert.equal(receipt.amd_loader, false);
    for (const name of ['editor.js', 'editor.css', 'editor.worker.js']) {
      const info = await stat(path.join(outputDir, name));
      assert.equal(info.isFile(), true, name);
      assert.ok(info.size > 0, name);
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test('packaging builds Monaco before file collection and runtime serves only confined IDE assets', async () => {
  const beforePack = await source('scripts/electron-builder-before-pack.cjs');
  const main = await source('src/main.mjs');
  assert.match(beforePack, /await buildMonacoAssets\(\{ appRoot \}\)/);
  assert.ok(beforePack.indexOf('await buildMonacoAssets({ appRoot })') < beforePack.indexOf("electronPlatformName !== 'win32'"));

  assert.match(main, /IDE_ASSET_ROOT = path\.join\(UI_ROOT, 'ide-dist'\)/);
  assert.match(main, /function resolveIdeAsset\(rel\)/);
  assert.match(main, /segment === '\.\.'+/);
  assert.match(main, /path\.relative\(IDE_ASSET_ROOT, target\)/);
  assert.match(main, /\^\[A-Za-z0-9\._-\]\+\$/);
  assert.match(main, /'ide-shell\.mjs'/);
  assert.match(main, /metaengine:shell:ide:source/);
  assert.match(main, /metaengine:shell:ide:read/);
  assert.match(main, /metaengine:shell:ide:save/);
  assert.match(main, /source_kind: source\.packaged_source_snapshot === true \? 'PACKAGED_SNAPSHOT' : 'LIVE_GIT'/);
  assert.match(main, /write_available: source\.packaged_source_snapshot !== true/);
  assert.doesNotMatch(main, /metaengine:shell:ide:[^'"]*eval/i);
});

test('preload exposes typed IDE methods without arbitrary command or filesystem primitives', async () => {
  const preload = await source('src/preload-shell.cjs');
  assert.match(preload, /ide: Object\.freeze\(\{/);
  assert.match(preload, /metaengine:shell:ide:source/);
  assert.match(preload, /metaengine:shell:ide:read/);
  assert.match(preload, /metaengine:shell:ide:save/);
  assert.match(preload, /automatic_retry_allowed: false/);
  const block = preload.slice(preload.indexOf('ide: Object.freeze({'), preload.indexOf('presentationFocus:', preload.indexOf('ide: Object.freeze({')));
  assert.doesNotMatch(block, /exec|spawn|fork|eval|require\(/);
});

test('IDE shell has explicit save, blocks ambiguous retry and reconciles by readback', async () => {
  const shell = await source('ui/ide-shell.mjs');
  assert.match(shell, /autosave: false/);
  assert.match(shell, /READ ONLY SNAPSHOT/);
  assert.match(shell, /readOnly: state\.write_available !== true/);
  assert.match(shell, /state\.write_available !== true \|\| !state\.dirty/);
  assert.match(shell, /ambiguous_save_requires_reconcile: true/);
  assert.match(shell, /if \(!state\.relative_path \|\| state\.write_available !== true \|\| !state\.dirty \|\| state\.ambiguous \|\| !editorHandle\) return;/);
  assert.match(shell, /state\.ambiguous = \/ambiguous\/i\.test\(message\)/);
  assert.match(shell, /const receipt = validateRead\(await apiRef\.ide\.read/);
  assert.match(shell, /adoptRead\(receipt, \{ preserveText: desired \}\)/);
  assert.doesNotMatch(shell, /setInterval|setTimeout|https?:\/\//);
});

test('main shell lazily mounts IDE and Ctrl+S remains an explicit user gesture', async () => {
  const app = await source('ui/app.js');
  const html = await source('ui/index.html');
  assert.match(html, /data-section="ide">Editor</);
  assert.match(app, /import\('metaengine:\/\/shell\/ide-shell\.mjs'\)/);
  assert.match(app, /opsSection === 'ide'/);
  assert.match(app, /event\.key\.toLowerCase\(\) === 's' && opsSection === 'ide'/);
  assert.match(app, /module\.saveIdeShell\(\)/);
  assert.doesNotMatch(app, /metaengine:shell:ide:save/);
});
