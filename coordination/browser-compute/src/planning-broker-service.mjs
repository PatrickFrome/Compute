import { compileWebMcpRoutingIndex } from '../../browser-shared/webmcp-routing-index-v1.mjs';
import { compileWebMcpToolSearchHandle, searchWebMcpRoutingIndex, validateWebMcpToolSearchQuery } from '../../browser-shared/webmcp-tool-search-v1.mjs';
import { SemanticPlanningBroker } from '../../browser-shared/semantic-planning-broker-v1.mjs';
import { captureComputePerceptionEnvelope } from './perception-envelope.mjs';
import { validateContextId, validateProfileId, validateTargetId } from './security.mjs';
import { ComputeWebMcpService } from './webmcp-service.mjs';

const LOOKUP_SCHEMA = 'metaengine.a2-compute-browser.planning-lookup.v3';
const TOOL_SEARCH_SCHEMA = 'metaengine.a2-compute-browser.planning-tool-search.v1';
const CONTEXT_SCHEMA = 'metaengine.a2-compute-browser.planning-context.v1';
const PROMOTION_SCHEMA = 'metaengine.a2-compute-browser.planning-promotion.v1';
const ABORT_SCHEMA = 'metaengine.a2-compute-browser.planning-abort.v1';
const STATS_SCHEMA = 'metaengine.a2-compute-browser.planning-stats.v1';

function assertRuntime(runtime) {
  if (!runtime || !(runtime.running instanceof Map) || typeof runtime.listTargets !== 'function' || typeof runtime.listContexts !== 'function') throw new Error('planning_broker_runtime_invalid');
  return runtime;
}

function sameCausalNamespace(left, right) {
  return left?.target_id === right?.target_id
    && left?.context_id === right?.context_id
    && Number(left?.conversation_epoch) === Number(right?.conversation_epoch)
    && left?.document_epoch === right?.document_epoch;
}

function fatalWebMcpRoutingError(error) {
  const message = String(error?.message || error || '');
  return /webmcp_(document_changed_during_capture|capture_stale|profile_not_running|perception_runtime_unavailable|target_not_active|target_binding_stale|context_not_active)/.test(message)
    || /planning_(routing|tool_search)_namespace_changed/.test(message)
    || /semantic_planning_broker_lease_invalid/.test(message);
}

function plannerContextBytes(value) {
  return value == null ? 0 : Buffer.byteLength(JSON.stringify(value));
}

export class ComputePlanningBrokerService {
  constructor(runtime, { brokerFactory = () => new SemanticPlanningBroker(), webMcpService = null } = {}) {
    if (!runtime || typeof runtime !== 'object') throw new Error('planning_broker_runtime_missing');
    this.runtime = runtime;
    if (typeof brokerFactory !== 'function') throw new Error('planning_broker_factory_invalid');
    this.brokerFactory = brokerFactory;
    this.webMcpService = webMcpService || new ComputeWebMcpService(runtime);
    if (!this.webMcpService || typeof this.webMcpService.catalog !== 'function') throw new Error('planning_webmcp_service_invalid');
    this.brokers = new Map();
  }

