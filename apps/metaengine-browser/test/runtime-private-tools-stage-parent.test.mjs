import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {preparePrivateToolsStagingParent,externalBuildWorkDirectory} from '../scripts/stage-client-state-runtime.mjs';
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


test('tool archive acquisition stays outside the checkout without weakening source cleanliness',async t=>{
 const root=await fixture(t),external=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'runtime-tool-archives-')));
 t.after(()=>fs.rm(external,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
 git('init','--quiet');git('config','core.autocrlf','false');
 await fs.writeFile(path.join(root,'.gitignore'),await fs.readFile(new URL('../../../.gitignore',import.meta.url)));
 await fs.writeFile(path.join(root,'source.txt'),'tracked source\n');
 git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','fixture');
 const previous=path.join(root,'apps/metaengine-browser/native-cache/private-tools');
 await fs.mkdir(previous,{recursive:true});await fs.writeFile(path.join(previous,'fixture.zip'),'synthetic archive, never executed');
 assert.match(git('status','--porcelain','--untracked-files=all'),/native-cache\/private-tools\/fixture\.zip/);
 await fs.rm(path.join(root,'apps/metaengine-browser/native-cache'),{recursive:true});
 const archives=path.join(externalBuildWorkDirectory(root,external),'private-tool-archives');
 await fs.mkdir(archives);await fs.writeFile(path.join(archives,'fixture.zip'),'synthetic archive, never executed');
 assert.equal(git('status','--porcelain','--untracked-files=all'),'');
 await fs.writeFile(path.join(root,'unexpected.txt'),'must remain visible');
 assert.match(git('status','--porcelain','--untracked-files=all'),/unexpected\.txt/);
 await fs.writeFile(path.join(root,'source.txt'),'changed source\n');
 assert.match(git('status','--porcelain','--untracked-files=all'),/M source\.txt/);
 const producer=await fs.readFile(new URL('../scripts/stage-client-state-runtime.mjs',import.meta.url),'utf8');
 const hook=await fs.readFile(new URL('../scripts/electron-builder-before-pack.cjs',import.meta.url),'utf8');
 assert.doesNotMatch(producer+hook,/native-cache/);
 assert.match(producer,/const toolArchives = path\.join\(work, 'private-tool-archives'\)/);
 assert(producer.indexOf("await writeFile(path.join(work, 'runtime-build-work.json')")<producer.indexOf('const toolArchives'));
 assert.match(hook,/externalBuildWorkDirectory\(repoRoot, archivePrefix\)/);
 assert.match(hook,/externalBuildWorkDirectory\(repoRoot, fs\.realpathSync\(archiveDirectory\)\)/);
 const crypto=await fs.readFile(new URL('../scripts/build-guardian-openssl-static.ps1',import.meta.url),'utf8');
 assert.match(crypto,/git -C \$repoRoot status --porcelain --untracked-files=all/);
 assert.match(crypto,/guardian_openssl_source_checkout_not_clean/);
});
