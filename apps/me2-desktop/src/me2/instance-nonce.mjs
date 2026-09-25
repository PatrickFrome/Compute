/**
 * ME2 desktop — single-instance nonce-ACK resurrection protocol (R79 gap
 * closure, legacy parity; TOP-8 must-carry, item 3).
 *
 * Legacy mechanics carried over:
 *   · The FIRST process owns the single-instance lock.
 *   · A SECOND process hands the primary a resurrection payload
 *     { nonce, ts } via requestSingleInstanceLock(additionalData).
 *   · The primary receives it in the `second-instance` event and must VERIFY
 *     the nonce before acknowledging: fresh (TTL), well-formed (hex, length),
 *     and not from the future (clock sanity).
 *   · Verified → journaled ACK + window resurrection. Unverified → the window
 *     still comes up (UX honesty: the operator clicked for a reason), but the
 *     journal keeps the rejection reason — no silent drops.
 *
 * Electron wiring lives in main.mjs; everything here is pure and testable.
 */

export const NONCE = {
  TTL_MS: 10_000, // a second instance launches NOW — 10s is generous
  MIN_HEX_LEN: 16,
  MAX_HEX_LEN: 128,
};

/** Build a resurrection payload (call in the secondary process). */
export function createNonce({ now = Date.now(), randomImpl = Math.random } = {}) {
  const hex = (n) => Math.floor(randomImpl() * 0xffff).toString(16).padStart(4, '0');
  return { nonce: `${hex(0)}${hex(0)}${hex(0)}${hex(0)}`, ts: now };
}

const HEX_RE = /^[0-9a-f]+$/;

/**
 * Pure decision: verify a resurrection payload handed to the primary.
 * Returns { ok, reason } — ok=false never throws; the caller journals it.
 */
export function verifyResurrectionData(data, { now = Date.now(), ttlMs = NONCE.TTL_MS } = {}) {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, reason: 'payload_absent' };
  }
  const { nonce, ts } = data;
  if (typeof nonce !== 'string' || nonce.length < NONCE.MIN_HEX_LEN || nonce.length > NONCE.MAX_HEX_LEN) {
    return { ok: false, reason: 'nonce_malformed' };
  }
  if (!HEX_RE.test(nonce)) return { ok: false, reason: 'nonce_not_hex' };
  if (!Number.isFinite(ts) || typeof ts !== 'number') return { ok: false, reason: 'ts_absent' };
  if (ts > now) return { ok: false, reason: 'ts_in_future' };
  if (now - ts > ttlMs) return { ok: false, reason: 'nonce_expired' };
  return { ok: true, reason: 'verified', ageMs: now - ts };
}

/**
 * Pure decision: what should the SECONDARY do with the lock outcome?
 * (Complements resolveInstanceAction in me2-constants.mjs with payload data.)
 */
export function resolveSecondaryHandoff({ lockAcquired, data }) {
  if (lockAcquired) return { role: 'primary', action: 'boot' };
  return { role: 'secondary', action: 'hand-off', data };
}
