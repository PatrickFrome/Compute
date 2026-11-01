import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const repo=path.resolve(packageRoot,'../..');
const buildRoot=path.join(repo,'.codex-effective-policy-build');
const seed=path.join(buildRoot,'source');
function git(cwd,args){const result=spawnSync('git',['-c','core.hooksPath=','-c','core.fsmonitor=false',...args],{cwd,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout;}
async function fixture(t) {
  await fs.mkdir(buildRoot,{recursive:true,mode:0o700});
  const root=await fs.mkdtemp(path.join(buildRoot,'recipe-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const pkg=path.join(root,'dependencies/codex-effective-policy');
  await fs.mkdir(path.dirname(pkg),{recursive:true});
  await fs.cp(packageRoot,pkg,{recursive:true});
  const source=path.join(root,'.codex-effective-policy-build/source');
  await fs.mkdir(path.dirname(source),{recursive:true});
  git(root,['clone','--quiet','--shared','--no-hardlinks',seed,source]);
  // Only the exact upstream commit is cloned; seed's uncommitted overlay is excluded.
  const api=await import(pathToFileURL(path.join(pkg,'prepare.mjs')).href);
  return{root,pkg,source,api};
}

test('real pinned checkout prepares idempotently, preserves dependency versions, and rejects overlay drift',async t=>{
  const f=await fixture(t);
  const before=await fs.readFile(path.join(f.source,'codex-rs/Cargo.lock'),'utf8');
  assert.equal((await f.api.prepare({sourceDir:f.source})).status,'SOURCE_PREPARED');
  assert.equal((await f.api.prepare({sourceDir:f.source,check:true})).status,'SOURCE_PREPARED');
  assert.equal((await f.api.prepare({sourceDir:f.source})).binary_built,false);
  const after=await fs.readFile(path.join(f.source,'codex-rs/Cargo.lock'),'utf8');
  assert.equal(after,before.replace(/^version = "0\.0\.0"$/gm,'version = "0.159.0-alpha.3"'));
  await fs.appendFile(path.join(f.source,'codex-rs/app-server/src/metaengine_effective_policy.rs'),'\n// drift\n');
  await assert.rejects(f.api.prepare({sourceDir:f.source,check:true}),/overlay_drift/);
  await assert.rejects(f.api.prepare({sourceDir:f.source}),/overlay_drift/);
});

test('real source commit mismatch and unrelated tracked edits are rejected',async t=>{
  const f=await fixture(t);
  git(f.source,['-c','user.name=Disposable Test','-c','user.email=disposable@example.invalid','commit','--allow-empty','-m','wrong upstream identity']);
  await assert.rejects(f.api.prepare({sourceDir:f.source}),/source_pin_mismatch/);
  const pin=JSON.parse(await fs.readFile(path.join(f.pkg,'source-pin.json'),'utf8'));
  git(f.source,['checkout','--detach',pin.commit]);
  await fs.appendFile(path.join(f.source,'README.md'),'\nUnrelated change\n');
  await assert.rejects(f.api.prepare({sourceDir:f.source}),/source_dirty/);
});

test('modified patch input and dependency lock are rejected before build',async t=>{
  const f=await fixture(t);
  const patch=path.join(f.pkg,'upstream.patch');
  const original=await fs.readFile(patch);
  await fs.appendFile(patch,'\n');
  await assert.rejects(f.api.prepare({sourceDir:f.source}),/input_digest_mismatch:upstream.patch/);
  await fs.writeFile(patch,original);
  await fs.appendFile(path.join(f.source,'codex-rs/Cargo.lock'),'\n# drift\n');
  await assert.rejects(f.api.prepare({sourceDir:f.source}),/workspace_lock_drift/);
});
