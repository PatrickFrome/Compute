import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectRestoredRuntimePreparationMode, prepareDurableRestoredPg17, prepareInstalledAttachedPg17 } from '../src/local-restored-pg17-auto-prepare.mjs';

const OLD='a'.repeat(64),NEW='b'.repeat(64);
const identifier='7512345678901234567';
const validState='Database system identifier: '+identifier+'\nDatabase cluster state: shut down\n';
async function fixture(t){
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'pg17-auto-prepare-test-'));
  t.after(()=>fs.rm(home,{recursive:true,force:true}));
  const temp=path.join(home,'temp'),localAppData=path.join(home,'AppData','Local');
  const original=path.join(home,'original','data'),bundle=path.join(home,'sealed','client-state-runtime');
  const source=path.join(temp,'compute-restored-provider-Abc123','data');
  for(const dir of [temp,localAppData,path.dirname(original),bundle,
    path.join(source,'global'),path.join(source,'pg_wal'),path.join(source,'pg_tblspc'),
    path.join(source,'base','16384')])await fs.mkdir(dir,{recursive:true});
  await fs.mkdir(path.join(original,'global'),{recursive:true});
  await fs.writeFile(path.join(original,'PG_VERSION'),'17\n');
  await fs.writeFile(path.join(original,'global','pg_control'),Buffer.from('original_control_read_only'));
  await fs.writeFile(path.join(original,'client-vault.key'),'f'.repeat(64)+'\n');
  const file=async(name,body)=>fs.writeFile(path.join(source,name),body);
  await file('PG_VERSION','17\n');
  await file('client-vault.key','f'.repeat(64)+'\n');
  await file('global/pg_control',Buffer.from('fake_pg_control_fixed_test'));
  await file('base/16384/1',Buffer.from('test_data_1'));
  const oldConfigFile=path.join(home,'private-config.json');
  const previous={
    schema:'compute.runtime-host-config.v1',version:1,bundle_directory:path.join(home,'old-bundle'),
    expected_bundle_sha256:OLD,state_directory:path.dirname(original),pg_data_directory:original,
    database_url:'postgres://service:sample@127.0.0.1:15432/metaengine',
    inspect_database_url:'postgres://inspector:sample@127.0.0.1:15432/metaengine',
    api_port:15431,edge_port:15433,startup_timeout_ms:30000,
  };
  await fs.writeFile(oldConfigFile,JSON.stringify(previous));
  const restoreReceiptFile=path.join(home,'restore-report.json');
  const report=JSON.stringify({schema:'metaengine.database-restore-report.v1',
    data_verified:true,schema_verified:true,errors:[],ddl_adaptations:[],
    source_dump_sha256:'f'.repeat(64)});
  await fs.writeFile(restoreReceiptFile,report);
  const restoreReceiptSha256=createHash('sha256').update(report).digest('hex');
  const calls=[],aclCalls=[];
  const args={platform:'win32',oldConfigFile,localAppData,bundleDirectory:bundle,bundleDigest:NEW,
    protectStorage:async target=>{aclCalls.push({operation:'PROTECT_DIRECTORY',target});
      return {owner_dacl_verified:true};},
    verifyStorage:async (target,{operation='VERIFY_FILE'}={})=>{aclCalls.push({operation,target});
      return {owner_dacl_verified:true};},
    restoreReceiptFile,restoreReceiptSha256,
    postgresBinDirectory:path.join(bundle,'runtime','postgresql','bin'),
    tempDirectory:temp,run:async(bin,argv,options)=>{
      calls.push({bin,argv,options});return {stdout:validState};
    }};
  return {home,source,temp,original,oldConfigFile,previous,bundle,localAppData,calls,aclCalls,args};
}

async function attachedFixture(t) {
  const f=await fixture(t);
  const state=path.join(f.localAppData,'METAENGINE','attached-client');
  await fs.mkdir(state,{recursive:true});
  const configFile=path.join(state,'onboarded-runtime.json');
  const config={...f.previous,state_directory:state,postgres_mode:'attached',api_role_mode:'direct',
    expected_cluster_system_identifier:identifier,database_url:'postgres://api_login:independent-api-password@127.0.0.1:15432/metaengine',
    inspect_database_url:'postgres://inspector:separate-admin-password@127.0.0.1:15432/metaengine'};
  await fs.writeFile(configFile,JSON.stringify(config));
  const pidFile=path.join(f.original,'postmaster.pid');
  await fs.writeFile(pidFile,'keeper-process-lifecycle-marker');
  return {...f,state,configFile,config,pidFile,args:{...f.args,oldConfigFile:configFile}};
}

