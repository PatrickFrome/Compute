// W74: actual disposable PostgreSQL 17 source/epoch admission. No live
// database, inherited Owner profile, hosted provider, DB URL or service.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHostOwnerGenesisCustodyW74}
  from '../../apps/metaengine-browser/src/host-owner-genesis-custody-w74.mjs';

const exec=promisify(execFile);
const IMAGE='postgres:17.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3';
const enabled=process.env.W74_DOCKER_PG17==='1';
const required=process.env.W74_REQUIRE_REAL_PG17==='1';
const docker=(...args)=>exec('docker',args,{windowsHide:true,shell:false,timeout:90000});
const at=()=>new Date().toISOString();
const ticks=date=>(BigInt(Date.parse(date))*10000n+116444736000000000n).toString();

test('W74 own-PG17 bound genesis, epoch drift, ambiguous project and restart (STAGING only)',{
  timeout:180000,skip:!enabled&&!required?'DISPOSABLE_REAL_PG17_NOT_REQUESTED':false,
},async()=>{
  assert(enabled,'W74_REQUIRED_PG17_NOT_ENABLED');
  assert.equal(process.platform,'linux','Linux disposable Docker PG17 only');
  for(const key of ['PGDATA','PGHOST','PGPORT','PGPASSWORD','DATABASE_URL',
    'LOCAL_STATE_DATABASE_URL','METAENGINE_OWNER_FILE','METAENGINE_OWNER_ID'])
    assert.equal(process.env[key],undefined,'REFUSE_INHERITED_'+key);
  const {default:postgres}=await import('postgres');
  const client=randomUUID(),device=randomUUID(),project=randomUUID();
  const password='generated-'+randomBytes(24).toString('hex');
  const name='metaengine-w74-pg17-'+randomBytes(8).toString('hex');
  let cid=null,sql=null;
  try{
    cid=(await docker('run','--detach','--rm','--name',name,
      '--label','metaengine.w74.disposable=true',
      '--env','POSTGRES_USER=w74_fixture',
      '--env','POSTGRES_DB=w74_fixture',
      '--env','POSTGRES_PASSWORD='+password,
      '--publish','127.0.0.1::5432',IMAGE)).stdout.trim();
    assert.match(cid,/^[a-f0-9]{64}$/,'new physical container id');
    let port=null;
    for(let i=0;i<80;i++){
      try{
        const out=(await docker('port',cid,'5432/tcp')).stdout.trim();
        const m=/^127\.0\.0\.1:([0-9]+)$/.exec(out);
        if(!m)throw Error('UNBOUND_PORT');
        port=Number(m[1]);
        const ready=(await docker('exec',cid,'pg_isready','-h','127.0.0.1',
          '-U','w74_fixture','-d','w74_fixture')).stdout;
        if(ready.includes('accepting connections'))break;
      }catch{}
      await new Promise(r=>setTimeout(r,200));
    }
    assert(Number.isSafeInteger(port)&&port>=1024&&port<=65535,
      'generated Docker localhost port');
    sql=postgres({host:'127.0.0.1',port,user:'w74_fixture',
      database:'w74_fixture',password,ssl:false,max:1,connect_timeout:5});
    const version=Number((await sql.unsafe("SELECT current_setting('server_version_num')::int AS version"))[0].version);
    assert(version>=170000&&version<180000);
    await sql.unsafe(`CREATE SCHEMA destruktion_meta;
      CREATE TABLE destruktion_meta.project_run_h205f22 (
      project_id uuid PRIMARY KEY,device_id uuid NOT NULL,
      client_id text NOT NULL,admin_grant_epoch bigint NOT NULL);
      INSERT INTO destruktion_meta.project_run_h205f22
      VALUES ('${project}','${device}','${client}',7)`);
    const birth=at(),pid=process.pid;
    const incarnation=`pid:${pid}:created_100ns:${ticks(birth)}`;
    const guardian=()=>({
      schema:'metaengine.browser-guardian.machine-bootstrap-launcher.v1',
      state:'READY',guardian_client_pid:pid,guardian_client_created_at:birth,
      guardian_client_process_incarnation_id:incarnation,
      guardian_device_key_fingerprint_sha256:'b'.repeat(64),
      guardian_enrollment_evidence_sha256:'c'.repeat(64),
      owner_binding_proven:true,device_binding_proven:true,
      guardian_client_kernel_birth_verified:true,
    });
    let adminEpoch=7,record=null;
    const transaction=(fn,opts)=>sql.begin(async tx=>{
      if(opts.readOnly)await tx.unsafe('SET TRANSACTION READ ONLY');
      else await tx.unsafe('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      return fn(tx);
    });
    const custody=createHostOwnerGenesisCustodyW74({
      identity:{ensure:async()=>{},snapshot:()=>({client_id:client,
        device_id:device,key_fingerprint_sha256:'b'.repeat(64),enrolled:true})},
      transaction,readAuthenticatedAdmin:async()=>({client_id:client,device_id:device,
        access_tier:'ADMIN',admin_ready:true,admin_grant_epoch:adminEpoch}),
      readGuardian:async()=>guardian(),
      readNativeKernel:async requested=>requested===pid?
        {pid,created_at:birth,observed_at:at(),source:'OS_PROCESS_INVENTORY'}:null,
      readSourceProof:async()=>({source:'INSTALLED_EXE_NATIVE_VERIFIER',
        source_sha:'a'.repeat(40),exact_bytes_verified:true,
        native_signature_verified:true,proof_identity:'d'.repeat(64),
        installed_exe_sha256:'e'.repeat(64),release_root_signature_verified:true,
        slsa_evidence_digest_bound:true,observed_at:at(),authority_effect:false,
        fixture_classification:'STAGING'}),
      readSealed:async()=>record,
      writeSealed:async(next,previous)=>{
        assert.equal(record,previous);record=next;
      },staging:true,
    });
    assert.equal((await custody.create())?.project_id,project,
      'project comes from pinned real ownPG catalog, not caller');
    assert.equal(record.fixture_classification,'STAGING');
    assert.equal(await custody.read(),null,'test signer never becomes installed');
    assert.equal((await custody.create())?.generation,1,'same Owner idempotent');
    adminEpoch=8;
    assert.equal(await custody.create(),null,'device epoch without DB CAS denied');
    adminEpoch=7;
    await sql.unsafe(`INSERT INTO destruktion_meta.project_run_h205f22
      VALUES ('${randomUUID()}','${device}','${client}',7)`);
    assert.equal(await custody.create(),null,'two eligible projects ambiguous');
    await sql.unsafe('DELETE FROM destruktion_meta.project_run_h205f22 WHERE project_id <> $1::uuid',[project]);
    assert.equal((await custody.create())?.generation,1,'no duplicate genesis');
    await sql.end({timeout:5});sql=null;
    await docker('restart',cid);
    // Restart has no effect on Host authority by itself; reconnect must still
    // validate the same single project and exact Owner epoch, not old receipt.
    sql=postgres({host:'127.0.0.1',port,user:'w74_fixture',
      database:'w74_fixture',password,ssl:false,max:1,connect_timeout:5});
    for(let i=0;i<60;i++){
      try{await sql.unsafe('SELECT 1');break;}
      catch{await new Promise(r=>setTimeout(r,200));}
    }
    assert.equal((await custody.create())?.generation,1,'fresh PG after restart');
    await sql.unsafe('DELETE FROM destruktion_meta.project_run_h205f22');
    assert.equal(await custody.create(),null,'deleted authoritative scope is never replayed');
    assert.equal(record.generation,1);
    custody.close();
  }finally{
    try{await sql?.end({timeout:2})}catch{}
    if(cid&&/^[a-f0-9]{64}$/.test(cid)){
      try{const inspected=(await docker('inspect','-f','{{index .Config.Labels "metaengine.w74.disposable"}}',cid)).stdout.trim();
        if(inspected==='true')await docker('rm','--force',cid);
      }catch{}
    }
  }
});
