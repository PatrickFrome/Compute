import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const browserRoot = path.resolve(here, '..');
const repoRoot = path.resolve(browserRoot, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(repoRoot, relative), 'utf8');
}

test('multi-surface release head contains no temporary wiring authority', () => {
  const forbidden = [
    '.github/workflows/devos-multisurface-wire-temp.yml',
    '.github/workflows/devos-electron-physical-diagnostic-temp.yml',
    '.github/scripts/patch-devos-multisurface-temp.mjs',
    '.github/scripts/patch-devos-multisurface-narrow-ipc-temp.mjs',
    '.github/scripts/patch-devos-source-finalize-temp.mjs',
  ];
  for (const relative of forbidden) {
    assert.equal(fs.existsSync(path.join(repoRoot, relative)), false, `${relative} must not survive product self-clean`);
  }
});

test('physical multi-surface proof requires live renderer identity, native bounds and focus without weakening sandbox', () => {
  const source = read('apps/metaengine-browser/test/browser-devos-multisurface-physical.electron.mjs');
  assert.match(source, /getOSProcessId\(\)/);
  assert.match(source, /getBounds\(\)/);
  assert.match(source, /isFocused\(\)/);
  assert.match(source, /simultaneously_attached_webcontents_views/);
  assert.match(source, /renderer_process_proven: true/);
  assert.match(source, /app\.enableSandbox\(\)/);
  assert.doesNotMatch(source, /--no-sandbox/);
  assert.doesNotMatch(source, /capturePage\(/);
});

test('presentation hot paths consume the bounded cached DevOS source projection instead of reading Development Plane directly', () => {
  const source = read('apps/metaengine-browser/src/main.mjs');
  assert.equal((source.match(/devos_sources: devosSourceSnapshot,/g) || []).length, 3);
  assert.match(source, /devosSourceSnapshot = projectDevOSDevelopmentSources\(\{/);
  const presentationIntent = source.slice(source.indexOf('function currentDevOSPresentationProjection'), source.indexOf('function currentDevOSPresentationShellView'));
  const presentationShell = source.slice(source.indexOf('function currentDevOSPresentationShellView'), source.indexOf('function currentWorkspaceWorkbenchSnapshot'));
  for (const block of [presentationIntent, presentationShell]) {
    assert.doesNotMatch(block, /developmentPlane\?\.snapshot|developmentPlane\.snapshot|projectDevOSDevelopmentSources/);
    assert.match(block, /devosSourceSnapshot/);
  }
});
