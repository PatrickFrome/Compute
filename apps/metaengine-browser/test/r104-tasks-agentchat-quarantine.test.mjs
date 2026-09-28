import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const tasks = await readFile(new URL('../../me2-ui/src/components/me2/pages/tasks.tsx', import.meta.url), 'utf8');
const dialogs = await readFile(new URL('../../me2-ui/src/components/me2/shell/dialogs.tsx', import.meta.url), 'utf8');
const store = await readFile(new URL('../../me2-ui/src/components/me2/store.tsx', import.meta.url), 'utf8');
const palette = await readFile(new URL('../../me2-ui/src/components/me2/shell/command-palette.tsx', import.meta.url), 'utf8');
const taskSurfaces = tasks + '\n' + dialogs + '\n' + store;

test('R104 task UI cannot invoke the retired daemon AgentChat/reflection plane', () => {
  for (const forbidden of [
    'agentChatOp',
    '/agentchat?XTransformPort=3041',
    'op: "send"',
    'branch-reflect',
    'onReflect=',
    'reflectTask',
    'setReflectingId',
    'me2:select-chat',
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
  assert.match(tasks, /detail\.reflection/);
});

test('R104 command palette hard-fences retired daemon task mutations including generic catalog entries', () => {
  for (const action of ['TASK_ENQUEUE','TASK_SCHEDULE','TASK_CANCEL','TASK_RETRY','TASK_ARCHIVE']) {
    assert.match(palette, new RegExp(`"${action}"`));
  }
  assert.match(palette, /RETIRED_DAEMON_TASK_ACTIONS\.has\(meta\.action\)/);
  assert.match(palette, /catalog\.filter\(\(row\) => !RETIRED_DAEMON_TASK_ACTIONS\.has\(row\.action\)\)/);
  assert.match(palette, /visibleCatalog\.map/);
  assert.doesNotMatch(palette, /setDialog\("newTask"\)|value="new новая задача"/);
});
