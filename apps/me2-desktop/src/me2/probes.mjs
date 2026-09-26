/**
 * ME2 plane probes — HTTP/WS reachability helpers (no electron, no deps).
 * Every function returns an honest structured status; nothing throws outward.
 */

/** GET a JSON endpoint with timeout. Returns {ok, status, json|text|error}. */
export async function probeJson(url, { timeoutMs = 4000, fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON body is a valid probe outcome */
    }
    return { ok: res.ok, status: res.status, json, text: json ? undefined : text.slice(0, 400) };
  } catch (err) {
    return { ok: false, status: 0, error: String(err?.cause?.code ?? err?.message ?? err).slice(0, 120) };
  }
}

/** Probe daemon REST health. */
export function probeDaemon(restPort, opts = {}) {
  return probeJson(`http://127.0.0.1:${restPort}/health`, opts);
}

/** Probe Mission Control UI root. */
export function probeUi(uiPort, opts = {}) {
  return probeJson(`http://127.0.0.1:${uiPort}/`, { ...opts, timeoutMs: opts.timeoutMs ?? 6000 });
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll a probe fn until ok or deadline (used by hosts at boot). */
export async function pollUntil(fn, { tries, intervalMs }) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    last = await fn();
    if (last?.ok || last?.terminal) return last;
    if (i < tries - 1) await sleep(intervalMs);
  }
  return last ?? { ok: false };
}
