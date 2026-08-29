import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { EffectLedgerStore } from '../../../coordination/browser-compute/src/effect-ledger-store.mjs';
import { SECURITY_POLICY } from '../src/browser-policy.mjs';
import { NativeR16ActuationGate } from '../src/native-r16-actuation-gate.mjs';

function command(id = 'action-1') {
  return {
    command_id: `command-${id}`,
    action_id: id,
    lease_id: `lease-${id}`,
    holder_id: 'native-node-1',
    resource_id: 'profile-1:target-1',
    browser_node_id: 'browser-node-1',
    process_incarnation_id: 'process-1',
    profile_id: 'profile-1',
    target_id: 'target-1',
    action: 'TYPED_CLICK',
    payload: { role: 'button', accessible_name: 'Send' },
  };
}

function leaseFor(cmd, overrides = {}) {
  return {
    lease_id: cmd.lease_id,
    holder_id: cmd.holder_id,
    resource_id: cmd.resource_id,
    action_id: cmd.action_id,
    browser_node_id: cmd.browser_node_id,
    process_incarnation_id: cmd.process_incarnation_id,
    profile_id: cmd.profile_id,
    target_id: cmd.target_id,
    scope: 'ACTUATE',
    state: 'ACTIVE',
    single_use: true,
    expires_at: '2030-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function ledger() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-r16-ledger-'));
  return new EffectLedgerStore({ profileDir: root });
}

test('native R16 gate durably seals intent and exact lease before physical executor', async () => {
  const effectLedger = await ledger();
  const cmd = command();
  let executions = 0;
  const gate = new NativeR16ActuationGate({
    ledger: effectLedger,
    holderId: 'native-node-1',
    now: () => Date.parse('2026-08-29T13:30:00.000Z'),
    executeImpl: async () => {
      executions += 1;
      const beforeEffect = await effectLedger.timeline({ actionId: cmd.action_id });
      assert.deepEqual(beforeEffect.entries.map((entry) => entry.type), ['INTENT_SEALED', 'AUTHORITY_GRANTED']);
      return { action: 'TYPED_CLICK', authority_effect: true };
    },
  });

  const result = await gate.execute({}, cmd, leaseFor(cmd));
  assert.equal(result.r16_gate, 'ONE_RESOURCE_ONE_ACTUATION_LEASE');
  assert.equal(executions, 1);
  const timeline = await effectLedger.timeline({ actionId: cmd.action_id });
  assert.deepEqual(timeline.entries.map((entry) => entry.type), ['INTENT_SEALED', 'AUTHORITY_GRANTED', 'EFFECT_OBSERVED', 'RECEIPT_EMITTED']);
  assert.equal((await effectLedger.verify()).ok, true);
  await assert.rejects(() => gate.execute({}, cmd, leaseFor(cmd)), /already_consumed_or_ambiguous/);
  assert.equal(executions, 1);
});

test('ambiguous executor failure becomes recovery-required and is never blindly retried', async () => {
  const effectLedger = await ledger();
  const cmd = command('action-ambiguous');
  let executions = 0;
  const gate = new NativeR16ActuationGate({
    ledger: effectLedger,
    holderId: 'native-node-1',
    now: () => Date.parse('2026-08-29T13:30:00.000Z'),
    executeImpl: async () => { executions += 1; throw new Error('mouse_release_outcome_unknown'); },
  });
  await assert.rejects(() => gate.execute({}, cmd, leaseFor(cmd)), /mouse_release_outcome_unknown/);
  const timeline = await effectLedger.timeline({ actionId: cmd.action_id });
  assert.equal(timeline.entries.at(-1).type, 'RECOVERY_REQUIRED');
  assert.equal(timeline.entries.at(-1).payload.no_blind_retry, true);
  await assert.rejects(() => gate.execute({}, cmd, leaseFor(cmd)), /already_consumed_or_ambiguous/);
  assert.equal(executions, 1);
});

test('stale or non-exact lease fails before durable intent and before executor', async () => {
  const effectLedger = await ledger();
  const cmd = command('action-mismatch');
  let executions = 0;
  const gate = new NativeR16ActuationGate({
    ledger: effectLedger,
    holderId: 'native-node-1',
    now: () => Date.parse('2026-08-29T13:30:00.000Z'),
    executeImpl: async () => { executions += 1; return {}; },
  });
  await assert.rejects(() => gate.execute({}, cmd, leaseFor(cmd, { target_id: 'target-other' })), /binding_mismatch/);
  assert.equal(await effectLedger.size(), 0);
  assert.equal(executions, 0);
  await assert.rejects(() => gate.execute({}, cmd, leaseFor(cmd, { expires_at: '2026-08-29T13:00:00.000Z' })), /lease_expired/);
  assert.equal(await effectLedger.size(), 0);
});

test('R16 hard-invariant sentinel remains present and native edge exposes no arbitrary eval', async () => {
  const repoFile = (relative) => fileURLToPath(new URL(`../../../${relative}`, import.meta.url));
  const architecture = await fs.readFile(repoFile('coordination/chat-control-plane/A2_COMPUTE_BROWSER_ARCHITECTURE_ADDENDUM_V1.md'), 'utf8');
  for (const invariant of [
    'ONE_RESOURCE_ONE_ACTUATION_LEASE',
    'NO_BLIND_RETRY_AFTER_AMBIGUOUS_EFFECT',
    'PRE_ACTUATION_DURABLE_BEFORE_EFFECT',
    'PAGE_DATA_HAS_ZERO_AUTHORITY',
    'REMOTE_CODE_IS_NEVER_EVALLED_IN_BROWSER_KERNEL',
    'TARGET_BINDING_IS_EXACT',
    'LIVE_REVALIDATION_BEFORE_ACTUATION',
  ]) assert.match(architecture, new RegExp(invariant));

  assert.equal(SECURITY_POLICY.page_data_authority, false);
  assert.equal(SECURITY_POLICY.raw_cdp_exposed, false);
  for (const relative of [
    'apps/metaengine-browser/src/native-browser-control.mjs',
    'apps/metaengine-browser/src/native-r16-actuation-gate.mjs',
    'apps/metaengine-browser/src/native-supervisor-client.mjs',
  ]) {
    const source = await fs.readFile(repoFile(relative), 'utf8');
    assert.doesNotMatch(source, /\beval\s*\(/);
    assert.doesNotMatch(source, /new\s+Function\s*\(/);
    assert.doesNotMatch(source, /Runtime\.evaluate/);
  }
});
