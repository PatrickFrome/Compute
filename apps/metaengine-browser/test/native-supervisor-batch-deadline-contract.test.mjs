import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeSupervisorRequestDeadlineMs } from '../src/native-supervisor-client-core.mjs';

test('production 15s batch wait cannot outlive its request deadline', () => {
  assert.equal(nativeSupervisorRequestDeadlineMs({ commandBatchWaitMs: 15000 }), 20000);
});

test('explicit too-small deadline is raised to the batch safety floor', () => {
  assert.equal(nativeSupervisorRequestDeadlineMs({ commandBatchWaitMs: 12000, requestDeadlineMs: 3000 }), 17000);
});

test('ordinary 4s wait preserves the default 8s deadline', () => {
  assert.equal(nativeSupervisorRequestDeadlineMs({ commandBatchWaitMs: 4000 }), 9000);
});

test('deadline remains bounded by the core 30s ceiling', () => {
  assert.equal(nativeSupervisorRequestDeadlineMs({ commandBatchWaitMs: 15000, requestDeadlineMs: 30000 }), 30000);
});
