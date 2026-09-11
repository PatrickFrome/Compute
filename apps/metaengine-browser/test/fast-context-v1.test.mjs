import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFastContext,
  FAST_CONTEXT_DELTA_BUDGET_BYTES,
  FAST_CONTEXT_HARD_MAX_BYTES,
  FAST_CONTEXT_ORDINARY_BUDGET_BYTES,
} from '../src/fast-context-v1.mjs';
import { buildChatDevelopmentCapsule } from '../src/chat-development-capsule.mjs';

function state(tabCount = 28) {
  return {
    client_id: 'client-test',
    shell_version: '0.7.0-dev.test.1',
    process_incarnation_id: 'proc-123',
    operator_runtime: 'native-electron-supervisor-v1',
    supervisor_mode: 'CONTROL',
    armed: true,
    operator_mode: 'CONTROL',
    heartbeat_at: '2026-09-10T00:00:00.000Z',
    tabs: Array.from({ length: tabCount }, (_, index) => ({
      tab_id: `tab-${index}`,
      url: `https://example.test/${index}?payload=${'x'.repeat(1200)}`,
      title: `Title ${index} ${'y'.repeat(240)}`,
      kind: 'REMOTE_WEB',
      selected: index === 3,
    })),
    development_plane: {
      huge_forensic_state: 'z'.repeat(100000),
    },
    fleet: { rows: Array.from({ length: 1000 }, () => ({ huge: 'x'.repeat(100) })) },
    self_update: { huge: 'x'.repeat(100000) },
    last_error: null,
  };
}

test('ordinary fast context remains below 8 KiB even when source state is huge', () => {
  const out = buildFastContext({
    state: state(),
    source: {
      repository: 'PatrickFrome/Compute',
      branch: 'work/browser-command-fabric-v2-p0',
      head_sha: 'a'.repeat(40),
      base_sha: 'b'.repeat(40),
      pr: 999,
      dirty: false,
    },
    ci: { success: 12, pending: 1, failed: 0, exact_sha: 'a'.repeat(40) },
    capability_revision: `sha256:${'c'.repeat(64)}`,
    last_checkpoint_id: 'CP_TEST',
    now_ms: Date.parse('2026-09-10T00:00:00.500Z'),
  });
  assert.equal(out.status, 'OK');
  assert.ok(out.bytes <= FAST_CONTEXT_ORDINARY_BUDGET_BYTES, `bytes=${out.bytes}`);
  assert.equal(out.context.tabs.count, 28);
  assert.equal(out.context.tabs.selected.tab_id, 'tab-3');
  assert.equal(out.context.control.mode, 'CONTROL');
  assert.equal(out.context.control.armed, true);
  assert.equal(out.context.freshness_ms, 500);
  assert.match(out.context.revision, /^ctx:[0-9a-f]{64}$/);
  assert.match(out.context.state_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal('fleet' in out.context, false);
  assert.equal('self_update' in out.context, false);
});

test('fast context carries exact-head development capsule without widening authority', () => {
  const head = 'a'.repeat(40);
  const source = {
    repository: 'PatrickFrome/Compute',
    branch: 'work/browser-command-fabric-v2-p0',
    head_sha: head,
    pr: 453,
    dirty: false,
  };
  const developmentCapsule = buildChatDevelopmentCapsule({
    source,
    ci_runs: [{ id: 1, name: 'Shell', status: 'completed', conclusion: 'failure', head_sha: head, authority_effect: false }],
    evidence: [{ id: 'blocker:test', kind: 'BLOCKER', title: 'Fix shell contract', path: 'test/x.mjs', severity: 'HIGH', authority_effect: false }],
    generated_at: '2026-09-10T00:00:00.000Z',
  });
  const out = buildFastContext({
    state: state(2),
    source,
    development_capsule: developmentCapsule,
    now_ms: Date.parse('2026-09-10T00:00:00.500Z'),
  });
  assert.equal(out.context.development_capsule.source.head_sha, head);
  assert.equal(out.context.development_capsule.ci.state, 'RED');
  assert.equal(out.context.development_capsule.focus.kind, 'CI_FAILURE');
  assert.equal(out.context.development_capsule.command_authority, false);
  assert.equal(out.context.development_capsule.browser_execution_authority, false);
  assert.ok(out.bytes <= FAST_CONTEXT_ORDINARY_BUDGET_BYTES, `bytes=${out.bytes}`);
});

test('development capsule from another head or with forged authority fails closed', () => {
  const head = 'a'.repeat(40);
  const capsule = buildChatDevelopmentCapsule({
    source: { repository: 'PatrickFrome/Compute', head_sha: 'b'.repeat(40) },
    evidence: [],
  });
  assert.throws(() => buildFastContext({
    state: state(1),
    source: { repository: 'PatrickFrome/Compute', head_sha: head },
    development_capsule: capsule,
  }), /dev_capsule_head_mismatch/);
  assert.throws(() => buildFastContext({
    state: state(1),
    source: { repository: 'PatrickFrome/Compute', head_sha: head },
    development_capsule: {
      ...buildChatDevelopmentCapsule({ source: { repository: 'PatrickFrome/Compute', head_sha: head }, evidence: [] }),
      command_authority: true,
    },
  }), /dev_capsule_authority_forbidden/);
});

test('field projection keeps mandatory identity metadata while omitting unrelated sections', () => {
  const out = buildFastContext({
    state: state(2),
    fields: ['control', 'latest_error'],
    capability_revision: `sha256:${'d'.repeat(64)}`,
    max_bytes: FAST_CONTEXT_DELTA_BUDGET_BYTES,
  });
  assert.equal(out.status, 'OK');
  assert.ok(out.bytes <= FAST_CONTEXT_DELTA_BUDGET_BYTES);
  assert.equal('control' in out.context, true);
  assert.equal('tabs' in out.context, false);
  assert.equal('development' in out.context, false);
  assert.equal('development_capsule' in out.context, false);
  assert.equal('revision' in out.context, true);
  assert.equal('capability_revision' in out.context, true);
});

test('if-none-match returns a tiny no-change envelope with the same revision', () => {
  const first = buildFastContext({ state: state(1), now_ms: 1000 });
  const second = buildFastContext({ state: state(1), now_ms: 2000, if_none_match: first.context.revision });
  assert.equal(second.status, 'NOT_MODIFIED');
  assert.equal(second.context.revision, first.context.revision);
  assert.ok(second.bytes < 512, `bytes=${second.bytes}`);
});

test('hard byte ceiling is fail-closed instead of silently returning an oversized payload', () => {
  assert.equal(FAST_CONTEXT_HARD_MAX_BYTES, 16 * 1024);
  assert.throws(
    () => buildFastContext({
      state: { ...state(1), last_error: 'e'.repeat(500) },
      source: { repository: 'r'.repeat(200), branch: 'b'.repeat(240) },
      max_bytes: 256,
    }),
    /fast_context_budget_exceeded/,
  );
});
