import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {
  normalizeClientGoalExecutionProofReadback,
  normalizeClientGoalProgressReadback,
  normalizeClientGoalSubmissionReadback,
} from '../src/client-control-contract.mjs';

const PROFILE = 'A2_DEVICE_HTTP_SIGNATURE_V1';
const CANONICAL_SERVICE = '/a2-browser-native-supervisor-v1';
const base = String(process.env.METAENGINE_CLIENT_V1_CANARY_BASE || '').replace(/\/+$/, '');
const sourceHead = String(process.env.METAENGINE_CLIENT_V1_SOURCE_HEAD || '').trim().toLowerCase();
const executionOrigin = String(process.env.METAENGINE_CLIENT_V1_QUALIFICATION_ORIGIN || 'GITHUB_ACTIONS');
assert.ok(['GITHUB_ACTIONS', 'LOCAL'].includes(executionOrigin));
const runId = String(executionOrigin === 'LOCAL'
  ? process.env.METAENGINE_CLIENT_V1_LOCAL_RUN_ID || ''
  : process.env.GITHUB_RUN_ID || '').trim();
const runAttempt = executionOrigin === 'LOCAL' ? '1' : String(process.env.GITHUB_RUN_ATTEMPT || '').trim();
const evidencePath = String(process.env.METAENGINE_CLIENT_V1_CANARY_EVIDENCE || '').trim();
const timeoutMs = Math.max(60_000, Math.min(900_000, Number(process.env.METAENGINE_CLIENT_V1_APPROVAL_TIMEOUT_MS || 600_000)));
const requirePhysicalAgent = String(process.env.METAENGINE_CLIENT_V1_REQUIRE_PHYSICAL_AGENT || '').trim() === '1';
const agentProofTimeoutMs = requirePhysicalAgent
  ? Math.max(30_000, Math.min(900_000, Number(process.env.METAENGINE_CLIENT_V1_AGENT_PROOF_TIMEOUT_MS || 480_000)))
  : 0;
const agentProofPollMs = Math.max(1_000, Math.min(10_000, Number(process.env.METAENGINE_CLIENT_V1_AGENT_PROOF_POLL_MS || 2_000)));

assert.match(base, /^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/a2-browser-native-supervisor-v14-canary$/);
assert.match(sourceHead, /^[0-9a-f]{40}$/);
assert.match(runId, /^[0-9]{1,20}$/);
assert.match(runAttempt, /^[1-9][0-9]{0,5}$/);

const clientId = `client-v1-${executionOrigin === 'LOCAL' ? 'local' : 'canary'}-${sourceHead.slice(0, 12)}-${runId}-${runAttempt}`;
const enc = new TextEncoder();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hexSha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const nonce = () => crypto.randomBytes(24).toString('base64url');
const b64url = (value) => Buffer.from(value).toString('base64url');
async function writeEvidence(value) {
  if (evidencePath) await fs.writeFile(evidencePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

const { privateKey, publicKey } = await crypto.webcrypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);
const exported = await crypto.webcrypto.subtle.exportKey('jwk', publicKey);
const publicJwk = {
  crv: String(exported.crv || ''),
  ext: exported.ext === true,
  key_ops: ['verify'],
  kty: String(exported.kty || ''),
  x: String(exported.x || ''),
  y: String(exported.y || ''),
};
assert.equal(publicJwk.kty, 'EC');
assert.equal(publicJwk.crv, 'P-256');
assert.match(publicJwk.x, /^[A-Za-z0-9_-]{43}$/);
assert.match(publicJwk.y, /^[A-Za-z0-9_-]{43}$/);
const fingerprint = hexSha256(JSON.stringify(publicJwk));

async function sign(material) {
  const raw = await crypto.webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    enc.encode(material),
  );
  const signature = b64url(raw);
  assert.match(signature, /^[A-Za-z0-9_-]{80,128}$/);
  return signature;
}

