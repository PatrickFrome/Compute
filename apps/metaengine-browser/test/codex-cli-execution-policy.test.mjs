import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {captureCodexCliPhysicalScope,codexCliInvocationFingerprint,codexCliPermissionOverrides} from '../src/codex-cli-execution-policy.mjs';

async function fixture(t) {
  const parent=await fs.realpath(os.tmpdir());
  const directory=await fs.mkdtemp(path.join(parent,'codex-policy-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const cliPath=path.join(directory,'cli.exe'),codexHome=path.join(directory,'home'),scratchRoot=path.join(directory,'scratch'),workspaceRoot=path.join(directory,'work');
  for(const target of [codexHome,scratchRoot,workspaceRoot])await fs.mkdir(target);
  await fs.writeFile(cliPath,'test-only-cli');
  const calls=[];
  const options={cliPath,codexHome,scratchRoot,workspaceRoot,mode:'workspace-write',environment:{},
    verifyStorage:async(target,options)=>{calls.push({target,options});return {owner_dacl_verified:true};}};
  return {directory,options,calls,read:extra=>captureCodexCliPhysicalScope({...options,...extra})};
}

test('scope hashes physical choices and known local config but never labels it effective policy',async t=>{
  const f=await fixture(t),first=await f.read(),second=await f.read();
  assert.deepEqual(first,second);
  assert.equal(first.schema,'metaengine.codex-cli.execution-scope.v2');
  assert.equal(first.configuration_attestation,'UNAVAILABLE');
  assert.equal(first.local_configuration.exhaustive,false);
  assert.equal(first.authority_effect,false);
  assert.equal(first.configuration_semantics.equivalent,false);
  for(const object of [first.home,first.scratch,first.workspace,first.cli])assert.match(object.identity_sha256,/^[a-f0-9]{64}$/);
  assert.match(first.cli.sha256,/^[a-f0-9]{64}$/);
  assert.equal(f.calls.length,4);assert(f.calls.every(call=>call.options.operation==='VERIFY_DIRECTORY'));
  assert.equal(JSON.stringify(first).includes('test-only-cli'),false);
});

test('replacing a same-named root is distinguishable even with unchanged contents',async t=>{
  for(const [argument,field] of [['codexHome','home'],['scratchRoot','scratch'],['workspaceRoot','workspace']]){
    const f=await fixture(t),before=await f.read(),target=f.options[argument];
    await fs.rename(target,target+'-retired');await fs.mkdir(target);
    const after=await f.read();assert.equal(after[field].path,before[field].path);
    assert.notEqual(after[field].identity_sha256,before[field].identity_sha256);
  }
});

test('new and changed configuration bytes invalidate scope without changing directory identity',async t=>{
  const f=await fixture(t),before=await f.read(),file=path.join(f.options.codexHome,'config.toml');
  await fs.writeFile(file,'model="first"\n');const added=await f.read();
  assert.equal(before.home.identity_sha256,added.home.identity_sha256);
  assert.notEqual(before.local_configuration.sha256,added.local_configuration.sha256);
  await fs.writeFile(file,'model="other"\n');const changed=await f.read();
  assert.notEqual(added.local_configuration.sha256,changed.local_configuration.sha256);
  assert.equal(JSON.stringify(changed).includes('model='),false);
  await fs.mkdir(path.join(f.options.workspaceRoot,'.codex'));
  await fs.writeFile(path.join(f.options.workspaceRoot,'.codex','config.toml'),'sandbox_mode="read-only"\n');
  assert.notEqual(changed.local_configuration.sha256,(await f.read()).local_configuration.sha256);
});

test('CLI bytes and same-byte file replacement invalidate scope',async t=>{
  const f=await fixture(t),before=await f.read();await fs.writeFile(f.options.cliPath,'different-cli');
  const mutated=await f.read();assert.notEqual(before.cli.sha256,mutated.cli.sha256);
  await fs.rename(f.options.cliPath,f.options.cliPath+'.old');await fs.writeFile(f.options.cliPath,'different-cli');
  const replaced=await f.read();assert.equal(mutated.cli.sha256,replaced.cli.sha256);
  assert.notEqual(mutated.cli.identity_sha256,replaced.cli.identity_sha256);
});

test('broadened ACL, alias and hardlink targets fail physical capture',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.read({verifyStorage:async()=>({owner_dacl_verified:false})}),/storage_unverified/);
  const linked=path.join(f.directory,'linked-cli');await fs.link(f.options.cliPath,linked);
  await assert.rejects(f.read(),/file_unverified/);await fs.unlink(linked);
  if(process.platform!=='win32'){
    const alias=path.join(f.directory,'alias');await fs.symlink(f.options.codexHome,alias);
    await assert.rejects(f.read({codexHome:alias}),/identity_unverified|path_unverified/);
  }
});

