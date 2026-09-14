'use strict';

const { app, utilityProcess } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readHealth(manifestPath) {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const url = new URL(String(manifest.url || ''));
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/rpc') throw new Error('packaged_compute_manifest_invalid');
  const token = String(manifest.token || '');
  if (!token) throw new Error('packaged_compute_token_missing');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ id: 'packaged-smoke', method: 'runtime.health', params: {} }),
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) throw new Error(`packaged_compute_http_${response.status}`);
  const body = await response.json();
  if (body?.id !== 'packaged-smoke' || body?.ok !== true || body?.effect_class !== 'READ_ONLY' || body?.web_authority_effect !== false) {
    throw new Error('packaged_compute_read_contract_failed');
  }
  if (body?.result?.schema !== 'metaengine.a2-compute-browser.health.v1') throw new Error('packaged_compute_health_schema_invalid');
  return body.result;
}

app.whenReady().then(async () => {
  const resources = String(process.env.METAENGINE_PACKAGED_RESOURCES || '');
  const manifestPath = String(process.env.METAENGINE_COMPUTE_BRIDGE_MANIFEST || '');
  const stateRoot = String(process.env.A2_COMPUTE_STATE_ROOT || '');
  if (!resources || !manifestPath || !stateRoot) throw new Error('packaged_compute_smoke_env_missing');

  const workerPath = path.join(resources, 'app.asar.unpacked', 'src', 'compute-bridge-worker.cjs');
  const runtimeRoot = path.join(resources, 'a2-compute-browser');
  await fs.access(workerPath);
  await fs.access(path.join(runtimeRoot, 'src', 'cli.mjs'));
  await fs.access(path.join(runtimeRoot, 'src', 'rpc-server.mjs'));

  const child = utilityProcess.fork(workerPath, ['serve', '--bridge-port=0'], {
    env: {
      ...process.env,
      METAENGINE_COMPUTE_BRIDGE_ROOT: runtimeRoot,
      A2_COMPUTE_STATE_ROOT: stateRoot,
    },
  });

  let exit = null;
  child.once('exit', (code) => { exit = code; });
  const deadline = Date.now() + 10000;
  let health = null;
  let lastError = null;
  while (Date.now() < deadline) {
    if (exit != null) throw new Error(`packaged_compute_utility_exit_${exit}`);
    try {
      health = await readHealth(manifestPath);
      break;
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }
  if (!health) throw lastError || new Error('packaged_compute_health_timeout');

  console.log(JSON.stringify({
    schema: 'metaengine.compute-bridge.packaged-utility-smoke.v1',
    ok: true,
    transport: 'UTILITY_PROCESS_TO_LOOPBACK_HTTP_RPC',
    runtime: health.runtime || null,
    worker_unpacked: true,
    bundled_runtime_present: true,
    read_only_health_verified: true,
    second_scheduler_loop: false,
    authority_effect: false,
  }));
  child.kill();
  app.exit(0);
}).catch((error) => {
  console.error(JSON.stringify({
    schema: 'metaengine.compute-bridge.packaged-utility-smoke.v1',
    ok: false,
    error: String(error?.message || error),
    authority_effect: false,
  }));
  app.exit(1);
});
