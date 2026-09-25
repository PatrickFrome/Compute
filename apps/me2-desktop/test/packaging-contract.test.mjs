import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');

test('electron-builder.yml: me2-ui rides as extraResources WITH explicit node_modules rule', () => {
  const yml = readFileSync(join(APP, 'electron-builder.yml'), 'utf8');
  assert.ok(yml.includes('from: me2-ui-dist'), 'me2-ui-dist copy rule missing');
  assert.ok(yml.includes('to: me2-ui'), 'me2-ui destination missing');
  // THE R77 FIX — regression guard at config level:
  assert.ok(yml.includes('from: me2-ui-dist/node_modules'), 'explicit node_modules rule missing (R77 defect would return)');
  assert.ok(yml.includes('to: me2-ui/node_modules'), 'node_modules destination missing');
});

test('electron-builder.yml: hardening contract (asar, fuses, beforePack)', () => {
  const yml = readFileSync(join(APP, 'electron-builder.yml'), 'utf8');
  assert.ok(yml.includes('asar: true'));
  assert.ok(yml.includes('enableEmbeddedAsarIntegrityValidation: true'));
  assert.ok(yml.includes('onlyLoadAppFromAsar: true'));
  assert.ok(yml.includes('beforePack: ./scripts/electron-builder-before-pack.cjs'));
});

test('beforePack hook: refuses packaging without physical UI artifact', async () => {
  const { pathToFileURL } = await import('node:url');
  const mod = await import(pathToFileURL(join(APP, 'scripts', 'electron-builder-before-pack.cjs')).href);
  const fakeContext = { packager: { appInfo: { projectDir: join(APP, 'test', 'fixtures', 'empty-project') } } };
  await assert.rejects(() => mod.default(fakeContext), /me2_ui_dist_missing/);
});

test('pack-me2-ui contract: manifest schema constant is the release contract', () => {
  const script = readFileSync(join(APP, 'scripts', 'pack-me2-ui.mjs'), 'utf8');
  assert.ok(script.includes('me2.ui-bundle-manifest.v1'));
  assert.ok(script.includes('node_modules_included'));
  assert.ok(script.includes('standalone/node_modules отсутствует') || script.includes('node_modules`)'), 'packer must hard-require node_modules');
});

test('verify-installed-bundle exists and checks the four R77 blind spots', () => {
  const p = join(APP, 'scripts', 'verify-installed-bundle.mjs');
  assert.equal(existsSync(p), true);
  const src = readFileSync(p, 'utf8');
  assert.ok(src.includes('MODULE_NOT_FOUND') || src.includes('Cannot find module'), 'must reject module-not-found runs');
  assert.ok(src.includes('node_modules'), 'must check deps');
  assert.ok(src.includes('me2-ui-manifest.json'), 'must check manifest sha');
  assert.ok(src.includes('.next/static'), 'must check static assets');
});
