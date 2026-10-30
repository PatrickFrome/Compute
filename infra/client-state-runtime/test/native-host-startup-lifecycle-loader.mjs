// TEST ONLY: keep actual Host composition, substitute private acquisitions.
// No production hooks or fabricated Windows/PG evidence are shipped.
import {registerHooks} from 'node:module';
const host=new URL('../runtime-host.mjs?native-startup-lifecycle-test',import.meta.url).href;
const stub='data:text/javascript,'+encodeURIComponent(`
import {createNativeCodingHostCapacity as actualCapacity} from '${new URL('../native-coding-host-capacity.mjs',import.meta.url).href}';
let options;
export function setNativeStartupFixture(value){options=value;}
export async function readNativeCodingOperatorPaths(){return options.readOperator();}
export function createNativeCodingHostOsScope(){return {readNativeScope:async()=>({}),readCallbackPrefix:async()=>{throw Error('generated_unused_prefix');},readPublicationHost:async()=>{throw Error('generated_unused_birth');}};}
export function createNativeCodingHostCapacity(input){return options.capacityFixture||actualCapacity(input);}
export default function postgres(){return options.sql;}
export function createNativeCodingHostSeedBinding(){return options.binding;}
export async function createNativeCodingHostAuthority(input){return options.createAuthority(input);}
`);
const replaced=new Set(['./native-coding-host-capacity.mjs','./native-coding-host-os-scope.mjs','./native-coding-host-seed-binding.mjs','./native-coding-host-authority.mjs','postgres']);
const hooks=registerHooks({resolve(specifier,context,next){
 if(context.parentURL===host&&replaced.has(specifier))return {url:stub,shortCircuit:true};
 return next(specifier,context);
}});
const loaded=await import(host),replacement=await import(stub);
export const startManagedRuntimeHost=loaded.startManagedRuntimeHost;
export const setNativeStartupFixture=replacement.setNativeStartupFixture;
export const closeLoader=()=>hooks.deregister();
