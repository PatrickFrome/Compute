import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  AGENT_TOOL_ACTIONS,
  AGENT_TOOL_REQUEST_MARKER,
  AGENT_TOOL_RESULT_MARKER,
  agentToolProtocolSnapshot,
  parseAgentToolRequests,
  renderAgentToolProtocol,
  renderAgentToolResults,
} from '../src/agent-tool-protocol.mjs';
import { AgentToolbelt, agentToolbeltTrustRootSnapshot } from '../src/agent-toolbelt-core.mjs';
import { DevOsNativeTaskCycle, renderDevosTaskPrompt } from '../src/devos-native-task-cycle-core.mjs';

const edge = await fs.readFile(new URL('../supabase/a2-browser-native-supervisor-v1/index.ts', import.meta.url), 'utf8');

const LEASE = Object.freeze({
  task_id: '550e8400-e29b-41d4-a716-446655440000',
  agent_id: 'agent_fleetabcd',
  lease_generation: 1,
  tab_id: 'tab_123e4567-e89b-42d3-a456-426614174222',
  target_id: 'webcontents:9',
  base_sha: 'a'.repeat(40),
  role: 'BUG_HUNTER',
  agent_generation_epoch: 1,
  automatic_retry_allowed: false,
  task_spec: { objective: 'verify the toolbelt', constraints: [], deliverable: 'a report' },
});

function requestBlock({ request_id = 'req-0001', action = 'CAPTURE', tab_id = LEASE.tab_id, payload_json = '{"offset":0}' } = {}) {
  return ['```tool', AGENT_TOOL_REQUEST_MARKER, `request_id=${request_id}`, `action=${action}`, `tab_id=${tab_id}`, `payload_json=${payload_json}`, '```'].join('\n');
}

test('parseAgentToolRequests accepts valid fenced blocks and rejects invalid ones', () => {
  const text = [
    'assistant reply preamble (untrusted)',
    requestBlock(),
    requestBlock({ request_id: 'req-0002', action: 'SYSTEM_TELEMETRY', tab_id: '' }),
    '```tool', 'TOOL_REQUEST_V1', 'request_id=bad id!', 'action=CAPTURE', '```',
    '```tool', 'TOOL_REQUEST_V1', 'request_id=req-0003', 'action=TYPED_CLICK', '```',
    '```tool', 'TOOL_REQUEST_V1', 'request_id=req-0004', 'action=CAPTURE', 'payload_json=not json', '```',
  ].join('\n');
  const parsed = parseAgentToolRequests(text);
  assert.equal(parsed.requests.length, 2);
  assert.equal(parsed.requests[0].request_id, 'req-0001');
  assert.equal(parsed.requests[0].action, 'CAPTURE');
  assert.equal(parsed.requests[0].tab_id, LEASE.tab_id);
  assert.deepEqual(parsed.requests[0].payload, { offset: 0 });
  assert.equal(parsed.requests[1].tab_id, null);
  assert.ok(parsed.invalid.length >= 3, 'invalid blocks are reported');
  assert.equal(parsed.authority_effect, false);
  assert.ok(!AGENT_TOOL_ACTIONS.includes('TYPED_CLICK'), 'conversation mutation is not a tool action');
  assert.ok(AGENT_TOOL_ACTIONS.includes('COMPUTER_OBSERVE'));
  assert.ok(AGENT_TOOL_ACTIONS.includes('COMPUTER_ACTION'));
  assert.equal(parseAgentToolRequests('no blocks here').requests.length, 0);
});

test('parseAgentToolRequests bounds requests per message', () => {
  const text = [1, 2, 3, 4, 5, 6].map((i) => requestBlock({ request_id: `req-000${i}` })).join('\n');
  const parsed = parseAgentToolRequests(text);
  assert.equal(parsed.requests.length, 4);
  assert.equal(parsed.overflow, 2);
});

