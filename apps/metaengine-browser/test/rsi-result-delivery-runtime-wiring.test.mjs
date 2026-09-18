import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const nativeSource = () => readFile(new URL('../src/native-supervisor-client-base.mjs', import.meta.url), 'utf8');
const edgeSource = () => readFile(new URL('../supabase/a2-browser-native-supervisor-v1/index.ts', import.meta.url), 'utf8');

test('S5b receipt readback route is device-authenticated and same-client scoped', async () => {
  const source = await edgeSource();
  const authAt = source.indexOf('const identity=await authenticateDevice');
  const routeAt = source.indexOf("readCommandReceipt(req,decodeURIComponent(receipt[1]))");
  assert.ok(authAt >= 0 && routeAt > authAt, 'receipt route must remain behind device authentication');
  assert.match(source, /createRsiResultReceiptReadback/);
  assert.match(source, /where workspace_id=\$1::uuid and command_id=\$2::uuid and leased_by=\$3 limit 1/);
  assert.match(source, /\/v1\\\/commands\\\/\(\[\^\/\]\+\)\\\/receipt\$\/\)/);
  assert.match(source, /authority_effect:false/);
});

test('S5b native seam is opt-in and never exposes the Browser effect executor', async () => {
  const source = await nativeSource();
  assert.match(source, /rsiResultReceiptReconciliation = false/);
  assert.match(source, /createSupervisorRsiResultDeliveryAdapter\(\{/);
  assert.match(source, /signedRequest: \(path, options = \{\}\) => this\.#signedRequest\(path, options\)/);
  assert.match(source, /candidate_effect_executor_exposed: false/);
  assert.match(source, /physical_effect_replay_allowed: false/);
  assert.match(source, /automatic_effect_retry_allowed: false/);

  const adapterStart = source.indexOf('this.#resultDeliveryAdapter = rsiResultReceiptReconciliation === true');
  const adapterEnd = source.indexOf('this.#commandLane = new NativeSupervisorCommandLaneScheduler', adapterStart);
  const adapterWiring = source.slice(adapterStart, adapterEnd);
  assert.doesNotMatch(adapterWiring, /executeCommand|#executeCommand|executeSupervisorCommand/);
});

test('S5b result transport forwards AbortSignal and reconciles before any same-receipt batch replay', async () => {
  const source = await nativeSource();
  assert.match(source, /payload = null, signal = null/);
  assert.match(source, /if \(signal\) init\.signal = signal/);
  assert.match(source, /readbackBeforeReplay: true/);
  assert.match(source, /reconciled_after_batch_ambiguity: true/);
  assert.match(source, /state === 'DELIVERED' \|\| state === 'RECONCILED'/);
  assert.match(source, /native_supervisor_result_delivery_ambiguous/);

  const deliveryStart = source.indexOf('#assertRsiResultDeliveryOutcome');
  const deliveryEnd = source.indexOf('async #executeLocalOrRemote', deliveryStart);
  assert.ok(deliveryStart >= 0 && deliveryEnd > deliveryStart, 'delivery boundary missing');
  const delivery = source.slice(deliveryStart, deliveryEnd);
  assert.doesNotMatch(delivery, /#executeCommand\(/, 'result reconciliation must never call the Browser effect executor');
});

test('S5b batch ambiguity falls back to immutable per-command receipt reconciliation, not batch effect replay', async () => {
  const source = await nativeSource();
  const start = source.indexOf('async #postBatchResults');
  const end = source.indexOf('async #executeLocalOrRemote', start);
  assert.ok(start >= 0 && end > start, 'batch delivery boundary missing');
  const batch = source.slice(start, end);
  assert.match(batch, /this\.#signedRequest\('\/v1\/commands\/result-batch'/);
  assert.match(batch, /this\.#resultDeliveryAdapter\.deliver\(\{/);
  assert.match(batch, /readbackBeforeReplay: true/);
  assert.doesNotMatch(batch, /#executeForLane|#executeLocalOrRemote|#executeCommand\(/);
});


test('S5b delivery ambiguity never manufactures a second FAILED receipt after Browser execution', async () => {
  const source = await nativeSource();
  assert.match(source, /error\.code = state === 'REJECTED' \? 'NATIVE_RESULT_DELIVERY_REJECTED' : 'NATIVE_RESULT_DELIVERY_AMBIGUOUS'/);
  const runStart = source.indexOf('async #runCommand(command)');
  const runEnd = source.indexOf('async #runCommandBatch', runStart);
  assert.ok(runStart >= 0 && runEnd > runStart, 'single-command runtime boundary missing');
  const run = source.slice(runStart, runEnd);
  const transportFence = run.indexOf("startsWith('NATIVE_RESULT_DELIVERY_')");
  const failureReceipt = run.indexOf('await this.#postResult(command, false');
  assert.ok(transportFence >= 0 && failureReceipt > transportFence,
    'transport ambiguity fence must precede the ordinary execution-failure receipt path');
  assert.match(run, /this\.#lastCommandStatus = 'AMBIGUOUS'/);
});
