import crypto from 'node:crypto';
import path from 'node:path';
import {
  AGENT_PLATFORM_ID,
  AGENT_PLATFORM_HOME_URL,
  AGENT_PLATFORM_MODEL,
  AGENT_PLATFORM_BOOTSTRAP_MODE,
  classifyAgentPlatformSurface,
  resolveAgentPlatformAgentSurface,
  resolveAgentPlatformComposer,
  resolveAgentPlatformModelOption,
  resolveAgentPlatformNavControl,
  resolveAgentPlatformSelectedModel,
} from './browser-agent-platform.mjs';
import { digestAgentSurfaceProof } from './agent-origin-proof.mjs';
import { submitFencedChatGptPrompt } from './chatgpt-fenced-submit.mjs';
import {
  DevOsNativeTaskCycle as CoreDevOsNativeTaskCycle,
  AGENT_ROOT_CONVERSATION_SEED,
  assertLiveLeaseBinding as assertCoreLiveLeaseBinding,
  normalizeLease,
  planBacklogCapacity,
  renderDevosTaskPrompt,
} from './devos-native-task-cycle-core.mjs';
import {
  DevOsEffectDeliveryJournal,
  DEVOS_EFFECT_DELIVERY_JOURNAL_FILE,
} from './devos-effect-delivery-journal.mjs';
import {
  adoptFleetGenerationFloor,
  beginFleetTransportBootstrapAttempt,
  markFleetTransportProvenFromNativeFrame,
} from './fleet-runtime-bridge.mjs';
import { normalizeDevosRuntimeControl } from './devos-runtime-control.mjs';
import { supervisorDeviceStorageDirectory } from './supervisor-device-identity.mjs';
import {
  ELASTIC_FLEET_CONTRACT,
  planElasticFleetCapacity,
  retireEligibleFleetAgents,
} from './fleet-elastic-governor.mjs';

export { normalizeLease, planBacklogCapacity, renderDevosTaskPrompt };
export { ELASTIC_FLEET_CONTRACT, planElasticFleetCapacity, retireEligibleFleetAgents };

const HASH_RE = /^[a-f0-9]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256 = (value) => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
const clip = (value, max = 240) => String(value ?? '').slice(0, max);

function semanticActivationPayload(tabId, control) {
  if (!control?.semantic_ref || !control?.role) throw new Error('devos_agent_semantic_control_invalid');
  return {
    tab_id: String(tabId || ''),
    role: String(control.role),
    accessible_name: control.accessible_name == null ? null : String(control.accessible_name),
    semantic_ref: control.semantic_ref,
  };
}

