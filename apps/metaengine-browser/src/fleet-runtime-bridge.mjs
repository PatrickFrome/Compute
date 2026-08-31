import crypto from 'node:crypto';

let fleetRuntime = null;

const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

function conversationUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !['chatgpt.com', 'www.chatgpt.com'].includes(url.hostname.toLowerCase())) return null;
    const path = url.pathname.replace(/\/+$/, '');
    if (!/^\/c\/[a-z0-9-]+$/i.test(path)) return null;
    return `https://chatgpt.com${path.toLowerCase()}`;
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

export function assertFleetRuntimeBinding(binding) {
  if (!fleetRuntime) throw new Error('fleet_runtime_unavailable');
  return structuredClone(exactAgent(fleetRuntime.snapshot(), binding));
}

export async function markFleetTransportProvenFromNativeFrame({ binding, frame, expected_conversation_url_sha256 } = {}) {
  if (!fleetRuntime) throw new Error('fleet_runtime_unavailable');
  const agent = exactAgent(fleetRuntime.snapshot(), binding);
  if (String(agent.lifecycle_state) !== 'BOUND_UNVERIFIED') {
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

  if (!frame || frame.schema !== 'metaengine.native-browser.perception.v1' || frame.authority_effect !== false) {
    throw new Error('fleet_runtime_native_frame_invalid');
  }
  if (String(frame.tab_id || '') !== String(agent.tab_id)) throw new Error('fleet_runtime_frame_tab_mismatch');
  if (String(frame.target_id || '').toLowerCase() !== String(agent.target_id).toLowerCase()) throw new Error('fleet_runtime_frame_target_mismatch');
  const processIncarnation = String(frame.process_incarnation_id || '');
  if (!processIncarnation || processIncarnation.length > 160) throw new Error('fleet_runtime_process_incarnation_invalid');
  const normalizedUrl = conversationUrl(frame.url);
  if (!normalizedUrl) throw new Error('fleet_runtime_conversation_url_invalid');
  const expectedHash = String(expected_conversation_url_sha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || sha256(normalizedUrl) !== expectedHash) {
    throw new Error('fleet_runtime_conversation_hash_mismatch');
  }

  const next = await fleetRuntime.markTransportProven({
    agent_id: agent.agent_id,
    tab_id: agent.tab_id,
    target_id: agent.target_id,
    generation_epoch: agent.generation_epoch,
    conversation_url: normalizedUrl,
  });
  const active = exactAgent(next, binding);
  if (String(active.lifecycle_state) !== 'ACTIVE' || !active.transport_proof) throw new Error('fleet_runtime_transport_proof_not_persisted');

  return Object.freeze({
    schema: 'metaengine.browser.fleet-native-transport-proof.v1',
    state: 'PROVEN',
    agent_id: active.agent_id,
    tab_id: active.tab_id,
    target_id: active.target_id,
    generation_epoch: active.generation_epoch,
    conversation_url_sha256: expectedHash,
    process_incarnation_sha256: sha256(processIncarnation),
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
