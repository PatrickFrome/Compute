import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { resolve, normalize, relative, isAbsolute, sep } from 'node:path';
import test from 'node:test';

// Execute the audited production function bodies with offline owner stubs.
// No store import, model/network call, filesystem mutation, or child spawn.
const file = new URL('../worker.ts', import.meta.url);
const src = stripTypeScriptTypes(readFileSync(file, 'utf8'), { mode: 'strip' });
const between = (start, end) => {
  const begin = src.indexOf(start);
  const finish = src.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin, `${start}: production source anchor missing`);
  return src.slice(begin, finish);
};

const joinBody = between('function safeJoin(', 'async function runShell(');
const makeArtifactHelpers = (files = new Map()) => new Function('resolve', 'normalize', 'relative', 'isAbsolute', 'sep', 'createHash', 'readFileSync', 'taskDir',
  `${joinBody}; return { safeJoin, captureWriteArtifact, unverifiedWrittenArtifacts };`)(
  resolve, normalize, relative, isAbsolute, sep, createHash,
  (path) => { if (!files.has(path)) throw new Error('ENOENT'); return Buffer.from(files.get(path)); },
  () => resolve('owned-workspace', 'task_a'),
);
const { safeJoin } = makeArtifactHelpers();

test('worker path boundary rejects a sibling whose name starts with the task directory', () => {
  const cwd = resolve('owned-workspace', 'task_a');
  assert.throws(() => safeJoin(cwd, '../task_a_neighbor/report.txt'), /path_escape_blocked/);
});

const sigStatsBody = between('function sigStats(', '// \u2500\u2500 R18');
const verdictBody = between('export function buildVerdict(', '/** \u0420\u0435\u0444\u043b\u0435\u043a\u0441\u0438\u044f').replace('export function', 'function');
const verdict = new Function(`${sigStatsBody}\nconst CREATION_SPEC_RE = /write_file|\u0437\u0430\u043f\u0438\u0441|\u0441\u043e\u0437\u0434\u0430|hello\\.txt|docs\\//i;\n${verdictBody}; return buildVerdict;`)();

test('a failed write cannot satisfy the creation proof or evade no-writes verdict', () => {
  const result = verdict({ spec: 'write_file docs/report.md with the requested report' }, {
    steps: 3,
    toolCalls: [{ tool: 'write_file', sig: 'write_file:report', err: true }, { tool: 'finish', sig: 'finish', err: false }],
    result: 'The requested report was successfully written to docs/report.md.',
  });
  assert.ok(result?.reasons.includes('no_writes_on_creation_task'));
});

const taskBody = between('async function runAgentTask(', 'let timer');
const makeTaskRunner = (deps) => new Function(...Object.keys(deps), `${taskBody}; return runAgentTask;`)(...Object.values(deps));

function ownerStubs({ replies, files = new Map(), afterTool } = {}) {
  const task = { id: 'audit_task', title: 'Offline test', spec: 'write_file report.txt', status: 'READY', max_steps: 3, park_count: 0 };
  const agent = { id: 'audit_agent', role: 'EXECUTOR', model: 'OFFLINE_STUB' };
  const events = [];
  const mutations = [];
  const effects = [];
  let currentStatus = 'READY';
  let calls = 0;
  const helpers = makeArtifactHelpers(files);
  const deps = {
    isPoolAgent: () => false, poolAcquire: () => null, poolRelease: () => {}, running: new Set(), setAgentStatus: () => {},
    updateTask: (_id, patch) => { mutations.push(patch); if (patch.status) currentStatus = patch.status; },
    emit: (name, payload) => events.push({ name, payload }), systemPrompt: () => 'Offline model stub', parentMemory: () => null,
    TASK_HARD_DEADLINE_MS: 600_000, recordSpan: () => {},
    chat: async () => JSON.stringify(replies[calls++] ?? { action: { tool: 'finish', args: { result: 'The requested report was written.' } } }),
    extractJson: JSON.parse, fleetStep: () => {},
    execTool: async (tool, args) => {
      effects.push({ tool, args, lease: currentStatus });
      if (tool === 'write_file') files.set(helpers.safeJoin(resolve('owned-workspace', 'task_a'), args.path), String(args.content));
      await afterTool?.({ tool, args, files, revoke: (status) => { currentStatus = status; } });
      return 'OK';
    },
    leaseAlive: () => currentStatus === 'RUNNING', reviewTask: () => {}, buildVerdict: verdict,
    captureWriteArtifact: helpers.captureWriteArtifact, unverifiedWrittenArtifacts: helpers.unverifiedWrittenArtifacts,
    buildReflection: () => '{}', isQuotaError: () => false, PARK_MAX: 0, parkTaskQuota: () => {},
  };
  return { task, agent, deps, events, mutations, effects, files, status: () => currentStatus };
}

