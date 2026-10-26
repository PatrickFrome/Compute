import {populateFreshClientSchema} from './test/fresh-provider-private-loader.mjs';
import test from 'node:test';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {freshClientLayout,FRESH_CLIENT_INSTALL_ACTION,verifyFreshConnectionIdentity,provisionFreshClientProvider} from './fresh-client-provider.mjs';
import {parseFreshClientArguments} from './fresh-client-provider-cli.mjs';
const digest='a'.repeat(64);
const options={localAppData:path.join(os.tmpdir(),'private','local'),appData:path.join(os.tmpdir(),'private','roaming'),bundleDirectory:path.join(os.tmpdir(),'installed','runtime'),expectedBundleDigest:digest,ownerAction:FRESH_CLIENT_INSTALL_ACTION};

test('fresh setup has fixed private paths and exact typed owner action, no endpoint or SQL input',()=>{
  const layout=freshClientLayout(options);
  assert.equal(layout.stateDirectory,path.join(options.localAppData,'METAENGINE','client-first-run-v1','runtime'));
  assert.equal(layout.passwordFile,path.join(options.localAppData,'METAENGINE','client-first-run-v1','initdb-password'));
  assert.equal(layout.ownerFile,path.join(options.appData,'@metaengine','browser-shell','metaengine-state-provider-v1.json'));
  for(const change of [{ownerAction:'RESTORE'}, {expectedBundleDigest:'A'.repeat(64)}, {localAppData:'relative'}, {appData:'//server/share'}, {bundleDirectory:'/bad\0path'}])assert.throws(()=>freshClientLayout({...options,...change}),/fresh_provider_/);
});
test('fixed CLI refuses missing/duplicate/options including credentials and arbitrary paths',()=>{
  assert.deepEqual(parseFreshClientArguments(['--bundle-sha256',digest,'--owner-action',FRESH_CLIENT_INSTALL_ACTION]),{expectedBundleDigest:digest,ownerAction:FRESH_CLIENT_INSTALL_ACTION});
  for(const args of [[],['--sql','select 1'],['--bundle-sha256',digest,'--owner-action','RESTORE'],['--bundle-sha256',digest,'--owner-action',FRESH_CLIENT_INSTALL_ACTION,'--password','secret']])assert.throws(()=>parseFreshClientArguments(args),/arguments_invalid/);
});
test('identity binds OS pidfile and SQL start independently and rejects role/cluster/backend/incarnation drift',()=>{
  const pidFile='456\n/private/pg17\n100\n5432\n';
  const expected={directory:'/private/pg17',systemIdentifier:'123456789',postmasterStartIdentity:'100',postmasterPid:456,
    postmasterPidSha256:createHash('sha256').update(pidFile).digest('hex'),sqlStartedAt:'101.009461',backendPid:123};
  const row={login:'state_owner',session_login:'state_owner',database:'postgres',directory:'/private/pg17',system_identifier:'123456789',backend_pid:123,started_at:'101.009461',version:170004,postmaster_pid_file:pidFile};
  verifyFreshConnectionIdentity(row,expected);
  verifyFreshConnectionIdentity(row,{...expected,sqlStartedAt:undefined});
  for(const change of [{session_login:'postgres'},{login:'postgres'},{database:'other'},{directory:'/other'},{system_identifier:'123456788'},{backend_pid:124},{started_at:'101.009462'},{started_at:'NaN'},{started_at:null},{version:180000},{version:160000},{version:'NaN'},
    {postmaster_pid_file:undefined},{postmaster_pid_file:pidFile.replace('456','457')},{postmaster_pid_file:pidFile.replace('100','101')},{postmaster_pid_file:pidFile.replace('5432','5433')}])assert.throws(()=>verifyFreshConnectionIdentity({...row,...change},expected),/identity_unconfirmed/);
  for(const change of [{postmasterPid:457},{postmasterStartIdentity:'101'},{postmasterPidSha256:'f'.repeat(64)},{postmasterPid:NaN}])assert.throws(()=>verifyFreshConnectionIdentity(row,{...expected,...change}),/identity_unconfirmed/);
});
test('foreign identity fails before application DDL and rolls back reserved transaction',async()=>{
  const calls=[];const connection={unsafe:async query=>{calls.push(query);return [];}};
  await assert.rejects(populateFreshClientSchema({connection,plan:{schema:'compute.fresh-schema-application-plan.v1'},apiPassword:digest,verifyIdentity:async()=>{throw Error('foreign');}}),/population_unconfirmed/);
  assert.equal(calls[0],'BEGIN');assert.equal(calls.at(-1),'ROLLBACK');assert(!calls.some(q=>/create role/i.test(q)));
});
test('existing application or compatible role refuses before any schema mutation',async()=>{
  const calls=[];const connection={unsafe:async query=>{calls.push(query);return query.includes('select 1 from pg_namespace')?[{exists:1}]:[];}};
  await assert.rejects(populateFreshClientSchema({connection,plan:{schema:'compute.fresh-schema-application-plan.v1',prerequisite_sql:'CREATE SCHEMA should_not_run'},apiPassword:digest,verifyIdentity:async()=>{}}),/population_unconfirmed/);
  assert(!calls.some(q=>q.includes('should_not_run')));assert.equal(calls.at(-1),'ROLLBACK');
});
test('rollback uncertainty stays explicit; no retry or cleanup DDL',async()=>{
  const calls=[];const connection={unsafe:async query=>{calls.push(query);if(query==='ROLLBACK')throw Error('disconnect');return [];}};
  await assert.rejects(populateFreshClientSchema({connection,plan:{schema:'compute.fresh-schema-application-plan.v1'},apiPassword:digest,verifyIdentity:async()=>{throw Error('foreign');}}),/transaction_outcome_unknown/);
  assert.equal(calls.filter(q=>q==='BEGIN').length,1);assert(!calls.some(q=>/drop |truncate /i.test(q)));
});
test('non-Windows production operator refuses before filesystem or DB effects',{skip:process.platform==='win32'},async()=>{
  await assert.rejects(provisionFreshClientProvider(options),/windows_required/);
});
test('production defaults invoke real provisioning, migrations and qualified Owner publication',async()=>{
  const provider=await readFile(new URL('./fresh-client-provider.mjs',import.meta.url),'utf8');
  for(const expression of [/await initializeFreshClientPg17\(/,/await startOwnedWindowsPostgres\(/,/await sql.reserve\(/,/await applyLocalRuntimeMigrations\(/,/await provisionLocalApiLogin\(/,/await inspectAttachedApiAdmission\(/,/await startConfiguredLocalRuntimeHost\(/,/await provisionPersistentClientProvider\(/])assert.match(provider,expression);
  assert.match(provider,/begin:fn=>fn\(connection\)/);
  assert.doesNotMatch(provider,/restore_receipt|source_dump_sha256|process\.env\.PGPASSWORD|SET (?:LOCAL )?ROLE/i);
});
test('cleanup uncertainty still attempts each exact owned handle and never returns success',async()=>{
 const {cleanupFreshClientResources}=await import('./fresh-client-provider.mjs');const calls=[];
 await assert.rejects(cleanupFreshClientResources({api:{end:async()=>{calls.push('api');throw Error('private detail');}},
  reserved:{release:async()=>calls.push('reserved')},sql:{end:async()=>calls.push('owner')},
  owned:{stop:async()=>{calls.push('owned');return {cleanup_confirmed:false};}},hostAttempted:true,
  stopHost:async()=>{calls.push('host');return {cleanup_confirmed:true};}}),/^Error: fresh_provider_cleanup_unconfirmed$/);
 assert.deepEqual(calls,['api','reserved','owner','owned','host']);
});
test('cleanup with no owned processes does not request global process stop',async()=>{
 const {cleanupFreshClientResources}=await import('./fresh-client-provider.mjs');let calls=0;
 await cleanupFreshClientResources({hostAttempted:false,stopHost:async()=>{calls++;}});assert.equal(calls,0);
});

test('Node module caller cannot inject a signer into first-owner production lane',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(process,'platform');
 Object.defineProperty(process,'platform',{...descriptor,value:'win32'});
 try {
  await assert.rejects(provisionFreshClientProvider({...options,deviceIdentity:{ensure:async()=>{throw Error('must_not_run');}}}),/caller_device_identity_forbidden/);
  for(const key of ['secureStorage','statePath','identityPath','app','sql','verifyIdentity','consent'])await assert.rejects(provisionFreshClientProvider({...options,[key]:{}}),/caller_option_forbidden/);
 }
 finally {Object.defineProperty(process,'platform',descriptor);}
});
