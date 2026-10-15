// W60: native main/Host-only producers. No renderer, environment, public HTTP,
// temporary fixture or user-selected path can create an Owner claim.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { loadPackagedEmergencyMaintenanceTrustRoot } from './emergency-maintenance-trust-root.mjs';

const run = promisify(execFile);
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const HEX40 = /^[a-f0-9]{40}$/i;
const HEX64 = /^[a-f0-9]{64}$/i;
const valid = x => x && typeof x === 'object' && !Array.isArray(x);
const pos = x => Number.isSafeInteger(x) && x > 0;
const at = () => new Date().toISOString();
const fixtures = x => x?.fixture_classification != null || x?.synthetic === true || x?.staging === true;
const safe = f => Promise.resolve().then(f).catch(() => null);
const frozen = x => x ? Object.freeze(x) : null;

// Fixed PowerShell, numeric PID only. Unlike Get-Process from a status screenshot,
// StartTime is read from the Windows kernel at the time of each observation.
const PROCESS_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '$p = Get-Process -Id ([int]$args[0]) -ErrorAction Stop',
  '$start = $p.StartTime.ToUniversalTime().ToString("o")',
  '$exe = $p.Path',
  '@{ pid = [int]$p.Id; created_at = $start; exe_path = $exe } | ConvertTo-Json -Compress',
].join('; ');
const SIGNATURE_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '$f = [System.IO.Path]::GetFullPath($args[0])',
  '$s = Get-AuthenticodeSignature -LiteralPath $f -ErrorAction Stop',
  '@{ status = [string]$s.Status; thumbprint = [string]$s.SignerCertificate.Thumbprint } | ConvertTo-Json -Compress',
].join('; ');

export async function readWindowsKernelProcessW60(pid, { platform = process.platform, exec = run } = {}) {
  if (platform !== 'win32' || !pos(pid) || pid > 0x7fffffff) return null;
  return safe(async () => {
    const { stdout } = await exec('powershell.exe',
      ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command', PROCESS_SCRIPT, String(pid)],
      { timeout: 2500, windowsHide: true, maxBuffer: 4096 });
    const x = JSON.parse(stdout.trim());
    if (x.pid !== pid || !Number.isFinite(Date.parse(x.created_at)) ||
      typeof x.exe_path !== 'string' || !x.exe_path) return null;
    return frozen({pid, created_at:new Date(x.created_at).toISOString(),exe_path:x.exe_path,
      source:'OS_PROCESS_INVENTORY',state:'PRESENT',authority_effect:false,observed_at:at()});
  });
}

export async function readWindowsSignedExecutableW60(executable, {
  platform = process.platform, exec = run, readFile = fs.readFile,
} = {}) {
  if (platform !== 'win32' || typeof executable !== 'string' || !executable ||
    executable.startsWith('\\\\') || executable.includes('\0')) return null;
  return safe(async () => {
    const { stdout } = await exec('powershell.exe',
      ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',SIGNATURE_SCRIPT,executable],
      { timeout: 3500, windowsHide: true, maxBuffer: 4096 });
    const sig = JSON.parse(stdout.trim());
    if (sig.status !== 'Valid' || !HEX40.test(sig.thumbprint || '')) return null;
    const bytes = await readFile(executable);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    return frozen({ installed_exe_sha256:digest, signer_thumbprint:sig.thumbprint.toLowerCase(),
      native_signature_verified:true, exact_bytes_verified:true, source:'WINDOWS_AUTHENTICODE',
      observed_at:at(),authority_effect:false });
  });
}

/**
 * Producers are always instantiated in production. A missing trusted Host Owner
 * record is not reconstructed from Electron PID, device enrollment or Guardian
 * liveness. W61 supplies only the PG birth closure; no substitute PG observer.
 *
 * The privileged custody methods are intentionally read from the EXISTING
 * identity/Host objects (not caller-provided page fields). Until those methods
 * exist, their producer runs and yields null, never a pretend Owner.
 */
