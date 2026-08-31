import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const BROWSER_SENTINEL_VERSION = '1.4.0';
export const BROWSER_SENTINEL_WORKER_HEARTBEAT_MAX_AGE_MS = 8_000;

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

function readJsonSync(file) {
  try { return JSON.parse(fsSync.readFileSync(file, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, file);
}

function writeJsonSync(file, value) {
  fsSync.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fsSync.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fsSync.renameSync(temp, file);
}

export function browserSentinelWorkerHeartbeatPath(statePath) {
  return `${String(statePath)}.worker-heartbeat-v1.json`;
}

function safeState(value) {
  const relaunchPid = Number(value.relaunch_pid || 0);
  const workerPid = Number(value.worker_pid || 0);
  return {
    schema: 'metaengine.browser-sentinel.state.v1',
    version: BROWSER_SENTINEL_VERSION,
    token: String(value.token || ''),
    parent_pid: Number(value.parent_pid || 0),
    executable: String(value.executable || ''),
    worker_script: String(value.worker_script || ''),
    lifecycle: String(value.lifecycle || 'ARMED'),
    expected_restart: value.expected_restart === true,
    expected_restart_reason: value.expected_restart_reason ? String(value.expected_restart_reason).slice(0, 120) : null,
    installer_handoff: value.installer_handoff === true,
    worker_pid: Number.isSafeInteger(workerPid) && workerPid > 0 ? workerPid : null,
    worker_released: value.worker_released === true,
    worker_released_at: value.worker_released_at || null,
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
  #statePath; #workerScript; #executable; #spawn; #state = null; #child = null; #beforeQuit = null; #app = null;

  constructor({ statePath, workerScript, executable = process.execPath, spawnImpl = spawn } = {}) {
    if (!statePath || !workerScript || !executable) throw new Error('browser_sentinel_paths_required');
    this.#statePath = String(statePath);
    this.#workerScript = String(workerScript);
    this.#executable = String(executable);
    this.#spawn = spawnImpl;
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

  async start({ app = null } = {}) {
    const token = crypto.randomUUID();
    this.#state = safeState({
      token,
      parent_pid: process.pid,
      executable: this.#executable,
      worker_script: this.#workerScript,
      lifecycle: 'ARMED',
      expected_restart: false,
      installer_handoff: false,
      worker_pid: null,
      worker_released: false,
      relaunch_attempted: false,
      relaunch_pid: null,
    });
    await writeJson(this.#statePath, this.#state);
    const env = sentinelEnvironment(process.env, { statePath: this.#statePath, token, parentPid: process.pid });
    this.#child = this.#spawn(this.#executable, [this.#workerScript], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: true,
      env,
    });
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
    if (!current || current.token !== this.#state?.token) return this.snapshot();
    this.#state = safeState({ ...current, ...patch, updated_at: new Date().toISOString() });
    await writeJson(this.#statePath, this.#state);
    return this.snapshot();
  }

  #mutateSync(patch) {
    const current = readJsonSync(this.#statePath);
    if (!current || current.token !== this.#state?.token) return this.snapshot();
    this.#state = safeState({ ...current, ...patch, updated_at: new Date().toISOString() });
    writeJsonSync(this.#statePath, this.#state);
    return this.snapshot();
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
    if (child && processAlive(pid)) {
      const dispatched = child.kill();
      if (dispatched === false && processAlive(pid)) throw new Error('browser_sentinel_installer_release_failed');
      const deadline = Date.now() + Math.max(500, Number(timeoutMs) || 5000);
      while (processAlive(pid) && Date.now() < deadline) await sleep(50);
      if (processAlive(pid)) throw new Error('browser_sentinel_installer_release_timeout');
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
export async function writeSentinelState(statePath, value) { return writeJson(statePath, safeState(value)); }