test('attached preparation preserves running Keeper and only writes a new protected client config',async t=>{
  const f=await attachedFixture(t);
  const prior=await fs.readFile(f.configFile);
  const vault=await fs.readFile(path.join(f.original,'client-vault.key'));
  const pid=await fs.readFile(f.pidFile);
  const selected=await inspectRestoredRuntimePreparationMode(f.configFile,{verifyStorage:f.args.verifyStorage});
  assert.deepEqual(selected,{postgresMode:'attached'});
  const result=await prepareInstalledAttachedPg17(f.args);
  assert.equal(result.copyVerified,false);
  assert.equal(result.clusterPinPreserved,true);
  assert.equal(result.postgresLifecycleOwned,false);
  assert.notEqual(result.configFile,f.configFile);
  assert.deepEqual(await fs.readFile(f.configFile),prior);
  assert.deepEqual(await fs.readFile(f.pidFile),pid);
  assert.deepEqual(await fs.readFile(path.join(f.original,'client-vault.key')),vault);
  assert.equal(f.calls.length,0,'attached preparation must never execute PG tools');
  const updated=JSON.parse(await fs.readFile(result.configFile));
  assert.equal(updated.expected_cluster_system_identifier,identifier);
  assert.equal(updated.pg_data_directory,f.original);
  assert.equal(updated.bundle_directory,await fs.realpath(f.bundle));
  assert.equal(updated.expected_bundle_sha256,NEW);
  assert.ok(f.aclCalls.some(row=>row.target===f.state&&row.operation==='PROTECT_DIRECTORY'));
  assert.ok(f.aclCalls.some(row=>row.target===result.configFile&&row.operation==='VERIFY_FILE'));
  assert.ok(f.aclCalls.every(row=>!row.target.startsWith(f.original)),'Keeper DACL must never be changed');
});

test('attached mode, role, pin, boundaries and private ACL failures deny publication',async t=>{
  for(const patch of [{api_role_mode:'service_role'},{expected_cluster_system_identifier:undefined},
    {expected_cluster_system_identifier:identifier+'x'},{postgres_mode:'owned'},
    {state_directory:'same-data'},{database_url:'postgres://inspector:same@127.0.0.1:15432/metaengine'}]) {
    const f=await attachedFixture(t);
    const config={...f.config,...patch};
    if(config.state_directory==='same-data')config.state_directory=f.original;
    await fs.writeFile(f.configFile,JSON.stringify(config));
    await assert.rejects(prepareInstalledAttachedPg17(f.args),/pg17_auto_prepare_/);
    assert.deepEqual(await fs.readdir(f.state),['onboarded-runtime.json']);
    assert.equal(f.calls.length,0);
  }
  const f=await attachedFixture(t);
  await fs.writeFile(path.join(f.state,'runtime-host-lock.json'),'existing-live-client');
  await assert.rejects(prepareInstalledAttachedPg17(f.args),/existing_destination_requires_review/);
  await fs.rm(path.join(f.state,'runtime-host-lock.json'));
  await assert.rejects(prepareInstalledAttachedPg17({...f.args,verifyStorage:async()=>({owner_dacl_verified:false})}),/private_file_acl_unverified/);
  assert.deepEqual(await fs.readdir(f.state),['onboarded-runtime.json']);
});

