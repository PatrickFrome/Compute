import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import * as paths from '../src/native-coding-operator-paths.mjs';
import {PRIVATE_NATIVE_TOOL_REQUIRED_FILES,privateNativeToolsBinding,resolvePrivateNativeTools} from '../src/private-native-tools-core.mjs';

// Generated inert byte/placement contracts, not installer/ACL/native/release evidence.
// No fixture executable is run.
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'generated-installed-tools-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const resourcesPath=path.join(root,'install','resources'),stateDirectory=path.join(root,'state');
 const bundle=path.join(resourcesPath,'client-state-runtime'),toolsRoot=path.join(resourcesPath,'private-native-tools');
 const components=[];
 for(const [id,entrypoint]of [['git','ucrt64/bin/git.exe'],['codex','bin/codex.exe']]){
  const files=[];
  for(const name of [...PRIVATE_NATIVE_TOOL_REQUIRED_FILES[id]].sort()){
   const file=path.join(toolsRoot,id,name),bytes=Buffer.from('generated inert '+id+'/'+name);
   await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);
   files.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  components.push({id,version:id==='git'?'2.56.0.4':'0.166.0',repository:id==='git'?'git-for-windows/git':'openai/codex',
   tag:'generated',release_id:1,asset_id:2,archive_name:id+'.zip',archive_sha256:'a'.repeat(64),archive_bytes:1,entrypoint,files});
 }
 const bytes=Buffer.from(JSON.stringify({schema:'metaengine.private-native-tools.v1',platform:'win32',arch:'x64',components}));
 await fs.writeFile(path.join(toolsRoot,'manifest.json'),bytes);
 const privateTools=await resolvePrivateNativeTools({toolsRoot,binding:privateNativeToolsBinding(bytes)});
 const pin=role=>({path:path.join(stateDirectory,'sandbox',role+'.json'),sha256:'a'.repeat(64)});
 const operator={schema:'metaengine.native-coding.operator-paths.v1',
  cli_executable:privateTools.cliExecutable,git_executable:privateTools.gitExecutable,
  codex_home:path.join(stateDirectory,'codex-home'),journal_root:path.join(stateDirectory,'journal'),
  worker_temp_root:path.join(stateDirectory,'worker-temp'),result_index_root:path.join(stateDirectory,'result-index'),
  sandbox_receipts:{IMPLEMENTER:pin('IMPLEMENTER'),CRITIC:pin('CRITIC')}};
 return {operator,resourcesPath,stateDirectory,bundle,privateTools};
}
const validate=f=>paths.validateNativeCodingInstalledPathScope(f.operator,f);

test('installed path scope accepts only explicit installation/private-state placement and grants no trust',async t=>{
 const f=await fixture(t),value=validate(f);assert.equal(value,f.operator);assert.equal(Object.isFrozen(value),true);
 assert.equal(Object.hasOwn(value,'verified'),false);assert.equal(Object.hasOwn(value,'production_qualified'),false);
});
for(const key of ['cli_executable','git_executable'])for(const location of ['external','bundle-root','prefix-sibling'])
test(key+' refuses '+location+' instead of borrowing a preinstalled tool',async t=>{
 const f=await fixture(t);f.operator[key]=location==='external'?path.resolve('preinstalled-tools',key):location==='bundle-root'?f.bundle:path.join(f.bundle+'-borrowed',key);
 assert.throws(()=>validate(f),/native_coding_installed_path_scope_tool_not_owned/);
});
for(const key of ['codex_home','journal_root','worker_temp_root','result_index_root'])for(const location of ['old-profile','state-root'])
test(key+' refuses '+location+' as fresh installation evidence',async t=>{
 const f=await fixture(t);f.operator[key]=location==='old-profile'?path.resolve('old-user-profile',key):f.stateDirectory;
 assert.throws(()=>validate(f),/native_coding_installed_path_scope_state_not_owned/);
});
test('sandbox receipts and per-provider receipts must stay under the owned private state root',async t=>{
 const f=await fixture(t);f.operator.sandbox_receipts.CRITIC.path=path.resolve('old-profile','canary.json');
 assert.throws(()=>validate(f),/state_not_owned/);
 const g=await fixture(t);g.operator.provider_sandbox_receipts=['IMPLEMENTER','CRITIC'].map(role=>({provider_id:randomUUID(),
  agent_id:'agent_generated123',role,path:path.join(g.stateDirectory,'sandbox',role+'.json'),sha256:'b'.repeat(64)}));
 validate(g);const changed={...g,operator:structuredClone(g.operator)};changed.operator.provider_sandbox_receipts[1].path=path.resolve('old-profile','provider-canary.json');
 assert.throws(()=>validate(changed),/state_not_owned/);
});
for(const overlap of ['equal','state-in-resources','resources-in-state'])test('installed and mutable roots refuse '+overlap,async t=>{
 const f=await fixture(t);if(overlap==='equal')f.stateDirectory=f.resourcesPath;
 if(overlap==='state-in-resources')f.stateDirectory=path.join(f.resourcesPath,'private');
 if(overlap==='resources-in-state')f.resourcesPath=path.join(f.stateDirectory,'resources');
 assert.throws(()=>validate(f),/roots_overlap/);
});
for(const key of ['resourcesPath','stateDirectory'])test('missing/relative '+key+' is not inferred from current directory or profile',async t=>{
 for(const value of [undefined,'','relative-root']){const f=await fixture(t);f[key]=value;assert.throws(()=>validate(f),/roots_invalid/);}
});
test('ordinary legacy descriptor validation remains separate from installed scope admission',async t=>{
 const f=await fixture(t);f.operator.git_executable=path.resolve('preinstalled','git.exe');
 assert.equal(paths.validateNativeCodingOperatorPaths(f.operator),f.operator);
 assert.throws(()=>validate(f),/tool_not_owned/);
});
