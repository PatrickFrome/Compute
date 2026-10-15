// W65 disposable CI-fixture environment ONLY. Never used to claim Host/Owner proof.
import path from 'node:path';
const keys=['PATH','PATHEXT','COMSPEC','APPDATA','LOCALAPPDATA',
  'HOMEDRIVE','HOMEPATH','USERPROFILE','TEMP','TMP','ProgramFiles','ProgramData'];
export function pinDisposableWinPsAclFixtureEnv(parent=process.env,platform=process.platform){
  if(platform!=='win32')return {state:'UNKNOWN',reason:'WINDOWS_ACL_UNSUPPORTED'};
  const root=String(parent?.SystemRoot||parent?.SYSTEMROOT||'');
  if(!/^[A-Za-z]:\\Windows$/i.test(root))
    return {state:'UNKNOWN',reason:'WINDOWS_SYSTEM_ROOT_UNBOUND'};
  const env=Object.fromEntries(keys.filter(k=>typeof parent[k]==='string'
    &&parent[k].length<8192).map(k=>[k,parent[k]]));
  Object.assign(env,{SystemRoot:root,SYSTEMROOT:root,WINDIR:root,
    PSModulePath:path.win32.join(root,'System32','WindowsPowerShell','v1.0','Modules')});
  return {state:'FIXTURE_ONLY',reason:'NO_OWNER_OR_INSTALLED_PROOF',
    exe:path.win32.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe'),env};
}
