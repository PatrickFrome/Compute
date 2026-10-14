// W27: advisory stale Host Owner recovery, with native process-birth evidence.
// This is read-only and may be called only with Host-owned in-process readers.
// It is NOT a restart, a lease release, a task executor or a new scheduler.
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

export const OWNER_GUARDIAN_RECOVERY_SCHEMA = 'metaengine.operator.owner-guardian-recovery.v1';
const OWNER_SCHEMA = 'metaengine.host.owner-incarnation.v1';
const GUARDIAN_SCHEMA = 'metaengine.browser-guardian.machine-bootstrap-launcher.v1';
const FRESH_MS = 10_000;
const MAX_SKEW_MS = 5_000;
const MIN_PROBE_GAP_MS = 1;
const MAX_PROBE_GAP_MS = 2_000;
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const pid = n => Number.isSafeInteger(n) && n > 0 && n <= 0x7fffffff;
const id = x => typeof x === 'string' && /^[A-Za-z0-9_.:-]{8,128}$/.test(x);
const instant = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(x) && Number.isFinite(Date.parse(x))
  ? Date.parse(x) : null;
const sameBirth = (a,b) => a.pid === b.pid && instant(a.created_at) === instant(b.created_at);
const sameOwner = (a,b) => sameBirth(a,b) && a.owner_id === b.owner_id
  && a.device_id === b.device_id && a.generation === b.generation
  && a.process_incarnation_id === b.process_incarnation_id;
const boundedTime = (t,now) => t !== null && t <= now + MAX_SKEW_MS && t > 0;
const snapshot = (state, reason, other = {}) => Object.freeze({
  schema: OWNER_GUARDIAN_RECOVERY_SCHEMA, source: 'OWNER_GUARDIAN_PROVENANCE_REDUCER',
  // Shape-checked readbacks are not cryptographic attestation. The trusted
  // native caller must recheck kernel truth and its generation CAS independently.
  native_attestation_verified: false,
  state, reason, authority_effect: false, automatic_retry_allowed: false,
  restart_authorized: false, lease_release_authorized: false,
  task_effect_replayed: false, ...other,
});

