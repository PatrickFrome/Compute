import { createFinalRuntimeActivation } from './final-runtime-activation.mjs';

export const FINAL_RUNTIME_ACTIVATION_REGISTRY_SCHEMA = 'metaengine.browser.final-runtime-activation-registry.v1';

let developmentPlane = null;
let supervisor = null;
let supervisorConfig = null;
let supervisorStarted = false;
let activation = null;
let activationStartPromise = null;
let activationStopPromise = null;
let generation = 0;
let state = 'IDLE';
let lastError = null;
let lastActivation = null;

const clip = (value, max = 240) => String(value ?? '').slice(0, max);
const probeStdoutReserved = process.argv.some((arg) => [
  '--metaengine-version-probe',
  '--metaengine-profile-probe',
  '--metaengine-single-instance-probe',
  '--metaengine-self-update-smoke',
].includes(String(arg || '')));

function emitLifecycle(row, { error = false } = {}) {
  const text = JSON.stringify(row);
  if (error || probeStdoutReserved) console.error(text);
  else console.log(text);
}

function activationSummary(snapshot = null) {
  if (!snapshot) return null;
  return Object.freeze({
    schema: snapshot.schema || null,
    state: snapshot.state || null,
    version: snapshot.version || null,
    started_at: snapshot.started_at || null,
    host_agent_state: snapshot.host_agent?.state || null,
    signer_state: snapshot.host_agent?.signer?.state || null,
    browser_executor_state: snapshot.host_agent?.browser_executor?.ipc?.state || null,
    host_identity_state: snapshot.host_agent?.host_identity?.state || null,
    browser_client_state: snapshot.host_agent?.browser_client?.ipc?.state || null,
    host_runtime_state: snapshot.host_agent?.host_runtime?.state || null,
    transport_active: snapshot.host_agent?.transport != null,
    browser_execution_via_typed_ipc: snapshot.browser_execution_via_typed_ipc === true,
    verified_execution_outcomes_active: snapshot.verified_execution_outcomes_active === true,
    fast_control_read_side_active: snapshot.fast_control_read_side_active === true,
    fast_control_production_mutation_authority: snapshot.fast_control_production_mutation_authority === true,
    production_authority_fabricated: snapshot.production_authority_fabricated === true,
    second_scheduler: snapshot.second_scheduler === true,
    automatic_effect_retry_allowed: snapshot.automatic_effect_retry_allowed === true,
    authority_effect: false,
  });
}

function registrySnapshot() {
  return Object.freeze({
    schema: FINAL_RUNTIME_ACTIVATION_REGISTRY_SCHEMA,
    state,
    generation,
    development_plane_registered: developmentPlane != null,
    supervisor_registered: supervisor != null,
    supervisor_started: supervisorStarted,
    activation: lastActivation ? structuredClone(lastActivation) : null,
    second_scheduler: false,
    production_authority_fabricated: false,
    automatic_effect_retry_allowed: false,
    last_error: lastError,
    authority_effect: false,
  });
}

async function stopActivation(reason = 'STOPPED') {
  if (activationStopPromise) return activationStopPromise;
  activationStopPromise = (async () => {
    if (activationStartPromise) {
      try { await activationStartPromise; } catch {}
    }
    const current = activation;
    activation = null;
    if (current) {
      try {
        const stopped = await current.stop();
        lastActivation = activationSummary(stopped);
      } catch (error) {
        state = 'FAILED';
        lastError = clip(error?.message || error);
        throw error;
      }
    }
    if (state !== 'FAILED') state = supervisorStarted ? 'WAITING_FOR_DEPENDENCIES' : 'IDLE';
    emitLifecycle({
      schema: 'metaengine.browser.final-runtime-activation.lifecycle.v1',
      state: 'STOPPED',
      reason: clip(reason, 120),
      generation,
      probe_stdout_reserved: probeStdoutReserved,
      second_scheduler: false,
      authority_effect: false,
    });
    return registrySnapshot();
  })().finally(() => { activationStopPromise = null; });
  return activationStopPromise;
}

