import crypto from 'node:crypto';
import path from 'node:path';
import { atomicJsonWrite, readJson, validateContextId } from './security.mjs';

const CONTEXTS_FILE = 'contexts.json';
export const DEFAULT_CONTEXT_ID = 'context_default';
export const CONTEXT_KIND = Object.freeze({ PERSISTENT_DEFAULT: 'PERSISTENT_DEFAULT', EPHEMERAL_ISOLATED: 'EPHEMERAL_ISOLATED' });

function now() { return new Date().toISOString(); }
function freshRegistry() {
  const timestamp = now();
  return {
    schema: 'metaengine.a2-compute-browser.contexts.v1', revision: 0, updated_at: timestamp,
    contexts: [{ context_id: DEFAULT_CONTEXT_ID, context_kind: CONTEXT_KIND.PERSISTENT_DEFAULT, context_epoch: 1, status: 'ACTIVE', created_at: timestamp, updated_at: timestamp }]
  };
}

async function loadOrCreate(profileDir) {
  const file = path.join(profileDir, CONTEXTS_FILE);
  const existing = await readJson(file, null);
  if (existing) return existing;
  const created = freshRegistry();
  await atomicJsonWrite(file, created);
  return created;
}

async function save(profileDir, registry) {
  registry.revision = Number(registry.revision || 0) + 1;
  registry.updated_at = now();
  await atomicJsonWrite(path.join(profileDir, CONTEXTS_FILE), registry);
}

export class ProfileContextManager {
  constructor({ profileDir, cdp, bindings }) {
    this.profileDir = profileDir;
    this.cdp = cdp;
    this.bindings = bindings;
  }

  async ensure() { await loadOrCreate(this.profileDir); return this; }

  async list({ includeRetired = false } = {}) {
    const registry = await loadOrCreate(this.profileDir);
    return registry.contexts
      .filter((row) => includeRetired || row.status !== 'RETIRED')
      .map((row) => ({ ...row, bound: row.context_id === DEFAULT_CONTEXT_ID || this.bindings.has(row.context_id) }));
  }

  async create({ contextId = null, kind = CONTEXT_KIND.EPHEMERAL_ISOLATED } = {}) {
    if (kind !== CONTEXT_KIND.EPHEMERAL_ISOLATED) throw new Error('context_kind_creation_forbidden');
    const logicalId = contextId ? validateContextId(contextId) : `context_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
    if (logicalId === DEFAULT_CONTEXT_ID) throw new Error('default_context_reserved');
    const registry = await loadOrCreate(this.profileDir);
    const previous = registry.contexts.find((row) => row.context_id === logicalId);
    if (previous?.status === 'ACTIVE' && this.bindings.has(logicalId)) throw new Error('context_id_exists');
    if (previous?.status === 'CLOSING' || previous?.status === 'CLOSE_AMBIGUOUS') throw new Error('context_reconciliation_required');

    const physical = await this.cdp.call('Target.createBrowserContext', { disposeOnDetach: true });
    if (!physical.browserContextId) throw new Error('cdp_context_create_failed');
    const timestamp = now();
    const record = {
      context_id: logicalId,
      context_kind: CONTEXT_KIND.EPHEMERAL_ISOLATED,
      context_epoch: Math.max(1, Number(previous?.context_epoch || 0) + 1),
      status: 'ACTIVE',
      created_at: previous?.created_at || timestamp,
      updated_at: timestamp
    };
    registry.contexts = registry.contexts.filter((row) => row.context_id !== logicalId);
    registry.contexts.push(record);
    try {
      await save(this.profileDir, registry);
    } catch (persistError) {
      try { await this.cdp.call('Target.disposeBrowserContext', { browserContextId: physical.browserContextId }); }
      catch (_) { throw new Error('context_create_persist_failed_cleanup_ambiguous'); }
      throw persistError;
    }
    this.bindings.set(logicalId, { cdp_browser_context_id: physical.browserContextId, bound_at: timestamp, context_epoch: record.context_epoch });
    return { ...record, bound: true };
  }

  resolvePhysical(contextId = DEFAULT_CONTEXT_ID) {
    const id = validateContextId(contextId);
    if (id === DEFAULT_CONTEXT_ID) return null;
    const binding = this.bindings.get(id);
    if (!binding) throw new Error('context_not_bound');
    return binding.cdp_browser_context_id;
  }

  async close(contextId) {
    const id = validateContextId(contextId);
    if (id === DEFAULT_CONTEXT_ID) throw new Error('default_context_close_forbidden');
    const registry = await loadOrCreate(this.profileDir);
    const index = registry.contexts.findIndex((row) => row.context_id === id && row.status !== 'RETIRED');
    if (index < 0) throw new Error('context_not_found');
    if (registry.contexts[index].status === 'CLOSING' || registry.contexts[index].status === 'CLOSE_AMBIGUOUS') throw new Error('context_close_reconciliation_required');

    const binding = this.bindings.get(id);
    registry.contexts[index] = { ...registry.contexts[index], status: 'CLOSING', updated_at: now() };
    await save(this.profileDir, registry);

    if (!binding) {
      registry.contexts[index] = { ...registry.contexts[index], status: 'RETIRED', updated_at: now() };
      await save(this.profileDir, registry);
      return { context_id: id, closed: true, physical_disposed: false };
    }

    try {
      await this.cdp.call('Target.disposeBrowserContext', { browserContextId: binding.cdp_browser_context_id });
    } catch (_) {
      registry.contexts[index] = { ...registry.contexts[index], status: 'CLOSE_AMBIGUOUS', updated_at: now() };
      await save(this.profileDir, registry).catch(() => {});
      throw new Error('context_close_ambiguous_no_retry');
    }

    this.bindings.delete(id);
    registry.contexts[index] = { ...registry.contexts[index], status: 'RETIRED', updated_at: now() };
    await save(this.profileDir, registry);
    return { context_id: id, closed: true, physical_disposed: true };
  }
}
