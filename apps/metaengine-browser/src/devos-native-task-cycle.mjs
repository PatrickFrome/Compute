import crypto from 'node:crypto';
import path from 'node:path';
import {
  DevOsNativeTaskCycle as CoreDevOsNativeTaskCycle,
  assertLiveLeaseBinding as assertCoreLiveLeaseBinding,
  normalizeLease,
  planBacklogCapacity,
  renderDevosTaskPrompt,
} from './devos-native-task-cycle-core.mjs';
import {
  DevOsEffectDeliveryJournal,
  DEVOS_EFFECT_DELIVERY_JOURNAL_FILE,
} from './devos-effect-delivery-journal.mjs';
import { supervisorDeviceStorageDirectory } from './supervisor-device-identity.mjs';

export { normalizeLease, planBacklogCapacity, renderDevosTaskPrompt };

const HASH_RE = /^[a-f0-9]{64}$/;
const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');

function conversationUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !['chatgpt.com', 'www.chatgpt.com'].includes(url.hostname.toLowerCase())) return null;
    const pathName = url.pathname.replace(/\/+$/, '');
    if (!/^\/c\/[a-z0-9-]+$/i.test(pathName)) return null;
    return `https://chatgpt.com${pathName.toLowerCase()}`;
  } catch {
    return null;
  }
}

function exactTransportProof(agent) {
  if (String(agent?.lifecycle_state || '') !== 'ACTIVE') return null;
  if (agent?.authority_effect === true || agent?.automatic_retry_allowed === true) return null;
  const proof = agent?.transport_proof;
  if (!proof || proof.schema !== 'metaengine.browser.fleet-transport-proof.v1') return null;
  if (proof.authority_effect !== false) return null;
  if (String(proof.tab_id || '') !== String(agent.tab_id || '')) return null;
  if (String(proof.target_id || '').toLowerCase() !== String(agent.target_id || '').toLowerCase()) return null;
  if (Number(proof.generation_epoch) !== Number(agent.generation_epoch)) return null;
  if (!HASH_RE.test(String(proof.conversation_url_sha256 || '').toLowerCase())) return null;
  const provenAt = Date.parse(String(proof.proven_at || ''));
  if (!Number.isFinite(provenAt)) return null;
  return proof;
}

function transportAdmittedFleet(fleet) {
  const cloned = structuredClone(fleet || {});
  const schemaOk = cloned?.schema === 'metaengine.browser.fleet-snapshot.v1';
  const readinessOk = cloned?.readiness_contract === 'TRANSPORT_PROOF_REQUIRED';
  cloned.agents = Array.isArray(cloned?.agents) ? cloned.agents.map((agent) => {
    const admitted = schemaOk && readinessOk && Boolean(exactTransportProof(agent));
    return admitted ? agent : { ...agent, lifecycle_state: 'ADMISSION_FENCED', transport_admission: 'EXACT_ACTIVE_PROOF_REQUIRED' };
  }) : [];
  cloned.transport_admission = schemaOk && readinessOk ? 'EXACT_ACTIVE_PROOF_REQUIRED' : 'FLEET_CONTRACT_INVALID';
  cloned.authority_effect = false;
  return cloned;
}

function transportAdmittedState(state) {
  const cloned = structuredClone(state || {});
  cloned.fleet = transportAdmittedFleet(cloned.fleet);
  return cloned;
}

export function assertLiveLeaseBinding(lease, fleetSnapshot) {
  return assertCoreLiveLeaseBinding(lease, transportAdmittedFleet(fleetSnapshot));
}

