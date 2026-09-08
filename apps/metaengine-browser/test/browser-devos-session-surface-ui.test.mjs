import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../ui/app.js', import.meta.url), 'utf8');
const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
// Keep this contract renderer-local: Session ownership is projected by main, never reconstructed here.

function functionSlice(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.notEqual(end, -1, `${nextName} must exist after ${name}`);
  return source.slice(start, end);
}

test('Session-first section is a first-class bounded Agentic surface', () => {
  assert.match(source, /const AGENTIC_SECTIONS = Object\.freeze\(\['attention', 'activity', 'context', 'sessions', 'skills'\]\)/);
  assert.match(source, /if \(agenticSection === 'sessions'\) content = renderSessions\(next\)/);
  assert.match(source, /sessions: \['agentic', 'sessions'\]/);
});

test('renderer validates canonical Session and selected Surface DTO arrays before use', () => {
  const block = functionSlice('devosShellView', 'attentionTone');
  assert.match(block, /Array\.isArray\(view\.session_groups\)/);
  assert.match(block, /Array\.isArray\(view\.selected_session_surfaces\)/);
  assert.match(block, /Number\.isSafeInteger\(view\.selected_session_surface_count\)/);
  assert.match(block, /typeof view\.selected_session_surfaces_truncated !== 'boolean'/);
});

test('Session controls use only narrow presentationFocus methods and never generic Browser commands', () => {
  const block = functionSlice('renderSessions', 'renderSkills');
  assert.match(block, /api\.presentationFocus\.selectSession\(row\.session_id\)/);
  assert.match(block, /api\.presentationFocus\.selectSurface\(row\.session_id, row\.surface_id\)/);
  assert.match(block, /api\.presentationFocus\.setLayout\(selectedSession\.session_id, mode\)/);
  assert.match(block, /api\.presentationFocus\.clear\(\)/);
  assert.doesNotMatch(block, /api\.command|SELECT_TAB|NEW_TAB|NAVIGATE|loadURL|executeJavaScript/);
  assert.doesNotMatch(block, /devos\.surfaces|next\?\.workspaces\?\.devos|\.surface_ids/);
  assert.doesNotMatch(block, /new URL|hostname|hostFor\(|title_heuristic|url_heuristic/i);
});

test('Browser tab controls remain physically independent from Session focus', () => {
  const block = functionSlice('makeTabRow', 'renderContextRail');
  assert.match(block, /api\.command\('SELECT_TAB', \{ tab_id: tab\.tab_id \}\)/);
  assert.doesNotMatch(block, /presentationFocus|selectSession|selectSurface/);
});

test('preload remains the only narrow renderer bridge for Session Surface focus and layout preference', () => {
  assert.match(preload, /presentationFocus: Object\.freeze\(\{/);
  assert.match(preload, /selectSession: \(sessionId\) => ipcRenderer\.invoke\('metaengine:shell:presentation-focus:select-session'/);
  assert.match(preload, /selectSurface: \(sessionId, surfaceId\) => ipcRenderer\.invoke\('metaengine:shell:presentation-focus:select-surface'/);
  assert.match(preload, /setLayout: \(sessionId, layoutMode\) => ipcRenderer\.invoke\('metaengine:shell:presentation-layout:set'/);
  assert.match(preload, /clear: \(\) => ipcRenderer\.invoke\('metaengine:shell:presentation-focus:clear'\)/);
  assert.doesNotMatch(preload, /contextBridge\.exposeInMainWorld\([^\n]+ipcRenderer/);
});
