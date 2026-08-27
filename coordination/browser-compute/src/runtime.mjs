import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ManagedChromeProcess } from './chrome-process.mjs';
import { CONTEXT_KIND, DEFAULT_CONTEXT_ID, ProfileContextManager } from './context-manager.mjs';
import { atomicJsonWrite, defaultStateRoot, ensurePrivateDir, readJson, validateContextId, validateNavigationUrl, validateProfileId, validateTargetId } from './security.mjs';

const PROFILE_META = 'a2-profile.json';
const TARGETS_FILE = 'targets.json';
const PROFILE_LOCK_FILE = 'a2-runtime.lock';
const DAEMON_LOCK_FILE = 'a2-daemon.lock';

function now() { return new Date().toISOString(); }
function blankRegistry() { return { schema: 'metaengine.a2-compute-browser.targets.v1', revision: 0, targets: [], updated_at: now() }; }

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
  constructor({ stateRoot = defaultStateRoot(), engineExecutable = process.env.A2_CHROME_EXECUTABLE || null, headlessDefault = false, allowNoSandbox = false } = {}) {
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

  async #acquireProfileLock(profileId) { return acquirePidLock(path.join(this.profileDir(profileId), PROFILE_LOCK_FILE), 'profile_runtime'); }

  #runningEntry(profileId) {
    const id = validateProfileId(profileId);
    const entry = this.running.get(id);
    if (!entry?.processRef?.cdp) throw new Error('profile_not_running');
    return { id, entry };
  }

  #contextManager(profileId) {
    const { id, entry } = this.#runningEntry(profileId);
    return { id, entry, manager: new ProfileContextManager({ profileDir: this.profileDir(id), cdp: entry.processRef.cdp, bindings: entry.contextBindings }) };
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
    const processRef = new ManagedChromeProcess({ executablePath: this.engineExecutable, userDataDir, headless: this.headlessDefault, allowNoSandbox: this.allowNoSandbox });
    try {
      await processRef.start();
      const entry = { processRef, meta, lockFile, bindings: new Map(), contextBindings: new Map() };
      this.running.set(id, entry);
      await new ProfileContextManager({ profileDir: this.profileDir(id), cdp: processRef.cdp, bindings: entry.contextBindings }).ensure();
      return this.profileHealth(id);
    } catch (error) {
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
    try { return { profile_id: id, browser_node_id: entry.meta.browser_node_id, ...(await entry.processRef.health()) }; }
    catch (error) { return { profile_id: id, browser_node_id: entry.meta.browser_node_id, running: false, error: String(error?.message || error), debug_transport: 'native_pipe' }; }
  }

  async listProfiles() {
    const dirs = await fs.readdir(this.profilesRoot, { withFileTypes: true }).catch(() => []);
    const out = [];
    for (const dirent of dirs.filter((row) => row.isDirectory())) {
      try {
        const id = validateProfileId(dirent.name);
        const meta = await readJson(path.join(this.profileDir(id), PROFILE_META), null);
        if (meta) out.push({ profile_id: id, browser_node_id: meta.browser_node_id, running: this.running.has(id) });
      } catch (_) {}
    }
    return out.sort((a, b) => a.profile_id.localeCompare(b.profile_id));
  }

  async createContext({ profileId, contextId = null, kind = CONTEXT_KIND.EPHEMERAL_ISOLATED } = {}) {
    const { manager } = this.#contextManager(profileId);
    return manager.create({ contextId, kind });
  }

  async listContexts(profileId, { includeRetired = false } = {}) {
    const { manager } = this.#contextManager(profileId);
    return manager.list({ includeRetired });
  }

  async closeContext({ profileId, contextId } = {}) {
    const { id, entry, manager } = this.#contextManager(profileId);
    const logicalId = validateContextId(contextId);
    const result = await manager.close(logicalId);
    const registry = await this.#loadTargets(id);
    let changed = false;
    registry.targets = registry.targets.map((target) => {
      if (target.context_id !== logicalId || target.status === 'RETIRED') return target;
      changed = true;
      entry.bindings.delete(target.target_id);
      return { ...target, status: 'RETIRED', updated_at: now() };
    });
    if (changed) await this.#saveTargets(id, registry);
    return result;
  }

  async #loadTargets(profileId) { return readJson(path.join(this.profileDir(profileId), TARGETS_FILE), blankRegistry()); }
  async #saveTargets(profileId, registry) {
    registry.revision = Number(registry.revision || 0) + 1;
    registry.updated_at = now();
    await atomicJsonWrite(path.join(this.profileDir(profileId), TARGETS_FILE), registry);
  }

  async createTarget({ profileId, targetId = null, contextId = DEFAULT_CONTEXT_ID, role = 'WORKER', url = 'about:blank' } = {}) {
    const { id, entry, manager } = this.#contextManager(profileId);
    const registry = await this.#loadTargets(id);
    const logicalId = targetId ? validateTargetId(targetId) : `browser_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
    const logicalContextId = validateContextId(contextId || DEFAULT_CONTEXT_ID);
    if (registry.targets.some((row) => row.target_id === logicalId && row.status !== 'RETIRED')) throw new Error('target_id_exists');
    const navUrl = validateNavigationUrl(url);
    if (navUrl !== 'about:blank') throw new Error('b1_remote_navigation_not_enabled');
    const browserContextId = manager.resolvePhysical(logicalContextId);
    const createParams = { url: navUrl };
    if (browserContextId) createParams.browserContextId = browserContextId;
    const created = await entry.processRef.cdp.call('Target.createTarget', createParams);
    if (!created.targetId) throw new Error('cdp_target_create_failed');
    const previous = registry.targets.find((row) => row.target_id === logicalId);
    const target = {
      schema: 'metaengine.a2-browser-operator.target.v1', target_id: logicalId, context_id: logicalContextId,
      provider: 'BROWSER', platform: 'COMPUTE_BROWSER', surface: 'WEB',
      role: String(role || 'WORKER').toUpperCase().replace(/[^A-Z0-9_:-]+/g, '_').slice(0, 64),
      conversation_epoch: Math.max(1, Number(previous?.conversation_epoch || 0) + 1), conversation_url: navUrl, status: 'ACTIVE',
      created_at: previous?.created_at || now(), updated_at: now()
    };
    registry.targets = registry.targets.filter((row) => row.target_id !== logicalId);
    registry.targets.push(target);
    await this.#saveTargets(id, registry);
    entry.bindings.set(logicalId, { cdp_target_id: created.targetId, context_id: logicalContextId, bound_at: now(), conversation_epoch: target.conversation_epoch });
    return { ...target, bound: true };
  }

  async listTargets(profileId, { includeRetired = false } = {}) {
    const id = validateProfileId(profileId);
    const registry = await this.#loadTargets(id);
    const bindings = this.running.get(id)?.bindings || new Map();
    return registry.targets.filter((row) => includeRetired || row.status !== 'RETIRED').map((row) => ({ ...row, bound: bindings.has(row.target_id) }));
  }

  async activateTarget({ profileId, targetId } = {}) {
    const { entry } = this.#runningEntry(profileId);
    const id = validateTargetId(targetId);
    const binding = entry.bindings.get(id);
    if (!binding) throw new Error('target_not_bound');
    await entry.processRef.cdp.call('Target.activateTarget', { targetId: binding.cdp_target_id });
    return { target_id: id, activated: true };
  }

  async closeTarget({ profileId, targetId } = {}) {
    const { id: profile, entry } = this.#runningEntry(profileId);
    const id = validateTargetId(targetId);
    const binding = entry.bindings.get(id);
    if (!binding) throw new Error('target_not_bound');
    await entry.processRef.cdp.call('Target.closeTarget', { targetId: binding.cdp_target_id });
    entry.bindings.delete(id);
    const registry = await this.#loadTargets(profile);
    const index = registry.targets.findIndex((row) => row.target_id === id);
    if (index >= 0) {
      registry.targets[index] = { ...registry.targets[index], status: 'RETIRED', updated_at: now() };
      await this.#saveTargets(profile, registry);
    }
    return { target_id: id, closed: true };
  }

  async health() {
    const profiles = [];
    for (const id of this.running.keys()) profiles.push(await this.profileHealth(id));
    return {
      schema: 'metaengine.a2-compute-browser.health.v1', runtime: '0.2.0-dev.1', started_at: this.startedAt,
      web_authority_effect: false, local_effects_present: true, raw_cdp_rpc_exposed: false,
      debug_transport: 'native_pipe_b3', devtools_tcp_exposed: false, context_manager: 'b2_logical_context_v1', profiles
    };
  }

  async shutdown() {
    for (const id of [...this.running.keys()]) await this.stopProfile(id).catch(() => {});
    await releaseOwnedPidLock(this.daemonLockFile);
    this.daemonLockFile = null;
  }
}
