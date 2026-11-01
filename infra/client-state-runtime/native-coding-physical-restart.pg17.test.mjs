import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {createNativeCodingPhysicalCustody} from './native-coding-physical-custody.mjs';
import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {nativePhysicalSettlementUnconfirmed} from '../../apps/metaengine-browser/src/native-coding-host-settlement.mjs';
import {nativePhysicalTaskFixture} from './test/fixtures/native-coding-physical-task-fixture.mjs';

const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
const source=await fs.readFile(new URL('./native-coding-physical-custody-v1.sql',import.meta.url),'utf8');
const requestTable='destruktion_meta.native_coding_physical_request_h205f22';
const closureTable='destruktion_meta.native_coding_physical_closure_h205f22';
const resolutionTable='destruktion_meta.native_coding_physical_resolution_h205f22';
const fenceTable='destruktion_meta.native_coding_physical_fence_h205f22';
const setupTable='destruktion_meta.native_coding_setup_operation_h205f22';
const birth=(pid,when)=>({pid,created_at:new Date(when).toISOString(),
 process_incarnation_id:`pid:${pid}:created_100ns:${BigInt(when)*10000n+116444736000000000n}`});

// Real disposable Linux PG17/WAL/transactions/restart and real producer/consumer.
// Enrollment, native process birth/Windows OS readers and setup work are GENERATED
// FIXTURES. This is not Windows qualification, installed execution or readiness.
test('physical SETUP/TASK closure survives genuine PG restart and rotated Host without releasing incomplete history',{
 skip:!bin||!driver,timeout:90000,
},async t=>{
 const base=await fs.realpath(process.env.METAENGINE_PG_TEST_BASE||os.tmpdir());
 const directory=await fs.mkdtemp(path.join(base,'native-physical-restart-'));
 const data=path.join(directory,'pgdata'),log=path.join(directory,'postgres.log');
 const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
 const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
 const command=(name,args)=>new Promise((resolve,reject)=>{
  const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{shell:false,windowsHide:true,stdio:'ignore'});
  const timer=setTimeout(()=>{child.kill();reject(Error('disposable_pg_command_timeout'));},30000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('disposable_pg_command_failed_'+name));});
 });
 let sql,started=false;const services=[];
 try{
  await command('initdb',['-D',data,'--username=state_owner','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
  await fs.appendFile(path.join(data,'postgresql.conf'),"\nunix_socket_directories = ''\n");
  await command('pg_ctl',['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);started=true;
  const postgres=(await import(pathToFileURL(driver))).default;
  const connect=()=>postgres({host:'127.0.0.1',port,user:'state_owner',database:'postgres',max:4,onnotice:()=>{},connect_timeout:5,idle_timeout:10});
  sql=connect();
  await sql.unsafe(`create role anon;create role authenticated;create role service_role;
   create schema extensions;create extension pgcrypto with schema extensions;create schema destruktion_meta;
   create table ${setupTable}(operation_id uuid primary key,intent jsonb not null,state text not null,custody_id uuid,
    reason text,cleanup_state text not null default 'HOLD',created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp());
   create table destruktion_meta.native_coding_execution_h205f22(task_id uuid,lease_generation bigint,reservation_id uuid,callback_publication jsonb,primary key(task_id,lease_generation));
   create table destruktion_meta.native_coding_job_registration_h205f22(task_id uuid,lease_generation bigint,permit_id uuid,
    job_envelope jsonb,canonical_job_envelope text,job_envelope_sha256 text,result_receipt jsonb,canonical_result_receipt text,result_receipt_sha256 text,primary key(task_id,lease_generation));
   create table destruktion_meta.native_coding_operator_permit_h205f22(permit_id uuid primary key,permit jsonb);
   create table destruktion_meta.qa_physical_task_capacity(device_id uuid,key text primary key);
   create function destruktion_meta.native_coding_capacity_rows_v1(p_device uuid,p_client text) returns setof jsonb
   language sql as $$
    select jsonb_build_object('kind','SETUP','key',operation_id::text,'custody_id',custody_id,
     'durable_sha256',encode(extensions.digest(convert_to(to_jsonb(s)::text,'UTF8'),'sha256'),'hex'))
    from ${setupTable} s where s.intent#>>'{actor,device_id}'=p_device::text
    union all select jsonb_build_object('kind','TASK','key',e.task_id::text||':'||e.lease_generation::text,
     'durable_sha256',encode(extensions.digest(convert_to(jsonb_build_object('execution',to_jsonb(e),'registration',to_jsonb(j),'permit',to_jsonb(p))::text,'UTF8'),'sha256'),'hex'))
    from destruktion_meta.native_coding_execution_h205f22 e join destruktion_meta.native_coding_job_registration_h205f22 j using(task_id,lease_generation)
    join destruktion_meta.native_coding_operator_permit_h205f22 p on p.permit_id=j.permit_id
    where e.callback_publication#>>'{root,device_id}'=p_device::text
    union all select jsonb_build_object('kind','TASK','key',key,'durable_sha256',repeat('c',64))
    from destruktion_meta.qa_physical_task_capacity where device_id=p_device
   $$`);
  await sql.begin('isolation level serializable',tx=>tx.unsafe(source));
  const identity=async()=>{
   const [pg]=await sql.unsafe(`select current_setting('server_version_num')::int as version,
    (select system_identifier::text from pg_control_system()) as system_identifier,
    to_char(pg_postmaster_start_time() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as started_at`);
   assert.ok(pg.version>=170000&&pg.version<180000);
   return {...pg,pid:Number((await fs.readFile(path.join(data,'postmaster.pid'),'utf8')).split('\n')[0])};
  };
  const originalIdentity=await identity();
  const dataStat=await fs.stat(data,{bigint:true});
  const dataIdentity=sha({dev:String(dataStat.dev),ino:String(dataStat.ino)});
  const journalFailures=new Map();
  const factory=({pg,hostInstanceId=randomUUID(),db=sql,dataHash=dataIdentity,onRead=null,hostProof=null,mainProof=null}={})=>{
   const hostPid=process.pid,when=Date.now(),host=hostProof??birth(hostPid,when),main=mainProof??birth(hostPid+10000,when-1000);
   const native={host_process:main,postgres:{system_identifier:pg.system_identifier,
    postmaster:birth(pg.pid,Date.parse(pg.started_at)),data_directory_identity_sha256:dataHash}};
   const readNativeScope=async()=>{await onRead?.();return structuredClone(native);};
   const readProtectedReceipt=async({scope})=>JSON.parse(await fs.readFile(path.join(directory,'generated-protected',scope.task_id,'receipt.json'),'utf8'));
   const readCallbackClosure=async({scope})=>{
    const failure=journalFailures.get(scope.task_id);
    if(failure&&++failure.calls===failure.at)throw Error('GENERATED_TEST_PROTECTED_JOURNAL_UNAVAILABLE');
    return JSON.parse(await fs.readFile(path.join(directory,'generated-protected',scope.task_id,'journal.json'),'utf8'));
   };
   const service=createNativeCodingPhysicalCustody({sql:db,hostInstanceId,hostPid,postgresIdentity:pg,
    readNativeScope,readPublicationHost:async()=>structuredClone(host),readProtectedReceipt,readCallbackClosure});
   services.push(service);return {service,hostInstanceId,hostPid,host,main,native,pg:structuredClone(pg)};
  };
  const original=factory({pg:originalIdentity});
  const actor=()=>({device_id:randomUUID(),client_id:'generated-physical-fixture-'+randomUUID(),
   admin_grant_epoch:1,key_fingerprint_sha256:sha(randomUUID())});
  const generatedPair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  function frame(owner,a,operationId){
   const body={host_instance_id:owner.hostInstanceId,host_pid:owner.hostPid,operation:'BEGIN_NATIVE_SETUP_V1',
    input:{operation_id:operationId,workspace_id:randomUUID()}};
   const bodySha=sha(body),stamp=new Date().toISOString(),nonce=randomUUID().replaceAll('-','');
   const material=['A2_DEVICE_HTTP_SIGNATURE_V1',`device_id:${a.device_id}`,'method:POST','path:/private/native-coding/begin-native-setup-v1',
    `timestamp:${stamp}`,`nonce:${nonce}`,`body_sha256:${bodySha}`].join('\n');
   return {schema:'metaengine.native-coding.host-ipc.request.v1',instance_id:owner.hostInstanceId,host_pid:owner.hostPid,
    request_id:randomUUID(),action:'BEGIN_NATIVE_SETUP_V1',payload:{body,headers:{'content-type':'application/json',
     'x-a2-device-id':a.device_id,'x-a2-chat-bridge-client':a.client_id,'x-a2-device-profile':'A2_DEVICE_HTTP_SIGNATURE_V1',
     'x-a2-device-timestamp':stamp,'x-a2-device-nonce':nonce,'x-a2-device-body-sha256':bodySha,
     'x-a2-device-signature':sign('sha256',Buffer.from(material),{key:generatedPair.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')}}};
  }
  async function insertSetup(owner,a,operationId,custodyId,input={operation_id:operationId,workspace_id:randomUUID()}){
   const intent={...input,operation_id:operationId,actor:a,
    host_instance_id:owner.hostInstanceId,host_pid:owner.hostPid,
    postgres:{system_identifier:owner.pg.system_identifier,version:owner.pg.version,
     data_directory_identity_sha256:owner.native.postgres.data_directory_identity_sha256,
     postmaster:{pid:owner.pg.pid,started_at_us:owner.pg.started_at}},
    repository:{repo_id:'generated-repository',repo_root:'/generated/repo',managed_root:'/generated/managed'}};
   const [row]=await sql.unsafe(`insert into ${setupTable}(operation_id,intent,state,custody_id,reason,cleanup_state)
    values($1::uuid,$2::text::jsonb,'HOLD',$3::uuid,'MATERIALIZATION_UNAVAILABLE','DRAINED') returning to_jsonb(${setupTable.split('.')[1]}) as value`,
    [operationId,json(intent),custodyId]);return row.value;
  }
  async function prepare({owner=original,a=actor(),terminal=true,seal=true,inputOperationId=null}={}){
   const operationId=randomUUID(),custodyId=randomUUID(),packet=frame(owner,a,inputOperationId??operationId);
   const ticket=await owner.service.beginRequest(packet);
   const operation=await insertSetup(owner,a,operationId,custodyId,packet.payload.body.input);
   const origin={requestId:packet.request_id,requestDigest:sha(packet)};
   let closure=null;if(seal)closure=await owner.service.sealSetup({operationId,custodyId,actor:a,request:origin});
   if(terminal)await owner.service.endRequest(ticket);
   return {a,operationId,custodyId,packet,ticket,origin,operation,closure};
  }
  async function forgedClosure(f,change,kind='SETUP'){
   const [saved]=await sql.unsafe(`select request from ${requestTable} where request_id=$1::uuid`,[f.packet.request_id]);
   const r=saved.request,c={schema:'metaengine.native-coding.physical-setup-closure.v1',operation:f.operation,
    request_id:r.frame.request_id,request_sha256:r.request_sha256,host:r.host,postgres:r.postgres,main_birth:r.main_birth,
    automatic_retry_allowed:false,authority_effect:false};
   change(c);
   await sql.begin('isolation level serializable',tx=>tx.unsafe(`insert into ${closureTable}(kind,key,closure) values($1,$2,$3::text::jsonb)`,[kind,f.operationId,json(c)]));
   return c;
  }
  let generation=0;
  async function observe(owner,a){
   const evidence={host_instance_id:owner.hostInstanceId,generation:++generation,observed_at:new Date().toISOString(),
    postgres_scope_sha256:sha({postgres:owner.native.postgres,started_at:owner.pg?.started_at??'current'})};
   const count=await sql.begin('isolation level serializable',async tx=>{
    await tx.unsafe('set local synchronous_commit=on');return owner.service.verifyObservation({tx,actor:a,evidence});
   });
   const resolutions=await sql.unsafe(`select * from ${resolutionTable} where device_id=$1::uuid and host_instance_id=$2::uuid and generation=$3::bigint`,
    [a.device_id,owner.hostInstanceId,evidence.generation]);
   const retained=await sql.unsafe(`select r as row from destruktion_meta.native_coding_capacity_rows_v1($1::uuid,$2::text) r
    where not exists(select 1 from ${resolutionTable} x where x.device_id=$1::uuid and x.host_instance_id=$3::uuid
     and x.generation=$4::bigint and x.kind=r->>'kind' and x.key=r->>'key' and x.durable_sha256=r->>'durable_sha256')`,
    [a.device_id,a.client_id,owner.hostInstanceId,evidence.generation]);
   return {count,resolutions:Array.from(resolutions),retained:Array.from(retained).map(x=>x.row)};
  }
  const positive=await prepare(),incomplete=await prepare({terminal:false});
  const negatives=[];
  await t.test('producer requires the original request digest and scope before creating a closure',async()=>{
   const f=await prepare({terminal:false,seal:false});
   await assert.rejects(original.service.sealSetup({operationId:f.operationId,custodyId:f.custodyId,actor:f.a,
    request:{...f.origin,requestDigest:'0'.repeat(64)}}),/native_physical_custody_setup_origin/);
   const scoped=await prepare({terminal:false,seal:false,inputOperationId:randomUUID()});
   await assert.rejects(original.service.sealSetup({operationId:scoped.operationId,custodyId:scoped.custodyId,actor:scoped.a,
    request:scoped.origin}),/native_physical_custody_setup_readback/);
   const workspace=await prepare({seal:false});
   const [changed]=await sql.unsafe(`update ${setupTable} set intent=jsonb_set(intent,'{workspace_id}',to_jsonb($2::text))
    where operation_id=$1::uuid returning to_jsonb(${setupTable.split('.')[1]}) as value`,[workspace.operationId,randomUUID()]);
   workspace.operation=changed.value;
   await assert.rejects(original.service.sealSetup({operationId:workspace.operationId,custodyId:workspace.custodyId,actor:workspace.a,
    request:workspace.origin}),/native_physical_custody_setup_readback/);
   await forgedClosure(workspace,()=>{});
   assert.equal((await observe(original,f.a)).count,0);assert.equal((await observe(original,scoped.a)).count,0);
   assert.equal((await observe(original,workspace.a)).count,0);negatives.push(f,scoped,workspace);
   for(const change of [pg=>{pg.system_identifier='9999999999999999999';},pg=>{pg.data_directory_identity_sha256='0'.repeat(64);},
    pg=>{pg.postmaster.pid++;},pg=>{pg.postmaster.started_at_us=pg.postmaster.started_at_us.replace(/\dZ$/,'9Z');
     if(pg.postmaster.started_at_us===originalIdentity.started_at)pg.postmaster.started_at_us=pg.postmaster.started_at_us.replace(/9Z$/,'8Z');}]){
    const mismatch=await prepare({seal:false}),intent=structuredClone(mismatch.operation.intent);change(intent.postgres);
    const [changed]=await sql.unsafe(`update ${setupTable} set intent=$2::text::jsonb where operation_id=$1::uuid
     returning to_jsonb(${setupTable.split('.')[1]}) as value`,[mismatch.operationId,json(intent)]);
    mismatch.operation=changed.value;
    await assert.rejects(original.service.sealSetup({operationId:mismatch.operationId,custodyId:mismatch.custodyId,
     actor:mismatch.a,request:mismatch.origin}),/native_physical_custody_setup_postgres_lineage/);
    // A coherent closure and fresh durable-row digest cannot repair an intent
    // whose PG lineage differs from the original native request observation.
    await forgedClosure(mismatch,()=>{});
    const result=await observe(original,mismatch.a);assert.equal(result.count,0);assert.equal(result.retained.length,1);negatives.push(mismatch);
   }
  });
  await t.test('SQL DRAINED, a held terminal and changed durable setup do not become settlement',async()=>{
   const drained=await prepare({seal:false});negatives.push(drained);
   const held=await prepare({terminal:false});await original.service.endRequest(held.ticket,true);negatives.push(held);
   const changed=await prepare();
   await sql.unsafe(`update ${setupTable} set reason='CHANGED_AFTER_CLOSURE',updated_at=clock_timestamp() where operation_id=$1::uuid`,[changed.operationId]);negatives.push(changed);
   for(const f of [drained,held,changed]){const result=await observe(original,f.a);assert.equal(result.count,0);assert.equal(result.retained.length,1);}
  });
  await t.test('independent consumer rejects forged digest/Host/original scope, truncated closure and wrong kind',async()=>{
   for(const change of [c=>{c.request_sha256='0'.repeat(64);},c=>{c.host.instance_id=randomUUID();},c=>{delete c.operation;},
    c=>{c.postgres.data_directory_identity_sha256='0'.repeat(64);},c=>{c.main_birth='pid:999:created_100ns:134000000000000000';}]){
    const f=await prepare({seal:false});await forgedClosure(f,change);negatives.push(f);
   }
   const scope=await prepare({seal:false,inputOperationId:randomUUID()});await forgedClosure(scope,()=>{});negatives.push(scope);
   const wrongKind=await prepare({seal:false});await forgedClosure(wrongKind,()=>{},'TASK');negatives.push(wrongKind);
   await sql.unsafe('insert into destruktion_meta.qa_physical_task_capacity(device_id,key) values($1::uuid,$2)',[wrongKind.a.device_id,wrongKind.operationId]);
   for(const f of negatives){const result=await observe(original,f.a);assert.equal(result.count,0);assert.ok(result.retained.length>=1);}
  });
  const taskPostgres={system_identifier:originalIdentity.system_identifier,started_at:originalIdentity.started_at,pid:originalIdentity.pid,
   process_incarnation_id:original.native.postgres.postmaster.process_incarnation_id,data_directory_identity_sha256:dataIdentity};
  async function prepareTask({terminal=true,extraCallback=false}={}){
   const f=nativePhysicalTaskFixture({outcome:'UNKNOWN',postgres:taskPostgres,
    host:{...original.host,instance_id:original.hostInstanceId},mainBirth:original.main.process_incarnation_id});
   const r=f.publication.root,s=r.scope;
   await sql.unsafe('insert into destruktion_meta.native_coding_operator_permit_h205f22(permit_id,permit) values($1::uuid,$2::text::jsonb)',[r.permit_id,json(f.permit)]);
   await sql.unsafe(`insert into destruktion_meta.native_coding_execution_h205f22(task_id,lease_generation,reservation_id,callback_publication)
    values($1::uuid,$2::bigint,$3::uuid,$4::text::jsonb)`,[s.task_id,s.lease_generation,s.reservation_id,json(f.publication)]);
   await sql.unsafe(`insert into destruktion_meta.native_coding_job_registration_h205f22(task_id,lease_generation,permit_id,
    job_envelope,canonical_job_envelope,job_envelope_sha256,result_receipt,canonical_result_receipt,result_receipt_sha256)
    values($1::uuid,$2::bigint,$3::uuid,$4::text::jsonb,$4::text,$5::text,$6::text::jsonb,$6::text,$7::text)`,
    [s.task_id,s.lease_generation,r.permit_id,json(f.job),sha(f.job),json(f.receipt),sha(f.receipt)]);
   const protectedDirectory=path.join(directory,'generated-protected',s.task_id);await fs.mkdir(protectedDirectory,{recursive:true});
   await fs.writeFile(path.join(protectedDirectory,'receipt.json'),json(f.receipt)+'\n');
   await fs.writeFile(path.join(protectedDirectory,'journal.json'),json(f.journal)+'\n');
   const reserveTicket=await original.service.beginRequest(f.reserve.request.frame);await original.service.endRequest(reserveTicket);
   const callbackTicket=await original.service.beginRequest(f.requests[0].request.frame);
   if(terminal)await original.service.endRequest(callbackTicket);
   if(extraCallback){
    const extra=structuredClone(f.requests[0].request.frame);extra.request_id=randomUUID();
    const ticket=await original.service.beginRequest(extra);await original.service.endRequest(ticket);
   }
   return {...f,a:{device_id:r.device_id,client_id:r.client_id,admin_grant_epoch:r.admin_grant_epoch,key_fingerprint_sha256:r.key_sha256},
    scope:s,protectedDirectory,callbackTicket};
  }
  let taskPositive;const taskNegatives=[];
  await t.test('TASK producer joins actual original reserve/callback terminal with anchored helper and callback closure; UNKNOWN does not replay',async()=>{
   taskPositive=await prepareTask();
   const ack=await original.service.sealTask(taskPositive.scope);
   assert.equal(ack.proof_sha256,sha(taskPositive.closure));assert.equal(ack.automatic_retry_allowed,false);assert.equal(ack.authority_effect,false);
   const late=structuredClone(taskPositive.requests[0].request.frame);late.request_id=randomUUID();
   await assert.rejects(original.service.beginRequest(late),/run_fenced/);
   const [stored]=await sql.unsafe(`select closure from ${closureTable} where kind='TASK' and key=$1::text`,
    [`${taskPositive.scope.task_id}:${taskPositive.scope.lease_generation}`]);
   assert.deepEqual(stored.closure,taskPositive.closure);
  });
  await t.test('TASK producer refuses missing actual terminal and omitted original dispatch despite a complete helper/local journal',async()=>{
   const missing=await prepareTask({terminal:false});
   await assert.rejects(original.service.sealTask(missing.scope),/native_physical_custody_terminal_missing/);taskNegatives.push(missing);
   const omitted=await prepareTask({extraCallback:true});
   await assert.rejects(original.service.sealTask(omitted.scope),/native_physical_custody_journal_truncated/);taskNegatives.push(omitted);
   for(const f of taskNegatives){const observed=await observe(original,f.a);assert.equal(observed.count,0);assert.equal(observed.retained.length,1);}
  });
  const recoveredTasks=[];let deferredTask,foreignFenceTask;
  await t.test('lost fence COMMIT ACK reads the exact committed fence and seals proof without dispatch replay',async()=>{
   const f=await prepareTask();let fenceWrites=0,ackLosses=0;
   const losing={unsafe:(...args)=>sql.unsafe(...args),begin:async(mode,body)=>{
    let fence=false;const value=await sql.begin(mode,tx=>body({unsafe:(statement,...args)=>{
     if(statement.startsWith(`insert into ${fenceTable}(`)){fence=true;fenceWrites++;}
     return tx.unsafe(statement,...args);
    }}));
    if(fence&&ackLosses++===0)throw Error('GENERATED_TEST_LOST_FENCE_COMMIT_ACK');return value;
   }};
   const recovering=factory({pg:originalIdentity,db:losing});
   const [beforeRequests]=await sql.unsafe(`select count(*)::int as count from ${requestTable}`);
   const ack=await recovering.service.sealTask(f.scope);
   assert.equal(ack.proof_sha256,sha(f.closure));assert.equal(fenceWrites,1);assert.equal(ackLosses,1);
   const [fence]=await sql.unsafe(`select * from ${fenceTable} where run_id=$1::uuid`,[f.publication.root.run_id]);
   assert.equal(fence.host_instance_id,original.hostInstanceId);
   assert.notEqual(recovering.hostInstanceId,original.hostInstanceId);
   const [afterRequests]=await sql.unsafe(`select count(*)::int as count from ${requestTable}`);
   assert.deepEqual(afterRequests,beforeRequests);recoveredTasks.push(f);
  });
  await t.test('proof failure after a durable fence permits proof-only recovery on the same Host without changing the fence',async()=>{
   const f=await prepareTask();journalFailures.set(f.scope.task_id,{calls:0,at:2});
   await assert.rejects(original.service.sealTask(f.scope),/GENERATED_TEST_PROTECTED_JOURNAL_UNAVAILABLE/);
   const [beforeFence]=await sql.unsafe(`select to_jsonb(f) as value from ${fenceTable} f where run_id=$1::uuid`,[f.publication.root.run_id]);
   assert.equal(beforeFence.value.host_instance_id,original.hostInstanceId);
   const absent=await sql.unsafe(`select key from ${closureTable} where kind='TASK' and key=$1`,[`${f.scope.task_id}:${f.scope.lease_generation}`]);
   assert.equal(absent.length,0);
   const [beforeRequests]=await sql.unsafe(`select count(*)::int as count from ${requestTable}`);
   const ack=await original.service.sealTask(f.scope);assert.equal(ack.proof_sha256,sha(f.closure));
   const [afterFence]=await sql.unsafe(`select to_jsonb(f) as value from ${fenceTable} f where run_id=$1::uuid`,[f.publication.root.run_id]);
   assert.deepEqual(afterFence,beforeFence);
   const [afterRequests]=await sql.unsafe(`select count(*)::int as count from ${requestTable}`);assert.deepEqual(afterRequests,beforeRequests);
   recoveredTasks.push(f);
  });
  await t.test('SETTLED original RESULT_READY survives a post-fence proof failure for later proof-only collection',async()=>{
   deferredTask=await prepareTask();const f=deferredTask;journalFailures.set(f.scope.task_id,{calls:0,at:2});
   const advance={schema:'metaengine.native-coding.host-ipc.request.v1',instance_id:original.hostInstanceId,host_pid:original.hostPid,
    request_id:randomUUID(),action:'ADVANCE_EXECUTION',payload:{scope:f.scope,transition:{from:'ATTEMPTED',to:'RESULT_READY',
     evidence_sha256:sha(f.receipt),critic_proof_sha256:null,checkpoint_sha256:null,result_receipt:f.receipt}}};
   const ticket=await original.service.beginRequest(advance);await original.service.endRequest(ticket);
   const [record]=await sql.unsafe(`select request,terminal from ${requestTable} where request_id=$1::uuid`,[advance.request_id]);
   assert.deepEqual(record.request.frame,advance);assert.equal(record.terminal.state,'SETTLED');
   assert.equal((await sql.unsafe(`select key from ${closureTable} where kind='TASK' and key=$1`,[`${f.scope.task_id}:${f.scope.lease_generation}`])).length,0);
   const [fence]=await sql.unsafe(`select host_instance_id from ${fenceTable} where run_id=$1::uuid`,[f.publication.root.run_id]);
   assert.equal(fence.host_instance_id,original.hostInstanceId);
   assert.equal((await observe(original,f.a)).count,0);
  });
  await t.test('an existing fence with another original Host is refused and its retained history is never overwritten',async()=>{
   foreignFenceTask=await prepareTask();const f=foreignFenceTask,foreign=randomUUID();
   await sql.begin('isolation level serializable',tx=>tx.unsafe(`insert into ${fenceTable}(run_id,host_instance_id) values($1::uuid,$2::uuid)`,[f.publication.root.run_id,foreign]));
   const [beforeFence]=await sql.unsafe(`select to_jsonb(f) as value from ${fenceTable} f where run_id=$1::uuid`,[f.publication.root.run_id]);
   await assert.rejects(original.service.sealTask(f.scope),/native_physical_custody_fence_changed/);
   const [afterFence]=await sql.unsafe(`select to_jsonb(f) as value from ${fenceTable} f where run_id=$1::uuid`,[f.publication.root.run_id]);
   assert.deepEqual(afterFence,beforeFence);assert.equal((await observe(original,f.a)).count,0);
  });
  await t.test('a dispatch with an older SERIALIZABLE snapshot cannot pass a newly committed run fence after waiting on its lock',async()=>{
   const f=await prepareTask();
   let fenceInserted,releaseFence,snapshotAssigned;const held=new Promise(resolve=>{fenceInserted=resolve;}),
    fenceMayCommit=new Promise(resolve=>{releaseFence=resolve;}),snapshotReady=new Promise(resolve=>{snapshotAssigned=resolve;});
   const sealing={unsafe:(...args)=>sql.unsafe(...args),begin:(mode,body)=>sql.begin(mode,tx=>body({unsafe:async(statement,...args)=>{
    const result=await tx.unsafe(statement,...args);
    if(statement.startsWith(`insert into ${fenceTable}(`)){fenceInserted();await fenceMayCommit;}
    return result;
   }}))};
   // Pause the actual producer after its fence INSERT and before COMMIT,
   // preserving its native validation, run lock and MVCC effect barrier.
   const sealer=factory({pg:originalIdentity,db:sealing});
   const fenceWork=Promise.allSettled([sealer.service.sealTask(f.scope)]);
   await held;
   // Assign an actual PG MVCC snapshot while the peer still owns the run lock.
   // Advisory exclusion cannot by itself refresh this transaction's snapshot.
   const older={unsafe:(...args)=>sql.unsafe(...args),begin:(mode,body)=>sql.begin(mode,async tx=>{
    await tx.unsafe('select txid_current_snapshot()');snapshotAssigned();return body(tx);
   })};
   const owner=factory({pg:originalIdentity,hostInstanceId:original.hostInstanceId,db:older,hostProof:original.host,mainProof:original.main});
   const late=structuredClone(f.requests[0].request.frame);late.request_id=randomUUID();
   const pending=Promise.allSettled([owner.service.beginRequest(late)]);await snapshotReady;releaseFence();
   const [outcome]=await pending,[sealed]=await fenceWork;
   if(outcome.status==='fulfilled'){
    await owner.service.endRequest(outcome.value);
    assert.fail('a dispatch ticket was issued after the durable fence committed because the older snapshot missed it');
   }
   assert.match(outcome.reason.message,/run_fenced|could not serialize access|fence_changed/);
   assert.equal(sealed.status,'fulfilled');assert.equal(sealed.value.proof_sha256,sha(f.closure));
   assert.equal((await sql.unsafe(`select request_id from ${requestTable} where request_id=$1::uuid`,[late.request_id])).length,0);
   recoveredTasks.push(f);
  });
  await t.test('close fences new producers; drain joins the original pending ticket and exact terminal SQL after close',async()=>{
   let release,reached;const blocked=new Promise(resolve=>{release=resolve;}),arrived=new Promise(resolve=>{reached=resolve;});
   const holding={unsafe:(...args)=>sql.unsafe(...args),begin:(mode,body)=>sql.begin(mode,tx=>body({unsafe:async(statement,...args)=>{
    if(statement.startsWith(`update ${requestTable} set terminal=`)){reached();await blocked;}
    return tx.unsafe(statement,...args);
   }}))};
   const owner=factory({pg:originalIdentity,db:holding}),a=actor(),packet=frame(owner,a,randomUUID());
   const ticket=await owner.service.beginRequest(packet);assert.equal(owner.service.snapshot().pending_requests,1);
   owner.service.close();let drained=false;const drain=owner.service.drain();drain.then(()=>{drained=true;},()=>{drained=true;});
   await assert.rejects(owner.service.beginRequest(frame(owner,a,randomUUID())),/native_physical_custody_closed/);
   await new Promise(resolve=>setImmediate(resolve));assert.equal(drained,false);
   const ending=owner.service.endRequest(ticket);await arrived;
   assert.equal(owner.service.snapshot().pending_requests,1);assert.equal(owner.service.snapshot().active_work,1);assert.equal(drained,false);
   release();await ending;await drain;
   assert.deepEqual(owner.service.snapshot(),{closed:true,pending_requests:0,active_work:0,cleanup_unconfirmed:false});
   const [record]=await sql.unsafe(`select request,terminal from ${requestTable} where request_id=$1::uuid`,[packet.request_id]);
   assert.deepEqual(record.request.frame,packet);assert.equal(record.terminal.state,'SETTLED');assert.equal(record.terminal.request_sha256,sha(packet));
  });
  await t.test('a physically held original terminal prevents successful service drain after close',async()=>{
   const owner=factory({pg:originalIdentity}),a=actor(),packet=frame(owner,a,randomUUID());
   const ticket=await owner.service.beginRequest(packet);await owner.service.endRequest(ticket,true);owner.service.close();
   await assert.rejects(owner.service.drain(),error=>nativePhysicalSettlementUnconfirmed(error));
   assert.equal(owner.service.snapshot().cleanup_unconfirmed,true);
  });
  let ackLost;
  await t.test('lost terminal COMMIT acknowledgement retains UNKNOWN without replay; committed bytes remain independently readable',async()=>{
   let writes=0;
   const losing={unsafe:(...args)=>sql.unsafe(...args),begin:async(mode,body)=>{
    let terminal=false;const value=await sql.begin(mode,tx=>body({unsafe:(statement,...args)=>{
     if(statement.startsWith(`update ${requestTable} set terminal=`)){terminal=true;writes++;}
     return tx.unsafe(statement,...args);
    }}));
    if(terminal)throw Error('GENERATED_TEST_LOST_TERMINAL_COMMIT_ACK');return value;
   }};
   const owner=factory({pg:originalIdentity,hostInstanceId:original.hostInstanceId,db:losing});
   ackLost=await prepare({owner,terminal:false});
   await assert.rejects(owner.service.endRequest(ackLost.ticket),error=>nativePhysicalSettlementUnconfirmed(error));
   await assert.rejects(owner.service.endRequest(ackLost.ticket),/original_ticket_required/);assert.equal(writes,1);
   const [stored]=await sql.unsafe(`select request,terminal from ${requestTable} where request_id=$1::uuid`,[ackLost.packet.request_id]);
   assert.deepEqual(stored.request.frame,ackLost.packet);assert.equal(stored.terminal.state,'SETTLED');
   assert.equal(stored.terminal.request_sha256,sha(ackLost.packet));
   assert.equal(ackLost.closure.automatic_retry_allowed,false);assert.equal(ackLost.closure.authority_effect,false);
   owner.service.close();await assert.rejects(owner.service.drain(),error=>nativePhysicalSettlementUnconfirmed(error));
   assert.equal(owner.service.snapshot().cleanup_unconfirmed,true);
  });
  const [before]=await sql.unsafe(`select (select count(*)::int from ${requestTable}) as requests,
   (select count(*)::int from ${closureTable}) as closures,
   (select jsonb_agg(to_jsonb(r) order by request_id) from ${requestTable} r) as request_bytes,
   (select jsonb_agg(to_jsonb(c) order by kind,key) from ${closureTable} c) as closure_bytes,
   (select jsonb_agg(to_jsonb(f) order by run_id) from ${fenceTable} f) as fence_bytes`);
  await sql.end({timeout:5});sql=null;
  await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  await command('pg_ctl',['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);sql=connect();
  const restartedIdentity=await identity();
  assert.equal(restartedIdentity.system_identifier,originalIdentity.system_identifier);
  assert.notEqual(restartedIdentity.started_at,originalIdentity.started_at);
  const current=factory({pg:restartedIdentity});assert.notEqual(current.hostInstanceId,original.hostInstanceId);
  await t.test('new Host prepareClosures finishes only original settled RESULT_READY proofs and reuses the unchanged original fence',async()=>{
   await current.service.prepareClosures();
   const result=await observe(current,deferredTask.a);assert.equal(result.count,1);assert.equal(result.retained.length,0);
   assert.equal(result.resolutions[0].proof_sha256,sha(deferredTask.closure));
   const foreign=await observe(current,foreignFenceTask.a);assert.equal(foreign.count,0);assert.equal(foreign.retained.length,1);
   await assert.rejects(current.service.sealTask(foreignFenceTask.scope),/native_physical_custody_fence_changed/);
   const foreignData=factory({pg:restartedIdentity,dataHash:'0'.repeat(64)});
   await assert.rejects(foreignData.service.sealTask(deferredTask.scope),/native_physical_custody_task_data_lineage/);
  });
  await t.test('new Host independently verifies the original full SETUP closure after same-cluster restart',async()=>{
   const result=await observe(current,positive.a);assert.equal(result.count,1);assert.equal(result.retained.length,0);
   assert.equal(result.resolutions[0].key,positive.operationId);assert.equal(result.resolutions[0].proof_sha256,sha(positive.closure));
   assert.equal(result.resolutions[0].host_instance_id,current.hostInstanceId);
   assert.equal(positive.closure.host.instance_id,original.hostInstanceId);
   assert.equal(positive.closure.postgres.started_at,originalIdentity.started_at);
   const lost=await observe(current,ackLost.a);assert.equal(lost.count,1);assert.equal(lost.retained.length,0);
  });
  await t.test('new Host independently verifies durable TASK closure, full callback terminals and protected helper bytes after restart',async()=>{
   const result=await observe(current,taskPositive.a);assert.equal(result.count,1);assert.equal(result.retained.length,0);
   assert.equal(result.resolutions[0].kind,'TASK');assert.equal(result.resolutions[0].proof_sha256,sha(taskPositive.closure));
   assert.deepEqual(JSON.parse(await fs.readFile(path.join(taskPositive.protectedDirectory,'receipt.json'),'utf8')),taskPositive.receipt);
   assert.equal(taskPositive.journal.projection.caller_unknown,1);
   for(const f of recoveredTasks){const recovered=await observe(current,f.a);assert.equal(recovered.count,1);assert.equal(recovered.retained.length,0);}
   for(const f of taskNegatives){const negative=await observe(current,f.a);assert.equal(negative.count,0);assert.equal(negative.retained.length,1);}
  });
  await t.test('missing/held terminal, forged or truncated closures, changed rows and lineage remain occupied after restart',async()=>{
   for(const f of [incomplete,...negatives]){const result=await observe(current,f.a);assert.equal(result.count,0);assert.ok(result.retained.length>=1);}
   const foreignRoot=factory({pg:restartedIdentity,dataHash:'0'.repeat(64)});
   assert.equal((await observe(foreignRoot,positive.a)).count,0);
   assert.equal((await observe(current,{...positive.a,admin_grant_epoch:2})).count,0);
   assert.equal((await observe(current,{...positive.a,key_fingerprint_sha256:'0'.repeat(64)})).count,0);
  });
  await t.test('new concurrent setup occupancy is retained while only the exact historical closure resolves',async()=>{
   let reached,release;const blocked=new Promise(resolve=>{release=resolve;}),arrived=new Promise(resolve=>{reached=resolve;});let hold=true;
   const reading=factory({pg:restartedIdentity,onRead:async()=>{if(hold){hold=false;reached();await blocked;}}});
   const pending=observe(reading,positive.a);await arrived;
   const operationId=randomUUID();try{await insertSetup(reading,positive.a,operationId,randomUUID());}finally{release();}
   const result=await pending;assert.equal(result.count,1);assert.deepEqual(result.resolutions.map(x=>x.key),[positive.operationId]);
   assert.deepEqual(result.retained.map(x=>x.key),[operationId]);
   const fresh=await observe(current,positive.a);assert.equal(fresh.count,1);assert.deepEqual(fresh.retained.map(x=>x.key),[operationId]);
  });
  const [after]=await sql.unsafe(`select (select count(*)::int from ${requestTable}) as requests,
   (select count(*)::int from ${closureTable}) as closures,
   (select jsonb_agg(to_jsonb(r) order by request_id) from ${requestTable} r) as request_bytes,
   (select jsonb_agg(to_jsonb(c) order by kind,key) from ${closureTable} c) as closure_bytes,
   (select jsonb_agg(to_jsonb(f) order by run_id) from ${fenceTable} f) as fence_bytes`);
  assert.equal(after.requests,before.requests,'proof-only recovery must never replay an original dispatch');
  assert.deepEqual(after.request_bytes,before.request_bytes,'restart/consumer must preserve every original request and terminal byte');
  assert.deepEqual(after.fence_bytes,before.fence_bytes,'proof-only recovery must reuse immutable original fences');
  const originalClosureKeys=new Set(before.closure_bytes.map(x=>`${x.kind}:${x.key}`));
  assert.equal(after.closures,before.closures+1,'only the pending original RESULT_READY proof may append a closure');
  assert.deepEqual(after.closure_bytes.filter(x=>originalClosureKeys.has(`${x.kind}:${x.key}`)),before.closure_bytes,'every pre-restart closure byte must remain unchanged');
  await fs.writeFile(path.join(directory,'qualification.json'),json({schema:'metaengine.native-physical-custody.restart-qualification.v1',
   platform:process.platform,postgres_version:restartedIdentity.version,original_postgres:originalIdentity,restarted_postgres:restartedIdentity,
   original_host_instance:original.hostInstanceId,restarted_host_instance:current.hostInstanceId,generated_os_fixtures:true,
   windows_qualified:false,automatic_retry_allowed:false,authority_effect:false})+'\n');
  t.diagnostic('disposable_receipt_directory='+directory);
 }finally{
  for(const service of services)service.close();await sql?.end({timeout:5});
  if(started)await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
 }
});
