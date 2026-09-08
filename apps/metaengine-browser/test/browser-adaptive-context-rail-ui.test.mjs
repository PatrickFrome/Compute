import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
const scriptMatch = html.match(/<script data-adaptive-context-rail>([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, 'canonical final-shell presentation script must exist');
const script = scriptMatch[1];
const taskBoundary = script.indexOf('function unavailableTaskProjection');
assert.ok(taskBoundary > 0, 'task-first presentation boundary must follow adaptive rail code');
const adaptiveSource = script.slice(0, taskBoundary);
const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || '';

test('canonical final-shell presentation code is cryptographically pinned by CSP', () => {
  const digest = createHash('sha256').update(script, 'utf8').digest('base64');
  assert.match(csp, new RegExp(`script-src 'self' 'sha256-${digest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/i);
});

test('adaptive rail collapses only high-density agent presentation', () => {
  assert.match(adaptiveSource, /ADAPTIVE_AGENT_THRESHOLD = 8/);
  assert.match(adaptiveSource, /ADAPTIVE_AGENT_VISIBLE = 5/);
  assert.match(adaptiveSource, /querySelectorAll\('\.verticalTab\.agent'\)/);
  assert.match(adaptiveSource, /rows\.length <= ADAPTIVE_AGENT_THRESHOLD/);
  assert.match(adaptiveSource, /row\.hidden = true/);
  assert.match(adaptiveSource, /data-adaptive-agent-disclosure|adaptiveAgentDisclosure/);
});

test('selected and attention-worthy agent rows remain visible when collapsed', () => {
  assert.match(adaptiveSource, /row\.classList\.contains\('active'\)/);
  assert.match(adaptiveSource, /\.tabStateDot\.bad,\.tabStateDot\.warn/);
  assert.match(adaptiveSource, /keep\.add\(row\)/);
});

test('search reveals matching rows instead of preserving collapse', () => {
  assert.match(adaptiveSource, /search\.value\.trim\(\)\.length > 0/);
  assert.match(adaptiveSource, /if \(searching \|\| rows\.length <= ADAPTIVE_AGENT_THRESHOLD\)/);
  assert.match(adaptiveSource, /for \(const row of rows\) row\.hidden = false/);
});

test('adaptive density subsection is event-driven presentation only', () => {
  assert.match(script, /MutationObserver/);
  assert.match(script, /queueMicrotask/);
  assert.doesNotMatch(adaptiveSource, /setTimeout|setInterval|requestAnimationFrame/);
  assert.doesNotMatch(adaptiveSource, /api\.command|metaengineShell|fetch\s*\(|WebSocket|EventSource/);
  assert.doesNotMatch(adaptiveSource, /tab_id|command_id|lease_generation|workspace_id|agent_id/);
});
