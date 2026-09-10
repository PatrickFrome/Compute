export const BROWSER_PLAN_SCHEMA = 'metaengine.browser-plan.v1';
export const BROWSER_PLAN_MAX_STEPS = 32;
export const BROWSER_PLAN_MAX_STEP_MS = 30_000;

const STEP_KINDS = new Set(['READ','CLICK','TYPE','NAVIGATE','WAIT']);
const TERMINAL_BAD = new Set(['FAILED','AMBIGUOUS','NEEDS_REPLAN','CANCELLED']);
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);
const clip = (value, max) => value == null ? null : String(value).slice(0, max);

function boundedMs(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(100, Math.min(BROWSER_PLAN_MAX_STEP_MS, Math.trunc(n))) : 10_000;
}

function normalizeStep(step, index) {
  if (!plain(step)) throw new Error(`browser_plan_step_invalid:${index}`);
  for (const key of Object.keys(step)) if (!['id','kind','payload','timeout_ms'].includes(key)) throw new Error(`browser_plan_step_field_unknown:${index}:${key}`);
  const id = String(step.id || `step-${index + 1}`);
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(id)) throw new Error(`browser_plan_step_id_invalid:${index}`);
  const kind = String(step.kind || '').toUpperCase();
  if (!STEP_KINDS.has(kind)) throw new Error(`browser_plan_step_kind_invalid:${index}`);
  const payload = step.payload == null ? {} : step.payload;
  if (!plain(payload) || Buffer.byteLength(JSON.stringify(payload), 'utf8') > 16 * 1024) throw new Error(`browser_plan_step_payload_invalid:${index}`);
  return Object.freeze({ id, kind, payload: structuredClone(payload), timeout_ms: boundedMs(step.timeout_ms), authority_effect: false });
}

export function normalizeBrowserPlan(plan) {
  if (!plain(plan)) throw new Error('browser_plan_invalid');
  for (const key of Object.keys(plan)) if (!['plan_id','tab_id','generation','steps'].includes(key)) throw new Error(`browser_plan_field_unknown:${key}`);
  const planId = String(plan.plan_id || '');
  const tabId = String(plan.tab_id || '');
  const generation = Number(plan.generation);
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(planId)) throw new Error('browser_plan_id_invalid');
  if (!tabId || tabId.length > 160) throw new Error('browser_plan_tab_invalid');
  if (!Number.isSafeInteger(generation) || generation < 1) throw new Error('browser_plan_generation_invalid');
  if (!Array.isArray(plan.steps) || plan.steps.length < 1 || plan.steps.length > BROWSER_PLAN_MAX_STEPS) throw new Error('browser_plan_steps_invalid');
  const steps = plan.steps.map(normalizeStep);
  if (new Set(steps.map((step) => step.id)).size !== steps.length) throw new Error('browser_plan_duplicate_step_id');
  return Object.freeze({ schema: BROWSER_PLAN_SCHEMA, plan_id: planId, tab_id: tabId, generation, steps, arbitrary_eval: false, raw_cdp_passthrough: false, automatic_effect_retry_allowed: false, authority_effect: false });
}

export class BrowserPlanRuntime {
  #executeStep;
  #getBinding;
  constructor({ executeStep, getBinding } = {}) {
    if (typeof executeStep !== 'function') throw new Error('browser_plan_executor_required');
    if (typeof getBinding !== 'function') throw new Error('browser_plan_binding_provider_required');
    this.#executeStep = executeStep;
    this.#getBinding = getBinding;
  }

  async execute(input, { signal = null } = {}) {
    const plan = normalizeBrowserPlan(input);
    const initial = await this.#getBinding(plan.tab_id);
    if (!initial || String(initial.tab_id || '') !== plan.tab_id || Number(initial.generation) !== plan.generation) throw new Error('browser_plan_binding_mismatch');
    const results = [];
    const started = Date.now();
    for (const step of plan.steps) {
      if (signal?.aborted) return this.#receipt(plan, 'CANCELLED', results, started, 'PLAN_ABORTED');
      const binding = await this.#getBinding(plan.tab_id);
      if (!binding || String(binding.tab_id || '') !== plan.tab_id || Number(binding.generation) !== plan.generation) return this.#receipt(plan, 'AMBIGUOUS', results, started, 'BINDING_CHANGED');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('browser_plan_step_timeout')), step.timeout_ms);
      timer.unref?.();
      const abort = () => controller.abort(signal?.reason);
      signal?.addEventListener?.('abort', abort, { once: true });
      let result;
      try {
        result = await this.#executeStep(step, { plan, signal: controller.signal });
      } catch (error) {
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', abort);
        const state = controller.signal.aborted ? 'AMBIGUOUS' : 'FAILED';
        results.push(Object.freeze({ step_id: step.id, kind: step.kind, state, reason: clip(error?.message || error, 240), authority_effect: false }));
        return this.#receipt(plan, state, results, started, `STEP_${step.id}_${state}`);
      }
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', abort);
      const state = String(result?.state || 'CONFIRMED').toUpperCase();
      results.push(Object.freeze({ step_id: step.id, kind: step.kind, state, result: result ?? null, authority_effect: result?.authority_effect === true }));
      if (TERMINAL_BAD.has(state)) return this.#receipt(plan, state, results, started, `STEP_${step.id}_${state}`);
    }
    return this.#receipt(plan, 'CONFIRMED', results, started, 'ALL_STEPS_CONFIRMED');
  }

  #receipt(plan, state, results, started, reason) {
    return Object.freeze({
      schema: 'metaengine.browser-plan.receipt.v1',
      plan_id: plan.plan_id,
      tab_id: plan.tab_id,
      generation: plan.generation,
      state,
      reason,
      completed_steps: results.length,
      total_steps: plan.steps.length,
      duration_ms: Math.max(0, Date.now() - started),
      results: Object.freeze(results.slice()),
      arbitrary_eval: false,
      raw_cdp_passthrough: false,
      automatic_effect_retry_allowed: false,
      authority_effect: state === 'CONFIRMED' && results.some((row) => row.authority_effect === true),
    });
  }
}
