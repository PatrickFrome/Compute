// W42: exercise the actual W6 Observatory projection with the W36 critic, not
// a second invented UI reducer. All witnesses are hermetic, untrusted fixtures.
import assert from 'node:assert/strict';
import test from 'node:test';
import { auditClientCrossPlaneIntegration } from './operator-cross-plane-integration-critic.mjs';
import { reduceOperatorObservatory, OBSERVATORY_VIEWS } from '../../apps/me2-ui/src/lib/operator-observatory.mjs';

const NOW = Date.parse('2026-10-15T00:00:00Z');
const T = new Date(NOW - 1_000).toISOString();
const BIRTH = new Date(NOW - 90_000).toISOString();
const SHA = char => char.repeat(40);
const HASH = char => char.repeat(64);
const SOURCE = {
  database: 'LOCAL_POSTGRES', client: 'NATIVE_BROWSER_READBACK',
  supervisor: 'SIGNED_SUPERVISOR_READBACK', fleet: 'LOCAL_TASK_LEDGER',
  host: 'TRUSTED_HOST_READBACK', source: 'EXACT_GIT_READBACK',
  continuity: 'LOCAL_CHECKPOINT_LEDGER',
};

function candidate() {
  const expected = {
    source_sha: SHA('a'), baseline_source_sha: SHA('b'),
    artifact_sha256: HASH('1'), baseline_artifact_sha256: HASH('2'),
    owner_id: 'owner:local', owner_epoch: 7, process_incarnation: 'incarnation:1',
    run_id: 'run:known', event_seq: 42,
  };
  const planes = Object.fromEntries(Object.entries(SOURCE).map(([name, source]) => [
    name, { source, state: 'READY', fresh: true, proof: 'TRUSTED_READBACK', observed_at: T },
  ]));
  const context = {
    schema: 'metaengine.operator.context.v1', storage: 'OWN_POSTGRES_ONLY', scope: 'READ_ONLY',
    authority_effect: false, scheduler_authority: false, automatic_retry_allowed: false,
    remote_fallback_allowed: false, cloud_database_dependency: false,
    generated_at: T, owner_id: expected.owner_id, owner_epoch: expected.owner_epoch,
    source_sha: expected.source_sha, run_id: expected.run_id, event_seq: expected.event_seq,
    proof_identity: HASH('3'), planes,
  };
  const actualW6 = reduceOperatorObservatory(context, { nowMs: NOW });
  assert.equal(actualW6.cursor_state, 'VERIFIED_CURSOR');
  const ui = { ...actualW6, views: structuredClone(actualW6.views),
    source_sha: expected.source_sha, owner_epoch: expected.owner_epoch };
  return {
    expected,
    refs: { main: SHA('c'), integration: SHA('d'), client: SHA('a'),
      pr1216: SHA('e'), pr1221: SHA('f'), roadmap: SHA('c'),
      ancestry: { base_sha: SHA('e'), head_sha: SHA('f'),
        merge_base_sha: SHA('e'), behind_by: 0, ahead_by: 1 } },
    owner: { owner_id: expected.owner_id, owner_epoch: expected.owner_epoch,
      source_sha: expected.source_sha, process_incarnation: expected.process_incarnation,
      provider: 'LOCAL_POSTGRES', boot_state: 'READY', state: 'HEALTHY',
      native_instance_id: 'owner-incarnation:1', pid: 1234, process_created_at: BIRTH,
      observed_at: T },
    postgres: { owner_id: expected.owner_id, owner_epoch: expected.owner_epoch,
      source_sha: expected.source_sha, native_instance_id: 'owner-incarnation:1',
      provider: 'LOCAL_POSTGRES', address: '127.0.0.1', snapshot_isolation: 'REPEATABLE_READ',
      read_only: true, grants_proven: true, conflicting_leases: 0, unresolved_effects: 0,
      observed_at: T },
    context, ui,
    package: { source_sha: expected.source_sha, artifact_sha256: expected.artifact_sha256,
      installed_exe_sha256: expected.artifact_sha256, source_manifest_sha256: HASH('4'),
      installed_manifest_sha256: HASH('4'), native_instance_id: 'owner-incarnation:1',
      package_identity_reserved: false, reproducible_source: true, observed_at: T },
    ci: { source_sha: expected.source_sha,
      workflows: ['Client State Runtime Contracts', 'Browser Windows Package Smoke', 'ME2 Unified Gate']
        .map(name => ({ name, source_sha: expected.source_sha, status: 'completed',
          conclusion: 'success' })) },
    promotion: { source_sha: expected.source_sha, owner_id: expected.owner_id,
      owner_epoch: expected.owner_epoch, state: 'REVIEW_REQUIRED', critic_independent: true,
      authority_effect: false, executed: false, unknown_effects: 0, observed_at: T },
    rollback: { source_sha: expected.baseline_source_sha,
      artifact_sha256: expected.baseline_artifact_sha256, owner_id: expected.owner_id,
      owner_epoch: expected.owner_epoch, native_instance_id: 'owner-incarnation:1',
      rehearsal: 'PASS', unresolved_effects: 0, executed: false, observed_at: T },
  };
}