function exactFleetAgent(state, payload) {
  const fleet = state?.fleet;
  if (fleet?.schema !== 'metaengine.browser.fleet-snapshot.v1' || fleet?.readiness_contract !== 'TRANSPORT_PROOF_REQUIRED') {
    throw new Error('devos_transport_fleet_contract_invalid');
  }
  const agentId = String(payload?.agent_id || '').toLowerCase();
  const rows = (fleet?.agents || []).filter((row) => String(row?.agent_id || '').toLowerCase() === agentId);
  if (rows.length !== 1) throw new Error(rows.length ? 'devos_transport_agent_ambiguous' : 'devos_transport_agent_missing');
  const agent = rows[0];
  if (String(agent.lifecycle_state || '') !== 'ACTIVE') throw new Error(`devos_transport_agent_state_invalid:${agent.lifecycle_state}`);
  if (!exactTransportProof(agent)) throw new Error('devos_transport_active_proof_invalid');
  if (String(agent.tab_id || '') !== String(payload?.tab_id || '')) throw new Error('devos_transport_tab_binding_mismatch');
  if (String(agent.target_id || '').toLowerCase() !== String(payload?.target_id || '').toLowerCase()) throw new Error('devos_transport_target_binding_mismatch');
  if (Number(agent.generation_epoch) !== Number(payload?.agent_generation_epoch)) throw new Error('devos_transport_generation_binding_mismatch');
  if (String(agent.role || '').toUpperCase() !== String(payload?.role || agent.role || '').toUpperCase()) throw new Error('devos_transport_role_binding_mismatch');
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

    const strictGetState = async () => transportAdmittedState(await getState());

    const observedExecuteCommand = async (command) => {
      const result = await executeCommand(command);
      if (String(command?.action || '') === 'CAPTURE' && command?.payload?.tab_id) {
        this.#lastFrames.set(String(command.payload.tab_id), structuredClone(result));
      }
      return result;
    };

    const proofGatedSignedRequest = async (requestPath, request = {}) => {
      if (String(requestPath) === '/v1/devos/mark-running') {
        const payload = request?.payload || {};
        const agent = exactFleetAgent(await this.#getState(), payload);
        const frame = this.#lastFrames.get(String(payload.tab_id || '')) || null;
        const expectedHash = String(payload?.proof?.conversation_url_sha256 || '').toLowerCase();
        const normalizedUrl = conversationUrl(frame?.url);
        const fleetProof = exactTransportProof(agent);

        if (frame?.target_id && String(frame.target_id).toLowerCase() !== String(payload.target_id || '').toLowerCase()) {
          throw new Error('devos_transport_active_frame_target_mismatch');
        }
        if (!normalizedUrl || !HASH_RE.test(expectedHash) || sha256(normalizedUrl) !== expectedHash) {
          throw new Error('devos_transport_active_conversation_hash_mismatch');
        }

        this.#lastFleetTransportProof = {
          schema: 'metaengine.browser.fleet-native-transport-proof.v2',
          state: 'PREEXISTING_ACTIVE_PROOF_REVALIDATED',
          agent_id: agent.agent_id,
          tab_id: agent.tab_id,
          target_id: agent.target_id,
          generation_epoch: agent.generation_epoch,
          fleet_proven_at: fleetProof.proven_at,
          conversation_url_sha256: expectedHash,
          automatic_retry_allowed: false,
          authority_effect: false,
        };
      }
      return signedRequest(requestPath, request);
    };

    const storageDir = supervisorDeviceStorageDirectory();
    const effectJournal = options.effectJournal || (storageDir ? new DevOsEffectDeliveryJournal({
      statePath: path.join(storageDir, DEVOS_EFFECT_DELIVERY_JOURNAL_FILE),
    }) : null);

    this.#inner = new CoreDevOsNativeTaskCycle({
      ...options,
      getState: strictGetState,
      executeCommand: observedExecuteCommand,
      signedRequest: proofGatedSignedRequest,
      effectJournal,
    });
  }

  snapshot() {
    return {
      ...this.#inner.snapshot(),
      fleet_transport_proof: this.#lastFleetTransportProof ? structuredClone(this.#lastFleetTransportProof) : null,
      fleet_transport_proof_before_physical_dispatch: true,
      fleet_transport_proof_before_db_running: true,
      durable_effect_delivery_journal: this.#inner.snapshot()?.durable_effect_delivery_journal === true,
      bound_unverified_dispatch_allowed: false,
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