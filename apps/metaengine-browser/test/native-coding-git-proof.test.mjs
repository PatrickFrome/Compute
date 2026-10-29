import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {readNativeCodingGitProof} from '../src/native-coding-git-proof.mjs';
const execute=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitExecutable=process.env.METAENGINE_GIT_TEST_EXECUTABLE||(process.platform==='win32'?'C:/Program Files/Git/bin/git.exe':'git');
async function fixture(t) {
  const temporary=await fs.realpath(os.tmpdir()),root=await fs.mkdtemp(path.join(temporary,'native-coding-git-proof-'));
  t.after(async()=>{
    const actual=await fs.realpath(root),relative=path.relative(temporary,actual);
    assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(actual).startsWith('native-coding-git-proof-'));
    await fs.rm(actual,{recursive:true,force:false});
  });
  const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0'};
  const git=args=>execute(gitExecutable,['-c','core.fsmonitor=false','-c','core.hooksPath=','-C',root,...args],{env,windowsHide:true,timeout:30000,maxBuffer:1024*1024});
  await git(['init','--quiet']);await git(['config','user.name','Generated fixture']);await git(['config','user.email','fixture@example.invalid']);
  await fs.writeFile(path.join(root,'fixture.txt'),'first\n');await git(['add','--','fixture.txt']);await git(['commit','--quiet','-m','Generated fixture']);
  return {root,git,env,read:()=>readNativeCodingGitProof(root,{env,gitExecutable})};
}
test('physical Git proof binds exact changed bytes, untracked files, diff and HEAD with runner-compatible encoding',async t=>{
  const f=await fixture(t),before=await f.read();assert.equal(before.clean,true);assert.equal(before.changed_files.length,0);
  await fs.writeFile(path.join(f.root,'fixture.txt'),'changed\n');await fs.writeFile(path.join(f.root,'new.txt'),'new bytes');
  const changed=await f.read();assert.equal(changed.head,before.head);assert.equal(changed.clean,false);
  assert.equal(changed.changed_files.find(file=>file.path==='fixture.txt').sha256,hash('changed\n'));
  assert.equal(changed.changed_files.find(file=>file.path==='new.txt').sha256,hash('new bytes'));
  assert.equal(changed.artifact_sha256,hash(JSON.stringify({head:changed.head,files:changed.changed_files,diff_sha256:changed.diff_sha256})));
  assert.notEqual(changed.artifact_sha256,before.artifact_sha256);assert.deepEqual(await f.read(),changed);
  await f.git(['add','--','fixture.txt','new.txt']);await f.git(['commit','--quiet','-m','Generated change']);
  const committed=await f.read();assert.equal(committed.clean,true);assert.notEqual(committed.head,changed.head);assert.notEqual(committed.artifact_sha256,changed.artifact_sha256);
});
test('physical Git proof rejects a changed file linked to another path and oversized content',async t=>{
  const f=await fixture(t),original=path.join(f.root,'fixture.txt'),linked=path.join(f.root,'linked.txt');
  await fs.link(original,linked);await assert.rejects(f.read(),/changed_file_invalid/);await fs.unlink(linked);
  await fs.writeFile(original,Buffer.alloc(512*1024+1,65));await assert.rejects(f.read(),/changed_file_invalid/);
});

test('cancelled Git proof launches no new read and an in-flight Git child is joined before rejection',async t=>{
 const f=await fixture(t),before=await f.read();
 const cancelled=new AbortController();cancelled.abort();
 await assert.rejects(readNativeCodingGitProof(f.root,{env:f.env,gitExecutable:'nonexistent-must-not-launch',signal:cancelled.signal}),/git_cancelled/);
 const active=new AbortController();const pending=readNativeCodingGitProof(f.root,{env:f.env,gitExecutable,signal:active.signal});active.abort();
 await assert.rejects(pending,/git_cancelled/);
 const after=await f.read();assert.deepEqual(after,before);
});
