// W76: private, fail-closed adapter for W74's *already established* Owner
// genesis. It never constructs an Owner, reads userData, opens a database,
// obtains secrets from env, or invokes W67's Host IPC owner reader (cycle).
const INCARNATION = /^pid:([1-9][0-9]*):created_100ns:([1-9][0-9]{16,18})$/;
const SHA = /^[a-f0-9]{40}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = ['owner_id','device_id','project_id','pid','created_at',
  'process_incarnation_id','epoch','generation','source_sha'];
const marker = o => o?.fixture_classification != null || o?.synthetic === true ||
  o?.staging === true || o?.untrusted === true;
const matching = (a,b,keys = fields) => !!a && !!b && keys.every(k=>a[k]===b[k]);
const fresh = o => {
  const observed = Date.parse(o?.observed_at || '');
  return Number.isFinite(observed) &&
    observed >= Date.now()-30000 && observed <= Date.now()+5000;
};
function canonical(owner, device) {
  const incarnation = INCARNATION.exec(owner?.process_incarnation_id || '');
  return owner?.schema === 'metaengine.host.owner-incarnation.v1' &&
    owner.source === 'LOCAL_HOST_OWNER' && owner.authority_effect === false &&
    !marker(owner) && UUID.test(owner.owner_id || '') &&
    UUID.test(owner.device_id || '') && UUID.test(owner.project_id || '') &&
    UUID.test(device?.client_id || '') && UUID.test(device?.device_id || '') &&
    owner.owner_id === device.client_id && owner.device_id === device.device_id &&
    Number.isSafeInteger(owner.pid) && owner.pid > 0 &&
    Number.isSafeInteger(owner.generation) && owner.generation > 0 &&
    Number.isSafeInteger(owner.epoch) && owner.epoch > 0 &&
    SHA.test(owner.source_sha || '') && incarnation &&
    Number(incarnation[1]) === owner.pid &&
    Number.isFinite(Date.parse(owner.created_at)) && fresh(owner);
}
export const W76_PRIVATE_CUSTODY_SCHEMA = 'metaengine.host.private-custody-w76.v1';

// No new authority: only W74's private method may answer Owner. Missing W74
// initialization, native Guardian or own-DB connection remains UNKNOWN.
export function createHostPrivateCustodyW76({identity,
  readExistingGatewaySecret = null, readExistingOwnPostgresBirth = null,
  readExistingProtectedBackupRoot = null} = {}) {
  if (!identity || typeof identity.snapshot !== 'function') throw new TypeError('w76_identity_required');
  for (const fn of [readExistingGatewaySecret,readExistingOwnPostgresBirth,
    readExistingProtectedBackupRoot])
    if (fn !== null && typeof fn !== 'function') throw new TypeError('w76_private_provider_invalid');
  let closed = false;
  const owner = async () => {
    if (closed || typeof identity.readTrustedHostOwnerIncarnationW74 !== 'function') return null;
    try {
      const deviceBefore = identity.snapshot();
      const first = await identity.readTrustedHostOwnerIncarnationW74();
      const second = await identity.readTrustedHostOwnerIncarnationW74();
      const deviceAfter = identity.snapshot();
      if (!canonical(first,deviceBefore) || !canonical(second,deviceAfter) ||
        !matching(first,second) || !matching(deviceBefore,deviceAfter,
          ['client_id','device_id','key_fingerprint_sha256'])) return null;
      return Object.freeze({...second});
    } catch { return null; }
  };
  const sameOwner = (before,after) => matching(before,after) &&
    canonical(after,identity.snapshot()) && !closed;
  const credential = async (ownerId,generation) => {
    if (!readExistingGatewaySecret || closed) return null;
    const before = await owner();
    if (before?.owner_id !== ownerId || before?.generation !== generation) return null;
    try {
      const secret = await readExistingGatewaySecret(ownerId,generation);
      const after = await owner();
      if (!sameOwner(before,after) || marker(secret) ||
        secret?.source !== 'NATIVE_OWNER_SECRET_STORE' ||
        secret.owner_id !== ownerId || secret.owner_generation !== generation ||
        !/^[A-Za-z0-9_-]{32,256}$/.test(secret.api_key || '')) return null;
      // Consumed only by existing private in-process W67 binding; no public IPC.
      return Object.freeze({...secret,authority_effect:false});
    } catch { return null; }
  };
  const postgres = async (ownerId,epoch) => {
    if (!readExistingOwnPostgresBirth || closed) return null;
    const before = await owner();
    if (before?.owner_id !== ownerId || before?.epoch !== epoch) return null;
    try {
      const pg = await readExistingOwnPostgresBirth(ownerId,epoch);
      const after = await owner();
      if (!sameOwner(before,after) || marker(pg) ||
        pg?.schema !== 'metaengine.own-pg.birth-w61.v1' ||
        pg.source !== 'OWN_PG_POSTMASTER_READBACK' ||
        pg.owner_id !== ownerId || pg.owner_epoch !== epoch ||
        pg.owner_generation !== before.generation ||
        pg.owner_device_id !== before.device_id ||
        pg.owner_project_id !== before.project_id ||
        pg.owner_process_incarnation_id !== before.process_incarnation_id ||
        pg.source_sha?.toLowerCase() !== before.source_sha.toLowerCase()) return null;
      return Object.freeze({...pg,authority_effect:false});
    } catch { return null; }
  };
  const backup = async () => {
    if (!readExistingProtectedBackupRoot || closed) return null;
    const before = await owner();
    if (!before) return null;
    try {
      const result = await readExistingProtectedBackupRoot();
      const after = await owner();
      if (!sameOwner(before,after) || marker(result) ||
        result?.source !== 'PROTECTED_HOST_BACKUP_CUSTODY' ||
        result.owner_id !== before.owner_id ||
        result.owner_generation !== before.generation ||
        result.owner_epoch !== before.epoch ||
        result.owner_process_incarnation_id !== before.process_incarnation_id ||
        typeof result.physical_root !== 'string' ||
        result.physical_root.length < 4) return null;
      return Object.freeze({...result,authority_effect:false});
    } catch { return null; }
  };
  return Object.freeze({schema:W76_PRIVATE_CUSTODY_SCHEMA,
    readTrustedHostOwnerIncarnation:owner,
    readPrivateOwnerGatewayCredential:credential,
    readPrivateOwnPostgresBirth:postgres,
    readProtectedBackupRoot:backup,
    close(){closed=true;}});
}
