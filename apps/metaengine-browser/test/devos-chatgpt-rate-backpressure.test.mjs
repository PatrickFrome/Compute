import assert from 'node:assert/strict';
import test from 'node:test';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle.mjs';
import {
  detectChatGptRateLimitBackpressure,
  evaluateFleetSubmitReadiness,
} from '../src/fleet-submit-readiness.mjs';

const tabId = 'tab_11111111-2222-4333-8444-555555555555';
const agentId = 'agent_11111111-2222-4333-8444-555555555555';
const targetId = 'webcontents:10';
const proof = {
  schema: 'metaengine.browser.fleet-transport-proof.v1',
  tab_id: tabId,
  target_id: targetId,
  generation_epoch: 1,
  transport_stage: 'CONVERSATION',
  conversation_url_sha256: 'a'.repeat(64),
  proven_at: '2026-09-02T18:00:00.000Z',
  authority_effect: false,
};
const fleet = {
  schema: 'metaengine.browser.fleet-snapshot.v1',
  readiness_contract: 'TRANSPORT_PROOF_REQUIRED',
  policy: { warm_agents: 1, spawn_burst_limit: 2 },
  agents: [{
    agent_id: agentId,
    role: 'IMPLEMENTER',
    lifecycle_state: 'ACTIVE',
    ownership: 'FLEET_OWNED',
    tab_id: tabId,
    target_id: targetId,
    generation_epoch: 1,
    transport_proof: proof,
    automatic_retry_allowed: false,
    authority_effect: false,
  }],
};

function rateFrame(text = 'Слишком много запросов. Подождите несколько минут и повторите попытку.') {
  return {
    tab_id: tabId,
    target_id: targetId,
    url: 'https://chatgpt.com/c/11111111-2222-4333-8444-555555555555',
    text_excerpt: text,
    viewport: { width: 1200, height: 700 },
    semantic_targets: [{ role: 'alert', name: text }],
    authority_effect: false,
  };
}

function readyFrame() {
  return {
    tab_id: tabId,
    target_id: targetId,
    url: 'https://chatgpt.com/c/11111111-2222-4333-8444-555555555555',
    text_excerpt: '',
    viewport: { width: 1200, height: 700 },
    semantic_targets: [
      { role: 'textbox', name: 'Message ChatGPT' },
      { role: 'button', name: 'Send prompt' },
    ],
    authority_effect: false,
  };
}

test('Russian and English rate-limit surfaces are denial-only pre-effect backpressure', () => {
  for (const text of [
    'Слишком много запросов. Подождите несколько минут.',
    'Too many requests. Please wait a few minutes and try again later.',
  ]) {
    const signal = detectChatGptRateLimitBackpressure(rateFrame(text));
    assert.equal(signal?.state, 'CHATGPT_RATE_LIMIT_BACKPRESSURE');
    assert.equal(signal?.physical_effect_attempted, false);
    assert.equal(signal?.effect_barrier_crossed, false);
    assert.equal(signal?.page_data_authority, false);
    const readiness = evaluateFleetSubmitReadiness({
      frame: rateFrame(text),
      expected_tab_id: tabId,
      observed_tab_id: tabId,
      expected_target_id: targetId,
      observed_target_id: targetId,
      selected_tab_id: tabId,
    });
    assert.equal(readiness.ready, false);
    assert.equal(readiness.reason, 'CHATGPT_RATE_LIMIT_BACKPRESSURE');
  }
});

test('rate-limit cooldown suppresses scheduler/lease effects and resumes only after fresh clear observation', async () => {
  let now = Date.parse('2026-09-02T18:10:00.000Z');
  let perception = rateFrame();
  const commands = [];
  const requests = [];
  const getState = async () => ({
    fleet,
    active_tab: { tab_id: tabId },
    tabs: [{ tab_id: tabId, url: readyFrame().url, selected: true }],
    perception,
  });
  const executeCommand = async (command) => {
    commands.push(command.action);
    if (command.action === 'CAPTURE') return readyFrame();
    if (command.action === 'FLEET_RECONCILE') return fleet;
    throw new Error(`unexpected_effect:${command.action}`);
  };
  const signedRequest = async (path) => {
    requests.push(path);
    if (path === '/v1/devos/cycle') {
      return {
        status: 200,
        ok: true,
        async json() {
          return { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 0, running: 0 }, lease: null, running: [] };
        },
      };
    }
    throw new Error(`unexpected_request:${path}`);
  };

  const cycle = new DevOsNativeTaskCycle({
    getState,
    executeCommand,
    signedRequest,
    clock: () => now,
    platformBackpressureMs: 60_000,
  });

  const first = await cycle.cycle();
  assert.equal(first.platform_backpressure?.active, true);
  assert.equal(first.platform_backpressure?.scheduler_superstep_suppressed, true);
  assert.equal(first.platform_backpressure?.physical_effect_attempted, false);
  assert.deepEqual(requests, [], 'rate limit must suppress DB scheduler/lease acquisition');
  assert.deepEqual(commands, [], 'selected perception should suppress even read-only fleet probing');

  now += 30_000;
  await cycle.cycle();
  assert.deepEqual(requests, []);
  assert.deepEqual(commands, []);

  now += 31_000;
  perception = readyFrame();
  const resumed = await cycle.cycle();
  assert.equal(resumed.platform_backpressure?.active, false);
  assert.equal(resumed.platform_backpressure?.state, 'CLEARED_BY_FRESH_OBSERVATION');
  assert.equal(requests.filter((path) => path === '/v1/devos/cycle').length, 1);
  assert.ok(commands.includes('CAPTURE'), 'fresh fleet observation must precede resume');
  assert.ok(commands.includes('FLEET_RECONCILE'));
  assert.equal(commands.includes('SEMANTIC_TYPE'), false);
  assert.equal(commands.includes('TYPED_CLICK'), false);
});
