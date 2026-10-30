// Physically persists W74 STAGING Owner in uniquely disposable enrolled-device
// key storage; no actual Browser/Guardian/bootstrap, installed keys or DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {SupervisorDeviceIdentity}
  from '../src/supervisor-device-identity.mjs';

const time=()=>new Date().toISOString();
test('W74 protected device identity record survives restart without promoting STAGING',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'w74-genesis-staging-'));
  await fs.chmod(root,0o700);
  const file=path.join(root,'device.json');
  // TEST-ONLY codec deliberately marked STAGING: not an OS secureStorage mock
  // used for an installed claim. Production requires Electron DPAPI.
  const secureStorage={
    isEncryptionAvailable:()=>true,
    encryptString:s=>Buffer.from('STAGING_CODEC:'+s,'utf8'),
    decryptString:b=>{
      const str=Buffer.from(b).toString('utf8');
      if(!str.startsWith('STAGING_CODEC:'))throw Error('CORRUPTED');
      return str.slice('STAGING_CODEC:'.length);
    },
  };
  let unbind=null;
  try{
    const identity=new SupervisorDeviceIdentity({statePath:file,secureStorage});
    await identity.ensure();
    const device=randomUUID(),project=randomUUID();
    await identity.bindDevice(device);
    const snap=identity.snapshot();
    const birth=time(),pid=process.pid;
    const ticks=(BigInt(Date.parse(birth))*10000n+116444736000000000n).toString();
    const guardian=()=>({
      schema:'metaengine.browser-guardian.machine-bootstrap-launcher.v1',
      state:'READY',guardian_client_pid:pid,guardian_client_created_at:birth,
      guardian_client_process_incarnation_id:`pid:${pid}:created_100ns:${ticks}`,
      guardian_client_kernel_birth_verified:true,guardian_client_kernel_birth_rechecked:true,device_binding_proven:true,
      owner_binding_proven:true,
      guardian_device_key_fingerprint_sha256:snap.key_fingerprint_sha256,
      guardian_enrollment_evidence_sha256:'f'.repeat(64),
    });
    const guardianUnbind=identity.bindGuardianOwnerEvidenceW67({
      status:async()=>guardian(),
    });
    let epoch=5;
    const binding=()=>identity.bindHostOwnerGenesisW74({
      transaction:async (callback)=>callback({unsafe:async(sql,args)=>{
        if(sql.includes('pg_advisory_xact_lock'))return [{}];
        assert.equal(args[0],device);
        assert.equal(args[1],snap.client_id);
        return [{project_id:project,device_id:device,client_id:snap.client_id,
          admin_grant_epoch:epoch,observed_at:time()}];
      }}),
      readAuthenticatedAdmin:async()=>({device_id:device,client_id:snap.client_id,
        admin_grant_epoch:epoch,admin_ready:true,access_tier:'ADMIN'}),
      readSourceProof:async()=>({
        source:'INSTALLED_EXE_NATIVE_VERIFIER',source_sha:'a'.repeat(40),
        proof_identity:'b'.repeat(64),installed_exe_sha256:'c'.repeat(64),
        exact_bytes_verified:true,native_signature_verified:true,
        release_root_signature_verified:true,slsa_evidence_digest_bound:true,
        package_code_verified:true,package_code_sha256:'d'.repeat(64),
        observed_at:time(),authority_effect:false,fixture_classification:'STAGING'}),
      readNativeKernel:async()=>({
        pid,created_at:birth,observed_at:time(),source:'OS_PROCESS_INVENTORY'}),
      staging:true,
    });
    unbind=binding();
    const rename=fs.rename;
    let entered,release;
    const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
    let intercept=true;
    fs.rename=async(...args)=>{
      if(args[1]===file&&intercept){intercept=false;entered();await gate;}
      return rename.call(fs,...args);
    };
    let first;
    try {
      const owner=identity.establishHostOwnerW74();await started;
      const clearing=identity.clearEnrollmentRequest();
      await new Promise(r=>setImmediate(r));release();
      [first]=await Promise.all([owner,clearing]);
    } finally {release();fs.rename=rename;}

    assert.equal(first?.fixture_classification,'STAGING');
    assert.equal(first?.generation,1);
    assert.equal(await identity.readTrustedHostOwnerIncarnationW74(),null);
    assert.equal(identity.snapshot().encrypted_host_owner_record_b64,undefined);
    const serialized=await fs.readFile(file,'utf8');
    assert(!serialized.includes('metaengine.host.owner-incarnation.v1'));
    assert(serialized.includes('encrypted_host_owner_record_b64'));
    const sealed=JSON.parse(serialized).encrypted_host_owner_record_b64;
    assert(sealed,'concurrent enrollment clear must retain the committed Owner record');
    assert.equal(JSON.parse(secureStorage.decryptString(Buffer.from(sealed,'base64'))).generation,1);
    // A failed flush must preserve both sealed Owner and original key/enrollment.
    const open=fs.open;
    fs.open=async(filePath,...args)=>{
      const handle=await open.call(fs,filePath,...args);
      if(String(filePath).startsWith(file+'.'))handle.sync=async()=>{throw Error('TEST_OWNER_SYNC_FAILURE');};
      return handle;
    };
    try {await assert.rejects(identity.bindEnrollmentRequest('replacement'),/TEST_OWNER_SYNC_FAILURE/);}
    finally {fs.open=open;}
    assert.equal(await fs.readFile(file,'utf8'),serialized);
    assert.equal(identity.snapshot().device_id,device);
    // A same-device approval clears sealed custody while an epoch transition
    // is waiting. CAS must see that clearing when its queued write executes.
    epoch=6;
    let enteredBinding,releaseBinding;
    const bindingStarted=new Promise(r=>enteredBinding=r),bindingGate=new Promise(r=>releaseBinding=r);
    let interceptBinding=true;
    fs.rename=async(...args)=>{
      if(args[1]===file&&interceptBinding){interceptBinding=false;enteredBinding();await bindingGate;}
      return rename.call(fs,...args);
    };
    try {
      const approval=identity.bindDevice(device);await bindingStarted;
      const staleOwner=identity.establishHostOwnerW74();
      await new Promise(r=>setImmediate(r));releaseBinding();
      await approval;assert.equal(await staleOwner,null);
      assert.equal(JSON.parse(await fs.readFile(file,'utf8')).encrypted_host_owner_record_b64,'');
    } finally {releaseBinding();fs.rename=rename;}
    assert.equal((await identity.establishHostOwnerW74())?.generation,1);

    unbind();unbind=null;guardianUnbind();
    const resumed=new SupervisorDeviceIdentity({statePath:file,secureStorage});
    await resumed.ensure();
    assert.equal(resumed.snapshot().device_id,device);
    assert.equal(resumed.snapshot().encrypted_host_owner_record_b64,undefined);
    assert.equal(await resumed.readTrustedHostOwnerIncarnationW74(),null);
    // A new device approval invalidates old encrypted Owner record.
    await resumed.clearDeviceBindingForReenrollment();
    const cleared=JSON.parse(await fs.readFile(file,'utf8'));
    assert.equal(cleared.encrypted_host_owner_record_b64,'');
    assert.equal(resumed.snapshot().device_id,null);
  }finally{
    try{unbind?.()}catch{}
    await fs.rm(root,{recursive:true,force:true});
  }
});