async function enrollmentPost(path, payload) {
  const bodyText = JSON.stringify(payload);
  const timestamp = new Date().toISOString();
  const oneNonce = nonce();
  const bodySha = hexSha256(bodyText);
  const material = [
    'METAENGINE_NATIVE_ENROLLMENT_V1',
    `client_id:${clientId}`,
    `profile:${PROFILE}`,
    `fingerprint:${fingerprint}`,
    `timestamp:${timestamp}`,
    `nonce:${oneNonce}`,
    `body_sha256:${bodySha}`,
  ].join('\n');
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2-chat-bridge-client': clientId,
      'x-metaengine-enroll-timestamp': timestamp,
      'x-metaengine-enroll-nonce': oneNonce,
      'x-metaengine-enroll-signature': await sign(material),
    },
    body: bodyText,
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function devicePost(path, payload, deviceId) {
  const bodyText = JSON.stringify(payload);
  const timestamp = new Date().toISOString();
  const oneNonce = nonce();
  const bodySha = hexSha256(bodyText);
  const canonicalPath = `${CANONICAL_SERVICE}${path}`;
  const material = [
    PROFILE,
    `device_id:${deviceId}`,
    'method:POST',
    `path:${canonicalPath}`,
    `timestamp:${timestamp}`,
    `nonce:${oneNonce}`,
    `body_sha256:${bodySha}`,
  ].join('\n');
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2-chat-bridge-client': clientId,
      'x-a2-device-profile': PROFILE,
      'x-a2-device-id': deviceId,
      'x-a2-device-timestamp': timestamp,
      'x-a2-device-nonce': oneNonce,
      'x-a2-device-body-sha256': bodySha,
      'x-a2-device-signature': await sign(material),
    },
    body: bodyText,
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function deviceGet(path, deviceId) {
  const bodyText = '';
  const timestamp = new Date().toISOString();
  const oneNonce = nonce();
  const bodySha = hexSha256(bodyText);
  const canonicalPath = `${CANONICAL_SERVICE}${path}`;
  const material = [
    PROFILE,
    `device_id:${deviceId}`,
    'method:GET',
    `path:${canonicalPath}`,
    `timestamp:${timestamp}`,
    `nonce:${oneNonce}`,
    `body_sha256:${bodySha}`,
  ].join('\n');
  const response = await fetch(`${base}${path}`, {
    method: 'GET',
    headers: {
      'x-a2-chat-bridge-client': clientId,
      'x-a2-device-profile': PROFILE,
      'x-a2-device-id': deviceId,
      'x-a2-device-timestamp': timestamp,
      'x-a2-device-nonce': oneNonce,
      'x-a2-device-body-sha256': bodySha,
      'x-a2-device-signature': await sign(material),
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

const requestPayload = {
  profile: PROFILE,
  public_jwk: publicJwk,
  key_fingerprint_sha256: fingerprint,
  metadata: {
    shell_version: `c4-canary.${runId}.${runAttempt}`.slice(0, 32),
  },
};
const requested = await enrollmentPost('/v1/device/enrollment/request', requestPayload);
if (![200, 202].includes(requested.response.status) || !requested.body?.request_id) {
  throw new Error(`canary_enrollment_request_failed:${requested.response.status}:${JSON.stringify(requested.body)}`);
}
const requestId = String(requested.body.request_id);
console.log(JSON.stringify({
  schema: 'metaengine.client-v1.signed-canary.enrollment-request.v1',
  execution_origin: executionOrigin,
  source_head: sourceHead,
  run_id: runId,
  run_attempt: runAttempt,
  client_id: clientId,
  request_id: requestId,
  fingerprint_sha256: fingerprint,
  approval_required: requested.body.status !== 'APPROVED',
  authority_effect: false,
}));

const started = Date.now();
let deviceId = null;
while (Date.now() - started < timeoutMs) {
  const status = await enrollmentPost('/v1/device/enrollment/status', {
    request_id: requestId,
    profile: PROFILE,
    public_jwk: publicJwk,
    key_fingerprint_sha256: fingerprint,
  });
  if (status.response.status === 200 && status.body?.accepted === true && status.body?.device_id) {
    deviceId = String(status.body.device_id);
    break;
  }
  if (status.response.status === 202) {
    await sleep(2_000);
    continue;
  }
  throw new Error(`canary_enrollment_status_failed:${status.response.status}:${JSON.stringify(status.body)}`);
}
if (!deviceId) throw new Error('canary_enrollment_approval_timeout');

const adminResponse = await deviceGet('/v1/admin/status', deviceId);
if (adminResponse.response.status !== 200) {
  throw new Error(`canary_admin_status_http_${adminResponse.response.status}:${JSON.stringify(adminResponse.body)}`);
}
const adminStatus = adminResponse.body;
assert.equal(adminStatus?.schema, 'metaengine.client-v1.admin-connection.v1');
assert.equal(adminStatus?.connected, true);
assert.equal(adminStatus?.admin_ready, true);
assert.equal(adminStatus?.access_tier, 'ADMIN');
assert.equal(adminStatus?.backend_transport, 'POSTGREST_RPC');
assert.equal(adminStatus?.direct_postgres_query_plane, false);
assert.equal(adminStatus?.master_secret_embedded, false);
assert.equal(adminStatus?.service_role_embedded, false);
assert.equal(adminStatus?.cloudflare_token_embedded, false);
assert.equal(adminStatus?.automatic_effect_retry_allowed, false);
assert.equal(adminStatus?.authority_effect, false);
assert.ok(Array.isArray(adminStatus?.admin_scopes));
assert.ok(adminStatus.admin_scopes.includes('CONTROL_PLANE'));
assert.ok(adminStatus.admin_scopes.includes('DEVOS'));
assert.ok(adminStatus.admin_scopes.includes('FLEET'));

let physicalPreflight = null;
if (requirePhysicalAgent) {
  const environmentResponse = await devicePost('/v1/devos/environment-state', {}, deviceId);
  const inputsResponse = await devicePost('/v1/meta/authoritative-inputs', {
    roadmap_id: 'metaengine-client-v1',
  }, deviceId);

  physicalPreflight = {
    schema: 'metaengine.client-v1.c4-physical-preflight.v1',
    environment_http_status: environmentResponse.response.status,
    environment_state: environmentResponse.body?.state || null,
    continuous_service_allowed: environmentResponse.body?.continuous_service_allowed === true,
    generation_floor: Number.isSafeInteger(Number(environmentResponse.body?.generation_floor))
      ? Number(environmentResponse.body.generation_floor)
      : null,
    capacity_http_status: inputsResponse.response.status,
    capacity_state: inputsResponse.body?.capacity?.state || null,
    capacity_source: inputsResponse.body?.capacity?.source || null,
    available_slots: Number(inputsResponse.body?.capacity?.available_slots || 0),
    authority_effect: false,
  };

  if (
    environmentResponse.response.status !== 200
    || environmentResponse.body?.continuous_service_allowed !== true
    || inputsResponse.response.status !== 200
    || inputsResponse.body?.capacity?.source !== 'DEVOS_SCHEDULER_SNAPSHOT'
    || inputsResponse.body?.capacity?.state !== 'FRESH'
    || !Number.isSafeInteger(Number(inputsResponse.body?.capacity?.available_slots))
    || Number(inputsResponse.body.capacity.available_slots) < 1
  ) {
    const evidence = {
      schema: 'metaengine.client-v1.c4-physical-qualification-evidence.v1',
      execution_origin: executionOrigin,
      source_head: sourceHead,
      run_id: runId,
      run_attempt: runAttempt,
      client_id: clientId,
      enrollment_request_id: requestId,
      device_id: deviceId,
      admin_status_validated: true,
      admin_grant_epoch: Number(adminStatus.admin_grant_epoch),
      backend_transport: adminStatus.backend_transport,
      state: 'PHYSICAL_PREREQUISITES_NOT_READY',
      preflight: physicalPreflight,
      goal_submitted: false,
      user_goal_to_agent_readback: false,
      user_goal_to_result_readback: false,
      automatic_retry_allowed: false,
      scheduler_authority: false,
      browser_authority: false,
      release_authority: false,
      authority_effect: false,
      observed_at: new Date().toISOString(),
    };
    await writeEvidence(evidence);
    throw new Error(`c4_physical_prerequisites_not_ready:${JSON.stringify(physicalPreflight)}`);
  }
}

const objective = `C4 signed canary qualification ${runId} attempt ${runAttempt}`;
const goalRequestId = crypto.randomUUID().toLowerCase();
const goal = await devicePost('/v1/meta/client-goal-submit', {
  request_id: goalRequestId,
  objective,
}, deviceId);
if (goal.response.status !== 200) {
  throw new Error(`canary_goal_http_${goal.response.status}:${JSON.stringify(goal.body)}`);
}
const out = goal.body;
// Exercise the exact installed-client validator against the real signed Edge
// response; a separate shallow assertion set must never qualify a weaker contract.
const clientReadback = normalizeClientGoalSubmissionReadback(out, objective, goalRequestId);
assert.equal(out?.schema, 'metaengine.meta-orchestrator.objective-activation.v1');
assert.equal(out?.request_id, goalRequestId);
assert.equal(out?.exact_request_correlation, true);
assert.equal(out?.roadmap_id, 'metaengine-client-v1');
assert.equal(out?.objective, objective);
assert.equal(out?.node_count, 1);
assert.equal(out?.task_admission_state, 'ADMITTED');
assert.equal(out?.atomic_plan_and_admission, true);
assert.equal(out?.operator_initiated, true);
assert.equal(out?.automatic_retry_allowed, false);
assert.equal(out?.scheduler_authority, false);
assert.equal(out?.browser_authority, false);
assert.equal(out?.release_authority, false);
assert.equal(out?.authority_effect, false);
assert.equal(Array.isArray(out?.point_ids), true);
assert.equal(Array.isArray(out?.task_ids), true);
assert.equal(out.point_ids.length, 1);
assert.equal(out.task_ids.length, 1);
assert.match(String(out.task_ids[0]), /^[0-9a-f-]{36}$/i);
assert.equal(String(out?.admission?.task_id || '').toLowerCase(), String(out.task_ids[0]).toLowerCase());
assert.equal(String(out?.admission?.point_id || '').toLowerCase(), String(out.point_ids[0]).toLowerCase());
assert.equal(out?.admission?.authority_effect, false);

const progressResponse = await devicePost('/v1/meta/client-goal-progress', {
  request_id: goalRequestId,
}, deviceId);
if (progressResponse.response.status !== 200) {
  throw new Error(`canary_goal_progress_http_${progressResponse.response.status}:${JSON.stringify(progressResponse.body)}`);
}
let progress = normalizeClientGoalProgressReadback(progressResponse.body, goalRequestId, clientReadback);
assert.equal(progress.found, true);
assert.equal(progress.request_id, goalRequestId);
assert.equal(progress.task_id, clientReadback.task_id);
assert.equal(progress.plan_generation, clientReadback.plan_generation);
assert.equal(progress.automatic_retry_allowed, false);
assert.equal(progress.authority_effect, false);

const executionProofResponse = await devicePost('/v1/meta/client-goal-execution-proof', {
  request_id: goalRequestId,
}, deviceId);
if (executionProofResponse.response.status !== 200) {
  throw new Error(`canary_goal_execution_proof_http_${executionProofResponse.response.status}:${JSON.stringify(executionProofResponse.body)}`);
}
let executionProof = normalizeClientGoalExecutionProofReadback(
  executionProofResponse.body,
  goalRequestId,
  clientReadback,
);
assert.equal(executionProof.found, true);
assert.equal(executionProof.request_id, goalRequestId);
assert.equal(executionProof.task_id, clientReadback.task_id);
assert.equal(executionProof.plan_generation, clientReadback.plan_generation);
assert.equal(executionProof.automatic_retry_allowed, false);
assert.equal(executionProof.scheduler_authority, false);
assert.equal(executionProof.browser_actuation_authority, false);
assert.equal(executionProof.release_authority, false);
assert.equal(executionProof.authority_effect, false);

if (requirePhysicalAgent) {
  const proofDeadline = Date.now() + agentProofTimeoutMs;
  while (executionProof.user_goal_to_agent_readback !== true && Date.now() < proofDeadline) {
    if (progress.terminal === true) break;
    await sleep(agentProofPollMs);

    const nextProgressResponse = await devicePost('/v1/meta/client-goal-progress', {
      request_id: goalRequestId,
    }, deviceId);
    if (nextProgressResponse.response.status !== 200) {
      throw new Error(`c4_physical_progress_http_${nextProgressResponse.response.status}:${JSON.stringify(nextProgressResponse.body)}`);
    }
    progress = normalizeClientGoalProgressReadback(nextProgressResponse.body, goalRequestId, clientReadback);

    const nextProofResponse = await devicePost('/v1/meta/client-goal-execution-proof', {
      request_id: goalRequestId,
    }, deviceId);
    if (nextProofResponse.response.status !== 200) {
      throw new Error(`c4_physical_execution_proof_http_${nextProofResponse.response.status}:${JSON.stringify(nextProofResponse.body)}`);
    }
    executionProof = normalizeClientGoalExecutionProofReadback(
      nextProofResponse.body,
      goalRequestId,
      clientReadback,
    );
  }

  if (executionProof.user_goal_to_agent_readback !== true) {
    const evidence = {
      schema: 'metaengine.client-v1.c4-physical-qualification-evidence.v1',
      execution_origin: executionOrigin,
      source_head: sourceHead,
      run_id: runId,
      run_attempt: runAttempt,
      client_id: clientId,
      enrollment_request_id: requestId,
      device_id: deviceId,
      state: progress.terminal === true ? 'TERMINAL_WITHOUT_AGENT_PROOF' : 'AGENT_PROOF_TIMEOUT',
      preflight: physicalPreflight,
      goal_submitted: true,
      goal_request_id: goalRequestId,
      task_id: clientReadback.task_id,
      task_state: progress.task_state,
      terminal: progress.terminal,
      user_goal_to_agent_readback: false,
      user_goal_to_result_readback: executionProof.user_goal_to_result_readback,
      automatic_retry_allowed: false,
      physical_effect_replayed: false,
      scheduler_authority: false,
      browser_authority: false,
      release_authority: false,
      authority_effect: false,
      observed_at: new Date().toISOString(),
    };
    await writeEvidence(evidence);
    throw new Error(`c4_physical_agent_proof_not_observed:${evidence.state}`);
  }
}

const evidence = {
  schema: 'metaengine.client-v1.signed-canary-goal-evidence.v1',
  execution_origin: executionOrigin,
  source_head: sourceHead,
  run_id: runId,
  run_attempt: runAttempt,
  canary_base: base,
  client_id: clientId,
  enrollment_request_id: requestId,
  device_id: deviceId,
  fingerprint_sha256: fingerprint,
  workspace_id: clientReadback.workspace_id,
  alignment_epoch: clientReadback.alignment_epoch,
  baseline_sha: clientReadback.baseline_sha,
  plan_sha256: clientReadback.plan_sha256,
  task_spec_sha256: clientReadback.task_spec_sha256,
  admin_status_validated: true,
  admin_grant_epoch: Number(adminStatus.admin_grant_epoch),
  admin_scopes: adminStatus.admin_scopes,
  backend_transport: adminStatus.backend_transport,
  direct_postgres_query_plane: adminStatus.direct_postgres_query_plane,
  client_readback_validated: true,
  goal_request_id: goalRequestId,
  progress_readback_validated: true,
  progress_task_state: progress.task_state,
  progress_terminal: progress.terminal,
  execution_proof_validated: true,
  physical_agent_required: requirePhysicalAgent,
  physical_preflight: physicalPreflight,
  user_goal_to_agent_readback: executionProof.user_goal_to_agent_readback,
  user_goal_to_result_readback: executionProof.user_goal_to_result_readback,
  agent_origin_contract: executionProof.agent_origin_proof?.contract || null,
  agent_origin_conversation_url_sha256: executionProof.agent_origin_proof?.conversation_url_sha256 || null,
  result_claim_sha256: executionProof.result_proof?.claim_sha256 || null,
  result_origin_bound: executionProof.result_proof?.origin_bound || false,
  roadmap_id: out.roadmap_id,
  plan_generation: out.plan_generation,
  point_id: out.point_ids[0],
  task_id: out.task_ids[0],
  task_admission_state: out.task_admission_state,
  atomic_plan_and_admission: out.atomic_plan_and_admission,
  operator_initiated: out.operator_initiated,
  automatic_retry_allowed: false,
  scheduler_authority: false,
  browser_authority: false,
  release_authority: false,
  authority_effect: false,
  completed_at: new Date().toISOString(),
};
await writeEvidence(evidence);
console.log(JSON.stringify(evidence));