test('revoking the task lease while model generation is pending prevents every subsequent tool effect', async () => {
  const task = { id: 'audit_task', title: 'Offline test', spec: 'write_file report.txt', status: 'READY', max_steps: 2, park_count: 0 };
  const agent = { id: 'audit_agent', role: 'EXECUTOR', model: 'OFFLINE_STUB' };
  const effects = [];
  const mutations = [];
  let currentStatus = 'READY';
  let calls = 0;
  const runner = makeTaskRunner({
    isPoolAgent: () => false,
    poolAcquire: () => null,
    poolRelease: () => {},
    running: new Set(),
    setAgentStatus: () => {},
    updateTask: (_id, patch) => { mutations.push(patch); if (patch.status) currentStatus = patch.status; },
    emit: () => {},
    systemPrompt: () => 'Offline model stub',
    parentMemory: () => null,
    TASK_HARD_DEADLINE_MS: 600_000,
    recordSpan: () => {},
    chat: async () => {
      currentStatus = 'HANDED_OFF';
      return ++calls === 1
        ? JSON.stringify({ action: { tool: 'write_file', args: { path: 'report.txt', content: 'changed' } } })
        : JSON.stringify({ action: { tool: 'finish', args: { result: 'done' } } });
    },
    extractJson: JSON.parse,
    fleetStep: () => {},
    execTool: async (tool, args) => { effects.push({ tool, args, lease: currentStatus }); return 'OK'; },
    leaseAlive: () => currentStatus === 'RUNNING',
    reviewTask: () => {},
    buildVerdict: () => null,
    buildReflection: () => '{}',
    isQuotaError: () => false,
    PARK_MAX: 0,
    parkTaskQuota: () => {},
  });
  await runner(agent, task);
  assert.deepEqual(effects, [], 'revoked lease executed tools');
  assert.equal(mutations.some((patch) => patch.steps && !patch.status), false, 'revoked lease wrote progress');
});

test('finish after a failed write is FAILED and never emits TASK_DONE', async () => {
  const state = ownerStubs({ replies: [{ action: { tool: 'write_file', args: { path: 'report.txt', content: 'expected' } } }] });
  state.deps.execTool = async () => 'ERROR: EACCES';
  await makeTaskRunner(state.deps)(state.agent, state.task);
  assert.equal(state.status(), 'FAILED');
  assert.equal(state.events.some((event) => event.name === 'TASK_DONE'), false);
  assert.equal(state.mutations.at(-1).error, 'unverified_result');
});

test('finish without any creation effect cannot be reported COMPLETED', async () => {
  const state = ownerStubs({ replies: [] });
  await makeTaskRunner(state.deps)(state.agent, state.task);
  assert.equal(state.status(), 'FAILED');
  assert.equal(state.events.some((event) => event.name === 'TASK_DONE'), false);
});

test('an unchanged file with exact readback can complete', async () => {
  const state = ownerStubs({ replies: [{ action: { tool: 'write_file', args: { path: 'report.txt', content: 'expected' } } }] });
  await makeTaskRunner(state.deps)(state.agent, state.task);
  assert.equal(state.status(), 'COMPLETED');
  assert.equal(state.events.some((event) => event.name === 'TASK_DONE'), true);
});

