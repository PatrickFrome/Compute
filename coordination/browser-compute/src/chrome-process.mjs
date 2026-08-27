import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { CdpClient } from './cdp-client.mjs';
import { ensurePrivateDir } from './security.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    if (this.child && this.child.exitCode == null) return this;
    this.executablePath = await assertExecutable(this.executablePath);
    await ensurePrivateDir(this.userDataDir);
    const debuggingPort = await allocateLoopbackPort();
    const args = buildChromeArgs({ userDataDir: this.userDataDir, debuggingPort, headless: this.headless, allowNoSandbox: this.allowNoSandbox });
    const child = spawn(this.executablePath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: false });
    this.child = child;
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => { this.stderrTail = `${this.stderrTail}${chunk}`.slice(-12000); });
    const endpoint = await readEndpoint(debuggingPort, child, this.startupTimeoutMs);
    this.cdp = await new CdpClient(endpoint).connect();
    this.version = await this.cdp.call('Browser.getVersion');
    this.startedAt = new Date().toISOString();
    return this;
  }

  async health() {
    if (!this.child || this.child.exitCode != null || !this.cdp) return { running: false, exit_code: this.child?.exitCode ?? null };
    const version = await this.cdp.call('Browser.getVersion');
    return { running: true, pid: this.child.pid, started_at: this.startedAt, product: version.product, protocol_version: version.protocolVersion };
  }

  async stop({ timeoutMs = 5000 } = {}) {
    if (!this.child) return;
    const child = this.child;
    if (child.exitCode == null) {
      try { if (this.cdp) await this.cdp.call('Browser.close', {}, { timeoutMs: 1500 }); } catch (_) {}
      if (child.exitCode == null) {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        await Promise.race([exited, sleep(timeoutMs)]);
        if (child.exitCode == null) child.kill('SIGTERM');
        await Promise.race([exited, sleep(1500)]);
        if (child.exitCode == null) child.kill('SIGKILL');
      }
    }
    await this.cdp?.close().catch(() => {});
    this.cdp = null;
    this.child = null;
  }
}
