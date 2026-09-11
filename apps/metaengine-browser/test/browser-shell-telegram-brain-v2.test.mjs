import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  SHELL_TOP_HEIGHT,
  SHELL_SIDEBAR_EXPANDED_WIDTH,
  SHELL_SIDEBAR_COMPACT_WIDTH,
  SHELL_OPERATIONS_WIDTH,
  SHELL_MIN_REMOTE_WIDTH,
  normalizeShellLayoutState,
  planShellLayout,
} from '../src/shell-layout.mjs';

const appRoot = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(appRoot, 'ui', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(appRoot, 'ui', 'app.css'), 'utf8');
const darkCss = fs.readFileSync(path.join(appRoot, 'ui', 'dark-workspace.css'), 'utf8');
const renderer = fs.readFileSync(path.join(appRoot, 'ui', 'app.js'), 'utf8');

test('Dark Workspace V2 protects page space and keeps Brain closed until requested', () => {
  assert.equal(SHELL_TOP_HEIGHT, 44);
  assert.equal(SHELL_SIDEBAR_EXPANDED_WIDTH, 240);
  assert.equal(SHELL_SIDEBAR_COMPACT_WIDTH, 52);
  assert.equal(SHELL_OPERATIONS_WIDTH, 320);
  assert.equal(normalizeShellLayoutState().operations, 'CLOSED');

  const calm = planShellLayout({ width: 1440, height: 960, state: normalizeShellLayoutState() });
  assert.equal(calm.effective_sidebar, 'EXPANDED');
  assert.equal(calm.effective_operations, 'CLOSED');
  assert.equal(calm.remote_bounds.y, 44);
  assert.equal(calm.remote_bounds.x, 240);
  assert.ok(calm.remote_bounds.width >= SHELL_MIN_REMOTE_WIDTH);
  assert.equal(calm.overlay_remote_content, false);
  assert.equal(calm.renderer_dimensions_authoritative, false);
  assert.equal(calm.authority_effect, false);

  const inspector = planShellLayout({
    width: 1600,
    height: 960,
    state: normalizeShellLayoutState({ sidebar: 'EXPANDED', operations: 'OPEN' }),
  });
  assert.equal(inspector.effective_operations, 'OPEN');
  assert.equal(inspector.operations_bounds.width, 320);
  assert.ok(inspector.remote_bounds.width >= SHELL_MIN_REMOTE_WIDTH);

  const narrow = planShellLayout({ width: 900, height: 640, state: normalizeShellLayoutState({ sidebar: 'EXPANDED', operations: 'OPEN' }) });
  assert.equal(narrow.effective_sidebar, 'COMPACT');
  assert.equal(narrow.effective_operations, 'CLOSED');
  assert.ok(narrow.remote_bounds.width >= SHELL_MIN_REMOTE_WIDTH);
});

test('Dark Workspace V2 is dark, browser-first and deliberately low-noise', () => {
  assert.match(html, /color-scheme" content="dark"/);
  assert.match(html, /data-operations="CLOSED"/);
  assert.match(html, /placeholder="Search · > command · @ agent · \/ skill"/);
  assert.match(html, /aria-label="Chats, agents, workspaces and BrowserCells"/);
  assert.match(html, /aria-label="Brain coordination inspector"/);
  assert.match(html, /data-section="overview"[^>]*>Status</);
  assert.match(html, /data-section="commands"[^>]*>Actions</);
  assert.match(html, /data-final-shell="metaengine-dark-workspace-v2"/);
  assert.match(html, /class="activeContext"/);

  assert.match(darkCss, /color-scheme:dark/);
  assert.match(darkCss, /--top-height:44px/);
  assert.match(darkCss, /--sidebar-width:240px/);
  assert.match(darkCss, /--ops-width:320px/);
  assert.match(darkCss, /background:var\(--bg\)/);
  assert.doesNotMatch(darkCss, /telegram-browser-v1/i);
  assert.match(css, /\.systemChip b,\.systemChip \.systemValue\{display:none\}/);
  assert.match(css, /body\[data-operations="CLOSED"\] \.operationsPanel\{display:none\}/);
  assert.match(css, /data-agentic-section="activity"/);
  assert.match(css, /data-agentic-section="skills"/);
});

test('Dark Workspace V2 keeps one bounded command surface instead of adding UI authority', () => {
  for (const token of [
    "input.startsWith('>')",
    "input.startsWith('/')",
    "input.startsWith('@')",
    "event.key.toLowerCase() === 'k'",
    "api.command('SELECT_TAB'",
    "api.command('NEW_CHATGPT'",
  ]) assert.ok(renderer.includes(token), `${token} missing from bounded workbench command surface`);

  assert.doesNotMatch(renderer, /executeJavaScript|Runtime\.evaluate|new\s+Function\s*\(|\beval\s*\(/);
  assert.doesNotMatch(renderer, /\.innerHTML\s*=|insertAdjacentHTML|document\.write/);
});

test('Dark Workspace V2 preserves strict CSP and native WebContents separation', () => {
  assert.match(html, /default-src 'self'/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /style-src 'self'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /<iframe|<webview/i);
});

test('Dark Workspace V2 remains event-oriented with no decorative perpetual animation loop', () => {
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /@keyframes|\banimation\s*:/i);
  assert.match(renderer, /api\.onSnapshot\(render\)/);
  assert.match(renderer, /api\.onSnapshot\(\(next\) =>/);
});

test('Deep mechanisms remain reachable but are not primary chrome', () => {
  assert.doesNotMatch(html, /data-section="fleet"|data-section="supervisor"|data-section="devos"|data-section="runtime"|data-section="safety"/);
  for (const target of ['fleet','workspaces','supervisor','devos','runtime','safety']) {
    assert.ok(renderer.includes(`${target}: ['core', '${target}']`), `${target} deep evidence alias missing`);
  }
  assert.match(renderer, /openCoreOpsSection\('fleet'\)/);
  assert.match(renderer, /openCoreOpsSection\('safety'\)/);
});
