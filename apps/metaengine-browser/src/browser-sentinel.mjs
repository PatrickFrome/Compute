import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const BROWSER_SENTINEL_VERSION = '1.2.0';

const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_RETRY_DELAYS_MS = Object.freeze([0, 25, 50, 100, 200, 400]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sleepSync(ms) {
  if (!(Number(ms) > 0)) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(ms));
}

function transientRenameError(error) {
  return TRANSIENT_RENAME_CODES.has(String(error?.code || '').toUpperCase());
}

async function targetMatchesPayload(file, payload) {
  try { return await fs.readFile(file, 'utf8') === payload; }
  catch { return false; }
}

function targetMatchesPayloadSync(file, payload) {
  try { return fsSync.readFileSync(file, 'utf8') === payload; }
  catch { return false; }
}

async function renameWithReadback(temp, file, payload) {
  let lastError = null;
  for (let attempt = 0; attempt < RENAME_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await sleep(RENAME_RETRY_DELAYS_MS[attempt]);
    try {
      await fs.rename(temp, file);
      return { attempts: attempt + 1, recoveredViaReadback: false };
    } catch (error) {
      lastError = error;
      // Windows file-system filters can report a transient rename failure after the
      // replacement committed. Prove the exact payload before any retry so an
      // ambiguous already-committed replace is never replayed.
      if (await targetMatchesPayload(file, payload)) {
        return { attempts: attempt + 1, recoveredViaReadback: true };
      }
      if (!transientRenameError(error) || attempt === RENAME_RETRY_DELAYS_MS.length - 1) throw error;
    }
  }
  throw lastError || new Error('browser_sentinel_rename_failed');
}

function renameWithReadbackSync(temp, file, payload) {
  let lastError = null;
  for (let attempt = 0; attempt < RENAME_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) sleepSync(RENAME_RETRY_DELAYS_MS[attempt]);
    try {
      fsSync.renameSync(temp, file);
      return { attempts: attempt + 1, recoveredViaReadback: false };
    } catch (error) {
      lastError = error;
      if (targetMatchesPayloadSync(file, payload)) {
        return { attempts: attempt + 1, recoveredViaReadback: true };
      }
      if (!transientRenameError(error) || attempt === RENAME_RETRY_DELAYS_MS.length - 1) throw error;
    }
  }
  throw lastError || new Error('browser_sentinel_rename_failed');
}

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
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(temp, payload, { mode: 0o600 });
  const outcome = await renameWithReadback(temp, file, payload);
  if (outcome.recoveredViaReadback) await fs.unlink(temp).catch(() => {});
}

function writeJsonSync(file, value) {
  fsSync.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  fsSync.writeFileSync(temp, payload, { mode: 0o600 });
  const outcome = renameWithReadbackSync(temp, file, payload);
  if (outcome.recoveredViaReadback) {
    try { fsSync.unlinkSync(temp); } catch {}
  }
}

function safeState(value) {
  const relaunchPid = Number(value.relaunch_pid || 0);
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
    relaunch_pid: Number.isSafeInteger(relaunchPid) && relaunchPid > 0 ? relaunchPid : null,
    relaunch_result: value.relaunch_result || null,
    created_at: value.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
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
    this.#state = safeState({ ...current, ...patch });
    await writeJson(this.#statePath, this.#state);
    return this.snapshot();
  }

  #mutateSync(patch) {
    const current = readJsonSync(this.#statePath);
    if (!current || current.token !== this.#state?.token) return this.snapshot();
    this.#state = safeState({ ...current, ...patch });
    writeJsonSync(this.#statePath, this.#state);
    return this.snapshot();
  }

  async prepareExpectedRestart(reason = 'EXPECTED_RESTART') {
    return this.#mutate({ expected_restart: true, expected_restart_reason: reason, lifecycle: 'EXPECTED_RESTART' });
  }

  markPlannedShutdownSync() {
    const current = readJsonSync(this.#statePath);
    if (!current || current.token !== this.#state?.token) return this.snapshot();
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
