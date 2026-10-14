import { OBSERVATORY_VIEWS, reduceOperatorObservatory } from '../../apps/me2-ui/src/lib/operator-observatory.mjs';

// W36: independent cross-plane SOURCE conformance critic for METAENGINE Client.
// Pure data analysis only. Caller-provided "verified", HEALTHY, CI and artifact
// receipts are not cryptographic provenance and cannot authorize promotion.
export const CROSS_PLANE_CRITIC_SCHEMA = 'metaengine.client.cross-plane-critic.v1';
const SHA = /^[0-9a-f]{40}$/i;
const DIGEST = /^[0-9a-f]{64}$/i;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const FACETS = Object.freeze(['refs', 'owner', 'postgres', 'context', 'ui', 'package', 'ci', 'promotion', 'rollback']);
const PLANES = Object.freeze(['database', 'client', 'supervisor', 'fleet', 'host', 'source', 'continuity']);
const VIEWS = Object.freeze(['Now', 'Missions', 'Fleet', 'Brain', 'Develop', 'System', 'Evidence']);
const SOURCES = Object.freeze({ database: 'LOCAL_POSTGRES', client: 'NATIVE_BROWSER_READBACK',
  supervisor: 'SIGNED_SUPERVISOR_READBACK', fleet: 'LOCAL_TASK_LEDGER',
  host: 'TRUSTED_HOST_READBACK', source: 'EXACT_GIT_READBACK',
  continuity: 'LOCAL_CHECKPOINT_LEDGER' });
const REQUIRED_CI = Object.freeze([
  'Client State Runtime Contracts',
  'Browser Windows Package Smoke',
  'ME2 Unified Gate',
]);
const own = (x, key) => Object.prototype.hasOwnProperty.call(x || {}, key);
const validSeq = x => Number.isSafeInteger(x) && x >= 0;
const stamp = x => typeof x === 'string' && x.length <= 40 ? Date.parse(x) : NaN;
const fresh = (x, nowMs) => {
  const time = stamp(x);
  return Number.isFinite(time) && nowMs - time <= 30_000 && time - nowMs <= 5_000;
};
const nonempty = x => x && typeof x === 'object' && !Array.isArray(x);

