import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainUrl = new URL('../src/main.mjs', import.meta.url);
const preloadUrl = new URL('../src/preload-shell.cjs', import.meta.url);
const workbenchUrl = new URL('../src/workspace-workbench-projection.mjs', import.meta.url);

async function sources() {
  const [main, preload, workbench] = await Promise.all([
    readFile(mainUrl, 'utf8'),
    readFile(preloadUrl, 'utf8'),
    readFile(workbenchUrl, 'utf8'),
  ]);
  return { main, preload, workbench };
}

test('main process owns the only DevOS presentation focus state and injects its snapshot into the shell projection', async () => {
  const { main, workbench } = await sources();
  assert.match(main, /import \{ createDevOSPresentationFocusState \} from '\.\/metaengine-devos-presentation-focus\.mjs';/);
  assert.match(main, /const devosPresentationFocus = createDevOSPresentationFocusState\(\);/);
  assert.match(main, /presentation_focus: devosPresentationFocus\.snapshot\(\)/);
  assert.match(workbench, /projectDevOSShellViewModel\(devos,snapshot\?\.presentation_focus\?\?null\)/);
  assert.doesNotMatch(workbench, /selected_tab_id.*presentation_focus/s);
});

test('presentation focus IPC is sender-validated and physically separate from Browser SELECT_TAB authority', async () => {
  const { main } = await sources();
  for (const channel of [
    'metaengine:shell:presentation-focus:snapshot',
    'metaengine:shell:presentation-focus:select-session',
    'metaengine:shell:presentation-focus:select-surface',
    'metaengine:shell:presentation-focus:clear',
  ]) {
    const index = main.indexOf(`ipcMain.handle('${channel}'`);
    assert.ok(index >= 0, `missing ${channel}`);
    const block = main.slice(index, index + 520);
    assert.match(block, /assertShellSender\(event\);/);
    assert.doesNotMatch(block, /registry\.select\(/);
    assert.doesNotMatch(block, /handleCommand\(/);
  }
  assert.match(main, /if \(command === 'SELECT_TAB'\) \{ registry\.select\(payload\?\.tab_id\);/);
  assert.doesNotMatch(main.slice(main.indexOf('async function handleCommand'), main.indexOf('function tabForPlatform')), /presentation-focus/);
});

test('sandbox preload exposes bounded focus methods instead of raw ipcRenderer or the generic command path', async () => {
  const { preload } = await sources();
  const start = preload.indexOf('presentationFocus: Object.freeze({');
  assert.ok(start >= 0);
  const block = preload.slice(start, start + 900);
  assert.match(block, /snapshot: \(\) => ipcRenderer\.invoke\('metaengine:shell:presentation-focus:snapshot'\)/);
  assert.match(block, /selectSession: \(sessionId\) => ipcRenderer\.invoke\('metaengine:shell:presentation-focus:select-session'/);
  assert.match(block, /selectSurface: \(sessionId, surfaceId\) => ipcRenderer\.invoke\('metaengine:shell:presentation-focus:select-surface'/);
  assert.match(block, /clear: \(\) => ipcRenderer\.invoke\('metaengine:shell:presentation-focus:clear'\)/);
  assert.doesNotMatch(block, /metaengine:shell:command/);
  assert.doesNotMatch(block, /ipcRenderer:\s*ipcRenderer/);
});