export function createHostNativeOwnerReadersW60({
  identity, guardianLauncher, app, processId = process.pid, exec = run,
  postgresBirth = null,
} = {}) {
  if (!identity || typeof identity.ensure !== 'function' || typeof identity.snapshot !== 'function')
    throw new TypeError('w60_trusted_host_identity_required');
  if (!guardianLauncher || typeof guardianLauncher.status !== 'function')
    throw new TypeError('w60_machine_guardian_reader_required');
  if (!app || typeof app.isPackaged !== 'boolean' || typeof app.getVersion !== 'function')
    throw new TypeError('w60_native_app_required');
  const ownExe = process.execPath;
  const platform = process.platform;

  async function ownerRecord() {
    // Device enrollment alone is not an Owner binding. This operation can
    // only be fulfilled by the existing Host custody's authenticated record.
    const x = await safe(() => identity.readHostOwnerIncarnation());
    const observed = Date.parse(x?.observed_at);
    if (!valid(x) || fixtures(x) || x.schema !== 'metaengine.host.owner-incarnation.v1' ||
      x.source !== 'LOCAL_HOST_OWNER' || x.authority_effect !== false ||
      !ID.test(x.owner_id || '') || !ID.test(x.project_id || '') || !ID.test(x.device_id || '') ||
      !pos(x.generation) || !pos(x.epoch) || !pos(x.pid) ||
      typeof x.process_incarnation_id !== 'string' || x.process_incarnation_id.length < 8 ||
      !Number.isFinite(Date.parse(x.created_at)) || !Number.isFinite(observed) ||
      observed < Date.now() - 30000 || observed > Date.now() + 5000 ||
      x.device_id !== identity.snapshot()?.device_id) return null;
    const k = await readWindowsKernelProcessW60(x.pid,{platform,exec});
    if (!k || k.created_at !== new Date(x.created_at).toISOString() ||
      k.exe_path.toLowerCase() !== ownExe.toLowerCase() || x.pid !== processId) return null;
    const again = await safe(() => identity.readHostOwnerIncarnation());
    if (!valid(again) || fixtures(again) || !['owner_id','project_id','device_id','pid',
      'created_at','process_incarnation_id','generation','epoch'].every(key=>x[key]===again[key]) ||
      !Number.isFinite(Date.parse(again.observed_at)) ||
      Date.parse(again.observed_at) < Date.now() - 30000 ||
      Date.parse(again.observed_at) > Date.now() + 5000) return null;
    return frozen({...x,observed_at:at()});
  }
  const readers = {
    readHostOwner: ownerRecord,
    async readKernelProcess(pid) {
      const owner = await ownerRecord();
      if (!owner || pid !== owner.pid) return null;
      const k = await readWindowsKernelProcessW60(pid,{platform,exec});
      if (!k || k.created_at !== new Date(owner.created_at).toISOString() ||
        k.exe_path.toLowerCase() !== ownExe.toLowerCase()) return null;
      return frozen({...k, process_incarnation_id:owner.process_incarnation_id});
    },
    async readGuardianOwner(ownerId, generation) {
      const owner = await ownerRecord();
      if (!owner || owner.owner_id !== ownerId || owner.generation !== generation) return null;
      const g = await safe(() => guardianLauncher.status());
      // Historical machine bootstrap status only has two booleans. Never
      // transmute that into PID/birth/epoch evidence.
      if (!valid(g) || fixtures(g) || g.schema !== 'metaengine.browser-guardian.machine-bootstrap-launcher.v1' ||
        g.state !== 'READY' || g.owner_binding_proven !== true || g.device_binding_proven !== true ||
        g.owner_id !== owner.owner_id || g.device_id !== owner.device_id ||
        g.owner_pid !== owner.pid || g.owner_generation !== owner.generation ||
        g.owner_epoch !== owner.epoch || g.owner_process_incarnation_id !== owner.process_incarnation_id ||
        Date.parse(g.owner_created_at) !== Date.parse(owner.created_at)) return null;
      return frozen({...g,observed_at:at(),authority_effect:false});
    },
    async readSignedInstalledExecutable(ownerId, generation) {
      const owner = await ownerRecord();
      if (!owner || owner.owner_id !== ownerId || owner.generation !== generation ||
        !app.isPackaged || platform !== 'win32') return null;
      const root = await safe(() => loadPackagedEmergencyMaintenanceTrustRoot());
      const native = await readWindowsSignedExecutableW60(ownExe,{platform,exec});
      // An arbitrary Valid Authenticode signature is NOT the METAENGINE signer.
      // Existing trusted root must explicitly pin signer + source + exact bytes.
      if (!root || !native ||
        !HEX40.test(root.build_sha || '') || !HEX64.test(root.installed_exe_sha256 || '') ||
        !HEX40.test(root.installed_signer_thumbprint || '') ||
        native.signer_thumbprint !== root.installed_signer_thumbprint.toLowerCase() ||
        native.installed_exe_sha256 !== root.installed_exe_sha256.toLowerCase()) return null;
      // Existing release trust must carry its *own* signed proof identity;
      // hashing this module's chosen Owner fields would manufacture provenance.
      if (!HEX64.test(root.installed_proof_identity || '')) return null;
      const proof = root.installed_proof_identity.toLowerCase();
      return frozen({source:'INSTALLED_EXE_NATIVE_VERIFIER',owner_id:owner.owner_id,
        owner_epoch:owner.epoch,owner_generation:owner.generation,
        process_incarnation_id:owner.process_incarnation_id,source_sha:root.build_sha.toLowerCase(),
        installed_exe_sha256:native.installed_exe_sha256,proof_identity:proof,
        exact_bytes_verified:true,native_signature_verified:true,observed_at:at(),authority_effect:false});
    },
    async readOwnerSecretStore(ownerId,generation) {
      const owner = await ownerRecord();
      if (!owner || owner.owner_id !== ownerId || owner.generation !== generation) return null;
      // Private Host custody, never an env var or a public IPC payload.
      const x = await safe(() => identity.readPrivateOwnerGatewayCredential(ownerId,generation));
      if (!valid(x) || fixtures(x) || x.source !== 'NATIVE_OWNER_SECRET_STORE' ||
        x.owner_id !== ownerId || x.owner_generation !== generation ||
        !/^[A-Za-z0-9_-]{32,256}$/.test(x.api_key || '') ||
        typeof x.gateway_base_url !== 'string' ||
        !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(x.gateway_base_url)) return null;
      return frozen({...x,authority_effect:false});
    },
    // W61 owns the real self-hosted PG producer. Never supply a guessed birth.
    async readOwnPostgresBirth(ownerId,epoch) {
      const owner = await ownerRecord();
      if (!owner || owner.owner_id !== ownerId || owner.epoch !== epoch ||
        typeof postgresBirth !== 'function') return null;
      const x = await safe(() => postgresBirth(ownerId,epoch));
      if (!valid(x) || fixtures(x) || x.owner_id !== ownerId || x.owner_epoch !== epoch ||
        x.source !== 'OWN_PG_POSTMASTER_READBACK') return null;
      return frozen({...x,authority_effect:false});
    },
  };
  return Object.freeze(readers);
}