// A returned RECONCILIATION_REQUIRED is a *candidate* only. The existing
// Supervisor/Guardian must re-read the kernel birth, compare owner generation
// and claim its own CAS/lease before any physical recovery is considered.
export function assessStaleHostOwnerRecovery({ ownerBefore, ownerAfter, guardianBefore,
  guardianAfter, osBefore, osAfter, nowMs } = {}) {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) return snapshot('UNKNOWN','CLOCK_UNKNOWN');
  if (![ownerBefore,ownerAfter,guardianBefore,guardianAfter,osBefore,osAfter].every(record))
    return snapshot('UNKNOWN','READBACK_MISSING');
  const ownerShape = o => o.schema === OWNER_SCHEMA && o.source === 'LOCAL_HOST_OWNER'
    && o.authority_effect === false && id(o.owner_id) && id(o.device_id)
    && id(o.process_incarnation_id) && pid(o.pid)
    && Number.isSafeInteger(o.generation) && o.generation >= 1
    && boundedTime(instant(o.created_at),nowMs)
    && boundedTime(instant(o.observed_at),nowMs)
    && instant(o.observed_at) >= instant(o.created_at);
  if (!ownerShape(ownerBefore) || !ownerShape(ownerAfter))
    return snapshot('UNKNOWN','OWNER_PROVENANCE_INVALID');
  if (!sameOwner(ownerBefore,ownerAfter))
    return snapshot('AMBIGUOUS','OWNER_GENERATION_OR_BIRTH_CHANGED');
  const guardianShape = g => g.schema === GUARDIAN_SCHEMA
    && g.authority_effect === false && g.automatic_retry_allowed === false
    && g.owner_binding_proven === true && g.device_binding_proven === true
    && g.owner_id === ownerBefore.owner_id && g.device_id === ownerBefore.device_id
    && g.owner_generation === ownerBefore.generation && g.owner_pid === ownerBefore.pid
    && g.owner_process_incarnation_id === ownerBefore.process_incarnation_id
    && instant(g.owner_created_at) === instant(ownerBefore.created_at)
    && boundedTime(instant(g.observed_at),nowMs);
  if (!guardianShape(guardianBefore) || !guardianShape(guardianAfter))
    return snapshot('AMBIGUOUS','GUARDIAN_OWNER_BINDING_UNVERIFIED');
  const probeShape = p => p.source === 'OS_PROCESS_INVENTORY' && p.authority_effect === false
    && pid(p.pid) && p.pid === ownerBefore.pid
    && ['PRESENT','ABSENT','UNKNOWN'].includes(p.state)
    && boundedTime(instant(p.observed_at),nowMs) && nowMs - instant(p.observed_at) <= FRESH_MS;
  if (!probeShape(osBefore) || !probeShape(osAfter))
    return snapshot('UNKNOWN','KERNEL_READBACK_INVALID');
  const gap = instant(osAfter.observed_at) - instant(osBefore.observed_at);
  if (gap < MIN_PROBE_GAP_MS || gap > MAX_PROBE_GAP_MS)
    return snapshot('UNKNOWN','PROBE_ORDER_OR_SPACING_INVALID');
  // If any probe sees a process with the selected PID but a different birth,
  // a process was reused. Absence samples have no kernel birth to invent.
  for (const p of [osBefore,osAfter]) {
    if (p.state === 'PRESENT' && (instant(p.created_at) === null || !sameBirth(p,ownerBefore)))
      return snapshot('AMBIGUOUS','PID_REUSED');
    if (p.state === 'ABSENT' && p.created_at != null)
      return snapshot('UNKNOWN','ABSENCE_CANNOT_ATTEST_BIRTH');
  }
  if (osBefore.state === 'UNKNOWN' || osAfter.state === 'UNKNOWN')
    return snapshot('UNKNOWN','PROCESS_PRESENCE_UNKNOWN');
  if (osBefore.state !== osAfter.state)
    return snapshot('AMBIGUOUS','PROCESS_TRANSITION_DURING_READBACK');
  const fingerprint = createHash('sha256').update(JSON.stringify([
    ownerBefore.owner_id, ownerBefore.device_id, ownerBefore.generation,
    ownerBefore.pid, instant(ownerBefore.created_at), ownerBefore.process_incarnation_id,
  ])).digest('hex');
  if (osAfter.state === 'PRESENT')
    return snapshot('OWNER_PRESENT','EXACT_PID_AND_KERNEL_BIRTH', {owner_fingerprint_sha256:fingerprint});
  // Two absent OS observations alone are not sufficient: the pinned Owner
  // record and independent Guardian status must both be stale, with no new epoch.
  const ownerStale = [ownerBefore,ownerAfter].every(o=>nowMs-instant(o.observed_at)>FRESH_MS);
  const guardianStale = [guardianBefore,guardianAfter].every(g=>
    g.stale === true && nowMs-instant(g.observed_at)>FRESH_MS);
  if (!ownerStale || !guardianStale)
    return snapshot('AMBIGUOUS','ABSENCE_WITHOUT_STALE_OWNER_AND_GUARDIAN');
  return snapshot('RECONCILIATION_REQUIRED','EXACT_STALE_OWNER_AND_DOUBLE_OS_ABSENCE',{
    owner_fingerprint_sha256:fingerprint,
    next_step:'EXISTING_SUPERVISOR_NATIVE_RECHECK_AND_GENERATION_CAS',
  });
}

// No caller-supplied PID, path, SQL, IPC method, shell or cloud URL. Exceptions,
// absent proof, races and timeouts remain UNKNOWN; no recovery effects occur.
export function createStaleOwnerRecoveryReadback({readOwner,readGuardianStatus,readOsProcess,
  now=()=>Date.now(),pause=()=>sleep(120)} = {}) {
  if ([readOwner,readGuardianStatus,readOsProcess,now,pause].some(x=>typeof x !== 'function'))
    throw new TypeError('trusted_native_owner_recovery_readers_required');
  return async () => {
    try {
      const ownerBefore=await readOwner();
      if (!record(ownerBefore) || !pid(ownerBefore.pid))
        return snapshot('UNKNOWN','READBACK_MISSING');
      const guardianBefore=await readGuardianStatus();
      const osBefore=await readOsProcess(ownerBefore.pid);
      await pause();
      const osAfter=await readOsProcess(ownerBefore.pid);
      const guardianAfter=await readGuardianStatus();
      const ownerAfter=await readOwner();
      return assessStaleHostOwnerRecovery({ownerBefore,ownerAfter,guardianBefore,guardianAfter,
        osBefore,osAfter,nowMs:now()});
    } catch {
      return snapshot('UNKNOWN','NATIVE_READBACK_FAILED');
    }
  };
}
