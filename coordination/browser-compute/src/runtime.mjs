import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ManagedChromeProcess } from './chrome-process.mjs';
import { DEFAULT_CONTEXT_ID } from './context-manager.mjs';
import { SemanticCaptureAdapter } from './semantic-capture-adapter.mjs';
import { atomicJsonWrite, defaultStateRoot, ensurePrivateDir, readJson, validateContextId, validateNavigationUrl, validateProfileId, validateTargetId } from './security.mjs';

const PROFILE_META = 'a2-profile.json';
const CONTEXTS_FILE = 'contexts.json';
const TARGETS_FILE = 'targets.json';
const PROFILE_LOCK_FILE = 'a2-runtime.lock';
const DAEMON_LOCK_FILE = 'a2-daemon.lock';
export const COMPUTE_BROWSER_RUNTIME_VERSION = '0.2.0-dev.2';

function now() { return new Date().toISOString(); }
function blankRegistry() { return { schema: 'metaengine.a2-compute-browser.targets.v1', revision: 0, targets: [], updated_at: now() }; }
function blankContextRegistry() { return { schema: 'metaengine.a2-compute-browser.contexts.v1', revision: 0, contexts: [], updated_at: now() }; }

async function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

async function acquirePidLock(file, kind) {
  try {
    await fs.writeFile(file, `${JSON.stringify({ schema: `metaengine.a2-compute-browser.${kind}-lock.v1`, pid: process.pid, acquired_at: now() })}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    let existing = null;
    try { existing = JSON.parse(await fs.readFile(file, 'utf8')); } catch (_) {}
    if (await pidAlive(Number(existing?.pid))) throw new Error(`${kind}_lock_held`);
    await fs.rm(file, { force: true });
    return acquirePidLock(file, kind);
  }
  return file;
}

async function releaseOwnedPidLock(file) {
  if (!file) return;
  let existing = null;
  try { existing = JSON.parse(await fs.readFile(file, 'utf8')); } catch (_) {}
  if (Number(existing?.pid) === process.pid) await fs.rm(file, { force: true }).catch(() => {});
}

export class ComputeBrowserRuntime {
  constructor({
    stateRoot = defaultStateRoot(),
    engineExecutable = process.env.A2_CHROME_EXECUTABLE || null,
    headlessDefault = false,
    allowNoSandbox = false
  } = {}) {
    this.stateRoot = path.resolve(stateRoot);
    this.engineExecutable = engineExecutable ? path.resolve(String(engineExecutable)) : null;
    this.headlessDefault = headlessDefault === true;
    this.allowNoSandbox = allowNoSandbox === true;
    this.profilesRoot = path.join(this.stateRoot, 'profiles');
    this.running = new Map();
    this.startedAt = now();
    this.daemonLockFile = null;
  }

  async init() {
    await ensurePrivateDir(this.stateRoot);
    await ensurePrivateDir(this.profilesRoot);
    if (!this.daemonLockFile) this.daemonLockFile = await acquirePidLock(path.join(this.stateRoot, DAEMON_LOCK_FILE), 'daemon');
    return this;
  }

  profileDir(profileId) { return path.join(this.profilesRoot, validateProfileId(profileId)); }

  async #profileMeta(profileId) {
    const id = validateProfileId(profileId);
    const dir = this.profileDir(id);
    await ensurePrivateDir(dir);
    const file = path.join(dir, PROFILE_META);
    let meta = await readJson(file, null);
    if (!meta) {
      meta = { schema: 'metaengine.a2-compute-browser.profile.v1', profile_id: id, browser_node_id: crypto.randomUUID(), created_at: now() };
      await atomicJsonWrite(file, meta);
    }
    return meta;
  }

  async #acquireProfileLock(profileId) {
    return acquirePidLock(path.join(this.profileDir(profileId), PROFILE_LOCK_FILE), 'profile_runtime');
  }

  async startProfile({ profileId } = {}) {
    const id = validateProfileId(profileId);
    const existing = this.running.get(id);
    if (existing) {
      const health = await this.profileHealth(id);
      if (health.running) return health;
      await this.stopProfile(id);
    }
    const meta = await this.#profileMeta(id);
    const lockFile = await this.#acquireProfileLock(id);
    const userDataDir = path.join(this.profileDir(id), 'chrome-data');
    if (!this.engineExecutable) {
      await releaseOwnedPidLock(lockFile);
      throw new Error('engine_executable_not_configured');
    }
    const processRef = new ManagedChromeProcess({
      executablePath: this.engineExecutable,
      userDataDir,
      headless: this.headlessDefault,
      allowNoSandbox: this.allowNoSandbox
    });
    try {
      await processRef.start();
      const entry = {
        processRef,
        meta,
        lockFile,
        bindings: new Map(),
        contextBindings: new Map([
          ['default', { browser_context_id: null, process_incarnation_id: processRef.processIncarnationId, bound_at: now() }]
        ]),
        semanticFrames: new Map()
      };
      this.running.set(id, entry);
      await this.#reconcileContextsAfterStart(id, entry);
      return this.profileHealth(id);
    } catch (error) {
      this.running.delete(id);
      await processRef.stop().catch(() => {});
      this.running.delete(id);
      await releaseOwnedPidLock(lockFile);
      throw error;
    }
  }

  async stopProfile(profileId) {
    const id = validateProfileId(profileId);
    const entry = this.running.get(id);
    if (!entry) return { profile_id: id, running: false };
    await entry.processRef.stop().catch(() => {});
    this.running.delete(id);
    await releaseOwnedPidLock(entry.lockFile);
    return { profile_id: id, running: false };
  }

  async profileHealth(profileId) {
    const id = validateProfileId(profileId);
    const entry = this.running.get(id);
    if (!entry) return { profile_id: id, running: false };
    try {
      return { profile_id: id, browser_node_id: entry.meta.browser_node_id, ...(await entry.processRef.health()) };
    } catch (error) {
      return { profile_id: id, browser_node_id: entry.meta.browser_node_id, running: false, error: String(error?.message || error), debug_transport: 'native_pipe_b3' };
    }
  }

  async listProfiles() {
    const dirs = await fs.readdir(this.profilesRoot, { withFileTypes: true }).catch(() => []);
    const out = [];
    for (const dirent of dirs.filter((row) => row.isDirectory())) {
      try {
        const id = validateProfileId(dirent.name);
        const meta = await readJson(path.join(this.profileDir(id), PROFILE_META), null);
        if (meta) {
          const processRef = this.running.get(id)?.processRef;
          out.push({
            profile_id: id,
            browser_node_id: meta.browser_node_id,
            running: processRef?.isRunning() === true,
            lifecycle_state: processRef?.lifecycleState || 'STOPPED',
            process_incarnation_id: processRef?.isRunning() ? processRef.processIncarnationId : null
          });
        }
      } catch (_) {}
    }
    return out.sort((a, b) => a.profile_id.localeCompare(b.profile_id));
  }

  async #loadTargets(profileId) {
    return readJson(path.join(this.profileDir(profileId), TARGETS_FILE), blankRegistry());
  }

  async #saveTargets(profileId, registry) {
    registry.revision = Number(registry.revision || 0) + 1;
    registry.updated_at = now();
    await atomicJsonWrite(path.join(this.profileDir(profileId), TARGETS_FILE), registry);
  }

  async #loadContexts(profileId) {
    return readJson(path.join(this.profileDir(profileId), CONTEXTS_FILE), blankContextRegistry());
  }

  async #saveContexts(profileId, registry) {
    registry.revision = Number(registry.revision || 0) + 1;
    registry.updated_at = now();
    await atomicJsonWrite(path.join(this.profileDir(profileId), CONTEXTS_FILE), registry);
  }

  async #reconcileContextsAfterStart(profileId, entry) {
    const registry = await this.#loadContexts(profileId);
    let changed = false;
    registry.contexts = registry.contexts.map((row) => {
      if (row.status !== 'ACTIVE' || row.last_process_incarnation_id === entry.processRef.processIncarnationId) return row;
      changed = true;
      return {
        ...row,
        status: 'LOST',
        lost_process_incarnation_id: row.last_process_incarnation_id || null,
        last_process_incarnation_id: null,
        updated_at: now()
      };
    });
    if (changed) await this.#saveContexts(profileId, registry);
  }

  #runningEntry(profileId) {
    const id = validateProfileId(profileId);
    const entry = this.running.get(id);
    if (!entry?.processRef?.isRunning() || !entry.processRef.cdp) throw new Error('profile_not_running');
    return { id, entry };
  }

  #liveBinding(entry, targetId) {
    const binding = entry.bindings.get(targetId);
    if (!binding) throw new Error('target_not_bound');
    if (!entry.processRef.isRunning() || binding.process_incarnation_id !== entry.processRef.processIncarnationId) {
      entry.bindings.delete(targetId);
      throw new Error('target_binding_stale');
    }
    return binding;
  }

  #liveContextBinding(entry, contextId) {
    const id = validateContextId(contextId);
    const bindings = entry.contextBindings || new Map();
    let binding = bindings.get(id);
    if (!binding && id === 'default' && entry.processRef.isRunning()) {
      binding = { browser_context_id: null, process_incarnation_id: entry.processRef.processIncarnationId, bound_at: now() };
      if (!entry.contextBindings) entry.contextBindings = bindings;
      bindings.set(id, binding);
    }
    if (!binding) throw new Error('context_not_bound');
    if (!entry.processRef.isRunning() || binding.process_incarnation_id !== entry.processRef.processIncarnationId) {
      bindings.delete(id);
      throw new Error('context_binding_stale');
    }
    return binding;
  }

  async #activeContext(profileId, entry, contextId) {
    const id = validateContextId(contextId || 'default');
    if (id === 'default') return { context_id: id, context_epoch: 1, binding: this.#liveContextBinding(entry, id) };
    const registry = await this.#loadContexts(profileId);
    const context = registry.contexts.find((row) => row.context_id === id);
    if (!context) throw new Error('context_registry_missing');
    if (context.status !== 'ACTIVE') throw new Error('context_recovery_required');
    if (context.last_process_incarnation_id !== entry.processRef.processIncarnationId) throw new Error('context_binding_stale');
    return { ...context, binding: this.#liveContextBinding(entry, id) };
  }

  async createContext({ profileId, contextId = null } = {}) {
    const { id, entry } = this.#runningEntry(profileId);
    const logicalId = contextId ? validateContextId(contextId) : `context_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
    if (logicalId === 'default' || logicalId === DEFAULT_CONTEXT_ID) throw new Error('default_context_reserved');
    const registry = await this.#loadContexts(id);
    const previous = registry.contexts.find((row) => row.context_id === logicalId);
    if (previous && !['LOST', 'RETIRED'].includes(previous.status)) throw new Error('context_id_exists');
    const operationId = crypto.randomUUID();
    const context = {
      schema: 'metaengine.a2-compute-browser.context.v1',
      context_id: logicalId,
      context_epoch: Math.max(1, Number(previous?.context_epoch || 0) + 1),
      persistence: 'EPHEMERAL',
      status: 'PREPARING',
      pending_operation_id: operationId,
      pending_operation: 'CONTEXT_CREATE',
      pending_process_incarnation_id: entry.processRef.processIncarnationId,
      last_process_incarnation_id: null,
      created_at: previous?.created_at || now(),
      updated_at: now()
    };
    registry.contexts = registry.contexts.filter((row) => row.context_id !== logicalId);
    registry.contexts.push(context);
    await this.#saveContexts(id, registry);
    const created = await entry.processRef.cdp.call('Target.createBrowserContext', { disposeOnDetach: true });
    if (!created.browserContextId) throw new Error('cdp_context_create_failed');
    const active = {
      ...context,
      status: 'ACTIVE',
      pending_operation_id: null,
      pending_operation: null,
      pending_process_incarnation_id: null,
      last_operation_id: operationId,
      last_process_incarnation_id: entry.processRef.processIncarnationId,
      updated_at: now()
    };
    registry.contexts = registry.contexts.filter((row) => row.context_id !== logicalId);
    registry.contexts.push(active);
    await this.#saveContexts(id, registry);
    if (!entry.contextBindings) entry.contextBindings = new Map();
    entry.contextBindings.set(logicalId, {
      browser_context_id: created.browserContextId,
      process_incarnation_id: entry.processRef.processIncarnationId,
      bound_at: now(),
      context_epoch: active.context_epoch
    });
    return { ...active, bound: true, process_incarnation_id: entry.processRef.processIncarnationId };
  }

  async listContexts(profileId, { includeRetired = false } = {}) {
    const id = validateProfileId(profileId);
    const registry = await this.#loadContexts(id);
    const entry = this.running.get(id);
    const bindings = entry?.contextBindings || new Map();
    const incarnation = entry?.processRef?.isRunning() ? entry.processRef.processIncarnationId : null;
    let changed = false;
    registry.contexts = registry.contexts.map((row) => {
      if (row.status !== 'ACTIVE' || (incarnation && row.last_process_incarnation_id === incarnation)) return row;
      changed = true;
      return {
        ...row,
        status: 'LOST',
        lost_process_incarnation_id: row.last_process_incarnation_id || null,
        last_process_incarnation_id: null,
        updated_at: now()
      };
    });
    if (changed) await this.#saveContexts(id, registry);
    const defaultContext = {
      schema: 'metaengine.a2-compute-browser.context.v1',
      context_id: 'default',
      context_epoch: 1,
      persistence: 'PROFILE_DEFAULT',
      status: incarnation ? 'ACTIVE' : 'STOPPED',
      bound: Boolean(incarnation),
      process_incarnation_id: incarnation
    };
    const contexts = registry.contexts
      .filter((row) => includeRetired || row.status !== 'RETIRED')
      .map((row) => {
        const binding = bindings.get(row.context_id);
        const bound = Boolean(binding && incarnation && binding.process_incarnation_id === incarnation && row.status === 'ACTIVE');
        return { ...row, bound, process_incarnation_id: bound ? incarnation : null };
      })
      .sort((a, b) => a.context_id.localeCompare(b.context_id));
    return [defaultContext, ...contexts];
  }

  async closeContext({ profileId, contextId } = {}) {
    const logicalId = validateContextId(contextId);
    if (logicalId === 'default') throw new Error('default_context_not_disposable');
    if (logicalId === DEFAULT_CONTEXT_ID) throw new Error('default_context_close_forbidden');
    const { id, entry } = this.#runningEntry(profileId);
    const registry = await this.#loadContexts(id);
    const index = registry.contexts.findIndex((row) => row.context_id === logicalId);
    if (index < 0) throw new Error('context_registry_missing');
    if (registry.contexts[index].status !== 'ACTIVE') throw new Error('context_recovery_required');
    const binding = this.#liveContextBinding(entry, logicalId);
    const targets = await this.#loadTargets(id);
    if (targets.targets.some((row) => (row.context_id || 'default') === logicalId && row.status !== 'RETIRED')) {
      throw new Error('context_has_live_targets');
    }
    for (const target of targets.targets) {
      if ((target.context_id || 'default') === logicalId) entry.semanticFrames.delete(target.target_id);
    }
    const operationId = crypto.randomUUID();
    registry.contexts[index] = {
      ...registry.contexts[index],
      status: 'CLOSING',
      pending_operation_id: operationId,
      pending_operation: 'CONTEXT_CLOSE',
      pending_process_incarnation_id: entry.processRef.processIncarnationId,
      updated_at: now()
    };
    await this.#saveContexts(id, registry);
    await entry.processRef.cdp.call('Target.disposeBrowserContext', { browserContextId: binding.browser_context_id });
    entry.contextBindings.delete(logicalId);
    registry.contexts[index] = {
      ...registry.contexts[index],
      status: 'RETIRED',
      pending_operation_id: null,
      pending_operation: null,
      pending_process_incarnation_id: null,
      last_operation_id: operationId,
      last_process_incarnation_id: null,
      updated_at: now()
    };
    await this.#saveContexts(id, registry);
    return { context_id: logicalId, closed: true, operation_id: operationId, process_incarnation_id: entry.processRef.processIncarnationId };
  }

  async createTarget({ profileId, targetId = null, contextId = 'default', role = 'WORKER', url = 'about:blank' } = {}) {
    const { id, entry } = this.#runningEntry(profileId);
    const context = await this.#activeContext(id, entry, contextId);
    const registry = await this.#loadTargets(id);
    const logicalId = targetId ? validateTargetId(targetId) : `browser_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
    if (registry.targets.some((row) => row.target_id === logicalId && row.status !== 'RETIRED')) throw new Error('target_id_exists');
    const navUrl = validateNavigationUrl(url);
    if (navUrl !== 'about:blank') throw new Error('b1_remote_navigation_not_enabled');
    const previous = registry.targets.find((row) => row.target_id === logicalId);
    const operationId = crypto.randomUUID();
    const target = {
      schema: 'metaengine.a2-browser-operator.target.v1',
      target_id: logicalId,
      provider: 'BROWSER',
      platform: 'COMPUTE_BROWSER',
      surface: 'WEB',
      context_id: context.context_id,
      role: String(role || 'WORKER').toUpperCase().replace(/[^A-Z0-9_:-]+/g, '_').slice(0, 64),
      conversation_epoch: Math.max(1, Number(previous?.conversation_epoch || 0) + 1),
      conversation_url: navUrl,
      status: 'PREPARING',
      pending_operation_id: operationId,
      pending_operation: 'TARGET_CREATE',
      pending_process_incarnation_id: entry.processRef.processIncarnationId,
      created_at: previous?.created_at || now(),
      updated_at: now()
    };
    registry.targets = registry.targets.filter((row) => row.target_id !== logicalId);
    registry.targets.push(target);
    await this.#saveTargets(id, registry);
    const createParams = { url: navUrl };
    if (context.context_id !== 'default') createParams.browserContextId = context.binding.browser_context_id;
    const created = await entry.processRef.cdp.call('Target.createTarget', createParams);
    if (!created.targetId) throw new Error('cdp_target_create_failed');
    const activeTarget = {
      ...target,
      status: 'ACTIVE',
      pending_operation_id: null,
      pending_operation: null,
      pending_process_incarnation_id: null,
      last_operation_id: operationId,
      updated_at: now()
    };
    registry.targets = registry.targets.filter((row) => row.target_id !== logicalId);
    registry.targets.push(activeTarget);
    await this.#saveTargets(id, registry);
    entry.bindings.set(logicalId, {
      cdp_target_id: created.targetId,
      context_id: context.context_id,
      process_incarnation_id: entry.processRef.processIncarnationId,
      bound_at: now(),
      conversation_epoch: activeTarget.conversation_epoch
    });
    entry.semanticFrames.delete(logicalId);
    return { ...activeTarget, bound: true, process_incarnation_id: entry.processRef.processIncarnationId };
  }

  async listTargets(profileId, { includeRetired = false } = {}) {
    const id = validateProfileId(profileId);
    const registry = await this.#loadTargets(id);
    const entry = this.running.get(id);
    const bindings = entry?.bindings || new Map();
    const incarnation = entry?.processRef?.isRunning() ? entry.processRef.processIncarnationId : null;
    return registry.targets.filter((row) => includeRetired || row.status !== 'RETIRED').map((row) => {
      const binding = bindings.get(row.target_id);
      const bound = Boolean(binding && incarnation && binding.process_incarnation_id === incarnation);
      return { ...row, context_id: row.context_id || 'default', bound, process_incarnation_id: bound ? incarnation : null };
    });
  }

  async semanticSnapshot({ profileId, targetId, maxNodes = 60, taskText = '' } = {}) {
    const { id: profile, entry } = this.#runningEntry(profileId);
    const id = validateTargetId(targetId);
    const registry = await this.#loadTargets(profile);
    const target = registry.targets.find((row) => row.target_id === id && row.status === 'ACTIVE');
    if (!target) throw new Error('semantic_target_not_active');
    const binding = entry.bindings.get(id);
    if (!binding) throw new Error('semantic_target_not_bound');
    const adapter = new SemanticCaptureAdapter({ cdp: entry.processRef.cdp });
    const previousFrame = entry.semanticFrames.get(id) || null;
    const frame = await adapter.capture({ target, binding, previousFrame, maxNodes, taskText: String(taskText || '').slice(0, 4000) });
    entry.semanticFrames.set(id, frame);
    return frame;
  }

  async activateTarget({ profileId, targetId } = {}) {
    const { id: profile, entry } = this.#runningEntry(profileId);
    const id = validateTargetId(targetId);
    const binding = this.#liveBinding(entry, id);
    const registry = await this.#loadTargets(profile);
    const index = registry.targets.findIndex((row) => row.target_id === id);
    if (index < 0) throw new Error('target_registry_missing');
    if (registry.targets[index].status !== 'ACTIVE') throw new Error('target_recovery_required');
    const operationId = crypto.randomUUID();
    registry.targets[index] = {
      ...registry.targets[index],
      status: 'ACTIVATING',
      pending_operation_id: operationId,
      pending_operation: 'TARGET_ACTIVATE',
      pending_process_incarnation_id: entry.processRef.processIncarnationId,
      updated_at: now()
    };
    await this.#saveTargets(profile, registry);
    await entry.processRef.cdp.call('Target.activateTarget', { targetId: binding.cdp_target_id });
    registry.targets[index] = {
      ...registry.targets[index],
      status: 'ACTIVE',
      pending_operation_id: null,
      pending_operation: null,
      pending_process_incarnation_id: null,
      last_operation_id: operationId,
      updated_at: now()
    };
    await this.#saveTargets(profile, registry);
    return { target_id: id, activated: true, operation_id: operationId, process_incarnation_id: entry.processRef.processIncarnationId };
  }

  async closeTarget({ profileId, targetId } = {}) {
    const { id: profile, entry } = this.#runningEntry(profileId);
    const id = validateTargetId(targetId);
    const binding = this.#liveBinding(entry, id);
    const registry = await this.#loadTargets(profile);
    const index = registry.targets.findIndex((row) => row.target_id === id);
    if (index < 0) throw new Error('target_registry_missing');
    if (registry.targets[index].status !== 'ACTIVE') throw new Error('target_recovery_required');
    const operationId = crypto.randomUUID();
    registry.targets[index] = {
      ...registry.targets[index],
      status: 'CLOSING',
      pending_operation_id: operationId,
      pending_operation: 'TARGET_CLOSE',
      pending_process_incarnation_id: entry.processRef.processIncarnationId,
      updated_at: now()
    };
    await this.#saveTargets(profile, registry);
    await entry.processRef.cdp.call('Target.closeTarget', { targetId: binding.cdp_target_id });
    entry.bindings.delete(id);
    entry.semanticFrames.delete(id);
    registry.targets[index] = {
      ...registry.targets[index],
      status: 'RETIRED',
      pending_operation_id: null,
      pending_operation: null,
      pending_process_incarnation_id: null,
      last_operation_id: operationId,
      updated_at: now()
    };
    await this.#saveTargets(profile, registry);
    return { target_id: id, closed: true, operation_id: operationId, process_incarnation_id: entry.processRef.processIncarnationId };
  }

  async health() {
    const profiles = [];
    for (const id of this.running.keys()) profiles.push(await this.profileHealth(id));
    return {
      schema: 'metaengine.a2-compute-browser.health.v1',
      runtime: COMPUTE_BROWSER_RUNTIME_VERSION,
      started_at: this.startedAt,
      web_authority_effect: false,
      local_effects_present: true,
      raw_cdp_rpc_exposed: false,
      debug_transport: 'native_pipe_b3',
      devtools_tcp_listener: false,
      devtools_tcp_exposed: false,
      context_manager: 'b2_logical_context_v1',
      semantic_perception: 'r4_semantic_frame_v1',
      semantic_page_script_evaluation: false,
      profiles
    };
  }

  async shutdown() {
    for (const id of [...this.running.keys()]) await this.stopProfile(id).catch(() => {});
    await releaseOwnedPidLock(this.daemonLockFile);
    this.daemonLockFile = null;
  }
}
