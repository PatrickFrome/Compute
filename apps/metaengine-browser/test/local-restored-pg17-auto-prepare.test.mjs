import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareDurableRestoredPg17 } from '../src/local-restored-pg17-auto-prepare.mjs';

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
  const calls=[];
  const args={platform:'win32',oldConfigFile,localAppData,bundleDirectory:bundle,bundleDigest:NEW,
    restoreReceiptFile,restoreReceiptSha256,
    postgresBinDirectory:path.join(bundle,'runtime','postgresql','bin'),
    tempDirectory:temp,run:async(bin,argv)=>{
      calls.push({bin,argv});return {stdout:validState};
    }};
  return {home,source,temp,original,oldConfigFile,previous,bundle,localAppData,calls,args};
}

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

test('auto prepare never silently reuses invalid credentials, an existing target or different OS',async t=>{
  const f=await fixture(t);
  await assert.rejects(prepareDurableRestoredPg17({...f.args,platform:'linux'}),/arguments_invalid/);
  const invalid={...f.previous,database_url:'postgres://operator@cloud.example/metaengine'};
  await fs.writeFile(f.oldConfigFile,JSON.stringify(invalid));
  await assert.rejects(prepareDurableRestoredPg17(f.args),/old_private_config_unverified/);
});
