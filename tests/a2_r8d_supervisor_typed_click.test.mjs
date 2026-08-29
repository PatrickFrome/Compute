import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'coordination', 'chat-control-plane', 'extension', 'supervisor-authority.js'), 'utf8');

function storageArea(seed = {}) {
  const state = { ...seed };
  return {
    state,
    async get(keys) {
      if (keys == null) return { ...state };
      if (typeof keys === 'string') return { [keys]: state[keys] };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, state[key]]));
      return Object.fromEntries(Object.keys(keys).map((key) => [key, state[key] ?? keys[key]]));
    },
    async set(values) { Object.assign(state, values); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key]; },
  };
}

async function boot({ mode = 'CONTROL', armed = true } = {}) {
  const local = storageArea({ armed, a2SupervisorEventsV1: [] });
  const session = storageArea({ a2SupervisorModeV1: mode });
  const posted = [];
  const typedCalls = [];
  let commandLeased = false;
  const command = {
    command_id: '11111111-1111-4111-8111-111111111111',
    idempotency_key: 'r8d-test',
    action: 'TYPED_CLICK',
    platform: 'CHATGPT',
    payload: { action_id: 'r8d.click.remote', role: 'button', accessible_name: 'R8D Canary' },
  };

  const context = {
    console,
    URL,
    Headers,
    setTimeout,
    clearTimeout,
    globalThis: null,
    fetch: async (url, init = {}) => {
      const pathname = new URL(String(url)).pathname;
      const body = init.body ? JSON.parse(init.body) : {};
      if (pathname.endsWith('/v1/state')) return { ok: true, status: 202, json: async () => ({ accepted: true }) };
      if (pathname.endsWith('/v1/commands/next')) {
        if (commandLeased) return { ok: true, status: 200, json: async () => ({ command: null }) };
        commandLeased = true;
        return { ok: true, status: 200, json: async () => ({ command }) };
      }
      if (/\/v1\/commands\/[^/]+\/result$/.test(pathname)) {
        posted.push(body);
        return { ok: true, status: 200, json: async () => ({ accepted: true }) };
      }
      throw new Error(`unexpected_fetch:${pathname}`);
    },
    chrome: {
      storage: {
        local,
        session,
        onChanged: { addListener() {} },
      },
      runtime: {
        id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        getManifest: () => ({ version: '0.7.1' }),
        getURL: (p) => `chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/${p}`,
        onMessage: { addListener() {} },
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
      },
      alarms: { create() {}, onAlarm: { addListener() {} } },
      tabs: { query: async () => [], sendMessage: async () => ({ ok: true }) },
    },
    A2_GET_PAIRING_SECRET: async () => 'x'.repeat(64),
    A2_BRIDGE_CLIENT_ID: async () => 'r8d-test-client',
    A2_OPERATOR_CAPTURE_PERCEPTION: async () => ({
      captured_at: new Date().toISOString(),
      frame_token: 'frame-r8d',
      hashes: {},
      accessibility: [{ ignored: false, role: 'button', name: 'R8D Canary', backend_dom_node_id: 17 }],
    }),
    A2_OPERATOR_TYPED_CLICK_V1: async (message) => {
      typedCalls.push(message);
      return {
        action_id: message.action_id,
        outcome: 'COMMITTED',
        reason_code: 'typed_click_press_release_acknowledged',
        physical_dispatch_started: true,
        automatic_retry_allowed: false,
        authority_effect: false,
        actuation_eligible: false,
      };
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'supervisor-authority.js' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { context, local, session, posted, typedCalls };
}

test('TYPED_CLICK executes once only under CONTROL + armed and captures fresh perception', async () => {
  const h = await boot({ mode: 'CONTROL', armed: true });
  const receipt = await h.context.A2_SUPERVISOR_POLL();
  assert.equal(receipt.status, 'COMPLETED');
  assert.equal(h.typedCalls.length, 1);
  assert.equal(h.typedCalls[0].action_id, 'r8d.click.remote');
  assert.equal(h.typedCalls[0].role, 'button');
  assert.equal(h.typedCalls[0].accessible_name, 'R8D Canary');
  assert.ok(h.typedCalls[0].perception_captured_at);
  assert.equal(h.posted.length, 1);
  assert.equal(h.posted[0].ok, true);
  assert.equal(h.posted[0].receipt.authority_effect, true);
  assert.equal(h.posted[0].receipt.result.authority_effect, false);
});

test('TYPED_CLICK fails closed when local armed state is false', async () => {
  const h = await boot({ mode: 'CONTROL', armed: false });
  const receipt = await h.context.A2_SUPERVISOR_POLL();
  assert.equal(receipt.status, 'FAILED');
  assert.equal(h.typedCalls.length, 0);
  assert.match(receipt.error, /supervisor_typed_click_armed_required/);
  assert.equal(h.posted.length, 1);
  assert.equal(h.posted[0].ok, false);
});

test('TYPED_CLICK fails before actuation outside CONTROL', async () => {
  const h = await boot({ mode: 'MONITOR', armed: true });
  const receipt = await h.context.A2_SUPERVISOR_POLL();
  assert.equal(receipt.status, 'FAILED');
  assert.equal(h.typedCalls.length, 0);
  assert.match(receipt.error, /supervisor_control_required:MONITOR/);
});
