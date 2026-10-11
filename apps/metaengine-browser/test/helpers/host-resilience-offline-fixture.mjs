// Unit tests must never implicitly attach to the user's configured Owner.
// HostResilienceRuntime imports the provider bootstrap at module evaluation;
// its default import is not a pure operation on a configured Windows machine.
// Scope the implicit initial read to a guaranteed absent, disposable path.
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const keys = ['APPDATA', 'LOCALAPPDATA', 'METAENGINE_STATE_PROVIDER',
  'METAENGINE_SUPERVISOR_BASE_URL', 'METAENGINE_LOCAL_STATE_INSTANCE_ID',
  'METAENGINE_LOCAL_PROVIDER_BOOT_STATE', 'METAENGINE_LOCAL_PROVIDER_BOOT_REASON'];
const old = new Map(keys.map(key => [key, Object.hasOwn(process.env, key) ? process.env[key] : null]));
const isolationRoot = path.join(os.tmpdir(), 'metaengine-resilience-unit-no-owner-' + process.pid + '-' + randomUUID());
let resilience;
try {
  process.env.APPDATA = path.join(isolationRoot, 'roaming');
  process.env.LOCALAPPDATA = path.join(isolationRoot, 'local');
  for (const key of keys.slice(2)) delete process.env[key];
  resilience = await import('../../src/host-resilience-runtime.mjs');
  const bootstrap = await import('../../src/local-state-provider-bootstrap.mjs');
  if (bootstrap.persistentLocalProviderBootstrap.state !== 'NO_OWNER_CONFIG'
    || bootstrap.persistentLocalProviderBootstrap.persistent !== false) {
    throw Error('resilience_unit_provider_bootstrap_not_offline');
  }
} finally {
  for (const [key, value] of old) {
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
}

export const HostResilienceRuntime = resilience.HostResilienceRuntime;
export const resolveSentinelWorkerScript = resilience.resolveSentinelWorkerScript;
export const buildSentinelWorkerFailureEvidence = resilience.buildSentinelWorkerFailureEvidence;
