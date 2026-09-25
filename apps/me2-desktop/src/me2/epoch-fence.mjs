/**
 * ME2 desktop — daemon epoch fence + keepalive (R79 gap closure, legacy parity).
 *
 * Legacy mechanics carried over (TOP-8 must-carry, item 7):
 *   · The client remembers the daemon BOOT EPOCH (its boot timestamp from /health).
 *   · If a later keepalive probe reports a DIFFERENT epoch, the daemon restarted
 *     behind our back → every session/handshake assumption is stale → the client
 *     must re-adopt (fresh /state handshake) and journal the fence breach.
 *   · Keepalive probes back off exponentially while the daemon is silent, but
 *     never give up (adopt-or-spawn already caps storms at bring-up time).
 *
 * Pure decisions live here; the plane only wires timers and journals verdicts.
 */

/** Keepalive policy (R79). */
export const KEEPALIVE = {
  BASE_MS: 15_000, // healthy cadence
  MAX_MS: 120_000, // silence cap — 2 min between probes at worst
};

/**
 * Pure decision: compare a known epoch against a freshly observed one.
 * known === null|undefined → first observation (never stale).
 * Epochs are opaque strings (ISO boot stamps in production).
 */
export function checkEpoch({ known, observed } = {}) {
  if (observed == null || observed === '') return { stale: false, action: 'no-epoch', first: false };
  if (known == null) return { stale: false, action: 'first-observe', first: true };
  const same = String(known) === String(observed);
  return same
    ? { stale: false, action: 'keep', first: false }
    : { stale: true, action: 're-adopt', first: false, from: known, to: observed };
}

/**
 * Pure decision: next keepalive delay from the failure streak.
 * base * 2^failures, capped at capMs — jitter is added by the caller, not here
 * (determinism for tests).
 */
export function nextKeepaliveDelayMs({ failures = 0, baseMs = KEEPALIVE.BASE_MS, capMs = KEEPALIVE.MAX_MS } = {}) {
  const raw = baseMs * 2 ** Math.max(0, failures);
  return Math.min(Math.round(raw), capMs);
}

/**
 * EpochFence — stateful fence over the daemon boot epoch with keepalive bookkeeping.
 * observe() is the single entry the plane calls on every probe result.
 */
export class EpochFence {
  constructor({ baseMs = KEEPALIVE.BASE_MS, capMs = KEEPALIVE.MAX_MS, now = () => Date.now() } = {}) {
    this.baseMs = baseMs;
    this.capMs = capMs;
    this.now = now;
    this.epoch = null; // known daemon boot epoch
    this.failures = 0;
    this.lastOkAt = null;
    this.breaches = 0; // epoch changes seen since construction
  }

  /**
   * Feed one probe result: { ok, boot? } (boot = daemon epoch from /health).
   * Returns a machine-readable verdict the caller must journal:
   *   { epochStale, action, nextProbeMs, failures, breaches }
   */
  observe({ ok, boot } = {}) {
    const ts = this.now();
    let verdict;
    if (!ok) {
      this.failures += 1;
      verdict = { epochStale: false, action: 'silent', first: false };
    } else {
      this.lastOkAt = ts;
      this.failures = 0;
      const cmp = checkEpoch({ known: this.epoch, observed: boot });
      verdict = { epochStale: cmp.stale, action: cmp.action, first: cmp.first === true };
      if (cmp.stale) this.breaches += 1;
      if (cmp.action === 'first-observe' || cmp.action === 're-adopt') this.epoch = boot;
    }
    verdict.failures = this.failures;
    verdict.breaches = this.breaches;
    verdict.nextProbeMs = nextKeepaliveDelayMs({ failures: this.failures, baseMs: this.baseMs, capMs: this.capMs });
    verdict.at = ts;
    return verdict;
  }

  /** Fence validity: we know the epoch AND have heard from it (1 window). */
  isCurrent({ silenceMs = 3 * KEEPALIVE.MAX_MS } = {}) {
    if (this.epoch == null || this.lastOkAt == null) return false;
    return this.now() - this.lastOkAt <= silenceMs && this.failures === 0;
  }

  snapshot() {
    return {
      epoch: this.epoch,
      failures: this.failures,
      breaches: this.breaches,
      lastOkAt: this.lastOkAt,
      current: this.isCurrent(),
      nextProbeMs: nextKeepaliveDelayMs({ failures: this.failures, baseMs: this.baseMs, capMs: this.capMs }),
    };
  }
}