test('later replacement of a pinned artifact prevents COMPLETED', async () => {
  const state = ownerStubs({ replies: [
    { action: { tool: 'write_file', args: { path: 'report.txt', content: 'expected' } } },
    { action: { tool: 'shell', args: { command: 'offline fixture mutation' } } },
  ], afterTool: ({ tool, files }) => { if (tool === 'shell') files.set(resolve('owned-workspace', 'task_a', 'report.txt'), 'changed'); } });
  await makeTaskRunner(state.deps)(state.agent, state.task);
  assert.equal(state.status(), 'FAILED');
  assert.equal(state.events.some((event) => event.name === 'TASK_DONE'), false);
  assert.deepEqual(state.events.find((event) => event.name === 'TASK_FAILED').payload.artifact_issues, ['artifact_content_changed']);
});

test('a missing artifact prevents COMPLETED', async () => {
  const state = ownerStubs({ replies: [
    { action: { tool: 'write_file', args: { path: 'report.txt', content: 'expected' } } },
    { action: { tool: 'shell', args: { command: 'offline fixture removal' } } },
  ], afterTool: ({ tool, files }) => { if (tool === 'shell') files.clear(); } });
  await makeTaskRunner(state.deps)(state.agent, state.task);
  assert.equal(state.status(), 'FAILED');
  assert.deepEqual(state.events.find((event) => event.name === 'TASK_FAILED').payload.artifact_issues, ['artifact_readback_unavailable']);
});

test('rewriting the same file verifies its final successful revision', async () => {
  const state = ownerStubs({ replies: [
    { action: { tool: 'write_file', args: { path: 'report.txt', content: 'first' } } },
    { action: { tool: 'write_file', args: { path: 'report.txt', content: 'final' } } },
  ] });
  await makeTaskRunner(state.deps)(state.agent, state.task);
  assert.equal(state.status(), 'COMPLETED');
});

test('lease loss while a tool is pending prevents progress and subsequent tools', async () => {
  const state = ownerStubs({ replies: [{ action: { tool: 'write_file', args: { path: 'report.txt', content: 'expected' } } }],
    afterTool: ({ revoke }) => revoke('FAILED') });
  await makeTaskRunner(state.deps)(state.agent, state.task);
  assert.equal(state.effects.length, 1);
  assert.equal(state.status(), 'FAILED');
  assert.equal(state.mutations.some((patch) => patch.steps && !patch.status), false);
  assert.equal(state.events.some((event) => event.name === 'TASK_DONE'), false);
});

test('broad creation wording does not hard-fail shell-only work without an explicit file tool contract', async () => {
  const state = ownerStubs({ replies: [{ action: { tool: 'shell', args: { command: 'offline fixture build' } } }] });
  state.task.spec = '\u0421\u043e\u0437\u0434\u0430\u0439 \u043e\u0442\u0447\u0435\u0442 \u043a\u043e\u043c\u0430\u043d\u0434\u043e\u0439 \u0441\u0431\u043e\u0440\u043a\u0438';
  await makeTaskRunner(state.deps)(state.agent, state.task);
  assert.equal(state.status(), 'COMPLETED');
  assert.equal(state.events.some((event) => event.name === 'TASK_REWARD_HACK'), true);
});

test('a failed write followed by a successful exact replacement can recover', async () => {
  const state = ownerStubs({ replies: [
    { action: { tool: 'write_file', args: { path: 'report.txt', content: 'expected' } } },
    { action: { tool: 'write_file', args: { path: 'report.txt', content: 'recovered' } } },
  ] });
  const tool = state.deps.execTool;
  let attempt = 0;
  state.deps.execTool = async (...args) => ++attempt === 1 ? 'ERROR: EACCES' : tool(...args);
  await makeTaskRunner(state.deps)(state.agent, state.task);
  assert.equal(state.status(), 'COMPLETED');
});
