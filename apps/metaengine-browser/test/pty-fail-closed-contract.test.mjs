import assert from 'node:assert/strict';
import test from 'node:test';

/*
 * Test-only PTY safety oracle.
 *
 * This file is intentionally NOT a PTY implementation and does not spawn a
 * process. It makes the negative acceptance vectors executable before the
 * Monaco/PTTY implementation gate opens. Future PTY code must replace the
 * oracle with a SUT adapter while preserving the same vectors and outcomes.
 */

const LIMITS = Object.freeze({
  inputFrameBytes: 64 * 1024,
  outputHighWaterBytes: 1024 * 1024,
  outputLowWaterBytes: 256 * 1024,
  outputRingBytes: 4 * 1024 * 1024,
  colsMin: 2,
  colsMax: 1000,
  rowsMin: 1,
  rowsMax: 500,
});

function ref(overrides = {}) {
  return {
    workspaceId: 'ws-A',
    workspaceGeneration: 7,
    ptyHostGeneration: 11,
    sessionId: 'session-A',
    sessionGeneration: 3,
    processIncarnationId: 'proc-A',
    ...overrides,
  };
}

function sameRef(a, b) {
  return a.workspaceId === b.workspaceId
    && a.workspaceGeneration === b.workspaceGeneration
    && a.ptyHostGeneration === b.ptyHostGeneration
    && a.sessionId === b.sessionId
    && a.sessionGeneration === b.sessionGeneration
    && a.processIncarnationId === b.processIncarnationId;
}

class PtySafetyOracle {
  constructor() {
    this.currentRef = ref();
    this.transportEpoch = 5;
    this.nextInputSeq = 9;
    this.nextResizeSeq = 20;
    this.writeCalls = 0;
    this.resizeCalls = 0;
    this.terminateCalls = 0;
    this.pauseCalls = 0;
    this.resumeCalls = 0;
    this.unackedBytes = 0;
    this.ringBytes = 0;
    this.backpressured = false;
    this.hostLost = false;
    this.workspaceCanonicalRoot = '/trusted/ws-A';
    this.lastAppliedSize = { cols: 120, rows: 40 };
  }

  fence(candidate, transportEpoch) {
    if (this.hostLost) return 'STALE_HOST_NO_EFFECT';
    if (!sameRef(candidate, this.currentRef)) return 'STALE_FENCE_NO_EFFECT';
    if (transportEpoch !== this.transportEpoch) return 'STALE_TRANSPORT_NO_EFFECT';
    return null;
  }

  input({ ref: candidate, transportEpoch, inputSeq, dataBytes }) {
    const fence = this.fence(candidate, transportEpoch);
    if (fence) return fence;
    if (!Number.isInteger(dataBytes) || dataBytes < 0 || dataBytes > LIMITS.inputFrameBytes) {
      return 'INVALID_INPUT_NO_EFFECT';
    }
    if (inputSeq < this.nextInputSeq) return 'DUPLICATE_NO_EFFECT';
    if (inputSeq > this.nextInputSeq) return 'INPUT_GAP_RESYNC_REQUIRED_NO_EFFECT';
    this.writeCalls += 1;
    this.nextInputSeq += 1;
    return 'WRITE_INVOKED_ONCE';
  }

  resize({ ref: candidate, transportEpoch, resizeSeq, cols, rows }) {
    const fence = this.fence(candidate, transportEpoch);
    if (fence) return fence;
    if (!Number.isInteger(cols) || !Number.isInteger(rows)
      || cols < LIMITS.colsMin || cols > LIMITS.colsMax
      || rows < LIMITS.rowsMin || rows > LIMITS.rowsMax) {
      return 'INVALID_RESIZE_NO_EFFECT';
    }
    if (resizeSeq <= this.nextResizeSeq) return 'STALE_RESIZE_NO_EFFECT';
    this.nextResizeSeq = resizeSeq;
    this.resizeCalls += 1;
    this.lastAppliedSize = { cols, rows };
    return 'RESIZE_APPLIED';
  }

  output(bytes) {
    assert.ok(Number.isInteger(bytes) && bytes >= 0);
    this.unackedBytes += bytes;
    this.ringBytes = Math.min(LIMITS.outputRingBytes, this.ringBytes + bytes);
    if (!this.backpressured && this.unackedBytes > LIMITS.outputHighWaterBytes) {
      this.backpressured = true;
      this.pauseCalls += 1;
      return 'PAUSED';
    }
    return this.backpressured ? 'BACKPRESSURED' : 'FLOWING';
  }

  ack(bytes) {
    assert.ok(Number.isInteger(bytes) && bytes >= 0);
    if (bytes > this.unackedBytes) return 'INVALID_ACK_NO_EFFECT';
    this.unackedBytes -= bytes;
    if (this.backpressured && this.unackedBytes <= LIMITS.outputLowWaterBytes) {
      this.backpressured = false;
      this.resumeCalls += 1;
      return 'RESUMED';
    }
    return this.backpressured ? 'BACKPRESSURED' : 'FLOWING';
  }