test('auto prepare copies clean stopped PG17, preserves all files and empty dirs, and rebinds NEW private config',async t=>{
  const f=await fixture(t);
  const prior=await fs.readFile(f.oldConfigFile,'utf8');
  const vault=await fs.readFile(path.join(f.source,'client-vault.key'));
  const outcome=await prepareDurableRestoredPg17(f.args);
  assert.equal(outcome.copyVerified,true);
  assert.equal(outcome.vaultPreserved,true);
  assert.equal(outcome.automaticRetryAllowed,false);
  assert.equal(outcome.fileCount,4);
  assert.equal(outcome.pgDataDirectory,path.join(f.localAppData,'METAENGINE','restored-postgres-17','data'));
  assert.equal((await fs.readFile(f.oldConfigFile,'utf8')),prior);
  assert.deepEqual(await fs.readFile(path.join(f.source,'client-vault.key')),vault);
  assert.deepEqual(await fs.readFile(path.join(outcome.pgDataDirectory,'client-vault.key')),vault);
  assert.equal((await fs.lstat(path.join(outcome.pgDataDirectory,'pg_tblspc'))).isDirectory(),true);
  assert.equal((await fs.lstat(path.join(outcome.pgDataDirectory,'pg_wal'))).isDirectory(),true);
  const newConfig=JSON.parse(await fs.readFile(outcome.configFile,'utf8'));
  assert.equal(newConfig.bundle_directory,f.bundle);
  assert.equal(newConfig.expected_bundle_sha256,NEW);
  assert.equal(newConfig.state_directory,outcome.stateDirectory);
  assert.equal(newConfig.pg_data_directory,outcome.pgDataDirectory);
  assert.equal(newConfig.database_url,f.previous.database_url);
  const proof=JSON.parse(await fs.readFile(path.join(outcome.stateDirectory,'pg17-copy-proof.json')));
  assert.equal(proof.state,'COPIED_AND_VERIFIED');
  assert.equal(proof.file_count,4);
  assert.equal(proof.vault_key_preserved,true);
  assert.equal(proof.original_source_modified,false);
  assert.equal(f.aclCalls[0].operation,'PROTECT_DIRECTORY');
  assert.equal(f.aclCalls[0].target,outcome.stateDirectory);
  assert.equal(f.aclCalls.filter(x=>x.operation==='VERIFY_FILE').length,4);
  assert(f.aclCalls.some(x=>x.target===outcome.configFile));
  assert(f.aclCalls.some(x=>x.target===path.join(outcome.pgDataDirectory,'client-vault.key')));
  assert.equal(f.calls.length,4,'original read only, source twice, copied clone once');
  await assert.rejects(prepareDurableRestoredPg17(f.args),/existing_destination_requires_review/);
});

test('auto prepare refuses original in-production state, missing copy and stale postmaster pid',async t=>{
  const f=await fixture(t);
  await assert.rejects(prepareDurableRestoredPg17({...f.args,run:async()=>({stdout:'Database system identifier: '+identifier+'\nDatabase cluster state: in production'})}),
    /pg_control_not_cleanly_shut_down/);
  await fs.writeFile(path.join(f.source,'postmaster.pid'),'99999\n');
  await assert.rejects(prepareDurableRestoredPg17(f.args),/existing_destination_requires_review/);
  await fs.unlink(path.join(f.source,'postmaster.pid'));
  await fs.rm(f.source,{recursive:true,force:true});
  await assert.rejects(prepareDurableRestoredPg17(f.args),/stopped_copy_not_found/);
});

test('DACL failure blocks creating private data or new config, never falls back to chmod',async t=>{
  const f=await fixture(t);
  await assert.rejects(prepareDurableRestoredPg17({...f.args,protectStorage:async()=>({
    owner_dacl_verified:false,
  })}),/private_storage_acl_unverified/);
  const state=path.join(f.localAppData,'METAENGINE','restored-postgres-17');
  assert.deepEqual(await fs.readdir(state),[]);
  assert.equal(f.aclCalls.length,0);
});

test('failed readback of config/Vault ACL never returns configured success',async t=>{
  const f=await fixture(t);
  await assert.rejects(prepareDurableRestoredPg17({...f.args,
    verifyStorage:async (_target,{operation='VERIFY_FILE'}={})=>({
      owner_dacl_verified:operation!=='VERIFY_FILE',
    })}),/private_file_acl_unverified/);
  assert.equal(f.aclCalls[0].operation,'PROTECT_DIRECTORY');
});

test('auto prepare refuses an unverified restore report before reading or copying PGDATA',async t=>{
  const f=await fixture(t);
  await assert.rejects(prepareDurableRestoredPg17({...f.args,restoreReceiptSha256:'c'.repeat(64)}),
    /restore_report_pin_unverified/);
  await fs.writeFile(f.args.restoreReceiptFile,JSON.stringify({schema:'metaengine.database-restore-report.v1',
    data_verified:false,schema_verified:true,errors:[],ddl_adaptations:[],
    source_dump_sha256:'f'.repeat(64)}));
  const changed=await fs.readFile(f.args.restoreReceiptFile);
  await assert.rejects(prepareDurableRestoredPg17({...f.args,
    restoreReceiptSha256:createHash('sha256').update(changed).digest('hex')}),
    /restore_report_unverified/);
  await assert.rejects(fs.lstat(path.join(f.localAppData,'METAENGINE','restored-postgres-17')),
    e=>e.code==='ENOENT');
});

