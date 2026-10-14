import assert from 'node:assert/strict';
import test from 'node:test';
import {assessStaleHostOwnerRecovery,createStaleOwnerRecoveryReadback,
  OWNER_GUARDIAN_RECOVERY_SCHEMA} from './operator-owner-guardian-recovery-w27.mjs';

const NOW=Date.parse('2026-10-14T19:00:00Z');
const at=d=>new Date(NOW+d).toISOString();
const OWNER=()=>({schema:'metaengine.host.owner-incarnation.v1',source:'LOCAL_HOST_OWNER',
  authority_effect:false,owner_id:'owner-native-123',device_id:'device-native-123',
  generation:7,pid:4505,created_at:at(-120000),
  process_incarnation_id:'native-owner-inc-123',observed_at:at(-20000)});
const GUARDIAN=()=>({schema:'metaengine.browser-guardian.machine-bootstrap-launcher.v1',
  authority_effect:false,automatic_retry_allowed:false,
  owner_binding_proven:true,device_binding_proven:true,
  owner_id:'owner-native-123',device_id:'device-native-123',
  owner_generation:7,owner_pid:4505,owner_process_incarnation_id:'native-owner-inc-123',
  owner_created_at:at(-120000),stale:true,observed_at:at(-20000)});
const OS=(state,delta)=>({source:'OS_PROCESS_INVENTORY',authority_effect:false,
  pid:4505,created_at:state==='PRESENT'?at(-120000):null,observed_at:at(delta),state});
const E=()=>({ownerBefore:OWNER(),ownerAfter:OWNER(),guardianBefore:GUARDIAN(),
  guardianAfter:GUARDIAN(),osBefore:OS('ABSENT',-300),osAfter:OS('ABSENT',-100),nowMs:NOW});
const check = input => assessStaleHostOwnerRecovery(input);

