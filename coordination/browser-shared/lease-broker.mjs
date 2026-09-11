import crypto from 'node:crypto';

const LEASE_KINDS = Object.freeze(['ACTION_NAVIGATE', 'ACTION_CLICK', 'ACTION_TYPE', 'ACTION_SUBMIT', 'TARGET_CREATE', 'TARGET_CLOSE']);

export class LeaseBroker {
  constructor({ supervisorKey = '', defaultTtlMs = 60000, clockSkewMs = 5000 } = {}) {
    this.supervisorKey = String(supervisorKey || '');
    this.defaultTtlMs = Number(defaultTtlMs) || 60000;
    this.clockSkewMs = Math.max(0, Number(clockSkewMs) || 5000);
  }

  issue({ leaseId = crypto.randomUUID(), resourceId, actorId = 'supervisor', kind, targetId, profileId, contextId, ttlMs = this.defaultTtlMs, extra = {} } = {}) {
    if (!resourceId || typeof resourceId !== 'string') throw new Error('lease_resource_id_required');
    if (!LEASE_KINDS.includes(String(kind || '').toUpperCase())) throw new Error('lease_kind_invalid');
    const notAfter = new Date(Date.now() + Number(ttlMs)).toISOString();
    const lease = {
      lease_id: leaseId,
      resource_id: resourceId,
      actor_id: String(actorId || 'supervisor').slice(0, 120),
      not_after: notAfter,
      kind: String(kind || '').toUpperCase(),
      target_id: targetId ? String(targetId).trim() : null,
      profile_id: profileId ? String(profileId).trim() : null,
      context_id: contextId ? String(contextId).trim() : null,
      issued_at: new Date().toISOString(),
      ...extra
    };
    lease.hmac = this._sign(lease);
    return lease;
  }

  verify(lease) {
    if (!lease || typeof lease !== 'object' || Array.isArray(lease)) return { ok: false, reason: 'lease_required' };
    const { lease_id, resource_id, actor_id, not_after, hmac, kind } = lease;
    if (!lease_id || typeof lease_id !== 'string') return { ok: false, reason: 'lease_id_required' };
    if (!resource_id || typeof resource_id !== 'string') return { ok: false, reason: 'lease_resource_id_required' };
    if (!actor_id || typeof actor_id !== 'string') return { ok: false, reason: 'lease_actor_id_required' };
    if (!not_after || typeof not_after !== 'string') return { ok: false, reason: 'lease_not_after_required' };
    if (!hmac || typeof hmac !== 'string') return { ok: false, reason: 'lease_hmac_required' };
    if (!LEASE_KINDS.includes(String(kind || '').toUpperCase())) return { ok: false, reason: 'lease_kind_invalid' };

    const expiry = new Date(not_after).getTime();
    const now = Date.now();
    if (Number.isNaN(expiry)) return { ok: false, reason: 'lease_not_after_invalid' };
    if (now > expiry + this.clockSkewMs) return { ok: false, reason: 'lease_expired' };

    const expected = this._sign(lease);
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hmac))) return { ok: false, reason: 'lease_hmac_mismatch' };

    return { ok: true, lease };
  }

  _sign(lease) {
    const data = `${lease.lease_id}|${lease.resource_id}|${lease.actor_id}|${lease.not_after}|${lease.kind}|${lease.target_id || ''}|${lease.profile_id || ''}|${lease.context_id || ''}`;
    return crypto.createHmac('sha256', this.supervisorKey).update(data).digest('hex');
  }
}

export { LEASE_KINDS };
