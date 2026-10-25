import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readNativeProjectTaskPage } from '../../me2-ui/src/lib/client-project-tasks.ts';

const read = relative => readFile(new URL(relative, import.meta.url), 'utf8');
const tasks = await read('../../me2-ui/src/components/me2/pages/tasks.tsx');
const code = await read('../../me2-ui/src/components/me2/pages/code.tsx');
const store = await read('../../me2-ui/src/components/me2/store.tsx');
const palette = await read('../../me2-ui/src/components/me2/shell/command-palette.tsx');
const hook = await read('../../me2-ui/src/hooks/use-client-project-tasks.ts');

test('live task and search surfaces cannot invoke retired daemon task or AgentChat effects', () => {
  for (const surface of [tasks, code, store, palette, hook]) {
    assert.doesNotMatch(surface, /me2-bus|me2Fetch|sendCommand|agentChatOp|useAgentChatSessions|taskAction\(|createTaskFromForm|branch-(?:retry|reflect)|\/agentchat\?|TASK_(?:ENQUEUE|SCHEDULE|CANCEL|RETRY|ARCHIVE)|BUDGET_FLUSH|visibleCatalog|loadCatalog/);
  }
  assert.match(tasks, /data-testid="page-tasks"/);
  assert.match(tasks, /data-source="NATIVE_PROJECT_API"/);
  assert.match(tasks, /useClientProjectTasks/);
  assert.match(hook, /useSyncExternalStore/);
  assert.match(hook, /resource\.observe/);
});

test('task history and palette select exact rows from the confirmed project page', () => {
  assert.match(tasks, /page\?\.tasks\.find\(task=>task\.task_id===view\.selectedTaskId\)/);
  assert.match(tasks, /resource\.selectTask\(task\.task_id\)/);
  assert.match(tasks, /<ManagedProjectHistory key=\{selected\.task_id\} taskId=\{selected\.task_id\}/);
  assert.match(palette, /view\.page\?\.tasks\?\?\[\]/);
  assert.match(palette, /if\(resource\.selectTask\(task\.task_id\)\)\{setPage\('tasks'\)/);
  assert.match(code, /<ManagedProjects\/>/);
  assert.match(code, /<ManagedProjectHistory\/>/);
  assert.doesNotMatch(palette, /spawnAgent|AGENT_SPAWN|FLEET_RECONCILE|BUDGET_ADJUST|window\.confirm|window\.prompt/);
});

test('probe snapshots and daemon placeholders cannot become native project task truth', () => {
  for (const value of [
    {ok:true,tasks:[],commands:[],task_content_authority:false},
    {schema:'metaengine.browser.probe.v1',found:false,authority_effect:false,automatic_retry_allowed:false},
    {schema:'metaengine.devos.project-snapshot.v1',found:true,scheduler_authority:true,authority_effect:false,automatic_retry_allowed:false},
  ]) assert.throws(() => readNativeProjectTaskPage(value), /native_project_tasks_invalid/);
  assert.equal(readNativeProjectTaskPage({schema:'metaengine.devos.project-snapshot.v1',found:false,authority_effect:false,automatic_retry_allowed:false}), null);
  assert.match(tasks, /view\.state==='DEGRADED'/);
  assert.match(palette, /view\.state==='DEGRADED'/);
});
