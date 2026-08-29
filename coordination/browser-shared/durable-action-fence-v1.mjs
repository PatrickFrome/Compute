import { ActionGraphError, digestActionGraphEvidence } from './durable-action-graph-core-v1.mjs';

const OUTCOMES = new Set(['COMMITTED', 'NO_EFFECT', 'AMBIGUOUS']);
const PREFLIGHT = new Set(['READY', 'REJECTED']);

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function captureMethod(target, name) {
  const method = target?.[name];
  if (typeof method !== 'function') throw new DurableActionFenceError('action_fence_store_invalid');
  return method.bind(target);
}

function boundedToken(value, fallback) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 96 || !/^[A-Za-z0-9_.:-]+$/.test(text)) return fallback;
  return text;
}

function uncertaintyDigest(classification, error = null) {
  return digestActionGraphEvidence({
    classification,
    error_name: boundedToken(error?.name, 'Error'),
    error_code: boundedToken(error?.code, 'UNSPECIFIED'),
  });
}

export class DurableActionFenceError extends Error {
  constructor(code, { recoveryRequired = false, cause = null } = {}) {
    super(code, cause ? { cause } : undefined);
    this.name = 'DurableActionFenceError';
    this.code = code;
    this.recovery_required = recoveryRequired;
  }
}

export class DurableActionFence {
  #declare;
  #seal;
  #commit;
  #noEffect;
  #ambiguous;
  #abort;
  #preflight;
  #actuator;

  constructor({ store, preflight, actuator }) {
    if (typeof preflight !== 'function' || typeof actuator !== 'function') {
      throw new DurableActionFenceError('action_fence_callbacks_invalid');
    }
    this.#declare = captureMethod(store, 'declareAction');
    this.#seal = captureMethod(store, 'sealEffectIntent');
    this.#commit = captureMethod(store, 'commitEffect');
    this.#noEffect = captureMethod(store, 'markNoEffect');
    this.#ambiguous = captureMethod(store, 'markAmbiguous');
    this.#abort = captureMethod(store, 'abortAction');
    this.#preflight = preflight;
    this.#actuator = actuator;
  }

  async execute({ actionId, actionKind, intentDigest, namespace, dependsOn = [], ephemeral = undefined }) {
    await this.#declare({ actionId, actionKind, intentDigest, namespace, dependsOn });

    let preflight;
    try {
      preflight = await this.#preflight(Object.freeze({
        action_id: actionId,
        action_kind: actionKind,
        namespace: structuredClone(namespace),
        ephemeral,
      }));
    } catch (error) {
      return this.#abortBeforeEffect(actionId, 'PREFLIGHT_ERROR', error);
    }

    if (!preflight || typeof preflight !== 'object' || !PREFLIGHT.has(preflight.status)) {
      return this.#abortBeforeEffect(actionId, 'PREFLIGHT_PROTOCOL_ERROR');
    }
    if (preflight.status === 'REJECTED') {
      if (!exactKeys(preflight, ['status', 'reason_code'])) return this.#abortBeforeEffect(actionId, 'PREFLIGHT_PROTOCOL_ERROR');
      return this.#abortBeforeEffect(actionId, boundedToken(preflight.reason_code, 'PREFLIGHT_REJECTED'));
    }
    if (!exactKeys(preflight, ['status', 'pre_effect_evidence_digest', 'authority'])) {
      return this.#abortBeforeEffect(actionId, 'PREFLIGHT_PROTOCOL_ERROR');
    }

    const sealed = await this.#seal({
      actionId,
      preEffectEvidenceDigest: preflight.pre_effect_evidence_digest,
    });
    if (sealed?.state !== 'EFFECT_INTENT_SEALED' || sealed?.fresh_authority_required !== true || sealed?.actuation_eligible !== false) {
      throw new DurableActionFenceError('action_fence_durable_seal_invalid', { recoveryRequired: true });
    }

    let outcome;
    try {
      outcome = await this.#actuator(Object.freeze({
        action_id: actionId,
        action_kind: actionKind,
        namespace: structuredClone(namespace),
        authority: preflight.authority,
        ephemeral,
      }));
    } catch (error) {
      return this.#persistAmbiguous(actionId, uncertaintyDigest('UNTYPED_ACTUATOR_THROW', error));
    }

    const normalized = this.#normalizeOutcome(outcome);
    if (normalized.outcome === 'MALFORMED') {
      return this.#persistAmbiguous(actionId, uncertaintyDigest('MALFORMED_ACTUATOR_OUTCOME'));
    }
    try {
      let receipt;
      if (normalized.outcome === 'COMMITTED') {
        receipt = await this.#commit({ actionId, effectReceiptDigest: normalized.effect_receipt_digest });
      } else if (normalized.outcome === 'NO_EFFECT') {
        receipt = await this.#noEffect({ actionId, noEffectEvidenceDigest: normalized.no_effect_evidence_digest });
      } else {
        receipt = await this.#ambiguous({ actionId, uncertaintyDigest: normalized.uncertainty_digest });
      }
      return Object.freeze({
        outcome: normalized.outcome,
        graph_receipt: receipt,
        authority_effect: false,
        actuation_eligible: false,
        automatic_retry_allowed: false,
      });
    } catch (error) {
      throw new DurableActionFenceError('action_fence_terminal_persistence_failed', {
        recoveryRequired: true,
        cause: error,
      });
    }
  }

  async #abortBeforeEffect(actionId, reasonCode, cause = null) {
    try {
      const receipt = await this.#abort({ actionId, reasonCode });
      return Object.freeze({
        outcome: 'ABORTED',
        graph_receipt: receipt,
        authority_effect: false,
        actuation_eligible: false,
        automatic_retry_allowed: false,
        cause_classification: cause ? 'PREFLIGHT_ERROR' : null,
      });
    } catch (error) {
      throw new DurableActionFenceError('action_fence_abort_persistence_failed', {
        recoveryRequired: true,
        cause: error,
      });
    }
  }

  async #persistAmbiguous(actionId, digest) {
    try {
      const receipt = await this.#ambiguous({ actionId, uncertaintyDigest: digest });
      return Object.freeze({
        outcome: 'AMBIGUOUS',
        graph_receipt: receipt,
        authority_effect: false,
        actuation_eligible: false,
        automatic_retry_allowed: false,
      });
    } catch (error) {
      throw new DurableActionFenceError('action_fence_ambiguity_persistence_failed', {
        recoveryRequired: true,
        cause: error,
      });
    }
  }

  #normalizeOutcome(value) {
    if (!value || typeof value !== 'object' || !OUTCOMES.has(value.outcome)) return { outcome: 'MALFORMED' };
    if (value.outcome === 'COMMITTED' && exactKeys(value, ['outcome', 'effect_receipt_digest'])) return value;
    if (value.outcome === 'NO_EFFECT' && exactKeys(value, ['outcome', 'no_effect_evidence_digest'])) return value;
    if (value.outcome === 'AMBIGUOUS' && exactKeys(value, ['outcome', 'uncertainty_digest'])) return value;
    return { outcome: 'MALFORMED' };
  }
}

export function createDurableActionFence(options) {
  return new DurableActionFence(options);
}
