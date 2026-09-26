
async function callGateway(env, action, body = {}) {
  if (typeof env.SUPABASE_WORKER_GATEWAY_URL !== 'string' || !env.SUPABASE_WORKER_GATEWAY_URL.startsWith('https://')) {
    throw new Error('SUPABASE_WORKER_GATEWAY_URL invalid');
  }
  if (typeof env.WORKER_CAPABILITY !== 'string' || env.WORKER_CAPABILITY.length < 32) {
    throw new Error('WORKER_CAPABILITY missing');
  }
  const response = await fetch(env.SUPABASE_WORKER_GATEWAY_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-metaengine-worker-capability': env.WORKER_CAPABILITY,
    },
    body: JSON.stringify({ action, ...body }),
  });
  const payload = await response.json();
  if (!response.ok || payload?.error) {
    throw new Error(`worker gateway ${action} failed: ${payload?.message ?? payload?.error ?? response.status}`);
  }
  return payload?.result;
}

export async function pullDispatch(env, slotId) {
  return await callGateway(env, 'PULL', { slot_id: slotId, qty: 1 });
}

export async function heartbeat(env, runId, extendSeconds = 900) {
  return await callGateway(env, 'HEARTBEAT', { run_id: runId, extend_seconds: extendSeconds });
}

export async function runtimeFail(env, runId, error, requeue = true) {
  return await callGateway(env, 'FAIL', { run_id: runId, error: String(error).slice(0, 2000), requeue });
}

export async function publishEvent(env, runId, eventKind, payload, parentEventHash = null) {
  const receipt = await callGateway(env, 'PUBLISH', {
    run_id: runId,
    event_kind: eventKind,
    payload,
    parent_event_hash: parentEventHash,
  });
  return validatePublishReceipt(receipt);
}

export async function workerStatus(env) {
  return await callGateway(env, 'STATUS');
}

export function validatePublishReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('publish receipt invalid');
  const status = receipt.status;
  if (status === 'DIGEST_CONFLICT') throw new Error('worker gateway PUBLISH failed: DIGEST_CONFLICT');
  if (!['ACCEPTED','IDEMPOTENT_REPLAY'].includes(status)) throw new Error(`worker gateway PUBLISH unexpected status: ${String(status)}`);
  return receipt;
}
