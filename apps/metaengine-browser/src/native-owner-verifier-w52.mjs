// W52 native-only Owner verification boundary. The six callbacks MUST be installed
// by trusted main/Host producers; this module does not discover roots from env,
// user files, HTTP/page messages, git HEAD, or a successful health response.
// In this source revision the installed native Owner/Guardian identity protocol
// is not yet exposed. Missing producers make the capability unavailable.
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const INC = /^[A-Za-z0-9_.:-]{8,128}$/;
const SHA = /^[a-f0-9]{40}$/i;
const HASH = /^[a-f0-9]{64}$/i;
const KEY = /^[A-Za-z0-9_-]{32,256}$/;
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const positive = x => Number.isSafeInteger(x) && x > 0;
const time = x => typeof x === 'string' && Number.isFinite(Date.parse(x));
const fresh = (x, now) => time(x) && Date.parse(x) >= now - 30000 && Date.parse(x) <= now + 5000;
const sameBirth = (a,b) => a.pid === b.pid && Date.parse(a.created_at) === Date.parse(b.created_at);
const fixture = x => x?.fixture_classification != null ||
  x?.synthetic === true || x?.staging === true || x?.untrusted === true;
const clone = x => Object.freeze({ ...x });
const REQUIRED = Object.freeze(['readHostOwner','readKernelProcess','readGuardianOwner',
  'readSignedInstalledExecutable','readOwnerSecretStore','readOwnPostgresBirth']);

// A diagnostic for source qualification, not a credential or a proof verdict.
export function missingNativeOwnerProtocolsW52(readers) {
  const source = isObj(readers) ? readers : {};
  return Object.freeze(REQUIRED.filter(k => typeof source[k] !== 'function'));
}

export function createNativeOwnerVerifierW52(readers, { now = Date.now } = {}) {
  if (typeof now !== 'function' || missingNativeOwnerProtocolsW52(readers).length) return null;
  const read = readers;
  return Object.freeze({
    async readOwner() {
      const first = await read.readHostOwner();
      if (!isObj(first) || fixture(first) || first.schema !== 'metaengine.host.owner-incarnation.v1' ||
        first.source !== 'LOCAL_HOST_OWNER' || first.authority_effect !== false ||
        !ID.test(first.owner_id || '') || !ID.test(first.device_id || '') ||
        !ID.test(first.project_id || '') || !INC.test(first.process_incarnation_id || '') ||
        !positive(first.pid) || !positive(first.generation) || !positive(first.epoch) ||
        !time(first.created_at) || !fresh(first.observed_at, now())) return null;
      return clone(first);
    },
    async verifyKernelOwner(owner) {
      if (!isObj(owner) || !positive(owner.pid)) return null;
      const first = await read.readKernelProcess(owner.pid);
      const second = await read.readKernelProcess(owner.pid);
      if (![first, second].every(x => isObj(x) && !fixture(x) &&
        x.source === 'OS_PROCESS_INVENTORY' && x.state === 'PRESENT' &&
        x.authority_effect === false && sameBirth(x, owner) &&
        x.process_incarnation_id === owner.process_incarnation_id &&
        fresh(x.observed_at, now())) ||
        !sameBirth(first, second) || first.process_incarnation_id !== second.process_incarnation_id)
        return null;
      return clone(second);
    },
    async readGuardian(owner) {
      if (!isObj(owner) || !ID.test(owner.owner_id || '')) return null;
      const g = await read.readGuardianOwner(owner.owner_id, owner.generation);
      // The current BrowserGuardianMachineBootstrapLauncher.status() returns
      // boolean OWNER_BOUND only, without the Owner PID/birth/epoch; it cannot
      // satisfy this evidence contract.
      if (!isObj(g) || fixture(g) ||
        g.schema !== 'metaengine.browser-guardian.machine-bootstrap-launcher.v1' ||
        g.state !== 'READY' || g.authority_effect !== false ||
        g.owner_binding_proven !== true || g.device_binding_proven !== true ||
        g.owner_id !== owner.owner_id || g.device_id !== owner.device_id ||
        g.owner_pid !== owner.pid || g.owner_generation !== owner.generation ||
        g.owner_epoch !== owner.epoch ||
        g.owner_process_incarnation_id !== owner.process_incarnation_id ||
        Date.parse(g.owner_created_at) !== Date.parse(owner.created_at) ||
        !fresh(g.observed_at, now())) return null;
      return clone(g);
    },
    async verifyInstalledSource(owner) {
      if (!isObj(owner) || !ID.test(owner.owner_id || '')) return null;
      const a = await read.readSignedInstalledExecutable(owner.owner_id, owner.generation);
      const b = await read.readSignedInstalledExecutable(owner.owner_id, owner.generation);
      if (![a,b].every(x => isObj(x) && !fixture(x) &&
        x.source === 'INSTALLED_EXE_NATIVE_VERIFIER' &&
        x.exact_bytes_verified === true && x.native_signature_verified === true &&
        x.release_root_signature_verified === true && x.slsa_evidence_digest_bound === true &&
        x.package_code_verified === true && HASH.test(x.package_code_sha256 || '') &&
        x.authority_effect === false && x.owner_id === owner.owner_id &&
        x.owner_epoch === owner.epoch && x.owner_generation === owner.generation &&
        x.process_incarnation_id === owner.process_incarnation_id &&
        SHA.test(x.source_sha || '') && HASH.test(x.installed_exe_sha256 || '') &&
        HASH.test(x.proof_identity || '') && fresh(x.observed_at, now())) ||
        !['source_sha','installed_exe_sha256','proof_identity','package_code_sha256'].every(k=>a[k]===b[k]))
        return null;
      return clone(b);
    },
    async readGatewayCredential(owner) {
      if (!isObj(owner) || !ID.test(owner.owner_id || '') || !positive(owner.generation)) return null;
      const x = await read.readOwnerSecretStore(owner.owner_id, owner.generation);
      if (!isObj(x) || fixture(x) || x.source !== 'NATIVE_OWNER_SECRET_STORE' ||
        x.owner_id !== owner.owner_id || x.owner_generation !== owner.generation ||
        !KEY.test(x.api_key || '') || x.authority_effect !== false) return null;
      return clone(x);
    },
    async readPostgresBirth(owner) {
      if (!isObj(owner) || !ID.test(owner.owner_id || '') || !positive(owner.epoch)) return null;
      const first = await read.readOwnPostgresBirth(owner.owner_id, owner.epoch);
      const second = await read.readOwnPostgresBirth(owner.owner_id, owner.epoch);
      if (![first, second].every(x => isObj(x) && !fixture(x) &&
        x.source === 'OWN_PG_POSTMASTER_READBACK' && x.authority_effect === false &&
        x.owner_id === owner.owner_id && x.owner_epoch === owner.epoch &&
        time(x.postgres_started_at) && fresh(x.observed_at, now())) ||
        first.postgres_started_at !== second.postgres_started_at) return null;
      return clone(second);
    },

  });
}