test('renderAgentToolProtocol and renderAgentToolResults are prompt-bounded and round-trippable', () => {
  const protocol = renderAgentToolProtocol({ tab_id: LEASE.tab_id });
  assert.ok(protocol.includes(AGENT_TOOL_REQUEST_MARKER));
  assert.ok(protocol.includes('CAPTURE'));
  assert.ok(protocol.length <= 1200, `protocol must fit the prompt clip budget (got ${protocol.length})`);
  const results = renderAgentToolResults([
    { request_id: 'req-0001', status: 'COMPLETED', summary: 'page captured; 42 interactive elements' },
    { request_id: 'req-0002', status: 'UNAVAILABLE', summary: 'reason=EDGE_ROUTE_UNAVAILABLE' },
  ]);
  assert.ok(results.includes(AGENT_TOOL_RESULT_MARKER));
  assert.ok(results.includes('request_id=req-0001'));
  assert.ok(results.includes('status=COMPLETED'));
  assert.equal(renderAgentToolResults([]), '');
  const snapshot = agentToolProtocolSnapshot();
  assert.equal(snapshot.conversation_mutation_allowed, false);
  assert.equal(snapshot.authority_effect, false);
});

test('renderDevosTaskPrompt carries the tool protocol and previous tool results', () => {
  const prompt = renderDevosTaskPrompt(LEASE, {
    telemetry_digest: 'SYSTEM TELEMETRY (stub)',
    context_briefing: 'AGENT CONTEXT (stub)',
    tool_protocol: renderAgentToolProtocol({ tab_id: LEASE.tab_id }),
    tool_results: [{ request_id: 'req-0001', status: 'COMPLETED', summary: 'ok' }],
  });
  assert.ok(prompt.includes('TOOL PROTOCOL'));
  assert.ok(prompt.includes(AGENT_TOOL_RESULT_MARKER));
  assert.ok(prompt.includes('request_id=req-0001'));
  assert.ok(prompt.length <= 24000);
  const plain = renderDevosTaskPrompt(LEASE, {});
  assert.ok(!plain.includes('TOOL PROTOCOL'));
  assert.ok(!plain.includes(AGENT_TOOL_RESULT_MARKER));
});

test('AgentToolbelt issues attributed commands, harvests terminal receipts, and reports results per agent', async () => {
  const issued = [];
  const receipts = new Map();
  const signedRequest = async (path, { method = 'POST', payload = null } = {}) => {
    if (method === 'POST' && path === '/v1/commands/issue-tool') {
      assert.equal(payload.agent_id, LEASE.agent_id);
      assert.equal(payload.task_id, LEASE.task_id);
      assert.equal(payload.action, 'CAPTURE');
      const commandId = `cmd-${issued.length + 1}`;
      issued.push({ ...payload, command_id: commandId });
      return { ok: true, status: 200, json: async () => ({ accepted: true, command_id: commandId, status: 'PENDING' }) };
    }
    if (method === 'GET' && path.startsWith('/v1/commands/cmd-') && path.endsWith('/receipt')) {
      const commandId = path.split('/')[3];
      const receipt = receipts.get(commandId);
      if (!receipt) return { ok: true, status: 200, json: async () => ({ found: false }) };
      return { ok: true, status: 200, json: async () => receipt };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const toolbelt = new AgentToolbelt({ signedRequest });
  const served = await toolbelt.serveToolRequests({
    lease: LEASE,
    requests: parseAgentToolRequests(requestBlock()).requests,
  });
  assert.equal(served.issued.length, 1);
  assert.equal(toolbelt.pendingCount(LEASE), 1);

  // Not terminal yet — harvest is a no-op.
  assert.equal((await toolbelt.harvestResults({ lease: LEASE })).length, 0);
  receipts.set('cmd-1', {
    found: true,
    terminal: true,
    status: 'COMPLETED',
    receipt: { result: { text_excerpt: 'captured page content' } },
  });
  const terminal = await toolbelt.harvestResults({ lease: LEASE });
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].status, 'COMPLETED');
  assert.ok(terminal[0].summary.includes('captured page content'));
  assert.equal(toolbelt.pendingCount(LEASE), 0);
  const forAgent = toolbelt.resultsForAgent(LEASE.agent_id);
  assert.equal(forAgent.length, 1);
  assert.equal(forAgent[0].request_id, 'req-0001');
  assert.deepEqual(toolbelt.resultsForAgent('agent_other'), []);

  // Duplicate request ids are deduped per lease.
  const again = await toolbelt.serveToolRequests({ lease: LEASE, requests: parseAgentToolRequests(requestBlock()).requests });
  assert.equal(again.issued.length, 0);
  const snap = toolbelt.snapshot();
  assert.equal(snap.issued_command_count, 1);
  assert.equal(snap.served_result_count, 1);
  assert.equal(snap.conversation_mutation_allowed, false);
  assert.equal(snap.authority_effect, false);
});