// Real disposable identity files/queue; all native/SQL observations below are
// generated STAGING fixtures. These tests make no installed Windows claim.
async function queuedFixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'w74-lifetime-staging-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'device.json');
  let ownerEncryptions=0,epoch=5,currentHost=true,lifetimeHook=()=>{},scopeHook=()=>{};
  const secureStorage={isEncryptionAvailable:()=>true,
    encryptString:s=>{if(s.includes('metaengine.host.owner-incarnation.v1'))ownerEncryptions++;return Buffer.from('STAGING:'+s);},
    decryptString:b=>Buffer.from(b).toString().slice('STAGING:'.length)};
  const identity=new SupervisorDeviceIdentity({statePath:file,secureStorage});
  await identity.ensure();await identity.bindDevice(randomUUID());const snap=identity.snapshot();
  const birth=time(),pid=process.pid,ticks=(BigInt(Date.parse(birth))*10000n+116444736000000000n).toString();
  identity.bindGuardianOwnerEvidenceW67({status:async()=>({
    schema:'metaengine.browser-guardian.machine-bootstrap-launcher.v1',state:'READY',
    guardian_client_pid:pid,guardian_client_created_at:birth,
    guardian_client_process_incarnation_id:`pid:${pid}:created_100ns:${ticks}`,
    guardian_client_kernel_birth_verified:true,guardian_client_kernel_birth_rechecked:true,
    owner_binding_proven:true,device_binding_proven:true,
    guardian_device_key_fingerprint_sha256:snap.key_fingerprint_sha256,guardian_enrollment_evidence_sha256:'f'.repeat(64),
  })});
  const project=randomUUID();
  const dependencies={
    assertLifetime:()=>{if(!currentHost)throw Error('TEST_HOST_CHANGED');lifetimeHook();},
    transaction:async callback=>callback({unsafe:async sql=>{
      if(sql.includes('pg_advisory_xact_lock'))return [{}];scopeHook();
      return [{project_id:project,device_id:snap.device_id,client_id:snap.client_id,admin_grant_epoch:epoch,observed_at:time()}];
    }}),
    readAuthenticatedAdmin:async()=>({device_id:snap.device_id,client_id:snap.client_id,
      admin_grant_epoch:epoch,admin_ready:true,access_tier:'ADMIN'}),
    readSourceProof:async()=>({source:'INSTALLED_EXE_NATIVE_VERIFIER',source_sha:'a'.repeat(40),
      proof_identity:'b'.repeat(64),installed_exe_sha256:'c'.repeat(64),package_code_sha256:'d'.repeat(64),
      exact_bytes_verified:true,native_signature_verified:true,release_root_signature_verified:true,
      slsa_evidence_digest_bound:true,package_code_verified:true,loaded_runtime_code_attested:false,
      observed_at:time(),authority_effect:false,fixture_classification:'STAGING'}),
    readNativeKernel:async()=>({pid,created_at:birth,observed_at:time(),source:'OS_PROCESS_INVENTORY'}),staging:true,
  };
  const unbind=identity.bindHostOwnerGenesisW74(dependencies);
  t.after(()=>unbind());
  return {identity,file,unbind,dependencies,secureStorage,get ownerEncryptions(){return ownerEncryptions;},
    revoke:()=>{epoch++;},loseHost:()=>{currentHost=false;},
    setLifetimeHook:f=>{lifetimeHook=f;},setScopeHook:f=>{scopeHook=f;}};
}

