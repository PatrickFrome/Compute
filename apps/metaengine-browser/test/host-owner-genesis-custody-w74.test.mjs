import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostOwnerGenesisCustodyW74,W74_OWNER_SCOPE_SQL,W74_SCOPE_LOCK_SQL}
  from '../src/host-owner-genesis-custody-w74.mjs';

const device='11111111-1111-4111-8111-111111111111';
const client='22222222-2222-4222-8222-222222222222';
const project='33333333-3333-4333-8333-333333333333';
const sourceSha='a'.repeat(40);
const now=()=>new Date().toISOString();
function fixture() {
  const nativeCreated=new Date().toISOString();
  const birthTicks=(BigInt(Date.parse(nativeCreated))*10000n + 116444736000000000n).toString();
  let epoch=7, birth=`pid:9101:created_100ns:${birthTicks}`;
  let owner=null, writes=0, queries=[], rows=1, corrupt=false;
  const identity={
    ensure:async()=>{},snapshot:()=>({client_id:client,device_id:device,
      key_fingerprint_sha256:'b'.repeat(64),enrolled:true}),
  };
  const admin=()=>({device_id:device,client_id:client,admin_grant_epoch:epoch,
    admin_ready:true,access_tier:'ADMIN'});
  const guardian=()=>({schema:'metaengine.browser-guardian.machine-bootstrap-launcher.v1',
    state:'READY',guardian_client_pid:9101,
    guardian_client_created_at:new Date().toISOString(),
    guardian_client_process_incarnation_id:birth,owner_binding_proven:true,
    device_binding_proven:true,guardian_client_kernel_birth_verified:true,
    guardian_device_key_fingerprint_sha256:'b'.repeat(64),
    guardian_enrollment_evidence_sha256:'c'.repeat(64)});
  const g=guardian();
  g.guardian_client_created_at=nativeCreated;
  const kernel=()=>({pid:9101,created_at:nativeCreated,observed_at:now(),
    source:'OS_PROCESS_INVENTORY'});
  let native=()=>kernel(), signed=()=>({source:'INSTALLED_EXE_NATIVE_VERIFIER',
    source_sha:sourceSha,exact_bytes_verified:true,native_signature_verified:true,
    installed_exe_sha256:'d'.repeat(64),proof_identity:'e'.repeat(64),
    fixture_classification:'STAGING'});
  const transaction=async(fn, opts)=>{
    queries.push(opts);
    return fn({unsafe:async(sql,args)=>{
      if(sql===W74_SCOPE_LOCK_SQL) return [{}];
      assert.equal(sql,W74_OWNER_SCOPE_SQL);
      assert.deepEqual(args,[device,client,epoch]);
      return rows===1?[{project_id:project,device_id:device,client_id:client,
        admin_grant_epoch:epoch,observed_at:now()}]:[];
    }});
  };
  const opts={
    identity,transaction,readAuthenticatedAdmin:admin,
    readGuardian:async()=>({...g,guardian_client_process_incarnation_id:birth}),
    readSourceProof:async()=>signed(),
    readNativeKernel:async(pid)=>native(pid),
    readSealed:async()=>{if(corrupt)throw Error('sealed_corrupt');return owner;},
    writeSealed:async(record,previous)=>{
      assert.equal(previous,owner);owner=record;writes++;
    },
    staging:true,
  };
  return {
    opts, get writes(){return writes;}, get owner(){return owner;},
    get queries(){return queries;},
    driftEpoch(){epoch++}, driftProcess(){birth='pid:9102:created_100ns:134050012345678902'},
    revokeSource(){signed=()=>null}, markSourceInvalid(){signed=()=>({source_sha:sourceSha})},
    dropRows(){rows=0}, corrupt(){corrupt=true},
    replaceKernel(f){native=f}, setGuardian(f){opts.readGuardian=f},
    setIdentity(f){opts.identity=f},
  };
}
test('W74 uses fixed own-PG project/epoch+advisory CAS and sealed STAGING genesis (never installed)',async()=>{
  const f=fixture(), bound=createHostOwnerGenesisCustodyW74(f.opts);
  const first=await bound.create();
  assert.equal(first?.fixture_classification,'STAGING');
  assert.equal(first?.generation,1);
  assert.equal(first?.project_id,project);
  assert.equal(first?.source_sha,sourceSha);
  assert.equal(f.writes,1);
  assert.deepEqual(f.queries[0],{readOnly:false,isolationLevel:'serializable'});
  assert.equal(await bound.read(),null,'a staging record cannot become trusted installed readback');
  assert.equal((await bound.create())?.generation,1,'identical incarnation is idempotent');
  assert.equal(f.writes,1);
  bound.close();
  assert.equal(await bound.create(),null);
  assert.equal(await bound.read(),null);
});
test('W74 refuses missing signer, wrong source shape, missing SQL scope and corrupt protected custody',async()=>{
  const missing=fixture();missing.revokeSource();
  assert.equal(await createHostOwnerGenesisCustodyW74(missing.opts).create(),null);
  const shape=fixture();shape.markSourceInvalid();
  assert.equal(await createHostOwnerGenesisCustodyW74(shape.opts).create(),null);
  const sql=fixture();sql.dropRows();
  assert.equal(await createHostOwnerGenesisCustodyW74(sql.opts).create(),null);
  const corrupt=fixture();corrupt.corrupt();
  assert.equal(await createHostOwnerGenesisCustodyW74(corrupt.opts).create(),null);
});
test('W74 denies Guardian PID/100ns birth drift, wrong device, lost epoch and unverified old process',async()=>{
  const bad=fixture();bad.setGuardian(async()=>({...bad.opts.identity.snapshot(),
    schema:'metaengine.browser-guardian.machine-bootstrap-launcher.v1',
    state:'READY',guardian_client_pid:9101,
    guardian_client_created_at:now(),guardian_client_process_incarnation_id:'pid:9101:created_100ns:0',
    owner_binding_proven:true,device_binding_proven:true,guardian_client_kernel_birth_verified:true,
    guardian_device_key_fingerprint_sha256:'b'.repeat(64),
    guardian_enrollment_evidence_sha256:'c'.repeat(64)}));
  assert.equal(await createHostOwnerGenesisCustodyW74(bad.opts).create(),null);
  const f=fixture();const b=createHostOwnerGenesisCustodyW74(f.opts);
  assert.equal((await b.create())?.generation,1);
  f.driftEpoch();assert.equal(await b.read(),null);
  assert.equal((await b.create())?.generation,2);
  f.driftProcess();assert.equal(await b.create(),null,'native birth mismatch blocks process takeover');
});
test('W74 rejects client-side self attestation and never uses constructor project text',async()=>{
  const f=fixture();
  f.setIdentity({ensure:async()=>{},snapshot:()=>({client_id:client,device_id:'fake-device',
    enrolled:true,key_fingerprint_sha256:'b'.repeat(64)})});
  const b=createHostOwnerGenesisCustodyW74({...f.opts,project_id:project,
    verified:true,authority_effect:true});
  assert.equal(await b.create(),null);
  assert.equal(f.writes,0);
});