test('AgentToolbelt degrades to UNAVAILABLE when the edge route is not deployed', async () => {
  const signedRequest = async () => ({ ok: false, status: 404, json: async () => ({ error: 'not_found' }) });
  const toolbelt = new AgentToolbelt({ signedRequest });
  const served = await toolbelt.serveToolRequests({ lease: LEASE, requests: parseAgentToolRequests(requestBlock()).requests });
  assert.equal(served.issued.length, 0);
  assert.equal(served.unavailable.length, 1);
  assert.equal(served.unavailable[0].reason, 'EDGE_ROUTE_UNAVAILABLE');
  const forAgent = toolbelt.resultsForAgent(LEASE.agent_id);
  assert.equal(forAgent[0].status, 'UNAVAILABLE');
  assert.ok(forAgent[0].summary.includes('EDGE_ROUTE_UNAVAILABLE'));
  assert.equal(toolbelt.snapshot().counters.route_unavailable_streak, 1);
});

for (const failure of ['ROUTE_ABSENT', 'REJECTED', 'LOST_ISSUE_ACK', 'HTTP_500', 'MALFORMED_ACCEPTED', 'PROJECT_UNCERTAIN']) {
  test(`AgentToolbelt delivers lease-local ${failure} once without retrying the request`, async () => {
    let calls = 0;
    const toolbelt = new AgentToolbelt({ signedRequest: async () => {
      calls += 1;
      if (failure === 'LOST_ISSUE_ACK') throw new Error('acknowledgement lost after possible commit');
      if (failure === 'HTTP_500') return { ok: false, status: 500, json: async () => ({ error: 'backend_failed' }) };
      if (failure === 'MALFORMED_ACCEPTED') return { ok: true, status: 200, json: async () => ({ accepted: true }) };
      return { ok: false, status: failure === 'ROUTE_ABSENT' ? 404 : 403,
        json: async () => ({ error: 'request_denied' }) };
    } });
    if (failure === 'PROJECT_UNCERTAIN') toolbelt.bindProjectRuntime({ serveToolRequests: async () => {
      calls += 1; throw new Error('project operation outcome unknown');
    } });
    const requests = parseAgentToolRequests(requestBlock({
      action: failure === 'PROJECT_UNCERTAIN' ? 'PROJECT_SPAWN' : 'CAPTURE',
    })).requests;
    const first = await toolbelt.serveToolRequests({ lease: LEASE, requests });
    assert.equal(first.unavailable.length, 1);
    const results = toolbelt.resultsForLease(LEASE);
    assert.equal(results.length, 1, 'the current task must receive the failed tool result');
    assert.equal(results[0].status, 'UNAVAILABLE');
    const uncertain = ['LOST_ISSUE_ACK', 'HTTP_500', 'MALFORMED_ACCEPTED', 'PROJECT_UNCERTAIN'].includes(failure);
    if (uncertain) {
      assert.match(results[0].summary, /effect=UNKNOWN/);
      assert.match(results[0].summary, /readback_required=true/);
      assert.match(results[0].summary, /automatic_retry_allowed=false/);
    } else assert.doesNotMatch(results[0].summary, /effect=UNKNOWN/);
    const prompt = renderDevosTaskPrompt(LEASE, { tool_results: results });
    assert.ok(prompt.includes(results[0].summary), 'the result survives the existing agent prompt channel');
    assert.deepEqual(toolbelt.resultsForLease({ ...LEASE, lease_generation: 2 }), []);
    const again = await toolbelt.serveToolRequests({ lease: LEASE, requests });
    assert.deepEqual(again, { issued: [], unavailable: [] });
    assert.deepEqual(toolbelt.resultsForLease(LEASE), results);
    assert.equal(calls, 1, 'neither a denial nor an unknown issue ACK is blindly retried');
    assert.equal(toolbelt.snapshot().issued_command_count, 0);
  });
}

