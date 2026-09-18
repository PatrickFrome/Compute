import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ActionKernel, createActionKernel } from '../src/action-kernel.mjs';
import { validateReceipt } from '../../browser-shared/receipt-contract.mjs';

class FakeCdpClient {
  constructor() {
    this.calls = [];
    this._nextId = 1;
    this._pending = new Map();
    this._responses = new Map();
  }
  call(method, params = {}, options = {}) {
    const id = this._nextId++;
    this.calls.push({ id, method, params, options });
    const promise = new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject, method });
      this._drain();
    });
    return promise;
  }
  setResponse(method, result) {
    this._responses.set(method, result);
  }
  _drain() {
    for (const [id, entry] of this._pending) {
      const response = this._responses.get(entry.method);
      if (response) {
        this._pending.delete(id);
        if (response.error) entry.reject(new Error(response.error));
        else entry.resolve(response.result || {});
      }
    }
  }
  on() { return () => {}; }
  close() {}
}

function makeLease(resourceId = 'target_1', overrides = {}) {
  const notAfter = new Date(Date.now() + 60000).toISOString();
  return {
    lease_id: crypto.randomUUID(),
    resource_id: resourceId,
    actor_id: 'supervisor_1',
    not_after: notAfter,
    hmac: 'fakehmac',
    ...overrides
  };
}

function makeAction(overrides = {}) {
  return {
    action_id: crypto.randomUUID(),
    target_id: 'target_1',
    profile_id: 'p1',
    context_id: 'c1',
    kind: 'NAVIGATE',
    lease: makeLease('target_1'),
    locator: null,
    payload: { url: 'https://example.com/' },
    requested_at: new Date().toISOString(),
    idempotency_key: crypto.randomUUID(),
    ...overrides
  };
}

function makeRuntime(cdp, targetId = 'target_1') {
  const processIncarnationId = 'inc_001';
  return {
    running: new Map([
      ['p1', {
        processRef: { isRunning: () => true, processIncarnationId, cdp },
        bindings: new Map([[targetId, { cdp_target_id: 'cdp_1', process_incarnation_id: processIncarnationId, bound_at: new Date().toISOString() }]]),
        contextBindings: new Map()
      }]
    ])
  };
}

test('semantic_action_not_enabled when feature flag off', async () => {
  const kernel = createActionKernel({ sessionKey: '' });
  try {
    await kernel.executeAction({ action: makeAction({ kind: 'NAVIGATE' }), lease: makeLease('target_1') });
    assert.fail('should have thrown');
  } catch (error) {
    assert.equal(error.message, 'semantic_action_not_enabled');
  }
});

test('rejects expired lease before any CDP call', async () => {
  const cdp = new FakeCdpClient();
  const kernel = createActionKernel({ cdpClient: cdp, sessionKey: '' });
  kernel._semanticActionEnabled = true;
  const action = makeAction({ lease: makeLease('target_1', { not_after: new Date(Date.now() - 1000).toISOString() }) });
  try {
    await kernel.executeAction({ action, lease: action.lease });
    assert.fail('should have thrown');
  } catch (error) {
    assert.equal(error.message, 'lease_expired');
  }
});

test('rejects mismatched resource_id on lease', async () => {
  const cdp = new FakeCdpClient();
  const kernel = createActionKernel({ cdpClient: cdp, sessionKey: '' });
  kernel._semanticActionEnabled = true;
  const action = makeAction({ target_id: 'target_1' });
  const badLease = makeLease('target_other');
  try {
    await kernel.executeAction({ action: { ...action, lease: badLease }, lease: badLease });
    assert.fail('should have thrown');
  } catch (error) {
    assert.equal(error.message, 'lease_resource_mismatch');
  }
});

test('durable-before-effect: pending intent written before CDP call', async () => {
  const cdp = new FakeCdpClient();
  const profileDir = path.join(os.tmpdir(), `a2-b4-action-test-${Date.now()}`);
  await fs.mkdir(profileDir, { recursive: true });
  const runtime = makeRuntime(cdp);
  const kernel = new ActionKernel({ runtime, cdpClient: cdp, profileDir, sessionKey: '' });
  kernel._semanticActionEnabled = true;
  const action = makeAction({ kind: 'NAVIGATE' });
  cdp.setResponse('Page.navigate', { targetId: 'cdp_1' });
  cdp.setResponse('Page.getFrameTree', { frameTree: { frame: { id: 'f1', loaderId: 'l1' } } });
  const pendingPromise = kernel.executeAction({ action, lease: makeLease('target_1') });
  await new Promise((r) => setTimeout(r, 50));
  const actionsBeforeCdp = await kernel._loadActions();
  const pendingWrittenBeforeCdp = actionsBeforeCdp.actions.some((a) => a.action_id === action.action_id);
  try { await pendingPromise; } catch (_) {}
  assert.ok(pendingWrittenBeforeCdp, 'pending intent should exist in registry before CDP navigates');
  assert.ok(cdp.calls.some((c) => c.method === 'Page.navigate'), 'Page.navigate should be called');
});

