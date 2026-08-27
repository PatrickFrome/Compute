import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CdpPipeClient } from './cdp-client.mjs';
import { ensurePrivateDir } from './security.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const B3_MAX_START_ATTEMPTS = 2;

export function buildChromeArgs({ userDataDir, headless = false, allowNoSandbox = false } = {}) {
  if (!path.isAbsolute(String(userDataDir || ''))) throw new Error('user_data_dir_must_be_absolute');
  const args = [
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-pipe',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync'
  ];
  if (headless) args.push('--headless', '--disable-gpu', '--disable-software-rasterizer');
  if (allowNoSandbox) {
    if (process.env.CI !== 'true' || process.env.A2_CI_ALLOW_NO_SANDBOX !== '1') throw new Error('no_sandbox_forbidden_outside_ci');
    args.push('--no-sandbox');
  }
  args.push('about:blank');
  return args;
}

async function assertExecutable(executablePath) {
  const resolved = path.resolve(String(executablePath || ''));
  if (!path.isAbsolute(resolved)) throw new Error('chrome_executable_must_be_absolute');
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isFile()) throw new Error('chrome_executable_not_found');
  return resolved;
}

async function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode != null || child.signalCode != null) return true;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(value);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(child.exitCode != null || child.signalCode != null), timeoutMs);
    child.once('exit', onExit);
  });
}

async function terminateChild(child) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  try { child.kill('SIGTERM'); } catch (_) {}
  if (await waitForExit(child, 2000)) return;
  try { child.kill('SIGKILL'); } catch (_) {}
  await waitForExit(child, 2000);
}

export class ManagedChromeProcess {
  constructor({ executablePath, userDataDir, headless = false, allowNoSandbox = false, startupTimeoutMs = 15000 }) {
    this.executablePath = executablePath;
    this.userDataDir = userDataDir;
    this.headless = headless;
    this.allowNoSandbox = allowNoSandbox;
    this.startupTimeoutMs = startupTimeoutMs;
    this.child = null;
    this.cdp = null;
    this.version = null;
    this.startedAt = null;
    this.stderrTail = '';
    this.startupAttempts = 0;
    this.processIncarnationId = null;
    this.lifecycleState = 'STOPPED';
  }

  isRunning() {
    return this.lifecycleState === 'RUNNING' && Boolean(this.child && this.child.exitCode == null && this.child.signalCode == null && this.cdp?.connected);
  }

  async #launchOnce() {
    const args = buildChromeArgs({ userDataDir: this.userDataDir, headless: this.headless, allowNoSandbox: this.allowNoSandbox });
    const incarnation = crypto.randomUUID();
    this.processIncarnationId = incarnation;
    this.lifecycleState = 'STARTING';
    const child = spawn(this.executablePath, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], windowsHide: false });
    this.child = child;
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => { this.stderrTail = `${this.stderrTail}${chunk}`.slice(-12000); });
    const pipeWrite = child.stdio?.[3];
    const pipeRead = child.stdio?.[4];
    if (!pipeWrite || !pipeRead) {
      await terminateChild(child);
      throw new Error('chrome_debug_pipe_unavailable');
    }
    const cdp = await new CdpPipeClient({ writable: pipeWrite, readable: pipeRead }).connect();
    this.cdp = cdp;
    child.once('error', (error) => cdp.abort(new Error(`chrome_process_error:${error?.message || error}`)));
    child.once('exit', (code, signal) => {
      cdp.abort(new Error(`chrome_process_exited:${code ?? 'null'}:${signal ?? 'none'}`));
      if (this.child === child && this.lifecycleState !== 'STOPPING' && this.lifecycleState !== 'STOPPED') this.lifecycleState = 'CRASHED';
    });
    try {
      this.version = await cdp.call('Browser.getVersion', {}, { timeoutMs: this.startupTimeoutMs });
      if (this.child !== child || child.exitCode != null || child.signalCode != null) throw new Error('chrome_exited_before_debug_ready');
      this.startedAt = new Date().toISOString();
      this.lifecycleState = 'RUNNING';
      return this;
    } catch (error) {
      await cdp.close().catch(() => {});
      if (this.cdp === cdp) this.cdp = null;
      await terminateChild(child);
      if (this.child === child) this.child = null;
      this.lifecycleState = 'STOPPED';
      throw error;
    }
  }

  async start() {
    if (this.isRunning()) return this;
    this.executablePath = await assertExecutable(this.executablePath);
    await ensurePrivateDir(this.userDataDir);
    this.stderrTail = '';
    let lastError = null;
    for (let attempt = 1; attempt <= B3_MAX_START_ATTEMPTS; attempt += 1) {
      this.startupAttempts = attempt;
      try {
        return await this.#launchOnce();
      } catch (error) {
        lastError = error;
        if (attempt >= B3_MAX_START_ATTEMPTS) throw error;
        await sleep(100);
      }
    }
    throw lastError || new Error('chrome_start_failed');
  }

  async health() {
    if (!this.isRunning()) {
      return {
        running: false,
        lifecycle_state: this.lifecycleState,
        exit_code: this.child?.exitCode ?? null,
        signal_code: this.child?.signalCode ?? null,
        process_incarnation_id: this.processIncarnationId,
        startup_attempts: this.startupAttempts
      };
    }
    const version = await this.cdp.call('Browser.getVersion');
    return {
      running: true,
      lifecycle_state: this.lifecycleState,
      pid: this.child.pid,
      process_incarnation_id: this.processIncarnationId,
      started_at: this.startedAt,
      product: version.product,
      protocol_version: version.protocolVersion,
      startup_attempts: this.startupAttempts,
      debug_transport: 'native_pipe_b3'
    };
  }

  async stop({ timeoutMs = 5000 } = {}) {
    if (!this.child) {
      this.lifecycleState = 'STOPPED';
      return;
    }
    const child = this.child;
    const cdp = this.cdp;
    this.lifecycleState = 'STOPPING';
    if (child.exitCode == null && child.signalCode == null) {
      try { if (cdp?.connected) await cdp.call('Browser.close', {}, { timeoutMs: 1500 }); } catch (_) {}
      if (!(await waitForExit(child, timeoutMs))) {
        try { child.kill('SIGTERM'); } catch (_) {}
        if (!(await waitForExit(child, 1500))) {
          try { child.kill('SIGKILL'); } catch (_) {}
          await waitForExit(child, 1500);
        }
      }
    }
    await cdp?.close().catch(() => {});
    if (this.cdp === cdp) this.cdp = null;
    if (this.child === child) this.child = null;
    this.lifecycleState = 'STOPPED';
  }
}
