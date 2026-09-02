import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const { durableWriteJson, durableWriteJsonSync } = require('./durable-json-file.cjs');

export const BROWSER_SENTINEL_VERSION = '1.6.0';
export const BROWSER_SENTINEL_WORKER_HEARTBEAT_MAX_AGE_MS = 8_000;
const WORKER_RECOVERY_ACK_TIMEOUT_MS = 2_000;

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

function readJsonSync(file) {
  try { return JSON.parse(fsSync.readFileSync(file, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

async function writeJson(file, value) {
  return durableWriteJson(file, value, { sequence: Number(value?.state_revision || 0) });
}

function writeJsonSync(file, value) {
  return durableWriteJsonSync(file, value, { sequence: Number(value?.state_revision || 0) });
}

export function browserSentinelWorkerHeartbeatPath(statePath) {
  return `${String(statePath)}.worker-heartbeat-v1.json`;
}

function safeState(value) {
  const relaunchPid = Number(value.relaunch_pid || 0);
  const workerPid = Number(value.worker_pid || 0);
  const recoveryOldPid = Number(value.worker_recovery_old_pid || 0);
  const recoveryCandidatePid = Number(value.worker_recovery_candidate_pid || 0);
  const revision = Number(value.state_revision || 0);
  const recoveryGeneration = Number(value.worker_recovery_generation || 0);
  return {
    schema: 'metaengine.browser-sentinel.state.v1',
    version: BROWSER_SENTINEL_VERSION,
    token: String(value.token || ''),
    parent_pid: Number(value.parent_pid || 0),
    executable: String(value.executable || ''),
    worker_script: String(value.worker_script || ''),
    state_revision: Number.isSafeInteger(revision) && revision >= 1 ? revision : 1,
    lifecycle: String(value.lifecycle || 'ARMED'),
    expected_restart: value.expected_restart === true,
    expected_restart_reason: value.expected_restart_reason ? String(value.expected_restart_reason).slice(0, 120) : null,
    installer_handoff: value.installer_handoff === true,
    worker_pid: Number.isSafeInteger(workerPid) && workerPid > 0 ? workerPid : null,
    worker_released: value.worker_released === true,
    worker_released_at: value.worker_released_at || null,
    worker_recovery_generation: Number.isSafeInteger(recoveryGeneration) && recoveryGeneration >= 0 ? recoveryGeneration : 0,
    worker_recovery_state: value.worker_recovery_state ? String(value.worker_recovery_state).slice(0, 80) : null,
    worker_recovery_old_pid: Number.isSafeInteger(recoveryOldPid) && recoveryOldPid > 0 ? recoveryOldPid : null,
    worker_recovery_candidate_pid: Number.isSafeInteger(recoveryCandidatePid) && recoveryCandidatePid > 0 ? recoveryCandidatePid : null,
    worker_recovery_at: value.worker_recovery_at || null,
    worker_recovery_result: value.worker_recovery_result ? String(value.worker_recovery_result).slice(0, 240) : null,
    relaunch_attempted: value.relaunch_attempted === true,
    relaunch_intent_at: value.relaunch_intent_at || null,
    relaunch_pid: Number.isSafeInteger(relaunchPid) && relaunchPid > 0 ? relaunchPid : null,
    relaunch_result: value.relaunch_result || null,
    created_at: value.created_at || new Date().toISOString(),
    updated_at: value.updated_at || new Date().toISOString(),
    authority_effect: false,
  };
}

function sentinelEnvironment(source, { statePath, token, parentPid }) {
  const env = {};
  const allow = new Set([
    'SystemRoot','WINDIR','ComSpec','PATH','PATHEXT','TEMP','TMP','USERPROFILE',
    'LOCALAPPDATA','APPDATA','ProgramData','PROGRAMFILES','PROGRAMFILES(X86)',
    'PROCESSOR_ARCHITECTURE','PROCESSOR_IDENTIFIER','NUMBER_OF_PROCESSORS',
  ].map((x) => x.toUpperCase()));
  for (const [key, value] of Object.entries(source || {})) {
    if (allow.has(String(key).toUpperCase()) && value != null) env[key] = String(value);
  }
  env.ELECTRON_RUN_AS_NODE = '1';
  env.METAENGINE_SENTINEL_STATE_PATH = statePath;
  env.METAENGINE_SENTINEL_TOKEN = token;
  env.METAENGINE_SENTINEL_PARENT_PID = String(parentPid);
  return env;
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class BrowserSentinelHost {
  #statePath; #workerScript; #executable; #spawn; #processAlive; #state = null; #child = null; #beforeQuit = null; #app = null; #workerRecoveryPromise = null;

  constructor({ statePath, workerScript, executable = process.execPath, spawnImpl = spawn, processAliveImpl = processAlive } = {}) {
    if (!statePath || !workerScript || !executable) throw new Error('browser_sentinel_paths_required');
    if (typeof processAliveImpl !== 'function') throw new Error('browser_sentinel_process_probe_required');
    this.#statePath = String(statePath);
    this.#workerScript = String(workerScript);
    this.#executable = String(executable);
    this.#spawn = spawnImpl;
    this.#processAlive = processAliveImpl;
  }

  snapshot() {
    if (!this.#state) return null;
    const persisted = readJsonSync(this.#statePath);
    if (persisted?.token === this.#state.token && Number(persisted.parent_pid) === Number(this.#state.parent_pid)) {
      this.#state = { ...this.#state, ...persisted, authority_effect: false };
    }
    const heartbeat = readJsonSync(browserSentinelWorkerHeartbeatPath(this.#statePath));
    const heartbeatAtMs = Date.parse(String(heartbeat?.heartbeat_at || ''));
    const heartbeatAgeMs = Number.isFinite(heartbeatAtMs) ? Math.max(0, Date.now() - heartbeatAtMs) : null;
    const heartbeatBound = Boolean(
      heartbeat?.schema === 'metaengine.browser-sentinel.worker-heartbeat.v1'
      && heartbeat?.token === this.#state.token
      && Number(heartbeat?.parent_pid) === Number(this.#state.parent_pid)
      && Number(heartbeat?.worker_pid) === Number(this.#state.worker_pid)
      && heartbeat?.lifecycle === 'READY'
      && heartbeat?.authority_effect === false
    );
    const workerHealthy = heartbeatBound
      && heartbeatAgeMs != null
      && heartbeatAgeMs <= BROWSER_SENTINEL_WORKER_HEARTBEAT_MAX_AGE_MS
      && this.#state.worker_released !== true
      && this.#state.installer_handoff !== true;
    return structuredClone({
      ...this.#state,
      worker_ready: workerHealthy,
      worker_heartbeat_at: heartbeatBound ? heartbeat.heartbeat_at : null,
      worker_heartbeat_age_ms: heartbeatBound ? heartbeatAgeMs : null,
      worker_health: workerHealthy ? 'HEALTHY' : 'STALE_OR_MISSING',
      single_writer_parent_state: true,
      authority_effect: false,
    });
  }

  async waitUntilHealthy(timeoutMs = 5_000) {
    const deadline = Date.now() + Math.max(500, Number(timeoutMs) || 5_000);
    while (Date.now() <= deadline) {
      const snap = this.snapshot();
      if (snap?.worker_ready === true) return snap;
      await sleep(50);
    }
    throw new Error('browser_sentinel_worker_handshake_timeout');
  }

  #spawnWorker(token, parentPid) {
    const env = sentinelEnvironment(process.env, { statePath: this.#statePath, token, parentPid });
    return this.#spawn(this.#executable, [this.#workerScript], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: true,
      env,
    });
  }

  async start({ app = null } = {}) {
    const token = crypto.randomUUID();
    this.#state = safeState({
      token,
      parent_pid: process.pid,
      executable: this.#executable,
      worker_script: this.#workerScript,
      state_revision: 1,
      lifecycle: 'ARMED',
      expected_restart: false,
      installer_handoff: false,
      worker_pid: null,
      worker_released: false,
      worker_recovery_generation: 0,
      relaunch_attempted: false,
      relaunch_pid: null,
    });
    await writeJson(this.#statePath, this.#state);
    this.#child = this.#spawnWorker(token, process.pid);
    const workerPid = Number(this.#child?.pid || 0);
    if (Number.isSafeInteger(workerPid) && workerPid > 0) {
      await this.#mutate({ worker_pid: workerPid, worker_released: false });
    }
    this.#child.unref?.();
    this.#app = app;
    if (app?.on) {
      this.#beforeQuit = () => { this.markPlannedShutdownSync(); };
      app.on('before-quit', this.#beforeQuit);
    }
    return this.snapshot();
  }

  async #mutate(patch) {
    const current = await readJson(this.#statePath);
    if (!current || current.token !== this.#state?.token || Number(current.parent_pid) !== process.pid) return this.snapshot();
    this.#state = safeState({
      ...current,
      ...patch,
      state_revision: Number(current.state_revision || 0) + 1,
      updated_at: new Date().toISOString(),
    });
    await writeJson(this.#statePath, this.#state);
    return this.snapshot();
  }

  #mutateSync(patch) {
    const current = readJsonSync(this.#statePath);
    if (!current || current.token !== this.#state?.token || Number(current.parent_pid) !== process.pid) return this.snapshot();
    this.#state = safeState({
      ...current,
      ...patch,
      state_revision: Number(current.state_revision || 0) + 1,
      updated_at: new Date().toISOString(),
    });
    writeJsonSync(this.#statePath, this.#state);
    return this.snapshot();
  }

  async recoverWorkerIfProvenAbsent({ timeoutMs = WORKER_RECOVERY_ACK_TIMEOUT_MS } = {}) {
    if (this.#workerRecoveryPromise) return this.#workerRecoveryPromise;
    this.#workerRecoveryPromise = (async () => {
      const snap = this.snapshot();
      if (!snap) return { state: 'UNBOUND', recovered: false, automatic_retry_allowed: false, authority_effect: false };
      if (snap.worker_ready === true) return { state: 'HEALTHY', recovered: false, automatic_retry_allowed: false, authority_effect: false };
      if (snap.lifecycle !== 'ARMED' || snap.expected_restart === true || snap.installer_handoff === true || snap.worker_released === true) {
        return { state: 'SUPPRESSED_TRANSITION', recovered: false, automatic_retry_allowed: false, authority_effect: false };
      }

      const oldPid = Number(snap.worker_pid || 0);
      if (!Number.isSafeInteger(oldPid) || oldPid <= 0) {
        return { state: 'WORKER_PID_MISSING_AMBIGUOUS', recovered: false, automatic_retry_allowed: false, authority_effect: false };
      }
      if (this.#processAlive(oldPid)) {
        return { state: 'STALE_WORKER_PID_ALIVE', recovered: false, automatic_retry_allowed: false, authority_effect: false };
      }

      const current = await readJson(this.#statePath);
      if (!current || current.token !== snap.token || Number(current.parent_pid) !== process.pid || Number(current.worker_pid) !== oldPid) {
        return { state: 'BINDING_DRIFT', recovered: false, automatic_retry_allowed: false, authority_effect: false };
      }
      if (current.lifecycle !== 'ARMED' || current.expected_restart === true || current.installer_handoff === true || current.worker_released === true) {
        return { state: 'SUPPRESSED_TRANSITION', recovered: false, automatic_retry_allowed: false, authority_effect: false };
      }

      const generation = Number(current.worker_recovery_generation || 0) + 1;
      await this.#mutate({
        worker_recovery_generation: generation,
        worker_recovery_state: 'INTENT_PROVEN_OLD_PID_ABSENT',
        worker_recovery_old_pid: oldPid,
        worker_recovery_candidate_pid: null,
        worker_recovery_at: new Date().toISOString(),
        worker_recovery_result: 'exact_old_worker_pid_absent',
      });

      let child;
      try {
        child = this.#spawnWorker(snap.token, process.pid);
      } catch (error) {
        await this.#mutate({
          worker_recovery_state: 'SPAWN_FAILED_NO_EFFECT',
          worker_recovery_result: String(error?.message || error).slice(0, 240),
        });
        return { state: 'SPAWN_FAILED_NO_EFFECT', recovered: false, automatic_retry_allowed: true, authority_effect: false };
      }

      const outcome = await new Promise((resolve) => {
        const immediatePid = Number(child?.pid || 0);
        if (typeof child?.once !== 'function') {
          resolve(Number.isSafeInteger(immediatePid) && immediatePid > 0
            ? { state: 'SPAWNED', pid: immediatePid }
            : { state: 'SPAWN_AMBIGUOUS', pid: null });
          return;
        }
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        };
        const timer = setTimeout(() => finish({ state: 'SPAWN_AMBIGUOUS', pid: Number(child?.pid || 0) || null }), Math.max(250, Number(timeoutMs) || WORKER_RECOVERY_ACK_TIMEOUT_MS));
        child.once('spawn', () => finish({ state: 'SPAWNED', pid: Number(child.pid || 0) || null }));
        child.once('error', (error) => finish({ state: 'SPAWN_FAILED_NO_EFFECT', pid: null, error }));
      });

      if (outcome.state === 'SPAWN_FAILED_NO_EFFECT') {
        await this.#mutate({
          worker_recovery_state: 'SPAWN_FAILED_NO_EFFECT',
          worker_recovery_result: String(outcome.error?.message || outcome.error || 'spawn_error').slice(0, 240),
        });
        return { state: 'SPAWN_FAILED_NO_EFFECT', recovered: false, automatic_retry_allowed: true, authority_effect: false };
      }

      const candidatePid = Number(outcome.pid || 0);
      if (outcome.state !== 'SPAWNED' || !Number.isSafeInteger(candidatePid) || candidatePid <= 0) {
        await this.#mutate({
          worker_recovery_state: 'SPAWN_AMBIGUOUS',
          worker_recovery_candidate_pid: Number.isSafeInteger(candidatePid) && candidatePid > 0 ? candidatePid : null,
          worker_recovery_result: 'spawn_ack_missing',
        });
        return { state: 'SPAWN_AMBIGUOUS', recovered: false, automatic_retry_allowed: false, authority_effect: false };
      }

      // The candidate worker waits for this exact durable PID binding before it can
      // heartbeat or perform liveness actuation. This write is the single-writer fence.
      await this.#mutate({
        worker_pid: candidatePid,
        worker_released: false,
        worker_recovery_state: 'CANDIDATE_BOUND_PENDING_HEARTBEAT',
        worker_recovery_candidate_pid: candidatePid,
        worker_recovery_result: `candidate_pid:${candidatePid}`,
      });
      this.#child = child;
      child.unref?.();

      try {
        const healthy = await this.waitUntilHealthy(Math.max(500, Number(timeoutMs) || WORKER_RECOVERY_ACK_TIMEOUT_MS));
        await this.#mutate({
          worker_recovery_state: 'RECOVERED',
          worker_recovery_result: `heartbeat_pid:${candidatePid}`,
        });
        return { state: 'RECOVERED', recovered: true, worker_pid: candidatePid, heartbeat_at: healthy.worker_heartbeat_at, automatic_retry_allowed: false, authority_effect: false };
      } catch {
        if (this.#processAlive(candidatePid)) {
          await this.#mutate({
            worker_recovery_state: 'CANDIDATE_ALIVE_HEARTBEAT_AMBIGUOUS',
            worker_recovery_result: `candidate_pid_alive_without_fresh_heartbeat:${candidatePid}`,
          });
          return { state: 'CANDIDATE_ALIVE_HEARTBEAT_AMBIGUOUS', recovered: false, worker_pid: candidatePid, automatic_retry_allowed: false, authority_effect: false };
        }
        await this.#mutate({
          worker_recovery_state: 'CANDIDATE_CONFIRMED_ABSENT',
          worker_recovery_result: `candidate_pid_absent:${candidatePid}`,
        });
        return { state: 'CANDIDATE_CONFIRMED_ABSENT', recovered: false, worker_pid: candidatePid, automatic_retry_allowed: true, authority_effect: false };
      }
    })().finally(() => { this.#workerRecoveryPromise = null; });
    return this.#workerRecoveryPromise;
  }

  async prepareExpectedRestart(reason = 'EXPECTED_RESTART') {
    return this.#mutate({ expected_restart: true, expected_restart_reason: reason, lifecycle: 'EXPECTED_RESTART' });
  }

  async prepareInstallerHandoff(reason = 'SELF_UPDATE', { timeoutMs = 5000 } = {}) {
    await this.#mutate({
      expected_restart: true,
      expected_restart_reason: reason,
      installer_handoff: true,
      lifecycle: 'INSTALLER_HANDOFF',
      worker_released: false,
    });

    const child = this.#child;
    const pid = Number(child?.pid || this.#state?.worker_pid || 0);
    if (child && typeof child.kill !== 'function') throw new Error('browser_sentinel_installer_release_unavailable');
    if (child && this.#processAlive(pid)) {
      const dispatched = child.kill();
      if (dispatched === false && this.#processAlive(pid)) throw new Error('browser_sentinel_installer_release_failed');
      const deadline = Date.now() + Math.max(500, Number(timeoutMs) || 5000);
      while (this.#processAlive(pid) && Date.now() < deadline) await sleep(50);
      if (this.#processAlive(pid)) throw new Error('browser_sentinel_installer_release_timeout');
    }
    this.#child = null;
    return this.#mutate({
      lifecycle: 'INSTALLER_HANDOFF',
      installer_handoff: true,
      worker_released: true,
      worker_released_at: new Date().toISOString(),
    });
  }

  markPlannedShutdownSync() {
    const current = readJsonSync(this.#statePath);
    if (!current || current.token !== this.#state?.token) return this.snapshot();
    if (current.installer_handoff === true) return this.#mutateSync({ lifecycle: 'INSTALLER_HANDOFF' });
    if (current.expected_restart === true) return this.#mutateSync({ lifecycle: 'EXPECTED_RESTART' });
    return this.#mutateSync({ lifecycle: 'PLANNED_SHUTDOWN' });
  }

  async markPlannedShutdown() { return this.markPlannedShutdownSync(); }

  async stop() {
    if (this.#beforeQuit && this.#app?.removeListener) this.#app.removeListener('before-quit', this.#beforeQuit);
    this.#beforeQuit = null;
    this.#app = null;
    return this.markPlannedShutdownSync();
  }
}

export async function readSentinelState(statePath) { return readJson(statePath); }
export async function writeSentinelState(statePath, value) {
  const current = await readJson(statePath);
  const revision = current?.token === value?.token && Number(current?.parent_pid) === Number(value?.parent_pid)
    ? Number(current?.state_revision || 0) + 1
    : 1;
  return writeJson(statePath, safeState({ ...value, state_revision: revision }));
}
