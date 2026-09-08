import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../ui/app.js', import.meta.url), 'utf8');
const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');

test('renderer consumes the validated devos_shell DTO directly', () => {
  assert.match(app, /function devosShell\(next\)/);
  assert.match(app, /const candidate = next\?\.devos_shell/);
  assert.match(app, /candidate\.schema !== 'metaengine\.devos\.shell-view-model\.v1'/);
  assert.match(app, /Array\.isArray\(candidate\.session_groups\)/);
  assert.match(app, /Array\.isArray\(candidate\.surfaces\)/);
  assert.match(app, /Array\.isArray\(candidate\.now\)/);
  assert.match(app, /candidate\.renderer_selection_authority !== false/);
  assert.match(app, /candidate\.renderer_routing_authority !== false/);
  assert.match(preload, /Array\.isArray\(shellCandidate\?\.surfaces\)/);
});

test('primary rail is Session-first and never reconstructs Sessions from Browser tabs or Workspace groups', () => {
  const start = app.indexOf('function renderContextRail(next)');
  const end = app.indexOf('\nfunction el(', start);
  assert.ok(start >= 0 && end > start);
  const block = app.slice(start, end);
  assert.match(block, /const shell = devosShell\(next\)/);
  assert.match(block, /shell\.session_groups/);
  assert.match(block, /shell\.surfaces/);
  assert.match(block, /makeSessionRow/);
  assert.match(block, /makeSurfaceRow/);
  assert.doesNotMatch(block, /workspaceProjection\(/);
  assert.doesNotMatch(block, /selected_tab_id/);
  assert.doesNotMatch(block, /projection\.sessions|next\?\.tabs/);
});

test('Session selection is presentation-only while Browser activation requires an explicit Surface click', () => {
  const sessionStart = app.indexOf('function makeSessionRow');
  const surfaceStart = app.indexOf('function makeSurfaceRow');
  const railStart = app.indexOf('function renderContextRail');
  const sessionBlock = app.slice(sessionStart, surfaceStart);
  const surfaceBlock = app.slice(surfaceStart, railStart);
  assert.match(sessionBlock, /api\.presentationFocus\.selectSession\(session\.session_id\)/);
  assert.doesNotMatch(sessionBlock, /SELECT_TAB|NAVIGATE|CLOSE_TAB/);
  assert.match(surfaceBlock, /api\.presentationFocus\.selectSurface\(surface\.session_id, surface\.surface_id\)/);
  assert.match(surfaceBlock, /surface\.type === 'BROWSER'/);
  assert.match(surfaceBlock, /api\.command\('SELECT_TAB', \{ tab_id: surface\.tab_id \}\)/);
  assert.doesNotMatch(surfaceBlock, /surfaces\[0\]|find\([^\n]*=>[^\n]*\)\s*\|\|/);
});

test('Now is rendered only from devos_shell.now and the old renderer attention reconstruction is gone', () => {
  assert.doesNotMatch(app, /function attentionQueue\(/);
  const start = app.indexOf('function renderAttention(next)');
  const end = app.indexOf('\nfunction renderActivity', start);
  assert.ok(start >= 0 && end > start);
  const block = app.slice(start, end);
  assert.match(block, /const shell = devosShell\(next\)/);
  assert.match(block, /const items = shell\.now/);
  assert.doesNotMatch(block, /fleet\?\.counts|workspaceProjection\(|supervisorError|self_update|development_plane|compute|owner_safety_gates/);
  assert.match(block, /Canonical Now/);
  assert.match(block, /no automatic remediation/i);
});

test('active chrome separates DevOS Session focus from the physical Browser omnibox target', () => {
  const start = app.indexOf('function renderActive(next)');
  const end = app.indexOf('\nfunction makeSessionRow', start);
  assert.ok(start >= 0 && end > start);
  const block = app.slice(start, end);
  assert.match(block, /const shell = devosShell\(next\)/);
  assert.match(block, /const session = shell\.selected_session/);
  assert.match(block, /const surface = shell\.selected_surface/);
  assert.match(block, /const browserTab = selectedTab\(next\)/);
  assert.doesNotMatch(block, /workspaceProjection\(/);
});
