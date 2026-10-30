import {createNativePreparationTransactions} from './native-coding-preparation-transaction.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {generatedStage} from './test/native-workspace-preparation-fixture.mjs';
import {createNativeWorkspacePreparation} from './native-coding-workspace-preparation.mjs';
import {readNativeWorkspaceStage,NATIVE_WORKSPACE_STAGE} from '../../apps/metaengine-browser/src/native-coding-workspace-preparation.mjs';
import {SupervisorDeviceIdentity} from '../../apps/metaengine-browser/src/supervisor-device-identity.mjs';
import {signNativeCodingDeviceRequest} from '../../apps/metaengine-browser/src/native-coding-device-request.mjs';
import {createNativeCodingDeviceRequestVerifier,createNativeCodingAuthenticatedRequestContext} from './native-coding-device-request.mjs';
const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
// Real disposable PG17 + actual signer/verifier. Native process/ACL/image/root
// observations are generated: no installed PC, enrollment or model effects.
test('native PG17 workspace preparation locks the same-cluster grant through durable publication and refuses revocation',
 {skip:!bin||!driver,timeout:120000},async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'native-workspace-pg-')),data=path.join(directory,'data');
 const listener=net.createServer();await new Promise((r,j)=>{listener.once('error',j);listener.listen(0,'127.0.0.1',r);});
 const port=listener.address().port;await new Promise(r=>listener.close(r));
 const command=(name,args)=>new Promise((resolve,reject)=>{const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{stdio:'ignore',windowsHide:true,shell:false});
  const timer=setTimeout(()=>{child.kill();reject(Error('fixture command timeout'));},60000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('fixture command failed '+name));});});
 let started=false,sql,service,context,verifier,revoker,held;
 try{
  await command('initdb',['-D',data,'--username=state_owner','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
  await fs.appendFile(path.join(data,'postgresql.conf'),"\nunix_socket_directories = ''\n");started=true;
  await command('pg_ctl',['-D',data,'-l',path.join(directory,'pg.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
  const postgres=(await import(pathToFileURL(driver))).default;
  const transactions=createNativePreparationTransactions();
  sql=postgres({debug:transactions.debug,onclose:transactions.onclose,host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:4,onnotice:()=>{},connection:{statement_timeout:15000,lock_timeout:5000}});
  assert.equal(Math.floor(Number((await sql.unsafe("select current_setting('server_version_num') as value"))[0].value)/10000),17);
  await sql.unsafe(`create role anon;create role authenticated;create role service_role;create schema destruktion_meta;
   create table public.compute_fabric_a2_browser_device_h205f22(device_id uuid primary key,client_id text,profile text,public_jwk jsonb,key_fingerprint_sha256 text,
    active boolean default true,revoked_at timestamptz,access_tier text default 'ADMIN',admin_revoked_at timestamptz,admin_grant_epoch bigint default 1,
    admin_scopes jsonb default '["CONTROL_PLANE","DEVOS"]',enrollment_pairing_token_hash text);
   create table public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash text primary key,active boolean default true);`);
  const source=async name=>fs.readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8');
  const project=await source('20261010100000_project_continuity_history_v1.sql');
  await sql.unsafe(project.slice(project.indexOf('create function destruktion_meta.project_device_grant_h205f22'),project.indexOf('create function destruktion_meta.project_authorize_h205f22')));
  const managed=await source('20261009194157_managed_project_admission_v1.sql');
  await sql.unsafe(managed.slice(0,managed.indexOf('create or replace function destruktion_meta.a2_managed_project_admission_read_h205f22')));
  const identity=new SupervisorDeviceIdentity({statePath:path.join(directory,'identity.json'),secureStorage:{isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()}});
  await identity.ensure();await identity.bindDevice(randomUUID());const device=identity.snapshot(),pair=randomUUID(),c=generatedStage();
  c.postgres.system_identifier=(await sql.unsafe('select system_identifier::text as value from pg_control_system()'))[0].value;
  await sql.unsafe('insert into public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22(token_hash) values($1)',[pair]);
  await sql.unsafe('insert into public.compute_fabric_a2_browser_device_h205f22(device_id,client_id,profile,public_jwk,key_fingerprint_sha256,enrollment_pairing_token_hash) values($1,$2,$3,$4::text::jsonb,$5,$6)',
   [device.device_id,device.client_id,device.profile,JSON.stringify(device.public_jwk),device.key_fingerprint_sha256,pair]);
  await fs.writeFile(path.join(directory,NATIVE_WORKSPACE_STAGE),JSON.stringify(c));const verifyStorage=async()=>({owner_dacl_verified:true});
  const input=(await readNativeWorkspaceStage(directory,{verifyStorage})).input,host={instance_id:randomUUID(),host_pid:1234};
  verifier=createNativeCodingDeviceRequestVerifier({sql,hostInstanceId:host.instance_id,hostPid:host.host_pid});context=createNativeCodingAuthenticatedRequestContext({verifier});
  const gate=deferred(),entered=deferred();let observations=0;
  held=gate;
  const readNativeScope=async(p,_sandbox,tx)=>{observations++;entered.resolve();await gate.promise;
   assert.equal((await tx.unsafe('select current_user::text as value'))[0].value,'state_owner');
   return{artifact:c.artifact,postgres:c.postgres,user_sid:c.user_sid,worktree:p.worktree,sandbox:p.sandbox,host_process:c.postgres.postmaster};};
  const serviceOptions={transaction:(mode,body)=>transactions.transaction(sql,mode,body),stateDirectory:directory,readCurrentDevice:context.readCurrentDevice,readNativeScope,verifyStorage,
   readRootIdentity:async root=>root===c.repo_root?c.repo_root_identity_sha256:root===c.managed_root?c.managed_root_identity_sha256:'a'.repeat(64)};
  service=createNativeWorkspacePreparation(serviceOptions);
  const call=async action=>context.run(action,await signNativeCodingDeviceRequest({identity,binding:host,operation:action,input}),data=>service[action](data));
  await assert.rejects(call('PREPARE_WORKSPACE_V1'),/workspace_authorization_required/);
  await sql.unsafe('select public.h205f22_a2_managed_project_repository_provision_v1($1,$2,$3,$4,$5,$6,$7)',[c.workspace_id,device.device_id,device.client_id,1,c.repo_id,c.repo_root,c.managed_root]);
  await sql.unsafe('update public.compute_fabric_a2_managed_project_repository_h205f22 set admin_grant_epoch=2');
  await assert.rejects(call('PREPARE_WORKSPACE_V1'),/workspace_authorization_required/);
  await sql.unsafe('update public.compute_fabric_a2_managed_project_repository_h205f22 set admin_grant_epoch=1');
  await t.test('real server idle timeout during cold setup cannot write a Host preparation intent',async()=>{
   const cold=async()=>{throw Error('expired transaction cannot reach physical observation');};
   let coldFinished=false,coldTx;
   cold.prepare=async()=>{await coldTx.unsafe("set local idle_in_transaction_session_timeout='50ms'");await new Promise(r=>setTimeout(r,150));coldFinished=true;};
   const timeoutTransaction=(mode,fn)=>transactions.transaction(sql,mode,tx=>{coldTx=tx;return fn(tx);});
   const expired=createNativeWorkspacePreparation({...serviceOptions,transaction:timeoutTransaction,readNativeScope:cold});
   try{
    const signed=await signNativeCodingDeviceRequest({identity,binding:host,operation:'PREPARE_WORKSPACE_V1',input});
    await assert.rejects(context.run('PREPARE_WORKSPACE_V1',signed,data=>expired.PREPARE_WORKSPACE_V1(data)),/idle-in-transaction|connection|CONNECTION|terminating/i);
    assert.equal(coldFinished,true,'begin failure must join the still-running cold callback');
    assert.equal((await fs.readdir(directory)).includes('native-coding-workspace-preparation-intent-v1.json'),false);
    assert.equal((await fs.readdir(directory)).includes('native-coding-workspace-preparation-receipt-v1.json'),false);
   }finally{expired.close();}
  });
  await t.test('closed reserved slot is reclaimed in a one-connection pool for a distinct transaction',async()=>{
   const monitor=createNativePreparationTransactions(),single=postgres({host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:1,
    debug:monitor.debug,onclose:monitor.onclose,onnotice:()=>{},connect_timeout:3});
   let originalPid,finished=false;
   try{
    await assert.rejects(monitor.transaction(single,'isolation level serializable',async tx=>{
     originalPid=(await tx.unsafe('select pg_backend_pid() as value'))[0].value;
     await tx.unsafe("set local idle_in_transaction_session_timeout='50ms'");await new Promise(r=>setTimeout(r,150));finished=true;
     return tx.unsafe('select 1');
    }),/connection_closed/);
    assert.equal(finished,true);
    const next=await monitor.transaction(single,'isolation level serializable',async tx=>(await tx.unsafe('select pg_backend_pid() as value'))[0].value);
    assert.notEqual(next,originalPid,'only the separately requested transaction may acquire a fresh backend');
   }finally{await single.end({timeout:3});}
  });
  const preparation=call('PREPARE_WORKSPACE_V1');preparation.catch(()=>{});await entered.promise;
  revoker=await sql.reserve();const pid=(await revoker.unsafe('select pg_backend_pid() as value'))[0].value;
  const revoke=revoker.unsafe('update public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 set active=false where token_hash=$1',[pair]).then(()=>true);revoke.catch(()=>{});
  let locked=false;const until=Date.now()+3000;
  while(Date.now()<until){locked=(await sql.unsafe('select exists(select 1 from pg_locks where pid=$1 and not granted) as value',[pid]))[0].value;if(locked)break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(locked,true,'pairing revocation must wait for publication transaction');gate.resolve();
  assert.equal((await preparation).state,'PREPARED');assert.equal(await revoke,true);assert.equal(observations,2);
  await assert.rejects(call('READ_WORKSPACE_PREPARATION_V1'),/current_device_unavailable/);
  assert.equal((await sql.unsafe("select to_regclass('destruktion_meta.project_run_h205f22') as value"))[0].value,null,'preparation creates no project schema or execution rows');
  const receipt=JSON.parse(await fs.readFile(path.join(directory,'native-coding-workspace-preparation-receipt-v1.json'),'utf8'));
  assert.equal(receipt.intent.preparation_grant_epoch,1);assert.equal(Object.hasOwn(receipt.intent,'owner_epoch'),false);
 }finally{
  held?.resolve();service?.close();context?.close();verifier?.close();revoker?.release();if(sql)await sql.end({timeout:5});
  if(started)await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  t.diagnostic('disposable PostgreSQL stopped: '+directory);
 }
});
