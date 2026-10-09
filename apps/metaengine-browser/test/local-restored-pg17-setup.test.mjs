import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { connectInstalledRestoredPostgres } from '../src/local-restored-pg17-setup.mjs';

const sha = 'a'.repeat(64);
const restoreSha = 'b'.repeat(64);
const receipt = {
  schema:'compute.restored-client-provider-provisioning.v1',state:'CONFIGURED',
  provider:'LOCAL_POSTGRES',existing_restored_database_selected:true,
  source_restore_receipt_verified:true,owner_profile_written:true,cleanup_confirmed:true,
  private_vault_key_preserved:true,runtime_ready:false,database_initialized:false,
  authority_effect:false,bundle_sha256:sha,source_restore_receipt_sha256:restoreSha,
  private_token:'SHOULD_NEVER_LEAK',database_url:'postgres://secret',
};
const cliPath='source/infra/client-state-runtime/restored-client-provider-cli.mjs';

async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-installed-pg17-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const pkg=path.join(dir,'package.json');
  await fs.writeFile(pkg,JSON.stringify({version:'0.7.0-dev.37781000009.1',
    metaengineClientStateRuntime:{package_version:'0.7.0-dev.37781000009.1',bundle_sha256:sha}}));
  const opts={platform:'win32',packageFile:pkg,resourcesPath:dir,
    configFile:path.join(dir,'private','runtime-host.json'),
    restoreReceiptFile:path.join(dir,'private','restore-report.json'),
    restoreReceiptSha256:restoreSha,appDataDirectory:path.join(dir,'owner'),
  };
  return opts;
}
const verified = dir => ({paths:{nodeExecutable:path.join(dir,'runtime','node','node.exe'),
  postgresBinDirectory:path.join(dir,'runtime','postgresql','bin')},
  manifest:{files:[{path:cliPath}]}});
const run = options => connectInstalledRestoredPostgres({
  ...options,verify:async({bundleDirectory,expectedBundleDigest})=>{
    assert.equal(expectedBundleDigest,sha);
    return verified(bundleDirectory);
  },launch:async()=>({stdout:JSON.stringify(receipt)})});

test('installed offline setup uses only sealed bundle Node and reviewed existing provider operator',async t=>{
  const f=await fixture(t);
  const calls=[];
  const outcome=await connectInstalledRestoredPostgres({...f,
    verify:async({bundleDirectory,expectedBundleDigest})=>{
      assert.equal(expectedBundleDigest,sha);
      assert.equal(bundleDirectory,path.join(f.resourcesPath,'client-state-runtime'));
      return verified(bundleDirectory);
    },
    launch:async(executable,argv,opts)=>{
      calls.push({executable,argv,opts});
      return {stdout:JSON.stringify(receipt)};
    },
  });
  assert.equal(outcome.state,'CONFIGURED');
  assert.equal(outcome.installed_cold_boot_verified,false);
  assert.equal(outcome.automatic_cloud_fallback,false);
  assert.equal(JSON.stringify(outcome).includes('secret'),false);
  assert.equal(calls.length,1);
  assert.match(calls[0].executable,/node\.exe$/);
  assert.match(calls[0].argv[0],/restored-client-provider-cli\.mjs$/);
  assert.deepEqual(calls[0].argv.slice(1),[
    '--config',f.configFile,'--bundle-sha256',sha,
    '--restore-receipt',f.restoreReceiptFile,'--restore-receipt-sha256',restoreSha,
    '--appdata',f.appDataDirectory,'--owner-action','USE_EXISTING_RESTORED_POSTGRES_17',
  ]);
  assert.equal(calls[0].opts.shell,false);
  assert.equal(calls[0].opts.windowsHide,true);
  assert.equal(calls[0].opts.env.COMPUTE_RUNTIME_HOST_CONFIG,undefined);
  assert.equal(calls[0].opts.env.DATABASE_URL,undefined);
});

test('installed setup is Windows-only and requires independent receipt pin',async t=>{
  const f=await fixture(t);
  await assert.rejects(run({...f,platform:'linux'}),/installed_restored_setup_arguments_invalid/);
  await assert.rejects(run({...f,restoreReceiptSha256:'bad'}),/installed_restored_setup_arguments_invalid/);
  await assert.rejects(run({...f,configFile:'relative.json'}),/installed_restored_setup_arguments_invalid/);
  await assert.rejects(run({...f,resourcesPath:'relative'}),/installed_restored_setup_arguments_invalid/);
});

