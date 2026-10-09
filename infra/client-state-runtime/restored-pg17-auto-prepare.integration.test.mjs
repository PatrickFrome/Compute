import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initializeFreshClientPg17 } from './fresh-pg17-initdb.mjs';
import { verifyOfflineRuntimeBundle } from './offline-runtime-bundle.mjs';
import { prepareDurableRestoredPg17 } from '../../apps/metaengine-browser/src/local-restored-pg17-auto-prepare.mjs';

const bundle=process.env.LOCAL_STATE_TEST_FRESH_BUNDLE_DIRECTORY;
const sha=process.env.LOCAL_STATE_TEST_FRESH_BUNDLE_SHA256;
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');

test('real stopped PG17 snapshot is copied and rebound automatically using sealed Windows runtime', {
  skip:!bundle&&!sha,timeout:300000,
},async t=>{
  if(process.platform!=='win32'||!bundle||!sha||!/^[a-f0-9]{64}$/.test(sha))
    throw new Error('physical_pg17_auto_prepare_bundle_or_platform_invalid');
  const verified=await verifyOfflineRuntimeBundle({bundleDirectory:bundle,expectedBundleDigest:sha});
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'compute-pg17-auto-physical-')));
  const source=path.join(root,'original','data');
  const temp=path.join(root,'temp');
  const stopped=path.join(temp,'compute-restored-provider-Physical1234','data');
  const localAppData=path.join(root,'LocalAppData');
  const passwordFile=path.join(root,'generated-init-password');
  const oldConfigFile=path.join(root,'original-private-config.json');
  const reportPath=path.join(root,'reviewed-restore-report.json');
  let passed=false;
  t.after(async()=>{if(passed) await fs.rm(root,{recursive:true,force:false});});
  await fs.mkdir(temp,{recursive:true});
  await fs.mkdir(localAppData,{recursive:true});
  await fs.writeFile(passwordFile,randomBytes(32).toString('hex')+'\n',{flag:'wx'});
  const result=await initializeFreshClientPg17({
    bundleDirectory:bundle,expectedBundleSha256:sha,
    stateDirectory:path.join(root,'original'),pgDataDirectory:source,
    runtimeConfigFile:path.join(root,'original','disabled-runtime-config.json'),
    ownerFile:path.join(root,'roaming','disabled-owner.json'),
    passwordFile,ownerAction:'INITIALIZE_FRESH_LOCAL_POSTGRES_17_WITH_VAULT',
  });
  assert.equal(result.state,'PG17_INITIALIZED_UNPROVISIONED');
  const originalVault=await fs.readFile(path.join(source,'client-vault.key'));
  const originalControl=await fs.readFile(path.join(source,'global','pg_control'));
  await fs.mkdir(path.dirname(stopped),{recursive:true});
  await fs.cp(source,stopped,{recursive:true,force:false,errorOnExist:true,preserveTimestamps:true});
  await assert.rejects(fs.lstat(path.join(stopped,'postmaster.pid')),{code:'ENOENT'});
  const originalConfig={
    schema:'compute.runtime-host-config.v1',version:1,
    bundle_directory:path.join(root,'legacy-bundle'),expected_bundle_sha256:'a'.repeat(64),
    state_directory:path.join(root,'original'),pg_data_directory:source,
    database_url:'postgres://service:fixture@127.0.0.1:15432/metaengine',
    inspect_database_url:'postgres://inspector:fixture@127.0.0.1:15432/metaengine',
    api_port:15431,edge_port:15433,startup_timeout_ms:30000,
  };
  await fs.writeFile(oldConfigFile,JSON.stringify(originalConfig),{flag:'wx'});
  const originalConfigBytes=await fs.readFile(oldConfigFile);
  const report=JSON.stringify({
    schema:'metaengine.database-restore-report.v1',data_verified:true,schema_verified:true,
    errors:[],ddl_adaptations:[],source_dump_sha256:'b'.repeat(64),
  });
  await fs.writeFile(reportPath,report,{flag:'wx'});
  const proof=await prepareDurableRestoredPg17({
    oldConfigFile,localAppData,bundleDirectory:bundle,bundleDigest:sha,
    restoreReceiptFile:reportPath,restoreReceiptSha256:digest(Buffer.from(report)),
    postgresBinDirectory:verified.paths.postgresBinDirectory,tempDirectory:temp,
  });
  assert.equal(proof.copyVerified,true);
  assert.equal(proof.vaultPreserved,true);
  assert.equal(proof.automaticRetryAllowed,false);
  assert(proof.fileCount>100,'real cluster must contain many physical data files');
  assert.deepEqual(await fs.readFile(oldConfigFile),originalConfigBytes);
  assert.deepEqual(await fs.readFile(path.join(source,'client-vault.key')),originalVault);
  assert.deepEqual(await fs.readFile(path.join(stopped,'client-vault.key')),originalVault);
  assert.deepEqual(await fs.readFile(path.join(proof.pgDataDirectory,'client-vault.key')),originalVault);
  assert.deepEqual(await fs.readFile(path.join(proof.pgDataDirectory,'global','pg_control')),originalControl);
  const bound=JSON.parse(await fs.readFile(proof.configFile,'utf8'));
  assert.equal(bound.bundle_directory,bundle);
  assert.equal(bound.expected_bundle_sha256,sha);
  assert.equal(bound.pg_data_directory,proof.pgDataDirectory);
  assert.equal(bound.state_directory,proof.stateDirectory);
  assert.equal(bound.database_url,originalConfig.database_url);
  await assert.rejects(prepareDurableRestoredPg17({
    oldConfigFile,localAppData,bundleDirectory:bundle,bundleDigest:sha,
    restoreReceiptFile:reportPath,restoreReceiptSha256:digest(Buffer.from(report)),
    postgresBinDirectory:verified.paths.postgresBinDirectory,tempDirectory:temp,
  }),/existing_destination_requires_review/);
  passed=true;
});
