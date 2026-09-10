import { CONTROL_ACTION_MANIFEST_REVISION, controlActionDescriptor } from './control-actions-manifest.mjs';

export const BROWSER_PLAN_SCHEMA = 'metaengine.browser-plan.v1';
export const BROWSER_PLAN_MAX_STEPS = 32;
export const BROWSER_PLAN_MAX_BYTES = 64 * 1024;
export const BROWSER_PLAN_MAX_DEADLINE_MS = 60_000;

const PLAN_ACTIONS = new Set([
  'POLL','CAPTURE','CAPTURE_VIEW','DOWNLOAD_STATUS','DEV_PLANE_STATUS','DEV_PLANE_HEALTH','DEV_PLANE_CAPABILITIES','DEV_PLANE_PROCESS_METRICS','DEV_PLANE_REPO_HEAD',
  'STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','TYPED_CLICK',
  'SELECT_TAB','CLOSE_TAB','NAVIGATE','BACK','FORWARD','RELOAD','NEW_TAB',
]);
const PAGE_ACTIONS = new Set(['STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','TYPED_CLICK','NAVIGATE','BACK','FORWARD','RELOAD']);
const MUTATING = new Set([...PLAN_ACTIONS].filter((action) => controlActionDescriptor(action)?.effect === 'MUTATING'));
const PLAN_ID_RE = /^[A-Za-z0-9._:-]{8,160}$/;
const STEP_ID_RE = /^[A-Za-z0-9._:-]{1,80}$/;

const bytes = (value) => Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);

