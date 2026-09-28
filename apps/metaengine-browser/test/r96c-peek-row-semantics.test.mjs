import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (url) => readFile(new URL(url, import.meta.url), 'utf8');
const tasks = await read('../../me2-ui/src/components/me2/pages/tasks.tsx');
const agents = await read('../../me2-ui/src/components/me2/pages/agents.tsx');
const hook = await read('../../me2-ui/src/hooks/use-temporary-peek.ts');

test('R96C task Peek rows keep non-button semantics while the retired Agents page exposes no Peek row', () => {
  assert.match(tasks, /data-peek-kind="task"[\s\S]{0,420}role="link"|role="link"[\s\S]{0,420}data-peek-kind="task"/);
  assert.match(tasks, /data-peek-kind="task"[\s\S]{0,420}role="group"|role="group"[\s\S]{0,420}data-peek-kind="task"/);
  assert.doesNotMatch(tasks, /role="button"[\s\S]{0,180}data-peek-kind="task"/);

  assert.match(agents, /data-testid="retired-agents-page"/);
  assert.match(agents, /data-authority-effect="false"/);
  assert.doesNotMatch(agents, /data-peek-kind="agent"/);
  assert.doesNotMatch(agents, /role="button"/);
});

test('R96C task activation remains Enter plus presentation-only Space; retired Agents has no activation keys', () => {
  assert.match(tasks, /if \(e\.key === "Enter"\)[\s\S]{0,100}openTask\(t\.id\)/);
  assert.match(tasks, /else if \(e\.key === " "\) e\.preventDefault\(\)/);
  assert.match(tasks, /aria-keyshortcuts="Enter Space"/);
  assert.doesNotMatch(tasks, /aria-keyshortcuts="[^"]*Arrow(?:Up|Down)/);

  assert.doesNotMatch(agents, /openAgentChat/);
  assert.doesNotMatch(agents, /aria-keyshortcuts=/);
  assert.doesNotMatch(agents, /onKeyDown=/);
});

test('R96C nested controls stay reserved from Peek capture and retired Agents cannot mutate lifecycle', () => {
  assert.match(hook, /const interactive = target\.closest/);
  assert.match(hook, /if \(row && interactive === row\) return false/);
  assert.match(hook, /return Boolean\(interactive\)/);

  for (const forbidden of ['Пауза', 'Возобновить', 'retireAgent', 'pauseAgent', 'resumeAgent', 'agentChatOp']) {
    assert.equal(agents.includes(forbidden), false, `retired Agents page still carries lifecycle mutation token: ${forbidden}`);
  }
});

test('R96C remains a presentation/focus contract and creates no new effect path', () => {
  const touched = tasks + '\n' + agents;
  assert.doesNotMatch(touched, /ipcRenderer|shell\.exec|raw CDP|eval\(/);
  assert.match(hook, /setPeekTarget/);
  assert.doesNotMatch(hook, /sendCommand|me2Fetch|fetch\(|WebSocket|agentChatOp/);
});
