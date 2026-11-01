import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {createNativeInstalledPublicationSchemaVerifier} from './native-coding-installed-publication-schema.mjs';
import {createNativePreparationTransactions,bindNativeCodingPublicationTransactionPool} from './native-coding-preparation-transaction.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const bodies=new Map();
for(const file of ['./native-coding-callback-publication-v1.sql','./native-coding-initial-anchor-task-fence-v1.sql','../../supabase/migrations/20261023082533_native_coding_operator_qa_admission_v1.sql']){
 for(const m of (await readFile(new URL(file,import.meta.url),'utf8')).matchAll(/create(?: or replace)? function ([a-z0-9_.]+)\([\s\S]*?\bas \$\$([\s\S]*?)\$\$;/g))if(!bodies.has(m[1]))bodies.set(m[1],m[2]);
}
function fixture(factory=createNativeInstalledPublicationSchemaVerifier){
 const common={database_name:'qa',database_oid:'7',postmaster:'pg-birth',address:'127.0.0.1',port:54321};
 const api={...common,backend:3,backend_start:'api-birth',session_login:'actual_api',current_login:'actual_api',role_oid:'42',rolcanlogin:true,
  rolinherit:false,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false,memberships:0,connect:true,database_create:false};
 const pg={...common,system_identifier:'12345',data_directory:'/generated/pgdata',version:170005,current_login:'state_owner',session_login:'state_owner',replication_role:'origin'};
 const seen=[],abort=new AbortController(),monitor=createNativePreparationTransactions();let next=0,hook=async()=>{},live=true,assertion,grant=true;
 const query=async(q,args=[],id=1,mode='serializable')=>{
  seen.push(q);monitor.debug(id,q,[],[]);await hook(q,args);
  if(q.startsWith('begin ')||q==='commit'||q==='rollback')return[];
  assert.match(q,/^select\s/); // This fixture refuses any verifier SQL mutation.
  if(q.includes('pg_try_advisory_lock_shared'))return[{locked:true}];
  if(q.includes('pg_advisory_unlock_shared'))return[{unlocked:true}];
  if(q.includes('pg_control_system'))return[{...pg,isolation:mode,read_only:mode==='repeatable read'?'on':'off'}];
  if(q.startsWith('select pg_catalog.current_database()'))return[{...common,backend:id,backend_start:'owner-'+id,current_login:'state_owner',session_login:'state_owner'}];
  if(q.startsWith('select r.oid::text'))return[{oid:'42'}];
  if(q.includes("s->>'signature' as signature"))return JSON.parse(args[0]).map(s=>({signature:s.signature,oid:'10',owner:'state_owner',return_type:s.return_type,
   proretset:false,prokind:'f',proisstrict:false,proleakproof:false,proparallel:'u',volatile:s.volatile,language:s.language,definer:s.definer,defaults:s.defaults,
   variadic:'0',support:'0',args:s.args,proargmodes:null,proallargtypes:null,proconfig:['search_path=pg_catalog, destruktion_meta'],prosrc:bodies.get(s.signature.split('(')[0]),
   default_expr:s.defaults?'NULL::text, NULL::text':null,owner_oid:'1',service_oid:'2',acl:[{grantee:'1',grantor:'1',privilege:'EXECUTE',grantable:false},...(s.public_context?[{grantee:'42',grantor:'1',privilege:'EXECUTE',grantable:false}]:[])]}));
  if(q.startsWith('select n as name'))return JSON.parse(args[0]).map(name=>({name,oid:'20',owner:'state_owner',relkind:'r',relpersistence:'p',relispartition:false,
   relrowsecurity:true,relforcerowsecurity:false,policies:false,rules:false,external_acl:false,column_acl:false}));
  if(q.startsWith('select\n exists(select 1 from pg_catalog.pg_attribute'))return[{column_valid:true,shape_valid:true,unique_valid:true}];
  if(q.includes("s->>'trigger' as name"))return JSON.parse(args[0]).map(s=>({name:s.trigger,oid:'30',function_valid:true,tgtype:s.tgtype,tgenabled:'O',tgisinternal:false,
   tgnargs:0,no_qual:true,attrs:'',args:'',constraint_oid:'0',parent_oid:'0',tgdeferrable:false,tginitdeferred:false,tgoldtable:null,tgnewtable:null}));
  if(q.startsWith('select exists(select 1 from destruktion_meta.native_coding_execution'))return[{duplicates:false}];
  throw Error('unexpected fixture query');
 };
 const pool={unsafe:query,reserve:async()=>{const id=++next;let mode='serializable';return{unsafe:(q,args)=>{if(q.startsWith('begin isolation level repeatable'))mode='repeatable read';return query(q,args,id,mode);},release(){seen.push('RELEASE');}};}};
 const ownerSql=bindNativeCodingPublicationTransactionPool(pool,monitor);
 const apiSql={unsafe:async q=>{seen.push('API '+q);await hook(q,[]);return q.startsWith('select pg_catalog.current_database()')?[{...api}]:[{direct_grant:grant,grantable:false}];}};
 const verifier=factory({ownerSql,apiSql,apiLogin:'actual_api',assertCurrent:()=>{if(!live)throw Error('host_lifetime_closed');return assertion;},signal:abort.signal});
 return {verifier,ownerSql,monitor,seen,api,pg,abort,hook:fn=>{hook=fn;},stop:()=>{live=false;},assertion:value=>{assertion=value;},grant:value=>{grant=value;},
  run:fn=>ownerSql.begin('isolation level serializable',fn)};
}
test('startup is fixed READ ONLY and effects recheck actual original transaction without nested begin or a readiness return',async()=>{
 const f=fixture();assert.equal(await f.verifier.attest(),undefined);
 assert.match(f.seen.find(q=>q.startsWith('begin ')),/^begin isolation level repeatable read read only /);
 let held;assert.equal(await f.run(async tx=>{held=tx;assert.equal(await f.verifier.recheck(tx),undefined);await f.verifier.recheck(tx);}),undefined);
 assert.equal(f.seen.filter(q=>q.startsWith('begin ')).length,2);assert.equal(f.seen.filter(q=>q==='RELEASE').length,2);
 assert.deepEqual(Object.keys(f.verifier),['attest','recheck','close','drain']);
 await assert.rejects(f.verifier.recheck(held),/finished/);f.verifier.close();await f.verifier.drain();
});
test('a shape impostor and an already used snapshot are never a fallback transaction',async()=>{
 const f=fixture();await f.verifier.attest();await assert.rejects(f.run(tx=>f.verifier.recheck({...tx})),/scope_unbound/);
 const g=fixture();await g.verifier.attest();await assert.rejects(g.run(async tx=>{await tx.unsafe('select exists(select 1 from destruktion_meta.native_coding_execution_h205f22)');await g.verifier.recheck(tx);}),/snapshot_already_used/);
});
test('no API owner-only fallback when original authenticated direct grant disappears',async()=>{
 const f=fixture();await f.verifier.attest();f.grant(false);await assert.rejects(f.run(tx=>f.verifier.recheck(tx)),/identity_unattested/);
 await assert.rejects(f.run(tx=>f.verifier.recheck(tx)),/not_attested/);
});
for(const field of ['system_identifier','postmaster','database_oid','data_directory','port'])test('PG incarnation drift '+field+' closes cached observation',async()=>{
 const f=fixture();await f.verifier.attest();f.pg[field]='different';await assert.rejects(f.run(tx=>f.verifier.recheck(tx)),/postgres_changed/);
 await assert.rejects(f.verifier.attest(),/attestation_repeated/);
});
for(const kind of ['close','abort','connection'])test(kind+' during startup retains pending read, prevents resurrection, and drains without physical claim',async()=>{
 const f=fixture(),entered=deferred(),gate=deferred();f.hook(async q=>{if(q.includes("s->>'signature' as signature")){entered.resolve();await gate.promise;}});
 const pending=f.verifier.attest();const outcome=pending.catch(e=>e);await entered.promise;
 if(kind==='close')f.verifier.close();else if(kind==='abort')f.abort.abort();else f.monitor.onclose(1);
 let joined=false;const draining=f.verifier.drain().then(()=>{joined=true;});await new Promise(r=>setImmediate(r));assert.equal(joined,false);
 gate.resolve();assert.match((await outcome).message,/closed/);assert.equal(await draining,undefined);assert.equal(joined,true);
 await assert.rejects(f.verifier.attest(),/attestation_repeated/);assert.equal(f.seen.filter(q=>q==='commit').length,0);
});
test('close after read before original COMMIT is fenced by retained synchronous guard',async()=>{
 const f=fixture();await f.verifier.attest();await assert.rejects(f.run(async tx=>{await f.verifier.recheck(tx);queueMicrotask(()=>f.verifier.close());}),/closed/);
 assert.equal(f.seen.filter(q=>q==='commit').length,1);assert.equal(f.seen.at(-3),'rollback');
});
test('connection death after schema read invalidates verifier before another transaction',async()=>{
 const f=fixture();await f.verifier.attest();await assert.rejects(f.run(async tx=>{await f.verifier.recheck(tx);f.monitor.onclose(2);}),/connection_closed/);
 await assert.rejects(f.run(tx=>f.verifier.recheck(tx)),/not_attested/);
});
for(const value of [true,{},Promise.resolve()])test('private lifetime assertion cannot be a readiness value '+typeof value,async()=>{
 const f=fixture();f.assertion(value);await assert.rejects(f.verifier.attest(),/lifetime_assertion/);assert.equal(f.seen.length,0);
});
test('shipped source changes after startup are refused without editing real source or accepting a caller hash',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'publication-schema-source-'));
 try{
  let source=await readFile(new URL('./native-coding-installed-publication-schema.mjs',import.meta.url),'utf8');
  source=source.replace("'../../apps/metaengine-browser/src/native-coding-host-settlement.mjs'",JSON.stringify(new URL('../../apps/metaengine-browser/src/native-coding-host-settlement.mjs',import.meta.url).href));
  for(const name of ['native-coding-preparation-transaction.mjs','native-coding-migration-api-identity.mjs'])source=source.replace("'./"+name+"'",JSON.stringify(new URL('./'+name,import.meta.url).href));
  const relative=['./native-coding-callback-publication-v1.sql','./native-coding-initial-anchor-task-fence-v1.sql','../../supabase/migrations/20261023082533_native_coding_operator_qa_admission_v1.sql'];
  for(let i=0;i<relative.length;i++){const file=path.join(directory,i+'.sql');await writeFile(file,await readFile(new URL(relative[i],import.meta.url)));source=source.replace("new URL('"+relative[i]+"',import.meta.url)",JSON.stringify(pathToFileURL(file).href));}
  // Fixed fixture paths remain URLs, never production caller-supplied sources.
  source=source.replace('readFile(url,\'utf8\')','readFile(new URL(url),\'utf8\')');
  const module=path.join(directory,'verifier.mjs');await writeFile(module,source);
  const {createNativeInstalledPublicationSchemaVerifier:factory}=await import(pathToFileURL(module));const f=fixture(factory);await f.verifier.attest();
  const callback=path.join(directory,'0.sql');await writeFile(callback,(await readFile(callback,'utf8'))+'\n-- changed source fixture\n');
  await assert.rejects(f.run(tx=>f.verifier.recheck(tx)),/source_changed/);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('unexpected driver/source errors expose no protected details and cannot resurrect verifier',async()=>{
 const f=fixture();f.hook(async()=>{throw Object.assign(Error('SENTINEL_CREDENTIAL_PATH'),{query:'SENTINEL_CREDENTIAL_PATH',parameters:['SENTINEL_CREDENTIAL_PATH']});});
 const error=await f.verifier.attest().catch(e=>e);assert(!String(error.stack).includes('SENTINEL'));assert(!JSON.stringify(error).includes('SENTINEL'));
 await assert.rejects(f.verifier.attest(),/attestation_repeated/);
});

test('first source read rejection still joins held sibling reads before failed attest/drain completes',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'publication-schema-read-join-'));
 try{
  const helper=path.join(directory,'read-fixture.mjs');await writeFile(helper,`import {readFile as read} from 'node:fs/promises';
   export const entered=Promise.withResolvers(),release=Promise.withResolvers();
   export async function readFile(url,encoding){
    if(String(url).endsWith('native-coding-callback-publication-v1.sql'))throw Error('source-read-failed');
    if(String(url).endsWith('native-coding-initial-anchor-task-fence-v1.sql')){entered.resolve();await release.promise;}
    return read(url,encoding);
   }`);
  const controls=await import(pathToFileURL(helper));let source=await readFile(new URL('./native-coding-installed-publication-schema.mjs',import.meta.url),'utf8');
  source=source.replace("'node:fs/promises'",JSON.stringify(pathToFileURL(helper).href));
  for(const relative of ['./native-coding-preparation-transaction.mjs','./native-coding-migration-api-identity.mjs','../../apps/metaengine-browser/src/native-coding-host-settlement.mjs'])
   source=source.replace(JSON.stringify(relative).replaceAll('"',"'"),JSON.stringify(new URL(relative,import.meta.url).href));
  for(const relative of ['./native-coding-callback-publication-v1.sql','./native-coding-initial-anchor-task-fence-v1.sql','../../supabase/migrations/20261023082533_native_coding_operator_qa_admission_v1.sql'])
   source=source.replace("new URL('"+relative+"',import.meta.url)","new URL("+JSON.stringify(new URL(relative,import.meta.url).href)+")");
  const module=path.join(directory,'verifier.mjs');await writeFile(module,source);const {createNativeInstalledPublicationSchemaVerifier:factory}=await import(pathToFileURL(module));
  const f=fixture(factory);let settled=false,drained=false;const work=f.verifier.attest();work.then(()=>{settled=true;},()=>{settled=true;});
  await controls.entered.promise;const drain=f.verifier.drain().then(()=>{drained=true;});await new Promise(r=>setImmediate(r));assert.equal(settled,false);assert.equal(drained,false);
  f.verifier.close();controls.release.resolve();await assert.rejects(work,/check_failed/);await drain;assert.equal(f.seen.length,0);
 }finally{await rm(directory,{recursive:true,force:true});}
});
