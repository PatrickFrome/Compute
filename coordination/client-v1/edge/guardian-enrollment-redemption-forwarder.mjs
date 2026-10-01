// Ticket-only transport bridge. ADMIN issuance and exact single-use redemption
// stay in the qualified Meta backend; this adapter cannot enroll or authenticate.
const TARGET = 'https://jhriwwsryeqsvvvufkok.supabase.co/functions/v1/a2-browser-native-supervisor-v14-canary/v1/guardian/enrollment/redeem';
const SCHEMA = 'metaengine.guardian-enrollment-ticket-redemption.v1';
const MAX_BYTES = 1024;

async function boundedBytes(stream, limit, signal) {
  const reader = stream?.getReader();
  if (!reader) throw new Error('guardian_redemption_body_missing');
  const chunks = []; let length = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) return null;
      chunks.push(value);
    }
    if (signal.aborted) throw new Error('guardian_redemption_deadline');
    const raw = new Uint8Array(length); let offset = 0;
    for (const value of chunks) { raw.set(value, offset); offset += value.byteLength; }
    return raw;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    signal.removeEventListener('abort', abort);
  }
}

export function createGuardianEnrollmentRedemptionForwarder({ fetchImpl = globalThis.fetch, timeoutMs = 8_000 } = {}) {
  if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 8_000) throw new Error('guardian_redemption_transport_invalid');
  const rejectInput = () => new Response(JSON.stringify({ schema: SCHEMA, accepted: false, reason: 'REDEMPTION_INPUT_INVALID', authority_effect: false }),
    { status: 400, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  return async (req, path) => {
    if (req.method !== 'POST' || path !== '/v1/guardian/enrollment/redeem') return null;
    if (req.headers.has('x-metaengine-guardian-redemption-hop')) return rejectInput();
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('guardian_redemption_deadline')); }, timeoutMs);
    });
    try {
      return await Promise.race([(async () => {
        const raw = await boundedBytes(req.body, MAX_BYTES, controller.signal);
        if (!raw) return rejectInput();
        let body;
        try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { return rejectInput(); }
        if (!body || Object.keys(body).sort().join(',') !== 'key_fingerprint_sha256,owner_sid_sha256,ticket'
            || !/^[A-Za-z0-9_-]{43}$/.test(body.ticket)
            || !/^[0-9a-f]{64}$/.test(body.key_fingerprint_sha256)
            || !/^[0-9a-f]{64}$/.test(body.owner_sid_sha256)) return rejectInput();
        const response = await fetchImpl(TARGET, {
          method: 'POST', body: raw, redirect: 'error', signal: controller.signal,
          headers: { 'content-type': 'application/json', accept: 'application/json', 'x-metaengine-guardian-redemption-hop': '1' },
        });
        if (response.status >= 300 && response.status < 400) throw new Error('guardian_redemption_redirect');
        // Keep the deadline across upstream body read. Never fall through/retry.
        const result = await boundedBytes(response.body, 16 * 1024, controller.signal);
        if (!result) throw new Error('guardian_redemption_response_oversized');
        return new Response(result, { status: response.status,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-metaengine-guardian-redemption-route': 'META_QUALIFIED_CANARY' } });
      })(), deadline]);
    } catch {
      // Upstream might already have consumed the ticket: uncertainty is explicit.
      return new Response(JSON.stringify({ error: 'guardian_redemption_outcome_unknown', automatic_retry_allowed: false }),
        { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    } finally { clearTimeout(timer); controller.abort(); }
  };
}
