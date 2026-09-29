import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { normalizeClientGoalActivationReadback } from '../src/client-control-contract.mjs';

const PROFILE = 'A2_DEVICE_HTTP_SIGNATURE_V1';
const CANONICAL_SERVICE = '/a2-browser-native-supervisor-v1';
const base = String(process.env.METAENGINE_CLIENT_V1_CANARY_BASE || '').replace(/\/+$/, '');
const sourceHead = String(process.env.METAENGINE_CLIENT_V1_SOURCE_HEAD || '').trim().toLowerCase();
const runId = String(process.env.GITHUB_RUN_ID || '').trim();
const runAttempt = String(process.env.GITHUB_RUN_ATTEMPT || '').trim();
const evidencePath = String(process.env.METAENGINE_CLIENT_V1_CANARY_EVIDENCE || '').trim();
const timeoutMs = Math.max(60_000, Math.min(900_000, Number(process.env.METAENGINE_CLIENT_V1_APPROVAL_TIMEOUT_MS || 600_000)));

assert.match(base, /^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/a2-browser-native-supervisor-v14-canary$/);
assert.match(sourceHead, /^[0-9a-f]{40}$/);
assert.match(runId, /^[0-9]{1,20}$/);
assert.match(runAttempt, /^[1-9][0-9]{0,5}$/);

const clientId = `client-v1-canary-${sourceHead.slice(0, 12)}-${runId}-${runAttempt}`;
const enc = new TextEncoder();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hexSha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const nonce = () => crypto.randomBytes(24).toString('base64url');
const b64url = (value) => Buffer.from(value).toString('base64url');

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

const objective = `C4 signed canary qualification ${runId} attempt ${runAttempt}`;
const goal = await devicePost('/v1/meta/objective', {
  roadmap_id: 'metaengine-client-v1',
  objective,
}, deviceId);
if (goal.response.status !== 200) {
  throw new Error(`canary_goal_http_${goal.response.status}:${JSON.stringify(goal.body)}`);
}
const out = goal.body;
// Exercise the exact installed-client validator against the real signed Edge
// response; a separate shallow assertion set must never qualify a weaker contract.
const clientReadback = normalizeClientGoalActivationReadback(out, objective);
assert.equal(out?.schema, 'metaengine.meta-orchestrator.objective-activation.v1');
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

const evidence = {
  schema: 'metaengine.client-v1.signed-canary-goal-evidence.v1',
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
  client_readback_validated: true,
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
if (evidencePath) await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(evidence));
