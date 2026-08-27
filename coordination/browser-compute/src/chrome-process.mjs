import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CdpPipeClient } from './cdp-pipe-client.mjs';
import { ensurePrivateDir } from './security.mjs';

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
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isFile()) throw new Error('chrome_executable_not_found');
  return resolved;
}

async function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode != null) return true;
  return new Promise((resolve) => {
    let settled = false;
    const onExit = () => finish(true);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(value);
    };
    const timer = setTimeout(() => finish(child.exitCode != null), timeoutMs);
    child.once('exit', onExit);
  });
}

function signalChildTree(child, signal) {
  if (!child || child.exitCode != null) return;
  if (process.platform !== 'win32' && Number.isInteger(child.pid)) {
    try { process.kill(-child.pid, signal); return; } catch (_) {}
  }
  try { child.kill(signal); } catch (_) {}
}

async function terminateChild(child) {
  if (!child || child.exitCode != null) return;
  signalChildTree(child, 'SIGTERM');
  if (await waitForExit(child, 2000)) return;
  signalChildTree(child, 'SIGKILL');
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
  }

  async start() {
    if (this.child && this.child.exitCode == null && this.cdp) return this;
    this.executablePath = await assertExecutable(this.executablePath);
    await ensurePrivateDir(this.userDataDir);
    const args = buildChromeArgs({ userDataDir: this.userDataDir, headless: this.headless, allowNoSandbox: this.allowNoSandbox });
    const child = spawn(this.executablePath, args, {
      stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
      windowsHide: false,
      detached: process.platform !== 'win32'
    });
    this.child = child;
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => { this.stderrTail = `${this.stderrTail}${chunk}`.slice(-12000); });

    const pipeWrite = child.stdio?.[3];
    const pipeRead = child.stdio?.[4];
    if (!pipeWrite || !pipeRead) {
      await terminateChild(child);
      this.child = null;
      throw new Error('chrome_debug_pipe_missing');
    }

    try {
      this.cdp = await new CdpPipeClient(pipeWrite, pipeRead).connect();
      this.version = await this.cdp.call('Browser.getVersion', {}, { timeoutMs: this.startupTimeoutMs });
      this.startedAt = new Date().toISOString();
      return this;
    } catch (error) {
      await this.cdp?.close().catch(() => {});
      this.cdp = null;
      await terminateChild(child);
      if (this.child === child) this.child = null;
      throw error;
    }
  }

  async health() {
    if (!this.child || this.child.exitCode != null || !this.cdp) return { running: false, exit_code: this.child?.exitCode ?? null, debug_transport: 'native_pipe' };
    const version = await this.cdp.call('Browser.getVersion');
    return {
      running: true,
      pid: this.child.pid,
      started_at: this.startedAt,
      product: version.product,
      protocol_version: version.protocolVersion,
      debug_transport: 'native_pipe'
    };
  }

  async stop({ timeoutMs = 5000 } = {}) {
    if (!this.child) return;
    const child = this.child;
    if (child.exitCode == null) {
      try { if (this.cdp) await this.cdp.call('Browser.close', {}, { timeoutMs: 1500 }); } catch (_) {}
      if (!(await waitForExit(child, timeoutMs))) {
        signalChildTree(child, 'SIGTERM');
        if (!(await waitForExit(child, 1500))) {
          signalChildTree(child, 'SIGKILL');
          await waitForExit(child, 1500);
        }
      }
    }
    await this.cdp?.close().catch(() => {});
    this.cdp = null;
    this.child = null;
  }
}