const evaluate = x => auditClientCrossPlaneIntegration(x, { nowMs: NOW });
test('W42 actual W6 one-context/seven-view projection reaches REVIEW_REQUIRED, never physical READY', () => {
  const x = candidate();
  assert.deepEqual(x.ui.views, OBSERVATORY_VIEWS);
  const v = evaluate(x);
  assert.equal(v.state, 'REVIEW_REQUIRED', JSON.stringify(v.reasons));
  assert.equal(v.authority_effect, false);
  assert.equal(v.deployment_qualified, false);
  assert.equal(v.installed_healthy_proven, false);
  assert.equal(v.promotion_executed, false);
});

const attacks = [
  ['cross-wired Client source masquerades as trusted local Browser', x => {
    x.context.planes.client.source = 'LOCAL_POSTGRES';
  }, 'CANONICAL_CONTEXT_NOT_FULLY_PROVEN'],
  ['wrong Fleet source masquerades as true leased ledger', x => {
    x.context.planes.fleet.source = 'SIGNED_SUPERVISOR_READBACK';
  }, 'CANONICAL_CONTEXT_NOT_FULLY_PROVEN'],
  ['view inventory is present but wrong: Evidence shows Now', x => {
    x.ui.views.Evidence = [...x.ui.views.Now];
  }, 'SEVEN_VIEW_CURSOR_SOURCE_OR_HEALTH_DRIFT'],
  ['view order changed while arrays and names remain valid', x => {
    x.ui.views.Fleet = [...x.ui.views.Fleet].reverse();
  }, 'SEVEN_VIEW_CURSOR_SOURCE_OR_HEALTH_DRIFT'],
  ['UI plane retains stale prior positive value after source loss', x => {
    x.context.planes.host.source = 'LOCAL_POSTGRES';
    x.ui.planes.host.state = 'READY';
  }, 'CANONICAL_CONTEXT_NOT_FULLY_PROVEN'],
  ['UI generated from different context timestamp', x => {
    x.ui.generated_at = new Date(NOW - 2_000).toISOString();
  }, 'SEVEN_VIEW_CURSOR_SOURCE_OR_HEALTH_DRIFT'],
  ['Owner identity omitted while remaining epoch and native PID look healthy', x => {
    delete x.context.owner_id;
  }, 'CANONICAL_CONTEXT_NOT_FULLY_PROVEN'],
  ['UI claims a positive value the W6 reducer would downgrade', x => {
    x.ui.planes.client.proof = 'NONE';
  }, 'SEVEN_VIEW_CURSOR_SOURCE_OR_HEALTH_DRIFT'],
  ['fake extra view can carry a shadow client plane', x => {
    x.ui.views.Legacy = ['client'];
  }, 'SEVEN_VIEW_CURSOR_SOURCE_OR_HEALTH_DRIFT'],
  ['ambiguous own-PG effect cannot be cured by success flags', x => {
    x.postgres.unresolved_effects = 1;
    x.promotion.critic_independent = true;
  }, 'OWN_POSTGRES_ACL_LEASE_OR_ISOLATION_UNQUALIFIED'],
  ['rollback digest from a different baseline cannot promote', x => {
    x.rollback.artifact_sha256 = HASH('9');
  }, 'ROLLBACK_PIN_OR_UNRESOLVED_EFFECTS'],
  ['a passing Client check cannot compensate for failing packaging', x => {
    x.ci.workflows[1].conclusion = 'failure';
  }, 'EXACT_HEAD_CI_OR_WINDOWS_PACKAGE_GATE_MISSING'],
  ['caller-supplied VERIFIED and installed flags never grant authority', x => {
    x.installed_healthy_proven = true;
    x.promotion.verified = true;
    x.ci.verified = true;
    x.owner.verified = true;
  }, null],
];

for (const [name, mutate, reason] of attacks) {
  test('W42 ' + name, () => {
    const x = candidate();
    mutate(x);
    const result = evaluate(x);
    assert.equal(result.state, reason === null ? 'REVIEW_REQUIRED' : 'BLOCKED');
    if (reason) assert.ok(result.reasons.includes(reason), JSON.stringify(result.reasons));
    assert.equal(result.authority_effect, false);
    assert.equal(result.automatic_retry_allowed, false);
    assert.equal(result.deployment_qualified, false);
    assert.equal(result.physical_pg17_proven, false);
    assert.equal(result.installed_healthy_proven, false);
  });
}
