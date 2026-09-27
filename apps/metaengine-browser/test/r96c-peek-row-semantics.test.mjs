import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (url) => readFile(new URL(url, import.meta.url), 'utf8');
const tasks = await read('../../me2-ui/src/components/me2/pages/tasks.tsx');
const agents = await read('../../me2-ui/src/components/me2/pages/agents.tsx');
const hook = await read('../../me2-ui/src/hooks/use-temporary-peek.ts');

test('R96C Peek focus rows no longer claim button semantics while Space is reserved for preview', () => {
  assert.match(tasks, /data-peek-kind="task"[\s\S]{0,420}role="link"|role="link"[\s\S]{0,420}data-peek-kind="task"/);
  assert.match(tasks, /data-peek-kind="task"[\s\S]{0,420}role="group"|role="group"[\s\S]{0,420}data-peek-kind="task"/);
  assert.match(agents, /role="group"[\s\S]{0,420}data-peek-kind="agent"/);
  assert.doesNotMatch(tasks, /role="button"[\s\S]{0,180}data-peek-kind="task"/);
  assert.doesNotMatch(agents, /role="button"[\s\S]{0,180}data-peek-kind="agent"/);
});

test('R96C primary activation remains Enter while Space remains presentation-only Peek', () => {
  assert.match(tasks, /if \(e\.key === "Enter"\)[\s\S]{0,100}openTask\(t\.id\)/);
  assert.match(tasks, /else if \(e\.key === " "\) e\.preventDefault\(\)/);
  assert.match(agents, /if \(e\.key === "Enter"\) openAgentChat\(a\)/);
  assert.match(agents, /else if \(e\.key === " "\) e\.preventDefault\(\)/);
  assert.match(tasks, /aria-keyshortcuts="Enter Space ArrowUp ArrowDown"/);
  assert.match(agents, /aria-keyshortcuts="Enter Space ArrowUp ArrowDown"/);
});

test('R96C nested real controls remain reserved from Peek capture', () => {
  assert.match(hook, /const interactive = target\.closest/);
  assert.match(hook, /if \(row && interactive === row\) return false/);
  assert.match(hook, /return Boolean\(interactive\)/);
  assert.match(agents, /<button[\s\S]{0,240}Пауза|<button[\s\S]{0,240}Возобновить/);
  assert.match(agents, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); void retireAgent/);
});

test('R96C remains a presentation/focus contract and creates no new effect path', () => {
  const touched = tasks + '\n' + agents;
  assert.doesNotMatch(touched, /ipcRenderer|shell\.exec|raw CDP|eval\(/);
  assert.match(hook, /setPeekTarget/);
  assert.doesNotMatch(hook, /sendCommand|me2Fetch|fetch\(|WebSocket|agentChatOp/);
});
