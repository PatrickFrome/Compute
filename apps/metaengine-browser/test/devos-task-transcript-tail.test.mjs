import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { captureTranscript } from '../src/native-browser-control.mjs';
import { releasePersistentBrowserDebugger } from '../src/browser-persistent-cdp-session.mjs';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle-core.mjs';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const conversationUrl = 'https://chat.z.ai/c/12345678-abcd-4abc-8abc-123456789abc';
const lease = {
  task_id: '09f2e414-5c31-4fc7-87a3-f5de1315cb81',
  agent_id: 'agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510',
  role: 'IMPLEMENTER', tab_id: 'tab_ff91dce7-eeb3-425d-9052-94d521c2dfa6',
  target_id: 'webcontents:10', agent_generation_epoch: 7, lease_generation: 1,
  base_sha: '724612235eb7ceb4534c13d126425b274d876394',
  automatic_retry_allowed: false,
  conversation_url_sha256: sha256(conversationUrl),
  task_spec: { objective: 'Produce one verified result.', meta_orchestrator: { plan_id: 'plan-1' } },
};
const fleet = {
  schema: 'metaengine.browser.fleet-snapshot.v1', policy: { warm_agents: 1 },
  agents: [{
    agent_id: lease.agent_id, role: lease.role, lifecycle_state: 'ACTIVE',
    tab_id: lease.tab_id, target_id: lease.target_id, generation_epoch: 7,
  }],
};
const claim = [
  '```result', 'RESULT_CLAIM_V1',
  JSON.stringify({ task_id: lease.task_id, lease_generation: 1, disposition: 'READY', summary: 'Verified the useful result.', evidence_refs: ['ci:exact-head'], deliverable_refs: ['artifact:verified'] }),
  '```',
].join('\n');

function textNode(text) { return { role: { value: 'StaticText' }, name: { value: text } }; }

function fakeWebContents(nodes, { nextNodes = null } = {}) {
  let attached = false;
  let captureCount = 0;
  const methods = [];
  const webContents = {
    id: 10, isDestroyed: () => false, getOSProcessId: () => 100,
    getURL: () => conversationUrl, getTitle: () => 'Agent', once() {}, off() {},
    debugger: {
      isAttached: () => attached, attach() { attached = true; }, detach() { attached = false; },
      on() {}, off() {},
      async sendCommand(method) {
        methods.push(method);
        if (method !== 'Accessibility.getFullAXTree') return {};
        captureCount += 1;
        return { nodes: captureCount > 1 && nextNodes ? nextNodes : nodes };
      },
    },
  };
  return { webContents, methods };
}

function response(body) { return { ok: true, status: 200, async json() { return structuredClone(body); } }; }

async function observe(nodes, { ambiguousWrite = false, nextNodes = null } = {}) {
  const { webContents, methods } = fakeWebContents(nodes, { nextNodes });
  const commands = [];
  const completions = [];
  const toolIssues = [];
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => ({ fleet, tabs: [{ tab_id: lease.tab_id, role: 'FLEET' }] }),
    executeCommand: async (command) => {
      commands.push(command);
      if (command.action === 'FLEET_RECONCILE') return fleet;
      if (command.action === 'CAPTURE') return { tab_id: lease.tab_id, target_id: lease.target_id, url: conversationUrl, semantic_targets: [] };
      if (command.action === 'READ_TRANSCRIPT') return captureTranscript(webContents, command.payload);
      throw new Error(`physical_effect_must_not_run:${command.action}`);
    },
    signedRequest: async (path, options) => {
      if (path === '/v1/devos/cycle') return response({ schema: 'metaengine.devos.browser-cycle.v1', backlog: { running: 1 }, running: [lease] });
      if (path === '/v1/devos/complete') {
        completions.push(options.payload);
        if (ambiguousWrite) throw new Error('completion_ack_lost');
        return response({ state: options.payload.state });
      }
      if (path === `/v1/devos/tasks/${lease.task_id}/status`) return response({ state: 'RESULT_READY', lease_generation: lease.lease_generation });
      if (path === '/v1/commands/issue-tool') {
        toolIssues.push(options.payload);
        return response({ accepted: true, command_id: 'tool-command-1' });
      }
      if (path === '/v1/commands/tool-command-1/receipt') return response({ found: true, terminal: true, status: 'COMPLETED' });
      throw new Error(`unexpected_request:${path}`);
    },
  });
  try { return { snapshot: await cycle.cycle(), commands, completions, methods, toolIssues }; }
  finally { releasePersistentBrowserDebugger(webContents); }
}

