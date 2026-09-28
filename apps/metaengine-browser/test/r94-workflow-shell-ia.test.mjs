import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const store = await readFile(new URL('../../me2-ui/src/components/me2/store.tsx', import.meta.url), 'utf8');
const pagebar = await readFile(new URL('../../me2-ui/src/components/me2/shell/pagebar.tsx', import.meta.url), 'utf8');
const topbar = await readFile(new URL('../../me2-ui/src/components/me2/shell/topbar.tsx', import.meta.url), 'utf8');

test('R98 primary shell navigation exposes six product workflow stages, not legacy authority modules', () => {
  for (const label of ['FLEET', 'PLAN', 'BUILD', 'SUPERVISE', 'OBSERVE', 'SYSTEM']) {
    assert.match(store, new RegExp(`label: "${label}"`));
  }
  for (const removed of ['COMMAND', 'RUN']) assert.doesNotMatch(store, new RegExp(`label: "${removed}"`));
  assert.match(pagebar, /WORKFLOW_STAGES\.map/);
  assert.match(pagebar, /data-testid="workflow-stage-tabs"/);
  assert.doesNotMatch(pagebar, /PAGES\.map\(\(p\)/);
});

test('R98 workflow ownership excludes retired daemon/API-agent product pages', () => {
  assert.match(store, /key: "plan"[\s\S]{0,180}pages: \["tasks"\]/);
  assert.match(store, /key: "build"[\s\S]{0,180}pages: \["code"\]/);
  assert.match(store, /key: "run"[\s\S]{0,180}pages: \["browser"\]/);
  assert.match(store, /key: "fleet"[\s\S]{0,220}pages: \["supervisor"\]/);
  assert.match(store, /key: "observe"[\s\S]{0,220}pages: \["observability", "memory"\]/);
  assert.match(store, /key: "system"[\s\S]{0,220}pages: \["system"\]/);
  assert.doesNotMatch(store, /key: "command"[\s\S]{0,180}pages: \["command"\]/);
  assert.doesNotMatch(store, /pages: \["agents"/);
  assert.doesNotMatch(store, /pages: \["system", "compute"\]/);
  assert.match(pagebar, /stage\.pages\.map\(\(modulePage\)/);
});

test('R97 retires R94 direct stage/history shortcuts from the single main workspace', () => {
  assert.match(store, /only global UI shortcut is Ctrl\/Cmd\+K/);
  assert.doesNotMatch(store, /e\.key >= "1" && e\.key <= "7"/);
  assert.doesNotMatch(store, /get\(\)\.setPage\(stage\.primaryPage\)/);
  assert.doesNotMatch(store, /e\.key === "ArrowLeft" \|\| e\.key === "ArrowRight"/);
  assert.doesNotMatch(store, /setContextDrawer\(!get\(\)\.contextDrawerPreferredOpen\)/);
});

test('R94 keeps native Browser bottom geometry stable while changing information architecture', () => {
  assert.match(pagebar, /className="flex h-9 shrink-0/);
  assert.doesNotMatch(pagebar, /className="flex h-10 shrink-0/);
});

test('R97 top chrome keeps workflow modules out of the persistent main workspace', () => {
  assert.doesNotMatch(topbar, /workflowStageForPage\(page\)/);
  assert.doesNotMatch(topbar, /workspaceMeta\?\.label|stageMeta\.label|pageMeta\?\.label/);
  assert.match(topbar, /data-testid="global-cmdbar"/);
  assert.match(topbar, /data-testid="settings-button"/);
});


test('R97 workspace and workflow selectors are advanced-only instead of persistent chrome', () => {
  assert.doesNotMatch(topbar, /data-testid="workspace-switcher"/);
  assert.doesNotMatch(topbar, /data-testid="workspace-reset-layout"/);
  assert.doesNotMatch(topbar, /WORKSPACES\.map|WORKFLOW_STAGES\.map/);
  assert.match(topbar, /Search agents, settings, tools or run a command/);
  assert.match(topbar, /setPage\("system"\)/);
});

test('R94 separates brand/selection accent from runtime health green', () => {
  assert.match(topbar, /border-cyan-800/);
  assert.match(topbar, /text-cyan-300/);
  assert.match(topbar, /border-emerald-900/);
  assert.match(topbar, /text-emerald-300/);
});