function normalizeOrigins(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw new Error('browser_plan_allowed_origins_invalid');
  const out = [];
  for (const raw of value) {
    let origin;
    try { origin = new URL(String(raw)).origin; } catch { throw new Error('browser_plan_allowed_origin_invalid'); }
    if (!/^https?:\/\//.test(origin)) throw new Error('browser_plan_allowed_origin_invalid');
    if (!out.includes(origin)) out.push(origin);
  }
  return Object.freeze(out);
}

function normalizePlan(plan) {
  if (!plain(plan)) throw new Error('browser_plan_invalid');
  if (bytes(plan) > BROWSER_PLAN_MAX_BYTES) throw new Error('browser_plan_too_large');
  const planId = String(plan.plan_id || '').trim();
  if (!PLAN_ID_RE.test(planId)) throw new Error('browser_plan_id_invalid');
  if (String(plan.capability_revision || '') !== CONTROL_ACTION_MANIFEST_REVISION) throw new Error('browser_plan_capability_revision_mismatch');
  if (!Array.isArray(plan.steps) || plan.steps.length < 1 || plan.steps.length > BROWSER_PLAN_MAX_STEPS) throw new Error('browser_plan_steps_invalid');
  const allowedOrigins = normalizeOrigins(plan.allowed_origins);
  const seen = new Set();
  const steps = plan.steps.map((raw, index) => {
    if (!plain(raw)) throw new Error(`browser_plan_step_invalid:${index}`);
    const id = String(raw.id || `step:${index + 1}`).trim();
    if (!STEP_ID_RE.test(id) || seen.has(id)) throw new Error(`browser_plan_step_id_invalid:${index}`);
    seen.add(id);
    const action = String(raw.action || '').trim().toUpperCase();
    const descriptor = controlActionDescriptor(action);
    if (!PLAN_ACTIONS.has(action) || !descriptor?.browser_implemented) throw new Error(`browser_plan_action_denied:${action || index}`);
    const payload = raw.payload == null ? {} : raw.payload;
    if (!plain(payload) || bytes(payload) > 16 * 1024) throw new Error(`browser_plan_payload_invalid:${index}`);
    return Object.freeze({ id, action, platform: raw.platform == null ? null : String(raw.platform).slice(0, 80), payload: structuredClone(payload), mutating: MUTATING.has(action), page_action: PAGE_ACTIONS.has(action) });
  });
  const deadlineMs = Math.max(250, Math.min(BROWSER_PLAN_MAX_DEADLINE_MS, Number(plan.deadline_ms) || 30_000));
  return Object.freeze({ plan_id: planId, capability_revision: CONTROL_ACTION_MANIFEST_REVISION, allowed_origins: allowedOrigins, deadline_ms: deadlineMs, steps });
}

function originAllowed(url, allowedOrigins) {
  try { return allowedOrigins.includes(new URL(String(url || '')).origin); } catch { return false; }
}

function receipt(plan, state, completed, current, results, extra = {}) {
  return Object.freeze({
    schema: 'metaengine.browser-plan.receipt.v1',
    plan_id: plan.plan_id,
    capability_revision: plan.capability_revision,
    state,
    completed_steps: completed,
    current_step: current,
    results: Object.freeze(results.map((row) => Object.freeze(structuredClone(row)))),
    automatic_effect_retry_allowed: false,
    browser_plan_is_authority: false,
    ...extra,
    authority_effect: false,
  });
}

export class BrowserPlanExecutor {
  #executeAction;
  #verifyAction;
  #getCurrentUrl;
  #active = new Map();

  constructor({ executeAction, verifyAction, getCurrentUrl } = {}) {
    if (typeof executeAction !== 'function') throw new Error('browser_plan_execute_action_required');
    if (typeof verifyAction !== 'function') throw new Error('browser_plan_verify_action_required');
    if (typeof getCurrentUrl !== 'function') throw new Error('browser_plan_current_url_required');
    this.#executeAction = executeAction;
    this.#verifyAction = verifyAction;
    this.#getCurrentUrl = getCurrentUrl;
  }

  cancel(planId, reason = 'EXTERNAL_CANCEL') {
    const active = this.#active.get(String(planId || ''));
    if (!active) return Object.freeze({ cancelled: false, reason: 'PLAN_NOT_ACTIVE', authority_effect: false });
    active.reason = String(reason || 'EXTERNAL_CANCEL').slice(0, 160);
    active.controller.abort(active.reason);
    return Object.freeze({ cancelled: true, reason: active.reason, authority_effect: false });
  }

  async execute(input) {
    const plan = normalizePlan(input);
    if (this.#active.has(plan.plan_id)) throw new Error('browser_plan_already_active');
    const controller = new AbortController();
    const active = { controller, reason: null };
    this.#active.set(plan.plan_id, active);
    const timer = setTimeout(() => {
      active.reason = 'PLAN_DEADLINE_EXCEEDED';
      controller.abort(active.reason);
    }, plan.deadline_ms);
    timer.unref?.();
    const results = [];
    let completed = 0;

    try {
      for (const step of plan.steps) {
        if (controller.signal.aborted) return receipt(plan, 'CANCELLED', completed, step.id, results, { reason: active.reason || 'ABORTED' });
        if (step.page_action) {
          const currentUrl = await this.#getCurrentUrl(step, { signal: controller.signal });
          if (!originAllowed(currentUrl, plan.allowed_origins)) {
            return receipt(plan, 'NEEDS_REPLAN', completed, step.id, results, { reason: 'ORIGIN_FENCE_MISMATCH', observed_url: String(currentUrl || '').slice(0, 1200) });
          }
        }
        if (step.action === 'NAVIGATE') {
          const target = step.payload?.url;
          if (!originAllowed(target, plan.allowed_origins)) return receipt(plan, 'NEEDS_REPLAN', completed, step.id, results, { reason: 'NAVIGATION_TARGET_ORIGIN_DENIED' });
        }

        let value;
        const started = Date.now();
        try {
          value = await this.#executeAction({ action: step.action, platform: step.platform, payload: structuredClone(step.payload) }, { signal: controller.signal, plan_id: plan.plan_id, step_id: step.id });
        } catch (error) {
          const errorText = String(error?.message || error).slice(0, 240);
          const state = step.mutating ? 'AMBIGUOUS' : (controller.signal.aborted ? 'CANCELLED' : 'NEEDS_REPLAN');
          return receipt(plan, state, completed, step.id, results, { reason: controller.signal.aborted ? (active.reason || 'ABORTED') : 'EXECUTION_ERROR', error: errorText });
        }

        let verification = null;
        if (step.mutating) {
          try {
            verification = await this.#verifyAction(step, value, { signal: controller.signal, plan_id: plan.plan_id });
          } catch (error) {
            return receipt(plan, 'AMBIGUOUS', completed, step.id, results, { reason: 'VERIFICATION_ERROR', error: String(error?.message || error).slice(0, 240) });
          }
          if (verification?.confirmed !== true) {
            return receipt(plan, verification?.no_effect_proven === true ? 'NEEDS_REPLAN' : 'AMBIGUOUS', completed, step.id, results, {
              reason: verification?.no_effect_proven === true ? 'NO_EFFECT_PROVEN' : 'POSTCONDITION_UNPROVEN',
              verification: plain(verification) ? structuredClone(verification) : null,
            });
          }
        }

        completed += 1;
        results.push({
          step_id: step.id,
          action: step.action,
          execution_ms: Date.now() - started,
          result: value ?? null,
          verification: verification == null ? null : structuredClone(verification),
          authority_effect: false,
        });
      }
      return receipt(plan, 'COMPLETED', completed, null, results);
    } finally {
      clearTimeout(timer);
      this.#active.delete(plan.plan_id);
    }
  }

  snapshot() {
    return Object.freeze({
      schema: BROWSER_PLAN_SCHEMA,
      active_plans: this.#active.size,
      max_steps: BROWSER_PLAN_MAX_STEPS,
      max_deadline_ms: BROWSER_PLAN_MAX_DEADLINE_MS,
      capability_revision: CONTROL_ACTION_MANIFEST_REVISION,
      allowed_actions: Object.freeze([...PLAN_ACTIONS]),
      local_execution: true,
      origin_fence: true,
      mutating_postcondition_required: true,
      arbitrary_eval: false,
      raw_cdp_passthrough: false,
      automatic_effect_retry_allowed: false,
      authority_effect: false,
    });
  }
}