test('fail-closed on stale target binding', async () => {
  const cdp = new FakeCdpClient();
  const runtime = makeRuntime(cdp);
  runtime.running.get('p1').bindings.delete('target_1');
  const kernel = new ActionKernel({ runtime, cdpClient: cdp, sessionKey: '' });
  kernel._semanticActionEnabled = true;
  const action = makeAction({ kind: 'CLICK', locator: { semantic_id: 'node_1', frame_path: ['f1'] } });
  try {
    await kernel.executeAction({ action, lease: makeLease('target_1') });
    assert.fail('should have thrown target_not_bound');
  } catch (error) {
    console.log('Stale binding error:', error.message); assert.equal(error.message, 'target_not_bound');
  }
});

test('no blind retry after ambiguous effect', async () => {
  const profileDir = path.join(os.tmpdir(), `a2-b4-ambiguous-${Date.now()}`);
  await fs.mkdir(profileDir, { recursive: true });
  const kernel = new ActionKernel({ profileDir, sessionKey: '' });
  kernel._semanticActionEnabled = true;
  await kernel._saveActions({ schema: 'metaengine.a2-compute-browser.actions.v1', actions: [{ action_id: 'a1', target_id: 'target_1', status: 'AMBIGUOUS', kind: 'CLICK' }], updated_at: new Date().toISOString() });
  const action = makeAction({ target_id: 'target_1', kind: 'CLICK', locator: { semantic_id: 'n1', frame_path: [] } });
  try {
    await kernel.executeAction({ action, lease: makeLease('target_1') });
    assert.fail('should have thrown');
  } catch (error) {
    assert.equal(error.message, 'ambiguous_effect_recovery_required');
  }
});

test('receipt is validated by receipt-contract after execution', async () => {
  const profileDir = path.join(os.tmpdir(), `a2-b4-receipt-${Date.now()}`);
  await fs.mkdir(profileDir, { recursive: true });
  const cdp = new FakeCdpClient();
  const runtime = makeRuntime(cdp);
  const kernel = new ActionKernel({ runtime, cdpClient: cdp, profileDir, sessionKey: '' });
  kernel._semanticActionEnabled = true;
  const action = makeAction({ kind: 'NAVIGATE' });
  cdp.setResponse('Page.navigate', { targetId: 'cdp_1' });
  cdp.setResponse('Page.getFrameTree', { frameTree: { frame: { id: 'f1', loaderId: 'l1' } } });
  console.log('Before executeAction'); const receipt = await kernel.executeAction({ action, lease: makeLease('target_1') }); console.log('After executeAction, receipt status:', receipt?.status);
  console.log('Receipt keys:', Object.keys(receipt), 'kind:', receipt.kind, 'sha256:', receipt.receipt_sha256?.slice(0,16)); console.log('validated call'); const validated = validateReceipt(receipt); console.log('Validated:', validated);
  assert.equal(validated.ok, true);
  assert.equal(receipt.status, 'EFFECTED');
  assert.equal(receipt.kind, 'NAVIGATE');
  assert.equal(receipt.authority_effect, true);
});

test('lease conflict blocks second concurrent actuation on same target', async () => {
  const cdp = new FakeCdpClient();
  const runtime = makeRuntime(cdp);
  const kernel = new ActionKernel({ runtime, cdpClient: cdp, sessionKey: '' });
  kernel._semanticActionEnabled = true;
  const action1 = makeAction({ action_id: 'a1', kind: 'NAVIGATE' });
  const action2 = makeAction({ action_id: 'a2', kind: 'NAVIGATE' });
  const lease1 = makeLease('target_1');
  const lease2 = makeLease('target_1');
  cdp.setResponse('Page.navigate', { targetId: 'cdp_1' });
  cdp.setResponse('Page.getFrameTree', { frameTree: { frame: { id: 'f1', loaderId: 'l1' } } });
  await kernel.executeAction({ action: action1, lease: lease1 });
  try {
    await kernel.executeAction({ action: action2, lease: lease2 });
    assert.fail('should have thrown');
  } catch (error) {
    console.log('Lease conflict error:', error.message); assert.equal(error.message, 'actuation_lease_conflict');
  }
});