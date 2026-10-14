import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrustedHostObservationReadback, HOST_OWNER_SCHEMA, HOST_GUARDIAN_HEALTH_SCHEMA } from './operator-trusted-host-readback.mjs';
import { reduceHostProcessObservation } from './operator-host-incarnation-core.mjs';

const NOW=Date.parse('2026-10-13T00:00:00Z');
const at=d=>new Date(NOW+d).toISOString();
const OWNER=()=>({schema:HOST_OWNER_SCHEMA,source:'LOCAL_HOST_OWNER',authority_effect:false,
  owner_id:'owner-identity-123',device_id:'device-identity-456',generation:3,
  pid:9001,created_at:at(-30000),process_incarnation_id:'owner-process-123',
  observed_at:at(-200)});
const GUARDIAN=()=>({schema:'metaengine.browser-guardian.machine-bootstrap-launcher.v1',
  state:'READY',ready:true,guardian_service_ready:true,
  owner_binding_proven:true,device_binding_proven:true,stale:false,
  automatic_retry_allowed:false,authority_effect:false,
  owner_id:'owner-identity-123',device_id:'device-identity-456',owner_generation:3,
  owner_pid:9001,owner_created_at:at(-30000),owner_process_incarnation_id:'owner-process-123',
  observed_at:at(-180)});
const RELEASE={release_id:'dev-release-v1',artifact_sha256:'a'.repeat(64)};
const HEALTH=()=>({schema:HOST_GUARDIAN_HEALTH_SCHEMA,source:'GUARDIAN_NATIVE_READBACK',
  authority_effect:false,observed_at:at(-160),
  owner_id:'owner-identity-123',device_id:'device-identity-456',owner_generation:3,
  child:{pid:4554,created_at:at(-15000),process_incarnation_id:'browser-process-456'},
  release:RELEASE,sequence_fence:{startup:4,liveness:4,readiness:4,progress:4},
  heartbeats:Object.fromEntries(['startup','liveness','readiness','progress'].map(k=>
    [k,{pid:4554,process_incarnation_id:'browser-process-456',release_id:RELEASE.release_id,
      artifact_sha256:RELEASE.artifact_sha256,sequence:5,observed_at_ms:NOW-100}]))});
const OS=pid=>({source:'OS_PROCESS_INVENTORY',authority_effect:false,
  pid,created_at:pid===9001?at(-30000):at(-15000),observed_at:at(-80),state:'PRESENT'});
