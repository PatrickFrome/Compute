// Subprocess-only loader. No package, native consent, PostgreSQL, credential,
// protected identity or runtime host is executed or qualified by this fixture.
import {registerHooks} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const options=JSON.parse(process.argv[2]);
const runtime=new URL('../',import.meta.url);
const provider=new URL('fresh-client-provider.mjs',runtime);
const installed=new URL('../../../apps/metaengine-browser/src/installed-fresh-provider-setup.mjs',import.meta.url);
const events=[];
globalThis.__freshConsentTrace=event=>events.push(event);
globalThis.__freshConsentFixture=options;
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const effect=name=>`export async function ${name}(){globalThis.__freshConsentTrace('unexpected-effect:${name}');throw Error('fixture_effect_forbidden');}`;
const mocks=new Map([
  [new URL('offline-runtime-bundle.mjs',runtime).href,data(`export async function verifyOfflineRuntimeBundle(){globalThis.__freshConsentTrace('bundle-read');return {manifest:{bundle_sha256:globalThis.__freshConsentFixture.digest},paths:{}};}`)],
  [new URL('fresh-schema-application-plan.mjs',runtime).href,data(`export async function loadFreshSchemaApplicationPlan(){globalThis.__freshConsentTrace('schema-read');return {};}${effect('verifyFreshSchemaCatalogue')}`)],
  [new URL('fresh-provider-native-consent.mjs',runtime).href,data(`export async function confirmFreshProviderNativeConsent(){globalThis.__freshConsentTrace('native-consent-boundary');if(globalThis.__freshConsentFixture.mode!=='post-consent-identity')throw Error(globalThis.__freshConsentFixture.reason);}`)],
  [new URL('fresh-provider-native-device-identity.mjs',runtime).href,data(`export async function createFreshInstalledDeviceIdentity(){globalThis.__freshConsentTrace('identity-object-created');return {ensure:async()=>{globalThis.__freshConsentTrace('identity-ensure-denied-without-write');throw Error('fresh_provider_native_consent_declined');}};}`)],
  [new URL('fresh-pg17-initdb.mjs',runtime).href,data(effect('initializeFreshClientPg17'))],
  [new URL('owned-postgres-process.mjs',runtime).href,data(effect('startOwnedWindowsPostgres'))],
  [new URL('persistent-client-provider.mjs',runtime).href,data(effect('provisionPersistentClientProvider'))],
]);
const host=new URL('../../../apps/metaengine-browser/src/local-runtime-host-controller.mjs',import.meta.url).href;
const acl=new URL('../../../apps/metaengine-browser/src/private-windows-storage-acl.mjs',import.meta.url).href;
const mutators=new Map([
  [host,data(effect('startConfiguredLocalRuntimeHost')+effect('stopOwnedLocalRuntimeHost'))],
  [acl,data(effect('protectOwnerOnlyWindowsDirectory')+effect('verifyOwnerOnlyWindowsStorage'))],
]);
const bundleEntry=pathToFileURL(path.join(options.bundleDirectory,'source','infra','client-state-runtime','fresh-client-provider.mjs')).href;
const hook=registerHooks({resolve(specifier,context,nextResolve){
  if(specifier===bundleEntry)return {url:provider.href,shortCircuit:true};
  if(context.parentURL===provider.href&&specifier==='node:child_process')return {url:data(`export function execFile(){globalThis.__freshConsentTrace('unexpected-effect:execFile');throw Error('fixture_effect_forbidden');}`),shortCircuit:true};
  const result=nextResolve(specifier,context);
  const mock=mocks.get(result.url)||(context.parentURL===provider.href?mutators.get(result.url):null);
  return mock?{url:mock,shortCircuit:true}:result;
}});
const platform=Object.getOwnPropertyDescriptor(process,'platform');
const electron=Object.getOwnPropertyDescriptor(process.versions,'electron');
const oldType=process.type;
Object.defineProperty(process,'platform',{...platform,value:'win32'});
if(options.mode==='post-consent-identity'){
  Object.defineProperty(process.versions,'electron',{configurable:true,value:'fixture-only'});
  process.type='browser';
}
process.env.APPDATA=options.appData;process.env.LOCALAPPDATA=options.localAppData;
globalThis.fetch=async()=>{events.push('unexpected-effect:fetch');throw Error('fixture_network_forbidden');};
let reason=null;
try {
  if(options.entry==='installed'){
    const {setupInstalledFreshProvider}=await import(installed.href);
    await setupInstalledFreshProvider({platform:'win32',env:{APPDATA:options.appData,LOCALAPPDATA:options.localAppData},
      app:{isPackaged:true,whenReady:async()=>events.push('app-ready')},resourcesPath:options.resourcesPath,packageFile:options.packageFile,
      verify:async()=>{events.push('installed-bundle-read');return {manifest:{files:[
        {path:'source/infra/client-state-runtime/fresh-client-provider.mjs'},
        {path:'source/infra/client-state-runtime/fresh-provider-native-device-identity.mjs'},
      ]},paths:{}};}});
  }else{
    const {provisionFreshClientProvider}=await import(provider.href);
    await provisionFreshClientProvider({localAppData:options.localAppData,appData:options.appData,
      bundleDirectory:options.bundleDirectory,expectedBundleDigest:options.digest,
      ownerAction:'INITIALIZE_FRESH_LOCAL_POSTGRES_17_WITH_VAULT'});
  }
}catch(error){reason=String(error?.message||error);}
finally{
  hook.deregister();Object.defineProperty(process,'platform',platform);
  if(electron)Object.defineProperty(process.versions,'electron',electron);else delete process.versions.electron;
  if(oldType===undefined)delete process.type;else process.type=oldType;
}
const absent=async file=>{try{await fs.lstat(file);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}};
const root=path.join(options.localAppData,'METAENGINE','client-first-run-v1');
console.log(JSON.stringify({schema:'metaengine.test.fresh-provider-consent-denial.v1',reason,events,
  setup_root_absent:await absent(root),owner_absent:await absent(path.join(options.appData,'@metaengine','browser-shell','metaengine-state-provider-v1.json')),
  profile_identity_absent:await absent(path.join(options.profile,'metaengine-native-supervisor-device-v1.json')),
  native_consent_qualified:false,database_started:false,authority_effect:false}));
