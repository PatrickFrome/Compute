import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { nativeSupervisorLeaseRetryDelayMs } from '../src/native-supervisor-client-base.mjs';

test('healthy supported wait-batch keeps zero extra scheduler delay', () => {
  assert.equal(nativeSupervisorLeaseRetryDelayMs({
    batchTransport: 'SUPPORTED',
    consecutiveFailures: 0,
    intervalMs: 2000,
  }), 0);
});

test('lease transport failures add bounded exponential cooldown', () => {
  assert.equal(nativeSupervisorLeaseRetryDelayMs({
    batchTransport: 'SUPPORTED',
    consecutiveFailures: 1,
    intervalMs: 2000,
  }), 2000);
  assert.equal(nativeSupervisorLeaseRetryDelayMs({
    batchTransport: 'SUPPORTED',
    consecutiveFailures: 2,
    intervalMs: 2000,
  }), 4000);
  assert.equal(nativeSupervisorLeaseRetryDelayMs({
    batchTransport: 'SUPPORTED',
    consecutiveFailures: 3,
    intervalMs: 2000,
  }), 8000);
  assert.equal(nativeSupervisorLeaseRetryDelayMs({
    batchTransport: 'SUPPORTED',
    consecutiveFailures: 20,
    intervalMs: 2000,
  }), 8000);
});

test('successful lease reset restores held-wait hot path', () => {
  assert.equal(nativeSupervisorLeaseRetryDelayMs({
    batchTransport: 'SUPPORTED',
    consecutiveFailures: 0,
    intervalMs: 5000,
  }), 0);
});

test('unsupported batch transport retains ordinary supervisor interval', () => {
  assert.equal(nativeSupervisorLeaseRetryDelayMs({
    batchTransport: 'UNAVAILABLE',
    consecutiveFailures: 0,
    intervalMs: 2000,
  }), 2000);
});

test('backoff repair reuses the canonical scheduler and lease failure counter', async () => {
  const source = await readFile(new URL('../src/native-supervisor-client-base.mjs', import.meta.url), 'utf8');
  assert.match(source, /nativeSupervisorLeaseRetryDelayMs\(\{\s*batchTransport:\s*this\.#batchTransport,\s*consecutiveFailures:\s*this\.#leaseConsecutiveFailures,\s*intervalMs:\s*this\.#intervalMs,/s);
  assert.match(source, /#markLeaseOk\(\)\s*\{[\s\S]*?#leaseConsecutiveFailures\s*=\s*0/);
  assert.match(source, /#markLeaseFailure\(error\)\s*\{[\s\S]*?#leaseConsecutiveFailures\s*\+=\s*1/);
  assert.doesNotMatch(source, /leaseRetryTimer|leaseBackoffTimer|secondLeaseScheduler/);
});
