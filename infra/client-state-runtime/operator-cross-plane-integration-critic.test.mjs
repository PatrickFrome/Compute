import assert from 'node:assert/strict';
import test from 'node:test';
import { auditClientCrossPlaneIntegration } from './operator-cross-plane-integration-critic.mjs';
import { buildUnifiedOperatorContext } from './operator-unified-snapshot-core.mjs';
import { OBSERVATORY_VIEWS, reduceOperatorObservatory } from '../../apps/me2-ui/src/lib/operator-observatory.mjs';

const NOW = Date.parse('2026-10-14T17:00:00Z');
const DATE = new Date(NOW - 1000).toISOString();
const BIRTH = new Date(NOW - 90_000).toISOString();
const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const D = 'd'.repeat(40), E = 'e'.repeat(40), F = 'f'.repeat(40);
const H = '1'.repeat(64), OLD = '2'.repeat(64), PROOF = '3'.repeat(64), MANIFEST = '4'.repeat(64);
const planes = ['database', 'client', 'supervisor', 'fleet', 'host', 'source', 'continuity'];
const views = ['Now', 'Missions', 'Fleet', 'Brain', 'Develop', 'System', 'Evidence'];
const origins = ['LOCAL_POSTGRES', 'NATIVE_BROWSER_READBACK', 'SIGNED_SUPERVISOR_READBACK',
  'LOCAL_TASK_LEDGER', 'TRUSTED_HOST_READBACK', 'EXACT_GIT_READBACK', 'LOCAL_CHECKPOINT_LEDGER'];

function fixture() {
  const expected = {
    source_sha: B, baseline_source_sha: A,
    artifact_sha256: H, baseline_artifact_sha256: OLD,
    owner_id: 'local-owner', owner_epoch: 4, process_incarnation: 'native-process-9',
    run_id: 'run:2', event_seq: 41,
  };
  const snapshotPlanes = Object.fromEntries(planes.map((name, i) => [name, {
    state: 'READY', proof: 'TRUSTED_READBACK', fresh: true,
    source: origins[i], observed_at: DATE,
  }]));
  const context = {
    schema: 'metaengine.operator.context.v1', scope: 'READ_ONLY', storage: 'OWN_POSTGRES_ONLY',
    authority_effect: false, scheduler_authority: false, automatic_retry_allowed: false,
    remote_fallback_allowed: false, cloud_database_dependency: false,
    generated_at: DATE, run_id: expected.run_id, owner_id: expected.owner_id, event_seq: expected.event_seq,
    source_sha: B, owner_epoch: 4, proof_identity: PROOF, planes: snapshotPlanes,
  };
  return {
    expected,
    refs: {
      main: F, integration: E, client: B, pr1216: D, pr1221: C, roadmap: F,
      ancestry: { base_sha: D, head_sha: C, merge_base_sha: D, behind_by: 0, ahead_by: 11 },
    },
    owner: {
      source_sha: B, owner_id: 'local-owner', owner_epoch: 4, provider: 'LOCAL_POSTGRES',
      boot_state: 'READY', state: 'HEALTHY', pid: 5172,
      process_incarnation: 'native-process-9', native_instance_id: 'owner-instance:3',
      observed_at: DATE, process_created_at: BIRTH,
    },
    postgres: {
      source_sha: B, provider: 'LOCAL_POSTGRES', address: '127.0.0.1',
      owner_id: 'local-owner', owner_epoch: 4, native_instance_id: 'owner-instance:3',
      snapshot_isolation: 'REPEATABLE_READ', read_only: true, grants_proven: true,
      conflicting_leases: 0, unresolved_effects: 0, observed_at: DATE,
    },
    context,
    ui: {
      schema: 'metaengine.operator.observatory.v1', state: 'OBSERVED',
      source_sha: B, owner_epoch: 4, run_id: 'run:2', event_seq: 41,
      proof_identity: PROOF, cursor_state: 'VERIFIED_CURSOR', generated_at: DATE,
      planes: structuredClone(snapshotPlanes),
      views: structuredClone(OBSERVATORY_VIEWS),
      authority_effect: false, automatic_retry_allowed: false,
    },
    package: {
      source_sha: B, artifact_sha256: H, installed_exe_sha256: H,
      source_manifest_sha256: MANIFEST, installed_manifest_sha256: MANIFEST,
      native_instance_id: 'owner-instance:3', package_identity_reserved: false,
      reproducible_source: true, observed_at: DATE,
    },
    ci: {
      source_sha: B, workflows: ['Client State Runtime Contracts', 'Browser Windows Package Smoke',
        'ME2 Unified Gate'].map(name => ({ name, source_sha: B, conclusion: 'success', status: 'completed' })),
    },
    promotion: {
      source_sha: B, owner_id: 'local-owner', owner_epoch: 4, state: 'REVIEW_REQUIRED',
      critic_independent: true, authority_effect: false, executed: false,
      unknown_effects: 0, observed_at: DATE,
    },
    rollback: {
      source_sha: A, artifact_sha256: OLD, owner_id: 'local-owner', owner_epoch: 4,
      native_instance_id: 'owner-instance:3', rehearsal: 'PASS', unresolved_effects: 0,
      executed: false, observed_at: DATE,
    },
  };
}
const audit = x => auditClientCrossPlaneIntegration(x, { nowMs: NOW });
const reject = (title, mutation, reason) => test(title, () => {
  const sample = fixture();
  mutation(sample);
  const result = audit(sample);
  assert.equal(result.state, 'BLOCKED', JSON.stringify(result));
  assert.ok(result.reasons.includes(reason), JSON.stringify(result));
  assert.equal(result.deployment_qualified, false);
  assert.equal(result.promotion_executed, false);
  assert.equal(result.rollback_executed, false);
  assert.equal(result.authority_effect, false);
  assert.equal(result.automatic_retry_allowed, false);
});

