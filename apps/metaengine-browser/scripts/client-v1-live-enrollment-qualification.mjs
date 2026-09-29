import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  SupervisorDeviceIdentity,
  SUPERVISOR_DEVICE_PROFILE,
} from '../src/supervisor-device-identity.mjs';
import {
  NATIVE_SUPERVISOR_BASE,
  NATIVE_SUPERVISOR_RUNTIME_PATH,
} from '../src/native-supervisor-endpoints.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const runId = String(process.env.GITHUB_RUN_ID || process.env.METAENGINE_QUALIFICATION_RUN_ID || '').trim();
const sourceHead = String(process.env.GITHUB_SHA || process.env.METAENGINE_SOURCE_HEAD || '').trim();
const maxWaitMs = Math.max(30_000, Math.min(10 * 60_000, Number(process.env.METAENGINE_APPROVAL_WAIT_MS || 5 * 60_000)));
const pollMs = Math.max(1000, Math.min(10_000, Number(process.env.METAENGINE_APPROVAL_POLL_MS || 2500)));

if (!runId) throw new Error('qualification_run_id_required');
if (!/^[0-9a-f]{40}$/i.test(sourceHead)) throw new Error('qualification_source_head_invalid');

const secureStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(String(value), 'utf8'),
  decryptString: (value) => Buffer.from(value).toString('utf8'),
};

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-client-v1-live-'));
const statePath = path.join(dir, 'device.json');
const identity = new SupervisorDeviceIdentity({ statePath, secureStorage });

async function enrollmentRequest(endpoint, payload) {
  const bodyText = JSON.stringify(payload);
  const headers = await identity.enrollmentHeaders(bodyText);
  return fetch(`${NATIVE_SUPERVISOR_BASE}${endpoint}`, {
    method: 'POST',
    headers,
    body: bodyText,
    cache: 'no-store',
  });
}

async function signedRequest(endpoint, { method = 'POST', payload = null } = {}) {
  const bodyText = method === 'GET' ? '' : JSON.stringify(payload ?? {});
  const canonicalPath = `${NATIVE_SUPERVISOR_RUNTIME_PATH}${endpoint}`;
  const headers = await identity.deviceHeaders(method, canonicalPath, bodyText);
  const init = { method, headers, cache: 'no-store' };
  if (method !== 'GET') init.body = bodyText;
  return fetch(`${NATIVE_SUPERVISOR_BASE}${endpoint}`, init);
}

