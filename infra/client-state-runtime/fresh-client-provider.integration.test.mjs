// Private transaction helper qualification only; NOT production consent or full
// owning-provider E2E proof. The test-only loader appends a test export.
// Test factories own every credential, connection and disposable cluster. No URI
// to an existing database is accepted. WASM is supplemental, never PG17/OS proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {populateFreshClientSchema} from './test/fresh-provider-private-loader.mjs';
import {verifyFreshConnectionIdentity} from './fresh-client-provider.mjs';
import {loadFreshSchemaApplicationPlan} from './fresh-schema-application-plan.mjs';
import {inspectAttachedApiAdmission} from './attached-postgres-onboarding.mjs';
const exec=promisify(execFile);
const wasm=process.env.METAENGINE_PGLITE_MODULE,cryptoModule=process.env.METAENGINE_PGLITE_PGCRYPTO_MODULE;

test('actual fresh population rolls back identity drift and atomically installs schema in supplemental PG18 WASM',{
 skip:!wasm||!cryptoModule,timeout:180000,
},async()=>{
 const {PGlite}=await import(wasm);const {pgcrypto}=await import(cryptoModule);
 const db=new PGlite({extensions:{pgcrypto}});
 const sql={unsafe:async(q,args)=>args?.length?(await db.query(q,args)).rows:(await db.exec(q)).at(-1)?.rows||[]};
 try {
  await db.exec('CREATE ROLE state_owner SUPERUSER; SET SESSION AUTHORIZATION state_owner');
  const plan=await loadFreshSchemaApplicationPlan();const password=randomBytes(32).toString('hex');let checks=0;
  await assert.rejects(populateFreshClientSchema({connection:sql,plan,apiPassword:password,verifyIdentity:async()=>{if(++checks===2)throw Error('changed before commit');}}),/population_unconfirmed/);
  assert.equal(checks,2);assert.deepEqual((await db.query("select rolname from pg_roles where rolname in ('anon','authenticated','service_role','local_state_api')")).rows,[]);
  assert.deepEqual((await db.query("select nspname from pg_namespace where nspname in ('destruktion_meta','extensions')")).rows,[]);
  const receipt=await populateFreshClientSchema({connection:sql,plan,apiPassword:password,verifyIdentity:async()=>{
    const [row]=await sql.unsafe('select current_user as login,session_user as session_login');assert.equal(row.login,'state_owner');assert.equal(row.session_login,'state_owner');}});
  assert.equal(receipt.schema_provisioned,true);assert.equal(receipt.device_enrolled,false);
  // Session authorization below verifies real ACLs but is NOT a separate login,
  // network/password or native Windows qualification.
  await db.exec('SET SESSION AUTHORIZATION local_state_api');
  const admission=await inspectAttachedApiAdmission({sql,apiLogin:'local_state_api'});assert.equal(admission.restricted_login,true);
  for(const query of ['select public.h205f22_a2_browser_device_enrollment_approve_v1(null)','select public.h205f22_a2_supervisor_mesh_heartbeat_v1(null,null,null)'])await assert.rejects(sql.unsafe(query),e=>e.code==='42501');
 }finally{await db.close();}
});

test('factory-owned PG17 uses actual state_owner and independent restricted API password login',{
 skip:!process.env.METAENGINE_PG_TEST_BIN||!process.env.METAENGINE_PG_TEST_DRIVER,timeout:240000,
},async()=>{
 const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
 assert(path.isAbsolute(bin)&&path.isAbsolute(driver));
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fresh-provider-pg17-'));const data=path.join(root,'pg17');
 const ownerPassword=randomBytes(32).toString('hex'),apiPassword=randomBytes(32).toString('hex');
 const passwordFile=path.join(root,'password');await fs.writeFile(passwordFile,ownerPassword+'\n',{flag:'wx',mode:0o600});
 const command=(name,args)=>exec(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,
  {env:Object.fromEntries(Object.entries({...process.env,LC_ALL:'C',LANG:'C'}).filter(([key])=>!/^PG/i.test(key))),shell:false,windowsHide:true,timeout:120000,maxBuffer:65536});
 let started=false,sql,api,reserved;
 try {
  const listener=net.createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
  const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  await command('initdb',['-D',data,'--username=state_owner','--auth=scram-sha-256',`--pwfile=${passwordFile}`,'--no-locale','--encoding=UTF8','--no-sync']);
  const identifier=/Database system identifier:\s*([0-9]+)/.exec((await command('pg_controldata',['-D',data])).stdout)?.[1];assert(identifier);
  started=true;await command('pg_ctl',['-D',data,'-l',path.join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -c unix_socket_directories=''`,'-w','start']);
  const postgres=(await import(pathToFileURL(driver))).default;
  const connect=(user,password)=>postgres({host:'127.0.0.1',port,user,password,database:'postgres',max:1,prepare:false,connect_timeout:5,onnotice:()=>{}});
  sql=connect('state_owner',ownerPassword);reserved=await sql.reserve();
  const pidBytes=await fs.readFile(path.join(data,'postmaster.pid'),'utf8');const lines=pidBytes.trim().split(/\r?\n/);
  const expected={directory:await fs.realpath(data),systemIdentifier:identifier,postmasterStartIdentity:lines[2]};
  const verifyIdentity=async connection=>{
   assert.equal(await fs.readFile(path.join(data,'postmaster.pid'),'utf8'),pidBytes);
   const [row]=await connection.unsafe(`select current_user as login,session_user as session_login,current_database() as database,current_setting('data_directory') as directory,
    system_identifier::text,pg_backend_pid() as backend_pid,extract(epoch from pg_postmaster_start_time()) as started_at,current_setting('server_version_num')::integer as version from pg_control_system()`);
   verifyFreshConnectionIdentity(row,expected);expected.backendPid??=row.backend_pid;
  };
  const plan=await loadFreshSchemaApplicationPlan();await populateFreshClientSchema({connection:reserved,plan,verifyIdentity,apiPassword});
  api=connect('local_state_api',apiPassword);assert.equal((await inspectAttachedApiAdmission({sql:api,apiLogin:'local_state_api'})).restricted_login,true);
  await assert.rejects(api.unsafe('select public.h205f22_a2_browser_device_enrollment_approve_v1(null)'),e=>e.code==='42501');
  await verifyIdentity(reserved);
  const bad=connect('local_state_api',randomBytes(32).toString('hex'));
  try{await assert.rejects(bad.unsafe('select 1'),e=>e.code==='28P01');}finally{await bad.end({timeout:5});}
  await assert.rejects(populateFreshClientSchema({connection:reserved,plan,verifyIdentity,apiPassword}),/population_unconfirmed/);
 }finally {
  await api?.end({timeout:5});await reserved?.release();await sql?.end({timeout:5});
  if(started)await command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);
  // Failed stop throws above and deliberately preserves the disposable cluster.
  await fs.rm(root,{recursive:true,force:true});
 }
});
