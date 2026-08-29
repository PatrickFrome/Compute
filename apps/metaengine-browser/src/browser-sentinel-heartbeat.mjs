import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const HEARTBEAT_SCHEMA = 'metaengine.browser-sentinel.heartbeat.v1';
const PROVENANCE_SCHEMA = 'metaengine.browser-sentinel.provenance.v1';
const HEX64_RE = /^[0-9a-f]{64}$/;
const HEX40_RE = /^[0-9a-f]{40}$/;
const UPDATE_PHASES = new Set(['NONE','DOWNLOADED_RESTART_PENDING','INSTALLING','RESTARTING']);
const SHUTDOWN_INTENTS = new Set(['NONE','USER_EXIT','UPDATE_RESTART']);

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fsSync.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function safeChildEnv(env = process.env) {
  const allow = new Set(['SYSTEMROOT','WINDIR','LOCALAPPDATA','APPDATA','TEMP','TMP','USERPROFILE','HOMEDRIVE','HOMEPATH']);
  return Object.fromEntries(Object.entries(env).filter(([key]) => allow.has(String(key).toUpperCase())));
}

function mapUpdatePhase(value) {
  const state = String(value || '').toUpperCase();
  if (state === 'READY_RESTART') return 'DOWNLOADED_RESTART_PENDING';
  if (state === 'RESTARTING') return 'RESTARTING';
  return 'NONE';
}

function requireProvenance(value) {
  if (!value || value.schema !== PROVENANCE_SCHEMA) throw new Error('browser_sentinel_provenance_schema_invalid');
  const executable = String(value.executable_sha256 || '').toLowerCase();
  const source = String(value.source_commit_sha || '').toLowerCase();
  const pkg = String(value.package_sha256 || '').toLowerCase();
  const sentinel = String(value.sentinel_sha256 || '').toLowerCase();
  if (!HEX64_RE.test(executable) || !HEX40_RE.test(source) || !HEX64_RE.test(pkg) || !HEX64_RE.test(sentinel)) throw new Error('browser_sentinel_provenance_invalid');
  return Object.freeze({ executable_sha256: executable, source_commit_sha: source, package_sha256: pkg, sentinel_sha256: sentinel });
}

export class BrowserSentinelHeartbeat {
  #packaged; #platform; #resourcesPath; #execPath; #env; #spawn; #clock; #uuid; #getUpdateState; #intervalMs; #path;
  #timer = null; #seq = 0; #incarnation; #stateDir = null; #sentinelPath = null; #provenance = null; #shutdownIntent = 'NONE';
  #snapshot = { state:'UNINITIALIZED', last_error:null, sentinel_pid:null, heartbeat_path:null, authority_effect:false };

  constructor({ packaged, platform = process.platform, resourcesPath = process.resourcesPath, execPath = process.execPath, env = process.env, spawnImpl = spawn, clock = () => Date.now(), uuid = () => crypto.randomUUID(), getUpdateState = () => null, intervalMs = 2000, pathImpl = null } = {}) {
    this.#packaged = packaged === true;
    this.#platform = platform;
    this.#resourcesPath = resourcesPath;
    this.#execPath = execPath;
    this.#env = env;
    this.#spawn = spawnImpl;
    this.#clock = clock;
    this.#uuid = uuid;
    this.#getUpdateState = getUpdateState;
    this.#intervalMs = Math.max(1000, Number(intervalMs) || 2000);
    this.#path = pathImpl || (platform === 'win32' ? path.win32 : path);
    this.#incarnation = `inc.browser.${String(this.#uuid()).replace(/[^a-z0-9-]/gi,'').toLowerCase()}`;
  }