  #runningProfile(profileId) {
    const runtime = assertRuntime(this.runtime);
    const profile = validateProfileId(profileId);
    const entry = runtime.running.get(profile);
    if (!entry?.processRef?.isRunning?.() || !entry.processRef.cdp) throw new Error('planning_profile_not_running');
    if (!entry.sessionScheduler || !Buffer.isBuffer(entry.perceptionNodeKey) || entry.perceptionNodeKey.length < 32) throw new Error('planning_perception_runtime_unavailable');
    return { profile, entry, incarnation: entry.processRef.processIncarnationId };
  }

  #broker(profile, entry) {
    const incarnation = String(entry.processRef.processIncarnationId || '');
    const current = this.brokers.get(profile);
    if (current?.process_incarnation_id === incarnation) return current.broker;
    current?.broker?.clear?.();
    const broker = this.brokerFactory();
    if (!broker || typeof broker.lookup !== 'function' || typeof broker.promote !== 'function' || typeof broker.revalidateContext !== 'function' || typeof broker.assertLease !== 'function') throw new Error('planning_broker_factory_result_invalid');
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
    if (!binding || binding.process_incarnation_id !== incarnation || binding.conversation_epoch !== targetRow.conversation_epoch) throw new Error('planning_target_binding_stale');
    const contextId = validateContextId(targetRow.context_id || 'default');
    const contexts = await this.runtime.listContexts(profile, { includeRetired: false });
    const contextRow = contexts.find((row) => row?.context_id === contextId);
    if (!contextRow || contextRow.status !== 'ACTIVE' || contextRow.bound !== true) throw new Error('planning_context_not_active');
    const identity = { targetId: target, cdpTargetId: binding.cdp_target_id, conversationEpoch: targetRow.conversation_epoch, processIncarnationId: incarnation };
    const captured = await captureComputePerceptionEnvelope({ scheduler: entry.sessionScheduler, identity, contextId, nodeKey: entry.perceptionNodeKey });
    if (!entry.processRef.isRunning() || entry.processRef.processIncarnationId !== incarnation) throw new Error('planning_capture_stale');
    return { profile, entry, target: targetRow, captured };
  }

  async #routeColdLeader({ profileId, targetId, captured }) {
    try {
      const catalog = await this.webMcpService.catalog({ profileId, targetId });
      if (!sameCausalNamespace(catalog, captured.envelope)) throw new Error('planning_routing_namespace_changed');
      if (catalog.status !== 'SUPPORTED') return { surface: 'SEMANTIC_PERCEPTION', semanticEnvelope: captured.envelope, searchHandle: null, degradedReason: 'WEBMCP_UNSUPPORTED' };
      if (catalog.tool_count === 0) return { surface: 'SEMANTIC_PERCEPTION', semanticEnvelope: captured.envelope, searchHandle: null, degradedReason: 'WEBMCP_NO_TOOLS' };
      const searchHandle = compileWebMcpToolSearchHandle(catalog);
      if (!sameCausalNamespace(searchHandle, captured.envelope)) throw new Error('planning_routing_namespace_changed');
      return { surface: 'WEBMCP_TOOL_SEARCH', semanticEnvelope: null, searchHandle, degradedReason: null };
    } catch (error) {
      if (fatalWebMcpRoutingError(error)) throw error;
      return { surface: 'SEMANTIC_PERCEPTION', semanticEnvelope: captured.envelope, searchHandle: null, degradedReason: 'WEBMCP_DISCOVERY_INVALID' };
    }
  }

  async lookup({ profileId, targetId, intentId, actionKind } = {}) {
    const { profile, entry, captured } = await this.#capture(profileId, targetId);
    const broker = this.#broker(profile, entry);
    const lookup = broker.lookup({ envelope: captured.envelope, intentId, actionKind });
    if (lookup.status !== 'MISS_LEADER') {
      return Object.freeze({ schema: LOOKUP_SCHEMA, lookup, planner_context_surface: 'NONE', planner_context_bytes: 0, planning_envelope: null, webmcp_search_handle: null, webmcp_degraded_reason: null, provider_neutral: true, model_execution_location: 'EXTERNAL_AGENT', authority_effect: false, web_authority_effect: false, actuation_eligible: false });
    }
    try {
      const routed = await this.#routeColdLeader({ profileId, targetId, captured });
      const chosen = routed.searchHandle || routed.semanticEnvelope;
      return Object.freeze({ schema: LOOKUP_SCHEMA, lookup, planner_context_surface: routed.surface, planner_context_bytes: plannerContextBytes(chosen), planning_envelope: routed.semanticEnvelope, webmcp_search_handle: routed.searchHandle, webmcp_degraded_reason: routed.degradedReason, provider_neutral: true, model_execution_location: 'EXTERNAL_AGENT', authority_effect: false, web_authority_effect: false, actuation_eligible: false });
    } catch (error) {
      try { broker.abort({ flightId: lookup.flight_id, leaseToken: lookup.lease_token, reasonCode: 'ROUTING_CONTEXT_FAILED' }); } catch (_) {}
      throw error;
    }
  }

  async searchTools({ profileId, targetId, flightId, leaseToken, query } = {}) {
    const { profile, entry } = this.#runningProfile(profileId);
    const broker = this.#broker(profile, entry);
    const lease = broker.assertLease({ flightId, leaseToken });
    const target = validateTargetId(targetId);
    if (lease.target_id !== target) throw new Error('planning_tool_search_target_mismatch');
    validateWebMcpToolSearchQuery(query);
    try {
      const catalog = await this.webMcpService.catalog({ profileId: profile, targetId: target });
      const postflightLease = broker.assertLease({ flightId, leaseToken });
      if (postflightLease.target_id !== target) throw new Error('planning_tool_search_target_mismatch');
      if (!sameCausalNamespace(catalog, postflightLease)) throw new Error('planning_tool_search_namespace_changed');
      if (catalog.status !== 'SUPPORTED' || catalog.tool_count === 0) {
        return Object.freeze({ schema: TOOL_SEARCH_SCHEMA, status: 'UNAVAILABLE', reason: catalog.status === 'SUPPORTED' ? 'WEBMCP_NO_TOOLS' : 'WEBMCP_UNSUPPORTED', flight_id: postflightLease.flight_id, search_result: null, fresh_toolset_used: true, lease_postflight_used: true, semantic_fallback_available: true, query_persisted: false, authority_effect: false, web_authority_effect: false, actuation_eligible: false });
      }
      const index = compileWebMcpRoutingIndex(catalog);
      if (!sameCausalNamespace(index, postflightLease)) throw new Error('planning_tool_search_namespace_changed');
      const result = searchWebMcpRoutingIndex(index, query);
      return Object.freeze({ schema: TOOL_SEARCH_SCHEMA, status: result.status, reason: null, flight_id: postflightLease.flight_id, search_result: result, fresh_toolset_used: true, lease_postflight_used: true, semantic_fallback_available: true, query_persisted: false, authority_effect: false, web_authority_effect: false, actuation_eligible: false });
    } catch (error) {
      if (fatalWebMcpRoutingError(error)) {
        try { broker.abort({ flightId, leaseToken, reasonCode: 'TOOL_SEARCH_FENCE_FAILED' }); } catch (_) {}
        throw error;
      }
      return Object.freeze({ schema: TOOL_SEARCH_SCHEMA, status: 'UNAVAILABLE', reason: 'WEBMCP_SEARCH_INVALID', flight_id: lease.flight_id, search_result: null, fresh_toolset_used: true, lease_postflight_used: false, semantic_fallback_available: true, query_persisted: false, authority_effect: false, web_authority_effect: false, actuation_eligible: false });
    }
  }

  async context({ profileId, targetId, flightId, leaseToken, surface = 'SEMANTIC_PERCEPTION' } = {}) {
    if (surface !== 'SEMANTIC_PERCEPTION') throw new Error('planning_context_surface_invalid');
    const { profile, entry } = this.#runningProfile(profileId);
    const broker = this.#broker(profile, entry);
    const lease = broker.assertLease({ flightId, leaseToken });
    if (lease.target_id !== validateTargetId(targetId)) throw new Error('planning_context_target_mismatch');
    const captured = await this.#capture(profile, targetId);
    const revalidation = broker.revalidateContext({ flightId, leaseToken, freshEnvelope: captured.captured.envelope });
    return Object.freeze({ schema: CONTEXT_SCHEMA, surface: 'SEMANTIC_PERCEPTION', revalidation, planning_envelope: captured.captured.envelope, planner_context_bytes: plannerContextBytes(captured.captured.envelope), fresh_capture_used: true, lease_preflight_used: true, lease_bound: true, provider_neutral: true, authority_effect: false, web_authority_effect: false, actuation_eligible: false });
  }

  async promote({ profileId, targetId, flightId, leaseToken, candidateRef } = {}) {
    const { profile, entry, captured } = await this.#capture(profileId, targetId);
    const promotion = this.#broker(profile, entry).promote({ flightId, leaseToken, candidateRef, freshEnvelope: captured.envelope });
    return Object.freeze({ schema: PROMOTION_SCHEMA, promotion, fresh_document_epoch: captured.envelope.document_epoch, authority_effect: false, web_authority_effect: false, actuation_eligible: false });
  }

  abort({ profileId, flightId, leaseToken, reasonCode } = {}) {
    const { profile, entry } = this.#runningProfile(profileId);
    const aborted = this.#broker(profile, entry).abort({ flightId, leaseToken, reasonCode });
    return Object.freeze({ schema: ABORT_SCHEMA, aborted, authority_effect: false, web_authority_effect: false, actuation_eligible: false });
  }

  stats({ profileId } = {}) {
    const { profile, entry } = this.#runningProfile(profileId);
    return Object.freeze({ schema: STATS_SCHEMA, profile_id: profile, broker: this.#broker(profile, entry).snapshot(), provider_credentials_stored: false, execution_payload_stored: false, authority_effect: false, web_authority_effect: false, actuation_eligible: false });
  }

  clear() {
    let removed = 0;
    for (const value of this.brokers.values()) removed += Number(value?.broker?.clear?.() || 0);
    this.brokers.clear();
    return removed;
  }
}

export const COMPUTE_PLANNING_LOOKUP_SCHEMA = LOOKUP_SCHEMA;
export const COMPUTE_PLANNING_TOOL_SEARCH_SCHEMA = TOOL_SEARCH_SCHEMA;
export const COMPUTE_PLANNING_CONTEXT_SCHEMA = CONTEXT_SCHEMA;
export const COMPUTE_PLANNING_PROMOTION_SCHEMA = PROMOTION_SCHEMA;
export const COMPUTE_PLANNING_ABORT_SCHEMA = ABORT_SCHEMA;
export const COMPUTE_PLANNING_STATS_SCHEMA = STATS_SCHEMA;
