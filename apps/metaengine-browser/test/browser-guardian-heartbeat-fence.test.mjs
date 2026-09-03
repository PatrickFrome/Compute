import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateGuardianHeartbeatFence } from '../src/browser-guardian-heartbeat-fence.mjs';

const NOW = 1_000_000;
const SHA = 'a'.repeat(64);
const child = { pid: 1234, process_incarnation_id: 'inc-8-a' };
const release = { release_id: 'release-8', artifact_sha256: SHA };

function signal(sequence, overrides = {}) {
  return {
    pid: 1234,
    process_incarnation_id: 'inc-8-a',
    release_id: 'release-8',
    artifact_sha256: SHA,
    sequence,
    observed_at_ms: NOW - 100,
    ...overrides,
  };
}

function heartbeats(overrides = {}) {
  return {
    startup: signal(1),
    liveness: signal(9),
    readiness: signal(4),
    progress: signal(7),
    ...overrides,
  };
}

test('accepts four independently sequenced exact-incarnation channels', () => {
  const result = evaluateGuardianHeartbeatFence({
    child,
    release,
    heartbeats: heartbeats(),
    sequence_fence: { startup: 1, liveness: 8, readiness: 4, progress: 6 },
    now_ms: NOW,
  });
  assert.equal(result.valid, true);
  assert.equal(result.reason, 'EXACT_SPLIT_HEARTBEATS_FENCED');
  assert.equal(result.channels.progress.sequence, 7);
  assert.equal(result.authority_effect, false);
});

test('a fresh liveness pulse cannot substitute for missing progress', () => {
  const value = heartbeats();
  delete value.progress;
  const result = evaluateGuardianHeartbeatFence({ child, release, heartbeats: value, now_ms: NOW });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'HEARTBEAT_CHANNEL_MISSING');
  assert.equal(result.channel, 'progress');
});

test('a signal from another process incarnation is rejected fail closed', () => {
  const result = evaluateGuardianHeartbeatFence({
    child,
    release,
    heartbeats: heartbeats({ readiness: signal(5, { process_incarnation_id: 'inc-other' }) }),
    now_ms: NOW,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'HEARTBEAT_BINDING_MISMATCH');
  assert.equal(result.channel, 'readiness');
});

test('sequence regression is rejected independently per channel', () => {
  const result = evaluateGuardianHeartbeatFence({
    child,
    release,
    heartbeats: heartbeats({ progress: signal(6) }),
    sequence_fence: { progress: 7 },
    now_ms: NOW,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'HEARTBEAT_SEQUENCE_REGRESSION');
  assert.equal(result.channel, 'progress');
  assert.equal(result.sequence, 6);
  assert.equal(result.sequence_floor, 7);
});

test('future timestamps cannot manufacture freshness', () => {
  const result = evaluateGuardianHeartbeatFence({
    child,
    release,
    heartbeats: heartbeats({ liveness: signal(10, { observed_at_ms: NOW + 1 }) }),
    now_ms: NOW,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'HEARTBEAT_TIMESTAMP_INVALID');
  assert.equal(result.channel, 'liveness');
});
