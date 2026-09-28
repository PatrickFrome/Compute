import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const tasks = await readFile(new URL('../../me2-ui/src/components/me2/pages/tasks.tsx', import.meta.url), 'utf8');

test('R104 Tasks cannot invoke the retired daemon AgentChat reflection plane', () => {
  for (const forbidden of [
    'agentChatOp',
    '/agentchat?XTransformPort=3041',
    'op: "send"',
    'branch-reflect',
    'onReflect=',
    'reflectTask',
    'setReflectingId',
  ]) {
    assert.equal(tasks.includes(forbidden), false, `retired AgentChat reflection token resurfaced: ${forbidden}`);
  }
});

test('R104 Tasks no longer runs provider/reflexion retry experiments from the product UI', () => {
  assert.doesNotMatch(tasks, /retryMetrics|\/metrics\?XTransformPort=3041|A\/B T|LLM-рефлексия \(tier-2\)/);
  assert.doesNotMatch(tasks, /Сгенерировать LLM-рефлексию|провал передан флоту|создайте чат-агента/);
});

test('R104 keeps task graph inspection and the existing scheduler retry separate from model chat', () => {
  assert.match(tasks, /data-testid="page-tasks"/);
  assert.match(tasks, /TASK_RETRY lineage/);
  assert.match(tasks, /taskAction\("TASK_RETRY", t\.id\)/);
  assert.match(tasks, /Повторить задачу через task scheduler/);
  assert.match(tasks, /detail\.reflection/);
  assert.doesNotMatch(tasks, /from "@\/lib\/me2-socket"/);
});
