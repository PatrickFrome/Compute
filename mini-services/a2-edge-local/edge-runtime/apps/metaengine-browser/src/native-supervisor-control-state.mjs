import fs from 'node:fs/promises';
import path from 'node:path';

export const NATIVE_SUPERVISOR_CONTROL_STATE_SCHEMA = 'metaengine.native-supervisor.control-state.v1';
const MODES = new Set(['OFF', 'MONITOR', 'CONTROL']);

function row(extra = {}) {
  return Object.freeze({
    schema: NATIVE_SUPERVISOR_CONTROL_STATE_SCHEMA,
    supervisor_mode: 'CONTROL',
    armed: true,
    updated_at: typeof extra.updated_at === 'string' ? extra.updated_at : null,
    recovered_fail_closed: extra.recovered_fail_closed === true,
    recovery_reason: extra.recovery_reason ? String(extra.recovery_reason).slice(0, 160) : null,
    migrated_always_on: extra.migrated_always_on === true,
    migration_reason: extra.migration_reason ? String(extra.migration_reason).slice(0, 160) : null,
    authority_effect: false,
  });
}

function migrationReason(mode, armed) {
  if (mode === 'CONTROL' && armed === true) return null;
  return `ALWAYS_ON_CONTROL:${mode}:${armed === true ? 'ARMED' : 'DISARMED'}`;
}

export function normalizeNativeSupervisorControlState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.schema !== NATIVE_SUPERVISOR_CONTROL_STATE_SCHEMA) return null;
  const mode = String(value.supervisor_mode || '').toUpperCase();
  if (!MODES.has(mode) || typeof value.armed !== 'boolean') return null;
  const reason = migrationReason(mode, value.armed);
  return row({
    updated_at: value.updated_at,
    migrated_always_on: Boolean(reason),
    migration_reason: reason,
  });
}

export function failClosedNativeSupervisorControlState(reason = 'CONTROL_STATE_INVALID') {
  return row({
    updated_at: new Date().toISOString(),
    recovered_fail_closed: true,
    recovery_reason: reason,
  });
}

export function deriveStartupNativeSupervisorControlState(value) {
  if (!value) return null;
  return row({
    updated_at: value.updated_at,
    recovered_fail_closed: value.recovered_fail_closed === true,
    recovery_reason: value.recovery_reason,
    migrated_always_on: value.migrated_always_on === true,
    migration_reason: value.migration_reason,
  });
}

async function writeCanonicalControlState(filePath, value) {
  const target = String(filePath);
  const temp = `${target}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, target);
  return value;
}

export async function loadNativeSupervisorControlState(filePath) {
  if (!filePath) return null;
  try {
    const parsed = JSON.parse(await fs.readFile(String(filePath), 'utf8'));
    const normalized = normalizeNativeSupervisorControlState(parsed)
      || failClosedNativeSupervisorControlState('CONTROL_STATE_SCHEMA_INVALID');
    const startup = deriveStartupNativeSupervisorControlState(normalized);
    const canonicalDrift = parsed?.supervisor_mode !== 'CONTROL'
      || parsed?.armed !== true
      || normalized.recovered_fail_closed === true;
    if (canonicalDrift) await writeCanonicalControlState(filePath, startup);
    return startup;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      const recovered = failClosedNativeSupervisorControlState('CONTROL_STATE_JSON_INVALID');
      await writeCanonicalControlState(filePath, recovered);
      return recovered;
    }
    const recovered = failClosedNativeSupervisorControlState(`CONTROL_STATE_READ_FAILED:${String(error?.code || error?.message || 'UNKNOWN').slice(0, 96)}`);
    try { await writeCanonicalControlState(filePath, recovered); } catch {}
    return recovered;
  }
}

export async function persistNativeSupervisorControlState(filePath, value) {
  if (!filePath) return null;
  const mode = String(value?.supervisor_mode || '').toUpperCase();
  if (mode !== 'CONTROL' || value?.armed !== true) {
    const error = new Error('native_supervisor_always_on_control_required');
    error.code = 'NATIVE_SUPERVISOR_ALWAYS_ON_CONTROL_REQUIRED';
    throw error;
  }
  const next = row({ updated_at: new Date().toISOString() });
  return writeCanonicalControlState(filePath, next);
}
