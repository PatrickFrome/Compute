import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createNativePreparationTransactions} from './native-coding-preparation-transaction.mjs';
import {createHostOwnerGenesisCustodyW74,W74_SCOPE_LOCK_SQL} from '../../apps/metaengine-browser/src/host-owner-genesis-custody-w74.mjs';
const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
// Real disposable PG17/reservation/advisory+project locks. Native evidence and
// sealed storage are deliberately STAGING mocks; this is not the pending-goal
// bridge, current grant/pairing integration or installed execution proof.
test('W74 pre-seal lifetime holds real PG17 scope and fences killed reservations',
 {skip:!bin||!driver,timeout:120000},async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'w74-preseal-pg-'))),data=path.join(root,'data');
 const listener=net.createServer();await new Promise((r,j)=>{listener.once('error',j);listener.listen(0,'127.0.0.1',r);});
 const port=listener.address().port;await new Promise(r=>listener.close(r));
 const command=(name,args)=>new Promise((resolve,reject)=>{
  const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{stdio:'ignore',windowsHide:true,shell:false});
  const timer=setTimeout(()=>{child.kill();reject(Error('fixture command timeout'));},60000);
  child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('fixture command failed '+name));});
 });
 let started=false,sql,held=null,binding=null,pending=null;
 try{
  await command('initdb',['-D',data,'--username=state_owner','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
  await fs.appendFile(path.join(data,'postgresql.conf'),"\nunix_socket_directories = ''\n");started=true;
  await command('pg_ctl',['-D',data,'-l',path.join(root,'pg.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
  const postgres=(await import(pathToFileURL(driver))).default,monitor=createNativePreparationTransactions();
  sql=postgres({host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:4,prepare:false,
   debug:monitor.debug,onclose:monitor.onclose,onnotice:()=>{},connection:{statement_timeout:10000,lock_timeout:3000}});
  assert.equal(Math.floor(Number((await sql.unsafe("select current_setting('server_version_num') as value"))[0].value)/10000),17);
  await sql.unsafe(`create schema destruktion_meta;create table destruktion_meta.project_run_h205f22(
   project_id uuid primary key,device_id uuid,client_id text,admin_grant_epoch bigint)`);
  const device=randomUUID(),client=randomUUID(),project=randomUUID(),birth=new Date().toISOString(),pid=1234;
  await sql.unsafe('insert into destruktion_meta.project_run_h205f22 values($1,$2,$3,7)',[project,device,client]);
  const ticks=(BigInt(Date.parse(birth))*10000n+116444736000000000n).toString();
  for(const scenario of ['locks','killed-before-seal','killed-after-seal'])await t.test(scenario,async()=>{
   let owner=null,writes=0,backend,sourceReads=0,finishedNative=false;
   const gate=deferred(),entered=deferred();held=gate;
   const options={identity:{ensure:async()=>{},snapshot:()=>({device_id:device,client_id:client,enrolled:true,key_fingerprint_sha256:'b'.repeat(64)})},
    transaction:(callback,opts)=>monitor.transaction(sql,'isolation level serializable',async tx=>{
     if(!opts.readOnly)backend=(await tx.unsafe('select pg_backend_pid() as pid'))[0].pid;
     return callback(tx);
    }),
    readAuthenticatedAdmin:async()=>({device_id:device,client_id:client,admin_grant_epoch:7,access_tier:'ADMIN',admin_ready:true}),
    readGuardian:async()=>({schema:'metaengine.browser-guardian.machine-bootstrap-launcher.v1',state:'READY',
     guardian_client_pid:pid,guardian_client_created_at:birth,guardian_client_process_incarnation_id:`pid:${pid}:created_100ns:${ticks}`,
     guardian_client_kernel_birth_verified:true,guardian_client_kernel_birth_rechecked:true,owner_binding_proven:true,device_binding_proven:true,
     guardian_device_key_fingerprint_sha256:'b'.repeat(64),guardian_enrollment_evidence_sha256:'c'.repeat(64)}),
    readNativeKernel:async()=>({pid,created_at:birth,observed_at:new Date().toISOString(),source:'OS_PROCESS_INVENTORY'}),
    readSourceProof:async()=>{
     if(++sourceReads===2&&scenario!=='killed-after-seal'){entered.resolve();await gate.promise;finishedNative=true;}
     return {source:'INSTALLED_EXE_NATIVE_VERIFIER',source_sha:'a'.repeat(40),exact_bytes_verified:true,native_signature_verified:true,
      release_root_signature_verified:true,slsa_evidence_digest_bound:true,package_code_verified:true,package_code_sha256:'d'.repeat(64),
      installed_exe_sha256:'e'.repeat(64),proof_identity:'f'.repeat(64),loaded_runtime_code_attested:false,
      observed_at:new Date().toISOString(),authority_effect:false,fixture_classification:'STAGING'};
    },readSealed:async()=>owner,
    writeSealed:async next=>{owner=next;writes++;if(scenario==='killed-after-seal'){entered.resolve();await gate.promise;}},staging:true,
   };
   binding=createHostOwnerGenesisCustodyW74(options);pending=binding.create();await entered.promise;
   if(scenario==='locks'){
    const contender=await sql.reserve();
    try{
     await contender.unsafe('begin');await contender.unsafe("set local lock_timeout='50ms'");
     await assert.rejects(contender.unsafe('update destruktion_meta.project_run_h205f22 set admin_grant_epoch=8 where project_id=$1',[project]),e=>e.code==='55P03');
     await contender.unsafe('rollback');await contender.unsafe('begin');await contender.unsafe("set local lock_timeout='50ms'");
     await assert.rejects(contender.unsafe(W74_SCOPE_LOCK_SQL,[device+':'+client]),e=>e.code==='55P03');
     await contender.unsafe('rollback');
    }finally{contender.release();}
    gate.resolve();assert.equal((await pending)?.generation,1);assert.equal(writes,1);assert.equal(finishedNative,true);
   }else{
    assert.equal((await sql.unsafe('select pg_terminate_backend($1) as killed',[backend]))[0].killed,true);
    let settled=false;pending.then(()=>{settled=true;});await new Promise(r=>setTimeout(r,30));
    assert.equal(settled,false,'reservation failure must join the outstanding native/seal callback');
    gate.resolve();assert.equal(await pending,null);
    assert.equal(writes,scenario==='killed-before-seal'?0:1);
    if(scenario==='killed-before-seal')assert.equal(finishedNative,true);
    else assert.equal(owner.generation,1,'seal survives lost SQL outcome as unconfirmed, without retry');
   }
   await binding.close();binding=null;pending=null;held=null;
   // Different explicit scope may acquire a fresh backend; failed one is never replayed.
   await monitor.transaction(sql,'isolation level serializable',tx=>tx.unsafe(W74_SCOPE_LOCK_SQL,[device+':'+client]));
  });
 }finally{
  held?.resolve();await pending?.catch(()=>{});await binding?.close();await sql?.end({timeout:3});
  if(started)await command('pg_ctl',['-D',data,'-m','immediate','-w','stop']).catch(()=>{});
  await fs.rm(root,{recursive:true,force:true});
 }
});
