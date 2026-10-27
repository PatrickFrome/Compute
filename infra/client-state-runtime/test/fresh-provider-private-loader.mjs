// Test-process-only access to the private transaction helper. This loader is NOT
// in the production import graph or runtime resource closure. No body rewriting,
// mocks or changes to the owning provider are installed in production.
import {registerHooks} from 'node:module';
const target=new URL('../fresh-client-provider.mjs?private-helper-qualification',import.meta.url).href;
const hook=registerHooks({load(url,context,nextLoad){
  const result=nextLoad(url,context);
  return url===target?{...result,source:String(result.source)+'\nexport {populateFreshClientSchema,enrollFreshLocalDeviceOwner};\n'}:result;
}});
let privateModule;
try {privateModule=await import(target);}finally{hook.deregister();}
export const populateFreshClientSchema=privateModule.populateFreshClientSchema;

export const enrollFreshLocalDeviceOwner=privateModule.enrollFreshLocalDeviceOwner;
