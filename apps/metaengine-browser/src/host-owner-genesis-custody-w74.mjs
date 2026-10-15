// W74: Host Owner genesis inside the existing enrolled device + protected own-PG
// authority. No new key, enrollment, service, public IPC or writable task route.
// All suppliers are installed only by the private Host composition (W76).
import { guardianClientKernelBirthW67 } from './guardian-client-kernel-birth-w67.mjs';

export const HOST_OWNER_GENESIS_W74 = 'metaengine.host.owner-genesis-custody.w74.v1';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/i;
const HEX = /^[0-9a-f]{64}$/i;
const INCARNATION = /^pid:([1-9][0-9]*):created_100ns:([1-9][0-9]{16,18})$/;
const identityKeys = ['owner_id','device_id','project_id','pid','created_at','process_incarnation_id','epoch','generation','source_sha','device_key_fingerprint_sha256'];
const mark = x => x?.fixture_classification != null || x?.staging === true || x?.synthetic === true || x?.untrusted === true;
const same = (a,b,keys) => !!a && !!b && keys.every(k => a[k] === b[k]);
const time = x => x instanceof Date ? x.getTime() : Date.parse(x);
const fresh = (x, now) => Number.isFinite(time(x)) && time(x) >= now - 30000 && time(x) <= now + 5000;
const validKernel = x => x && Number.isSafeInteger(x.pid) && x.pid > 0 &&
  Number.isFinite(time(x.created_at)) && fresh(x.observed_at,Date.now()) &&
  x.source === 'OS_PROCESS_INVENTORY';

// One exact project is looked up from the authenticated own-PG catalog, NEVER
// from a constructor, renderer, URL, userData or an arbitrary SQL selector.
export const W74_OWNER_SCOPE_SQL = `SELECT project_id,device_id,client_id,admin_grant_epoch,
 pg_catalog.clock_timestamp() AS observed_at
 FROM destruktion_meta.project_run_h205f22
 WHERE device_id=$1::uuid AND client_id=$2::text AND admin_grant_epoch=$3::bigint
 LIMIT 2 FOR SHARE`;
export const W74_SCOPE_LOCK_SQL = `SELECT pg_catalog.pg_advisory_xact_lock(
 pg_catalog.hashtextextended($1::text,0))`;