test('AgentToolbelt full budget preserves existing requests and retains one bounded denial witness', async () => {
  let issued = 0;
  const toolbelt = new AgentToolbelt({ maxCommandsPerLease: 2, signedRequest: async (_path, { method = 'POST' } = {}) => {
    if (method === 'GET') return { ok: true, status: 200,
      json: async () => ({ found: true, terminal: true, status: 'COMPLETED', receipt: { result: 'original result' } }) };
    issued += 1;
    return { ok: true, status: 200, json: async () => ({ accepted: true, command_id: `cmd-${issued}` }) };
  } });
  const request = n => parseAgentToolRequests(requestBlock({ request_id: `req-${String(n).padStart(4, '0')}` })).requests[0];
  await toolbelt.serveToolRequests({ lease: LEASE, requests: [request(1), request(2)] });
  assert.equal(toolbelt.pendingCount(LEASE), 2);
  const repeatPending = await toolbelt.serveToolRequests({ lease: LEASE, requests: [request(1)] });
  assert.deepEqual(repeatPending, { issued: [], unavailable: [] }, 'full budget cannot overwrite a pending request');
  assert.equal(toolbelt.pendingCount(LEASE), 2);
  await toolbelt.harvestResults({ lease: LEASE });
  const original = toolbelt.resultsForLease(LEASE);
  const flood = await toolbelt.serveToolRequests({ lease: LEASE,
    requests: [request(1), ...Array.from({ length: 100 }, (_, i) => request(i + 3))] });
  assert.equal(flood.issued.length, 0);
  assert.equal(flood.unavailable.length, 100);
  const terminal = toolbelt.resultsForLease(LEASE, { limit: 32 });
  assert.deepEqual(terminal.slice(0, 2), original, 'budget denial cannot replace a completed result');
  assert.equal(terminal.length, 3, 'only one overflow witness is retained for the lease');
  assert.equal(terminal[2].request_id, request(3).request_id);
  assert.match(terminal[2].summary, /BUDGET_EXHAUSTED/);
  assert.equal(toolbelt.snapshot().issued_command_count, 2);
  assert.equal(toolbelt.snapshot().served_result_count, 3);
  assert.equal(issued, 2);
  assert.deepEqual(await toolbelt.serveToolRequests({ lease: LEASE, requests: [request(3)] }),
    { issued: [], unavailable: [] });
});

test('native task cycle continues the same project with a denied tool result instead of a missing result claim', async () => {
  const conversationUrl = 'https://chatgpt.com/c/12345678-abcd-4abc-8abc-123456789abc';
  const lease = { ...LEASE, conversation_url_sha256: '986dfc07e0cac4d1ca8f8d672f7b4d88225bca95ba2ec2fe91b076ba171d089e',
    task_spec: { ...LEASE.task_spec, project_continuity: { project_id: '11111111-1111-4111-8111-111111111111' } } };
  const fleet = { schema: 'metaengine.browser.fleet-snapshot.v1', policy: { warm_agents: 1, spawn_burst_limit: 1 },
    agents: [{ agent_id: lease.agent_id, role: lease.role, tab_id: lease.tab_id, target_id: lease.target_id,
      generation_epoch: lease.agent_generation_epoch, lifecycle_state: 'ACTIVE' }] };
  const transcript = requestBlock();
  const continued = []; let issues = 0; let completions = 0;
  const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => ({ fleet }),
    executeCommand: async command => {
      if (command.action === 'FLEET_RECONCILE') return fleet;
      if (command.action === 'CAPTURE') return { url: conversationUrl, semantic_targets: [] };
      if (command.action === 'READ_TRANSCRIPT') return { text: transcript, total_chars: transcript.length, has_more: false };
      assert.fail(`unexpected browser effect: ${command.action}`);
    },
    signedRequest: async endpoint => {
      if (endpoint === '/v1/devos/cycle') return response(200, { schema: 'metaengine.devos.browser-cycle.v1',
        backlog: { ready: 0, running: 1 }, running: [lease] });
      if (endpoint === '/v1/commands/issue-tool') { issues += 1; return response(403, { error: 'request_denied' }); }
      if (endpoint === '/v1/devos/complete') { completions += 1; return response(200, { state: 'BLOCKED' }); }
      assert.fail(`unexpected route: ${endpoint}`);
    },
  });
  cycle.bindProjectRuntime({
    prepareLease: async () => ({}), contextForLease: () => 'PROJECT CONTINUITY V1',
    serveToolRequests: async () => [], waitForChildren: async () => ({ waiting: false, failed: false, children: [] }),
    continueConversation: async (bound, results) => {
      assert.equal(bound.task_id, lease.task_id);
      continued.push(results);
      return { state: 'DELIVERED' };
    },
  });
  await cycle.cycle();
  assert.equal(issues, 1);
  assert.equal(completions, 0, 'a recoverable tool denial must reach the current agent before task completion');
  assert.equal(continued.length, 1);
  assert.deepEqual(continued[0], [{ request_id: 'req-0001', status: 'UNAVAILABLE', summary: 'reason=request_denied' }]);
  assert.equal(cycle.snapshot().result_ready.state, 'PROJECT_CONTINUING');
});

