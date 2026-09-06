import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../ui/app.js', import.meta.url), 'utf8');
const styleMatch = html.match(/<style data-final-shell>([\s\S]*?)<\/style>/);
assert.ok(styleMatch, 'final shell style must exist');
const style = styleMatch[1];
const executableStyle = style.replace(/\/\*[\s\S]*?\*\//g, '');
const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || '';

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('final shell presentation is cryptographically pinned and introduces no executable surface', () => {
  const digest = createHash('sha256').update(style, 'utf8').digest('base64');
  assert.match(csp, new RegExp(`style-src 'self' 'sha256-${escapeRegex(digest)}'`));
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/i);
  assert.equal((html.match(/<script\b/g) || []).length, 2, 'final shell must not add another script/control path');
  assert.doesNotMatch(executableStyle, /url\s*\(|@import|javascript:|expression\s*\(/i);
});

test('shell exposes the exact active BrowserCell and keyboard-first command grammar', () => {
  assert.match(html, /data-final-shell="telegram-browser-v1"/);
  assert.match(html, /class="activeContext"/);
  assert.doesNotMatch(html, /class="activeContext srOnly"/);
  assert.match(html, /placeholder="Search · > command · @ agent · \/ skill"/);
  assert.match(html, /<b>Ctrl K<\/b> command · @ agent · \/ skill/);
  assert.match(app, /event\.key\.toLowerCase\(\) === 'k'/);
  assert.match(app, /\^\[>@\/\]/);
});

test('all existing Brain coordination surfaces are first-class rather than CSS-hidden', () => {
  assert.match(app, /AGENTIC_SECTIONS = Object\.freeze\(\['attention', 'activity', 'context', 'skills'\]\)/);
  for (const section of ['attention', 'activity', 'skills']) {
    assert.match(style, new RegExp(`data-agentic-section="${section}"`));
  }
  assert.match(style, /data-agentic-section="skills"\]\{display:block\}/);
  assert.match(html, /Always-on coordination/);
  assert.match(html, /Brain coordination inspector/);
});

test('Telegram-like rail and browser inspector remain inside canonical native insets', () => {
  assert.match(style, /\.contextRail\{\s*left:0;top:var\(--top-height\);bottom:0;width:var\(--sidebar-width\)/);
  assert.match(style, /\.operationsPanel\{\s*right:0;top:var\(--top-height\);bottom:0;width:var\(--ops-width\)/);
  assert.match(style, /\.verticalTab\.active\{background:var\(--final-accent\);color:#fff\}/);
  assert.match(style, /\.tabAvatar\{[\s\S]*border-radius:50%/);
  assert.match(html, /Chats & Agents/);
  assert.match(html, /BrowserCells/);
});

test('final UI does not create scheduling, lease, retry or page-model authority', () => {
  assert.doesNotMatch(executableStyle, /scheduler|lease|retry|command_id|tab_id|agent_id|workspace_id/i);
  assert.doesNotMatch(executableStyle, /api\.command|metaengineShell|fetch\s*\(|WebSocket|EventSource/);
  assert.match(app, /Browser actuation authority', 'NONE'/);
  assert.match(app, /Scheduler authority', 'NONE'/);
  assert.match(app, /Automatic effect retry', 'NONE'/);
});