// Authority inputs are _private provider closures_, not identity values. A
// positive boolean returned by a page, test, or JSON field has no authority.
export function createHostOwnerGenesisCustodyW74({
  identity, transaction, readAuthenticatedAdmin, readGuardian,
  readSourceProof, readNativeKernel, readSealed, writeSealed,
  now = Date.now, staging = false,
} = {}) {
  if (!identity || typeof identity.ensure !== 'function' ||
      typeof identity.snapshot !== 'function' ||
      [transaction,readAuthenticatedAdmin,readGuardian,readSourceProof,
        readNativeKernel,readSealed,writeSealed,now].some(f=>typeof f !== 'function'))
    throw new Error('w74_private_authorities_required');
  let closed = false, pending = Promise.resolve();
  const serialized = action => {
    const p = pending.then(action,action);
    pending = p.catch(()=>null);
    return p;
  };
  const check = async () => {
    if (closed) return null;
    await identity.ensure();
    const device = identity.snapshot();
    if (!UUID.test(device?.client_id || '') || !UUID.test(device?.device_id || '') ||
        !HEX.test(device?.key_fingerprint_sha256 || '') || device?.enrolled !== true) return null;
    const admin = await readAuthenticatedAdmin();
    if (!admin || admin.device_id !== device.device_id ||
        admin.client_id !== device.client_id ||
        !Number.isSafeInteger(admin.admin_grant_epoch) || admin.admin_grant_epoch < 1 ||
        admin.access_tier !== 'ADMIN' || admin.admin_ready !== true || mark(admin)) return null;
    const native = await readGuardian();
    const second = await readGuardian();
    if (!same(native,second,['guardian_client_pid','guardian_client_created_at',
      'guardian_client_process_incarnation_id','guardian_device_key_fingerprint_sha256',
      'guardian_enrollment_evidence_sha256','state']) ||
        native?.schema !== 'metaengine.browser-guardian.machine-bootstrap-launcher.v1' ||
        native?.state !== 'READY' || native?.owner_binding_proven !== true ||
        native?.device_binding_proven !== true || native?.guardian_client_kernel_birth_verified !== true ||
        mark(native) || native.guardian_device_key_fingerprint_sha256 !== device.key_fingerprint_sha256 ||
        !HEX.test(native.guardian_enrollment_evidence_sha256 || '')) return null;
    const m = INCARNATION.exec(native.guardian_client_process_incarnation_id || '');
    if (!m || Number(m[1]) !== native.guardian_client_pid ||
        !Number.isFinite(time(native.guardian_client_created_at))) return null;
    const decoded = guardianClientKernelBirthW67({client_pid:native.guardian_client_pid,
      client_creation_time_100ns:m[2],client_process_incarnation_id:
        native.guardian_client_process_incarnation_id});
    if (!decoded || time(decoded.created_at) !== time(native.guardian_client_created_at)) return null;
    const kernel = await readNativeKernel(native.guardian_client_pid);
    if (!validKernel(kernel) || kernel.pid !== native.guardian_client_pid ||
        time(kernel.created_at) !== time(native.guardian_client_created_at)) return null;
    const source = await readSourceProof();
    // The existing release signer / exact executable bytes must be
    // independently attested by W68. A generated fixture is always STAGING.
    if (!source || source.source !== 'INSTALLED_EXE_NATIVE_VERIFIER' ||
        !SHA.test(source.source_sha || '') ||
        source.exact_bytes_verified !== true || source.native_signature_verified !== true ||
        // W68 verifies a release-root Ed25519 signature binding the exact
        // installed EXE and SLSA digests. No unsigned "valid signer" shortcut.
        source.release_root_signature_verified !== true ||
        source.slsa_evidence_digest_bound !== true ||
        source.authority_effect !== false ||
        !fresh(source.observed_at,now()) ||
        !HEX.test(source.installed_exe_sha256 || '') ||
        !HEX.test(source.proof_identity || '') ||
        (!staging && mark(source))) return null;
    return {device,admin,native,kernel,source};
  };
  const scope = async (tx, x) => {
    const rows = await tx.unsafe(W74_OWNER_SCOPE_SQL, [
      x.device.device_id,x.device.client_id,x.admin.admin_grant_epoch]);
    if (!Array.isArray(rows) || rows.length !== 1) return null;
    const row = rows[0];
    if (!UUID.test(row?.project_id || '') || row.device_id !== x.device.device_id ||
        row.client_id !== x.device.client_id ||
        Number(row.admin_grant_epoch) !== x.admin.admin_grant_epoch ||
        !fresh(row.observed_at,now())) return null;
    return row;
  };
  const evidenceMatch = (record,x,row) =>
    !!record && (staging ? record.fixture_classification === 'STAGING' : !mark(record)) &&
    record.owner_id === x.device.client_id && record.device_id === x.device.device_id &&
    record.project_id === row.project_id && record.epoch === x.admin.admin_grant_epoch &&
    record.source_sha === x.source.source_sha.toLowerCase() &&
    record.device_key_fingerprint_sha256 === x.device.key_fingerprint_sha256 &&
    record.pid === x.kernel.pid &&
    time(record.created_at) === time(x.kernel.created_at) &&
    record.process_incarnation_id === x.native.guardian_client_process_incarnation_id &&
    Number.isSafeInteger(record.generation) && record.generation > 0 &&
    (staging ? mark(x.source) : !mark(x.source));
  const read = () => serialized(async () => {
    try {
      const x = await check();
      if (!x) return null;
      const record = await readSealed();
      if (!record || mark(record)) return null;
      const row = await transaction(tx=>scope(tx,x),{readOnly:true});
      if (!row || !evidenceMatch(record,x,row)) return null;
      const after = await check();
      if (!after || !same(x.device,after.device,['client_id','device_id','key_fingerprint_sha256']) ||
          !same(x.native,after.native,['guardian_client_pid','guardian_client_process_incarnation_id']) ||
          !same(x.source,after.source,['source_sha','installed_exe_sha256','proof_identity']) ||
          x.admin.admin_grant_epoch !== after.admin.admin_grant_epoch) return null;
      return Object.freeze({...record,observed_at:new Date(now()).toISOString(),authority_effect:false});
    } catch { return null; }
  });
  const create = () => serialized(async () => {
    try {
      const x = await check();
      if (!x) return null;
      // PostgreSQL serializes generation transitions against another Host
      // opening the same protected device identity; the protected record is
      // never accepted unless the independently current DB epoch still agrees.
      const candidate = await transaction(async tx => {
        await tx.unsafe(W74_SCOPE_LOCK_SQL,[x.device.device_id+':'+x.device.client_id]);
        const row = await scope(tx,x);
        if (!row) return null;
        const previous = await readSealed();
        if (previous && (previous.owner_id !== x.device.client_id ||
            previous.device_id !== x.device.device_id)) return null;
        if (previous && same(previous,{
            pid:x.kernel.pid,process_incarnation_id:x.native.guardian_client_process_incarnation_id,
            epoch:x.admin.admin_grant_epoch,source_sha:x.source.source_sha.toLowerCase(),
            project_id:row.project_id,
          },['pid','process_incarnation_id','epoch','source_sha','project_id']) &&
          evidenceMatch(previous,x,row)) return previous;
        if (previous && (!Number.isSafeInteger(previous.generation) ||
            previous.generation < 1 || previous.generation >= Number.MAX_SAFE_INTEGER)) return null;
        // Old live owner cannot be replaced by a competing client. If
        // unavailable/dead/ambiguous process readback => UNKNOWN, never takeover.
        if (previous?.pid && previous?.process_incarnation_id !==
            x.native.guardian_client_process_incarnation_id) {
          const old = await readNativeKernel(previous.pid);
          if (old?.state === 'NOT_RUNNING' && old.native_verified === true && old.pid === previous.pid) {
            // A trusted native negative PID probe, never a JS thrown exception.
          } else {
            if (!old || old.pid !== previous.pid || !validKernel(old)) return null;
            if (time(old.created_at) === time(previous.created_at)) return null;
          }
        }
        const next = Object.freeze({
          schema:'metaengine.host.owner-incarnation.v1',source:'LOCAL_HOST_OWNER',
          owner_id:x.device.client_id,device_id:x.device.device_id,
          project_id:row.project_id,pid:x.kernel.pid,
          created_at:new Date(time(x.kernel.created_at)).toISOString(),
          process_incarnation_id:x.native.guardian_client_process_incarnation_id,
          epoch:x.admin.admin_grant_epoch,generation:(previous?.generation || 0)+1,
          source_sha:x.source.source_sha.toLowerCase(),
          device_key_fingerprint_sha256:x.device.key_fingerprint_sha256,
          observed_at:new Date(now()).toISOString(),authority_effect:false,
          ...(staging?{fixture_classification:'STAGING'}:{}),
        });
        await writeSealed(next,previous);
        return next;
      },{readOnly:false,isolationLevel:'serializable'});
      if (!candidate) return null;
      const after = await check();
      if (!after || x.admin.admin_grant_epoch !== after.admin.admin_grant_epoch ||
          !same(x.native,after.native,['guardian_client_pid','guardian_client_process_incarnation_id']) ||
          !same(x.source,after.source,['source_sha','installed_exe_sha256','proof_identity'])) return null;
      // A second independent own-PG transaction catches epoch revocation or
      // project replacement that occurred after the write transaction committed.
      const postScope = await transaction(tx=>scope(tx,after),{readOnly:true});
      if (!postScope || postScope.project_id !== candidate.project_id ||
          postScope.admin_grant_epoch !== candidate.epoch) return null;
      const verified = await readSealed();
      if (!same(candidate,verified,identityKeys)) return null;
      if (staging) return Object.freeze({...candidate,fixture_classification:'STAGING'});
      return Object.freeze({...candidate,observed_at:new Date(now()).toISOString()});
    } catch { return null; }
  });
  return Object.freeze({schema:HOST_OWNER_GENESIS_W74,create,read,close:()=>{closed=true;}});
}
