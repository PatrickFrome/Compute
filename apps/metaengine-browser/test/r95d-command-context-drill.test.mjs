import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const commandUrl = new URL('../../me2-ui/src/components/me2/pages/command.tsx', import.meta.url);
const tasks = await readFile(new URL('../../me2-ui/src/components/me2/pages/tasks.tsx', import.meta.url), 'utf8');
const observability = await readFile(new URL('../../me2-ui/src/components/me2/pages/observability.tsx', import.meta.url), 'utf8');
const store = await readFile(new URL('../../me2-ui/src/components/me2/store.tsx', import.meta.url), 'utf8');

test('R106 retired COMMAND page is absent rather than a compatibility authority surface', () => {
  assert.equal(fs.existsSync(commandUrl), false);
  const pageType = store.slice(store.indexOf('export type PageKey'), store.indexOf('// R97 native swarm convergence'));
  assert.equal(pageType.includes('"command"'), false);
});

test('R106 exact task drill remains on TASKS and OBSERVE after COMMAND removal', () => {
  assert.match(tasks, /openTask\(t\.id\)/);
  assert.match(observability, /const inspectedTaskId = useMe2\(\(s\) => s\.inspectedTaskId\)/);
  assert.match(observability, /data-binding-mode=\{inspectedTaskId \? "EXACT_TASK_ID" : "UNBOUND"\}/);
  assert.match(observability, /openTask\(inspectedTaskId\)/);
  assert.match(observability, /setPage\("tasks"\)/);
});