for(const boundary of ['close','grant','host'])test(`W74 queued safeStorage CAS revalidates ${boundary} after the preceding identity write (STAGING)`,async t=>{
  const f=await queuedFixture(t),rename=fs.rename;let entered,release,intercept=true;
  const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  fs.rename=async(...args)=>{if(args[1]===f.file&&intercept){intercept=false;entered();await gate;}return rename.call(fs,...args);};
  try{
    const prior=f.identity.clearEnrollmentRequest();await started;
    const pending=f.identity.establishHostOwnerW74();
    await new Promise(r=>setImmediate(r));assert.equal(f.ownerEncryptions,0,'seal is queued behind the earlier writer');
    let drain,drained=false;
    if(boundary==='close'){
      drain=Promise.resolve(f.unbind()).then(()=>{drained=true;});
      await new Promise(r=>setImmediate(r));assert.equal(drained,false,'unbind must join the queued mutation');
      assert.throws(()=>f.identity.bindHostOwnerGenesisW74(f.dependencies),/w74_native_guardian_not_bound/,
        'a replacement binding cannot overlap draining custody');
    }else if(boundary==='grant')f.revoke();else f.loseHost();
    release();await prior;assert.equal(await pending,null);await drain;
    assert.equal(f.ownerEncryptions,0,'no late encryption after lifetime/current grant changed');
    assert.equal(JSON.parse(await fs.readFile(f.file,'utf8')).encrypted_host_owner_record_b64,'');
  }finally{release();fs.rename=rename;}
});

test('W74 successful seal with lost persistence ACK remains unconfirmed and never auto-retries (STAGING)',async t=>{
  const f=await queuedFixture(t),rename=fs.rename;
  fs.rename=async(...args)=>{await rename.call(fs,...args);if(args[1]===f.file)throw Error('TEST_OWNER_ACK_LOST');};
  try{assert.equal(await f.identity.establishHostOwnerW74(),null);}finally{fs.rename=rename;}
  assert.equal(f.ownerEncryptions,1);
  const disk=await fs.readFile(f.file,'utf8');
  const owner=JSON.parse(f.secureStorage.decryptString(Buffer.from(JSON.parse(disk).encrypted_host_owner_record_b64,'base64')));
  assert.equal(owner.generation,1);assert.equal(owner.fixture_classification,'STAGING');
  assert.throws(()=>f.identity.snapshot(),/persistence_uncertain/);
  assert.equal(await f.identity.establishHostOwnerW74(),null);assert.equal(f.ownerEncryptions,1);
  assert.equal(await fs.readFile(f.file,'utf8'),disk);await f.unbind();
});

