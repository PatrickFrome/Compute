'use strict';

const path = require('node:path');
const { createCandidateCapsule } = require('./candidate-capsule.cjs');
const { verifyCandidateCapsuleRemoteBound } = require('./candidate-remote-source.cjs');
const { createVerificationSandboxPlan, verifyVerificationSandboxPlan } = require('./verification-sandbox-plan.cjs');
const { verifyEnvelope: verifyAdvisoryEvidenceEnvelope } = require('./advisory-evidence-verifier.cjs');
const { createDevOSRepoReadModel } = require('./devos-repo-read-model.cjs');
const { WorktreeAwareDevOSRepoSearchIndex } = require('./devos-worktree-repo-search.cjs');
const { RepoSourceTracker } = require('./repo-source-tracker.cjs');

const PROTOCOL = 'metaengine.development-plane.v1';
const VERSION = '0.5.0';
const CAPABILITIES = Object.freeze([
  'HEALTH',
  'CAPABILITIES',
  'PROCESS_METRICS',
  'REPO_HEAD_READ',
  'DEVOS_REPO_READ_MODEL',
  'DEVOS_REPO_SEARCH',
  'CANDIDATE_CAPSULE_CREATE',
  'CANDIDATE_CAPSULE_VERIFY',
  'VERIFICATION_SANDBOX_PLAN_CREATE',
  'VERIFICATION_SANDBOX_PLAN_VERIFY',
  'ADVISORY_EVIDENCE_VERIFY',
]);
const repoRoot = path.resolve(process.env.METAENGINE_REPO_ROOT || process.cwd());
const repositoryName = String(process.env.METAENGINE_GIT_REPOSITORY || 'PatrickFrome/Compute');
const repositoryRemote = String(process.env.METAENGINE_GIT_REMOTE || 'origin');
const sourceProvenancePath = path.resolve(process.env.METAENGINE_SOURCE_PROVENANCE || path.join(repoRoot, '.metaengine-source-provenance.json'));
const repoSearchIndex = new WorktreeAwareDevOSRepoSearchIndex({
  repoRoot,
  watch: process.env.METAENGINE_DEVOS_WORKTREE_WATCH !== '0',
});
const repoSourceTracker = new RepoSourceTracker({
  repoRoot,
  repository: repositoryName,
  sourceProvenancePath,
});

function send(message) {
  if (!process.parentPort) throw new Error('development_plane_parent_port_missing');
  process.parentPort.postMessage({ protocol: PROTOCOL, ...message, authority_effect: false });
}

async function readRepoHead() {
  return repoSourceTracker.get();
}

async function requireCurrentSource() {
  const repo = await repoSourceTracker.get();
  if (repo.repository_present !== true || !/^[0-9a-f]{40}$/.test(String(repo.head || '').toLowerCase())) throw new Error('repo_head_unavailable');
  return { repository: repo.repository, head: String(repo.head).toLowerCase(), ref: repo.ref };
}

function verifyRemoteBoundCandidate(capsule, source) {
  return verifyCandidateCapsuleRemoteBound(capsule, source, {
    cwd: repoRoot,
    remote: repositoryRemote,
  });
}

function requireObjectPayload(payload, name) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(`${name}_payload_invalid`);
  return payload;
}

