import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import * as paths from '../src/native-coding-operator-paths.mjs';

// Generated placement contracts, not installer/ACL/native/release evidence.
function fixture(){
 const resourcesPath=path.resolve('generated-install','resources'),stateDirectory=path.resolve('generated-private-state');
 const bundle=path.join(resourcesPath,'client-state-runtime');
 const pin=role=>({path:path.join(stateDirectory,'sandbox',role+'.json'),sha256:'a'.repeat(64)});
 const operator={schema:'metaengine.native-coding.operator-paths.v1',
  cli_executable:path.join(bundle,'runtime','codex','codex.exe'),git_executable:path.join(bundle,'runtime','git','bin','git.exe'),
  codex_home:path.join(stateDirectory,'codex-home'),journal_root:path.join(stateDirectory,'journal'),
  worker_temp_root:path.join(stateDirectory,'worker-temp'),result_index_root:path.join(stateDirectory,'result-index'),
  sandbox_receipts:{IMPLEMENTER:pin('IMPLEMENTER'),CRITIC:pin('CRITIC')}};
 return {operator,resourcesPath,stateDirectory,bundle};
}
const validate=f=>paths.validateNativeCodingInstalledPathScope(f.operator,f);

test('installed path scope accepts only explicit installation/private-state placement and grants no trust',()=>{
 const f=fixture(),value=validate(f);assert.equal(value,f.operator);assert.equal(Object.isFrozen(value),true);
 assert.equal(Object.hasOwn(value,'verified'),false);assert.equal(Object.hasOwn(value,'production_qualified'),false);
});
for(const key of ['cli_executable','git_executable'])for(const location of ['external','bundle-root','prefix-sibling'])
test(key+' refuses '+location+' instead of borrowing a preinstalled tool',()=>{
 const f=fixture();f.operator[key]=location==='external'?path.resolve('preinstalled-tools',key):location==='bundle-root'?f.bundle:path.join(f.bundle+'-borrowed',key);
 assert.throws(()=>validate(f),/native_coding_installed_path_scope_tool_not_owned/);
});
for(const key of ['codex_home','journal_root','worker_temp_root','result_index_root'])for(const location of ['old-profile','state-root'])
test(key+' refuses '+location+' as fresh installation evidence',()=>{
 const f=fixture();f.operator[key]=location==='old-profile'?path.resolve('old-user-profile',key):f.stateDirectory;
 assert.throws(()=>validate(f),/native_coding_installed_path_scope_state_not_owned/);
});
test('sandbox receipts and per-provider receipts must stay under the owned private state root',()=>{
 const f=fixture();f.operator.sandbox_receipts.CRITIC.path=path.resolve('old-profile','canary.json');
 assert.throws(()=>validate(f),/state_not_owned/);
 const g=fixture();g.operator.provider_sandbox_receipts=['IMPLEMENTER','CRITIC'].map(role=>({provider_id:randomUUID(),
  agent_id:'agent_generated123',role,path:path.join(g.stateDirectory,'sandbox',role+'.json'),sha256:'b'.repeat(64)}));
 validate(g);const changed=structuredClone(g);changed.operator.provider_sandbox_receipts[1].path=path.resolve('old-profile','provider-canary.json');
 assert.throws(()=>validate(changed),/state_not_owned/);
});
for(const overlap of ['equal','state-in-resources','resources-in-state'])test('installed and mutable roots refuse '+overlap,()=>{
 const f=fixture();if(overlap==='equal')f.stateDirectory=f.resourcesPath;
 if(overlap==='state-in-resources')f.stateDirectory=path.join(f.resourcesPath,'private');
 if(overlap==='resources-in-state')f.resourcesPath=path.join(f.stateDirectory,'resources');
 assert.throws(()=>validate(f),/roots_overlap/);
});
for(const key of ['resourcesPath','stateDirectory'])test('missing/relative '+key+' is not inferred from current directory or profile',()=>{
 for(const value of [undefined,'','relative-root']){const f=fixture();f[key]=value;assert.throws(()=>validate(f),/roots_invalid/);}
});
test('ordinary legacy descriptor validation remains separate from installed scope admission',()=>{
 const f=fixture();f.operator.git_executable=path.resolve('preinstalled','git.exe');
 assert.equal(paths.validateNativeCodingOperatorPaths(f.operator),f.operator);
 assert.throws(()=>validate(f),/tool_not_owned/);
});
