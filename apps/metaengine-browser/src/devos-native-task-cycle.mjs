import crypto from 'node:crypto';
import {
  DevOsNativeTaskCycle as CoreDevOsNativeTaskCycle,
  assertLiveLeaseBinding,
  normalizeLease,
  planBacklogCapacity,
  renderDevosTaskPrompt,
} from './devos-native-task-cycle-core.mjs';
import {
  fleetRuntimeRegistered,
  markFleetTransportProvenFromNativeFrame,
} from './fleet-runtime-bridge.mjs';

export { assertLiveLeaseBinding, normalizeLease, planBacklogCapacity, renderDevosTaskPrompt };

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

function exactFleetAgent(state, payload) {
  const fleet = state?.fleet;
  const agentId = String(payload?.agent_id || '').toLowerCase();
  const rows = (fleet?.agents || []).filter((row) => String(row?.agent_id || '').toLowerCase() === agentId);
  if (rows.length !== 1) throw new Error(rows.length ? 'devos_transport_agent_ambiguous' : 'devos_transport_agent_missing');
  const agent = rows[0];
  if (String(agent.tab_id || '') !== String(payload?.tab_id || '')) throw new Error('devos_transport_tab_binding_mismatch');
  if (String(agent.target_id || '').toLowerCase() !== String(payload?.target_id || '').toLowerCase()) throw new Error('devos_transport_target_binding_mismatch');
  if (Number(agent.generation_epoch) !== Number(payload?.agent_generation_epoch)) throw new Error('devos_transport_generation_binding_mismatch');
  return agent;
}

export class DevOsNativeTaskCycle {
  #inner;
  #getState;
  #lastFrames = new Map();
  #lastFleetTransportProof = null;

  constructor(options = {}) {
    const getState = options.getState;
    const executeCommand = options.executeCommand;
    const signedRequest = options.signedRequest;
    if (typeof getState !== 'function' || typeof executeCommand !== 'function' || typeof signedRequest !== 'function') {
      throw new Error('devos_cycle_dependencies_invalid');
    }
    this.#getState = getState;

    const observedExecuteCommand = async (command) => {
      const result = await executeCommand(command);
      if (String(command?.action || '') === 'CAPTURE' && command?.payload?.tab_id) {
        this.#lastFrames.set(String(command.payload.tab_id), structuredClone(result));
      }
      return result;
    };

    const proofGatedSignedRequest = async (path, request = {}) => {
      if (String(path) === '/v1/devos/mark-running') {
        const payload = request?.payload || {};
        const agent = exactFleetAgent(await this.#getState(), payload);
        const frame = this.#lastFrames.get(String(payload.tab_id || '')) || null;
        const expectedHash = String(payload?.proof?.conversation_url_sha256 || '').toLowerCase();
        const normalizedUrl = conversationUrl(frame?.url);

        if (String(agent.lifecycle_state) === 'BOUND_UNVERIFIED') {
          if (!fleetRuntimeRegistered()) throw new Error('devos_fleet_runtime_transport_proof_unavailable');
          this.#lastFleetTransportProof = await markFleetTransportProvenFromNativeFrame({
            binding: payload,
            frame,
            expected_conversation_url_sha256: expectedHash,
          });
        } else if (String(agent.lifecycle_state) === 'ACTIVE') {
          if (frame?.target_id && String(frame.target_id).toLowerCase() !== String(payload.target_id || '').toLowerCase()) {
            throw new Error('devos_transport_active_frame_target_mismatch');
          }
          if (normalizedUrl && /^[a-f0-9]{64}$/.test(expectedHash) && sha256(normalizedUrl) !== expectedHash) {
            throw new Error('devos_transport_active_conversation_hash_mismatch');
          }
          this.#lastFleetTransportProof = {
            schema: 'metaengine.browser.fleet-native-transport-proof.v1',
            state: 'ALREADY_ACTIVE',
            agent_id: agent.agent_id,
            tab_id: agent.tab_id,
            target_id: agent.target_id,
            generation_epoch: agent.generation_epoch,
            automatic_retry_allowed: false,
            authority_effect: false,
          };
        } else {
          throw new Error(`devos_transport_agent_state_invalid:${agent.lifecycle_state}`);
        }
      }
      return signedRequest(path, request);
    };

    this.#inner = new CoreDevOsNativeTaskCycle({
      ...options,
      getState,
      executeCommand: observedExecuteCommand,
      signedRequest: proofGatedSignedRequest,
    });
  }

  snapshot() {
    return {
      ...this.#inner.snapshot(),
      fleet_transport_proof: this.#lastFleetTransportProof ? structuredClone(this.#lastFleetTransportProof) : null,
      fleet_transport_proof_before_db_running: true,
      authority_effect: this.#inner.snapshot()?.authority_effect === true,
    };
  }

  async cycle() {
    await this.#inner.cycle();
    return this.snapshot();
  }

  async completeFromTrustedCommand(payload = {}) {
    return this.#inner.completeFromTrustedCommand(payload);
  }
}
