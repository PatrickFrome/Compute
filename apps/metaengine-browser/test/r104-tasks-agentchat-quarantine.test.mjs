import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { filterSupportedLegacyDaemonActionCatalog } from '../../me2-ui/src/lib/task-content-snapshot.mjs';

const tasks = await readFile(new URL('../../me2-ui/src/components/me2/pages/tasks.tsx', import.meta.url), 'utf8');
const dialogs = await readFile(new URL('../../me2-ui/src/components/me2/shell/dialogs.tsx', import.meta.url), 'utf8');
const store = await readFile(new URL('../../me2-ui/src/components/me2/store.tsx', import.meta.url), 'utf8');
const palette = await readFile(new URL('../../me2-ui/src/components/me2/shell/command-palette.tsx', import.meta.url), 'utf8');
const taskSurfaces = tasks + '\n' + dialogs;

test('R104 task UI cannot invoke the retired daemon AgentChat/reflection plane', () => {
  for (const forbidden of [
    'agentChatOp',
    '/agentchat?XTransformPort=3041',
    'op: "send"',
    'branch-reflect',
    'onReflect=',
    'reflectTask',
    'setReflectingId',
  ]) {
    assert.equal(taskSurfaces.includes(forbidden), false, `retired AgentChat token resurfaced: ${forbidden}`);
  }
  assert.doesNotMatch(taskSurfaces, /retryMetrics|\/metrics\?XTransformPort=3041|A\/B T|LLM-рефлексия \(tier-2\)/);
});

test('R104 task product surfaces are observation-only until canonical DevOS mutations are wired', () => {
  assert.doesNotMatch(tasks, /taskAction\(|setDialog\("newTask"\)|branch-retry/);
  assert.doesNotMatch(dialogs, /taskAction\(|NewTaskDialog|createTaskFromForm|TASK_(?:ENQUEUE|SCHEDULE|CANCEL|RETRY|ARCHIVE)/);
  assert.doesNotMatch(store, /createTaskFromForm|TASK_ENQUEUE|TASK_SCHEDULE|"newTask"/);
  assert.match(tasks, /data-testid="page-tasks"/);
  assert.match(tasks, /read-only projection/);
  assert.match(tasks, /hover\.t\.reflection/);
  assert.doesNotMatch(tasks, /onRetry=|onReflect=|branch-retry|branch-reflect/);
});

test('R104 command palette hard-fences retired daemon task mutations including generic catalog entries', () => {
  assert.match(palette, /filterSupportedLegacyDaemonActionCatalog\(catalog\)/);
  assert.match(palette, /filterSupportedLegacyDaemonActionCatalog\(\[meta\]\)/);
  const visible=filterSupportedLegacyDaemonActionCatalog([
    ...['TASK_ENQUEUE','TASK_SCHEDULE','TASK_CANCEL','TASK_RETRY','TASK_ARCHIVE'].map((action) => ({ action })),
    { action:'AGENT_SPAWN' }, { action:'FLEET_RECONCILE' }, { action:'BUDGET_ADJUST' },
    { action:'PING' }, { action:'BROWSER_OPEN' },
  ]);
  assert.deepEqual(visible.map((row) => row.action), ['PING','BROWSER_OPEN']);
  assert.match(palette, /visibleCatalog\.map/);
  assert.doesNotMatch(palette, /setDialog\("newTask"\)|value="new новая задача"/);
});
