import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { probeW64GeneratedDevelopmentWorker } from './client-serial-loop-development-worker-w64.mjs';

test('W64 existing DevelopmentPlane worker reads real disposable Git head, has no execution authority', {
  timeout:45_000,
}, async () => {
  const tmp=await realpath(os.tmpdir());
  const root=await mkdtemp(path.join(tmp,'metaengine-w56-own-pg17-'));
  const dir=path.join(root,'unique-git');
  const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
  try {
    await mkdir(dir);
    git('init','-q');
    await writeFile(path.join(dir,'calc.mjs'),'export const sum=(a,b)=>a+b;\n');
    git('add','--','calc.mjs');
    git('-c','user.name=W64 Fixture','-c','user.email=w64@example.invalid',
      'commit','-qm','generated worker test');
    const head=git('rev-parse','HEAD');
    const first=await probeW64GeneratedDevelopmentWorker(dir);
    assert.equal(first.head,head);
    assert.equal(first.origin,'SYNTHETIC/STAGING');
    assert.equal(first.edit_authority,false);
    assert.equal(first.authority_effect,false);
    assert.equal(git('status','--porcelain'),'');
    assert.equal((await probeW64GeneratedDevelopmentWorker(dir)).head,head);
    await assert.rejects(probeW64GeneratedDevelopmentWorker(root),/worker may only read|ENOENT/);
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});