test('a complete self-reported receipt set can request review but NEVER assert physical health, active Owner, or promotion', () => {
  const result = audit(fixture());
  assert.equal(result.state, 'REVIEW_REQUIRED', JSON.stringify(result.reasons));
  assert.deepEqual(result.reasons, []);
  assert.equal(result.physical_pg17_proven, false);
  assert.equal(result.installed_healthy_proven, false);
  assert.equal(result.evidence_scope, 'UNTRUSTED_SOURCE_CONFORMANCE_ONLY');
  assert.equal(result.deployment_qualified, false);
  assert.equal(result.scheduler_authority, false);
  assert.equal(result.cloud_fallback_allowed, false);
  assert.ok(!JSON.stringify(result).includes('ACTIVE'));
});
reject('a missing expected SHA cannot be inferred from another plane', x => {
  delete x.expected.source_sha;
}, 'EXPECTED_IDENTITY_UNQUALIFIED');
reject('head advancing after PR readback invalidates pinned Client source', x => {
  x.refs.client = C;
}, 'GIT_CONVERGENCE_OR_ANCESTRY_UNPROVEN');
reject('PR #1221 absent from the #1216 ancestry cannot silently converge', x => {
  x.refs.ancestry.merge_base_sha = E;
}, 'GIT_CONVERGENCE_OR_ANCESTRY_UNPROVEN');
reject('PR #1216 compare behind count blocks source proof', x => {
  x.refs.ancestry.behind_by = 2;
}, 'GIT_CONVERGENCE_OR_ANCESTRY_UNPROVEN');
reject('HTTP success without native process birth cannot mean HEALTHY', x => {
  x.owner.pid = 0;
  x.owner.http_status = 200;
}, 'INSTALLED_OWNER_PROCESS_PROVENANCE_UNQUALIFIED');
reject('reused PID after observation loses native incarnation', x => {
  x.owner.process_created_at = new Date(NOW + 1000).toISOString();
}, 'INSTALLED_OWNER_PROCESS_PROVENANCE_UNQUALIFIED');
reject('Owner blocked boot cannot be called healthy', x => {
  x.owner.boot_state = 'BLOCKED';
}, 'INSTALLED_OWNER_PROCESS_PROVENANCE_UNQUALIFIED');
reject('Owner epoch mismatch is not recoverable from PG healthy flag', x => {
  x.owner.owner_epoch = 5;
}, 'INSTALLED_OWNER_PROCESS_PROVENANCE_UNQUALIFIED');
reject('PG hosted address is forbidden', x => {
  x.postgres.address = 'https://hosted.invalid';
}, 'OWN_POSTGRES_ACL_LEASE_OR_ISOLATION_UNQUALIFIED');
reject('PG cross-owner claim is not a fleet proof', x => {
  x.postgres.owner_id = 'other-owner';
}, 'OWN_POSTGRES_ACL_LEASE_OR_ISOLATION_UNQUALIFIED');
reject('PG snapshot not repeatable-read has no coherent cursor', x => {
  x.postgres.snapshot_isolation = 'READ_COMMITTED';
}, 'OWN_POSTGRES_ACL_LEASE_OR_ISOLATION_UNQUALIFIED');
reject('PG missing ACL cannot be assumed read-only', x => {
  x.postgres.grants_proven = false;
}, 'OWN_POSTGRES_ACL_LEASE_OR_ISOLATION_UNQUALIFIED');
reject('conflicting lease fails closed despite healthy Browser', x => {
  x.postgres.conflicting_leases = 1;
}, 'OWN_POSTGRES_ACL_LEASE_OR_ISOLATION_UNQUALIFIED');
reject('unresolved effect fails closed despite package bytes matching', x => {
  x.postgres.unresolved_effects = 1;
}, 'OWN_POSTGRES_ACL_LEASE_OR_ISOLATION_UNQUALIFIED');
reject('all positive planes without exact source pin cannot qualify canonical context', x => {
  x.context.source_sha = D;
}, 'CANONICAL_CONTEXT_NOT_FULLY_PROVEN');
reject('missing one native plane cannot be synthesized from database available', x => {
  x.context.planes.supervisor = { state: 'UNKNOWN', fresh: false, proof: 'NONE' };
}, 'CANONICAL_CONTEXT_NOT_FULLY_PROVEN');
reject('context with effect authority cannot qualify', x => {
  x.context.scheduler_authority = true;
}, 'CANONICAL_CONTEXT_NOT_FULLY_PROVEN');
reject('seven-view UI cursor rollback cannot imply healthy state', x => {
  x.ui.event_seq = 40;
}, 'SEVEN_VIEW_CURSOR_SOURCE_OR_HEALTH_DRIFT');
reject('one view cannot silently disappear during convergence', x => {
  delete x.ui.views.Evidence;
}, 'SEVEN_VIEW_CURSOR_SOURCE_OR_HEALTH_DRIFT');
reject('UI source SHA drift invalidates source identity', x => {
  x.ui.source_sha = C;
}, 'SEVEN_VIEW_CURSOR_SOURCE_OR_HEALTH_DRIFT');
reject('UI forged ACTIVE status does not elevate native Client', x => {
  x.ui.planes.client.state = 'ACTIVE';
}, 'SEVEN_VIEW_CURSOR_SOURCE_OR_HEALTH_DRIFT');
reject('stale UI observation is not fresh canonical readback', x => {
  x.ui.generated_at = new Date(NOW - 60_000).toISOString();
}, 'SEVEN_VIEW_CURSOR_SOURCE_OR_HEALTH_DRIFT');
reject('package source SHA differing from branch is not a release candidate', x => {
  x.package.source_sha = D;
}, 'PACKAGE_SOURCE_MANIFEST_OR_INSTALLED_BYTES_DRIFT');
reject('installed exe mismatch blocks even with complete CI', x => {
  x.package.installed_exe_sha256 = OLD;
}, 'PACKAGE_SOURCE_MANIFEST_OR_INSTALLED_BYTES_DRIFT');
reject('package reserved version collision blocks even with successful unit tests', x => {
  x.package.package_identity_reserved = true;
}, 'PACKAGE_SOURCE_MANIFEST_OR_INSTALLED_BYTES_DRIFT');
reject('source inventory drift blocks even if exe identity matches', x => {
  x.package.installed_manifest_sha256 = OLD;
}, 'PACKAGE_SOURCE_MANIFEST_OR_INSTALLED_BYTES_DRIFT');
reject('passing CI for another SHA is never exact-head evidence', x => {
  x.ci.workflows[0].source_sha = C;
}, 'EXACT_HEAD_CI_OR_WINDOWS_PACKAGE_GATE_MISSING');
reject('Windows packaging failure blocks convergence despite Client contracts green', x => {
  x.ci.workflows[1].conclusion = 'failure';
}, 'EXACT_HEAD_CI_OR_WINDOWS_PACKAGE_GATE_MISSING');
reject('missing UI CI gate blocks source-only qualification', x => {
  x.ci.workflows.pop();
}, 'EXACT_HEAD_CI_OR_WINDOWS_PACKAGE_GATE_MISSING');
reject('no independent critic means no promotion', x => {
  x.promotion.critic_independent = false;
}, 'INDEPENDENT_PROMOTION_REVIEW_GATE_UNPROVEN');
reject('claimed executed promotion is not reviewer authority', x => {
  x.promotion.executed = true;
}, 'INDEPENDENT_PROMOTION_REVIEW_GATE_UNPROVEN');
reject('rollback must pin baseline and exact artifact', x => {
  x.rollback.source_sha = C;
}, 'ROLLBACK_PIN_OR_UNRESOLVED_EFFECTS');
reject('rollback of another native Owner is not rehearsal', x => {
  x.rollback.native_instance_id = 'other-incarnation';
}, 'ROLLBACK_PIN_OR_UNRESOLVED_EFFECTS');
reject('rollback cannot erase unknown effects by claiming PASS', x => {
  x.rollback.unresolved_effects = 1;
}, 'ROLLBACK_PIN_OR_UNRESOLVED_EFFECTS');
reject('expired rollback rehearsal is not evidence', x => {
  x.rollback.observed_at = new Date(NOW - 90_000).toISOString();
}, 'ROLLBACK_PIN_OR_UNRESOLVED_EFFECTS');

