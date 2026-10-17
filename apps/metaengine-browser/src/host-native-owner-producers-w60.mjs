// W60: native main/Host-only producers. No renderer, environment, public HTTP,
// temporary fixture or user-selected path can create an Owner claim.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { processScript, ABSENT_PROCESS_ERROR, ABSENT_PROCESS_TYPE, ABSENT_PROCESS_FIELDS } from './win32-kernel-process-query-w60.mjs';

const execAsync = promisify(execFile);
// These are fixed read-only commands: no command ever consumes stdin. Native
// Windows PowerShell may wait for redirected input to close under a CI parent.
// End only this child's pipe, never the Host's input. The original finite
// timeout/maxBuffer and rejection semantics remain authoritative.
const run = (...args) => {
  const pending = execAsync(...args);
  pending.child.stdin?.end();
  return pending;
};
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const HEX40 = /^[a-f0-9]{40}$/i;
const HEX64 = /^[a-f0-9]{64}$/i;
const valid = x => x && typeof x === 'object' && !Array.isArray(x);
const pos = x => Number.isSafeInteger(x) && x > 0;
const at = () => new Date().toISOString();
const fixtures = x => x?.fixture_classification != null || x?.synthetic === true || x?.staging === true || x?.untrusted === true;
const fresh = x => Number.isFinite(Date.parse(x)) &&
  Date.parse(x) >= Date.now() - 30000 && Date.parse(x) <= Date.now() + 5000;
const safe = f => Promise.resolve().then(f).catch(() => null);
const frozen = x => x ? Object.freeze(x) : null;

const signatureScript = executable => [
  '$ErrorActionPreference = "Stop"',
  // A single, PowerShell-literal-escaped trusted native EXE path; no command
  // fragment, wildcard, option injection or trailing $args invocation.
  "$f = [System.IO.Path]::GetFullPath('" + executable.replace(/'/g, "''") + "')",
  '$s = Get-AuthenticodeSignature -LiteralPath $f -ErrorAction Stop',
  '@{ status = [string]$s.Status; thumbprint = [string]$s.SignerCertificate.Thumbprint } | ConvertTo-Json -Compress',
].join('; ');

function trustedWindowsShellW60() {
  // Match the existing native KnownFolder rail: a nonstandard Windows system
  // drive stays UNKNOWN until it has an independent native root resolver.
  // Environment and PATH cannot select another executable or module provider.
  const root = 'C:\\Windows';
  const declaredRoot = String(process.env.SystemRoot || process.env.SYSTEMROOT || '');
  if (declaredRoot.toLowerCase() !== root.toLowerCase() ||
      (process.env.WINDIR && process.env.WINDIR.toLowerCase() !== root.toLowerCase())) return null;
  const system32 = path.win32.join(root,'System32');
  const powershell = path.win32.join(system32,'WindowsPowerShell','v1.0','powershell.exe');
  const env = {SystemRoot:root,SYSTEMROOT:root,WINDIR:root,PATH:system32,
    PSModulePath:path.win32.join(system32,'WindowsPowerShell','v1.0','Modules')};
  return {powershell,env};
}

export async function readWindowsKernelProcessW60(pid, { platform = process.platform, exec = run } = {}) {
  if (platform !== 'win32' || !pos(pid) || pid > 0x7fffffff) return null;
  const shell = trustedWindowsShellW60();
  if (!shell) return null;
  return safe(async () => {
    const { stdout } = await exec(shell.powershell,
      ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command', processScript(pid)],
      { env:shell.env, shell:false, timeout: 15000, windowsHide: true, maxBuffer: 4096 });
    const x = JSON.parse(stdout.trim());
    if (x?.state === 'NOT_RUNNING') {
      if (Object.keys(x).length !== ABSENT_PROCESS_FIELDS.length ||
          !ABSENT_PROCESS_FIELDS.every(key => Object.hasOwn(x,key)) ||
          x.pid !== pid || x.native_target_pid !== pid ||
          x.native_error_id !== ABSENT_PROCESS_ERROR ||
          x.native_error_category !== 'ObjectNotFound' ||
          x.native_error_type !== ABSENT_PROCESS_TYPE) return null;
      return frozen({pid,source:'OS_PROCESS_INVENTORY',state:'NOT_RUNNING',
        native_verified:true,authority_effect:false,observed_at:at()});
    }
    if (x.pid !== pid || !Number.isFinite(Date.parse(x.created_at)) ||
      typeof x.exe_path !== 'string' || !x.exe_path) return null;
    return frozen({pid, created_at:new Date(x.created_at).toISOString(),exe_path:x.exe_path,
      source:'OS_PROCESS_INVENTORY',state:'PRESENT',authority_effect:false,observed_at:at()});
  });
}