async function view(input={}){
  const reader=createTrustedHostObservationReadback({
    readOwner:input.readOwner ?? (async () => OWNER()),
    readGuardianStatus:input.readGuardianStatus ?? (async () => GUARDIAN()),
    readGuardianHealth:input.readGuardianHealth ?? (async () => HEALTH()),
    readOsProcess:input.readOsProcess ?? (async pid => OS(pid)),now:()=>NOW});
  return reduceHostProcessObservation(await reader(),{nowMs:NOW,maxAgeMs:30000});
}
test('independent owner/child kernel birth and split heartbeat yields AVAILABLE, not READY',async()=>{
  const v=await view();assert.equal(v.state,'AVAILABLE');assert.equal(v.details.owner_pid,9001);
  assert.equal(v.details.browser_pid,4554);assert.equal(v.details.product_readiness_proven,false);
});
test('absent Owner, Guardian, health or kernel evidence means UNKNOWN',async()=>{
  for(const key of ['readOwner','readGuardianStatus','readGuardianHealth','readOsProcess']){
    assert.equal((await view({[key]:async()=>null})).state,'UNKNOWN',key);
  }
});
test('refuses missing callbacks',()=>assert.throws(()=>createTrustedHostObservationReadback({}),/trusted_host_readers_required/));
test('PID reuse with same owner PID but different OS creation time is AMBIGUOUS',async()=>{
  const v=await view({readOsProcess:async pid=>({...OS(pid),created_at:pid===9001?at(-2000):at(-15000)})});
  assert.equal(v.state,'AMBIGUOUS');
});
test('child PID reuse with Guardian READY is AMBIGUOUS',async()=>{
  const v=await view({readOsProcess:async pid=>({...OS(pid),created_at:pid===4554?at(-2000):at(-30000)})});
  assert.equal(v.state,'AMBIGUOUS');
});
test('recycle between OS sampling passes cannot pass',async()=>{
  let count=0;const v=await view({readOsProcess:async pid=>{count++;return {...OS(pid),created_at:count===1?at(-400):OS(pid).created_at};}});
  assert.equal(v.state,'AMBIGUOUS');
});
test('mismatched owner epoch/device and Guardian unbound fail closed',async()=>{
  assert.equal((await view({readGuardianStatus:async()=>({...GUARDIAN(),owner_generation:4})})).state,'UNKNOWN');
  assert.equal((await view({readGuardianStatus:async()=>({...GUARDIAN(),ready:false,owner_binding_proven:false})})).state,'BLOCKED');
});
test('wrong incarnation, missing channel, sequence regression cannot pass',async()=>{
  for(const mutate of [
    h=>{h.heartbeats.progress.process_incarnation_id='other-process';},
    h=>{delete h.heartbeats.startup;},
    h=>{h.heartbeats.liveness.sequence=3;}
  ]){const h=HEALTH();mutate(h);assert.equal((await view({readGuardianHealth:async()=>h})).state,'UNKNOWN');}
});
test('stale Guardian and heartbeat cannot yield AVAILABLE',async()=>{
  assert.equal((await view({readGuardianStatus:async()=>({...GUARDIAN(),observed_at:at(-12000)})})).state,'STALE');
  const h=HEALTH();h.heartbeats.progress.observed_at_ms=NOW-12000;
  assert.equal((await view({readGuardianHealth:async()=>h})).state,'STALE');
});
test('only public fields survive; never leak token, path, owner or raw incarnation',async()=>{
  const o=OWNER();o.token='NEVER_EXPOSE_THIS';o.command_line='NEVER_EXPOSE_THIS';
  const v=await view({readOwner:async()=>o});const output=JSON.stringify(v);
  for(const value of ['NEVER_EXPOSE_THIS',o.owner_id,o.device_id,o.process_incarnation_id,'browser-process-456'])
    assert.equal(output.includes(value),false);
});
test('no other probes on absent owner',async()=>{
  let calls=0;const v=await view({readOwner:async()=>null,readGuardianStatus:async()=>{calls++;return GUARDIAN();},
    readGuardianHealth:async()=>{calls++;return HEALTH();},readOsProcess:async pid=>{calls++;return OS(pid);}});
  assert.equal(v.state,'UNKNOWN');assert.equal(calls,0);
});

test('second OS birth sample mismatch is fenced, not silently dropped',async()=>{
  let n=0;const v=await view({readOsProcess:async pid=>{
    n++;return {...OS(pid),created_at:n===3?at(-400):OS(pid).created_at};
  }});
  assert.equal(v.state,'AMBIGUOUS');
});
test('stale Guardian health readback cannot borrow fresh heartbeat',async()=>{
  const h=HEALTH();h.observed_at=at(-12000);
  assert.equal((await view({readGuardianHealth:async()=>h})).state,'STALE');
});

test('contradictory OS presence passes fail closed instead of borrowing a PRESENT sample',async()=>{
  for(const selected of [9001,4554]){
    for(const direction of ['ABSENT_TO_PRESENT','PRESENT_TO_ABSENT']){
      let calls=0;
      const v=await view({readOsProcess:async pid=>{
        if(pid===selected)calls++;
        return {...OS(pid),state:pid!==selected?'PRESENT':
          direction==='ABSENT_TO_PRESENT'
            ? (calls===1?'ABSENT':'PRESENT')
            : (calls===1?'PRESENT':'ABSENT')};
      }});
      assert.equal(v.state,'UNKNOWN',selected+':'+direction);
    }
  }
});