test('AgentToolbelt enforces the per-lease command budget', async () => {
  const signedRequest = async () => ({ ok: true, status: 200, json: async () => ({ accepted: true, command_id: `cmd-${Math.random()}`, status: 'PENDING' }) });
  const toolbelt = new AgentToolbelt({ signedRequest, maxCommandsPerLease: 2 });
  const requests = [1, 2, 3].map((i) => parseAgentToolRequests(requestBlock({ request_id: `req-000${i}` })).requests[0]);
  const served = await toolbelt.serveToolRequests({ lease: LEASE, requests });
  assert.equal(served.issued.length, 2);
  assert.equal(served.unavailable.length, 1);
  assert.equal(served.unavailable[0].reason, 'BUDGET_EXHAUSTED');
  assert.equal(toolbelt.snapshot().issued_command_count, 2);
});

test('edge issue-tool route is mounted with allowlist validation and river task context', () => {
  assert.match(edge, /const ISSUE_NATIVE_RPC='h205f22_a2_browser_supervisor_issue_native_v1'/);
  assert.match(edge, /const TOOL_ISSUE_ACTIONS=new Set\(\['CAPTURE','READ_TRANSCRIPT','TAB_TELEMETRY','SYSTEM_TELEMETRY','SCROLL','SEMANTIC_FOCUS','COMPUTER_OBSERVE','COMPUTER_ACTION'\]\)/);
  assert.match(edge, /const ISSUE_COMPUTER_RPC='h205f22_a2_browser_supervisor_issue_computer_v1'/);
  assert.match(edge, /agent_tool_computer_agent_mismatch/);
  assert.match(edge, /computerAction[\s\S]*ISSUE_COMPUTER_RPC/);
  assert.match(edge, /path===\s*'\/v1\/commands\/issue-tool'/);
  assert.match(edge, /async function issueTool\(req:Request,body:any\)/);
  // Per-agent attribution + Outcome River binding context on every issued tool command.
  assert.match(edge, /p_issued_by:`agent:\$\{agentId\}`/);
  assert.match(edge, /toolPayload\.rsi_task=\{schema:'metaengine\.rsi\.command-task-context\.v1',task_id:taskId,agent_id:agentId\}/);
  assert.match(edge, /agent_tool_issue:true/);
  // Conversation mutation is not issuable through the tool route.
  assert.ok(!/TOOL_ISSUE_ACTIONS[^\]]*SEMANTIC_TYPE/.test(edge));
  assert.ok(agentToolbeltTrustRootSnapshot().issued_commands_ride_command_plane === true);
  assert.equal(agentToolbeltTrustRootSnapshot().computer_typed_actuation_allowed, true);
  assert.equal(agentToolbeltTrustRootSnapshot().computer_effects_require_existing_db_lease, true);
  assert.equal(agentToolbeltTrustRootSnapshot().authority_effect, false);
});