  rebindWorkspace() {
    this.currentRef = ref({ workspaceGeneration: this.currentRef.workspaceGeneration + 1 });
    this.terminateCalls += 1;
  }

  loseHost() {
    this.hostLost = true;
  }

  restartHost() {
    this.hostLost = false;
    this.currentRef = ref({
      workspaceGeneration: this.currentRef.workspaceGeneration,
      ptyHostGeneration: this.currentRef.ptyHostGeneration + 1,
      sessionId: 'session-B',
      sessionGeneration: 1,
      processIncarnationId: 'proc-B',
    });
    this.transportEpoch += 1;
    this.nextInputSeq = 1;
  }

  resolveWorkspaceCwd({ workspaceId, workspaceGeneration, requestedCwd }) {
    if (workspaceId !== this.currentRef.workspaceId
      || workspaceGeneration !== this.currentRef.workspaceGeneration) {
      return { outcome: 'STALE_WORKSPACE_NO_EFFECT' };
    }
    if (requestedCwd !== undefined) return { outcome: 'RENDERER_CWD_FORBIDDEN_NO_EFFECT' };
    return { outcome: 'RESOLVED', cwd: this.workspaceCanonicalRoot };
  }
}

const categories = Object.freeze([
  'stale_generation',
  'replayed_input',
  'output_flood',
  'process_tree_leak',
  'resize_race',
  'crash_restart_ambiguity',
  'workspace_escape',
]);

test('matrix covers every requested falsification category', () => {
  assert.deepEqual(categories, [
    'stale_generation',
    'replayed_input',
    'output_flood',
    'process_tree_leak',
    'resize_race',
    'crash_restart_ambiguity',
    'workspace_escape',
  ]);
});

test('stale workspace/session/host/process fences reject input with zero write calls', () => {
  for (const stale of [
    ref({ workspaceGeneration: 6 }),
    ref({ ptyHostGeneration: 10 }),
    ref({ sessionGeneration: 2 }),
    ref({ processIncarnationId: 'proc-old' }),
  ]) {
    const oracle = new PtySafetyOracle();
    assert.equal(oracle.input({ ref: stale, transportEpoch: 5, inputSeq: 9, dataBytes: 1 }), 'STALE_FENCE_NO_EFFECT');
    assert.equal(oracle.writeCalls, 0);
  }
});

test('workspace rebind makes the prior session immediately non-interactive', () => {
  const oracle = new PtySafetyOracle();
  const stale = structuredClone(oracle.currentRef);
  oracle.rebindWorkspace();
  assert.equal(oracle.terminateCalls, 1);
  assert.equal(oracle.input({ ref: stale, transportEpoch: 5, inputSeq: 9, dataBytes: 1 }), 'STALE_FENCE_NO_EFFECT');
  assert.equal(oracle.resize({ ref: stale, transportEpoch: 5, resizeSeq: 21, cols: 80, rows: 24 }), 'STALE_FENCE_NO_EFFECT');
  assert.equal(oracle.writeCalls, 0);
  assert.equal(oracle.resizeCalls, 0);
});

test('duplicate or gapped input never calls PTY write', () => {
  const oracle = new PtySafetyOracle();
  assert.equal(oracle.input({ ref: ref(), transportEpoch: 5, inputSeq: 8, dataBytes: 3 }), 'DUPLICATE_NO_EFFECT');
  assert.equal(oracle.input({ ref: ref(), transportEpoch: 5, inputSeq: 10, dataBytes: 3 }), 'INPUT_GAP_RESYNC_REQUIRED_NO_EFFECT');
  assert.equal(oracle.writeCalls, 0);
});

test('accepted input is invoked once and a lost ACK must not authorize replay', () => {
  const oracle = new PtySafetyOracle();
  assert.equal(oracle.input({ ref: ref(), transportEpoch: 5, inputSeq: 9, dataBytes: 4 }), 'WRITE_INVOKED_ONCE');
  assert.equal(oracle.writeCalls, 1);
  // Simulate response loss: caller repeats the same non-idempotent inputSeq.
  assert.equal(oracle.input({ ref: ref(), transportEpoch: 5, inputSeq: 9, dataBytes: 4 }), 'DUPLICATE_NO_EFFECT');
  assert.equal(oracle.writeCalls, 1);
});

test('oversized input fails closed before PTY write', () => {
  const oracle = new PtySafetyOracle();
  assert.equal(oracle.input({ ref: ref(), transportEpoch: 5, inputSeq: 9, dataBytes: LIMITS.inputFrameBytes + 1 }), 'INVALID_INPUT_NO_EFFECT');
  assert.equal(oracle.writeCalls, 0);
});