async function discoverAgentNavControlByKeyboard({
  executeCommand,
  binding,
  initialFrame,
  maxTabSteps = 18,
} = {}) {
  if (typeof executeCommand !== 'function') throw new Error('devos_agent_nav_discovery_executor_required');
  let frame = initialFrame;
  let control = resolveAgentPlatformNavControl(frame, 'Agent');
  if (control?.semantic_ref) {
    return Object.freeze({ state: 'FOUND', frame, control, tab_steps: 0, authority_effect: false });
  }

  const seenFocus = new Set();
  for (let step = 1; step <= maxTabSteps; step += 1) {
    // Tab changes only keyboard focus; it does not submit text, create a task,
    // or invoke page geometry. Every step is followed by a fresh perception
    // proof before another step is allowed.
    await executeCommand({
      action: 'PRESS_KEY',
      platform: AGENT_PLATFORM_ID,
      payload: { tab_id: binding.tab_id, key: 'Tab' },
    });
    frame = await executeCommand({
      action: 'CAPTURE',
      platform: AGENT_PLATFORM_ID,
      payload: { tab_id: binding.tab_id },
    });
    if (String(frame?.target_id || '').toLowerCase() !== String(binding.target_id || '').toLowerCase()) {
      throw new Error('devos_agent_nav_discovery_target_drift');
    }
    control = resolveAgentPlatformNavControl(frame, 'Agent');
    if (control?.semantic_ref) {
      return Object.freeze({ state: 'FOUND', frame, control, tab_steps: step, authority_effect: false });
    }

    const focused = frame?.focused_target || null;
    const focusKey = focused
      ? [String(focused.role || ''), String(focused.name || ''), Number(focused.backend_node_id || 0)].join(':')
      : null;
    if (focusKey) {
      if (seenFocus.has(focusKey)) {
        return Object.freeze({ state: 'FOCUS_CYCLE', frame, control: null, tab_steps: step, authority_effect: false });
      }
      seenFocus.add(focusKey);
    }
  }

  return Object.freeze({ state: 'NOT_FOUND', frame, control: null, tab_steps: maxTabSteps, authority_effect: false });
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

function conversationUrl(value) {
  const transport = transportUrl(value);
  return transport?.stage === 'CONVERSATION' ? transport.url : null;
}

function exactTransportProof(agent) {
  // Task admission requires a canonical conversation. Root transport reachability
  // is intentionally not enough: PRECONVERSATION_ROOT may contain an account-
  // synced dirty draft and is not a runnable chat-agent.
  if (String(agent?.lifecycle_state || '') !== 'ACTIVE') return null;
  if (agent?.authority_effect === true || agent?.automatic_retry_allowed === true) return null;
  const proof = agent?.transport_proof;
  if (!proof || proof.schema !== 'metaengine.browser.fleet-transport-proof.v1') return null;
  if (proof.authority_effect !== false) return null;
  const stage = String(proof.transport_stage || 'CONVERSATION');
  if (stage !== 'CONVERSATION') return null;
  if (String(proof.tab_id || '') !== String(agent.tab_id || '')) return null;
  if (String(proof.target_id || '').toLowerCase() !== String(agent.target_id || '').toLowerCase()) return null;
  if (Number(proof.generation_epoch) !== Number(agent.generation_epoch)) return null;
  const normalizedConversation = conversationUrl(proof.conversation_url);
  const conversationHash = String(proof.conversation_url_sha256 || '').toLowerCase();
  if (!normalizedConversation || !HASH_RE.test(conversationHash) || sha256(normalizedConversation) !== conversationHash) return null;
  if (!HASH_RE.test(String(proof.agent_surface_sha256 || '').toLowerCase())) return null;
  const provenAt = Date.parse(String(proof.proven_at || ''));
  if (!Number.isFinite(provenAt)) return null;
  return proof;
}

function exactPreconversationProof(agent) {
  if (String(agent?.lifecycle_state || '') !== 'BOUND_UNVERIFIED') return null;
  if (agent?.authority_effect === true || agent?.automatic_retry_allowed === true) return null;
  const proof = agent?.transport_proof;
  if (!proof || proof.schema !== 'metaengine.browser.fleet-transport-proof.v1') return null;
  if (proof.authority_effect !== false || proof.transport_stage !== 'PRECONVERSATION_ROOT') return null;
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
    if (agent?.authority_effect === true || agent?.automatic_retry_allowed === true) return false;
    if (agent?.transport_proof != null && !exactPreconversationProof(agent)) return false;
    if (!/^agent_[a-z0-9-]{8,64}$/.test(String(agent?.agent_id || '').toLowerCase())) return false;
    if (!String(agent?.tab_id || '') || !/^webcontents:[1-9][0-9]*$/.test(String(agent?.target_id || '').toLowerCase())) return false;
    if (!Number.isSafeInteger(Number(agent?.generation_epoch)) || Number(agent.generation_epoch) < 1) return false;
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

function exactPreEffectRequeue(body, lease) {
  return Boolean(
    body?.schema === 'metaengine.devos.ambiguity-reconciliation.v1'
    && String(body.task_id || '').toLowerCase() === lease.task_id
    && Number(body.lease_generation) === lease.lease_generation
    && String(body.state || '').toUpperCase() === 'READY'
    && String(body.recovery_class || '').toUpperCase() === 'PRE_EFFECT_ABORTED'
    && body.retry_via_scheduler === true
    && body.physical_effect_replayed === false
    && body.new_lease_generation_allocated === false
    && body.automatic_retry_allowed === false
    && body.authority_effect === false
  );
}

export class DevOsNativeTaskCycle {
  #inner;
  #getState;
  #executeCommand;
  #signedRequest;
  #lastFrames = new Map();
  #lastFleetTransportProof = null;
  #lastTransportPromotion = null;
  #lastGenerationFloorAdoption = null;
  #currentCycleLease = null;
  #taskEffectAttempted = false;
  #lastPreEffectReconciliation = null;

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
      const action = String(command?.action || '');
      const tabId = String(command?.payload?.tab_id || '');
      if (this.#currentCycleLease && ['SEMANTIC_TYPE','TYPED_CLICK'].includes(action) && tabId === String(this.#currentCycleLease.tab_id || '')) {
        // Mark before invoking the physical command. A thrown type/click is effect-ambiguous.
        this.#taskEffectAttempted = true;
      }
      const result = await executeCommand(command);
      if (action === 'CAPTURE' && tabId) {
        if (this.#currentCycleLease && !this.#taskEffectAttempted && tabId === String(this.#currentCycleLease.tab_id || '')) {
          const observedTarget = String(result?.target_id || '').toLowerCase();
          const expectedTarget = String(this.#currentCycleLease.target_id || '').toLowerCase();
          if (observedTarget && expectedTarget && observedTarget !== expectedTarget) {
            throw new Error('devos_pre_effect_frame_target_mismatch');
          }
        }
        this.#lastFrames.set(tabId, structuredClone(result));
      }
      return result;
    };
    this.#executeCommand = observedExecuteCommand;

    const proofGatedSignedRequest = async (requestPath, request = {}) => {
      if (String(requestPath) === '/v1/devos/mark-running') {
        const payload = request?.payload || {};
        let agent = exactFleetAgent(await this.#getState(), payload);
        const expectedHash = String(payload?.proof?.conversation_url_sha256 || '').toLowerCase();
        const expectedAgentSurfaceHash = String(payload?.proof?.agent_surface_sha256 || '').toLowerCase();
        let frame = this.#lastFrames.get(String(payload.tab_id || '')) || null;
        let normalizedUrl = conversationUrl(frame?.url);

        if (!frame || !normalizedUrl || !HASH_RE.test(expectedHash) || sha256(normalizedUrl) !== expectedHash) {
          frame = await observedExecuteCommand({ action: 'CAPTURE', platform: AGENT_PLATFORM_ID, payload: { tab_id: String(payload.tab_id || '') } });
          normalizedUrl = conversationUrl(frame?.url);
        }

        if (frame?.target_id && String(frame.target_id).toLowerCase() !== String(payload.target_id || '').toLowerCase()) {
          throw new Error('devos_transport_active_frame_target_mismatch');
        }
        if (!normalizedUrl || !HASH_RE.test(expectedHash) || sha256(normalizedUrl) !== expectedHash) {
          throw new Error('devos_transport_active_conversation_hash_mismatch');
        }

        const fleetProof = exactTransportProof(agent);
        if (!fleetProof) throw new Error('devos_transport_active_agent_proof_invalid');
        if (!HASH_RE.test(expectedAgentSurfaceHash)
            || expectedAgentSurfaceHash !== String(fleetProof.agent_surface_sha256 || '').toLowerCase()) {
          throw new Error('devos_transport_active_agent_surface_proof_mismatch');
        }
        const proofState = 'PREEXISTING_ACTIVE_AGENT_PROOF_REVALIDATED';

        this.#lastFleetTransportProof = {
          schema: 'metaengine.browser.fleet-native-transport-proof.v2',
          state: proofState,
          agent_id: agent.agent_id,
          tab_id: agent.tab_id,
          target_id: agent.target_id,
          generation_epoch: agent.generation_epoch,
          fleet_proven_at: fleetProof.proven_at,
          conversation_url_sha256: expectedHash,
          agent_surface_sha256: fleetProof.agent_surface_sha256,
          automatic_retry_allowed: false,
          authority_effect: false,
        };
      }

      const response = await signedRequest(requestPath, request);
      if (String(requestPath) !== '/v1/devos/cycle' || typeof response?.json !== 'function') return response;
      const originalJson = response.json.bind(response);
      return {
        status: response.status,
        ok: response.ok,
        async json() {
          const body = await originalJson();
          this;
          return body;
        },
        __captureLease: async () => {},
      };
    };

    // Replace the cycle-response wrapper with a closure that records the exact server lease
    // only when Core consumes the JSON. Keeping this after declaration avoids mutating Response.
    const cycleAwareSignedRequest = async (requestPath, request = {}) => {
      if (String(requestPath) !== '/v1/devos/cycle') return proofGatedSignedRequest(requestPath, request);
      const response = await signedRequest(requestPath, request);
      if (typeof response?.json !== 'function') return response;
      const originalJson = response.json.bind(response);
      return {
        status: response.status,
        ok: response.ok,
        json: async () => {
          const body = await originalJson();
          if (response.ok && body?.schema === 'metaengine.devos.browser-cycle.v1' && body?.runtime_control != null) {
            const runtimeControl = normalizeDevosRuntimeControl(body.runtime_control);
            if (runtimeControl.authoritative !== true) {
              throw new Error(`devos_generation_floor_readback_invalid:${runtimeControl.reason || 'UNKNOWN'}`);
            }
            this.#lastGenerationFloorAdoption = await adoptFleetGenerationFloor(runtimeControl.generation_floor);
          }
          this.#currentCycleLease = body?.lease ? structuredClone(body.lease) : null;
          this.#taskEffectAttempted = false;
          return body;
        },
      };
    };

    const storageDir = supervisorDeviceStorageDirectory();
    const effectJournal = options.effectJournal || (storageDir ? new DevOsEffectDeliveryJournal({
      statePath: path.join(storageDir, DEVOS_EFFECT_DELIVERY_JOURNAL_FILE),
    }) : null);

    this.#inner = new CoreDevOsNativeTaskCycle({
      ...options,
      getState: strictGetState,
      executeCommand: observedExecuteCommand,
      signedRequest: cycleAwareSignedRequest,
      effectJournal,
    });
  }

  // Tier 2 break repair #4 (results→artifacts): forward the late-bound durable
  // artifact recorder (realtime process plane) to the core cycle.
  bindArtifactRecorder(fn) {
    if (typeof this.#inner?.bindArtifactRecorder === 'function') this.#inner.bindArtifactRecorder(fn);
  }

  // Closed-loop audit fix (memory): forward the late-bound task-outcome
  // advancer (episodic memory episodes) and memory retriever (bounded hybrid
  // retrieval into agent prompts) to the core cycle.
  bindTaskOutcomeAdvancer(fn) {
    if (typeof this.#inner?.bindTaskOutcomeAdvancer === 'function') this.#inner.bindTaskOutcomeAdvancer(fn);
  }

  bindMemoryRetriever(fn) {
    if (typeof this.#inner?.bindMemoryRetriever === 'function') this.#inner.bindMemoryRetriever(fn);
  }

  snapshot() {
    return {
      ...this.#inner.snapshot(),
      fleet_transport_proof: this.#lastFleetTransportProof ? structuredClone(this.#lastFleetTransportProof) : null,
      fleet_transport_promotion: this.#lastTransportPromotion ? structuredClone(this.#lastTransportPromotion) : null,
      fleet_generation_floor_adoption: this.#lastGenerationFloorAdoption ? structuredClone(this.#lastGenerationFloorAdoption) : null,
      pre_effect_reconciliation: this.#lastPreEffectReconciliation ? structuredClone(this.#lastPreEffectReconciliation) : null,
      pre_effect_lease_stall_fast_requeue: true,
      fleet_transport_proof_before_physical_dispatch: true,
      fleet_transport_proof_before_db_running: true,
      restart_transport_promotion_before_scheduler_cycle: true,
      preconversation_transport_promotion_non_effect: true,
      promotion_fanout_per_cycle: 1,
      tab_census_capacity_grounding: 'READ_ONLY_TAB_REGISTRY_CENSUS',
      elastic_fleet_governor: ELASTIC_FLEET_CONTRACT.capacity_model,
      elastic_scale_down_retire_states: 'PROVISIONING_AND_BOUND_UNVERIFIED_ONLY',
      elastic_idle_cycles_required: ELASTIC_FLEET_CONTRACT.idle_cycles_required,
      elastic_max_retire_per_cycle: ELASTIC_FLEET_CONTRACT.max_retire_per_cycle,
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
    let bootstrapBarrier = false;
    let bootstrapEffectState = null;
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

      let frame = await this.#executeCommand({ action: 'CAPTURE', platform: AGENT_PLATFORM_ID, payload: { tab_id: binding.tab_id } });
      let transport = transportUrl(frame?.url);
      if (!transport) throw new Error('devos_transport_promotion_transport_not_ready');
      if (String(frame?.target_id || '').toLowerCase() !== binding.target_id) throw new Error('devos_transport_promotion_target_drift');

      if (transport.stage === 'CONVERSATION') {
        // R98 restart recovery: a bare /c/<id> still has ZERO Agent-origin
        // authority, but leaving the BOUND_UNVERIFIED worker on that URL
        // creates a permanent promotion livelock. Under the existing exact
        // promotion lease, reset only this Browser-owned tab to the canonical
        // authenticated root, then prove the root by fresh CAPTURE. No model
        // message is sent and the old conversation is never task-admitted.
        if (!bootstrapBarrier) {
          await beginFleetTransportBootstrapAttempt(binding);
          bootstrapBarrier = true;
        }
        bootstrapEffectState = 'UNPROVEN_CONVERSATION_RESET_DISPATCHED';
        await this.#executeCommand({
          action: 'NAVIGATE',
          platform: null,
          payload: { tab_id: binding.tab_id, url: AGENT_PLATFORM_HOME_URL },
        });
        frame = await this.#executeCommand({ action: 'CAPTURE', platform: AGENT_PLATFORM_ID, payload: { tab_id: binding.tab_id } });
        transport = transportUrl(frame?.url);
        if (String(frame?.target_id || '').toLowerCase() !== binding.target_id) {
          throw new Error('devos_agent_reset_target_drift');
        }
        if (transport?.stage !== 'PRECONVERSATION_ROOT') {
          result = {
            state: 'LOCAL_CONVERSATION_RESET_AMBIGUOUS',
            ...binding,
            lease_id: lease.lease_id,
            transport_stage: transport?.stage || 'OTHER',
            bootstrap_effect_state: bootstrapEffectState,
            reason: 'UNPROVEN_CONVERSATION_RESET_POSTCONDITION_NOT_PROVEN',
            automatic_retry_allowed: false,
            authority_effect: false,
          };
        } else {
          bootstrapEffectState = 'UNPROVEN_CONVERSATION_RESET_PROVEN';
        }
      }

      if (transport.stage === 'PRECONVERSATION_ROOT' && result.state === 'LEASE_NOT_ACQUIRED') {
        let agentSurface = resolveAgentPlatformAgentSurface(frame);
        let agentSurfaceSha256 = null;

        // Step 1: prove the active agent bootstrap surface. Agent and Chat share the same URL, so
        // success is proven only by a fresh semantic CAPTURE, never by the
        // TYPED_CLICK receipt itself.
        if (!agentSurface) {
          let agentControl = resolveAgentPlatformNavControl(frame, 'Agent');
          let navDiscovery = null;
          if (!agentControl?.semantic_ref) {
            navDiscovery = await discoverAgentNavControlByKeyboard({
              executeCommand: this.#executeCommand,
              binding,
              initialFrame: frame,
            });
            frame = navDiscovery.frame || frame;
            agentControl = navDiscovery.control || null;
          }
          if (!agentControl?.semantic_ref) {
            result = {
              state: 'LOCAL_AGENT_NAV_NOT_READY',
              ...binding,
              lease_id: lease.lease_id,
              transport_stage: 'PRECONVERSATION_ROOT',
              nav_discovery_state: navDiscovery?.state || 'NOT_ATTEMPTED',
              nav_discovery_tab_steps: Number(navDiscovery?.tab_steps || 0),
              reason: 'AGENT_SEMANTIC_CONTROL_NOT_FOUND',
              automatic_retry_allowed: false,
              authority_effect: false,
            };
          } else {
            if (!bootstrapBarrier) {
              await beginFleetTransportBootstrapAttempt(binding);
              bootstrapBarrier = true;
            }
            bootstrapEffectState = 'AGENT_NAV_DISPATCHED';
            await this.#executeCommand({
              action: 'TYPED_CLICK',
              platform: AGENT_PLATFORM_ID,
              payload: semanticActivationPayload(binding.tab_id, agentControl),
            });
            frame = await this.#executeCommand({ action: 'CAPTURE', platform: AGENT_PLATFORM_ID, payload: { tab_id: binding.tab_id } });
            if (String(frame?.target_id || '').toLowerCase() !== binding.target_id) {
              throw new Error('devos_agent_nav_target_drift');
            }
            agentSurface = resolveAgentPlatformAgentSurface(frame);
            if (!agentSurface) {
              result = {
                state: 'LOCAL_AGENT_NAV_AMBIGUOUS',
                ...binding,
                lease_id: lease.lease_id,
                transport_stage: 'PRECONVERSATION_ROOT',
                bootstrap_effect_state: bootstrapEffectState,
                write_ahead_barrier_persisted: true,
                reason: 'AGENT_SURFACE_POSTCONDITION_NOT_PROVEN',
                automatic_retry_allowed: false,
                authority_effect: false,
              };
            }
          }
        }

        if (agentSurface) {
          agentSurfaceSha256 = digestAgentSurfaceProof(agentSurface);
          let modelProof = resolveAgentPlatformSelectedModel(frame);

          // Step 2: the selected model is a separate UI fact. Page title
          // branding is ignored. If the exact required model is not already
          // selected, open the selector and choose the required provider model semantically when the platform exposes such a selector.
          if (!modelProof || modelProof.matches_required_model !== true) {
            const selector = resolveAgentPlatformNavControl(frame, 'Select a model');
            if (!selector?.semantic_ref) {
              result = {
                state: 'LOCAL_AGENT_MODEL_NOT_READY',
                ...binding,
                lease_id: lease.lease_id,
                transport_stage: 'PRECONVERSATION_ROOT',
                observed_model: modelProof?.model || null,
                required_model: AGENT_PLATFORM_MODEL,
                reason: modelProof ? 'AGENT_MODEL_MISMATCH_SELECTOR_UNAVAILABLE' : 'AGENT_MODEL_UNPROVEN_SELECTOR_UNAVAILABLE',
                write_ahead_barrier_persisted: bootstrapBarrier,
                automatic_retry_allowed: false,
                authority_effect: false,
              };
            } else {
              if (!bootstrapBarrier) {
                await beginFleetTransportBootstrapAttempt(binding);
                bootstrapBarrier = true;
              }
              bootstrapEffectState = 'MODEL_SELECTOR_DISPATCHED';
              await this.#executeCommand({
                action: 'TYPED_CLICK',
                platform: AGENT_PLATFORM_ID,
                payload: semanticActivationPayload(binding.tab_id, selector),
              });
              const menuFrame = await this.#executeCommand({ action: 'CAPTURE', platform: AGENT_PLATFORM_ID, payload: { tab_id: binding.tab_id } });
              if (String(menuFrame?.target_id || '').toLowerCase() !== binding.target_id) {
                throw new Error('devos_agent_model_menu_target_drift');
              }
              const modelOption = resolveAgentPlatformModelOption(menuFrame, AGENT_PLATFORM_MODEL);
              if (!modelOption?.semantic_ref) {
                result = {
                  state: 'LOCAL_AGENT_MODEL_SELECTION_AMBIGUOUS',
                  ...binding,
                  lease_id: lease.lease_id,
                  transport_stage: 'PRECONVERSATION_ROOT',
                  bootstrap_effect_state: bootstrapEffectState,
                  required_model: AGENT_PLATFORM_MODEL,
                  write_ahead_barrier_persisted: true,
                  reason: 'REQUIRED_MODEL_OPTION_NOT_EXACTLY_RESOLVED',
                  automatic_retry_allowed: false,
                  authority_effect: false,
                };
              } else {
                bootstrapEffectState = 'MODEL_OPTION_DISPATCHED';
                await this.#executeCommand({
                  action: 'TYPED_CLICK',
                  platform: AGENT_PLATFORM_ID,
                  payload: semanticActivationPayload(binding.tab_id, modelOption),
                });
                frame = await this.#executeCommand({ action: 'CAPTURE', platform: AGENT_PLATFORM_ID, payload: { tab_id: binding.tab_id } });
                if (String(frame?.target_id || '').toLowerCase() !== binding.target_id) {
                  throw new Error('devos_agent_model_selection_target_drift');
                }
                agentSurface = resolveAgentPlatformAgentSurface(frame);
                modelProof = resolveAgentPlatformSelectedModel(frame);
                if (!agentSurface || !modelProof || modelProof.matches_required_model !== true) {
                  result = {
                    state: 'LOCAL_AGENT_MODEL_SELECTION_AMBIGUOUS',
                    ...binding,
                    lease_id: lease.lease_id,
                    transport_stage: 'PRECONVERSATION_ROOT',
                    bootstrap_effect_state: bootstrapEffectState,
                    observed_model: modelProof?.model || null,
                    required_model: AGENT_PLATFORM_MODEL,
                    write_ahead_barrier_persisted: true,
                    reason: 'REQUIRED_MODEL_POSTCONDITION_NOT_PROVEN',
                    automatic_retry_allowed: false,
                    authority_effect: false,
                  };
                } else {
                  agentSurfaceSha256 = digestAgentSurfaceProof(agentSurface);
                }
              }
            }
          }

          // Continue only when no earlier branch produced a terminal local
          // result and the exact required model is positively observed.
          modelProof = resolveAgentPlatformSelectedModel(frame);
          if ((!result.state || result.state === 'LEASE_NOT_ACQUIRED')
              && agentSurface
              && modelProof?.matches_required_model === true) {
            // Step 3: create/reset a real Agent task session. The click receipt
            // is not success; the fresh surface/model/composer readback is.
            if (AGENT_PLATFORM_BOOTSTRAP_MODE === 'ROOT_COMPOSER_SEED') {
              // ChatGPT root is already the isolated-session creation surface.
              // No navigation/model/new-task click is needed: re-capture the
              // exact bound root composer immediately before the seed effect.
              bootstrapEffectState = 'ROOT_COMPOSER_READY';
              frame = await this.#executeCommand({ action: 'CAPTURE', platform: AGENT_PLATFORM_ID, payload: { tab_id: binding.tab_id } });
            } else {
              if (!bootstrapBarrier) {
                await beginFleetTransportBootstrapAttempt(binding);
                bootstrapBarrier = true;
              }
              bootstrapEffectState = 'NEW_TASK_DISPATCHED';
              await this.#executeCommand({
                action: 'TYPED_CLICK',
                platform: AGENT_PLATFORM_ID,
                payload: semanticActivationPayload(binding.tab_id, agentSurface.new_task),
              });
              frame = await this.#executeCommand({ action: 'CAPTURE', platform: AGENT_PLATFORM_ID, payload: { tab_id: binding.tab_id } });
            }
            if (String(frame?.target_id || '').toLowerCase() !== binding.target_id) {
              throw new Error('devos_agent_new_task_target_drift');
            }
            agentSurface = resolveAgentPlatformAgentSurface(frame);
            modelProof = resolveAgentPlatformSelectedModel(frame);
            const composer = resolveAgentPlatformComposer(frame);

            if (!agentSurface || !modelProof || modelProof.matches_required_model !== true || !composer?.semantic_ref) {
              result = {
                state: bootstrapBarrier ? 'LOCAL_AGENT_NEW_TASK_AMBIGUOUS' : 'LOCAL_BOOTSTRAP_PREFLIGHT_BLOCKED',
                ...binding,
                lease_id: lease.lease_id,
                transport_stage: 'PRECONVERSATION_ROOT',
                bootstrap_effect_state: bootstrapEffectState,
                observed_model: modelProof?.model || null,
                required_model: AGENT_PLATFORM_MODEL,
                write_ahead_barrier_persisted: bootstrapBarrier,
                reason: !agentSurface
                  ? 'AGENT_SURFACE_LOST_AFTER_NEW_TASK'
                  : (!modelProof || modelProof.matches_required_model !== true
                    ? 'AGENT_MODEL_NOT_PROVEN_AFTER_NEW_TASK'
                    : 'AGENT_TASK_COMPOSER_NOT_EXACTLY_RESOLVED'),
                automatic_retry_allowed: false,
                authority_effect: false,
              };
            } else if (composer.value_length !== 0) {
              result = {
                state: bootstrapBarrier ? 'LOCAL_AGENT_NEW_TASK_AMBIGUOUS' : 'LOCAL_BOOTSTRAP_PREFLIGHT_BLOCKED',
                ...binding,
                lease_id: lease.lease_id,
                transport_stage: 'PRECONVERSATION_ROOT',
                bootstrap_effect_state: bootstrapEffectState,
                composer_value_length: composer.value_length,
                write_ahead_barrier_persisted: bootstrapBarrier,
                reason: 'AGENT_TASK_INPUT_NOT_CLEAN',
                automatic_retry_allowed: false,
                authority_effect: false,
              };
            } else {
              agentSurfaceSha256 = digestAgentSurfaceProof(agentSurface);

              // Step 4: create the durable Agent session with a tiny seed only
              // after Agent mode + model + clean input have all been proven.
              const submitted = await submitFencedChatGptPrompt({
                executeCommand: this.#executeCommand, tab_id: binding.tab_id, frame, text: AGENT_ROOT_CONVERSATION_SEED,
                beforeType: async () => {
                  if (!bootstrapBarrier) {
                    await beginFleetTransportBootstrapAttempt(binding);
                    bootstrapBarrier = true;
                  }
                  bootstrapEffectState = 'AGENT_SESSION_SEED_DISPATCHED';
                },
                validateTypedFrame: async (typedFrame) => {
                  if (String(typedFrame.target_id || '').toLowerCase() !== binding.target_id) throw new Error('devos_agent_session_target_drift');
                  if (!resolveAgentPlatformAgentSurface(typedFrame)) throw new Error('devos_agent_session_root_surface_lost');
                },
              });
              bootstrapEffectState = String(submitted?.effect_state || 'AGENT_SESSION_SEED_DISPATCHED');
              frame = await this.#executeCommand({ action: 'CAPTURE', platform: AGENT_PLATFORM_ID, payload: { tab_id: binding.tab_id } });
              transport = transportUrl(frame?.url);
              if (String(frame?.target_id || '').toLowerCase() !== binding.target_id) {
                throw new Error('devos_agent_session_target_drift');
              }

              if (transport?.stage !== 'CONVERSATION') {
                result = {
                  state: 'LOCAL_AGENT_SESSION_BOOTSTRAP_AMBIGUOUS',
                  ...binding,
                  lease_id: lease.lease_id,
                  transport_stage: transport?.stage || 'OTHER',
                  bootstrap_effect_state: bootstrapEffectState || null,
                  bootstrap_prompt_sha256: sha256(AGENT_ROOT_CONVERSATION_SEED),
                  agent_surface_sha256: agentSurfaceSha256,
                  write_ahead_barrier_persisted: true,
                  reason: 'AGENT_SESSION_CONVERSATION_NOT_PROVEN',
                  automatic_retry_allowed: false,
                  authority_effect: false,
                };
              } else {
                const expectedHash = sha256(transport.url);
                localProof = await markFleetTransportProvenFromNativeFrame({
                  binding,
                  frame,
                  expected_transport_url_sha256: expectedHash,
                  expected_agent_surface_sha256: agentSurfaceSha256,
                  expected_agent_surface_proof: agentSurface,
                });
                if (!['PROVEN', 'UPGRADED_CONVERSATION'].includes(String(localProof?.state || ''))) {
                  throw new Error('devos_agent_session_transport_proof_invalid');
                }
                result = {
                  state: 'LOCAL_ACTIVE_AGENT_SESSION',
                  ...binding,
                  lease_id: lease.lease_id,
                  transport_stage: 'CONVERSATION',
                  transport_url_sha256: expectedHash,
                  conversation_url_sha256: expectedHash,
                  agent_surface_sha256: agentSurfaceSha256,
                  local_proof_state: localProof.state,
                  bootstrap_effect_state: bootstrapEffectState || null,
                  bootstrap_prompt_sha256: sha256(AGENT_ROOT_CONVERSATION_SEED),
                  write_ahead_barrier_persisted: true,
                  automatic_retry_allowed: false,
                  authority_effect: false,
                };
              }
            }
          }
        }
      } else if (result.state === 'LEASE_NOT_ACQUIRED') {
        result = {
          state: 'LOCAL_TRANSPORT_UNSUPPORTED',
          ...binding,
          lease_id: lease.lease_id,
          transport_stage: transport?.stage || 'OTHER',
          automatic_retry_allowed: false,
          authority_effect: false,
        };
      }
    } catch (error) {
      result = {
        ...result,
        state: bootstrapBarrier
          ? 'LOCAL_PRECONVERSATION_BOOTSTRAP_AMBIGUOUS'
          : (localProof ? 'LOCAL_ACTIVE_RELEASE_PENDING' : (lease ? 'LOCAL_PROOF_FAILED' : 'LEASE_OUTCOME_AMBIGUOUS')),
        lease_id: lease?.lease_id || null,
        bootstrap_effect_state: bootstrapEffectState || null,
        write_ahead_barrier_persisted: bootstrapBarrier,
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

  async #reconcileProvenPreEffect(error) {
    if (!this.#currentCycleLease || this.#taskEffectAttempted) return null;
    let lease;
    try { lease = normalizeLease({ ...this.#currentCycleLease, automatic_retry_allowed: false }); }
    catch { return null; }
    const promptSha256 = sha256(renderDevosTaskPrompt(lease));
    const payload = {
      task_id: lease.task_id,
      agent_id: lease.agent_id,
      lease_generation: lease.lease_generation,
      tab_id: lease.tab_id,
      target_id: lease.target_id,
      agent_generation_epoch: lease.agent_generation_epoch,
      recovery: {
        recovery_class: 'PRE_EFFECT_ABORTED',
        prompt_sha256: promptSha256,
        physical_effect_attempted: false,
        effect_barrier_crossed: false,
        automatic_retry_allowed: false,
        authority_effect: false,
      },
    };
    try {
      const response = await this.#signedRequest('/v1/devos/reconcile-ambiguous', { payload });
      const body = await readJson(response);
      if (response?.ok && exactPreEffectRequeue(body, lease)) {
        return {
          state: 'PRE_EFFECT_REQUEUED', task_id: lease.task_id, lease_generation: lease.lease_generation,
          original_error: clip(error?.message || error), readback: 'WRITE_ACK', retry_via_scheduler: true,
          physical_effect_attempted: false, physical_effect_replayed: false, automatic_retry_allowed: false, authority_effect: false,
        };
      }
    } catch {}

    try {
      const response = await this.#signedRequest(`/v1/devos/tasks/${encodeURIComponent(lease.task_id)}/status`, { method: 'GET' });
      const body = await readJson(response);
      if (response?.ok && Number(body?.lease_generation || 0) === lease.lease_generation && String(body?.state || '').toUpperCase() === 'READY') {
        return {
          state: 'PRE_EFFECT_REQUEUE_CONFIRMED_BY_STATUS', task_id: lease.task_id, lease_generation: lease.lease_generation,
          original_error: clip(error?.message || error), readback: 'STATUS_AFTER_AMBIGUOUS_WRITE', retry_via_scheduler: true,
          physical_effect_attempted: false, physical_effect_replayed: false, automatic_retry_allowed: false, authority_effect: false,
        };
      }
    } catch {}

    return {
      state: 'PRE_EFFECT_REQUEUE_UNPROVEN', task_id: lease.task_id, lease_generation: lease.lease_generation,
      original_error: clip(error?.message || error), retry_via_scheduler: false,
      physical_effect_attempted: false, physical_effect_replayed: false, automatic_retry_allowed: false, authority_effect: false,
    };
  }

  async runOnce() {
    try {
      await this.#promoteOneRestartTransport();
    } catch (error) {
      this.#lastTransportPromotion = {
        state: 'PRE_ADMISSION_REPAIR_FAILED',
        reason: clip(error?.message || error),
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    }
    this.#currentCycleLease = null;
    this.#taskEffectAttempted = false;
    this.#lastPreEffectReconciliation = null;
    try {
      await this.#inner.cycle();
    } catch (error) {
      const reconciliation = await this.#reconcileProvenPreEffect(error);
      if (reconciliation) this.#lastPreEffectReconciliation = reconciliation;
      if (reconciliation?.retry_via_scheduler === true) return this.snapshot();
      error.automatic_retry_allowed = false;
      if (reconciliation) error.pre_effect_reconciliation = structuredClone(reconciliation);
      throw error;
    }
    return this.snapshot();
  }

  async cycle() {
    return this.runOnce();
  }

  async completeFromTrustedCommand(payload = {}) {
    return this.#inner.completeFromTrustedCommand(payload);
  }
}
