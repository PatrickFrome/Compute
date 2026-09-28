import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (url) => readFile(new URL(url, import.meta.url), 'utf8');
const tasks = await read('../../me2-ui/src/components/me2/pages/tasks.tsx');
const agents = await read('../../me2-ui/src/components/me2/pages/agents.tsx');
const hook = await read('../../me2-ui/src/hooks/use-temporary-peek.ts');

test('R103 retained Task Peek rows keep presentation semantics without button authority', () => {
  assert.match(tasks, /data-peek-kind="task"[\s\S]{0,420}role="link"|role="link"[\s\S]{0,420}data-peek-kind="task"/);
  assert.match(tasks, /data-peek-kind="task"[\s\S]{0,420}role="group"|role="group"[\s\S]{0,420}data-peek-kind="task"/);
  assert.doesNotMatch(tasks, /role="button"[\s\S]{0,180}data-peek-kind="task"/);
  assert.match(tasks, /if \(e\.key === "Enter"\)[\s\S]{0,100}openTask\(t\.id\)/);
  assert.match(tasks, /else if \(e\.key === " "\) e\.preventDefault\(\)/);
  assert.match(tasks, /aria-keyshortcuts="Enter Space"/);
});

test('R103 retired Agents page cannot participate in Peek, chat navigation or fleet mutation', () => {
  assert.match(agents, /data-testid="retired-agents-page"/);
  assert.match(agents, /data-authority-effect="false"/);
  assert.doesNotMatch(agents, /data-peek-kind=|openAgentChat\(|retireAgent|aria-keyshortcuts=|onClick=|<button/);
});

test('R103 nested real controls remain reserved from temporary Peek capture', () => {
  assert.match(hook, /const interactive = target\.closest/);
  assert.match(hook, /if \(row && interactive === row\) return false/);
  assert.match(hook, /return Boolean\(interactive\)/);
});

test('R103 Peek remains presentation-only and creates no new effect path', () => {
  const touched = tasks + '\n' + agents;
  assert.doesNotMatch(touched, /ipcRenderer|shell\.exec|raw CDP|eval\(/);
  assert.match(hook, /setPeekTarget/);
  assert.doesNotMatch(hook, /sendCommand|me2Fetch|fetch\(|WebSocket|agentChatOp/);
});
