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
