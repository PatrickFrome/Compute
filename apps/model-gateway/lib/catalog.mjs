const CATALOG_URL = 'https://ai-gateway.vercel.sh/v1/models';
const DEFAULT_TTL_MS = 10 * 60 * 1000;

let cache = { fetchedAt: 0, models: null };

export function isZeroPrice(model) {
  const pricing = model?.pricing;
  if (!pricing || pricing.input === undefined || pricing.output === undefined) return false;
  return Number(pricing.input) === 0 && Number(pricing.output) === 0;
}

export async function getModelCatalog({ fetchImpl = fetch, now = Date.now, ttlMs = DEFAULT_TTL_MS } = {}) {
  const current = now();
  if (cache.models && current - cache.fetchedAt < ttlMs) return cache.models;

  const response = await fetchImpl(CATALOG_URL, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`catalog_http_${response.status}`);

  const payload = await response.json();
  if (!Array.isArray(payload?.data)) throw new Error('catalog_invalid_payload');
  const models = new Map(payload.data.filter((m) => typeof m?.id === 'string').map((m) => [m.id, m]));
  cache = { fetchedAt: current, models };
  return models;
}

export async function assertZeroSpend(models, options = {}) {
  const catalog = await getModelCatalog(options);
  for (const id of models) {
    const model = catalog.get(id);
    if (!model) throw new Error(`free_model_missing:${id}`);
    if (!isZeroPrice(model)) throw new Error(`free_model_not_zero_cost:${id}`);
  }
  return true;
}

export function resetCatalogCacheForTests() {
  cache = { fetchedAt: 0, models: null };
}