test('double kernel absence and stale matching native Owner/Guardian yields only an advisory CAS candidate',()=>{
  const r=check(E());
  assert.equal(r.schema,OWNER_GUARDIAN_RECOVERY_SCHEMA);
  assert.equal(r.state,'RECONCILIATION_REQUIRED');
  assert.equal(r.native_attestation_verified,false);
  assert.equal(r.source,'OWNER_GUARDIAN_PROVENANCE_REDUCER');
  assert.equal(r.next_step,'EXISTING_SUPERVISOR_NATIVE_RECHECK_AND_GENERATION_CAS');
  assert.match(r.owner_fingerprint_sha256,/^[a-f0-9]{64}$/);
  for(const flag of ['authority_effect','automatic_retry_allowed','restart_authorized',
    'lease_release_authorized','task_effect_replayed']) assert.equal(r[flag],false);
});
test('live exact kernel creation time cannot be mistaken for stale recovery',()=>{
  const e=E();e.osBefore=OS('PRESENT',-300);e.osAfter=OS('PRESENT',-100);
  assert.equal(check(e).state,'OWNER_PRESENT');
  assert.equal(check(e).restart_authorized,false);
});
test('absent or unsupported readback is UNKNOWN and has no positive effect claims',()=>{
  for(const key of ['ownerBefore','ownerAfter','guardianBefore','guardianAfter','osBefore','osAfter']){
    const e=E();e[key]=null;assert.equal(check(e).state,'UNKNOWN',key);
  }
  const e=E();e.osAfter.state='UNKNOWN';assert.equal(check(e).state,'UNKNOWN');
});
test('PID recycling in first or second sample is AMBIGUOUS even with stale Guardian',()=>{
  for(const key of ['osBefore','osAfter']){
    const e=E();e[key]=OS('PRESENT',key==='osBefore'?-300:-100);
    e[key].created_at=at(-1500);
    assert.equal(check(e).state,'AMBIGUOUS',key);
  }
});
test('a present to absent or absent to present transition is never recovery',()=>{
  for(const [first,second] of [['PRESENT','ABSENT'],['ABSENT','PRESENT']]){
    const e=E();e.osBefore=OS(first,-300);e.osAfter=OS(second,-100);
    assert.equal(check(e).state,'AMBIGUOUS');
  }
});
test('changing Owner generation, device, PID, birth or incarnation blocks recovery',()=>{
  for(const field of ['generation','device_id','pid','created_at','process_incarnation_id']){
    const e=E();
    e.ownerAfter[field]=field==='generation'?8:field==='pid'?4506:field==='created_at'?at(-140000):'replaced-incarnation-333';
    assert.equal(check(e).state,'AMBIGUOUS',field);
  }
});
test('Guardian owner pin drift in either sample blocks recovery',()=>{
  for(const field of ['owner_generation','owner_pid','owner_process_incarnation_id','owner_created_at','device_id']){
    for(const sample of ['guardianBefore','guardianAfter']){
      const e=E();e[sample][field]=field==='owner_generation'?8:field==='owner_pid'?9999:
        field==='owner_created_at'?at(-100000):'mismatched-native-id';
      assert.equal(check(e).state,'AMBIGUOUS',sample+field);
    }
  }
});
test('recent Owner or Guardian status cannot be called stale on OS absence',()=>{
  const a=E();a.ownerAfter.observed_at=at(-100);
  assert.equal(check(a).state,'AMBIGUOUS');
  const b=E();b.guardianBefore.observed_at=at(-100);
  assert.equal(check(b).state,'AMBIGUOUS');
  const c=E();c.guardianAfter.stale=false;
  assert.equal(check(c).state,'AMBIGUOUS');
});
test('missing kernel provenance, future, reordered, stale and same-time probes fail closed',()=>{
  for(const change of [
    e=>{e.osBefore.authority_effect=true;},
    e=>{e.osAfter.source='OWNER_FILE';},
    e=>{e.osAfter.observed_at=at(6000);},
    e=>{e.osAfter.observed_at=at(-11000);},
    e=>{e.osAfter.observed_at=at(-301);},
    e=>{e.osAfter.observed_at=at(-300);},
    e=>{e.osAfter.observed_at=at(-3200);},
    e=>{e.osAfter.created_at=at(-120000);},
  ]) {const e=E();change(e);assert.equal(check(e).state,'UNKNOWN');}
});
test('observation never exports Owner secrets, IDs or raw process incarnation',()=>{
  const e=E();e.ownerBefore.private_token='secret-data-never-export';
  e.guardianBefore.command_line='secret-data-never-export';
  const result=JSON.stringify(check(e));
  for(const token of ['secret-data-never-export','owner-native-123','device-native-123',
    'native-owner-inc-123'])assert.equal(result.includes(token),false);
});
test('factory samples pinned Owner + Guardian twice and cannot select an arbitrary PID',async()=>{
  const log=[], owners=[OWNER(),OWNER()], guardians=[GUARDIAN(),GUARDIAN()];
  const r=createStaleOwnerRecoveryReadback({
    readOwner:async()=>{log.push('owner');return owners.shift();},
    readGuardianStatus:async()=>{log.push('guardian');return guardians.shift();},
    readOsProcess:async p=>{assert.equal(p,4505);log.push('os');return OS('ABSENT',log.filter(x=>x==='os').length===1?-300:-100);},
    pause:async()=>log.push('pause'),now:()=>NOW,
  });
  assert.equal((await r()).state,'RECONCILIATION_REQUIRED');
  assert.deepEqual(log,['owner','guardian','os','pause','os','guardian','owner']);
});
test('factory errors and missing Owner never trigger a physical effect or later read',async()=>{
  let other=0;
  const r=createStaleOwnerRecoveryReadback({readOwner:async()=>null,
    readGuardianStatus:async()=>{other++;return GUARDIAN();},
    readOsProcess:async()=>{other++;return OS('ABSENT',-300);}});
  assert.equal((await r()).state,'UNKNOWN');assert.equal(other,0);
  const bad=createStaleOwnerRecoveryReadback({readOwner:async()=>OWNER(),
    readGuardianStatus:async()=>GUARDIAN(),readOsProcess:async()=>{throw Error('private');}});
  assert.equal((await bad()).reason,'NATIVE_READBACK_FAILED');
  assert.throws(()=>createStaleOwnerRecoveryReadback({}),/trusted_native_owner_recovery_readers_required/);
});
