import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { connectInstalledRestoredPostgres, showInstalledRestoredProviderWizard } from '../src/local-restored-pg17-setup.mjs';

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
    inspectMode:async()=>({postgresMode:'owned'}),
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
    inspectMode:async()=>({postgresMode:'owned'}),
    verify:async()=>verified(f.resourcesPath),
    prepare:async()=>{throw Error('sensitive windows private data');},
    launch:async()=>{executions++;throw Error('operator must not start');},
  }),/installed_restored_setup_durable_copy_or_rebinding_unconfirmed/);
  assert.equal(executions,0);
});

test('installed attached first run rebinds verified direct config without invoking stopped-copy preparation',async t=>{
  const f=await fixture(t);
  const preparedConfig=path.join(f.resourcesPath,'client-private','attached-config.json');
  const actions=[];
  const outcome=await connectInstalledRestoredPostgres({...f,autoPrepareSource:true,expectedPostgresMode:'attached',
    localAppDataDirectory:path.join(f.resourcesPath,'LocalAppData'),inspectMode:async()=>({postgresMode:'attached'}),
    verify:async()=>verified(f.resourcesPath),prepare:async()=>{assert.fail('running Keeper must never enter copy preparation');},
    prepareAttached:async options=>{actions.push(['prepare',options]);return {configFile:preparedConfig,
      postgresMode:'attached',apiRoleMode:'direct',clusterPinPreserved:true,postgresLifecycleOwned:false,
      copyVerified:false,vaultPreserved:true};},
    launch:async(_exe,argv)=>{actions.push(['launch',argv]);return {stdout:JSON.stringify({...receipt,
      postgres_mode:'attached',api_role_mode:'direct',postgres_lifecycle_owned:false,attached_postmaster_preserved:true})};},
  });
  assert.equal(outcome.postgres_mode,'attached');
  assert.deepEqual(actions.map(row=>row[0]),['prepare','launch']);
  assert.equal(actions[0][1].oldConfigFile,f.configFile);
  assert.equal(actions[1][1][actions[1][1].indexOf('--config')+1],preparedConfig);
});

test('attached setup rejects ambiguous preparation, lifecycle receipt and mode drift before owner readiness',async t=>{
  const f=await fixture(t);
  const options={...f,autoPrepareSource:true,expectedPostgresMode:'attached',localAppDataDirectory:path.join(f.resourcesPath,'LocalAppData'),
    inspectMode:async()=>({postgresMode:'attached'}),verify:async()=>verified(f.resourcesPath),
    prepareAttached:async()=>({configFile:f.configFile,postgresMode:'attached',apiRoleMode:'direct',clusterPinPreserved:true,
      postgresLifecycleOwned:false,copyVerified:false,vaultPreserved:true})};
  for(const patch of [{},{postgres_mode:'attached',api_role_mode:'service_role',postgres_lifecycle_owned:false,attached_postmaster_preserved:true},
    {postgres_mode:'attached',api_role_mode:'direct',postgres_lifecycle_owned:true,attached_postmaster_preserved:true},
    {postgres_mode:'attached',api_role_mode:'direct',postgres_lifecycle_owned:false,attached_postmaster_preserved:false}]){
    await assert.rejects(connectInstalledRestoredPostgres({...options,launch:async()=>({stdout:JSON.stringify({...receipt,...patch})})}),
      /attached_receipt_unverified/);
  }
  let effects=0;
  await assert.rejects(connectInstalledRestoredPostgres({...options,inspectMode:async()=>({postgresMode:'owned'}),
    prepare:async()=>{effects++;},launch:async()=>{effects++;}}),/durable_copy_or_rebinding_unconfirmed/);
  await assert.rejects(connectInstalledRestoredPostgres({...options,prepareAttached:async()=>({configFile:f.configFile,
    postgresMode:'attached',apiRoleMode:'service_role',clusterPinPreserved:true,postgresLifecycleOwned:false,copyVerified:false,vaultPreserved:true}),
    launch:async()=>{effects++;}}),/durable_copy_unverified/);
  assert.equal(effects,0);
});

test('idle first-run setup closes on installer control and releases admission without starting an operator',{
  skip:process.platform!=='win32',
},async t=>{
  const f=await fixture(t);
  const app=new EventEmitter();
  app.isPackaged=true;
  app.whenReady=async()=>{};
  const handlers=new Map();
  let window,shown;
  const displayed=new Promise(resolve=>{shown=resolve;});
  class Window extends EventEmitter {
    constructor(){super();window=this;this.webContents=new EventEmitter();this.webContents.id=23;
      this.webContents.setWindowOpenHandler=()=>{};this.destroyed=false;}
    isDestroyed(){return this.destroyed;}
    setMenu(){}
    async loadFile(){}
    show(){shown();}
    close(){let prevented=false;this.emit('close',{preventDefault:()=>{prevented=true;}});
      if(!prevented){this.destroyed=true;this.emit('closed');}}
  }
  let operators=0;
  const completion=showInstalledRestoredProviderWizard({app,BrowserWindow:Window,
    ipcMain:{handle:(key,handler)=>handlers.set(key,handler),removeHandler:key=>handlers.delete(key)},
    dialog:{},resourcesPath:f.resourcesPath,env:{APPDATA:f.appDataDirectory,LOCALAPPDATA:path.join(f.resourcesPath,'local')},
    operator:async()=>{operators++;assert.fail('idle wizard must never start an operator');}});
  await displayed;
  assert.equal(handlers.size,2);
  app.emit('second-instance',null,['browser.exe','--metaengine-installer-shutdown']);
  assert.deepEqual(await completion,{state:'CANCELLED',authority_effect:false});
  assert.equal(window.destroyed,true);
  assert.equal(handlers.size,0);
  assert.equal(app.listenerCount('second-instance'),0);
  assert.equal(operators,0);
});