test('transcript census reports all text nodes independently of the requested page', async () => {
  const nodes = [textNode('a'.repeat(2100)), textNode('b'.repeat(3000)), textNode('tail'), { role: { value: 'TextField' }, name: { value: 'private composer' } }];
  const expected = nodes.slice(0, 3).map((node) => node.name.value).join('\n');
  const { webContents, methods } = fakeWebContents(nodes);
  try {
    const page = await captureTranscript(webContents, { offset: 0, max_chars: 2000 });
    assert.equal(page.total_chars, expected.length);
    assert.equal(page.text, expected.slice(0, 2000));
    assert.equal(page.has_more, true);
    assert.equal(page.census_truncated, false);
    assert.equal(page.authority_effect, false);
    assert.equal(page.semantic_refs_issued, 0);
    assert.equal(methods.some((method) => method.startsWith('Input.')), false);
    const tail = await captureTranscript(webContents, { offset: expected.length - 1000, max_chars: 1000 });
    assert.equal(tail.total_chars, expected.length);
    assert.equal(tail.text, expected.slice(-1000));
    assert.equal(tail.has_more, false);
  } finally { releasePersistentBrowserDebugger(webContents); }
});

for (const total of [1999, 2000, 2001, 5000, 19999, 20000, 20001, 65000, 240000]) {
  test(`running task harvests exact result from the end of a ${total}-character multi-node transcript`, async () => {
    const prefixLength = total - claim.length - 2;
    const prefix = 'x'.repeat(prefixLength);
    const split = Math.floor(prefix.length / 2);
    const nodes = [textNode(prefix.slice(0, split)), textNode(prefix.slice(split)), textNode(claim)];
    assert.equal(nodes.map((node) => node.name.value).join('\n').length, total);
    const { snapshot, commands, completions } = await observe(nodes);
    assert.equal(snapshot.result_ready.state, 'RESULT_READY');
    assert.equal(completions.length, 1);
    assert.equal(completions[0].summary.result_claim_disposition, 'READY');
    assert.match(completions[0].summary.result_claim_sha256, /^[a-f0-9]{64}$/);
    assert.equal(completions[0].summary.conversation_url_sha256, lease.conversation_url_sha256);
    assert.equal(commands.some((command) => ['SEMANTIC_TYPE', 'TYPED_CLICK', 'PRESS_KEY', 'SELECT_TAB'].includes(command.action)), false);
    assert.equal(commands.filter((command) => command.action === 'READ_TRANSCRIPT').length <= 2, true);
  });
}

test('bounded tail excludes historical claims before the current result window', async () => {
  const { completions } = await observe([textNode(claim), textNode('x'.repeat(65000)), textNode(claim)]);
  assert.equal(completions[0].state, 'RESULT_READY');
  assert.equal(completions[0].summary.result_claim_disposition, 'READY');
});

test('ambiguous completion acknowledgement reads durable status without replaying a Browser effect', async () => {
  const { snapshot, commands, completions } = await observe([textNode('x'.repeat(5000)), textNode(claim)], { ambiguousWrite: true });
  assert.equal(snapshot.result_ready.readback, 'STATUS_PROVEN_AFTER_AMBIGUOUS_WRITE');
  assert.equal(completions.length, 1);
  assert.equal(completions[0].summary.result_claim_disposition, 'READY');
  assert.equal(commands.some((command) => ['SEMANTIC_TYPE', 'TYPED_CLICK', 'PRESS_KEY'].includes(command.action)), false);
});

test('transcript census is bounded and marks omitted content rather than claiming a complete tail', async () => {
  const { webContents } = fakeWebContents([textNode('a'.repeat(240000)), textNode(claim)]);
  try {
    const page = await captureTranscript(webContents, { offset: 239000, max_chars: 60000 });
    assert.equal(page.total_chars, 240000);
    assert.equal(page.text.length, 1000);
    assert.equal(page.has_more, false);
    assert.equal(page.census_truncated, true);
  } finally { releasePersistentBrowserDebugger(webContents); }
  const { completions } = await observe([textNode(claim), textNode('x'.repeat(240000)), textNode('newer answer was omitted')]);
  assert.equal(completions[0].state, 'BLOCKED');
  assert.equal(completions[0].summary.result_claim_state, 'TRANSCRIPT_CENSUS_TRUNCATED');
  assert.equal(completions[0].summary.result_claim_sha256, undefined);
});

for (const mutation of ['growth', 'shrink']) {
  test(`transcript ${mutation} between census and tail cannot accept a result or issue a tool`, async () => {
    const tool = ['```tool', 'TOOL_REQUEST_V1', 'request_id=drift-canary', 'action=CAPTURE', '```'].join('\n');
    const nodes = [textNode('x'.repeat(65000)), textNode(claim), textNode(tool)];
    const nextNodes = mutation === 'growth'
      ? [...nodes, textNode('newer content'.repeat(500))]
      : [textNode('x'.repeat(60000)), textNode(claim), textNode(tool)];
    const { snapshot, completions, toolIssues, commands } = await observe(nodes, { nextNodes });
    assert.equal(snapshot.result_ready.state, 'BLOCKED');
    assert.equal(completions[0].summary.result_claim_state, 'TRANSCRIPT_TAIL_UNSTABLE');
    assert.equal(completions[0].summary.result_claim_sha256, undefined);
    assert.equal(toolIssues.length, 0);
    assert.equal(commands.filter((command) => command.action === 'READ_TRANSCRIPT').length, 2);
    assert.equal(commands.some((command) => ['SEMANTIC_TYPE', 'TYPED_CLICK', 'PRESS_KEY', 'SELECT_TAB'].includes(command.action)), false);
  });
}
