// TEST ONLY synthetic acquisition to exercise real Host lifecycle. Neither
// this replacement nor a production acquisition hook is in the shipped graph.
import {registerHooks} from 'node:module';
const host=new URL('../runtime-host.mjs?guardian-lifecycle-test',import.meta.url).href;
const actual=new URL('../guardian-owner-consume.mjs',import.meta.url).href;
const stub='data:text/javascript,'+encodeURIComponent(`
import {validateGuardianOwnerConsumeEnvelope} from ${JSON.stringify(actual)};
export {validateGuardianOwnerConsumeEnvelope};
let acquire;
export function setAcquisitionFactory(value){acquire=value;}
export function createOwnedGuardianTicketConsumer(options){return acquire(options);}
`);
const hooks=registerHooks({resolve(specifier,context,next){
  if(context.parentURL===host&&specifier==='./guardian-owner-consume.mjs')return {url:stub,shortCircuit:true};
  return next(specifier,context);
}});
let loaded,replacement;
try{loaded=await import(host);replacement=await import(stub);}finally{hooks.deregister();}
export const startManagedRuntimeHost=loaded.startManagedRuntimeHost;
export const setAcquisitionFactory=replacement.setAcquisitionFactory;
