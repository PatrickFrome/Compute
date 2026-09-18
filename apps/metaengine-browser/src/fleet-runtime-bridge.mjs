import crypto from 'node:crypto';
import { classifyAgentPlatformSurface } from './browser-agent-platform.mjs';

let fleetRuntime = null;

const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
const GENERATION_FLOOR_STATES = new Set(['REGISTERED', 'PROVISIONING', 'BOUND_UNVERIFIED', 'ACTIVE', 'LOST']);

function generationFloor(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('fleet_runtime_generation_floor_invalid');
  return Math.max(1, value);
}

function transportUrl(value) {
  try {
    const surface = classifyAgentPlatformSurface(String(value || ''));
    if (!surface || surface.stage === 'OTHER') return null;
    return Object.freeze({ url: surface.url, stage: surface.stage });
  } catch {
    return null;
  }
}

function exactAgent(snapshot, binding) {
  const agentId = String(binding?.agent_id || '').toLowerCase();
  const tabId = String(binding?.tab_id || '');
  const targetId = String(binding?.target_id || '').toLowerCase();
  const generation = Number(binding?.agent_generation_epoch ?? binding?.generation_epoch);
  const rows = (snapshot?.agents || []).filter((row) => String(row?.agent_id || '').toLowerCase() === agentId);
  if (rows.length !== 1) throw new Error(rows.length ? 'fleet_runtime_agent_identity_ambiguous' : 'fleet_runtime_agent_not_found');
  const agent = rows[0];
  if (!['BOUND_UNVERIFIED', 'ACTIVE'].includes(String(agent.lifecycle_state || ''))) throw new Error(`fleet_runtime_agent_state_invalid:${agent.lifecycle_state}`);
  if (String(agent.tab_id || '') !== tabId) throw new Error('fleet_runtime_tab_binding_mismatch');
  if (String(agent.target_id || '').toLowerCase() !== targetId) throw new Error('fleet_runtime_target_binding_mismatch');
  if (!Number.isSafeInteger(generation) || Number(agent.generation_epoch) !== generation) throw new Error('fleet_runtime_generation_binding_mismatch');
  return agent;
}

export function registerFleetRuntime(fleet) {
  if (!fleet || typeof fleet.snapshot !== 'function' || typeof fleet.markTransportProven !== 'function') {
    throw new Error('fleet_runtime_invalid');
  }
  fleetRuntime = fleet;
  return Object.freeze({ registered: true, authority_effect: false });
}

export function clearFleetRuntime(fleet = null) {
  if (fleet == null || fleetRuntime === fleet) fleetRuntime = null;
  return Object.freeze({ registered: fleetRuntime != null, authority_effect: false });
}

export function fleetRuntimeRegistered() {
  return fleetRuntime != null;
}

