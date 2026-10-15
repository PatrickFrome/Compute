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
      guardian_client_kernel_birth_verified:true,device_binding_proven:true,
      owner_binding_proven:true,
      guardian_device_key_fingerprint_sha256:snap.key_fingerprint_sha256,
      guardian_enrollment_evidence_sha256:'f'.repeat(64),
    });
    const guardianUnbind=identity.bindGuardianOwnerEvidenceW67({
      status:async()=>guardian(),
    });
    const binding=()=>identity.bindHostOwnerGenesisW74({
      transaction:async (callback)=>callback({unsafe:async(sql,args)=>{
        if(sql.includes('pg_advisory_xact_lock'))return [{}];
        assert.equal(args[0],device);
        assert.equal(args[1],snap.client_id);
        return [{project_id:project,device_id:device,client_id:snap.client_id,
          admin_grant_epoch:5,observed_at:time()}];
      }}),
      readAuthenticatedAdmin:async()=>({device_id:device,client_id:snap.client_id,
        admin_grant_epoch:5,admin_ready:true,access_tier:'ADMIN'}),
      readSourceProof:async()=>({
        source:'INSTALLED_EXE_NATIVE_VERIFIER',source_sha:'a'.repeat(40),
        proof_identity:'b'.repeat(64),installed_exe_sha256:'c'.repeat(64),
        exact_bytes_verified:true,native_signature_verified:true,
        fixture_classification:'STAGING'}),
      readNativeKernel:async()=>({
        pid,created_at:birth,observed_at:time(),source:'OS_PROCESS_INVENTORY'}),
      staging:true,
    });
    unbind=binding();
    const first=await identity.establishHostOwnerW74();
    assert.equal(first?.fixture_classification,'STAGING');
    assert.equal(first?.generation,1);
    assert.equal(await identity.readTrustedHostOwnerIncarnationW74(),null);
    assert.equal(identity.snapshot().encrypted_host_owner_record_b64,undefined);
    const serialized=await fs.readFile(file,'utf8');
    assert(!serialized.includes('metaengine.host.owner-incarnation.v1'));
    assert(serialized.includes('encrypted_host_owner_record_b64'));
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
