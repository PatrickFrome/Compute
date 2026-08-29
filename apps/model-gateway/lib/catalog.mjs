import { LIMITS } from './policy.mjs';

const CATALOG_URL = 'https://ai-gateway.vercel.sh/v1/models';
const DEFAULT_TTL_MS = 10 * 60 * 1000;

let cache = { fetchedAt: 0, models: null };

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function collectChargeValues(node, output = []) {
  if (!node || typeof node !== 'object') return output;
  if (Array.isArray(node)) {
    for (const item of node) collectChargeValues(item, output);
    return output;
  }

  for (const [name, value] of Object.entries(node)) {
    const lower = name.toLowerCase();
    const chargeKey =
      lower === 'input' ||
      lower === 'output' ||
      lower === 'cost' ||
      lower.startsWith('input_') ||
      lower.startsWith('output_') ||
      lower.includes('cost_per') ||
      lower.endsWith('_cost') ||
      lower.endsWith('_price');

    if (chargeKey && (typeof value === 'string' || typeof value === 'number')) {
      const parsed = numeric(value);
      if (parsed !== null) output.push(parsed);
    }
    if (value && typeof value === 'object') collectChargeValues(value, output);
  }
  return output;
}

export function isZeroPrice(model) {
  const pricing = model?.pricing;
  if (!pricing || typeof pricing !== 'object') return false;
  if (pricing.input === undefined || pricing.output === undefined) return false;
  if (pricing.varies_by_provider === true) return false;

  const input = numeric(pricing.input);
  const output = numeric(pricing.output);
  if (input !== 0 || output !== 0) return false;

  const charges = collectChargeValues(pricing);
  return charges.length >= 2 && charges.every((value) => value === 0);
}

export function privacySnapshot(model) {
  return {
    model: String(model?.id || ''),
    owned_by: typeof model?.owned_by === 'string' ? model.owned_by : null,
    zdr: typeof model?.zdr === 'string' ? model.zdr : 'unknown',
    no_training: typeof model?.no_training === 'string' ? model.no_training : 'unknown',
    zero_price: isZeroPrice(model)
  };
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
  // Spend authorization must use current pricing. A stale cache can turn a
  // formerly-free route into an unintended paid request after repricing.
  const ttlMs = options.ttlMs ?? 0;
  const catalog = await getModelCatalog({ ...options, ttlMs });
  const evidence = [];
  for (const id of models) {
    const model = catalog.get(id);
    if (!model) throw new Error(`free_model_missing:${id}`);
    if (!isZeroPrice(model)) throw new Error(`free_model_not_zero_cost:${id}`);
    evidence.push(privacySnapshot(model));
  }

  const allZdr = evidence.length > 0 && evidence.every((item) => item.zdr === 'all');
  const allNoTraining = evidence.length > 0 && evidence.every((item) => item.no_training === 'all');
  return {
    models: evidence,
    privacy: {
      all_zdr: allZdr,
      all_no_training: allNoTraining,
      classification: allZdr && allNoTraining
        ? 'CATALOG_ZDR_AND_NO_TRAINING'
        : 'EXTERNAL_NON_ZDR_OR_TRAINING_UNCERTAIN'
    }
  };
}

function collectUnitPrices(node, key, output = []) {
  if (!node || typeof node !== 'object') return output;
  if (Array.isArray(node)) {
    for (const item of node) collectUnitPrices(item, key, output);
    return output;
  }

  for (const [name, value] of Object.entries(node)) {
    if (name === key) {
      const parsed = numeric(value);
      if (parsed !== null) output.push(parsed);
    }
    if (name === `${key}_tiers` && Array.isArray(value)) {
      for (const tier of value) {
        const parsed = numeric(tier?.cost);
        if (parsed !== null) output.push(parsed);
      }
    }
    if (value && typeof value === 'object') collectUnitPrices(value, key, output);
  }
  return output;
}

function maxPeakMultiplier(node) {
  if (!node || typeof node !== 'object') return 1;
  let maximum = 1;
  if (!Array.isArray(node) && node.peak_pricing && typeof node.peak_pricing === 'object') {
    const parsed = numeric(node.peak_pricing.multiplier);
    if (parsed !== null) maximum = Math.max(maximum, parsed);
  }
  const values = Array.isArray(node) ? node : Object.values(node);
  for (const value of values) {
    if (value && typeof value === 'object') maximum = Math.max(maximum, maxPeakMultiplier(value));
  }
  return maximum;
}

export function conservativeModelCostUsd(model, { input, maxOutputTokens }) {
  const pricing = model?.pricing;
  if (!pricing || typeof pricing !== 'object') throw new Error(`paid_model_pricing_missing:${model?.id || 'unknown'}`);
  const inputPrices = collectUnitPrices(pricing, 'input');
  const outputPrices = collectUnitPrices(pricing, 'output');
  if (!inputPrices.length || !outputPrices.length) throw new Error(`paid_model_pricing_missing:${model?.id || 'unknown'}`);

  const inputBytes = Buffer.byteLength(String(input ?? ''), 'utf8');
  const inputUnit = Math.max(...inputPrices);
  const outputUnit = Math.max(...outputPrices);
  const peakMultiplier = maxPeakMultiplier(pricing);

  // Fail-safe upper bound for ordinary text: one UTF-8 byte is priced as one token.
  // Use the most expensive published unit price/tier and peak multiplier found in the catalog entry.
  return (inputBytes * inputUnit + maxOutputTokens * outputUnit) * peakMultiplier;
}

export function paidBudgetCapUsd(env = process.env) {
  const configured = numeric(env.METAENGINE_MAX_PAID_REQUEST_USD);
  if (configured === null) return LIMITS.hardMaxPaidRequestUsd;
  return Math.min(configured, LIMITS.hardMaxPaidRequestUsd);
}

export async function assertPaidBudget(models, {
  input,
  maxOutputTokens,
  env = process.env,
  ttlMs = 0,
  ...catalogOptions
} = {}) {
  // Paid budget decisions are also based on a fresh catalog by default.
  const catalog = await getModelCatalog({ ...catalogOptions, ttlMs });
  const estimates = [];
  for (const id of models) {
    const model = catalog.get(id);
    if (!model) throw new Error(`paid_model_missing:${id}`);
    estimates.push({
      model: id,
      worst_case_usd: conservativeModelCostUsd(model, { input, maxOutputTokens })
    });
  }

  // A failed primary can consume tokens before Gateway tries a fallback, so sum all attempts.
  const worstCaseUsd = estimates.reduce((sum, item) => sum + item.worst_case_usd, 0);
  const capUsd = paidBudgetCapUsd(env);
  if (worstCaseUsd > capUsd) {
    throw new Error(`paid_budget_exceeded:${worstCaseUsd.toFixed(6)}>${capUsd.toFixed(6)}`);
  }
  return { cap_usd: capUsd, worst_case_usd: worstCaseUsd, models: estimates };
}

export function resetCatalogCacheForTests() {
  cache = { fetchedAt: 0, models: null };
}