try {
  const created = await identity.ensure();
  const version = `client-v1-live.${runId}`;
  const requestPayload = {
    profile: SUPERVISOR_DEVICE_PROFILE,
    public_jwk: created.public_jwk,
    key_fingerprint_sha256: created.key_fingerprint_sha256,
    metadata: {
      client_kind: 'METAENGINE_CLIENT_V1_LIVE_QUALIFICATION',
      qualification_run_id: runId,
      source_head: sourceHead,
      shell_version: version,
      authority_effect: false,
    },
  };

  const requestResponse = await enrollmentRequest('/v1/device/enrollment/request', requestPayload);
  const requestBody = await requestResponse.json().catch(() => ({}));
  if (![200, 202].includes(requestResponse.status) || !requestBody?.request_id) {
    throw new Error(`qualification_enrollment_request_http_${requestResponse.status}:${requestBody?.reason || requestBody?.error || 'unknown'}`);
  }
  await identity.bindEnrollmentRequest(requestBody.request_id);

  console.log(JSON.stringify({
    schema: 'metaengine.client-v1.live-qualification.request.v1',
    request_id: requestBody.request_id,
    client_id: created.client_id,
    key_fingerprint_sha256: created.key_fingerprint_sha256,
    qualification_run_id: runId,
    source_head: sourceHead,
    status: requestBody.status || 'PENDING',
    authority_effect: false,
  }));

  const deadline = Date.now() + maxWaitMs;
  let enrolled = null;
  let lastStatus = null;
  while (Date.now() < deadline) {
    const snapshot = identity.snapshot();
    const statusPayload = {
      request_id: snapshot.enrollment_request_id,
      profile: SUPERVISOR_DEVICE_PROFILE,
      public_jwk: snapshot.public_jwk,
      key_fingerprint_sha256: snapshot.key_fingerprint_sha256,
    };
    const response = await enrollmentRequest('/v1/device/enrollment/status', statusPayload);
    const body = await response.json().catch(() => ({}));
    lastStatus = { http_status: response.status, body };
    if (response.status === 200 && body?.accepted === true && body?.device_id) {
      await identity.bindDevice(body.device_id);
      enrolled = identity.snapshot();
      break;
    }
    if (response.status !== 202) {
      throw new Error(`qualification_enrollment_status_http_${response.status}:${body?.reason || body?.error || 'unknown'}`);
    }
    await sleep(pollMs);
  }
  if (!enrolled?.device_id) {
    throw new Error(`qualification_approval_timeout:${JSON.stringify(lastStatus)}`);
  }

  const statePayload = {
    state: {
      shell_version: version,
      supervisor_mode: 'CONTROL',
      armed: true,
      operator_mode: 'CONTROL',
      qualification: {
        schema: 'metaengine.client-v1.live-qualification.v1',
        qualification_run_id: runId,
        source_head: sourceHead,
        authority_effect: false,
      },
    },
    last_command_id: null,
    last_command_status: null,
  };
  const stateResponse = await signedRequest('/v1/state', { payload: statePayload });
  const stateBody = await stateResponse.json().catch(() => ({}));
  if (stateResponse.status !== 202 || stateBody?.accepted !== true) {
    throw new Error(`qualification_signed_state_http_${stateResponse.status}:${stateBody?.reason || stateBody?.error || 'unknown'}`);
  }

  const statusResponse = await signedRequest('/v1/status', { method: 'GET' });
  const statusBody = await statusResponse.json().catch(() => ({}));
  if (statusResponse.status !== 200) {
    throw new Error(`qualification_signed_status_http_${statusResponse.status}:${statusBody?.reason || statusBody?.error || 'unknown'}`);
  }

  const wakeReadyPayload = {
    state: {
      shell_version: version,
      supervisor_mode: 'CONTROL',
      armed: true,
      operator_mode: 'CONTROL',
      qualification: {
        schema: 'metaengine.client-v1.live-qualification.v1',
        qualification_run_id: runId,
        source_head: sourceHead,
        phase: 'WAITING_FOR_POSTGRES_WAKE',
        wake_wait_started_at: new Date().toISOString(),
        authority_effect: false,
      },
    },
    last_command_id: null,
    last_command_status: null,
  };
  const wakeReadyResponse = await signedRequest('/v1/state', { payload: wakeReadyPayload });
  const wakeReadyBody = await wakeReadyResponse.json().catch(() => ({}));
  if (wakeReadyResponse.status !== 202 || wakeReadyBody?.accepted !== true) {
    throw new Error(`qualification_wake_ready_state_http_${wakeReadyResponse.status}`);
  }

  console.log(JSON.stringify({
    schema: 'metaengine.client-v1.live-qualification.command-wait.v1',
    qualification_run_id: runId,
    source_head: sourceHead,
    device_id: enrolled.device_id,
    phase: 'WAITING_FOR_POSTGRES_WAKE',
    authority_effect: false,
  }));

  const waitResponse = await signedRequest('/v1/commands/wait-batch', {
    payload: {
      supervisor_mode: 'CONTROL',
      wait_ms: 15000,
      max_batch: 1,
      max_tab_mutations: 1,
    },
  });
  const waitBody = await waitResponse.json().catch(() => ({}));
  if (waitResponse.status !== 200) {
    throw new Error(`qualification_wait_batch_http_${waitResponse.status}:${waitBody?.error || 'unknown'}`);
  }
  if (waitBody?.wake_reason !== 'POSTGRES_NOTIFY') {
    throw new Error(`qualification_postgres_notify_not_proven:${String(waitBody?.wake_reason || 'NONE')}`);
  }
  const commands = Array.isArray(waitBody?.commands) ? waitBody.commands : [];
  if (commands.length !== 1 || commands[0]?.action !== 'POLL' || !commands[0]?.command_id) {
    throw new Error(`qualification_poll_command_invalid:${JSON.stringify(commands)}`);
  }
  if (waitBody?.transport_delivery_is_authority !== false || waitBody?.authority_effect !== false) {
    throw new Error('qualification_wake_authority_contract_invalid');
  }

  const command = commands[0];
  const receipt = {
    schema: 'metaengine.client-v1.live-qualification.command-receipt.v1',
    command_id: command.command_id,
    qualification_run_id: runId,
    source_head: sourceHead,
    effect_outcome: 'NO_EFFECT_PROVEN',
    authority_effect: false,
  };
  const completeResponse = await signedRequest(`/v1/commands/${encodeURIComponent(command.command_id)}/result`, {
    payload: { ok: true, receipt },
  });
  const completeBody = await completeResponse.json().catch(() => ({}));
  if (completeResponse.status !== 200 || completeBody?.accepted !== true || completeBody?.status !== 'COMPLETED') {
    throw new Error(`qualification_command_complete_http_${completeResponse.status}:${JSON.stringify(completeBody)}`);
  }
  if (completeBody?.authority_effect !== false) throw new Error('qualification_command_completion_authority_invalid');

  const receiptResponse = await signedRequest(`/v1/commands/${encodeURIComponent(command.command_id)}/receipt`, { method: 'GET' });
  const receiptBody = await receiptResponse.json().catch(() => ({}));
  if (
    receiptResponse.status !== 200
    || receiptBody?.found !== true
    || receiptBody?.terminal !== true
    || receiptBody?.status !== 'COMPLETED'
    || receiptBody?.receipt?.command_id !== command.command_id
    || receiptBody?.receipt?.authority_effect !== false
    || receiptBody?.authority_effect !== false
  ) {
    throw new Error(`qualification_receipt_readback_invalid:${JSON.stringify(receiptBody)}`);
  }

  console.log(JSON.stringify({
    schema: 'metaengine.client-v1.live-qualification.result.v2',
    qualification_run_id: runId,
    source_head: sourceHead,
    request_id: requestBody.request_id,
    device_id: enrolled.device_id,
    command_id: command.command_id,
    signed_state_accepted: true,
    signed_status_http: statusResponse.status,
    runtime_control_observed: Boolean(stateBody?.runtime_control),
    postgres_notify_wake_proven: true,
    wake_reason: waitBody.wake_reason,
    receipt_terminal_readback_proven: true,
    authority_effect: false,
  }));
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
