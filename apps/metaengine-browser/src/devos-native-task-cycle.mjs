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
import { markFleetTransportProvenFromNativeFrame } from './fleet-runtime-bridge.mjs';
import { supervisorDeviceStorageDirectory } from './supervisor-device-identity.mjs';

export { normalizeLease, planBacklogCapacity, renderDevosTaskPrompt };

const HASH_RE = /^[a-f0-9]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
const clip = (value, max = 240) => String(value ?? '').slice(0, max);

function transportUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !['chatgpt.com', 'www.chatgpt.com'].includes(url.hostname.toLowerCase())) return null;
    const pathName = url.pathname.replace(/\/+$/, '');
    if (pathName === '') return Object.freeze({ url: 'https://chatgpt.com/', stage: 'PRECONVERSATION_ROOT' });
    if (!/^\/c\/[a-z0-9-]+$/i.test(pathName)) return null;
    return Object.freeze({ url: `https://chatgpt.com${pathName.toLowerCase()}`, stage: 'CONVERSATION' });
  } catch {
    return null;
  }
}

function conversationUrl(value) {
  const transport = transportUrl(value);
  return transport?.stage === 'CONVERSATION' ? transport.url : null;
}

function exactTransportProof(agent) {
  if (String(agent?.lifecycle_state || '') !== 'ACTIVE') return null;
  if (agent?.authority_effect === true || agent?.automatic_retry_allowed === true) return null;
  const proof = agent?.transport_proof;
  if (!proof || proof.schema !== 'metaengine.browser.fleet-transport-proof.v1') return null;
  if (proof.authority_effect !== false) return null;
  const stage = String(proof.transport_stage || 'CONVERSATION');
  if (!['PRECONVERSATION_ROOT', 'CONVERSATION'].includes(stage)) return null;
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

function promotionCandidate(state) {
  const fleet = state?.fleet;
  if (fleet?.schema !== 'metaengine.browser.fleet-snapshot.v1' || fleet?.readiness_contract !== 'TRANSPORT_PROOF_REQUIRED') return null;
  const tabs = new Map((state?.tabs || []).map((row) => [String(row?.tab_id || ''), row]));
  const candidates = (fleet.agents || []).filter((agent) => {
    if (String(agent?.ownership || '') !== 'FLEET_OWNED') return false;
    if (String(agent?.lifecycle_state || '') !== 'BOUND_UNVERIFIED') return false;
    if (agent?.transport_proof != null || agent?.authority_effect === true || agent?.automatic_retry_allowed === true) return false;
    if (!/^agent_[a-z0-9-]{8,64}$/.test(String(agent?.agent_id || '').toLowerCase())) return false;
    if (!String(agent?.tab_id || '') || !/^webcontents:[1-9][0-9]*$/.test(String(agent?.target_id || '').toLowerCase())) return false;
    if (!Number.isSafeInteger(Number(agent?.generation_epoch)) || Number(agent.generation_epoch) < 1) return false;
    // Registry URL is a read-only hint only. Both a fresh ChatGPT root tab and an existing
    // canonical conversation may enter the promotion lease. Exact CAPTURE after lease
    // acquisition remains authoritative; no TYPE or CLICK occurs in this promotion stage.
    return Boolean(transportUrl(tabs.get(String(agent.tab_id))?.url));
  });
  candidates.sort((a, b) => String(a.agent_id).localeCompare(String(b.agent_id)));
  return candidates[0] || null;
}

function promotionBinding(agent) {
  return Object.freeze({
    agent_id: String(agent.agent_id).toLowerCase(),
    tab_id: String(agent.tab_id),
    target_id: String(agent.target_id).toLowerCase(),
    agent_generation_epoch: Number(agent.generation_epoch),
  });
}

async function readJson(response) {
  return response?.json?.().catch(() => ({})) || {};
}

function exactPromotionLease(body, binding) {
  if (!body || body.schema !== 'metaengine.devos.transport-promotion-lease.v1' || body.leased !== true) return null;
  if (body.authority_effect !== false || body.automatic_retry_allowed !== false) return null;
  if (!UUID_RE.test(String(body.lease_id || '')) || body.status !== 'ACTIVE' || body.effect_scope !== 'BROWSER_CLIENT_ACTUATION') return null;
  if (body.effect_key !== `fleet.transport-promotion:${binding.agent_id}`) return null;
  if (String(body.agent_id || '').toLowerCase() !== binding.agent_id || String(body.tab_id || '') !== binding.tab_id) return null;
  if (String(body.target_id || '').toLowerCase() !== binding.target_id || Number(body.agent_generation_epoch) !== binding.agent_generation_epoch) return null;
  if (body.not_expired !== true || body.holder_verified !== true || body.target_verified !== true) return null;
  const expiresAt = Date.parse(String(body.expires_at || ''));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return body;
}

export class DevOsNativeTaskCycle {
  #inner;
  #getState;
  #executeCommand;
  #signedRequest;
  #lastFrames = new Map();
  #lastFleetTransportProof = null;
  #lastTransportPromotion = null;

  constructor(options = {}) {
    const getState = options.getState;
    const executeCommand = options.executeCommand;
    const signedRequest = options.signedRequest;
    if (typeof getState !== 'function' || typeof executeCommand !== 'function' || typeof signedRequest !== 'function') {
      throw new Error('devos_cycle_dependencies_invalid');
    }
    this.#getState = getState;
    this.#signedRequest = signedRequest;

    const strictGetState = async () => transportAdmittedState(await getState());

    const observedExecuteCommand = async (command) => {
      const result = await executeCommand(command);
      if (String(command?.action || '') === 'CAPTURE' && command?.payload?.tab_id) {
        this.#lastFrames.set(String(command.payload.tab_id), structuredClone(result));
      }
      return result;
    };
    this.#executeCommand = observedExecuteCommand;

    const proofGatedSignedRequest = async (requestPath, request = {}) => {
      if (String(requestPath) === '/v1/devos/mark-running') {
        const payload = request?.payload || {};
        let agent = exactFleetAgent(await this.#getState(), payload);
        const expectedHash = String(payload?.proof?.conversation_url_sha256 || '').toLowerCase();
        let frame = this.#lastFrames.get(String(payload.tab_id || '')) || null;
        let normalizedUrl = conversationUrl(frame?.url);

        if (!frame || !normalizedUrl || !HASH_RE.test(expectedHash) || sha256(normalizedUrl) !== expectedHash) {
          frame = await observedExecuteCommand({ action: 'CAPTURE', platform: 'CHATGPT', payload: { tab_id: String(payload.tab_id || '') } });
          normalizedUrl = conversationUrl(frame?.url);
        }

        if (frame?.target_id && String(frame.target_id).toLowerCase() !== String(payload.target_id || '').toLowerCase()) {
          throw new Error('devos_transport_active_frame_target_mismatch');
        }
        if (!normalizedUrl || !HASH_RE.test(expectedHash) || sha256(normalizedUrl) !== expectedHash) {
          throw new Error('devos_transport_active_conversation_hash_mismatch');
        }

        let fleetProof = exactTransportProof(agent);
        let proofState = 'PREEXISTING_ACTIVE_PROOF_REVALIDATED';
        if (String(fleetProof?.transport_stage || 'CONVERSATION') === 'PRECONVERSATION_ROOT') {
          const upgraded = await markFleetTransportProvenFromNativeFrame({
            binding: {
              agent_id: agent.agent_id,
              tab_id: agent.tab_id,
              target_id: agent.target_id,
              agent_generation_epoch: agent.generation_epoch,
            },
            frame,
            expected_conversation_url_sha256: expectedHash,
          });
          if (upgraded?.state !== 'UPGRADED_CONVERSATION') {
            throw new Error('devos_transport_preconversation_upgrade_invalid');
          }
          agent = exactFleetAgent(await this.#getState(), payload);
          fleetProof = exactTransportProof(agent);
          if (String(fleetProof?.transport_stage || 'CONVERSATION') === 'PRECONVERSATION_ROOT') {
            throw new Error('devos_transport_preconversation_upgrade_not_persisted');
          }
          proofState = 'PRECONVERSATION_PROOF_UPGRADED';
        }

        this.#lastFleetTransportProof = {
          schema: 'metaengine.browser.fleet-native-transport-proof.v2',
          state: proofState,
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
      fleet_transport_promotion: this.#lastTransportPromotion ? structuredClone(this.#lastTransportPromotion) : null,
      fleet_transport_proof_before_physical_dispatch: true,
      fleet_transport_proof_before_db_running: true,
      restart_transport_promotion_before_scheduler_cycle: true,
      preconversation_transport_promotion_non_effect: true,
      promotion_fanout_per_cycle: 1,
      durable_effect_delivery_journal: this.#inner.snapshot()?.durable_effect_delivery_journal === true,
      bound_unverified_dispatch_allowed: false,
      authority_effect: this.#inner.snapshot()?.authority_effect === true,
    };
  }

  async #promoteOneRestartTransport() {
    const candidate = promotionCandidate(await this.#getState());
    if (!candidate) {
      this.#lastTransportPromotion = { state: 'NO_ELIGIBLE_CONVERSATION', automatic_retry_allowed: false, authority_effect: false };
      return this.#lastTransportPromotion;
    }

    const binding = promotionBinding(candidate);
    let lease = null;
    let localProof = null;
    let result = {
      state: 'LEASE_NOT_ACQUIRED',
      ...binding,
      automatic_retry_allowed: false,
      authority_effect: false,
    };

    try {
      const response = await this.#signedRequest('/v1/devos/promotion-lease', { payload: binding });
      const body = await readJson(response);
      if (!response?.ok) {
        result = {
          ...result,
          state: response?.status === 404 ? 'ROUTE_UNAVAILABLE' : 'LEASE_FENCED',
          http_status: Number(response?.status || 0),
          reason: clip(body?.reason || body?.error || 'promotion_lease_not_acquired'),
        };
        return result;
      }
      lease = exactPromotionLease(body, binding);
      if (!lease) throw new Error('devos_transport_promotion_lease_readback_invalid');

      const frame = await this.#executeCommand({ action: 'CAPTURE', platform: 'CHATGPT', payload: { tab_id: binding.tab_id } });
      const transport = transportUrl(frame?.url);
      if (!transport) throw new Error('devos_transport_promotion_transport_not_ready');
      if (String(frame?.target_id || '').toLowerCase() !== binding.target_id) throw new Error('devos_transport_promotion_target_drift');

      const expectedHash = sha256(transport.url);
      localProof = await markFleetTransportProvenFromNativeFrame({
        binding,
        frame,
        expected_transport_url_sha256: expectedHash,
      });
      if (!['PROVEN', 'PROVEN_PRECONVERSATION', 'ALREADY_ACTIVE', 'ALREADY_ACTIVE_PRECONVERSATION'].includes(String(localProof?.state || ''))) {
        throw new Error('devos_transport_promotion_local_proof_invalid');
      }
      result = {
        state: 'LOCAL_ACTIVE',
        ...binding,
        lease_id: lease.lease_id,
        transport_stage: transport.stage,
        transport_url_sha256: expectedHash,
        conversation_url_sha256: transport.stage === 'CONVERSATION' ? expectedHash : null,
        local_proof_state: localProof.state,
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    } catch (error) {
      result = {
        ...result,
        state: localProof ? 'LOCAL_ACTIVE_RELEASE_PENDING' : (lease ? 'LOCAL_PROOF_FAILED' : 'LEASE_OUTCOME_AMBIGUOUS'),
        lease_id: lease?.lease_id || null,
        reason: clip(error?.message || error),
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    } finally {
      if (lease?.lease_id) {
        try {
          const response = await this.#signedRequest('/v1/devos/promotion-release', {
            payload: { lease_id: lease.lease_id, agent_id: binding.agent_id },
          });
          const body = await readJson(response);
          const released = response?.ok
            && body?.schema === 'metaengine.devos.transport-promotion-release.v1'
            && body?.released === true
            && body?.authority_effect === false;
          result = {
            ...result,
            release_state: released ? 'CONFIRMED' : 'AMBIGUOUS',
            release_http_status: Number(response?.status || 0),
          };
        } catch (error) {
          result = {
            ...result,
            release_state: 'AMBIGUOUS',
            release_reason: clip(error?.message || error),
          };
        }
      }
    }

    this.#lastTransportPromotion = structuredClone(result);
    return result;
  }

  async cycle() {
    try {
      await this.#promoteOneRestartTransport();
    } catch (error) {
      // Promotion is a bounded pre-admission repair, not a second scheduler. Fail-soft here is
      // safe because the database claim barrier independently rejects any overlapping actuation
      // lease or non-ACTIVE transport identity.
      this.#lastTransportPromotion = {
        state: 'PRE_ADMISSION_REPAIR_FAILED',
        reason: clip(error?.message || error),
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    }
    await this.#inner.cycle();
    return this.snapshot();
  }

  async completeFromTrustedCommand(payload = {}) {
    return this.#inner.completeFromTrustedCommand(payload);
  }
}