async function ensureActivation() {
  if (!supervisorStarted || !supervisor || !supervisorConfig) {
    state = 'WAITING_FOR_SUPERVISOR';
    return registrySnapshot();
  }
  if (!developmentPlane) {
    state = 'WAITING_FOR_DEVELOPMENT_PLANE';
    return registrySnapshot();
  }
  if (activationStartPromise) return activationStartPromise;
  if (activation && lastActivation?.state === 'READY') return registrySnapshot();
  if (activationStopPromise) await activationStopPromise;

  const currentGeneration = ++generation;
  state = 'STARTING';
  lastError = null;
  const instance = createFinalRuntimeActivation({
    ...supervisorConfig,
    developmentPlane,
    nativeSupervisor: supervisor,
  });
  activation = instance;
  activationStartPromise = instance.start()
    .then((snapshot) => {
      if (activation !== instance || currentGeneration !== generation) {
        throw new Error('final_runtime_activation_generation_fenced');
      }
      lastActivation = activationSummary(snapshot);
      state = snapshot?.state === 'READY' ? 'READY' : 'FAILED';
      lastError = snapshot?.last_error || null;
      emitLifecycle({
        schema: 'metaengine.browser.final-runtime-activation.lifecycle.v1',
        state,
        generation: currentGeneration,
        activation: lastActivation,
        probe_stdout_reserved: probeStdoutReserved,
        second_scheduler: false,
        authority_effect: false,
      });
      if (state !== 'READY') throw new Error(`final_runtime_activation_not_ready:${state}`);
      return registrySnapshot();
    })
    .catch(async (error) => {
      state = 'FAILED';
      lastError = clip(error?.message || error);
      lastActivation = activationSummary(instance.snapshot?.() || null);
      if (activation === instance) activation = null;
      try { await instance.stop(); } catch {}
      emitLifecycle({
        schema: 'metaengine.browser.final-runtime-activation.lifecycle.v1',
        state: 'FAILED',
        generation: currentGeneration,
        error: lastError,
        probe_stdout_reserved: probeStdoutReserved,
        second_scheduler: false,
        authority_effect: false,
      }, { error: true });
      throw error;
    })
    .finally(() => { activationStartPromise = null; });
  return activationStartPromise;
}

export function registerFinalRuntimeDevelopmentPlane(instance) {
  if (!instance || typeof instance.request !== 'function') throw new Error('final_runtime_registry_development_plane_invalid');
  if (developmentPlane && developmentPlane !== instance) void stopActivation('DEVELOPMENT_PLANE_REPLACED');
  developmentPlane = instance;
  if (supervisorStarted) void ensureActivation().catch(() => {});
  return registrySnapshot();
}

export function unregisterFinalRuntimeDevelopmentPlane(instance) {
  if (developmentPlane !== instance) return registrySnapshot();
  developmentPlane = null;
  void stopActivation('DEVELOPMENT_PLANE_STOPPED').catch(() => {});
  return registrySnapshot();
}

export function registerFinalRuntimeSupervisor(instance, config) {
  if (!instance || typeof instance.snapshot !== 'function') throw new Error('final_runtime_registry_supervisor_invalid');
  if (!config || typeof config !== 'object') throw new Error('final_runtime_registry_supervisor_config_invalid');
  if (supervisor && supervisor !== instance) void stopActivation('SUPERVISOR_REPLACED');
  supervisor = instance;
  supervisorConfig = Object.freeze({ ...config });
  supervisorStarted = false;
  state = 'WAITING_FOR_SUPERVISOR';
  return registrySnapshot();
}

export async function markFinalRuntimeSupervisorStarted(instance) {
  if (supervisor !== instance) throw new Error('final_runtime_registry_supervisor_mismatch');
  supervisorStarted = true;
  const snapshot = await ensureActivation();
  if (developmentPlane && snapshot.state !== 'READY') {
    throw new Error(`final_runtime_registry_not_ready:${snapshot.state}`);
  }
  return snapshot;
}

export async function quiesceFinalRuntimeSupervisor(instance, reason = 'SUPERVISOR_QUIESCE') {
  if (supervisor !== instance) throw new Error('final_runtime_registry_supervisor_mismatch');
  supervisorStarted = false;
  return stopActivation(reason);
}

export function markFinalRuntimeSupervisorStopped(instance) {
  if (supervisor !== instance) return registrySnapshot();
  supervisorStarted = false;
  void stopActivation('SUPERVISOR_STOPPED').catch(() => {});
  return registrySnapshot();
}

export async function requireFinalRuntimeActivation() {
  const snapshot = await ensureActivation();
  if (snapshot.state !== 'READY') throw new Error(`final_runtime_registry_not_ready:${snapshot.state}`);
  return snapshot;
}

export function finalRuntimeActivationRegistrySnapshot() {
  return registrySnapshot();
}