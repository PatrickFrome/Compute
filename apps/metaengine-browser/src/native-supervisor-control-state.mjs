import fs from 'node:fs/promises';
import path from 'node:path';

export const NATIVE_SUPERVISOR_CONTROL_STATE_SCHEMA = 'metaengine.native-supervisor.control-state.v1';
const MODES = new Set(['OFF', 'MONITOR', 'CONTROL']);

function row(mode, armed, extra = {}) {
  const supervisorMode = MODES.has(String(mode || '').toUpperCase()) ? String(mode).toUpperCase() : 'OFF';
  return Object.freeze({
    schema: NATIVE_SUPERVISOR_CONTROL_STATE_SCHEMA,
    supervisor_mode: supervisorMode,
    armed: supervisorMode === 'OFF' ? false : armed === true,
    updated_at: typeof extra.updated_at === 'string' ? extra.updated_at : null,
    recovered_fail_closed: extra.recovered_fail_closed === true,
    recovery_reason: extra.recovery_reason ? String(extra.recovery_reason).slice(0, 160) : null,
    authority_effect: false,
  });
}

export function normalizeNativeSupervisorControlState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.schema !== NATIVE_SUPERVISOR_CONTROL_STATE_SCHEMA) return null;
  const mode = String(value.supervisor_mode || '').toUpperCase();
  if (!MODES.has(mode) || typeof value.armed !== 'boolean') return null;
  return row(mode, value.armed, { updated_at: value.updated_at });
}

export function failClosedNativeSupervisorControlState(reason = 'CONTROL_STATE_INVALID') {
  return row('OFF', false, {
    updated_at: new Date().toISOString(),
    recovered_fail_closed: true,
    recovery_reason: reason,
  });
}

export function deriveStartupNativeSupervisorControlState(value) {
  if (!value) return null;
  if (value.supervisor_mode === 'CONTROL' || value.armed === true) {
    return failClosedNativeSupervisorControlState('PROCESS_BOUNDARY_REQUIRES_FRESH_AUTHORITY');
  }
  return value;
}

export async function loadNativeSupervisorControlState(filePath) {
  if (!filePath) return null;
  try {
    const parsed = JSON.parse(await fs.readFile(String(filePath), 'utf8'));
    const normalized = normalizeNativeSupervisorControlState(parsed)
      || failClosedNativeSupervisorControlState('CONTROL_STATE_SCHEMA_INVALID');
    return deriveStartupNativeSupervisorControlState(normalized);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) return failClosedNativeSupervisorControlState('CONTROL_STATE_JSON_INVALID');
    return failClosedNativeSupervisorControlState(`CONTROL_STATE_READ_FAILED:${String(error?.code || error?.message || 'UNKNOWN').slice(0, 96)}`);
  }
}

export async function persistNativeSupervisorControlState(filePath, value) {
  if (!filePath) return null;
  const mode = String(value?.supervisor_mode || '').toUpperCase();
  if (!MODES.has(mode) || typeof value?.armed !== 'boolean') throw new Error('native_supervisor_control_state_invalid');
  const next = row(mode, value.armed, { updated_at: new Date().toISOString() });
  const target = String(filePath);
  const temp = `${target}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, target);
  return next;
}
