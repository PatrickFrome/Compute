// Synthetic Electron module/process fixture only; not Windows or DPAPI evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {registerHooks} from 'node:module';
import {SupervisorDeviceIdentity} from '../../apps/metaengine-browser/src/supervisor-device-identity.mjs';
const app={isPackaged:true,isReady:()=>true,hasSingleInstanceLock:()=>true,getPath:()=>{throw Error('fixture_path_unset');}};
let encryptions=0;
const storage={isEncryptionAvailable:()=>true,encryptString:value=>{encryptions++;return Buffer.from(value);},decryptString:value=>value.toString()};
globalThis.__freshNativeIdentityTest={app,storage};
const hook=registerHooks({resolve(specifier,context,next){
 if(specifier==='electron')return {url:'data:text/javascript,export const app=globalThis.__freshNativeIdentityTest.app;export const safeStorage=globalThis.__freshNativeIdentityTest.storage;',shortCircuit:true};
 return next(specifier,context);
}});
let create;
try{({createFreshInstalledDeviceIdentity:create}=await import('./fresh-provider-native-device-identity.mjs'));}
finally{hook.deregister();delete globalThis.__freshNativeIdentityTest;}
async function nativeFixture(t,run) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fresh-native-identity-fixture-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const profile=path.join(root,'Actual packaged profile');await fs.mkdir(profile);
 const saved={platform:Object.getOwnPropertyDescriptor(process,'platform'),electron:Object.getOwnPropertyDescriptor(process.versions,'electron'),
  type:Object.getOwnPropertyDescriptor(process,'type'),appData:process.env.APPDATA};
 Object.defineProperty(process,'platform',{...saved.platform,value:'win32'});
 Object.defineProperty(process.versions,'electron',{value:'synthetic-test-only',configurable:true});
 Object.defineProperty(process,'type',{value:'browser',configurable:true});process.env.APPDATA=root;
 app.getPath=name=>{assert.equal(name,'userData');return profile;};app.isPackaged=true;app.isReady=()=>true;app.hasSingleInstanceLock=()=>true;
 try{await run({root,profile,file:path.join(profile,'metaengine-native-supervisor-device-v1.json')});}
 finally{
  Object.defineProperty(process,'platform',saved.platform);
  for(const [object,key,descriptor] of [[process.versions,'electron',saved.electron],[process,'type',saved.type]]) {
   if(descriptor)Object.defineProperty(object,key,descriptor);else delete object[key];
  }
  if(saved.appData===undefined)delete process.env.APPDATA;else process.env.APPDATA=saved.appData;
  delete globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__;
 }
}
test('native adapter selects actual profile and constructor does not initialize or rotate identity',async t=>nativeFixture(t,async({file})=>{
 const before=encryptions;const identity=await create();assert(identity instanceof SupervisorDeviceIdentity);
 assert.equal(identity.snapshot(),null);assert.equal(encryptions,before);await assert.rejects(fs.stat(file),{code:'ENOENT'});
 // Explicit fixture action, not part of the factory, stands in for provider's
 // post-consent ensure. Its synthetic encryption is not custody proof.
 const state=await identity.ensure(),bytes=await fs.readFile(file);const second=await create();
 assert.equal(second.snapshot(),null);assert.equal(encryptions,before+1);assert.deepEqual(await fs.readFile(file),bytes);
 assert.equal((await second.ensure()).key_fingerprint_sha256,state.key_fingerprint_sha256);
 assert.deepEqual(await fs.readFile(file),bytes);
}));
test('native adapter rejects caller args, unpackaged/unready/secondary/shutdown contexts without key creation',async t=>nativeFixture(t,async({file})=>{
 const before=encryptions;
 await assert.rejects(create({statePath:file,secureStorage:storage}),/unavailable/);
 for(const [key,value] of [['isPackaged',false],['isReady',()=>false],['hasSingleInstanceLock',()=>false]]) {
  const old=app[key];app[key]=value;try{await assert.rejects(create(),/unavailable/);}finally{app[key]=old;}
 }
 globalThis.__METAENGINE_INSTALLER_SHUTDOWN_REQUESTED__=true;await assert.rejects(create(),/unavailable/);
 assert.equal(encryptions,before);await assert.rejects(fs.stat(file),{code:'ENOENT'});
}));
test('native adapter does not invent a profile outside actual APPDATA',async t=>nativeFixture(t,async({root,file})=>{
 app.getPath=()=>path.dirname(root);await assert.rejects(create(),/profile_mismatch/);
 await assert.rejects(fs.stat(file),{code:'ENOENT'});
}));
test('ordinary Node process cannot use native adapter even with a mocked Electron module',async()=>{
 await assert.rejects(create(),/unavailable/);
});
test('production adapter owns Electron dependency and provider imports it only after native consent',async()=>{
 const provider=await fs.readFile(new URL('./fresh-client-provider.mjs',import.meta.url),'utf8');
 const adapter=await fs.readFile(new URL('./fresh-provider-native-device-identity.mjs',import.meta.url),'utf8');
 const wrapper=await fs.readFile(new URL('../../apps/metaengine-browser/src/installed-fresh-provider-setup.mjs',import.meta.url),'utf8');
 assert.match(adapter,/import \{app,safeStorage\} from 'electron'/);
 assert.match(adapter,/export async function createFreshInstalledDeviceIdentity\(\)/);
 assert(provider.indexOf('await confirmFreshProviderNativeConsent(selected)')<provider.indexOf("await import('./fresh-provider-native-device-identity.mjs')"));
 assert.doesNotMatch(wrapper,/new SupervisorDeviceIdentity|secureStorage:|deviceIdentity\}/);
 assert.match(provider,/caller_device_identity_forbidden/);assert.match(provider,/caller_option_forbidden/);
});