  snapshot() { return structuredClone({ schema:'metaengine.browser-sentinel.heartbeat-runtime.v1', ...this.#snapshot, browser_incarnation_id:this.#incarnation }); }

  async start() {
    if (!this.#packaged || this.#platform !== 'win32') { this.#snapshot.state='DISABLED'; return this.snapshot(); }
    try {
      const local = String(this.#env.LOCALAPPDATA || '');
      if (!this.#path.isAbsolute(local)) throw new Error('browser_sentinel_localappdata_invalid');
      this.#stateDir = this.#path.join(local,'METAENGINE','BrowserSentinelV1');
      this.#sentinelPath = this.#path.join(this.#resourcesPath,'sentinel','browser-sentinel.exe');
      const provenancePath = this.#path.join(this.#resourcesPath,'sentinel','provenance.json');
      this.#provenance = requireProvenance(JSON.parse(await fs.readFile(provenancePath,'utf8')));
      const [browserDigest, sentinelDigest] = await Promise.all([sha256File(this.#execPath), sha256File(this.#sentinelPath)]);
      if (browserDigest !== this.#provenance.executable_sha256) throw new Error('browser_sentinel_browser_digest_mismatch');
      if (sentinelDigest !== this.#provenance.sentinel_sha256) throw new Error('browser_sentinel_companion_digest_mismatch');
      await fs.mkdir(this.#stateDir,{recursive:true});
      await this.#writeHeartbeat('NONE');
      const child = this.#spawn(this.#sentinelPath, [], {
        shell:false,
        detached:true,
        windowsHide:true,
        stdio:'ignore',
        cwd:this.#path.dirname(this.#sentinelPath),
        env:safeChildEnv(this.#env),
      });
      child.unref?.();
      this.#snapshot.sentinel_pid = Number(child.pid || 0) || null;
      this.#snapshot.heartbeat_path = this.#path.join(this.#stateDir,'heartbeat.json');
      this.#snapshot.state = 'ACTIVE';
      this.#schedule();
    } catch (error) {
      this.#snapshot.state='ERROR';
      this.#snapshot.last_error=String(error?.message || error).slice(0,240);
    }
    return this.snapshot();
  }

  async stop({ intent = 'USER_EXIT' } = {}) {
    const normalized = SHUTDOWN_INTENTS.has(String(intent).toUpperCase()) ? String(intent).toUpperCase() : 'USER_EXIT';
    this.#shutdownIntent = normalized;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#provenance && this.#stateDir) await this.#writeHeartbeat(normalized).catch(()=>{});
    this.#snapshot.state='STOPPED';
    return this.snapshot();
  }

  stopSync({ intent = 'USER_EXIT' } = {}) {
    const normalized = SHUTDOWN_INTENTS.has(String(intent).toUpperCase()) ? String(intent).toUpperCase() : 'USER_EXIT';
    this.#shutdownIntent = normalized;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    try {
      if (this.#provenance && this.#stateDir) {
        const body = this.#buildHeartbeat(normalized);
        const target = this.#path.join(this.#stateDir,'heartbeat.json');
        const temp = `${target}.tmp`;
        fsSync.mkdirSync(this.#stateDir,{recursive:true,mode:0o700});
        fsSync.writeFileSync(temp,`${JSON.stringify(body)}\n`,{mode:0o600});
        fsSync.renameSync(temp,target);
      }
    } catch (error) {
      this.#snapshot.last_error=String(error?.message || error).slice(0,240);
    }
    this.#snapshot.state='STOPPED';
    return this.snapshot();
  }

  #schedule() {
    if (this.#timer || this.#snapshot.state !== 'ACTIVE') return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#writeHeartbeat(this.#shutdownIntent).catch((error)=>{ this.#snapshot.last_error=String(error?.message||error).slice(0,240); }).finally(()=>this.#schedule());
    }, this.#intervalMs);
    this.#timer.unref?.();
  }

  #buildHeartbeat(intent) {
    let updatePhase = mapUpdatePhase(this.#getUpdateState());
    const shutdownIntent = SHUTDOWN_INTENTS.has(intent) ? intent : 'NONE';
    if (shutdownIntent === 'UPDATE_RESTART') updatePhase = 'RESTARTING';
    if (!UPDATE_PHASES.has(updatePhase)) updatePhase='NONE';
    return {
      schema: HEARTBEAT_SCHEMA,
      browser_incarnation_id: this.#incarnation,
      pid: process.pid,
      executable_sha256: this.#provenance.executable_sha256,
      source_commit_sha: this.#provenance.source_commit_sha,
      package_sha256: this.#provenance.package_sha256,
      heartbeat_seq: ++this.#seq,
      observed_at_unix_ms: Number(this.#clock()),
      update_phase: updatePhase,
      shutdown_intent: shutdownIntent,
      authority_effect: false,
    };
  }

  async #writeHeartbeat(intent) {
    const body = this.#buildHeartbeat(intent);
    const target = this.#path.join(this.#stateDir,'heartbeat.json');
    const temp = `${target}.tmp`;
    await fs.writeFile(temp,`${JSON.stringify(body)}\n`,{mode:0o600});
    await fs.rename(temp,target);
  }
}

export const __sentinelTest = Object.freeze({ safeChildEnv, mapUpdatePhase, requireProvenance });
