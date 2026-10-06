import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const viewModel = await readFile(new URL('../src/metaengine-devos-shell-view-model.mjs', import.meta.url), 'utf8');
const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');

test('legacy Session renderer is retired and selection remains a main/core projection', async () => {
  await assert.rejects(access(new URL('../ui/app.js', import.meta.url)), /ENOENT/);
  assert.match(viewModel, /selected_session_surfaces/);
  assert.match(viewModel, /PRESENTATION_FOCUS_OWNERSHIP_MISMATCH/);
  assert.match(viewModel, /SELECTED_SESSION_SURFACE_MEMBERSHIP_INVALID/);
  assert.match(viewModel, /stored_surface_is_selection_authority: false/);
  assert.doesNotMatch(viewModel, /api\.command|ipcRenderer|executeJavaScript/);
});

test('preload exposes only narrow Session/Surface presentation focus methods', () => {
  assert.match(preload, /presentationFocus: Object\.freeze\(\{/);
  assert.match(preload, /selectSession: \(sessionId\) => ipcRenderer\.invoke\('metaengine:shell:presentation-focus:select-session'/);
  assert.match(preload, /selectSurface: \(sessionId, surfaceId\) => ipcRenderer\.invoke\('metaengine:shell:presentation-focus:select-surface'/);
  assert.match(preload, /setLayout: \(sessionId, layoutMode\) => ipcRenderer\.invoke\('metaengine:shell:presentation-layout:set'/);
  assert.match(preload, /clear: \(\) => ipcRenderer\.invoke\('metaengine:shell:presentation-focus:clear'\)/);
  assert.doesNotMatch(preload, /contextBridge\.exposeInMainWorld\([^\n]+ipcRenderer/);
});

test('main process keeps Browser tab selection physically distinct from DevOS presentation focus', () => {
  assert.match(main, /createDevOSPresentationFocusState/);
  const focusStart = main.indexOf("ipcMain.handle('metaengine:shell:presentation-focus:snapshot'");
  const focusEnd = main.indexOf('async function startAfterReady()', focusStart);
  assert.ok(focusStart >= 0 && focusEnd > focusStart, 'presentation-focus IPC block must exist');
  const focusBlock = main.slice(focusStart, focusEnd);
  assert.match(focusBlock, /metaengine:shell:presentation-focus:select-session/);
  assert.match(focusBlock, /metaengine:shell:presentation-focus:select-surface/);
  assert.match(focusBlock, /applyPresentationFocusIntent/);
  assert.doesNotMatch(focusBlock, /SELECT_TAB|registry\.select\(/);

  const commandStart = main.indexOf("if (command === 'NEW_CHATGPT')");
  const commandEnd = main.indexOf("if (command === 'CLOSE_TAB')", commandStart);
  assert.ok(commandStart >= 0 && commandEnd > commandStart, 'generic Browser command block must exist');
  const browserCommandBlock = main.slice(commandStart, commandEnd);
  assert.match(browserCommandBlock, /if \(command === 'SELECT_TAB'\)/);
  assert.match(browserCommandBlock, /registry\.select\(payload\?\.tab_id\)/);

  assert.doesNotMatch(main, /metaengine-dark-workspace-v2|metaengine:\/\/shell\//);
});
