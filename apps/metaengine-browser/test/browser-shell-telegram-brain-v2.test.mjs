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
const renderer = fs.readFileSync(path.join(appRoot, 'ui', 'app.js'), 'utf8');

test('Brain Shell V2 uses compact Telegram-style native inset geometry without overlaying page pixels', () => {
  assert.equal(SHELL_TOP_HEIGHT, 52);
  assert.equal(SHELL_SIDEBAR_EXPANDED_WIDTH, 288);
  assert.equal(SHELL_SIDEBAR_COMPACT_WIDTH, 64);
  assert.equal(SHELL_OPERATIONS_WIDTH, 368);

  const wide = planShellLayout({ width: 1440, height: 960, state: normalizeShellLayoutState() });
  assert.equal(wide.effective_sidebar, 'EXPANDED');
  assert.equal(wide.effective_operations, 'OPEN');
  assert.equal(wide.remote_bounds.y, 52);
  assert.equal(wide.remote_bounds.x, 288);
  assert.equal(wide.operations_bounds.width, 368);
  assert.ok(wide.remote_bounds.width >= SHELL_MIN_REMOTE_WIDTH);
  assert.equal(wide.overlay_remote_content, false);
  assert.equal(wide.renderer_dimensions_authoritative, false);
  assert.equal(wide.authority_effect, false);

  const narrow = planShellLayout({ width: 900, height: 640, state: normalizeShellLayoutState() });
  assert.equal(narrow.effective_sidebar, 'COMPACT');
  assert.equal(narrow.effective_operations, 'CLOSED');
  assert.ok(narrow.remote_bounds.width >= SHELL_MIN_REMOTE_WIDTH);
});

test('Brain Shell V2 exposes Context Rail, Brain Inspector and the existing bounded command grammar', () => {
  for (const token of [
    'aria-label="Contexts"',
    'aria-label="Brain inspector"',
    '>command',
    '@tab',
    '/skill',
    'Ctrl K',
    'Realtime',
    'Brain',
  ]) assert.ok(html.includes(token), `${token} missing from Brain Shell V2`);

  for (const token of [
    "input.startsWith('>')",
    "input.startsWith('/')",
    "input.startsWith('@')",
    "event.key.toLowerCase() === 'k'",
    "api.command('SELECT_TAB'",
    "api.command('NEW_CHATGPT'",
  ]) assert.ok(renderer.includes(token), `${token} missing from bounded workbench command surface`);

  assert.doesNotMatch(renderer, /executeJavaScript|Runtime\.evaluate|new\s+Function\s*\(|\beval\s*\(/);
});

test('Brain Shell V2 keeps strict local CSP and treats page space as a separate native WebContents surface', () => {
  assert.match(html, /default-src 'self'/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /style-src 'self'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /<iframe|<webview/i);
  assert.doesNotMatch(renderer, /\.innerHTML\s*=|insertAdjacentHTML|document\.write/);
});

test('Brain Shell V2 is event-oriented and has no decorative perpetual animation loop', () => {
  assert.match(css, /--top-height:52px/);
  assert.match(css, /--sidebar-width:288px/);
  assert.match(css, /--ops-width:368px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /@keyframes|\banimation\s*:/i);
  assert.match(renderer, /api\.onSnapshot\(render\)/);
  assert.match(renderer, /api\.onSnapshot\(\(next\) =>/);
});

test('Brain Inspector keeps legacy deep evidence reachable without crowding the primary navigation', () => {
  assert.match(html, /data-section="overview"[^>]*>Systems</);
  assert.match(html, /data-section="commands"[^>]*>Commands</);
  assert.doesNotMatch(html, /data-section="fleet"|data-section="supervisor"|data-section="devos"|data-section="runtime"|data-section="safety"/);
  for (const target of ['fleet','workspaces','supervisor','devos','runtime','safety','commands','overview']) {
    assert.ok(renderer.includes(`${target}: ['core', '${target}']`) || target === 'commands' || target === 'overview', `${target} deep evidence alias missing`);
  }
  assert.match(renderer, /openCoreOpsSection\('fleet'\)/);
  assert.match(renderer, /openCoreOpsSection\('safety'\)/);
});
