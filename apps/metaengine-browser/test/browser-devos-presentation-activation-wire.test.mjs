import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainUrl = new URL('../src/main.mjs', import.meta.url);
const source = await readFile(mainUrl, 'utf8');

function functionSlice(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = nextName ? source.indexOf(`function ${nextName}(`, start + 1) : source.length;
  assert.notEqual(end, -1, `${nextName} must exist after ${name}`);
  return source.slice(start, end);
}

function ipcSlice(channel, nextChannel) {
  const start = source.indexOf(`ipcMain.handle('${channel}'`);
  assert.notEqual(start, -1, `${channel} must exist`);
  const end = nextChannel ? source.indexOf(`ipcMain.handle('${nextChannel}'`, start + 1) : source.length;
  assert.notEqual(end, -1, `${nextChannel} must exist after ${channel}`);
  return source.slice(start, end);
}

test('presentation intent projection is synchronous and identity-only', () => {
  const block = functionSlice('currentDevOSPresentationProjection', 'selectBrowserTabForPresentation');
  assert.match(block, /projectWorkspaceWorkbench\(/);
  assert.match(block, /tabs: registry\.snapshot\(\)/);
  assert.match(block, /fleet: fleet\?\.snapshot\(\) \|\| null/);
  assert.match(block, /supervisor: nativeSupervisor\?\.snapshot\(\) \|\| null/);
  assert.match(block, /presentation_focus: devosPresentationFocus\.snapshot\(\)/);
  assert.match(block, /\}\)\.devos;/);
  assert.doesNotMatch(block, /bridge\.health|await|compute|developmentPlane|ownerSafetyGates/);
  assert.doesNotMatch(block, /title|url|location|hostname|heuristic/i);
});

test('Browser presentation activation requires one exact live tab binding and reuses the existing attach path', () => {
  const block = functionSlice('selectBrowserTabForPresentation', 'applyPresentationFocusIntent');
  assert.match(block, /registry\.get\(id\)/);
  assert.match(block, /views\.get\(id\)/);
  assert.match(block, /if \(!tab\) throw new Error\('tab_not_found'\)/);
  assert.match(block, /if \(!view \|\| view\.webContents\.isDestroyed\(\)\) throw new Error\('tab_binding_not_live'\)/);
  assert.equal((block.match(/registry\.select\(id\)/g) || []).length, 1);
  assert.equal((block.match(/attachSelected\(\)/g) || []).length, 1);
  assert.equal((block.match(/invalidatePerception\(\)/g) || []).length, 1);
  assert.doesNotMatch(block, /loadURL|NAVIGATE|title|url|retry|setTimeout|setInterval/i);
});

test('main process delegates Session and Surface intent to the zero-authority runtime', () => {
  assert.match(source, /import \{ applyDevOSPresentationActivation \} from '\.\/metaengine-devos-presentation-activation-runtime\.mjs';/);
  const block = functionSlice('applyPresentationFocusIntent', 'shellSnapshot');
  assert.match(block, /applyDevOSPresentationActivation\(/);
  assert.match(block, /devos: currentDevOSPresentationProjection\(\)/);
  assert.match(block, /presentationFocus: devosPresentationFocus/);
  assert.match(block, /selectBrowserTab: selectBrowserTabForPresentation/);
  assert.doesNotMatch(block, /retry|setTimeout|setInterval|handleCommand/);
});

test('presentation focus IPC stays sender-validated and publishes only after an applied or physical change', () => {
  const session = ipcSlice(
    'metaengine:shell:presentation-focus:select-session',
    'metaengine:shell:presentation-focus:select-surface',
  );
  assert.match(session, /assertShellSender\(event\);/);
  assert.match(session, /applyPresentationFocusIntent\(\{ intent: 'SESSION', session_id: sessionId \}\)/);
  assert.match(session, /if \(result\.applied \|\| result\.browser_activation_performed\) await publishSnapshot\(\);/);
  assert.match(session, /return result;/);
  assert.doesNotMatch(session, /devosPresentationFocus\.selectSession|registry\.select|attachSelected|handleCommand/);

  const surface = ipcSlice(
    'metaengine:shell:presentation-focus:select-surface',
    'metaengine:shell:presentation-focus:clear',
  );
  assert.match(surface, /assertShellSender\(event\);/);
  assert.match(surface, /applyPresentationFocusIntent\(\{ intent: 'SURFACE', session_id: sessionId, surface_id: surfaceId \}\)/);
  assert.match(surface, /if \(result\.applied \|\| result\.browser_activation_performed\) await publishSnapshot\(\);/);
  assert.match(surface, /return result;/);
  assert.doesNotMatch(surface, /devosPresentationFocus\.selectSurface|registry\.select|attachSelected|handleCommand/);
});

test('generic Browser SELECT_TAB remains physically independent from DevOS presentation focus', () => {
  const start = source.indexOf('async function handleCommand(command, payload = {}) {');
  const end = source.indexOf('function tabForPlatform', start);
  assert.ok(start >= 0 && end > start, 'handleCommand must remain bounded');
  const commands = source.slice(start, end);
  const selectStart = commands.indexOf("if (command === 'SELECT_TAB')");
  const closeStart = commands.indexOf("if (command === 'CLOSE_TAB')", selectStart);
  assert.ok(selectStart >= 0 && closeStart > selectStart, 'SELECT_TAB command must exist');
  const select = commands.slice(selectStart, closeStart);
  assert.match(select, /registry\.select\(payload\?\.tab_id\)/);
  assert.match(select, /attachSelected\(\)/);
  assert.match(select, /invalidatePerception\(\)/);
  assert.doesNotMatch(select, /presentation|selectSession|selectSurface|applyPresentationFocusIntent/);
});

test('presentation activation wiring contains no second scheduler, polling loop, or renderer authority path', () => {
  const start = source.indexOf('function currentDevOSPresentationProjection()');
  const end = source.indexOf('async function shellSnapshot()', start);
  const block = source.slice(start, end);
  assert.doesNotMatch(block, /setTimeout|setInterval|queueMicrotask|requestAnimationFrame|retry/i);
  assert.doesNotMatch(block, /ipcRenderer|webContents\.executeJavaScript|executeJavaScript|sendInputEvent/);
});
