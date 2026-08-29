import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const BROWSER_SENTINEL_VERSION = '1.0.0';

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, file);
}

function safeState(value) {
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
    relaunch_attempted: value.relaunch_attempted === true,
    relaunch_intent_at: value.relaunch_intent_at || null,
    relaunch_result: value.relaunch_result || null,
    created_at: value.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    authority_effect: false,
  };
}

export class BrowserSentinelHost {
  #statePath; #workerScript; #executable; #spawn; #state = null; #child = null; #beforeQuit = null; #app = null;

  constructor({ statePath, workerScript, executable = process.execPath, spawnImpl = spawn } = {}) {
    if (!statePath || !workerScript || !executable) throw new Error('browser_sentinel_paths_required');
    this.#statePath = String(statePath);
    this.#workerScript = String(workerScript);
    this.#executable = String(executable);
    this.#spawn = spawnImpl;
  }

  snapshot() { return this.#state ? structuredClone(this.#state) : null; }

  async start({ app = null } = {}) {
    const token = crypto.randomUUID();
    this.#state = safeState({
      token,
      parent_pid: process.pid,
      executable: this.#executable,
      worker_script: this.#workerScript,
      lifecycle: 'ARMED',
      expected_restart: false,
      relaunch_attempted: false,
    });
    await writeJson(this.#statePath, this.#state);
    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      METAENGINE_SENTINEL_STATE_PATH: this.#statePath,
      METAENGINE_SENTINEL_TOKEN: token,
      METAENGINE_SENTINEL_PARENT_PID: String(process.pid),
    };
    this.#child = this.#spawn(this.#executable, [this.#workerScript], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: true,
      env,
    });
    this.#child.unref?.();
    this.#app = app;
    if (app?.on) {
      this.#beforeQuit = () => { void this.markPlannedShutdown(); };
      app.on('before-quit', this.#beforeQuit);
    }
    return this.snapshot();
  }

  async #mutate(patch) {
    const current = await readJson(this.#statePath);
    if (!current || current.token !== this.#state?.token) return this.snapshot();
    this.#state = safeState({ ...current, ...patch });
    await writeJson(this.#statePath, this.#state);
    return this.snapshot();
  }

  async prepareExpectedRestart(reason = 'EXPECTED_RESTART') {
    return this.#mutate({ expected_restart: true, expected_restart_reason: reason, lifecycle: 'EXPECTED_RESTART' });
  }

  async markPlannedShutdown() {
    const current = await readJson(this.#statePath);
    if (!current || current.token !== this.#state?.token) return this.snapshot();
    if (current.expected_restart === true) return this.#mutate({ lifecycle: 'EXPECTED_RESTART' });
    return this.#mutate({ lifecycle: 'PLANNED_SHUTDOWN' });
  }

  async stop() {
    if (this.#beforeQuit && this.#app?.removeListener) this.#app.removeListener('before-quit', this.#beforeQuit);
    this.#beforeQuit = null;
    this.#app = null;
    return this.markPlannedShutdown();
  }
}

export async function readSentinelState(statePath) { return readJson(statePath); }
export async function writeSentinelState(statePath, value) { return writeJson(statePath, safeState(value)); }