test('actual default own-PG source context plus seven-view renderer never fabricates ACTIVE/HEALTHY', () => {
  const x = fixture();
  x.context = buildUnifiedOperatorContext({ nowMs: NOW });
  const ui = reduceOperatorObservatory(x.context, { nowMs: NOW });
  assert.equal(x.context.planes.database.state, 'UNKNOWN');
  assert.equal(ui.cursor_state, 'UNKNOWN');
  for (const plane of planes) assert.equal(ui.planes[plane].state, 'UNKNOWN');
  x.ui = ui;
  const verdict = audit(x);
  assert.equal(verdict.state, 'BLOCKED');
  assert.ok(verdict.reasons.includes('CANONICAL_CONTEXT_NOT_FULLY_PROVEN'));
  assert.ok(verdict.reasons.includes('SEVEN_VIEW_CURSOR_SOURCE_OR_HEALTH_DRIFT'));
});

test('no secrets, raw rows, commands, or page claims leak through read-only critic output', () => {
  const x = fixture();
  x.postgres.password = 'a-private-password';
  x.ui.page_prompt = 'a-private-prompt';
  x.owner.token = 'a-private-token';
  const result = audit(x);
  assert.equal(JSON.stringify(result).includes('a-private'), false);
  assert.equal(result.authority_effect, false);
});
test('invalid clock fails without authority or network effects', () => {
  assert.throws(() => auditClientCrossPlaneIntegration(fixture(), { nowMs: Infinity }), /clock_invalid/);
});