for(const boundary of ['close','grant','host'])test(`W74 ${boundary} during actual Owner temp-file sync prevents final replacement (STAGING)`,async t=>{
  const f=await queuedFixture(t),open=fs.open,rename=fs.rename;let entered,release,replacements=0;
  const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  fs.open=async(file,...args)=>{
    const handle=await open.call(fs,file,...args);
    if(String(file).startsWith(f.file+'.')){
      const sync=handle.sync.bind(handle);
      handle.sync=async()=>{await sync();entered();await gate;};
    }
    return handle;
  };
  fs.rename=async(...args)=>{if(args[1]===f.file)replacements++;return rename.call(fs,...args);};
  let pending,closing;
  const before=await fs.readFile(f.file,'utf8');
  try{
    pending=f.identity.establishHostOwnerW74();await started;assert.equal(f.ownerEncryptions,1);
    if(boundary==='close'){
      let drained=false;closing=Promise.resolve(f.unbind()).then(()=>{drained=true;});
      await new Promise(r=>setImmediate(r));assert.equal(drained,false);
    }else if(boundary==='grant')f.revoke();else f.loseHost();
    release();assert.equal(await pending,null);await closing;
    assert.equal(replacements,0,'final pre-replacement check must refuse stale temp bytes');
    assert.equal(await fs.readFile(f.file,'utf8'),before);
    assert.equal((await fs.readdir(path.dirname(f.file))).some(x=>x.endsWith('.tmp')),false);
    assert.equal(await f.identity.readTrustedHostOwnerIncarnationW74(),null);
  }finally{release();await pending;await closing;fs.open=open;fs.rename=rename;}
});

// Once rename has already started, cancellation cannot promise its rollback.
test('W74 close during started Owner rename joins an unconfirmed replacement (STAGING)',async t=>{
  const f=await queuedFixture(t),rename=fs.rename;let entered,release;
  const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  fs.rename=async(...args)=>{if(args[1]===f.file){entered();await gate;}return rename.call(fs,...args);};
  let pending,closing;
  try{
    pending=f.identity.establishHostOwnerW74();await started;let drained=false;
    closing=Promise.resolve(f.unbind()).then(()=>{drained=true;});
    await new Promise(r=>setImmediate(r));assert.equal(drained,false);
    release();assert.equal(await pending,null);await closing;
    const disk=JSON.parse(await fs.readFile(f.file,'utf8'));
    const record=JSON.parse(f.secureStorage.decryptString(Buffer.from(disk.encrypted_host_owner_record_b64,'base64')));
    assert.equal(record.generation,1);assert.equal(record.fixture_classification,'STAGING');
    assert.equal(await f.identity.readTrustedHostOwnerIncarnationW74(),null);assert.equal(f.ownerEncryptions,1);
  }finally{release();await pending;await closing;fs.rename=rename;}
});

test('W74 synchronous final lifetime fence closes the async guard continuation gap (STAGING)',async t=>{
  const f=await queuedFixture(t),open=fs.open,rename=fs.rename;let flushed=false,lastScope=false,scheduled=false,replacements=0,closing;
  fs.open=async(file,...args)=>{
    const handle=await open.call(fs,file,...args);
    if(String(file).startsWith(f.file+'.')){
      const sync=handle.sync.bind(handle);handle.sync=async()=>{await sync();flushed=true;};
    }
    return handle;
  };
  fs.rename=async(...args)=>{if(args[1]===f.file)replacements++;return rename.call(fs,...args);};
  f.setScopeHook(()=>{if(flushed)lastScope=true;});
  f.setLifetimeHook(()=>{
    if(lastScope&&!scheduled){scheduled=true;queueMicrotask(()=>{closing=f.unbind();});}
  });
  const before=await fs.readFile(f.file,'utf8');
  try{
    assert.equal(await f.identity.establishHostOwnerW74(),null);await closing;
    assert.equal(scheduled,true);assert.equal(replacements,0,'close between async guard continuations must be seen synchronously before rename');
    assert.equal(await fs.readFile(f.file,'utf8'),before);
  }finally{fs.open=open;fs.rename=rename;}
});
