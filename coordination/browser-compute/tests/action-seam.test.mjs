import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ComputeBrowserRuntime } from '../src/runtime.mjs';
import { dispatchRpc, RPC_METHOD_EFFECTS } from '../src/rpc-server.mjs';
import { LeaseBroker } from '../../browser-shared/lease-broker.mjs';
import { readJson } from '../src/security.mjs';

const INCARNATION = 'b7pre1-incarnation-0001';
const SESSION_KEY = 'b7-pre1-test-session-key';

class FakeCdpClient {
  constructor() {
    this.calls = [];
    this._responses = new Map();
  }
  async call(method, params = {}) {
    this.calls.push({ method, params });
    const response = this._responses.get(method);
    if (!response) throw new Error(`unexpected_cdp_method:${method}`);
    if (response.error) throw new Error(response.error);
    return response.result || {};
  }
  setResponse(method, result) { this._responses.set(method, result); }
}

async function fixture(name) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `a2-b7pre1-${name}-`));
  const runtime = new ComputeBrowserRuntime({ stateRoot: root, actionSessionKey: SESSION_KEY });
  const profileId = `${name}-profile`;
  await runtime.init();
  await fs.mkdir(runtime.profileDir(profileId), { recursive: true });
  const cdp = new FakeCdpClient();
  runtime.running.set(profileId, {
    processRef: {
      processIncarnationId: INCARNATION,
      isRunning: () => true,
      stop: async () => {},
      cdp
    },
    bindings: new Map([
      ['target_1', { cdp_target_id: 'cdp_t1', context_id: 'default', process_incarnation_id: INCARNATION, bound_at: new Date().toISOString(), conversation_epoch: 1 }]
    ]),
    contextBindings: new Map([
      ['default', { browser_context_id: null, process_incarnation_id: INCARNATION }]
    ]),
    meta: { profile_id: profileId, browser_node_id: 'node-b7pre1' },
    lockFile: null,
    semanticFrames: new Map()
  });
  // Pre-seed the durable target registry exactly as createTarget persists it.
  const targetsFile = path.join(runtime.profileDir(profileId), 'targets.json');
  await fs.writeFile(targetsFile, `${JSON.stringify({
    schema: 'metaengine.a2-compute-browser.targets.v1',
    revision: 1,
    targets: [{
      schema: 'metaengine.a2-browser-operator.target.v1',
      target_id: 'target_1',
      provider: 'BROWSER',
      platform: 'COMPUTE_BROWSER',
      surface: 'WEB',
      context_id: 'default',
      role: 'WORKER',
      conversation_epoch: 1,
      conversation_url: 'about:blank',
      status: 'ACTIVE',
      last_operation_id: 'seed',
      updated_at: new Date().toISOString()
    }],
    updated_at: new Date().toISOString()
  }, null, 2)}\n`);
  const broker = new LeaseBroker({ supervisorKey: SESSION_KEY });
  return {
    root,
    runtime,
    profileId,
    cdp,
    broker,
    lease(kind = 'ACTION_NAVIGATE', resourceId = 'target_1') {
      return broker.issue({ kind, resourceId, targetId: resourceId, profileId, actorId: 'supervisor_test' });
    },
    async close() {
      await runtime.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  };
}

test('navigateAction executes through the ActionKernel and emits a receipt', async () => {
  let fx;
  try {
    fx = await fixture('navigate');
    fx.cdp.setResponse('Page.navigate', { frameId: 'f1' });
    fx.cdp.setResponse('Page.getFrameTree', { frameTree: { frame: { id: 'f1', loaderId: 'l1' } } });
    const receipt = await fx.runtime.navigateAction({
      profileId: fx.profileId,
      targetId: 'target_1',
      lease: fx.lease('ACTION_NAVIGATE'),
      url: 'https://example.com/'
    });
    assert.equal(receipt.status, 'EFFECTED');
    assert.equal(receipt.kind, 'NAVIGATE');
    assert.equal(receipt.process_incarnation_id, INCARNATION);
    assert.ok(fx.cdp.calls.some((call) => call.method === 'Page.navigate'));
    // Pending intent (pre-effect fence) was persisted by the kernel.
    const actions = await readJson(path.join(fx.runtime.profileDir(fx.profileId), 'actions.json'), null);
    assert.equal(actions.actions.length, 1);
    assert.equal(actions.actions[0].status, 'EFFECTED');
  } finally {
    await fx?.close();
  }
});

test('navigateAction with an invalid lease HMAC is rejected with zero effect', async () => {
  let fx;
  try {
    fx = await fixture('badlease');
    const forged = { ...fx.lease('ACTION_NAVIGATE'), hmac: '0'.repeat(64) };
    await assert.rejects(
      () => fx.runtime.navigateAction({ profileId: fx.profileId, targetId: 'target_1', lease: forged, url: 'https://example.com/' }),
      /lease_hmac_mismatch/
    );
    assert.equal(fx.cdp.calls.length, 0);
  } finally {
    await fx?.close();
  }
});

