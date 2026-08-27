#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CONTEXT_ID } from './context-manager.mjs';
import { ComputeBrowserRuntime } from './runtime.mjs';
import { startRpcServer } from './rpc-server.mjs';

function arg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

async function serve() {
  const runtime = await new ComputeBrowserRuntime({ engineExecutable: process.env.A2_CHROME_EXECUTABLE || null, headlessDefault: false, allowNoSandbox: false }).init();
  const rpc = await startRpcServer(runtime);
  console.log(JSON.stringify({ schema: 'metaengine.a2-compute-browser.ready.v1', runtime: '0.2.0-dev.1', endpoint: rpc.endpoint, token_file: rpc.tokenFile, web_authority_effect: false, local_effects_present: true, debug_transport: 'native_pipe_b3', devtools_tcp_exposed: false, context_manager: 'b2_logical_context_v1' }));
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
  const runtime = await new ComputeBrowserRuntime({ engineExecutable: executablePath, headlessDefault: true, allowNoSandbox: process.env.A2_CI_ALLOW_NO_SANDBOX === '1' }).init();
  const profileId = `ci-smoke-${process.pid}`;
  try {
    const started = await runtime.startProfile({ profileId });
    let remoteNavigationBlocked = false;
    try { await runtime.createTarget({ profileId, targetId: 'forbidden_remote', role: 'CI_NEGATIVE', url: 'https://example.com/' }); }
    catch (error) { remoteNavigationBlocked = String(error?.message || error) === 'b1_remote_navigation_not_enabled'; }
    if (!remoteNavigationBlocked) throw new Error('self_test_remote_navigation_not_blocked');

    let defaultCloseBlocked = false;
    try { await runtime.closeContext({ profileId, contextId: DEFAULT_CONTEXT_ID }); }
    catch (error) { defaultCloseBlocked = String(error?.message || error) === 'default_context_close_forbidden'; }
    if (!defaultCloseBlocked) throw new Error('self_test_default_context_close_not_blocked');

    const contextA = await runtime.createContext({ profileId, contextId: 'context_alpha' });
    const contextB = await runtime.createContext({ profileId, contextId: 'context_beta' });
    const entry = runtime.running.get(profileId);
    const physicalA = entry.contextBindings.get(contextA.context_id)?.cdp_browser_context_id;
    const physicalB = entry.contextBindings.get(contextB.context_id)?.cdp_browser_context_id;
    if (!physicalA || !physicalB || physicalA === physicalB) throw new Error('self_test_context_physical_isolation_failed');

    const targetA = await runtime.createTarget({ profileId, targetId: 'target_alpha', contextId: contextA.context_id, role: 'CI_CONTEXT_A' });
    const targetB = await runtime.createTarget({ profileId, targetId: 'target_beta', contextId: contextB.context_id, role: 'CI_CONTEXT_B' });
    const targetInfos = await entry.processRef.cdp.call('Target.getTargets');
    const physicalTargetA = entry.bindings.get(targetA.target_id)?.cdp_target_id;
    const physicalTargetB = entry.bindings.get(targetB.target_id)?.cdp_target_id;
    const infoA = targetInfos.targetInfos.find((row) => row.targetId === physicalTargetA);
    const infoB = targetInfos.targetInfos.find((row) => row.targetId === physicalTargetB);
    if (infoA?.browserContextId !== physicalA || infoB?.browserContextId !== physicalB) throw new Error('self_test_target_context_binding_failed');

    await runtime.closeContext({ profileId, contextId: contextA.context_id });
    const targetsAfterClose = await runtime.listTargets(profileId, { includeRetired: true });
    if (targetsAfterClose.find((row) => row.target_id === targetA.target_id)?.status !== 'RETIRED') throw new Error('self_test_context_target_retirement_failed');
    if (targetsAfterClose.find((row) => row.target_id === targetB.target_id)?.status !== 'ACTIVE') throw new Error('self_test_context_cross_mutation');
    await runtime.closeTarget({ profileId, targetId: targetB.target_id });
    await runtime.closeContext({ profileId, contextId: contextB.context_id });

    const entryBeforeRestart = runtime.running.get(profileId);
    const oldPid = entryBeforeRestart?.processRef?.child?.pid;
    const browserExited = new Promise((resolve) => entryBeforeRestart.processRef.child.once('exit', resolve));
    await entryBeforeRestart.processRef.cdp.call('Browser.close', {}, { timeoutMs: 1500 }).catch(() => {});
    await Promise.race([browserExited, new Promise((_, reject) => setTimeout(() => reject(new Error('self_test_browser_exit_timeout')), 5000))]);
    const restarted = await runtime.startProfile({ profileId });
    if (!restarted.running || restarted.pid === oldPid || restarted.debug_transport !== 'native_pipe') throw new Error('self_test_crash_aware_restart_failed');

    const health = await runtime.health();
    if (health.devtools_tcp_exposed !== false || health.context_manager !== 'b2_logical_context_v1') throw new Error('self_test_health_contract_failed');
    console.log(JSON.stringify({ schema: 'metaengine.a2-compute-browser.self-test.v1', ok: true, product: started.product, protocol_version: started.protocol_version, raw_cdp_rpc_exposed: false, web_authority_effect: false, crash_aware_restart: true, remote_navigation_blocked: true, default_context_close_blocked: true, context_isolation_verified: true, target_context_binding_verified: true, debug_transport: 'native_pipe_b3', devtools_tcp_exposed: false, context_manager: 'b2_logical_context_v1' }));
  } finally {
    await runtime.shutdown();
    if (process.env.A2_SELF_TEST_REMOVE_STATE === '1') await fs.rm(runtime.stateRoot, { recursive: true, force: true }).catch(() => {});
  }
}

const command = process.argv[2] || 'serve';
if (command === 'serve') await serve();
else if (command === 'self-test') await selfTest();
else throw new Error('unknown_command');
