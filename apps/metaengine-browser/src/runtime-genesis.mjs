import fs from 'node:fs/promises';
import path from 'node:path';
import { persistNativeSupervisorControlState } from './native-supervisor-control-state.mjs';

export const RUNTIME_GENESIS_SCHEMA = 'metaengine.browser.runtime-genesis.v1';
export const RUNTIME_GENESIS_GENERATION = 'DEVOS_CLEAN_GENESIS_V1';
export const RUNTIME_GENESIS_MARKER = 'metaengine-runtime-generation-v1.json';

export const RUNTIME_GENESIS_RESET_FILES = Object.freeze([
  'metaengine-fleet-state-v2.json',
  'metaengine-devos-session-layout-registry-v1.json',
  'metaengine-owner-safety-gates-v1.json',
  'metaengine-self-update-session-continuity-v1.json',
  'metaengine-native-supervisor-control-state-v1.json',
]);

export const RUNTIME_GENESIS_PRESERVED = Object.freeze([
  'metaengine-native-supervisor-device-v1.json',
  'chromium-persistent-user-session',
  'downloads',
  'remote-brain-memory-ledgers',
]);

function markerPath(userDataPath) {
  return path.join(String(userDataPath), RUNTIME_GENESIS_MARKER);
}

function safeStamp(value = new Date().toISOString()) {
  return String(value).replace(/[^0-9A-Za-z.-]/g, '-').slice(0, 96);
}

async function readMarker(userDataPath) {
  try {
    const row = JSON.parse(await fs.readFile(markerPath(userDataPath), 'utf8'));
    return row?.schema === RUNTIME_GENESIS_SCHEMA ? row : null;
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function quarantineOne(userDataPath, quarantineRoot, relative) {
  const source = path.join(userDataPath, relative);
  const target = path.join(quarantineRoot, relative);
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(source, target);
    return relative;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function ensureRuntimeGenesis({
  userDataPath,
  generation = RUNTIME_GENESIS_GENERATION,
  now = new Date().toISOString(),
} = {}) {
  const root = String(userDataPath || '').trim();
  if (!root) throw new Error('runtime_genesis_user_data_required');
  const desiredGeneration = String(generation || '').trim();
  if (!desiredGeneration || desiredGeneration.length > 96) throw new Error('runtime_genesis_generation_invalid');

  const current = await readMarker(root);
  if (current?.generation === desiredGeneration) {
    return Object.freeze({
      schema: RUNTIME_GENESIS_SCHEMA,
      generation: desiredGeneration,
      applied: false,
      reason: 'ALREADY_APPLIED',
      quarantined_files: [],
      control_state: current.control_state || null,
      preserved: [...RUNTIME_GENESIS_PRESERVED],
      authority_effect: false,
    });
  }

  const quarantineRoot = path.join(root, 'metaengine-runtime-quarantine', `${safeStamp(now)}-${safeStamp(desiredGeneration)}`);
  const quarantined = [];
  for (const relative of RUNTIME_GENESIS_RESET_FILES) {
    const moved = await quarantineOne(root, quarantineRoot, relative);
    if (moved) quarantined.push(moved);
  }

  const controlPath = path.join(root, 'metaengine-native-supervisor-control-state-v1.json');
  const controlState = await persistNativeSupervisorControlState(controlPath, {
    supervisor_mode: 'OFF',
    armed: false,
  });

  const marker = Object.freeze({
    schema: RUNTIME_GENESIS_SCHEMA,
    generation: desiredGeneration,
    applied_at: String(now),
    clean_start: true,
    initial_tabs: 0,
    initial_fleet_agents: 0,
    supervisor_mode: 'OFF',
    armed: false,
    quarantined_files: quarantined,
    reset_files: [...RUNTIME_GENESIS_RESET_FILES],
    preserved: [...RUNTIME_GENESIS_PRESERVED],
    preserves_browser_auth_session: true,
    preserves_supervisor_device_identity: true,
    preserves_remote_brain_memory_ledgers: true,
    stale_tab_topology_restored: false,
    stale_fleet_intent_restored: false,
    automatic_actuation_after_genesis: false,
    control_state: controlState,
    authority_effect: false,
  });

  const target = markerPath(root);
  const temp = `${target}.tmp`;
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(temp, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, target);

  return Object.freeze({
    ...marker,
    applied: true,
    reason: 'GENERATION_RESET_APPLIED',
  });
}
