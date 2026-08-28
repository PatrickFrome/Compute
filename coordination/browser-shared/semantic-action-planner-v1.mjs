import { SemanticActionCache } from './semantic-action-cache-v1.mjs';
import { assertPerceptionEnvelope } from './perception-envelope-v1.mjs';

const SCHEMA = 'metaengine.a2-browser-operator.semantic-action-planner.v1';
const RESULT_SCHEMA = 'metaengine.a2-browser-operator.semantic-action-plan-result.v1';

function cleanId(value, code, max = 256) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max || !/^[a-zA-Z0-9_.:-]+$/.test(text)) throw new Error(code);
  return text;
}

function cleanActionKind(value) {
  const kind = String(value ?? '').trim().toUpperCase();
  if (!['CLICK', 'FOCUS', 'FILL', 'PRESS', 'SELECT', 'TOGGLE'].includes(kind)) {
    throw new Error('semantic_action_planner_action_kind_invalid');
  }
  return kind;
}

function publicResult({ source, intentId, actionKind, candidateRef, cacheReason = null, plannerMeta = null }) {
  return Object.freeze({
    schema: RESULT_SCHEMA,
    source,
    intent_id: intentId,
    action_kind: actionKind,
    candidate_ref: candidateRef,
    cache_reason: cacheReason,
    planner_meta: plannerMeta,
    authority_effect: false,
    actuation_eligible: false,
    revalidation_required: true,
    must_run_actionability_checks: true,
    stores_execution_payload: false
  });
}

function sanitizePlannerMeta(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('semantic_action_planner_meta_invalid');
  const allowed = {};
  for (const key of ['model', 'strategy', 'reason_code']) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const text = String(value[key] ?? '').trim();
    if (text && text.length <= 128) allowed[key] = text;
  }
  return Object.freeze(allowed);
}

export class CachedSemanticPlanner {
  constructor({ cache = new SemanticActionCache(), planner } = {}) {
    if (!cache || typeof cache.resolve !== 'function' || typeof cache.put !== 'function') {
      throw new Error('semantic_action_planner_cache_invalid');
    }
    if (typeof planner !== 'function') throw new Error('semantic_action_planner_provider_invalid');
    this.cache = cache;
    this.planner = planner;
    this.metrics = {
      requests: 0,
      cache_hits: 0,
      cache_misses: 0,
      planner_calls: 0,
      planner_calls_avoided: 0,
      planner_errors: 0,
      promotions: 0
    };
  }

  async resolve({ envelope, intentId, actionKind, plannerContext = null } = {}) {
    const freshEnvelope = assertPerceptionEnvelope(envelope);
    const normalizedIntent = cleanId(intentId, 'semantic_action_planner_intent_id_invalid');
    const normalizedAction = cleanActionKind(actionKind);
    this.metrics.requests += 1;

    const cached = this.cache.resolve({
      envelope: freshEnvelope,
      intentId: normalizedIntent,
      actionKind: normalizedAction
    });
    if (cached.cache_status === 'HIT_REVALIDATED') {
      this.metrics.cache_hits += 1;
      this.metrics.planner_calls_avoided += 1;
      return publicResult({
        source: 'CACHE_REVALIDATED',
        intentId: normalizedIntent,
        actionKind: normalizedAction,
        candidateRef: cached.candidate_ref,
        cacheReason: cached.reason
      });
    }

    this.metrics.cache_misses += 1;
    this.metrics.planner_calls += 1;
    let planned;
    try {
      planned = await this.planner(Object.freeze({
        envelope: freshEnvelope,
        intent_id: normalizedIntent,
        action_kind: normalizedAction,
        planner_context: plannerContext
      }));
    } catch (error) {
      this.metrics.planner_errors += 1;
      throw error;
    }
    if (!planned || typeof planned !== 'object' || Array.isArray(planned)) {
      throw new Error('semantic_action_planner_result_invalid');
    }
    const candidateRef = cleanId(planned.candidate_ref, 'semantic_action_planner_candidate_ref_invalid');
    const plannerMeta = sanitizePlannerMeta(planned.meta);

    this.cache.put({
      envelope: freshEnvelope,
      intentId: normalizedIntent,
      actionKind: normalizedAction,
      nodeRef: candidateRef
    });
    this.metrics.promotions += 1;

    return publicResult({
      source: 'PLANNER_FRESH',
      intentId: normalizedIntent,
      actionKind: normalizedAction,
      candidateRef,
      cacheReason: cached.reason,
      plannerMeta
    });
  }

  snapshot() {
    const requests = this.metrics.requests;
    return Object.freeze({
      schema: SCHEMA,
      authority_effect: false,
      actuation_eligible: false,
      stores_execution_payload: false,
      metrics: {
        ...this.metrics,
        cache_hit_ratio: requests ? this.metrics.cache_hits / requests : 0,
        planner_avoidance_ratio: requests ? this.metrics.planner_calls_avoided / requests : 0
      },
      cache: this.cache.snapshot()
    });
  }
}

export const SEMANTIC_ACTION_PLANNER_SCHEMA = SCHEMA;
export const SEMANTIC_ACTION_PLAN_RESULT_SCHEMA = RESULT_SCHEMA;