export function auditClientCrossPlaneIntegration(input = {}, { nowMs = Date.now() } = {}) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('cross_plane_critic_clock_invalid');
  const expected = input?.expected || {};
  const reasons = [];
  const gates = {};
  const verdict = (facet, ok, reason) => {
    if (!ok) reasons.push(reason);
    gates[facet] = ok ? 'SOURCE_CONFORMANT' : 'UNKNOWN_OR_BLOCKED';
  };
  const sha = expected.source_sha;
  const ownerId = expected.owner_id;
  const ownerEpoch = expected.owner_epoch;
  const incarnation = expected.process_incarnation;
  const runId = expected.run_id;
  const cursor = expected.event_seq;
  const artifact = expected.artifact_sha256;
  const baseline = expected.baseline_source_sha;
  const baselineArtifact = expected.baseline_artifact_sha256;
  const expectedValid = SHA.test(sha ?? '') && SHA.test(baseline ?? '') && sha !== baseline
    && DIGEST.test(artifact ?? '') && DIGEST.test(baselineArtifact ?? '')
    && ID.test(ownerId ?? '') && ID.test(incarnation ?? '') && ID.test(runId ?? '')
    && validSeq(ownerEpoch) && ownerEpoch > 0 && validSeq(cursor);
  if (!expectedValid) reasons.push('EXPECTED_IDENTITY_UNQUALIFIED');

  const refs = input?.refs;
  const ancestry = refs?.ancestry;
  verdict('refs', nonempty(refs)
    && ['main', 'integration', 'client', 'pr1216', 'pr1221', 'roadmap'].every(k => SHA.test(refs[k] ?? ''))
    && refs.client === sha && refs.pr1216 !== refs.pr1221
    && refs.main !== refs.client
    && ancestry?.base_sha === refs.pr1216 && ancestry?.head_sha === refs.pr1221
    && ancestry?.merge_base_sha === refs.pr1216
    && ancestry?.behind_by === 0
    && validSeq(ancestry?.ahead_by) && ancestry.ahead_by > 0,
    'GIT_CONVERGENCE_OR_ANCESTRY_UNPROVEN');

  const owner = input?.owner;
  verdict('owner', nonempty(owner) && owner.owner_id === ownerId
    && owner.owner_epoch === ownerEpoch && owner.process_incarnation === incarnation
    && owner.source_sha === sha && owner.provider === 'LOCAL_POSTGRES'
    && owner.boot_state === 'READY' && owner.state === 'HEALTHY'
    && validSeq(owner.pid) && owner.pid > 0
    && fresh(owner.observed_at, nowMs)
    && Number.isFinite(stamp(owner.process_created_at))
    && stamp(owner.process_created_at) <= stamp(owner.observed_at)
    && stamp(owner.process_created_at) > 0
    && ID.test(owner.native_instance_id ?? ''),
    'INSTALLED_OWNER_PROCESS_PROVENANCE_UNQUALIFIED');

  const pg = input?.postgres;
  verdict('postgres', nonempty(pg) && pg.owner_id === ownerId
    && pg.owner_epoch === ownerEpoch && pg.native_instance_id === owner?.native_instance_id
    && pg.source_sha === sha && pg.provider === 'LOCAL_POSTGRES'
    && pg.address === '127.0.0.1'
    && pg.snapshot_isolation === 'REPEATABLE_READ'
    && pg.read_only === true && pg.grants_proven === true
    && pg.conflicting_leases === 0 && pg.unresolved_effects === 0
    && fresh(pg.observed_at, nowMs),
    'OWN_POSTGRES_ACL_LEASE_OR_ISOLATION_UNQUALIFIED');

  const context = input?.context;
  const contextOk = nonempty(context) && context.schema === 'metaengine.operator.context.v1'
    && context.scope === 'READ_ONLY' && context.storage === 'OWN_POSTGRES_ONLY'
    && context.authority_effect === false && context.scheduler_authority === false
    && context.automatic_retry_allowed === false && context.remote_fallback_allowed === false
    && context.cloud_database_dependency === false
    && context.run_id === runId && context.owner_id === ownerId && context.owner_epoch === ownerEpoch
    && context.event_seq === cursor && context.source_sha === sha
    && DIGEST.test(context.proof_identity ?? '') && fresh(context.generated_at, nowMs)
    && PLANES.every(k => nonempty(context.planes?.[k])
      && context.planes[k].source === SOURCES[k]
      && context.planes[k].state === 'READY' && context.planes[k].proof === 'TRUSTED_READBACK'
      && context.planes[k].fresh === true && fresh(context.planes[k].observed_at, nowMs));
  verdict('context', contextOk, 'CANONICAL_CONTEXT_NOT_FULLY_PROVEN');

  // Derive the only permitted seven-view projection from the actual W6 reducer.
  // A self-reported UI array, trusted flag or source claim cannot substitute for
  // agreement with the one canonical context at the same observation clock.
  const derivedUi = contextOk ? reduceOperatorObservatory(context, { nowMs }) : null;
  const ui = input?.ui;
  const uiOk = nonempty(ui) && ui.schema === 'metaengine.operator.observatory.v1'
    && ui.run_id === runId && ui.event_seq === cursor
    && ui.proof_identity === context?.proof_identity
    && ui.source_sha === sha && ui.owner_epoch === ownerEpoch
    && ui.cursor_state === 'VERIFIED_CURSOR' && ui.state === 'OBSERVED'
    && ui.cursor_state === derivedUi?.cursor_state && ui.state === derivedUi?.state
    && ui.generated_at === derivedUi?.generated_at
    && ui.authority_effect === false && ui.automatic_retry_allowed === false
    && fresh(ui.generated_at, nowMs)
    && nonempty(ui.views) && Object.keys(ui.views).length === VIEWS.length
    && VIEWS.every(v => own(ui.views, v) && Array.isArray(ui.views[v])
      && ui.views[v].length === OBSERVATORY_VIEWS[v].length
      && ui.views[v].every((plane, i) => plane === OBSERVATORY_VIEWS[v][i]))
    && PLANES.every(k => ui.planes?.[k]?.state === derivedUi?.planes?.[k]?.state
      && ui.planes?.[k]?.fresh === derivedUi?.planes?.[k]?.fresh
      && ui.planes?.[k]?.proof === derivedUi?.planes?.[k]?.proof
      && ui.planes?.[k]?.observed_at === derivedUi?.planes?.[k]?.observed_at);
  verdict('ui', uiOk, 'SEVEN_VIEW_CURSOR_SOURCE_OR_HEALTH_DRIFT');

  const bundle = input?.package;
  verdict('package', nonempty(bundle) && bundle.source_sha === sha
    && bundle.artifact_sha256 === artifact
    && DIGEST.test(bundle.source_manifest_sha256 ?? '')
    && bundle.source_manifest_sha256 === bundle.installed_manifest_sha256
    && bundle.installed_exe_sha256 === artifact
    && bundle.native_instance_id === owner?.native_instance_id
    && bundle.package_identity_reserved === false
    && bundle.reproducible_source === true
    && fresh(bundle.observed_at, nowMs),
    'PACKAGE_SOURCE_MANIFEST_OR_INSTALLED_BYTES_DRIFT');

  const ci = input?.ci;
  const workflows = ci?.workflows;
  verdict('ci', nonempty(ci) && ci.source_sha === sha && Array.isArray(workflows)
    && workflows.length >= REQUIRED_CI.length && workflows.length <= 32
    && new Set(workflows.map(w => w?.name)).size === workflows.length
    && REQUIRED_CI.every(name => workflows.some(w => w?.name === name
      && w.source_sha === sha && w.conclusion === 'success' && w.status === 'completed')),
    'EXACT_HEAD_CI_OR_WINDOWS_PACKAGE_GATE_MISSING');

  const promotion = input?.promotion;
  verdict('promotion', nonempty(promotion) && promotion.source_sha === sha
    && promotion.owner_id === ownerId && promotion.owner_epoch === ownerEpoch
    && promotion.state === 'REVIEW_REQUIRED' && promotion.critic_independent === true
    && promotion.authority_effect === false && promotion.executed === false
    && promotion.unknown_effects === 0 && fresh(promotion.observed_at, nowMs),
    'INDEPENDENT_PROMOTION_REVIEW_GATE_UNPROVEN');

  const rollback = input?.rollback;
  verdict('rollback', nonempty(rollback) && rollback.source_sha === baseline
    && rollback.artifact_sha256 === baselineArtifact
    && rollback.owner_id === ownerId && rollback.owner_epoch === ownerEpoch
    && rollback.native_instance_id === owner?.native_instance_id
    && rollback.rehearsal === 'PASS' && rollback.unresolved_effects === 0
    && rollback.executed === false && fresh(rollback.observed_at, nowMs),
    'ROLLBACK_PIN_OR_UNRESOLVED_EFFECTS');

  // Every input above is just source-level data, including "grants_proven",
  // "critic_independent" and "HEALTHY". Never treat booleans, mocked receipts
  // or a successful test as trusted issuer/OS/DB attestation.
  const allShapeConformant = expectedValid && FACETS.every(name => gates[name] === 'SOURCE_CONFORMANT');
  return Object.freeze({
    schema: CROSS_PLANE_CRITIC_SCHEMA,
    state: allShapeConformant ? 'REVIEW_REQUIRED' : 'BLOCKED',
    source_sha: SHA.test(sha ?? '') ? sha.toLowerCase() : null,
    reasons: Object.freeze([...new Set(reasons)]),
    gates: Object.freeze(gates),
    evidence_scope: 'UNTRUSTED_SOURCE_CONFORMANCE_ONLY',
    installed_healthy_proven: false,
    deployment_qualified: false,
    physical_pg17_proven: false,
    promotion_executed: false,
    rollback_executed: false,
    authority_effect: false,
    scheduler_authority: false,
    cloud_fallback_allowed: false,
    automatic_retry_allowed: false,
  });
}
