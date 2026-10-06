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
  assert.match(main, /metaengine:shell:presentation-focus:select-session/);
  assert.match(main, /metaengine:shell:presentation-focus:select-surface/);
  assert.match(main, /generic Browser SELECT_TAB remains physically independent/);
  assert.doesNotMatch(main, /metaengine-dark-workspace-v2|metaengine:\/\/shell\//);
});
