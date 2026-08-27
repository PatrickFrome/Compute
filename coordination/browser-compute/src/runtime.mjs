import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ManagedChromeProcess } from './chrome-process.mjs';
import { atomicJsonWrite, defaultStateRoot, ensurePrivateDir, readJson, validateNavigationUrl, validateProfileId, validateTargetId } from './security.mjs';

const PROFILE_META = 'a2-profile.json';
const TARGETS_FILE = 'targets.json';
const LOCK_FILE = 'a2-runtime.lock';

function now() { return new Date().toISOString(); }
function blankRegistry() { return { schema: 'metaengine.a2-compute-browser.targets.v1', revision: 0, targets: [], updated_at: now() }; }

async function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

export class ComputeBrowserRuntime {
  constructor({ stateRoot = defaultStateRoot() } = {}) {
    this.stateRoot = path.resolve(stateRoot);
    this.profilesRoot = path.join(this.stateRoot, 'profiles');
    this.running = new Map();
    this.startedAt = now();
  }

  async init() { await ensurePrivateDir(this.profilesRoot); return this; }

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

  async #acquireLock(profileId) {
    const file = path.join(this.profileDir(profileId), LOCK_FILE);
    try {
      await fs.writeFile(file, `${JSON.stringify({ pid: process.pid, acquired_at: now() })}\n`, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let existing = null;
      try { existing = JSON.parse(await fs.readFile(file, 'utf8')); } catch (_) {}
      if (await pidAlive(Number(existing?.pid))) throw new Error('profile_runtime_lock_held');
      await fs.rm(file, { force: true });
      return this.#acquireLock(profileId);
    }
    return file;
  }

  async startProfile({ profileId, executablePath, headless = false, allowNoSandbox = false } = {}) {
    const id = validateProfileId(profileId);
    if (this.running.has(id)) return this.profileHealth(id);
    const meta = await this.#profileMeta(id);
    const lockFile = await this.#acquireLock(id);
    const userDataDir = path.join(this.profileDir(id), 'chrome-data');
    const processRef = new ManagedChromeProcess({ executablePath, userDataDir, headless, allowNoSandbox });
    try {
      await processRef.start();
      this.running.set(id, { processRef, meta, lockFile, bindings: new Map() });
      return this.profileHealth(id);
    } catch (error) {
      await processRef.stop().catch(() => {});
      await fs.rm(lockFile, { force: true }).catch(() => {});
      throw error;
    }
  }

  async stopProfile(profileId) {
    const id = validateProfileId(profileId);
    const entry = this.running.get(id);
    if (!entry) return { profile_id: id, running: false };
    await entry.processRef.stop();
    this.running.delete(id);
    await fs.rm(entry.lockFile, { force: true }).catch(() => {});
    return { profile_id: id, running: false };
  }

  async profileHealth(profileId) {
    const id = validateProfileId(profileId);
    const entry = this.running.get(id);
    if (!entry) return { profile_id: id, running: false };
    return { profile_id: id, browser_node_id: entry.meta.browser_node_id, ...(await entry.processRef.health()) };
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

  async #loadTargets(profileId) {
    return readJson(path.join(this.profileDir(profileId), TARGETS_FILE), blankRegistry());
  }

  async #saveTargets(profileId, registry) {
    registry.revision = Number(registry.revision || 0) + 1;
    registry.updated_at = now();
    await atomicJsonWrite(path.join(this.profileDir(profileId), TARGETS_FILE), registry);
  }

  #runningEntry(profileId) {
    const id = validateProfileId(profileId);
    const entry = this.running.get(id);
    if (!entry?.processRef?.cdp) throw new Error('profile_not_running');
    return { id, entry };
  }

  async createTarget({ profileId, targetId = null, role = 'WORKER', url = 'about:blank' } = {}) {
    const { id, entry } = this.#runningEntry(profileId);
    const registry = await this.#loadTargets(id);
    const logicalId = targetId ? validateTargetId(targetId) : `browser_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
    if (registry.targets.some((row) => row.target_id === logicalId && row.status !== 'RETIRED')) throw new Error('target_id_exists');
    const navUrl = validateNavigationUrl(url);
    const created = await entry.processRef.cdp.call('Target.createTarget', { url: navUrl });
    if (!created.targetId) throw new Error('cdp_target_create_failed');
    const previous = registry.targets.find((row) => row.target_id === logicalId);
    const target = {
      schema: 'metaengine.a2-browser-operator.target.v1',
      target_id: logicalId,
      provider: 'BROWSER',
      platform: 'COMPUTE_BROWSER',
      surface: 'WEB',
      role: String(role || 'WORKER').toUpperCase().replace(/[^A-Z0-9_:-]+/g, '_').slice(0, 64),
      conversation_epoch: Math.max(1, Number(previous?.conversation_epoch || 0) + 1),
      conversation_url: navUrl,
      status: 'ACTIVE',
      created_at: previous?.created_at || now(),
      updated_at: now()
    };
    registry.targets = registry.targets.filter((row) => row.target_id !== logicalId);
    registry.targets.push(target);
    await this.#saveTargets(id, registry);
    entry.bindings.set(logicalId, { cdp_target_id: created.targetId, bound_at: now(), conversation_epoch: target.conversation_epoch });
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
      schema: 'metaengine.a2-compute-browser.health.v1',
      runtime: '0.1.0-dev.1',
      started_at: this.startedAt,
      authority_effect: false,
      raw_cdp_rpc_exposed: false,
      profiles
    };
  }

  async shutdown() {
    for (const id of [...this.running.keys()]) await this.stopProfile(id).catch(() => {});
  }
}
