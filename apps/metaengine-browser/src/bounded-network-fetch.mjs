export const DEFAULT_OPTIONAL_NETWORK_DEADLINE_MS = 3000;

function clip(value, max = 180) {
  return String(value ?? '').slice(0, max);
}

export function createBoundedNetworkFetch(fetchImpl = globalThis.fetch, {
  deadlineMs = DEFAULT_OPTIONAL_NETWORK_DEADLINE_MS,
  label = 'optional_network',
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('bounded_network_fetch_required');
  const boundedMs = Math.max(500, Math.min(30_000, Number(deadlineMs) || DEFAULT_OPTIONAL_NETWORK_DEADLINE_MS));
  const boundedLabel = clip(label, 80).replace(/[^0-9A-Za-z_.-]/g, '_') || 'optional_network';
  return async (url, init = {}) => {
    if (init?.signal) return fetchImpl(url, init);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`${boundedLabel}_deadline_exceeded`)), boundedMs);
    timer.unref?.();
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`${boundedLabel}_deadline_exceeded`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}