export async function readWindowsSignedExecutableW60(executable, {
  platform = process.platform, exec = run, readFile = fs.readFile,
} = {}) {
  if (platform !== 'win32' || typeof executable !== 'string' ||
    executable.length > 2048 || !/^[A-Za-z]:\\/.test(executable) ||
    executable.startsWith('\\\\') || executable.includes('\0')) return null;
  const shell = trustedWindowsShellW60();
  if (!shell) return null;
  return safe(async () => {
    const { stdout } = await exec(shell.powershell,
      ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',signatureScript(executable)],
      { env:shell.env, shell:false, timeout: 3500, windowsHide: true, maxBuffer: 4096 });
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

  function validOwnerRecord(x) {
    const observed = Date.parse(x?.observed_at);
    if (!valid(x) || fixtures(x) || x.schema !== 'metaengine.host.owner-incarnation.v1' ||
      x.source !== 'LOCAL_HOST_OWNER' || x.authority_effect !== false ||
      !ID.test(x.owner_id || '') || !ID.test(x.project_id || '') || !ID.test(x.device_id || '') ||
      !pos(x.generation) || !pos(x.epoch) || !pos(x.pid) ||
      typeof x.process_incarnation_id !== 'string' || x.process_incarnation_id.length < 8 ||
      !Number.isFinite(Date.parse(x.created_at)) || !Number.isFinite(observed) ||
      observed < Date.now() - 30000 || observed > Date.now() + 5000 ||
      x.device_id !== identity.snapshot()?.device_id) return false;
    return true;
  }

  async function ownerRecord() {
    // Device enrollment alone is not an Owner binding. This operation can
    // only be fulfilled by the existing Host custody's authenticated record.
    const x = await safe(() => identity.readHostOwnerIncarnation());
    if (!validOwnerRecord(x)) return null;
    const k = await readWindowsKernelProcessW60(x.pid,{platform,exec});
    if (!k || k.created_at !== new Date(x.created_at).toISOString() ||
      k.exe_path.toLowerCase() !== ownExe.toLowerCase() || x.pid !== processId) return null;
    const again = await safe(() => identity.readHostOwnerIncarnation());
    if (!validOwnerRecord(again) || !['owner_id','project_id','device_id','pid',
      'created_at','process_incarnation_id','generation','epoch','source_sha']
      .every(key=>x[key]===again[key])) return null;
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
      // Guardian's independent native challenge verifies device + durable
      // machine owner SID, and now samples its authenticated pipe client PID
      // and OS birth. It does NOT by itself know project/epoch: only join to a
      // separately authenticated Host Owner record, then recheck both.
      const g = await safe(() => guardianLauncher.status());
      if (!valid(g) || fixtures(g) || g.schema !== 'metaengine.browser-guardian.machine-bootstrap-launcher.v1' ||
          g.state !== 'READY' || g.owner_binding_proven !== true || g.device_binding_proven !== true ||
          g.guardian_client_kernel_birth_verified !== true ||
          g.guardian_client_pid !== owner.pid ||
          Date.parse(g.guardian_client_created_at) !== Date.parse(owner.created_at) ||
          g.guardian_client_process_incarnation_id !== owner.process_incarnation_id ||
          !/^pid:[0-9]+:created_100ns:[1-9][0-9]{16,18}$/.test(
            g.guardian_client_process_incarnation_id || '') ||
          !HEX64.test(g.guardian_enrollment_evidence_sha256 || '') ||
          g.guardian_device_key_fingerprint_sha256 !== identity.snapshot()?.key_fingerprint_sha256) return null;
      const after = await ownerRecord();
      if (!after || !['owner_id','device_id','project_id','pid','created_at',
        'generation','epoch','process_incarnation_id','source_sha'].every(k=>owner[k]===after[k])) return null;
      return frozen({...g,owner_id:owner.owner_id,device_id:owner.device_id,
        owner_pid:owner.pid,owner_created_at:owner.created_at,
        owner_generation:owner.generation,owner_epoch:owner.epoch,
        owner_process_incarnation_id:owner.process_incarnation_id,
        observed_at:at(),authority_effect:false});
    },
    async readSignedInstalledExecutable(ownerId, generation) {
      const owner = await ownerRecord();
      if (!owner || owner.owner_id !== ownerId || owner.generation !== generation ||
        !HEX40.test(owner.source_sha || '') || !app.isPackaged || platform !== 'win32') return null;
      // W68 owns the existing release-root signature and exact EXE/SLSA byte
      // verification. Lazy import avoids a static W60 -> W68 -> W60 cycle;
      // its production API accepts only the native app, never injected roots,
      // paths, signers or this producer's diagnostic exec callback.
      const proof = await safe(async () => {
        const { readVerifiedInstalledExecutableW68 } = await import('./installed-executable-provenance-w68.mjs');
        return readVerifiedInstalledExecutableW68(app);
      });
      if (!valid(proof) || fixtures(proof) || proof.source !== 'INSTALLED_EXE_NATIVE_VERIFIER' ||
        proof.release_root_signature_verified !== true || proof.slsa_evidence_digest_bound !== true ||
        proof.native_signature_verified !== true || proof.exact_bytes_verified !== true ||
        proof.authority_effect !== false || !HEX40.test(proof.source_sha || '') ||
        proof.source_sha.toLowerCase() !== owner.source_sha.toLowerCase() ||
        !HEX64.test(proof.installed_exe_sha256 || '') || !HEX64.test(proof.proof_identity || '') ||
        !fresh(proof.observed_at)) return null;
      const after = await ownerRecord();
      if (!after || !['owner_id','device_id','project_id','pid','created_at',
        'generation','epoch','process_incarnation_id','source_sha'].every(k=>owner[k]===after[k]) ||
        !fresh(proof.observed_at)) return null;
      // Preserve W68's signed proof identity and observation, adding only the
      // independently rechecked current Owner binding. No provenance is minted.
      return frozen({...proof,owner_id:owner.owner_id,
        owner_epoch:owner.epoch,owner_generation:owner.generation,
        process_incarnation_id:owner.process_incarnation_id});
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
        x.source !== 'OWN_PG_POSTMASTER_READBACK' ||
        x.owner_project_id !== owner.project_id ||
        x.owner_device_id !== owner.device_id ||
        x.owner_generation !== owner.generation ||
        x.owner_process_incarnation_id !== owner.process_incarnation_id ||
        x.source_sha?.toLowerCase() !== owner.source_sha?.toLowerCase()) return null;
      const after = await ownerRecord();
      if (!after || !['owner_id','device_id','project_id','pid','created_at',
        'generation','epoch','process_incarnation_id','source_sha'].every(k=>owner[k]===after[k])) return null;
      return frozen({...x,authority_effect:false});
    },
  };
  return Object.freeze(readers);
}