test('output flood crosses a hard high-water mark once and ring memory remains bounded', () => {
  const oracle = new PtySafetyOracle();
  const chunk = 32 * 1024;
  for (let i = 0; i < 256; i += 1) oracle.output(chunk);
  assert.equal(oracle.pauseCalls, 1);
  assert.equal(oracle.backpressured, true);
  assert.ok(oracle.ringBytes <= LIMITS.outputRingBytes);
  assert.ok(oracle.unackedBytes > LIMITS.outputHighWaterBytes);
});

test('backpressure resumes only at low-water and rejects impossible ACK credit', () => {
  const oracle = new PtySafetyOracle();
  oracle.output(LIMITS.outputHighWaterBytes + 1);
  assert.equal(oracle.ack(oracle.unackedBytes + 1), 'INVALID_ACK_NO_EFFECT');
  assert.equal(oracle.resumeCalls, 0);
  const toLowWater = oracle.unackedBytes - LIMITS.outputLowWaterBytes;
  assert.equal(oracle.ack(toLowWater), 'RESUMED');
  assert.equal(oracle.resumeCalls, 1);
  assert.equal(oracle.unackedBytes, LIMITS.outputLowWaterBytes);
});

test('resize race is last-newer-sequence-wins and invalid dimensions have no native effect', () => {
  const oracle = new PtySafetyOracle();
  assert.equal(oracle.resize({ ref: ref(), transportEpoch: 5, resizeSeq: 22, cols: 90, rows: 30 }), 'RESIZE_APPLIED');
  assert.equal(oracle.resize({ ref: ref(), transportEpoch: 5, resizeSeq: 21, cols: 200, rows: 80 }), 'STALE_RESIZE_NO_EFFECT');
  assert.equal(oracle.resize({ ref: ref(), transportEpoch: 5, resizeSeq: 23, cols: 0, rows: 20 }), 'INVALID_RESIZE_NO_EFFECT');
  assert.deepEqual(oracle.lastAppliedSize, { cols: 90, rows: 30 });
  assert.equal(oracle.resizeCalls, 1);
});

test('host crash invalidates old refs and restart creates a fresh host/session/process incarnation', () => {
  const oracle = new PtySafetyOracle();
  const oldRef = structuredClone(oracle.currentRef);
  oracle.loseHost();
  assert.equal(oracle.input({ ref: oldRef, transportEpoch: 5, inputSeq: 9, dataBytes: 1 }), 'STALE_HOST_NO_EFFECT');
  oracle.restartHost();
  assert.notEqual(oracle.currentRef.ptyHostGeneration, oldRef.ptyHostGeneration);
  assert.notEqual(oracle.currentRef.sessionId, oldRef.sessionId);
  assert.notEqual(oracle.currentRef.processIncarnationId, oldRef.processIncarnationId);
  assert.equal(oracle.input({ ref: oldRef, transportEpoch: 5, inputSeq: 9, dataBytes: 1 }), 'STALE_FENCE_NO_EFFECT');
  assert.equal(oracle.writeCalls, 0);
});

test('renderer-supplied cwd is never authority and stale workspace generation cannot resolve cwd', () => {
  const oracle = new PtySafetyOracle();
  assert.deepEqual(
    oracle.resolveWorkspaceCwd({ workspaceId: 'ws-A', workspaceGeneration: 7, requestedCwd: '../../outside' }),
    { outcome: 'RENDERER_CWD_FORBIDDEN_NO_EFFECT' },
  );
  assert.deepEqual(
    oracle.resolveWorkspaceCwd({ workspaceId: 'ws-A', workspaceGeneration: 6 }),
    { outcome: 'STALE_WORKSPACE_NO_EFFECT' },
  );
  assert.deepEqual(
    oracle.resolveWorkspaceCwd({ workspaceId: 'ws-A', workspaceGeneration: 7 }),
    { outcome: 'RESOLVED', cwd: '/trusted/ws-A' },
  );
});

test('process-tree cleanup acceptance requires verified descendant cleanup, not root exit alone', () => {
  const classifyCleanup = ({ rootExited, descendantsAlive, containmentBound }) => {
    if (!containmentBound) return 'PARTIAL_UNVERIFIED';
    if (!rootExited || descendantsAlive !== 0) return 'FAILED_LEAK';
    return 'VERIFIED';
  };

  assert.equal(classifyCleanup({ rootExited: true, descendantsAlive: 2, containmentBound: true }), 'FAILED_LEAK');
  assert.equal(classifyCleanup({ rootExited: true, descendantsAlive: 0, containmentBound: false }), 'PARTIAL_UNVERIFIED');
  assert.equal(classifyCleanup({ rootExited: true, descendantsAlive: 0, containmentBound: true }), 'VERIFIED');
});