async function execute(capability, payload) {
  if (!CAPABILITIES.includes(capability)) throw new Error('capability_denied');
  if (capability === 'HEALTH') return {
    ok: true,
    pid: process.pid,
    uptime_seconds: process.uptime(),
    process_type: process.type || 'utility',
    repo_source: repoSourceTracker.snapshot(),
    repo_search: repoSearchIndex.snapshot(),
  };
  if (capability === 'CAPABILITIES') return {
    version: VERSION,
    capabilities: [...CAPABILITIES],
    candidate_capsules: true,
    candidate_capsules_executable: false,
    candidate_capsule_remote_source_binding_required: true,
    candidate_capsule_remote_probe: 'GIT_LS_REMOTE_HEADS',
    candidate_capsule_remote_ref_mutation: false,
    verification_sandbox_planning: true,
    verification_sandbox_prepare_only: true,
    verification_sandbox_execution: false,
    sandbox_backend_bound: false,
    advisory_evidence_verification: true,
    advisory_evidence_network_dispatch: false,
    advisory_evidence_browser_authority: false,
    advisory_evidence_promotion_authority: false,
    devos_repo_read_model: true,
    devos_repo_search: true,
    devos_repo_search_cache: 'HEAD_PLUS_WORKTREE_EVENT_EPOCH',
    devos_repo_search_worktree_watcher: true,
    devos_repo_source_cache: 'GIT_EVENT_INVALIDATED',
    devos_repo_search_warm_source_filesystem_reads: 0,
    devos_repo_search_arbitrary_path_selection: false,
    devos_repo_arbitrary_path_read: false,
    direct_promote_current: false,
    arbitrary_eval: false,
    signed_attestation_required_before_promotion: true,
  };
  if (capability === 'PROCESS_METRICS') return { memory: process.memoryUsage(), cpu: process.cpuUsage(), pid: process.pid };
  if (capability === 'REPO_HEAD_READ') return readRepoHead();
  if (capability === 'DEVOS_REPO_READ_MODEL') return createDevOSRepoReadModel({ repoRoot, source: await requireCurrentSource() });
  if (capability === 'DEVOS_REPO_SEARCH') {
    requireObjectPayload(payload, 'devos_repo_search');
    return repoSearchIndex.query(await requireCurrentSource(), payload);
  }
  if (capability === 'CANDIDATE_CAPSULE_CREATE') return createCandidateCapsule(payload, await requireCurrentSource());
  if (capability === 'CANDIDATE_CAPSULE_VERIFY') {
    requireObjectPayload(payload, 'candidate_verify');
    if (!payload.capsule) throw new Error('candidate_verify_payload_invalid');
    const source = await requireCurrentSource();
    return verifyRemoteBoundCandidate(payload.capsule, source);
  }
  if (capability === 'VERIFICATION_SANDBOX_PLAN_CREATE') {
    requireObjectPayload(payload, 'sandbox_plan_create');
    if (!payload.capsule) throw new Error('sandbox_plan_create_payload_invalid');
    const source = await requireCurrentSource();
    const candidateVerification = verifyRemoteBoundCandidate(payload.capsule, source);
    return createVerificationSandboxPlan({
      capsule: payload.capsule,
      candidate_verification: candidateVerification,
      requested_backend: payload.requested_backend ?? null,
      resources: payload.resources ?? null,
    });
  }
  if (capability === 'VERIFICATION_SANDBOX_PLAN_VERIFY') {
    requireObjectPayload(payload, 'sandbox_plan_verify');
    if (!payload.capsule || !payload.plan) throw new Error('sandbox_plan_verify_payload_invalid');
    const source = await requireCurrentSource();
    const candidateVerification = verifyRemoteBoundCandidate(payload.capsule, source);
    return verifyVerificationSandboxPlan(payload.plan, payload.capsule, candidateVerification);
  }
  if (capability === 'ADVISORY_EVIDENCE_VERIFY') {
    requireObjectPayload(payload, 'advisory_evidence_verify');
    if (!payload.envelope) throw new Error('advisory_evidence_verify_payload_invalid');
    return verifyAdvisoryEvidenceEnvelope(payload.envelope);
  }
  throw new Error('capability_denied');
}

if (!process.parentPort) throw new Error('development_plane_parent_port_missing');

process.parentPort.on('message', async (event) => {
  const message = event?.data;
  if (!message || message.protocol !== PROTOCOL) return;
  if (message.type === 'CONTROL' && message.control === 'SHUTDOWN') {
    repoSourceTracker.close();
    repoSearchIndex.close();
    send({ type: 'SHUTDOWN_ACK', version: VERSION });
    setTimeout(() => process.exit(0), 25);
    return;
  }
  if (message.type !== 'REQUEST' || typeof message.request_id !== 'string') return;
  const capability = String(message.capability || '').toUpperCase();
  try {
    const result = await execute(capability, message.payload ?? null);
    send({ type: 'RESPONSE', request_id: message.request_id, ok: true, result });
  } catch (error) {
    send({ type: 'RESPONSE', request_id: message.request_id, ok: false, error: String(error?.message || error).slice(0, 160) });
  }
});

send({ type: 'READY', version: VERSION, capabilities: [...CAPABILITIES] });
