import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { CdpClient } from './cdp-client.mjs';
import { ensurePrivateDir } from './security.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const B1_MAX_START_ATTEMPTS = 2;

export function buildChromeArgs({ userDataDir, debuggingPort, headless = false, allowNoSandbox = false } = {}) {
  if (!path.isAbsolute(String(userDataDir || ''))) throw new Error('user_data_dir_must_be_absolute');
  if (!Number.isInteger(debuggingPort) || debuggingPort < 1024 || debuggingPort > 65535) throw new Error('debugging_port_invalid');
  const args = [
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${debuggingPort}`,
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

async function allocateLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!Number.isInteger(port) || port <= 0) throw new Error('debugging_port_allocate_failed');
  return port;
}

async function readEndpoint(port, processRef, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processRef.exitCode != null) throw new Error(`chrome_exited_before_debug_ready:${processRef.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(750) });
      if (response.ok) {
        const body = await response.json();
        const endpoint = String(body?.webSocketDebuggerUrl || '');
        if (endpoint.startsWith(`ws://127.0.0.1:${port}/devtools/browser/`)) return endpoint;
      }
    } catch (_) {}
    await sleep(50);
  }
  throw new Error('chrome_debug_endpoint_timeout');
}

async function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode != null) return true;
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
    const timer = setTimeout(() => finish(child.exitCode != null), timeoutMs);
    child.once('exit', onExit);
  });
}

async function terminateChild(child) {
  if (!child || child.exitCode != null) return;
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
  }

  async #launchOnce(debuggingPort) {
    const args = buildChromeArgs({ userDataDir: this.userDataDir, debuggingPort, headless: this.headless, allowNoSandbox: this.allowNoSandbox });
    const child = spawn(this.executablePath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: false });
    this.child = child;
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => { this.stderrTail = `${this.stderrTail}${chunk}`.slice(-12000); });
    try {
      const endpoint = await readEndpoint(debuggingPort, child, this.startupTimeoutMs);
      this.cdp = await new CdpClient(endpoint).connect();
      this.version = await this.cdp.call('Browser.getVersion');
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

  async start() {
    if (this.child && this.child.exitCode == null && this.cdp) return this;
    this.executablePath = await assertExecutable(this.executablePath);
    await ensurePrivateDir(this.userDataDir);
    this.stderrTail = '';
    let lastError = null;
    for (let attempt = 1; attempt <= B1_MAX_START_ATTEMPTS; attempt += 1) {
      this.startupAttempts = attempt;
      const debuggingPort = await allocateLoopbackPort();
      try {
        return await this.#launchOnce(debuggingPort);
      } catch (error) {
        lastError = error;
        if (String(error?.message || error) !== 'chrome_debug_endpoint_timeout' || attempt >= B1_MAX_START_ATTEMPTS) throw error;
        await sleep(100);
      }
    }
    throw lastError || new Error('chrome_start_failed');
  }

  async health() {
    if (!this.child || this.child.exitCode != null || !this.cdp) return { running: false, exit_code: this.child?.exitCode ?? null, startup_attempts: this.startupAttempts };
    const version = await this.cdp.call('Browser.getVersion');
    return { running: true, pid: this.child.pid, started_at: this.startedAt, product: version.product, protocol_version: version.protocolVersion, startup_attempts: this.startupAttempts };
  }

  async stop({ timeoutMs = 5000 } = {}) {
    if (!this.child) return;
    const child = this.child;
    if (child.exitCode == null) {
      try { if (this.cdp) await this.cdp.call('Browser.close', {}, { timeoutMs: 1500 }); } catch (_) {}
      if (!(await waitForExit(child, timeoutMs))) {
        try { child.kill('SIGTERM'); } catch (_) {}
        if (!(await waitForExit(child, 1500))) {
          try { child.kill('SIGKILL'); } catch (_) {}
          await waitForExit(child, 1500);
        }
      }
    }
    await this.cdp?.close().catch(() => {});
    this.cdp = null;
    this.child = null;
  }
}
