import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'ui/index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'ui/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'ui/app.css'), 'utf8');

const authorityCommands = [
  'GATE_DISABLE', 'GATE_DISABLE_ALL', 'GATE_ENABLE', 'GATE_ENABLE_ALL',
  'FLEET_RECONCILE', 'FLEET_SET_PROFILE', 'SET_MODE',
  'TYPED_CLICK', 'SEMANTIC_TYPE', 'SEMANTIC_FOCUS', 'STOP_GENERATION',
  'DOWNLOAD_FILE', 'DOWNLOAD_CANCEL',
];

test('workbench preserves self-only CSP and native-inset surfaces', () => {
  assert.match(html, /default-src 'self'/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /style-src 'self'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /id="contextRail"/);
  assert.match(html, /id="operationsPanel"/);
  assert.match(html, /id="verticalTabs"/);
  assert.match(html, /id="opsContent"/);
  assert.match(css, /--sidebar-width/);
  assert.match(css, /--ops-width/);
});

test('workbench renderer exposes layout and navigation but no authority actuation', () => {
  assert.match(js, /SHELL_LAYOUT_SET/);
  assert.match(js, /NEW_CHATGPT/);
  assert.match(js, /SELECT_TAB/);
  assert.match(js, /CLOSE_TAB/);
  for (const command of authorityCommands) assert.doesNotMatch(js, new RegExp(`['\"]${command}['\"]`));
});

test('untrusted snapshot strings are never injected through HTML parsing', () => {
  assert.doesNotMatch(js, /\.innerHTML\s*=/);
  assert.doesNotMatch(js, /insertAdjacentHTML/);
  assert.doesNotMatch(js, /document\.write/);
  assert.match(js, /\.textContent\s*=/);
});

test('source-only mechanisms remain explicitly unexposed in the UI', () => {
  assert.match(js, /Browser sentinel', 'NOT EXPOSED'/);
  assert.match(js, /Host resilience', 'NOT EXPOSED'/);
  assert.match(js, /Parent progress lease', 'NOT EXPOSED'/);
  assert.match(js, /source presence is not runtime proof/);
});
