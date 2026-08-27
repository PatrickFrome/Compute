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
  const runtime = await new ComputeBrowserRuntime({
    engineExecutable: process.env.A2_CHROME_EXECUTABLE || null,
    headlessDefault: false,
    allowNoSandbox: false
  }).init();
  const rpc = await startRpcServer(runtime);
  console.log(JSON.stringify({
    schema: 'metaengine.a2-compute-browser.ready.v1',
    runtime: '0.1.0-dev.2',
    endpoint: rpc.endpoint,
    token_file: rpc.tokenFile,
    web_authority_effect: false,
    local_effects_present: true
  }));
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await rpc.close().catch(() => {});
    await runtime.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

async function selfTest() {
  const executablePath = arg('chrome') || process.env.A2_CHROME_EXECUTABLE;
  if (!executablePath) throw new Error('self_test_chrome_executable_required');
  const runtime = await new ComputeBrowserRuntime({
    engineExecutable: executablePath,
    headlessDefault: true,
    allowNoSandbox: process.env.A2_CI_ALLOW_NO_SANDBOX === '1'
  }).init();
  const profileId = `ci-smoke-${process.pid}`;
  try {
    const started = await runtime.startProfile({ profileId });
    let remoteNavigationBlocked = false;
    try { await runtime.createTarget({ profileId, targetId: 'forbidden_remote', role: 'CI_NEGATIVE', url: 'https://example.com/' }); }
    catch (error) { remoteNavigationBlocked = String(error?.message || error) === 'b1_remote_navigation_not_enabled'; }
    if (!remoteNavigationBlocked) throw new Error('self_test_remote_navigation_not_blocked');

    const entryBeforeRestart = runtime.running.get(profileId);
    const oldPid = entryBeforeRestart?.processRef?.child?.pid;
    const browserExited = new Promise((resolve) => entryBeforeRestart.processRef.child.once('exit', resolve));
    await entryBeforeRestart.processRef.cdp.call('Browser.close');
    await Promise.race([browserExited, new Promise((_, reject) => setTimeout(() => reject(new Error('self_test_browser_exit_timeout')), 5000))]);
    const restarted = await runtime.startProfile({ profileId });
    if (!restarted.running || restarted.pid === oldPid) throw new Error('self_test_crash_aware_restart_failed');

    const created = await runtime.createTarget({ profileId, targetId: 'smoke_target', role: 'CI_SMOKE', url: 'about:blank' });
    const targets = await runtime.listTargets(profileId);
    const health = await runtime.health();
    if (!started.running || !created.bound || !targets.some((row) => row.target_id === 'smoke_target' && row.bound) || health.profiles.length !== 1) throw new Error('self_test_contract_failed');
    await runtime.closeTarget({ profileId, targetId: 'smoke_target' });
    console.log(JSON.stringify({
      schema: 'metaengine.a2-compute-browser.self-test.v1',
      ok: true,
      product: started.product,
      protocol_version: started.protocol_version,
      raw_cdp_rpc_exposed: false,
      web_authority_effect: false,
      crash_aware_restart: true,
      remote_navigation_blocked: true
    }));
  } finally {
    await runtime.shutdown();
    if (process.env.A2_SELF_TEST_REMOVE_STATE === '1') await fs.rm(runtime.stateRoot, { recursive: true, force: true }).catch(() => {});
  }
}

const command = process.argv[2] || 'serve';
if (command === 'serve') await serve();
else if (command === 'self-test') await selfTest();
else throw new Error('unknown_command');
