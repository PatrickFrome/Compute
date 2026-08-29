import { app, ipcMain, webContents } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { captureSemanticFrame, executeSemanticCommand } from './native-browser-control.mjs';
import { FleetRuntimeStore } from './fleet-runtime-store-v1.mjs';
import { FleetRuntime } from './fleet-runtime-v1.mjs';
import { SupervisorKeepalive } from './supervisor-keepalive-v1.mjs';
import { NativeSupervisorKeepaliveTransport } from './supervisor-keepalive-transport-v1.mjs';

const LOOP_MS = 2000;
const FLEET_SYNC_MS = 2000;
const DISABLED_FOR_SMOKE = process.argv.includes('--metaengine-smoke') || process.argv.includes('--metaengine-devplane-smoke');
let runtimeStore = null;
let fleetRuntime = null;
let keepalive = null;
let fleetSyncTimer = null;
let syncMutex = Promise.resolve();

function runtimeStatePath() {
  return path.join(app.getPath('userData'), 'metaengine-fleet-runtime-v1.json');
}

function provisionerStatePath() {
  return path.join(app.getPath('userData'), 'metaengine-fleet-state-v1.json');
}

function exactConversationUrl(value) {
  const url = new URL(String(value || ''));
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

function localBindingFromEnv() {
  const conversationId = String(process.env.METAENGINE_SUPERVISOR_CONVERSATION_ID || '').trim();
  const conversationUrl = String(process.env.METAENGINE_SUPERVISOR_CONVERSATION_URL || '').trim();
  if (!conversationId && !conversationUrl) return null;
  if (!conversationId || !conversationUrl) throw new Error('keepalive_env_binding_incomplete');
  return {
    supervisor_id: String(process.env.METAENGINE_SUPERVISOR_ID || 'METAENGINE_SUPERVISOR').trim(),
    supervisor_epoch: Number(process.env.METAENGINE_SUPERVISOR_EPOCH || 1),
    conversation_id: conversationId,
    conversation_url: conversationUrl,
  };
}

function semanticConfigFromEnv() {
  return {
    composerRole: String(process.env.METAENGINE_SUPERVISOR_COMPOSER_ROLE || 'textbox').trim().toLowerCase(),
    composerName: String(process.env.METAENGINE_SUPERVISOR_COMPOSER_NAME || '').trim(),
    sendRole: String(process.env.METAENGINE_SUPERVISOR_SEND_ROLE || 'button').trim().toLowerCase(),
    sendName: String(process.env.METAENGINE_SUPERVISOR_SEND_NAME || '').trim(),
  };
}

function assertTrustedLocalSender(event) {
  const senderUrl = String(event?.sender?.getURL?.() || '');
  if (!senderUrl.startsWith('metaengine://shell/')) throw new Error('c5_local_shell_sender_required');
}

async function resolveBoundView(binding) {
  const expected = exactConversationUrl(binding?.conversation_url);
  const matches = webContents.getAllWebContents().filter((wc) => {
    if (!wc || wc.isDestroyed()) return false;
    const current = String(wc.getURL?.() || '');
    if (!current.startsWith('https://')) return false;
    try { return exactConversationUrl(current) === expected; } catch { return false; }
  });
  if (matches.length !== 1) throw new Error(matches.length ? `keepalive_bound_surface_ambiguous:${matches.length}` : 'keepalive_bound_surface_not_found');
  const wc = matches[0];
  return {
    tab: { tab_id: `webcontents:${wc.id}` },
    view: { webContents: wc },
    target_incarnation: `webcontents:${wc.id}`,
  };
}

async function readProvisionerState() {
  try {
    const parsed = JSON.parse(await fs.readFile(provisionerStatePath(), 'utf8'));
    if (parsed?.schema !== 'metaengine.browser.fleet-state.v1' || !Array.isArray(parsed.agents)) return null;
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw new Error('c5_provisioner_state_corrupt', { cause: error });
    throw error;
  }
}

async function syncFleetProvisionerState() {
  if (!fleetRuntime) return;
  const provisioner = await readProvisionerState();
  if (!provisioner) return;
  const runtimeSnapshot = fleetRuntime.snapshot();
  const existing = new Map(runtimeSnapshot.worker_bindings.map((row) => [row.agent_id, row]));

  for (const agent of provisioner.agents) {
    if (agent?.lifecycle_state === 'BOUND_UNVERIFIED' && agent?.tab_id && agent?.target_id) {
      const incarnation = `${String(agent.agent_id).toLowerCase()}:g${Number(agent.generation_epoch)}:${String(agent.target_id).toLowerCase()}`;
      if (existing.get(String(agent.agent_id).toLowerCase())?.worker_incarnation_id !== incarnation) {
        await fleetRuntime.bindWorkerIncarnation(agent);
      }
      continue;
    }
    if (agent?.lifecycle_state === 'LOST') {
      const prior = existing.get(String(agent.agent_id || '').toLowerCase());
      if (prior) {
        await fleetRuntime.markWorkerLost({
          worker_id: prior.agent_id,
          worker_incarnation_id: prior.worker_incarnation_id,
          reason: String(agent.lost_reason || 'PROVISIONER_REPORTED_LOST').slice(0, 200),
        });
      }
    }
  }
}

async function refreshSupervisorTargetIncarnation() {
  if (!keepalive) return;
  const binding = keepalive.status().binding;
  if (!binding) return;
  try {
    const resolved = await resolveBoundView(binding);
    if (binding.target_incarnation !== resolved.target_incarnation || binding.tab_id !== resolved.tab.tab_id) {
      await keepalive.bindTargetIncarnation({
        tab_id: resolved.tab.tab_id,
        target_incarnation: resolved.target_incarnation,
      });
    }
  } catch {
    // Fail closed. Keepalive transport must prove the exact bound surface before any wake.
  }
}

function startFleetSyncLoop() {
  if (fleetSyncTimer) return;
  const run = () => {
    const next = syncMutex.then(async () => {
      await syncFleetProvisionerState();
      await refreshSupervisorTargetIncarnation();
    }, async () => {
      await syncFleetProvisionerState();
      await refreshSupervisorTargetIncarnation();
    });
    syncMutex = next.catch((error) => console.error('c5-fleet-sync-failed', error));
  };
  run();
  fleetSyncTimer = setInterval(run, FLEET_SYNC_MS);
}

async function c5Status() {
  return {
    schema: 'metaengine.browser.c5-runtime.snapshot.v1',
    runtime: fleetRuntime?.snapshot() || null,
    keepalive: keepalive?.status() || null,
    authority_effect: false,
  };
}

async function handleLocalCommand(command, payload = {}) {
  const action = String(command || '').toUpperCase();
  if (action === 'KEEPALIVE_STATUS' || action === 'FLEET_RUNTIME_STATUS') return c5Status();
  if (action === 'KEEPALIVE_PAUSE') return keepalive.pause();
  if (action === 'KEEPALIVE_OFF') return keepalive.off();
  if (action === 'KEEPALIVE_RESUME') return keepalive.resume();
  if (action === 'KEEPALIVE_BIND') return keepalive.bindSupervisor({
    supervisor_id: payload?.supervisor_id,
    supervisor_epoch: payload?.supervisor_epoch,
    conversation_id: payload?.conversation_id,
    conversation_url: payload?.conversation_url,
  }, { source: 'TRUSTED_LOCAL_CONFIG' });
  if (action === 'FLEET_ASSIGNMENT_CREATE') {
    await syncFleetProvisionerState();
    return fleetRuntime.createAssignment(payload);
  }
  // Readiness/result ingestion deliberately remains behind the typed transport module seam.
  // Workers cannot call this IPC surface and receive no browser authority or peer channel.
  throw new Error('c5_local_command_unknown');
}

async function initC5Runtime() {
  runtimeStore = new FleetRuntimeStore({ statePath: runtimeStatePath() });
  fleetRuntime = new FleetRuntime({ store: runtimeStore });
  await fleetRuntime.init();

  const semantic = semanticConfigFromEnv();
  const transport = new NativeSupervisorKeepaliveTransport({
    resolveBoundView,
    captureSemanticFrame,
    executeSemanticCommand,
    ...semantic,
  });
  keepalive = new SupervisorKeepalive({
    store: runtimeStore,
    runtime: fleetRuntime,
    transport,
    intervalMs: LOOP_MS,
  });
  await keepalive.init();

  const envBinding = localBindingFromEnv();
  if (envBinding) await keepalive.bindSupervisor(envBinding, { source: 'TRUSTED_LOCAL_CONFIG' });
  const requestedEmergencyState = String(process.env.METAENGINE_SUPERVISOR_KEEPALIVE_STATE || '').trim().toUpperCase();
  if (requestedEmergencyState === 'ACTIVE') await keepalive.resume();
  else if (requestedEmergencyState === 'OFF') await keepalive.off();
  else if (requestedEmergencyState === 'PAUSE') await keepalive.pause();

  await syncFleetProvisionerState();
  await refreshSupervisorTargetIncarnation();
  startFleetSyncLoop();
  keepalive.start();

  console.log(JSON.stringify({
    schema: 'metaengine.browser.c5-runtime.bootstrap.v1',
    ok: true,
    keepalive_state: keepalive.status().keepalive_state,
    binding_present: Boolean(keepalive.status().binding),
    transport_configured: keepalive.status().transport_configured,
    browser_authority: false,
    direct_peer_messaging: false,
    authority_effect: false,
  }));
}

ipcMain.handle('metaengine:c5:status', async (event) => {
  assertTrustedLocalSender(event);
  return c5Status();
});
ipcMain.handle('metaengine:c5:command', async (event, message) => {
  assertTrustedLocalSender(event);
  return handleLocalCommand(message?.command, message?.payload || {});
});

app.once('ready', () => {
  if (DISABLED_FOR_SMOKE) return;
  setImmediate(() => initC5Runtime().catch((error) => console.error('c5-runtime-start-failed', error)));
});

app.on('before-quit', () => {
  keepalive?.stop();
  if (fleetSyncTimer) clearInterval(fleetSyncTimer);
  fleetSyncTimer = null;
});

export { handleLocalCommand as handleC5LocalCommand, initC5Runtime, resolveBoundView };
