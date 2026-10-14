// Read-only trusted Owner/Guardian adapter. Only in-process Owner code installs it.
// Never use model, HTTP, page, pidfile or socket claims as OS/Guardian evidence.
import { evaluateGuardianHeartbeatFence } from '../../apps/metaengine-browser/src/browser-guardian-heartbeat-fence.mjs';
import { OPERATOR_HOST_EVIDENCE_SCHEMA, OPERATOR_HOST_SOURCE } from './operator-host-incarnation-core.mjs';

export const HOST_OWNER_SCHEMA = 'metaengine.host.owner-incarnation.v1';
export const HOST_GUARDIAN_HEALTH_SCHEMA = 'metaengine.guardian.host-health.v1';
const obj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const pid = x => Number.isSafeInteger(x) && x > 0 && x <= 0x7fffffff;
const id = x => typeof x === 'string' && /^[a-zA-Z0-9_.:-]{8,128}$/.test(x);
const iso = x => typeof x === 'string' && Number.isFinite(Date.parse(x)) ? new Date(x).toISOString() : null;
const equalBirth = (a,b) => a?.pid === b?.pid && iso(a?.created_at) != null && iso(a.created_at) === iso(b?.created_at);
const bound = (x,o) => x.owner_id === o.owner_id && x.device_id === o.device_id && x.owner_generation === o.generation;

// Every reader is a Host-owned read-only callback; none may be supplied by an HTTP
// request. Missing callbacks or readbacks keep Host UNKNOWN. In particular,
// readOsProcess MUST return kernel PID + creation-time inventory.
export function createTrustedHostObservationReadback({readOwner,readGuardianStatus,readGuardianHealth,readOsProcess,now=()=>Date.now()}={}) {
  if ([readOwner,readGuardianStatus,readGuardianHealth,readOsProcess,now].some(f=>typeof f!=='function'))
    throw new TypeError('trusted_host_readers_required');
  return async () => {
    try {
      const owner = await readOwner();
      if (owner == null) return null;
      if (!obj(owner) || owner.schema !== HOST_OWNER_SCHEMA || owner.source !== 'LOCAL_HOST_OWNER'
          || owner.authority_effect !== false || !id(owner.owner_id) || !id(owner.device_id)
          || !pid(owner.pid) || !id(owner.process_incarnation_id)
          || !Number.isSafeInteger(owner.generation) || owner.generation < 1
          || !iso(owner.created_at) || !iso(owner.observed_at)) return null;
      const guardian = await readGuardianStatus();
      const health = await readGuardianHealth();
      if (!obj(guardian) || !obj(health) || guardian.schema !== 'metaengine.browser-guardian.machine-bootstrap-launcher.v1'
          || guardian.authority_effect !== false || guardian.automatic_retry_allowed !== false
          || !bound(guardian,owner) || guardian.owner_pid !== owner.pid
          || guardian.owner_process_incarnation_id !== owner.process_incarnation_id
          || iso(guardian.owner_created_at) !== iso(owner.created_at) || !iso(guardian.observed_at)
          || health.schema !== HOST_GUARDIAN_HEALTH_SCHEMA || health.source !== 'GUARDIAN_NATIVE_READBACK'
          || health.authority_effect !== false || !bound(health,owner) || !iso(health.observed_at)) return null;
      const child=health.child;
      if (!obj(child) || !pid(child.pid) || child.pid === owner.pid
          || !id(child.process_incarnation_id) || !iso(child.created_at)) return null;
      if (!obj(health.sequence_fence) || ['startup','liveness','readiness','progress'].some(k=>
          !Object.hasOwn(health.sequence_fence,k) || !Number.isSafeInteger(health.sequence_fence[k])
          || health.sequence_fence[k]<0)) return null;
      const stamp=now();
      if (!Number.isSafeInteger(stamp) || stamp < 0) return null;
      const heartbeat=evaluateGuardianHeartbeatFence({child,release:health.release,
        heartbeats:health.heartbeats,sequence_fence:health.sequence_fence,now_ms:stamp});
      if (!heartbeat.valid || heartbeat.authority_effect!==false) return null;
      const inventory=async claimed=>{
        const v=await readOsProcess(claimed.pid);
        if (!obj(v) || v.source!=='OS_PROCESS_INVENTORY' || v.authority_effect!==false
            || !pid(v.pid) || !iso(v.created_at) || !iso(v.observed_at)
            || !['PRESENT','ABSENT','UNKNOWN'].includes(v.state)) return null;
        // OS attests PID/birth; incarnation is separately bound by Guardian.
        return {source:'OS_PROCESS_INVENTORY',pid:v.pid,created_at:v.created_at,
          observed_at:v.observed_at,state:v.state,process_incarnation_id:claimed.process_incarnation_id};
      };
      const a=await inventory(owner),b=await inventory(child);
      const c=await inventory(owner),d=await inventory(child);
      if (!a || !b || !c || !d) return null;
      // A PID/birth match does not make two contradictory presence samples
      // interchangeable. In particular ABSENT -> PRESENT must not discard
      // the first absence and manufacture a live, qualified Host Owner.
      if (a.state !== c.state || b.state !== d.state) return null;
      // Preserve the first conflicting OS sample; core marks PID reuse AMBIGUOUS.
      return {schema:OPERATOR_HOST_EVIDENCE_SCHEMA,source:OPERATOR_HOST_SOURCE,
        authority_effect:false,observed_at:new Date(now()).toISOString(),
        owner,browser:{pid:child.pid,created_at:child.created_at,process_incarnation_id:child.process_incarnation_id},
        guardian,guardian_health_observed_at:health.observed_at,
        owner_runtime_probe:equalBirth(a,owner)?c:a,
        runtime_probe:equalBirth(b,child)?d:b,heartbeat_fence:heartbeat};
    } catch { return null; } // OS/Guardian errors are UNKNOWN, never inferred READY.
  };
}
