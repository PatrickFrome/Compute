// W44: the main-process-only adapter. A network response, environment variable,
// PID, Guardian READY flag or caller-supplied "verified" field is not an Owner proof.
// The native verifier must independently read kernel Owner birth, authenticated
// Guardian enrollment, installed executable bytes and the own-PG postmaster.
export const OPERATOR_CANONICAL_NATIVE_W44_SCHEMA = 'metaengine.operator.canonical-native.w44.v1';
const SHA = /^[a-f0-9]{40}$/i;
const DIGEST = /^[a-f0-9]{64}$/i;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const INCARNATION = /^[A-Za-z0-9_.:-]{8,128}$/;
const KEY = /^[A-Za-z0-9_-]{32,256}$/;
const TIME = 30_000;
const validTime = (value, now) => typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) && Date.parse(value) <= now + 5_000 &&
  Date.parse(value) >= now - TIME;
const birth = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const positive = n => Number.isSafeInteger(n) && n > 0;

function exactGateway(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && u.hostname === '127.0.0.1' &&
      /^[1-9][0-9]*$/.test(u.port) && Number(u.port) <= 65535 &&
      u.pathname === '/' && !u.search && !u.hash && !u.username &&
      !u.password && url === u.origin;
  } catch { return false; }
}
function same(a, b, keys) { return keys.every(k => a[k] === b[k]); }

// No default verifier. This object is constructed only by Electron native main;
// renderer/preload never receives the verifier or Owner credentials. Verification
// methods must be backed by independent native provenance, NOT projections of
// environment/PID/HTTP success. Missing methods are a fail-closed integration gap.
export function createOperatorCanonicalNativeBindingReadback({
  nativeVerifier = null, now = Date.now,
} = {}) {
  if (typeof now !== 'function') throw new TypeError('native_clock_required');
  return async function getTrustedBinding() {
    const verifier = typeof nativeVerifier === 'function' ? await nativeVerifier() : nativeVerifier;
    if (!verifier || !['readOwner', 'verifyKernelOwner',
      'readGuardian', 'verifyInstalledSource', 'readGatewayCredential',
      'readPostgresBirth'].every(k => typeof verifier[k] === 'function')) return null;
    try {
      const owner = await verifier.readOwner();
      if (!owner || owner.schema !== 'metaengine.host.owner-incarnation.v1' ||
        owner.source !== 'LOCAL_HOST_OWNER' || owner.authority_effect !== false ||
        !ID.test(owner.owner_id || '') || !ID.test(owner.project_id || '') ||
        !positive(owner.pid) ||
        !positive(owner.generation) || !positive(owner.epoch) ||
        !INCARNATION.test(owner.process_incarnation_id || '') ||
        !birth(owner.created_at) || !validTime(owner.observed_at, now())) return null;
      const kernel = await verifier.verifyKernelOwner(owner);
      // Kernel verifier must report independent PID+birth+incarnation equality.
      if (kernel?.source !== 'OS_PROCESS_INVENTORY' || kernel?.state !== 'PRESENT' ||
        kernel.authority_effect !== false || kernel.pid !== owner.pid ||
        kernel.process_incarnation_id !== owner.process_incarnation_id ||
        Date.parse(kernel.created_at) !== Date.parse(owner.created_at) ||
        !validTime(kernel.observed_at, now())) return null;
      const guardian = await verifier.readGuardian();
      if (guardian?.schema !== 'metaengine.browser-guardian.machine-bootstrap-launcher.v1' ||
        guardian.state !== 'READY' || guardian.owner_binding_proven !== true ||
        guardian.device_binding_proven !== true || guardian.authority_effect !== false ||
        guardian.owner_id !== owner.owner_id || guardian.owner_generation !== owner.generation ||
        guardian.owner_pid !== owner.pid ||
        guardian.owner_process_incarnation_id !== owner.process_incarnation_id ||
        Date.parse(guardian.owner_created_at) !== Date.parse(owner.created_at) ||
        !validTime(guardian.observed_at, now())) return null;
      const installed = await verifier.verifyInstalledSource();
      // This comes from an independent native executable/manifest verifier;
      // no source SHA is derived from arbitrary fields or git working-tree state.
      if (installed?.source !== 'INSTALLED_EXE_NATIVE_VERIFIER' ||
        installed?.exact_bytes_verified !== true || installed?.authority_effect !== false ||
        !SHA.test(installed.source_sha || '') ||
        !DIGEST.test(installed.installed_exe_sha256 || '') ||
        !DIGEST.test(installed.proof_identity || '') ||
        !validTime(installed.observed_at, now())) return null;
      const credential = await verifier.readGatewayCredential(owner);
      const pg = await verifier.readPostgresBirth(owner);
      if (credential?.source !== 'NATIVE_OWNER_SECRET_STORE' ||
        credential?.owner_id !== owner.owner_id ||
        credential?.owner_generation !== owner.generation ||
        !KEY.test(credential.api_key || '') || !exactGateway(credential.gateway_base_url) ||
        pg?.source !== 'OWN_PG_POSTMASTER_READBACK' ||
        pg.owner_id !== owner.owner_id || pg.owner_epoch !== owner.epoch ||
        !birth(pg.postgres_started_at) || !validTime(pg.observed_at, now())) return null;
      // The native reader obtains two complete samples around its HTTP hop.
      // Additionally prevent a readback race *inside* this native sampling.
      const final = await verifier.readOwner();
      if (!final || !same(owner, final, ['owner_id','pid','generation','epoch',
        'process_incarnation_id','created_at','project_id']) ||
        !validTime(final.observed_at, now())) return null;
      return Object.freeze({
        provider: 'LOCAL_POSTGRES', boot_state: 'READY',
        owner_binding_source: 'NATIVE_IN_PROCESS_OWNER',
        owner_id: owner.owner_id, project_id: owner.project_id, owner_epoch: owner.epoch,
        owner_generation: owner.generation, owner_pid: owner.pid,
        owner_created_at: owner.created_at,
        process_incarnation_id: owner.process_incarnation_id,
        owner_observed_at: final.observed_at,
        postgres_started_at: pg.postgres_started_at,
        gateway_base_url: credential.gateway_base_url, api_key: credential.api_key,
        source_sha: installed.source_sha.toLowerCase(),
        installed_exe_sha256: installed.installed_exe_sha256.toLowerCase(),
        proof_identity: installed.proof_identity.toLowerCase(),
      });
    } catch { return null; }
  };
}
