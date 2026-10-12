// Stable bounded parallel observation: concurrency affects latency, never result order.
// Captures are read-only; writes and lease transitions remain serialized outside this helper.
export async function mapBoundedObservations(items, observe, { concurrency = 4 } = {}) {
  if (!Array.isArray(items) || typeof observe !== 'function'
    || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16)
    throw new Error('bounded_observation_contract_invalid');
  if (items.length === 0) return [];
  const results = new Array(items.length);
  let cursor = 0;
  const pool = Array.from({length:Math.min(concurrency,items.length)},async()=>{
    while (cursor < items.length) {
      const index=cursor++;
      results[index]=await observe(items[index],index);
    }
  });
  // Drain all owned read-only observations even when a mapper fails. Early
  // Promise.all rejection could leave live captures in flight after the tick
  // returned, allowing overlap with the next supervisor cycle.
  const settled = await Promise.allSettled(pool);
  const rejected = settled.find(row => row.status === 'rejected');
  if (rejected) throw rejected.reason;
  return results;
}