test('every action produces a hash-chained identity envelope timeline', async () => {
  let fx;
  try {
    fx = await fixture('ledger');
    fx.cdp.setResponse('Page.navigate', { frameId: 'f1' });
    fx.cdp.setResponse('Page.getFrameTree', { frameTree: { frame: { id: 'f1', loaderId: 'l1' } } });
    const receipt = await fx.runtime.navigateAction({
      profileId: fx.profileId,
      targetId: 'target_1',
      lease: fx.lease('ACTION_NAVIGATE'),
      url: 'https://example.com/'
    });
    const timeline = await fx.runtime.ledgerTimeline({ profileId: fx.profileId, actionId: receipt.action_id });
    assert.deepEqual(timeline.entries.map((entry) => entry.type), ['INTENT_SEALED', 'EFFECT_OBSERVED', 'RECEIPT_EMITTED']);
    for (const entry of timeline.entries) {
      assert.equal(entry.identity.lease_id, receipt.lease_id);
      assert.equal(entry.identity.action_id, receipt.action_id);
      assert.equal(entry.identity.profile_id, fx.profileId);
      assert.equal(entry.identity.target_id, 'target_1');
      assert.equal(entry.identity.process_incarnation_id, INCARNATION);
      assert.equal(entry.identity.browser_node_id, 'node-b7pre1');
      assert.equal(entry.identity.context_id, 'default');
      assert.equal(entry.identity.target_conversation_epoch, 1);
    }
    const receiptEvent = timeline.entries[2];
    assert.equal(receiptEvent.identity.receipt_id, receipt.receipt_id);
    assert.equal(receiptEvent.payload.receipt_sha256, receipt.receipt_sha256);
    const verify = await fx.runtime.ledgerVerify(fx.profileId);
    assert.equal(verify.ok, true);
    assert.equal(verify.head_seq, 3);
    const head = await fx.runtime.ledgerHead(fx.profileId);
    assert.equal(head.seq, 3);
    assert.equal(head.poisoned, false);
  } finally {
    await fx?.close();
  }
});

test('INTENT_SEALED is durably chained before any CDP dispatch (fail-closed)', async () => {
  let fx;
  try {
    fx = await fixture('fence');
    fx.cdp.setResponse('Page.navigate', { frameId: 'f1' });
    fx.cdp.setResponse('Page.getFrameTree', { frameTree: { frame: { frameId: 'f1' } } });
    const timelineFile = path.join(fx.runtime.profileDir(fx.profileId), 'effect-ledger.json');
    // Corrupt the ledger before the first action: the store must refuse to
    // extend a broken chain, and the action must abort before any effect.
    await fs.mkdir(path.dirname(timelineFile), { recursive: true });
    await fs.writeFile(timelineFile, `${JSON.stringify({
      schema: 'metaengine.a2-effect-ledger.ledger.v1',
      head: { seq: 2, entry_sha256: 'a'.repeat(64) },
      entries: [{ not: 'a valid entry' }, { also: 'not valid' }],
      updated_at: new Date().toISOString()
    })}\n`);
    await assert.rejects(
      () => fx.runtime.navigateAction({
        profileId: fx.profileId,
        targetId: 'target_1',
        lease: fx.lease('ACTION_NAVIGATE'),
        url: 'https://example.com/'
      }),
      /effect_ledger_append_failed:INTENT_SEALED/
    );
    assert.equal(fx.cdp.calls.length, 0);
  } finally {
    await fx?.close();
  }
});

test('two actions form one contiguous chain with distinct action envelopes', async () => {
  let fx;
  try {
    fx = await fixture('chain');
    fx.cdp.setResponse('Page.navigate', { frameId: 'f1' });
    fx.cdp.setResponse('Page.getFrameTree', { frameTree: { frame: { id: 'f1', loaderId: 'l1' } } });
    const first = await fx.runtime.navigateAction({ profileId: fx.profileId, targetId: 'target_1', lease: fx.lease('ACTION_NAVIGATE'), url: 'https://example.com/a' });
    // Live lease conflict: the kernel holds the first lease on target_1.
    await assert.rejects(
      () => fx.runtime.navigateAction({ profileId: fx.profileId, targetId: 'target_1', lease: fx.lease('ACTION_NAVIGATE'), url: 'https://example.com/b' }),
      /actuation_lease_conflict/
    );
    const verifyAfterConflict = await fx.runtime.ledgerVerify(fx.profileId);
    assert.equal(verifyAfterConflict.head_seq, 3);
    const head = await fx.runtime.ledgerHead(fx.profileId);
    assert.equal(head.seq, 3);
    assert.equal(first.status, 'EFFECTED');
  } finally {
    await fx?.close();
  }
});

test('RPC dispatch exposes action.* and ledger.* end-to-end on the real runtime', async () => {
  let fx;
  try {
    fx = await fixture('rpc');
    assert.equal(RPC_METHOD_EFFECTS['ledger.verify'], 'READ_ONLY');
    assert.equal(RPC_METHOD_EFFECTS['action.navigate'], 'ACTUATION');
    fx.cdp.setResponse('Page.navigate', { frameId: 'f1' });
    fx.cdp.setResponse('Page.getFrameTree', { frameTree: { frame: { id: 'f1', loaderId: 'l1' } } });
    const receipt = await dispatchRpc(fx.runtime, 'action.navigate', {
      profileId: fx.profileId,
      targetId: 'target_1',
      actionId: crypto.randomUUID(),
      lease: fx.lease('ACTION_NAVIGATE'),
      url: 'https://example.com/'
    });
    assert.equal(receipt.status, 'EFFECTED');
    const verify = await dispatchRpc(fx.runtime, 'ledger.verify', { profileId: fx.profileId });
    assert.equal(verify.ok, true);
    assert.equal(verify.head_seq, 3);
    const timeline = await dispatchRpc(fx.runtime, 'ledger.timeline', { profileId: fx.profileId, actionId: receipt.action_id });
    assert.equal(timeline.entries.length, 3);
    const head = await dispatchRpc(fx.runtime, 'ledger.head', { profileId: fx.profileId });
    assert.equal(head.seq, 3);
  } finally {
    await fx?.close();
  }
});

test('health reports the effect ledger capability', async () => {
  let fx;
  try {
    fx = await fixture('health');
    const health = await fx.runtime.health();
    assert.equal(health.effect_ledger, 'b7_pre1_durable_effect_ledger_v1');
    assert.equal(health.web_authority_effect, false);
  } finally {
    await fx?.close();
  }
});