export async function adoptFleetGenerationFloor(value) {
  if (!fleetRuntime) throw new Error('fleet_runtime_unavailable');
  if (typeof fleetRuntime.adoptGenerationFloor !== 'function') throw new Error('fleet_runtime_generation_floor_unsupported');
  const floor = generationFloor(value);
  const before = fleetRuntime.snapshot();
  const next = await fleetRuntime.adoptGenerationFloor(value);
  const after = next && typeof next === 'object' ? next : fleetRuntime.snapshot();
  const beforeById = new Map((before?.agents || []).map((row) => [String(row?.agent_id || '').toLowerCase(), row]));
  let changedAgentCount = 0;
  let activeDemotedCount = 0;
  for (const agent of after?.agents || []) {
    if (!GENERATION_FLOOR_STATES.has(String(agent?.lifecycle_state || ''))) continue;
    if (!Number.isSafeInteger(Number(agent?.generation_epoch)) || Number(agent.generation_epoch) < floor) {
      throw new Error('fleet_runtime_generation_floor_not_adopted');
    }
    const previous = beforeById.get(String(agent?.agent_id || '').toLowerCase());
    if (previous && Number(previous.generation_epoch) !== Number(agent.generation_epoch)) changedAgentCount += 1;
    if (previous?.lifecycle_state === 'ACTIVE' && agent.lifecycle_state === 'BOUND_UNVERIFIED') activeDemotedCount += 1;
  }
  return Object.freeze({
    schema: 'metaengine.browser.fleet-generation-floor-adoption.v1',
    state: changedAgentCount > 0 ? 'ADOPTED' : 'NO_AGENT_CHANGE',
    generation_floor: floor,
    changed_agent_count: changedAgentCount,
    active_demoted_count: activeDemotedCount,
    transport_proof_invalidated_on_generation_change: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function assertFleetRuntimeBinding(binding) {
  if (!fleetRuntime) throw new Error('fleet_runtime_unavailable');
  return structuredClone(exactAgent(fleetRuntime.snapshot(), binding));
}

export async function markFleetTransportProvenFromNativeFrame({
  binding,
  frame,
  expected_conversation_url_sha256,
  expected_transport_url_sha256,
} = {}) {
  if (!fleetRuntime) throw new Error('fleet_runtime_unavailable');
  const agent = exactAgent(fleetRuntime.snapshot(), binding);

  if (!frame || frame.schema !== 'metaengine.native-browser.perception.v1' || frame.authority_effect !== false) {
    throw new Error('fleet_runtime_native_frame_invalid');
  }
  if (String(frame.tab_id || '') !== String(agent.tab_id)) throw new Error('fleet_runtime_frame_tab_mismatch');
  if (String(frame.target_id || '').toLowerCase() !== String(agent.target_id).toLowerCase()) throw new Error('fleet_runtime_frame_target_mismatch');
  const processIncarnation = String(frame.process_incarnation_id || '');
  if (!processIncarnation || processIncarnation.length > 160) throw new Error('fleet_runtime_process_incarnation_invalid');
  const transport = transportUrl(frame.url);
  if (!transport) throw new Error('fleet_runtime_transport_url_invalid');
  const expectedHash = String(expected_transport_url_sha256 || expected_conversation_url_sha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || sha256(transport.url) !== expectedHash) {
    throw new Error('fleet_runtime_transport_hash_mismatch');
  }

  if (String(agent.lifecycle_state) === 'ACTIVE') {
    const currentStage = String(agent?.transport_proof?.transport_stage || 'CONVERSATION');
    if (currentStage !== 'PRECONVERSATION_ROOT') {
      return Object.freeze({
        schema: 'metaengine.browser.fleet-native-transport-proof.v1',
        state: 'ALREADY_ACTIVE',
        agent_id: agent.agent_id,
        tab_id: agent.tab_id,
        target_id: agent.target_id,
        generation_epoch: agent.generation_epoch,
        automatic_retry_allowed: false,
        authority_effect: false,
      });
    }
    if (transport.stage !== 'CONVERSATION') {
      return Object.freeze({
        schema: 'metaengine.browser.fleet-native-transport-proof.v1',
        state: 'ALREADY_ACTIVE_PRECONVERSATION',
        agent_id: agent.agent_id,
        tab_id: agent.tab_id,
        target_id: agent.target_id,
        generation_epoch: agent.generation_epoch,
        transport_stage: 'PRECONVERSATION_ROOT',
        automatic_retry_allowed: false,
        authority_effect: false,
      });
    }
    const next = await fleetRuntime.markTransportProven({
      agent_id: agent.agent_id,
      tab_id: agent.tab_id,
      target_id: agent.target_id,
      generation_epoch: agent.generation_epoch,
      conversation_url: transport.url,
    });
    const upgraded = exactAgent(next, binding);
    if (String(upgraded.lifecycle_state) !== 'ACTIVE' || !upgraded.transport_proof) throw new Error('fleet_runtime_transport_proof_not_persisted');
    return Object.freeze({
      schema: 'metaengine.browser.fleet-native-transport-proof.v1',
      state: 'UPGRADED_CONVERSATION',
      agent_id: upgraded.agent_id,
      tab_id: upgraded.tab_id,
      target_id: upgraded.target_id,
      generation_epoch: upgraded.generation_epoch,
      conversation_url_sha256: expectedHash,
      process_incarnation_sha256: sha256(processIncarnation),
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }

  let next;
  let state;
  if (transport.stage === 'PRECONVERSATION_ROOT') {
    if (typeof fleetRuntime.markTransportPreconversationProven !== 'function') {
      throw new Error('fleet_runtime_preconversation_promotion_unsupported');
    }
    next = await fleetRuntime.markTransportPreconversationProven({
      agent_id: agent.agent_id,
      tab_id: agent.tab_id,
      target_id: agent.target_id,
      generation_epoch: agent.generation_epoch,
      transport_url: transport.url,
    });
    state = 'PROVEN_PRECONVERSATION';
  } else {
    next = await fleetRuntime.markTransportProven({
      agent_id: agent.agent_id,
      tab_id: agent.tab_id,
      target_id: agent.target_id,
      generation_epoch: agent.generation_epoch,
      conversation_url: transport.url,
    });
    state = 'PROVEN';
  }
  const active = exactAgent(next, binding);
  if (String(active.lifecycle_state) !== 'ACTIVE' || !active.transport_proof) throw new Error('fleet_runtime_transport_proof_not_persisted');
  if (transport.stage === 'PRECONVERSATION_ROOT' && active.transport_proof.transport_stage !== 'PRECONVERSATION_ROOT') {
    throw new Error('fleet_runtime_preconversation_proof_stage_invalid');
  }

  return Object.freeze({
    schema: 'metaengine.browser.fleet-native-transport-proof.v1',
    state,
    agent_id: active.agent_id,
    tab_id: active.tab_id,
    target_id: active.target_id,
    generation_epoch: active.generation_epoch,
    transport_stage: transport.stage,
    conversation_url_sha256: expectedHash,
    process_incarnation_sha256: sha256(processIncarnation),
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
