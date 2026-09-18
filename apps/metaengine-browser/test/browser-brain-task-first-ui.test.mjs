import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
const presentationMatch = html.match(/<script data-adaptive-context-rail>([\s\S]*?)<\/script>/);
assert.ok(presentationMatch, 'canonical final-shell presentation script missing');
const presentation = presentationMatch[1];
const taskStart = presentation.indexOf("const TASK_WORKBENCH_SCHEMA = 'metaengine.browser-brain.collaboration-workbench.v1'");
assert.ok(taskStart >= 0, 'task-first projection code missing from canonical presentation surface');
const source = presentation.slice(taskStart);

test('task-first Brain shares the single cryptographically pinned final-shell presentation surface', () => {
  const digest = crypto.createHash('sha256').update(presentation, 'utf8').digest('base64');
  assert.match(html, new RegExp(`script-src[^>]+sha256-${digest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.equal((html.match(/<script\b/g) || []).length, 2);
  assert.doesNotMatch(html, /data-brain-task-first-v1/);
});

test('Now reads only the exact bounded collaboration workbench projection', () => {
  assert.match(source, /metaengine\.browser-brain\.collaboration-workbench\.v1/);
  assert.match(source, /supervisor\?\.realtime_process_plane\?\.browser_brain\?\.collaboration_fabric\?\.workbench/);
  assert.match(source, /candidate\.bounded !== true/);
  assert.match(source, /candidate\.projection_is_authority !== false/);
  assert.match(source, /candidate\.scheduler_authority !== false/);
  assert.match(source, /candidate\.execution_authority !== false/);
  assert.match(source, /candidate\.command_leasing !== false/);
  assert.match(source, /candidate\.message_bodies_exposed !== false/);
  assert.match(source, /candidate\.raw_page_content_exposed !== false/);
  assert.match(source, /task\.scheduler_authority !== false/);
  assert.match(source, /task\.execution_authority !== false/);
  assert.match(source, /task\.authority_effect !== false/);
});

test('task-first UI fails closed instead of inferring work from browser content', () => {
  assert.match(source, /Tasks are not inferred from tabs, URLs, titles, or page content/);
  assert.match(source, /Routing rationale', 'NOT PROJECTED'/);
  assert.match(source, /Task inference', 'DISABLED'/);
  assert.match(source, /Page\/model content', 'NOT EXPOSED'/);
  assert.match(source, /Message bodies', 'NOT EXPOSED'/);
  assert.doesNotMatch(source, /querySelectorAll\(['"`]iframe/);
  assert.doesNotMatch(source, /executeJavaScript/);
  assert.doesNotMatch(source, /setInterval|setTimeout|requestAnimationFrame/);
  assert.doesNotMatch(source, /api\.command|metaengineShell|fetch\s*\(|WebSocket|EventSource/);
});

test('Now DOM projection is independently bounded before rendering', () => {
  assert.match(source, /TASK_UI_MAX_CONTEXTS = 8/);
  assert.match(source, /TASK_UI_MAX_PER_CONTEXT = 3/);
  assert.match(source, /TASK_UI_MAX_BLOCKERS = 12/);
  assert.match(source, /TASK_UI_MAX_ARTIFACTS = 16/);
  assert.match(source, /candidate\.contexts\.length > 128/);
  assert.match(source, /context\.tasks\.length > 256/);
});

test('Brain information architecture converges around work outcomes before system internals', () => {
  for (const label of ['Current work', 'Why / current binding', 'Blockers', 'Team', 'Artifacts', 'Timeline', 'Memory', 'Authority contract']) {
    assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(source, /now\.dataset\.brainNow = 'true'/);
  assert.match(source, /coreStatus\.textContent = 'System'/);
  assert.match(html, /<strong>Workspace<\/strong>/);
  assert.match(html, /placeholder="Search BrowserCells"/);
});

test('top health has a textual non-color-only aggregate without becoming a live region', () => {
  assert.match(source, /data-health-summary|healthSummary/);
  assert.match(source, /Degraded \$\{bad\}/);
  assert.match(source, /Attention \$\{warn\}/);
  assert.match(source, /'Healthy'/);
  assert.match(html, /id="systems" class="systems" aria-label="Browser health" aria-live="off"/);
});