test('auto prepare rejects wrong original Vault or system identifier before any persistent copy',async t=>{
  const f=await fixture(t);
  await fs.writeFile(path.join(f.original,'client-vault.key'),'e'.repeat(64)+'\n');
  await assert.rejects(prepareDurableRestoredPg17(f.args),/vault_identity_mismatch/);
  await fs.writeFile(path.join(f.original,'client-vault.key'),'f'.repeat(64)+'\n');
  await assert.rejects(prepareDurableRestoredPg17({...f.args,
    run:async(exe,argv)=>({stdout:argv[1]===f.original
      ?'Database system identifier: 8000000000000000000\nDatabase cluster state: in production\n'
      :validState})}),/postgres_system_identity_mismatch/);
  await assert.rejects(fs.lstat(path.join(f.localAppData,'METAENGINE','restored-postgres-17')),
    e=>e.code==='ENOENT');
});

test('source PGDATA must be distinct from the old-config original for meaningful Vault and system identity comparison',async t=>{
  const f=await fixture(t);
  const prior={...f.previous,pg_data_directory:f.source,
    state_directory:path.dirname(f.source)};
  await fs.writeFile(f.oldConfigFile,JSON.stringify(prior));
  await assert.rejects(prepareDurableRestoredPg17(f.args),
    /pg17_auto_prepare_independent_original_required/);
  await assert.rejects(fs.lstat(path.join(f.localAppData,'METAENGINE','restored-postgres-17')),
    e=>e.code==='ENOENT');
});

test('auto prepare refuses two TEMP clones without making a choice or creating a permanent target',async t=>{
  const f=await fixture(t);
  const clone=path.join(f.temp,'compute-restored-provider-Dup123','data');
  await fs.mkdir(clone,{recursive:true});
  await fs.writeFile(path.join(clone,'PG_VERSION'),'17\n');
  await assert.rejects(prepareDurableRestoredPg17(f.args),/multiple_candidates_requires_review/);
  await assert.rejects(fs.lstat(path.join(f.localAppData,'METAENGINE','restored-postgres-17')),
    e=>e.code==='ENOENT');
});

test('auto prepare rejects external tablespaces and linked database entries',async t=>{
  const f=await fixture(t);
  await fs.writeFile(path.join(f.source,'pg_tblspc','broken'),'test');
  await assert.rejects(prepareDurableRestoredPg17(f.args),/external_tablespace_forbidden/);
  await fs.unlink(path.join(f.source,'pg_tblspc','broken'));
  if(process.platform!=='win32'){
    await fs.symlink(path.join(f.source,'PG_VERSION'),path.join(f.source,'fake-symlink'));
    await assert.rejects(prepareDurableRestoredPg17(f.args),/linked_pgdata_forbidden/);
  }
});

test('old private host config must preserve SQL role separation, safe ports and state boundaries',async t=>{
  for(const mutation of [
    config=>({...config,api_port:15432}),
    config=>({...config,edge_port:15431}),
    config=>({...config,startup_timeout_ms:0}),
    config=>({...config,startup_timeout_ms:300001}),
    config=>({...config,inspect_database_url:config.database_url}),
    config=>({...config,pg_data_directory:config.state_directory}),
    config=>({...config,state_directory:config.bundle_directory}),
  ]){
    const f=await fixture(t);
    await fs.writeFile(f.oldConfigFile,JSON.stringify(mutation(f.previous)));
    await assert.rejects(prepareDurableRestoredPg17(f.args),/old_private_config_unverified/);
    await assert.rejects(fs.lstat(path.join(f.localAppData,'METAENGINE','restored-postgres-17')),
      error=>error.code==='ENOENT');
  }
});

test('PostgreSQL system identity is inspected using a locale-stable, no-shell child process',async t=>{
  const f=await fixture(t);
  await prepareDurableRestoredPg17(f.args);
  assert.equal(f.calls.length,4);
  for(const call of f.calls){
    assert.equal(call.argv[0],'-D');
    assert.equal(call.bin.endsWith('pg_controldata.exe'),true);
    assert.equal(call.options.shell,false);
    assert.equal(call.options.env.LC_ALL,'C');
    assert.equal(call.options.env.LANG,'C');
  }
});

test('auto prepare never silently reuses invalid credentials, an existing target or different OS',async t=>{
  const f=await fixture(t);
  await assert.rejects(prepareDurableRestoredPg17({...f.args,platform:'linux'}),/arguments_invalid/);
  const invalid={...f.previous,database_url:'postgres://operator@cloud.example/metaengine'};
  await fs.writeFile(f.oldConfigFile,JSON.stringify(invalid));
  await assert.rejects(prepareDurableRestoredPg17(f.args),/old_private_config_unverified/);
});
