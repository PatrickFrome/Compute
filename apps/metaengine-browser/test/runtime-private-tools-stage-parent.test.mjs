import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {preparePrivateToolsStagingParent} from '../scripts/stage-client-state-runtime.mjs';
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'runtime-native-parent-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'apps/metaengine-browser'),{recursive:true});return root;
}
test('clean checkout creates only the fixed native parent and keeps extractor child exclusive',async t=>{
 const root=await fixture(t),parent=await preparePrivateToolsStagingParent(root);
 assert.equal(parent,path.join(root,'apps/metaengine-browser/native-dist'));
 assert.deepEqual(await fs.readdir(parent),[]);assert.equal(await preparePrivateToolsStagingParent(root),parent);
 await assert.rejects(fs.lstat(path.join(parent,'private-native-tools')),{code:'ENOENT'});
 await fs.writeFile(path.join(parent,'preserved'),'existing build output');
 await preparePrivateToolsStagingParent(root);assert.equal(await fs.readFile(path.join(parent,'preserved'),'utf8'),'existing build output');
});
test('native parent file or junction cannot redirect staging or be replaced',async t=>{
 const root=await fixture(t),parent=path.join(root,'apps/metaengine-browser/native-dist');
 await fs.writeFile(parent,'not a directory');await assert.rejects(preparePrivateToolsStagingParent(root),/native_parent_alias/);
 assert.equal(await fs.readFile(parent,'utf8'),'not a directory');await fs.unlink(parent);
 const target=path.join(root,'other');await fs.mkdir(target);
 try{await fs.symlink(target,parent,process.platform==='win32'?'junction':'dir');}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('fixture link unavailable');return;}throw error;}
 await assert.rejects(preparePrivateToolsStagingParent(root),/native_parent_alias/);assert.deepEqual(await fs.readdir(target),[]);
});
test('runtime producer prepares fixed parent before acquisition and strict extractor',async()=>{
 const source=await fs.readFile(new URL('../scripts/stage-client-state-runtime.mjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('export async function stageClientStateRuntime('));
 const prepare=body.indexOf('await preparePrivateToolsStagingParent(root)'),acquire=body.indexOf('await acquirePrivateNativeToolArchives('),stage=body.indexOf('await stagePrivateNativeTools(');
 assert.ok(prepare>0&&prepare<acquire&&acquire<stage);
});
