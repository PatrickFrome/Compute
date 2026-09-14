'use strict';

const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

app.whenReady().then(async () => {
  const resources = String(process.env.METAENGINE_PACKAGED_RESOURCES || '');
  const manifestPath = String(process.env.METAENGINE_COMPUTE_BRIDGE_MANIFEST || '');
  const stateRoot = String(process.env.A2_COMPUTE_STATE_ROOT || '');
  if (!resources || !manifestPath || !stateRoot) throw new Error('packaged_compute_smoke_env_missing');

  const archivedClientPath = path.join(resources, 'app.asar', 'src', 'compute-bridge-client.mjs');
  const workerPath = path.join(resources, 'app.asar.unpacked', 'src', 'compute-bridge-worker.cjs');
  const runtimeRoot = path.join(resources, 'a2-compute-browser');
  await fs.access(archivedClientPath);
  await fs.access(workerPath);
  await fs.access(path.join(runtimeRoot, 'src', 'cli.mjs'));
  await fs.access(path.join(runtimeRoot, 'src', 'rpc-server.mjs'));

  const { ComputeBridgeClient, resolveComputeBridgeWorkerPath } = await import(pathToFileURL(archivedClientPath).href);
  const asarWorkerPath = path.join(resources, 'app.asar', 'src', 'compute-bridge-worker.cjs');
  if (resolveComputeBridgeWorkerPath(asarWorkerPath) !== workerPath) throw new Error('packaged_compute_default_worker_not_unpacked');
  const client = new ComputeBridgeClient({
    runtimeRoot,
    autoStartTimeoutMs: 10000,
    timeoutMs: 1500,
  });
  const health = await client.health();
  if (health?.state !== 'HEALTHY' || health?.available !== true || health?.result?.schema !== 'metaengine.a2-compute-browser.health.v1') {
    throw new Error(`packaged_compute_client_health_failed:${health?.state || 'missing'}:${health?.reason_code || 'none'}`);
  }
  if (health?.automatic_remediation !== true || health?.remediation !== 'BUNDLED_DAEMON_AUTOSTART') {
    throw new Error('packaged_compute_client_autostart_not_proven');
  }

  console.log(JSON.stringify({
    schema: 'metaengine.compute-bridge.packaged-utility-smoke.v1',
    ok: true,
    transport: health.transport,
    runtime: health.result.runtime || null,
    worker_unpacked: true,
    production_client_default_worker_path_verified: true,
    bundled_runtime_present: true,
    read_only_health_verified: true,
    second_scheduler_loop: false,
    authority_effect: false,
  }));
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
