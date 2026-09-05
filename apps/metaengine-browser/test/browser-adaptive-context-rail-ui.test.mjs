import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
const scriptMatch = html.match(/<script data-adaptive-context-rail>([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, 'adaptive context rail script must exist');
const script = scriptMatch[1];
const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || '';

test('adaptive rail inline code is cryptographically pinned by CSP', () => {
  const digest = createHash('sha256').update(script, 'utf8').digest('base64');
  assert.match(csp, new RegExp(`script-src 'self' 'sha256-${digest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/i);
});

test('adaptive rail collapses only high-density agent presentation', () => {
  assert.match(script, /ADAPTIVE_AGENT_THRESHOLD = 8/);
  assert.match(script, /ADAPTIVE_AGENT_VISIBLE = 5/);
  assert.match(script, /querySelectorAll\('\.verticalTab\.agent'\)/);
  assert.match(script, /rows\.length <= ADAPTIVE_AGENT_THRESHOLD/);
  assert.match(script, /row\.hidden = true/);
  assert.match(script, /data-adaptive-agent-disclosure|adaptiveAgentDisclosure/);
});

test('selected and attention-worthy agent rows remain visible when collapsed', () => {
  assert.match(script, /row\.classList\.contains\('active'\)/);
  assert.match(script, /\.tabStateDot\.bad,\.tabStateDot\.warn/);
  assert.match(script, /keep\.add\(row\)/);
});

test('search reveals matching rows instead of preserving collapse', () => {
  assert.match(script, /search\.value\.trim\(\)\.length > 0/);
  assert.match(script, /if \(searching \|\| rows\.length <= ADAPTIVE_AGENT_THRESHOLD\)/);
  assert.match(script, /for \(const row of rows\) row\.hidden = false/);
});

test('adaptive density is event-driven presentation only', () => {
  assert.match(script, /MutationObserver/);
  assert.match(script, /queueMicrotask/);
  assert.doesNotMatch(script, /setTimeout|setInterval|requestAnimationFrame/);
  assert.doesNotMatch(script, /api\.command|metaengineShell|fetch\s*\(|WebSocket|EventSource/);
  assert.doesNotMatch(script, /tab_id|command_id|lease_generation|workspace_id|agent_id/);
});
