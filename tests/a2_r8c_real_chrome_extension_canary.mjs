import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chrome = process.env.A2_CHROME_EXECUTABLE;
const stage = process.env.A2_R8C_STAGE;
if (!chrome || !fs.existsSync(chrome)) throw new Error('r8c_canary_chrome_missing');
if (!stage || !fs.existsSync(stage)) throw new Error('r8c_canary_stage_missing');

const root = await mkdtemp(path.join(os.tmpdir(), 'a2-r8c-live-'));
const cert = path.join(root, 'fixture.crt');
const key = path.join(root, 'fixture.key');
const profile = path.join(root, 'profile');
const fixtureUrl = 'https://chatgpt.com:8443/';
let child = null;
let server = null;
let cdp = null;

class CdpClient {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.opened = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(`cdp_${message.error.code}:${message.error.message}`));
      else entry.resolve(message.result || {});
    });
  }
  async send(method, params = {}, sessionId = null) {
    await this.opened;
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    const response = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify(payload));
    return response;
  }
  close() { try { this.ws.close(); } catch {} }
}

function extensionIdFromManifest() {
  const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'manifest.json'), 'utf8'));
  const bytes = Buffer.from(manifest.key, 'base64');
  const digest = crypto.createHash('sha256').update(bytes).digest().subarray(0, 16);
  const alphabet = 'abcdefghijklmnop';
  return [...digest].map((b) => alphabet[b >> 4] + alphabet[b & 15]).join('');
}

async function waitForFile(file, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (fs.existsSync(file)) return;
    await sleep(100);
  }
  throw new Error(`r8c_canary_timeout:${file}`);
}

async function evaluate(sessionId, expression) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  }, sessionId);
  if (response.exceptionDetails) throw new Error(`runtime_evaluate_exception:${JSON.stringify(response.exceptionDetails)}`);
  return response.result?.value;
}

async function waitForTarget(predicate, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const { targetInfos = [] } = await cdp.send('Target.getTargets');
    const match = targetInfos.find(predicate);
    if (match) return match;
    await sleep(100);
  }
  throw new Error('r8c_canary_target_timeout');
}

try {
  const openssl = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '1',
    '-subj', '/CN=chatgpt.com', '-addext', 'subjectAltName=DNS:chatgpt.com'
  ], { stdio: 'ignore' });
  if (openssl.status !== 0) throw new Error('r8c_canary_openssl_failed');

  const html = `<!doctype html><meta charset="utf-8"><title>R8C Canary</title>
    <style>#r8c-canary{display:block;width:180px;height:64px;margin:40px;border:1px solid currentColor}</style>
    <main><div id="r8c-canary" role="button" tabindex="0" aria-label="R8C Canary"></div>
    <output id="r8c-canary-state">0</output></main>
    <script>
      window.__a2R8cClickCount = 0;
      document.querySelector('#r8c-canary').addEventListener('click', () => {
        window.__a2R8cClickCount += 1;
        document.querySelector('#r8c-canary-state').textContent = String(window.__a2R8cClickCount);
      });
    </script>`;
  server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(8443, '127.0.0.1', resolve);
  });

  const chromeArgs = [
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-dev-shm-usage',
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${stage}`,
    `--load-extension=${stage}`,
    '--remote-debugging-port=0',
    '--ignore-certificate-errors',
    '--host-resolver-rules=MAP chatgpt.com 127.0.0.1',
    fixtureUrl,
  ];
  if (process.env.CI === 'true') chromeArgs.unshift('--no-sandbox');
  const useXvfb = process.platform === 'linux' && !process.env.DISPLAY;
  child = useXvfb
    ? spawn('xvfb-run', ['-a', chrome, ...chromeArgs], { stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(chrome, chromeArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', () => {});

  const activePortFile = path.join(profile, 'DevToolsActivePort');
  await waitForFile(activePortFile);
  const [portLine] = String(await readFile(activePortFile, 'utf8')).trim().split(/\r?\n/);
  const port = Number(portLine);
  if (!Number.isInteger(port) || port <= 0) throw new Error('r8c_canary_bad_devtools_port');
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
  cdp = new CdpClient(version.webSocketDebuggerUrl);
  await cdp.opened;

  const extensionId = extensionIdFromManifest();
  await waitForTarget((target) => target.url === fixtureUrl && target.type === 'page');
  const created = await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/sidepanel.html` });
  const sideTarget = await waitForTarget((target) => target.targetId === created.targetId);
  const sideAttach = await cdp.send('Target.attachToTarget', { targetId: sideTarget.targetId, flatten: true });
  const sideSession = sideAttach.sessionId;
  await cdp.send('Runtime.enable', {}, sideSession);

  await evaluate(sideSession, `(async () => { await chrome.storage.local.set({chatgptUrl:${JSON.stringify(fixtureUrl)}}); return true; })()`);
  const perception = await evaluate(sideSession, `(async () => await chrome.runtime.sendMessage({type:'A2_OPERATOR_CAPTURE_PERCEPTION',platform:'CHATGPT',options:{include_screenshot:false,ax_limit:240,dom_limit:120}}))()`);
  if (!perception?.ok || !perception?.perception) throw new Error(`r8c_canary_perception_failed:${JSON.stringify(perception)}`);
  const button = perception.perception.accessibility?.find((node) => String(node?.role || '').toLowerCase() === 'button' && String(node?.name || '') === 'R8C Canary');
  if (!button?.backend_dom_node_id) throw new Error('r8c_canary_button_not_perceived');

  const clickMessage = {
    type: 'A2_OPERATOR_TYPED_CLICK_V1',
    action_id: 'r8c-live-canary-1',
    platform: 'CHATGPT',
    perception_captured_at: perception.perception.captured_at,
    role: 'button',
    accessible_name: 'R8C Canary',
  };
  const click = await evaluate(sideSession, `(async () => await chrome.runtime.sendMessage(${JSON.stringify(clickMessage)}))()`);
  if (!click?.ok || click?.result?.outcome !== 'COMMITTED' || click?.result?.physical_dispatch_started !== true) {
    throw new Error(`r8c_canary_click_not_committed:${JSON.stringify(click)}`);
  }

  await sleep(1600);
  const fixtureTarget = await waitForTarget((target) => target.url === fixtureUrl && target.type === 'page');
  const fixtureAttach = await cdp.send('Target.attachToTarget', { targetId: fixtureTarget.targetId, flatten: true });
  const fixtureSession = fixtureAttach.sessionId;
  const effect = await evaluate(fixtureSession, `({count:Number(window.__a2R8cClickCount||0),state:String(document.querySelector('#r8c-canary-state')?.textContent||'')})`);
  if (effect?.count !== 1 || effect?.state !== '1') throw new Error(`r8c_canary_physical_effect_mismatch:${JSON.stringify(effect)}`);

  console.log(JSON.stringify({
    ok: true,
    milestone: 'R8C_TYPED_EXTENSION_CLICK_OUTCOME',
    staged_extension_under_test: true,
    trusted_sidepanel_sender: true,
    perception_from_staged_extension: true,
    typed_click_outcome: click.result.outcome,
    physical_dispatch_started: click.result.physical_dispatch_started,
    real_page_physical_effect_verified: true,
    page_click_count: effect.count,
    automatic_retry_allowed: click.result.automatic_retry_allowed,
    authority_effect: click.result.authority_effect,
  }));
} finally {
  cdp?.close();
  if (child && !child.killed) child.kill('SIGTERM');
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
