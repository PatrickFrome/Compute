(() => {
  'use strict';

  async function sha256Bytes(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function signLease(lease, supervisorKey) {
    const data = `${lease.lease_id}|${lease.resource_id}|${lease.actor_id}|${lease.not_after}|${lease.kind}|${lease.target_id || ''}|${lease.profile_id || ''}|${lease.context_id || ''}`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(supervisorKey);
    const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
    return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function verifyLease(lease, supervisorKey) {
    if (!lease || typeof lease !== 'object' || Array.isArray(lease)) return { ok: false, reason: 'lease_required' };
    const { lease_id, resource_id, actor_id, not_after, hmac, kind } = lease;

    if (!lease_id || typeof lease_id !== 'string') return { ok: false, reason: 'lease_id_required' };
    if (!resource_id || typeof resource_id !== 'string') return { ok: false, reason: 'lease_resource_id_required' };
    if (!actor_id || typeof actor_id !== 'string') return { ok: false, reason: 'lease_actor_id_required' };
    if (!not_after || typeof not_after !== 'string') return { ok: false, reason: 'lease_not_after_required' };
    if (!hmac || typeof hmac !== 'string') return { ok: false, reason: 'lease_hmac_required' };
    if (!kind || typeof kind !== 'string') return { ok: false, reason: 'lease_kind_required' };

    const expiry = new Date(not_after).getTime();
    const now = Date.now();
    if (Number.isNaN(expiry)) return { ok: false, reason: 'lease_not_after_invalid' };
    if (now > expiry) return { ok: false, reason: 'lease_expired' };

    if (!supervisorKey) return { ok: false, reason: 'lease_supervisor_key_required' };

    const expected = await signLease(lease, supervisorKey);
    if (expected !== hmac) return { ok: false, reason: 'lease_hmac_mismatch' };

    return { ok: true, lease };
  }

  async function validateActionLease(lease, supervisorKey, targetId) {
    const leaseResult = await verifyLease(lease, supervisorKey);
    if (!leaseResult.ok) return leaseResult;
    if (leaseResult.lease.resource_id !== targetId) return { ok: false, reason: 'lease_resource_mismatch' };
    return { ok: true, lease: leaseResult.lease };
  }

  globalThis.A2_OPERATOR_LEASE_GATE = {
    verifyLease,
    validateActionLease,
    signLease
  };
})();