test('installed setup rejects missing reviewed source and unverifiable packaged resources',async t=>{
  const f=await fixture(t);
  let effect=0;
  await assert.rejects(connectInstalledRestoredPostgres({...f,verify:async()=>{throw Error('private path');},
    launch:async()=>{effect++;}}),/installed_restored_setup_runtime_unverified/);
  await assert.rejects(connectInstalledRestoredPostgres({...f,verify:async()=>({
    paths:{nodeExecutable:path.join(f.resourcesPath,'node.exe')},manifest:{files:[]},
  }),launch:async()=>{effect++;}}),/installed_restored_setup_operator_not_in_verified_bundle/);
  assert.equal(effect,0);
});

test('installed setup blocks ambiguous operator failure, unverified receipt and secret response',async t=>{
  const f=await fixture(t);
  await assert.rejects(connectInstalledRestoredPostgres({...f,
    verify:async()=>verified(f.resourcesPath),
    launch:async()=>{throw Error('the_database_password_is_secret');},
  }),/installed_restored_setup_operator_not_confirmed/);
  await assert.rejects(connectInstalledRestoredPostgres({...f,
    verify:async()=>verified(f.resourcesPath),
    launch:async()=>({stdout:JSON.stringify({...receipt,cleanup_confirmed:false})}),
  }),/installed_restored_setup_receipt_unverified/);
  const result=await run(f);
  assert.equal(Object.values(result).some(x=>typeof x==='string' && x.includes('SHOULD_NEVER_LEAK')),false);
});

test('installed setup rejects invalid protected package identity before execution',async t=>{
  const f=await fixture(t);
  await fs.writeFile(f.packageFile,JSON.stringify({version:'v0',metaengineClientStateRuntime:{bundle_sha256:sha,package_version:'v1'}}));
  let ran=false;
  await assert.rejects(connectInstalledRestoredPostgres({...f,
    verify:async()=>{ran=true;},
    launch:async()=>{ran=true;},
  }),/installed_restored_setup_package_binding_invalid/);
  assert.equal(ran,false);
});


test('installed first run automatically prepares PG17 before invoking reviewed operator, with independent restore digest',async t=>{
  const f=await fixture(t);
  const appData=path.join(f.resourcesPath,'LocalAppData');
  const preparedConfig=path.join(appData,'METAENGINE','restored-postgres-17','runtime-host-config.json');
  const actions=[];
  const result=await connectInstalledRestoredPostgres({
    ...f,autoPrepareSource:true,localAppDataDirectory:appData,
    verify:async()=>verified(path.join(f.resourcesPath,'client-state-runtime')),
    prepare:async options=>{
      actions.push({kind:'prepare',args:options});
      return {configFile:preparedConfig,copyVerified:true,vaultPreserved:true};
    },
    launch:async (_exe,argv)=>{
      actions.push({kind:'launch',args:argv});
      return {stdout:JSON.stringify(receipt)};
    },
  });
  assert.equal(result.state,'CONFIGURED');
  assert.deepEqual(actions.map(x=>x.kind),['prepare','launch']);
  assert.equal(actions[0].args.oldConfigFile,f.configFile);
  assert.equal(actions[0].args.restoreReceiptFile,f.restoreReceiptFile);
  assert.equal(actions[0].args.restoreReceiptSha256,restoreSha);
  assert.equal(actions[0].args.bundleDigest,sha);
  assert.equal(actions[0].args.platform,'win32');
  assert.equal(actions[1].args[actions[1].args.indexOf('--config')+1],preparedConfig);
  assert.equal(actions[1].args[actions[1].args.indexOf('--restore-receipt-sha256')+1],restoreSha);
});

test('auto prepare failure denies existing-provider operator, without falling back to original config',async t=>{
  const f=await fixture(t);
  let executions=0;
  await assert.rejects(connectInstalledRestoredPostgres({
    ...f,autoPrepareSource:true,localAppDataDirectory:path.join(f.resourcesPath,'LocalAppData'),
    verify:async()=>verified(f.resourcesPath),
    prepare:async()=>{throw Error('sensitive windows private data');},
    launch:async()=>{executions++;throw Error('operator must not start');},
  }),/installed_restored_setup_durable_copy_or_rebinding_unconfirmed/);
  assert.equal(executions,0);
});
