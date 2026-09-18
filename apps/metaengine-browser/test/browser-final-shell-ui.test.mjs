import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../ui/app.js', import.meta.url), 'utf8');
const dark = await readFile(new URL('../ui/dark-workspace.css', import.meta.url), 'utf8');

test('dark workspace v2 replaces the Telegram presentation contract', () => {
  assert.match(html, /data-final-shell=\"metaengine-dark-workspace-v2\"/);
  assert.doesNotMatch(html, /data-final-shell=\"telegram-browser-v1\"/);
  assert.match(html, /metaengine:\/\/shell\/dark-workspace\.css/);
  assert.match(html, /<meta name=\"color-scheme\" content=\"dark\">/);
  assert.match(dark, /color-scheme:dark/);
  assert.match(dark, /--bg:#090c11/);
});

test('browser-first chrome is flat dense and active-surface subordinate', () => {
  assert.match(dark, /--top-height:44px/);
  assert.match(dark, /--sidebar-width:240px/);
  assert.match(dark, /--ops-width:320px/);
  assert.match(dark, /\.verticalTab\.active[^{]*\{[\s\S]*background:#141d28/);
  assert.match(dark, /\.tabAvatar[^{]*\{[\s\S]*border-radius:7px/);
  assert.doesNotMatch(dark, /border-radius:50%[^}]*tabAvatar/);
  assert.match(html, /<strong>Workspace<\/strong>/);
});

test('keyboard-first workbench grammar and Session authority boundaries remain intact', () => {
  assert.match(html, /placeholder=\"Search · > command · @ agent · \/ skill\"/);
  assert.match(app, /AGENTIC_SECTIONS = Object\.freeze\(\['attention', 'activity', 'context', 'sessions', 'skills'\]\)/);
  assert.match(app, /presentationFocus\.selectSession/);
  assert.match(app, /presentationFocus\.selectSurface/);
  assert.match(app, /Browser actuation authority', 'NONE'/);
  assert.match(app, /Scheduler authority', 'NONE'/);
  assert.match(app, /Automatic effect retry', 'NONE'/);
});

test('dark theme adds no network or execution surface in renderer CSS', () => {
  const executable = dark.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(executable, /url\s*\(|@import|javascript:|expression\s*\(/i);
  assert.doesNotMatch(executable, /api\.command|metaengineShell|fetch\s*\(|WebSocket|EventSource/);
});
