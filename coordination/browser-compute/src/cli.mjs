#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { ComputeBrowserRuntime } from './runtime.mjs';
import { startRpcServer } from './rpc-server.mjs';

function arg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

async function serve() {
  const runtime = await new ComputeBrowserRuntime().init();
  const rpc = await startRpcServer(runtime);
  console.log(JSON.stringify({ schema: 'metaengine.a2-compute-browser.ready.v1', runtime: '0.1.0-dev.1', endpoint: rpc.endpoint, token_file: path.join(runtime.stateRoot, 'control-token'), authority_effect: false }));
  const stop = async () => { await rpc.close().catch(() => {}); await runtime.shutdown(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

async function selfTest() {
  const executablePath = arg('chrome') || process.env.A2_CHROME_EXECUTABLE;
  if (!executablePath) throw new Error('self_test_chrome_executable_required');
  const runtime = await new ComputeBrowserRuntime().init();
  const profileId = `ci-smoke-${process.pid}`;
  try {
    const started = await runtime.startProfile({ profileId, executablePath, headless: true, allowNoSandbox: process.env.A2_CI_ALLOW_NO_SANDBOX === '1' });
    const created = await runtime.createTarget({ profileId, targetId: 'smoke_target', role: 'CI_SMOKE', url: 'about:blank' });
    const targets = await runtime.listTargets(profileId);
    const health = await runtime.health();
    if (!started.running || !created.bound || !targets.some((row) => row.target_id === 'smoke_target' && row.bound) || health.profiles.length !== 1) throw new Error('self_test_contract_failed');
    await runtime.closeTarget({ profileId, targetId: 'smoke_target' });
    console.log(JSON.stringify({ schema: 'metaengine.a2-compute-browser.self-test.v1', ok: true, product: started.product, protocol_version: started.protocol_version, raw_cdp_rpc_exposed: false }));
  } finally {
    await runtime.shutdown();
    if (process.env.A2_SELF_TEST_REMOVE_STATE === '1') await fs.rm(runtime.stateRoot, { recursive: true, force: true }).catch(() => {});
  }
}

const command = process.argv[2] || 'serve';
if (command === 'serve') await serve();
else if (command === 'self-test') await selfTest();
else throw new Error('unknown_command');
