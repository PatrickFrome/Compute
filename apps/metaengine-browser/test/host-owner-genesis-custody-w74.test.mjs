import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostOwnerGenesisCustodyW74,W74_OWNER_SCOPE_SQL,W74_OWNER_SCOPE_READ_SQL,W74_SCOPE_LOCK_SQL}
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
    guardian_client_kernel_birth_rechecked:true,
    guardian_device_key_fingerprint_sha256:'b'.repeat(64),
    guardian_enrollment_evidence_sha256:'c'.repeat(64)});
  const g=guardian();
  g.guardian_client_created_at=nativeCreated;
  const kernel=()=>({pid:9101,created_at:nativeCreated,observed_at:now(),
    source:'OS_PROCESS_INVENTORY'});
  let guardianOverride=null;
  let native=()=>kernel(), signed=()=>({source:'INSTALLED_EXE_NATIVE_VERIFIER',
    source_sha:sourceSha,exact_bytes_verified:true,native_signature_verified:true,
    installed_exe_sha256:'d'.repeat(64),proof_identity:'e'.repeat(64),
    release_root_signature_verified:true,slsa_evidence_digest_bound:true,
    package_code_verified:true,package_code_sha256:'f'.repeat(64),
    observed_at:now(),authority_effect:false,fixture_classification:'STAGING'});
  const transaction=async(fn, opts)=>{
    queries.push(opts);
    return fn({unsafe:async(sql,args)=>{
      if(sql===W74_SCOPE_LOCK_SQL) return [{}];
      assert.equal(sql,opts.readOnly ? W74_OWNER_SCOPE_READ_SQL : W74_OWNER_SCOPE_SQL);
      assert.deepEqual(args,[device,client,epoch]);
      return rows===1?[{project_id:project,device_id:device,client_id:client,
        admin_grant_epoch:String(epoch),observed_at:now()}]:[];
    }});
  };
  const opts={
    identity,transaction,readAuthenticatedAdmin:admin,
    readGuardian:async()=>guardianOverride ? guardianOverride() :
      {...g,guardian_client_process_incarnation_id:birth},
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
    dropPackageCode(){const prior=signed;signed=()=>({...prior(),package_code_verified:undefined,package_code_sha256:undefined})},
    dropRows(){rows=0}, corrupt(){corrupt=true}, replaceOwner(record){owner=record},
    replaceKernel(f){native=f}, setGuardian(f){guardianOverride=f},
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
  const legacy=fixture();legacy.dropPackageCode();
  assert.equal(await createHostOwnerGenesisCustodyW74(legacy.opts).create(),null);
  assert.equal(legacy.writes,0,'EXE-only proof cannot establish package-code authority');
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
  const absentPostcheck=fixture();
  const readNative=await absentPostcheck.opts.readGuardian();
  let absentSightings=0;
  absentPostcheck.setGuardian(async()=>{absentSightings++;return {...readNative,guardian_client_kernel_birth_rechecked:false};});
  assert.equal(await createHostOwnerGenesisCustodyW74(absentPostcheck.opts).create(),null,
    'W75 independent native kernel-birth postcheck must be mandatory');
  assert.equal(absentSightings,2,'both observations are read without recursive fixture calls');
  const contradictoryPostcheck=fixture();
  let sightings=0;const firstPostcheck=await contradictoryPostcheck.opts.readGuardian();
  contradictoryPostcheck.setGuardian(async()=>({...firstPostcheck,
    guardian_client_kernel_birth_rechecked:++sightings===1}));
  assert.equal(await createHostOwnerGenesisCustodyW74(contradictoryPostcheck.opts).create(),null,
    'two guardian observations must agree on native postcheck');
  assert.equal(sightings,2);
  const f=fixture();const b=createHostOwnerGenesisCustodyW74(f.opts);
  assert.equal((await b.create())?.generation,1);
  f.driftEpoch();assert.equal(await b.read(),null);
  assert.equal((await b.create())?.generation,2);
  f.driftProcess();assert.equal(await b.create(),null,'native birth mismatch blocks process takeover');
});
test('W74 never relabels protected STAGING or forged cached source into Owner',async()=>{
  const fixtureOwner=fixture(), runtime=createHostOwnerGenesisCustodyW74(fixtureOwner.opts);
  assert.equal((await runtime.create())?.generation,1);
  const original=fixtureOwner.owner;
  fixtureOwner.replaceOwner({...original,source:'PAGE_SELF_SIGNED'});
  assert.equal(await runtime.create(),null,'protected source must stay canonical');
  fixtureOwner.replaceOwner({...original,fixture_classification:'INSTALLED'});
  assert.equal(await runtime.create(),null,'generated proof cannot relabel itself installed');
  fixtureOwner.replaceOwner({...original,authority_effect:true});
  assert.equal(await runtime.create(),null,'privilege-bearing cached record denied');
  assert.equal(fixtureOwner.writes,1);
});
test('W74 second native observation cannot lose binding or acquire an untrusted marker',async()=>{
  for(const patch of [
    {owner_binding_proven:false},{device_binding_proven:false},
    {guardian_client_kernel_birth_verified:false},{staging:true},
    {fixture_classification:'STAGING'},
  ]) {
    const f=fixture();const first=await f.opts.readGuardian();let reads=0;
    f.setGuardian(async()=>({...first,...(++reads===2?patch:{})}));
    assert.equal(await createHostOwnerGenesisCustodyW74(f.opts).create(),null);
    assert.equal(reads,2);assert.equal(f.writes,0);
  }
});
test('W74 never returns an old Owner after post-commit device/client/key rebinding at the same epoch',async()=>{
  for(const field of ['device_id','client_id','key_fingerprint_sha256']) {
    const f=fixture();let current=f.opts.identity.snapshot();
    f.opts.identity={ensure:async()=>{},snapshot:()=>({...current})};
    f.opts.readAuthenticatedAdmin=async()=>({...current,admin_grant_epoch:7,admin_ready:true,access_tier:'ADMIN'});
    const guardian=f.opts.readGuardian;
    f.opts.readGuardian=async()=>({...await guardian(),guardian_device_key_fingerprint_sha256:current.key_fingerprint_sha256});
    f.opts.transaction=async fn=>fn({unsafe:async(sql,args)=>sql===W74_SCOPE_LOCK_SQL?[{}]:[
      {project_id:project,device_id:args[0],client_id:args[1],admin_grant_epoch:'7',observed_at:now()},
    ]});
    const write=f.opts.writeSealed;
    f.opts.writeSealed=async(record,previous)=>{
      await write(record,previous);
      current={...current,[field]:field==='key_fingerprint_sha256'?'f'.repeat(64):'44444444-4444-4444-8444-444444444444'};
    };
    assert.equal(await createHostOwnerGenesisCustodyW74(f.opts).create(),null,
      'post-commit '+field+' drift must not return the old sealed Owner');
    assert.equal(f.writes,1,'retain the durable record as unqualified, without an automatic rewrite');
  }
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

test('W74 only transfers generation on independently verified old PID death (STAGING)',async()=>{
  const f=fixture(), b=createHostOwnerGenesisCustodyW74(f.opts);
  assert.equal((await b.create())?.generation,1);
  const previous=await f.opts.readGuardian();
  const nextBorn=now(), nextPid=9202;
  const nextTick=(BigInt(Date.parse(nextBorn))*10000n+116444736000000000n).toString();
  f.setGuardian(async()=>({...previous,guardian_client_pid:nextPid,
    guardian_client_created_at:nextBorn,
    guardian_client_process_incarnation_id:`pid:${nextPid}:created_100ns:${nextTick}`}));
  f.replaceKernel(async pid=>pid===nextPid
    ? {pid:nextPid,created_at:nextBorn,observed_at:now(),source:'OS_PROCESS_INVENTORY'}
    : null);
  assert.equal(await b.create(),null,'missing old-PID witness is UNKNOWN, no takeover');
  f.replaceKernel(async pid=>pid===nextPid
    ? {pid:nextPid,created_at:nextBorn,observed_at:now(),source:'OS_PROCESS_INVENTORY'}
    : {pid:9101,state:'NOT_RUNNING',native_verified:true});
  const successor=await b.create();
  assert.equal(successor?.generation,2);
  assert.equal(successor?.fixture_classification,'STAGING');
  assert.equal(successor?.pid,nextPid);
});

for (const drift of ['close','source','epoch','host']) test(`W74 pre-seal ${drift} invalidation cannot start a sealed write (STAGING)`,async()=>{
  const f=fixture();let binding,hostCurrent=true;
  f.opts.assertLifetime=()=>{if(!hostCurrent)throw Error('TEST_HOST_REPLACED');};
  const read=f.opts.readSealed;
  f.opts.readSealed=async()=>{
    const value=await read();
    if(drift==='close')void binding.close();
    if(drift==='source')f.revokeSource();
    if(drift==='epoch')f.driftEpoch();
    if(drift==='host')hostCurrent=false;
    return value;
  };
  binding=createHostOwnerGenesisCustodyW74(f.opts);
  assert.equal(await binding.create(),null);
  await binding.close();assert.equal(f.writes,0);
});

test('W74 rechecks SQL after native pre-seal evidence, not before it (STAGING)',async()=>{
  const f=fixture(),read=f.opts.readSourceProof;let observations=0;
  f.opts.readSourceProof=async()=>{
    const result=await read();if(++observations===2)f.dropRows();return result;
  };
  const binding=createHostOwnerGenesisCustodyW74(f.opts);
  assert.equal(await binding.create(),null);assert.equal(f.writes,0);
  assert.equal(observations,2);await binding.close();
});

test('W74 close joins already-started native work and fences queued creation (STAGING)',async()=>{
  const f=fixture(),read=f.opts.readNativeKernel;let entered,release;
  const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  f.opts.readNativeKernel=async pid=>{entered();await gate;return read(pid);};
  const binding=createHostOwnerGenesisCustodyW74(f.opts);
  const first=binding.create();await started;const queued=binding.create();
  let drained=false;const closing=binding.close().then(()=>{drained=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(drained,false);
  release();assert.equal(await first,null);assert.equal(await queued,null);await closing;
  assert.equal(drained,true);assert.equal(f.writes,0);
});

test('W74 late close after an irreversible seal joins but cannot return a confirmed Owner (STAGING)',async()=>{
  const f=fixture(),write=f.opts.writeSealed;let entered,release;
  const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  f.opts.writeSealed=async(...args)=>{await write(...args);entered();await gate;};
  const binding=createHostOwnerGenesisCustodyW74(f.opts),attempt=binding.create();
  await started;let drained=false;const closing=binding.close().then(()=>{drained=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(drained,false);
  release();assert.equal(await attempt,null);await closing;
  assert.equal(f.writes,1,'already-started seal is retained as unconfirmed, not rolled back');
  assert.equal(await binding.create(),null);assert.equal(f.writes,1,'closed binding cannot retry');
});

test('W74 current Admin and device must still agree after native evidence awaits (STAGING)',async()=>{
  for(const drift of ['admin','device']) {
    const f=fixture(),read=f.opts.readSourceProof;
    let current=f.opts.identity.snapshot();f.opts.identity={ensure:async()=>{},snapshot:()=>({...current})};
    f.opts.readSourceProof=async()=>{
      const proof=await read();
      if(drift==='admin')f.driftEpoch();else current={...current,device_id:'44444444-4444-4444-8444-444444444444'};
      return proof;
    };
    const binding=createHostOwnerGenesisCustodyW74(f.opts);
    assert.equal(await binding.create(),null);assert.equal(f.writes,0);await binding.close();
  }
});

test('W74 invalid asynchronous lifetime gate is refused and joined without an unhandled rejection',async()=>{
  const f=fixture();let release;
  const gate=new Promise(r=>release=r);
  f.opts.assertLifetime=async()=>{await gate;throw Error('TEST_ASYNC_GATE_REFUSAL');};
  const binding=createHostOwnerGenesisCustodyW74(f.opts);
  assert.equal(await binding.create(),null);assert.equal(f.writes,0);
  let drained=false;const closing=binding.close().then(()=>{drained=true;});
  await new Promise(r=>setImmediate(r));assert.equal(drained,false);
  release();await closing;assert.equal(drained,true);assert.equal(f.writes,0);
});

for(const outcome of ['resolve','reject'])test(`W74 already-settled async lifetime ${outcome} never authorizes a seal`,async()=>{
  const f=fixture();f.opts.assertLifetime=()=>outcome==='resolve'?Promise.resolve():Promise.reject(Error('TEST_ASYNC_GATE_REJECTED'));
  const binding=createHostOwnerGenesisCustodyW74(f.opts);
  assert.equal(await binding.create(),null);await binding.close();assert.equal(f.writes,0);
});

test('typed pending custody seals exact source/Guardian evidence and never adopts missing legacy pins (STAGING)',async()=>{
 const f=fixture(),readProof=f.opts.readSourceProof;let patch={},transition=null;const modes=[];
 f.opts.readSourceProof=async()=>({...await readProof(),loaded_runtime_code_attested:false,...patch});
 f.opts.withOwnerScope=async(mode,body)=>{
  modes.push(mode);
  const scope={assertOpen:()=>{},readAuthenticatedAdmin:f.opts.readAuthenticatedAdmin,
   readScope:async()=>({project_id:project,device_id:device,client_id:client,admin_grant_epoch:7,observed_at:now()})};
  if(mode==='WRITE_CUSTODY')scope.prepareTransition=async value=>{assert.equal(transition,null);transition=value;};
  else scope.verifyTransition=async value=>{assert.equal(value.sealed_sha256,transition.next_sha256);};
  return body(Object.freeze(scope));
 };
 const binding=createHostOwnerGenesisCustodyW74(f.opts),first=await binding.create();
 assert.equal(first?.fixture_classification,'STAGING');assert.equal(first?.generation,1);
 assert.deepEqual(modes,['WRITE_CUSTODY','READ_CUSTODY']);
 const original=f.owner;assert.equal(original.pending_custody.loaded_runtime_code_attested,false);
 for(const key of ['installed_exe_sha256','package_code_sha256','proof_identity']){
  patch={[key]:'1'.repeat(64)};assert.equal(await binding.read(),null);
 }
 patch={};const native=await f.opts.readGuardian();
 f.setGuardian(async()=>({...native,guardian_enrollment_evidence_sha256:'1'.repeat(64)}));
 assert.equal(await binding.read(),null);f.setGuardian(async()=>native);
 const {pending_custody:removed,...legacy}=original;f.replaceOwner(legacy);
 assert.equal(await binding.read(),null,'missing pins cannot be silently upgraded');assert.equal(await binding.create(),null);
 f.replaceOwner({...original,observed_at:new Date(Date.now()-1000).toISOString()});
 assert.equal(await binding.read(),null,'complete canonical record digest includes observed_at, not only identity keys');
 f.replaceOwner(original);assert.equal((await binding.read())?.generation,1);assert.equal(f.writes,1);await binding.close();
});
