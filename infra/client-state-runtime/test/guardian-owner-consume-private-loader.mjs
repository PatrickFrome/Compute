// TEST ONLY. Not included in runtime closure; no injected production authority.
import {registerHooks} from 'node:module';
const target=new URL('../guardian-owner-consume.mjs?private-transaction-test',import.meta.url).href;
const hook=registerHooks({load(url,context,nextLoad){const loaded=nextLoad(url,context);
  return url===target?{...loaded,source:String(loaded.source)+'\nexport {createGuardianConsumeTransaction,requestShape,verifyGuardianOwnerDatabase};\n'}:loaded;}});
let module;try{module=await import(target);}finally{hook.deregister();}
export const createGuardianConsumeTransaction=module.createGuardianConsumeTransaction;
export const requestShape=module.requestShape;

export const verifyGuardianOwnerDatabase=module.verifyGuardianOwnerDatabase;