test('cancelled capture cannot start ACL readers or report late success',async t=>{
  const f=await fixture(t),controller=new AbortController();controller.abort();
  await assert.rejects(f.read({signal:controller.signal}),/request_cancelled/);assert.equal(f.calls.length,0);
  const other=new AbortController();
  await assert.rejects(f.read({signal:other.signal,verifyStorage:async()=>{other.abort();return {owner_dacl_verified:true};}}),/request_cancelled/);
});

test('inert preparation can pin a missing scratch root without creating it',async t=>{
  const f=await fixture(t);await fs.rmdir(f.options.scratchRoot);
  await assert.rejects(f.read(),{code:'ENOENT'});
  const first=await f.read({allowMissingScratchRoot:true});
  assert.equal(first.scratch.exists,false);assert.equal(first.scratch.parent_path,f.directory);
  assert.match(first.scratch.parent_identity_sha256,/^[a-f0-9]{64}$/);
  await assert.rejects(fs.stat(f.options.scratchRoot),{code:'ENOENT'});
  await fs.mkdir(f.options.scratchRoot);
  const second=await f.read();assert.equal(second.scratch.exists,true);
  assert.deepEqual(second.home,first.home);assert.deepEqual(second.workspace,first.workspace);
  assert.equal(second.local_configuration.sha256,first.local_configuration.sha256);
});

test('a configuration mutation during native ACL read is reflected in the captured source generation',async t=>{
  const f=await fixture(t),file=path.join(f.options.codexHome,'config.toml');await fs.writeFile(file,'model="before"\n');
  const before=await f.read();let changed=false;
  const after=await f.read({verifyStorage:async()=>{
    if(!changed){changed=true;await fs.writeFile(file,'model="after"\n');}
    return {owner_dacl_verified:true};
  }});
  assert.notEqual(after.local_configuration.sha256,before.local_configuration.sha256);
});

test('invocation digest binds actual argv, cwd and canonical Windows environment without exposing values',()=>{
  const cwd=path.resolve('fixture'),args=['exec','--ignore-user-config'];
  const initial=codexCliInvocationFingerprint({args,cwd,env:{Path:'safe',CODEX_HOME:cwd,TEMP:cwd}});
  assert.equal(initial,codexCliInvocationFingerprint({args,cwd,env:{TEMP:cwd,PATH:'safe',CODEX_HOME:cwd}}));
  assert.notEqual(initial,codexCliInvocationFingerprint({args:['sandbox','--include-managed-config'],cwd,env:{PATH:'safe',CODEX_HOME:cwd,TEMP:cwd}}));
  assert.notEqual(initial,codexCliInvocationFingerprint({args,cwd,env:{PATH:'safe',CODEX_HOME:cwd,TEMP:cwd+'-changed'}}));
  assert.throws(()=>codexCliInvocationFingerprint({args,cwd,env:{PATH:'one',Path:'two'}}),/environment_case_collision/);
});

test('common explicit permission overrides are bounded and role-specific',()=>{
  for(const mode of ['read-only','workspace-write']){
    const args=codexCliPermissionOverrides(mode);
    assert(args.includes(`sandbox_mode="${mode}"`));assert(args.includes('sandbox_workspace_write.writable_roots=[]'));
    assert(args.includes('sandbox_workspace_write.network_access=false'));
    assert(!args.some(value=>/ignore|dangerously|include-managed/.test(value)));
  }
  assert.throws(()=>codexCliPermissionOverrides('danger-full-access'),/mode_invalid/);
});
