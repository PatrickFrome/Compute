import crypto from 'node:crypto';

const ACTION_KINDS = Object.freeze(['NAVIGATE', 'CLICK', 'TYPE', 'SUBMIT']);

export { ACTION_KINDS };

export function validateActionIntent(intent) {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return { ok: false, reason: 'action_intent_required' };
  const { action_id, target_id, profile_id, context_id, lease, kind, locator, payload, requested_at } = intent;

  if (!action_id || typeof action_id !== 'string') return { ok: false, reason: 'action_id_required' };
  if (!target_id || typeof target_id !== 'string') return { ok: false, reason: 'target_id_required' };
  if (!profile_id || typeof profile_id !== 'string') return { ok: false, reason: 'profile_id_required' };
  if (!context_id || typeof context_id !== 'string') return { ok: false, reason: 'context_id_required' };

  const leaseCheck = validateLeaseEnvelope(lease);
  if (!leaseCheck.ok) return leaseCheck;

  if (lease.resource_id !== target_id) return { ok: false, reason: 'lease_resource_mismatch' };

  if (!ACTION_KINDS.includes(kind)) return { ok: false, reason: 'action_kind_invalid' };

  if (kind !== 'NAVIGATE') {
    if (!locator || typeof locator !== 'object' || Array.isArray(locator)) return { ok: false, reason: 'locator_required' };
    if (!locator.semantic_id || typeof locator.semantic_id !== 'string') return { ok: false, reason: 'semantic_id_required' };
    if (!Array.isArray(locator.frame_path)) return { ok: false, reason: 'frame_path_required' };
  }

  if (kind === 'NAVIGATE') {
    if (!payload || typeof payload !== 'object' || !payload.url || typeof payload.url !== 'string') {
      return { ok: false, reason: 'navigate_url_required' };
    }
  }

  if (kind === 'TYPE') {
    if (!payload || typeof payload !== 'object' || typeof payload.text !== 'string') {
      return { ok: false, reason: 'type_text_required' };
    }
  }

  return {
    ok: true,
    action: {
      action_id,
      target_id,
      profile_id,
      context_id,
      lease,
      kind,
      locator: locator || null,
      payload: payload || null,
      requested_at: requested_at || new Date().toISOString()
    }
  };
}

export function validateLeaseEnvelope(lease) {
  if (!lease || typeof lease !== 'object' || Array.isArray(lease)) return { ok: false, reason: 'lease_required' };
  const { lease_id, resource_id, actor_id, not_after, hmac } = lease;

  if (!lease_id || typeof lease_id !== 'string') return { ok: false, reason: 'lease_id_required' };
  if (!resource_id || typeof resource_id !== 'string') return { ok: false, reason: 'lease_resource_id_required' };
  if (!actor_id || typeof actor_id !== 'string') return { ok: false, reason: 'lease_actor_id_required' };
  if (!not_after || typeof not_after !== 'string') return { ok: false, reason: 'lease_not_after_required' };
  if (!hmac || typeof hmac !== 'string') return { ok: false, reason: 'lease_hmac_required' };

  const expiry = new Date(not_after).getTime();
  if (Number.isNaN(expiry)) return { ok: false, reason: 'lease_not_after_invalid' };
  if (Date.now() > expiry) return { ok: false, reason: 'lease_expired' };

  return { ok: true, lease };
}

export function canonicalActionBytes(intent) {
  const { action_id, target_id, profile_id, context_id, kind, locator, payload, requested_at } = intent;
  const canonical = {
    action_id,
    target_id,
    profile_id,
    context_id,
    kind,
    locator: locator ? { semantic_id: locator.semantic_id, frame_path: locator.frame_path } : null,
    payload: payload || null,
    requested_at: requested_at || ''
  };
  return new TextEncoder().encode(JSON.stringify(canonical));
}

export function compileActionEnvelope({ target_id, lease, kind, locator, payload } = {}) {
  const action_id = crypto.randomUUID();
  const now = new Date().toISOString();
  return {
    action_id,
    target_id: String(target_id || '').trim(),
    profile_id: '',
    context_id: '',
    lease,
    kind: String(kind || '').toUpperCase(),
    locator: locator || null,
    payload: payload || null,
    requested_at: now
  };
}
