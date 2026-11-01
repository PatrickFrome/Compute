// Test-only subprocess interception. No Windows image, initdb, credential or
// cluster is executed or qualified. Exercise the real launch call's environment.
import {registerHooks} from 'node:module';
const target=new URL('../fresh-pg17-initdb.mjs',import.meta.url);
const mock='data:text/javascript;base64,'+Buffer.from(`export function execFile(file,args,options,callback){
  globalThis.__ownedInitdbCapture={file,args,options};callback(null,'','');return {};
}`).toString('base64');
const hook=registerHooks({resolve(specifier,context,next){
  return context.parentURL===target.href&&specifier==='node:child_process'
    ?{url:mock,shortCircuit:true}:next(specifier,context);
}});
const {runClientInitdb}=await import(target.href);
const descriptor=Object.getOwnPropertyDescriptor(process,'platform');
Object.defineProperty(process,'platform',{...descriptor,value:'win32'});
for(const key of Object.keys(process.env))delete process.env[key];
Object.assign(process.env,{
  TEMP:'C:\\Users\\Runner\\AppData\\Local\\Temp',TMP:'C:\\Users\\Runner\\AppData\\Local\\Temp',
  USERPROFILE:'C:\\Users\\Runner',APPDATA:'C:\\Users\\Runner\\AppData\\Roaming',
  LOCALAPPDATA:'C:\\Users\\Runner\\AppData\\Local',SystemRoot:'C:\\Windows',
  PATH:'D:\\preinstalled-tools',NODE_OPTIONS:'--require fixture-private-token',
  NODE_PATH:'D:\\private-modules',PGPASSWORD:'fixture-private-password',HTTP_PROXY:'fixture-private-proxy',
});
try {
  await runClientInitdb({executable:'C:\\METAENGINE\\resources\\client-state-runtime\\runtime\\postgresql\\bin\\initdb.exe',
    dataDirectory:'C:\\METAENGINE-owned-state\\pg17',passwordFile:'C:\\METAENGINE-owned-state\\initdb-password',
    stateDirectory:'C:\\METAENGINE-owned-state',databaseOwner:'state_owner'});
}finally{hook.deregister();Object.defineProperty(process,'platform',descriptor);}
console.log(JSON.stringify(globalThis.__ownedInitdbCapture));
