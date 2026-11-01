import test from 'node:test';
import assert from 'node:assert/strict';
import {attestNativeMigrationApiIdentity,bindNativeMigrationApiIdentity} from './native-coding-migration-api-identity.mjs';
function fixture(){
 const common={database_name:'db',database_oid:'7',postmaster:'birth',address:'127.0.0.1',port:5555};
 const api={...common,backend:2,backend_start:'api-start',session_login:'api',current_login:'api',role_oid:'42',rolcanlogin:true,rolinherit:false,rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false,memberships:0,connect:true,database_create:false};
 const owner={...common,backend:1,backend_start:'owner-start',session_login:'state_owner',current_login:'state_owner'};let writes=0;
 const apiSql={unsafe:async q=>q.startsWith('select pg_catalog.current_database')?[{...api}]:[{direct_grant:true,grantable:false}]};
 const ownerSql={unsafe:async q=>{if(q.startsWith('select pg_catalog.current_database'))return[{...owner}];writes++;return[];}};
 return{api,owner,apiSql,ownerSql,writes:()=>writes,attest:()=>attestNativeMigrationApiIdentity({apiSql,ownerSql,apiLogin:'api'})};
}
test('private ticket is immutable, single use, and not reconstructed from JSON',async()=>{
 const f=fixture(),ticket=await f.attest();assert(Object.isFrozen(ticket));
 await assert.rejects(bindNativeMigrationApiIdentity(f.ownerSql,structuredClone(ticket)),/unattested/);
 await bindNativeMigrationApiIdentity(f.ownerSql,ticket);assert.equal(f.writes(),2);
 await assert.rejects(bindNativeMigrationApiIdentity(f.ownerSql,ticket),/unattested/);
});
for(const field of ['role_oid','backend','backend_start','postmaster','database_oid','address','port'])test('API identity drift '+field+' consumes token without SQL effects',async()=>{
 const f=fixture(),ticket=await f.attest();f.api[field]='changed';await assert.rejects(bindNativeMigrationApiIdentity(f.ownerSql,ticket),/unattested/);assert.equal(f.writes(),0);
});
test('restricted role alteration after authentication refuses before temp SQL',async()=>{
 const f=fixture(),ticket=await f.attest();f.api.memberships=1;await assert.rejects(bindNativeMigrationApiIdentity(f.ownerSql,ticket),/unattested/);assert.equal(f.writes(),0);
});
test('owner session drift refuses before temp SQL',async()=>{
 const f=fixture(),ticket=await f.attest();f.owner.session_login='foreign';await assert.rejects(bindNativeMigrationApiIdentity(f.ownerSql,ticket),/unattested/);assert.equal(f.writes(),0);
});

const {consumeNativeMigrationApiIdentityReadOnly,recheckNativeMigrationApiIdentityReadOnly,releaseNativeMigrationApiIdentityReadOnly}=await import('./native-coding-migration-api-identity.mjs');
test('read-only consumer keeps original authentication without temp SQL and can recheck a later owner backend',async()=>{
 const f=fixture(),ticket=await f.attest(),identity=await consumeNativeMigrationApiIdentityReadOnly(f.ownerSql,ticket);
 assert(Object.isFrozen(identity));assert.deepEqual(identity,{});assert.equal(f.writes(),0);
 await assert.rejects(bindNativeMigrationApiIdentity(f.ownerSql,ticket),/unattested/);
 await assert.rejects(recheckNativeMigrationApiIdentityReadOnly(f.ownerSql,structuredClone(identity)),/unattested/);
 f.owner.backend=99;f.owner.backend_start='later-owner';
 assert.deepEqual(await recheckNativeMigrationApiIdentityReadOnly(f.ownerSql,identity),{api_role_oid:'42',api_login:'api'});assert.equal(f.writes(),0);
 releaseNativeMigrationApiIdentityReadOnly(identity);await assert.rejects(recheckNativeMigrationApiIdentityReadOnly(f.ownerSql,identity),/unattested/);
});
for(const field of ['role_oid','backend','backend_start','postmaster','database_oid','address','port'])test('read-only recheck refuses API '+field+' drift without writes',async()=>{
 const f=fixture(),identity=await consumeNativeMigrationApiIdentityReadOnly(f.ownerSql,await f.attest());f.api[field]='changed';
 await assert.rejects(recheckNativeMigrationApiIdentityReadOnly(f.ownerSql,identity),/unattested/);assert.equal(f.writes(),0);
});
test('read-only consumption still requires exact original owner backend and spends failed ticket',async()=>{
 const f=fixture(),ticket=await f.attest();f.owner.backend=3;await assert.rejects(consumeNativeMigrationApiIdentityReadOnly(f.ownerSql,ticket),/unattested/);
 f.owner.backend=1;await assert.rejects(bindNativeMigrationApiIdentity(f.ownerSql,ticket),/unattested/);assert.equal(f.writes(),0);
});
