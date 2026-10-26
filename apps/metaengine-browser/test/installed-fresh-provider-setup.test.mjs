import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateInstalledFreshProviderReceipt} from '../src/installed-fresh-provider-setup.mjs';
const digest='a'.repeat(64);
const receipt={schema:'compute.fresh-client-provider.v1',state:'CONFIGURED',provider:'LOCAL_POSTGRES',bundle_sha256:digest,
 database_initialized:true,schema_provisioned:true,owner_profile_written:true,cleanup_confirmed:true,device_enrolled:true,admin_ready:true,
 device_id:'11111111-1111-4111-8111-111111111111',client_id:'22222222-2222-4222-8222-222222222222',request_id:'33333333-3333-4333-8333-333333333333',key_fingerprint_sha256:digest,
 guardian_ready:false,runtime_ready:false,automatic_retry_allowed:false,automatic_cloud_fallback:false,authority_effect:false};
test('first-run receipt cannot fabricate device/Guardian/execution readiness',()=>{
 assert.equal(validateInstalledFreshProviderReceipt(receipt,digest).state,'CONFIGURED');
 for(const change of [{schema_provisioned:false},{cleanup_confirmed:false},{device_enrolled:false},{admin_ready:false},{device_id:null},{request_id:null},{guardian_ready:true},{runtime_ready:true},{automatic_retry_allowed:true},{bundle_sha256:'b'.repeat(64)},{authority_effect:true}])assert.throws(()=>validateInstalledFreshProviderReceipt({...receipt,...change},digest),/receipt_unconfirmed/);
});
test('actual admitted-primary path preserves existing attach then calls installed fresh operator only without descriptor',async()=>{
 const main=await readFile(new URL('../src/main-entry.mjs',import.meta.url),'utf8');
 assert.match(main,/autoConnectInstalledAttachedProvider/);
 assert.match(main,/if \(setup.state === 'NO_DESCRIPTOR'.*\{/);
 assert.match(main,/await setupInstalledFreshProvider\(\{ app, dialog \}\)/);
 assert(main.indexOf('await setupInstalledFreshProvider')<main.indexOf('requirePackagedLocalProviderAdmission({'));
 assert.match(main,/PRIMARY_PROVIDER_PREPARATION_UNCONFIRMED/);
 const setup=await readFile(new URL('../src/installed-fresh-provider-setup.mjs',import.meta.url),'utf8');
 assert(setup.indexOf('await verify(')<setup.indexOf('await import(pathToFileURL'));
 assert.doesNotMatch(setup,/dialog.showMessageBox/);
 assert.match(setup,/source\/infra\/client-state-runtime\/fresh-client-provider.mjs/);
 assert.doesNotMatch(setup,/PGPASSWORD|database_url|--password/);
});

test('shutdown cancellation performs no launch and creates no private namespace',async t=>{
 const fs=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');
 const {setupInstalledFreshProvider}=await import('../src/installed-fresh-provider-setup.mjs');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fresh-consent-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const pkg=path.join(root,'package.json');await fs.writeFile(pkg,JSON.stringify({version:'1',metaengineClientStateRuntime:{package_version:'1',bundle_sha256:digest}}));
 let launched=0,asked=0;
 const options={platform:'win32',env:{LOCALAPPDATA:root,APPDATA:root},resourcesPath:root,packageFile:pkg,
  app:{isPackaged:true,whenReady:async()=>{}},dialog:{showMessageBox:async()=>{asked++;return {response:1};}},
  verify:async()=>({manifest:{files:[{path:'source/infra/client-state-runtime/fresh-client-provider.mjs'},{path:'source/infra/client-state-runtime/fresh-provider-native-device-identity.mjs'}]},paths:{}}),
  launch:async()=>{launched++;throw Error('unexpected');}};
 globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__=true;
 try {await assert.rejects(setupInstalledFreshProvider(options),/cancelled/);}finally{delete globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__;}
 assert.equal(asked,0);assert.equal(launched,0);
 assert.deepEqual(await fs.readdir(root),['package.json']);
});
test('existing interrupted namespace holds before consent or launch and preserves journal bytes',async t=>{
 const fs=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');
 const {setupInstalledFreshProvider}=await import('../src/installed-fresh-provider-setup.mjs');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fresh-restart-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const pkg=path.join(root,'package.json');await fs.writeFile(pkg,JSON.stringify({version:'1',metaengineClientStateRuntime:{package_version:'1',bundle_sha256:digest}}));
 const state=path.join(root,'METAENGINE','client-first-run-v1');await fs.mkdir(state,{recursive:true});
 await fs.writeFile(path.join(state,'install-journal.json'),'UNKNOWN exact bytes');let calls=0;
 await assert.rejects(setupInstalledFreshProvider({platform:'win32',env:{LOCALAPPDATA:root,APPDATA:root},resourcesPath:root,packageFile:pkg,
  app:{isPackaged:true,whenReady:async()=>{}},dialog:{showMessageBox:async()=>{calls++;}},
  verify:async()=>({manifest:{files:[{path:'source/infra/client-state-runtime/fresh-client-provider.mjs'},{path:'source/infra/client-state-runtime/fresh-provider-native-device-identity.mjs'}]},paths:{}}),
  launch:async()=>{calls++;}}),/existing_setup_requires_review/);
 assert.equal(calls,0);assert.equal(await fs.readFile(path.join(state,'install-journal.json'),'utf8'),'UNKNOWN exact bytes');
 assert.deepEqual(await fs.readdir(state),['install-journal.json']);
});

test('uses actual Electron profile under APPDATA, never a guessed product-name identity',async t=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {validateInstalledFreshIdentityDirectory}=await import('../src/fresh-provider-device-profile.mjs');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fresh-actual-profile-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const actual=path.join(root,'Actual installed Browser profile');await fs.mkdir(actual);
 await fs.writeFile(path.join(actual,'device.json'),'exact pre-existing profile bytes');
 assert.equal(await validateInstalledFreshIdentityDirectory(actual,root),actual);
 assert.equal(await fs.readFile(path.join(actual,'device.json'),'utf8'),'exact pre-existing profile bytes');
 await assert.rejects(validateInstalledFreshIdentityDirectory(path.dirname(root),root),/profile_mismatch/);
 await assert.rejects(validateInstalledFreshIdentityDirectory(root,root),/profile_mismatch/);
 await assert.rejects(validateInstalledFreshIdentityDirectory('relative',root),/profile_mismatch/);
 if(process.platform!=='win32') {
  const alias=path.join(root,'alias');await fs.symlink(actual,alias);
  await assert.rejects(validateInstalledFreshIdentityDirectory(alias,root),/alias_forbidden/);
 }
});
