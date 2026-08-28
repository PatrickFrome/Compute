import { SemanticPlanningBroker } from '../../browser-shared/semantic-planning-broker-v1.mjs';
import { captureComputePerceptionEnvelope } from './perception-envelope.mjs';
import { validateContextId, validateProfileId, validateTargetId } from './security.mjs';

const LOOKUP_SCHEMA = 'metaengine.a2-compute-browser.planning-lookup.v1';
const PROMOTION_SCHEMA = 'metaengine.a2-compute-browser.planning-promotion.v1';
const ABORT_SCHEMA = 'metaengine.a2-compute-browser.planning-abort.v1';
const STATS_SCHEMA = 'metaengine.a2-compute-browser.planning-stats.v1';

function assertRuntime(runtime) {
  if (!runtime || !(runtime.running instanceof Map) || typeof runtime.listTargets !== 'function' || typeof runtime.listContexts !== 'function') {
    throw new Error('planning_broker_runtime_invalid');
  }
  return runtime;
}

export class ComputePlanningBrokerService {
  constructor(runtime, { brokerFactory = () => new SemanticPlanningBroker() } = {}) {
    if (!runtime || typeof runtime !== 'object') throw new Error('planning_broker_runtime_missing');
    this.runtime = runtime;
    if (typeof brokerFactory !== 'function') throw new Error('planning_broker_factory_invalid');
    this.brokerFactory = brokerFactory;
    this.brokers = new Map();
  }

  #runningProfile(profileId) {
    const runtime = assertRuntime(this.runtime);
    const profile = validateProfileId(profileId);
    const entry = runtime.running.get(profile);
    if (!entry?.processRef?.isRunning?.() || !entry.processRef.cdp) throw new Error('planning_profile_not_running');
    if (!entry.sessionScheduler || !Buffer.isBuffer(entry.perceptionNodeKey) || entry.perceptionNodeKey.length < 32) {
      throw new Error('planning_perception_runtime_unavailable');
    }
    return { profile, entry, incarnation: entry.processRef.processIncarnationId };
  }

  #broker(profile, entry) {
    const incarnation = String(entry.processRef.processIncarnationId || '');
    const current = this.brokers.get(profile);
    if (current?.process_incarnation_id === incarnation) return current.broker;
    current?.broker?.clear?.();
    const broker = this.brokerFactory();
    if (!broker || typeof broker.lookup !== 'function' || typeof broker.promote !== 'function') {
      throw new Error('planning_broker_factory_result_invalid');
    }
    this.brokers.set(profile, { process_incarnation_id: incarnation, broker });
    return broker;
  }

  async #capture(profileId, targetId) {
    const { profile, entry, incarnation } = this.#runningProfile(profileId);
    const target = validateTargetId(targetId);
    const targets = await this.runtime.listTargets(profile, { includeRetired: false });
    const targetRow = targets.find((row) => row?.target_id === target);
    if (!targetRow || targetRow.status !== 'ACTIVE' || targetRow.bound !== true) throw new Error('planning_target_not_active');

    const binding = entry.bindings?.get?.(target);
    if (!binding || binding.process_incarnation_id !== incarnation || binding.conversation_epoch !== targetRow.conversation_epoch) {
      throw new Error('planning_target_binding_stale');
    }

    const contextId = validateContextId(targetRow.context_id || 'default');
    const contexts = await this.runtime.listContexts(profile, { includeRetired: false });
    const contextRow = contexts.find((row) => row?.context_id === contextId);
    if (!contextRow || contextRow.status !== 'ACTIVE' || contextRow.bound !== true) throw new Error('planning_context_not_active');

    const identity = {
      targetId: target,
      cdpTargetId: binding.cdp_target_id,
      conversationEpoch: targetRow.conversation_epoch,
      processIncarnationId: incarnation
    };
    const captured = await captureComputePerceptionEnvelope({
      scheduler: entry.sessionScheduler,
      identity,
      contextId,
      nodeKey: entry.perceptionNodeKey
    });
    if (!entry.processRef.isRunning() || entry.processRef.processIncarnationId !== incarnation) {
      throw new Error('planning_capture_stale');
    }
    return { profile, entry, target: targetRow, captured };
  }

  async lookup({ profileId, targetId, intentId, actionKind } = {}) {
    const { profile, entry, captured } = await this.#capture(profileId, targetId);
    const lookup = this.#broker(profile, entry).lookup({
      envelope: captured.envelope,
      intentId,
      actionKind
    });
    return Object.freeze({
      schema: LOOKUP_SCHEMA,
      lookup,
      planning_envelope: lookup.status === 'MISS_LEADER' ? captured.envelope : null,
      provider_neutral: true,
      model_execution_location: 'EXTERNAL_AGENT',
      authority_effect: false,
      web_authority_effect: false,
      actuation_eligible: false
    });
  }

  async promote({ profileId, targetId, flightId, leaseToken, candidateRef } = {}) {
    const { profile, entry, captured } = await this.#capture(profileId, targetId);
    const promotion = this.#broker(profile, entry).promote({
      flightId,
      leaseToken,
      candidateRef,
      freshEnvelope: captured.envelope
    });
    return Object.freeze({
      schema: PROMOTION_SCHEMA,
      promotion,
      fresh_document_epoch: captured.envelope.document_epoch,
      authority_effect: false,
      web_authority_effect: false,
      actuation_eligible: false
    });
  }

  abort({ profileId, flightId, leaseToken, reasonCode } = {}) {
    const { profile, entry } = this.#runningProfile(profileId);
    const aborted = this.#broker(profile, entry).abort({ flightId, leaseToken, reasonCode });
    return Object.freeze({
      schema: ABORT_SCHEMA,
      aborted,
      authority_effect: false,
      web_authority_effect: false,
      actuation_eligible: false
    });
  }

  stats({ profileId } = {}) {
    const { profile, entry } = this.#runningProfile(profileId);
    return Object.freeze({
      schema: STATS_SCHEMA,
      profile_id: profile,
      broker: this.#broker(profile, entry).snapshot(),
      provider_credentials_stored: false,
      execution_payload_stored: false,
      authority_effect: false,
      web_authority_effect: false,
      actuation_eligible: false
    });
  }

  clear() {
    let removed = 0;
    for (const value of this.brokers.values()) {
      removed += Number(value?.broker?.clear?.() || 0);
    }
    this.brokers.clear();
    return removed;
  }
}

export const COMPUTE_PLANNING_LOOKUP_SCHEMA = LOOKUP_SCHEMA;
export const COMPUTE_PLANNING_PROMOTION_SCHEMA = PROMOTION_SCHEMA;
export const COMPUTE_PLANNING_ABORT_SCHEMA = ABORT_SCHEMA;
export const COMPUTE_PLANNING_STATS_SCHEMA = STATS_SCHEMA;
