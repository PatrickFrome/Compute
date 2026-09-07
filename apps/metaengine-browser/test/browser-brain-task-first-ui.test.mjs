import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');

function inlineScript(attribute) {
  const match = html.match(new RegExp(`<script ${attribute}>([\\s\\S]*?)<\\/script>`));
  assert.ok(match, `${attribute} inline script missing`);
  return match[1];
}

test('task-first Brain layer is cryptographically pinned by CSP', () => {
  const source = inlineScript('data-brain-task-first-v1');
  const digest = crypto.createHash('sha256').update(source, 'utf8').digest('base64');
  assert.match(html, new RegExp(`script-src[^>]+sha256-${digest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('Now reads only the exact bounded collaboration workbench projection', () => {
  const source = inlineScript('data-brain-task-first-v1');
  assert.match(source, /metaengine\.browser-brain\.collaboration-workbench\.v1/);
  assert.match(source, /supervisor\?\.realtime_process_plane\?\.browser_brain\?\.collaboration_fabric/);
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
  const source = inlineScript('data-brain-task-first-v1');
  assert.match(source, /Tasks are not inferred from tabs, URLs, titles, or page content/);
  assert.match(source, /Routing rationale', 'NOT PROJECTED'/);
  assert.match(source, /Task inference', 'DISABLED'/);
  assert.match(source, /Page\/model content', 'NOT EXPOSED'/);
  assert.match(source, /Message bodies', 'NOT EXPOSED'/);
  assert.doesNotMatch(source, /querySelectorAll\(['"`]iframe/);
  assert.doesNotMatch(source, /executeJavaScript/);
  assert.doesNotMatch(source, /setInterval|setTimeout/);
});

test('Now DOM projection is independently bounded before rendering', () => {
  const source = inlineScript('data-brain-task-first-v1');
  assert.match(source, /MAX_UI_CONTEXTS = 8/);
  assert.match(source, /MAX_UI_TASKS_PER_CONTEXT = 3/);
  assert.match(source, /MAX_UI_BLOCKERS = 12/);
  assert.match(source, /MAX_UI_ARTIFACTS = 16/);
  assert.match(source, /candidate\.contexts\.length > 128/);
  assert.match(source, /context\.tasks\.length > 256/);
});

test('Brain information architecture converges around work outcomes before system internals', () => {
  const source = inlineScript('data-brain-task-first-v1');
  for (const label of ['Current work', 'Why / current binding', 'Blockers', 'Team', 'Artifacts', 'Timeline', 'Memory', 'Authority contract']) {
    assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(source, /button\.dataset\.brainNow = 'true'/);
  assert.match(source, /system\.textContent = 'System'/);
  assert.match(source, /Sessions & Agents/);
  assert.match(source, /Search sessions, agents, workspaces/);
});

test('top health has a textual non-color-only aggregate without becoming a live region', () => {
  const source = inlineScript('data-brain-task-first-v1');
  assert.match(source, /data-health-summary/);
  assert.match(source, /Degraded \$\{bad\}/);
  assert.match(source, /Attention \$\{warn\}/);
  assert.match(source, /'Healthy'/);
  assert.match(html, /id="systems" class="systems" aria-label="Browser health" aria-live="off"/);
});
