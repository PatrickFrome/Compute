import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readDirectoryIdentity} from './native-coding-fs-identity.mjs';

test('native directory identity survives rename and detects physical replacement',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-directory-id-'));
  t.after(async()=>{const actual=await fs.realpath(root);assert.equal(path.dirname(actual),await fs.realpath(os.tmpdir()));await fs.rm(actual,{recursive:true,force:true});});
  const first=path.join(root,'first'),second=path.join(root,'second');await fs.mkdir(first);
  const identity=await readDirectoryIdentity(first);assert.match(identity,/^[a-f0-9]{64}$/);
  assert.equal(await readDirectoryIdentity(first),identity);
  await fs.rename(first,second);assert.equal(await readDirectoryIdentity(second),identity);
  await fs.mkdir(first);assert.notEqual(await readDirectoryIdentity(first),identity);
});

test('directory aliases and relative paths cannot provide a managed root identity',async t=>{
  await assert.rejects(readDirectoryIdentity('relative/path'),/identity_unverified/);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-directory-alias-'));
  t.after(async()=>{const actual=await fs.realpath(root);assert.equal(path.dirname(actual),await fs.realpath(os.tmpdir()));await fs.rm(actual,{recursive:true,force:true});});
  const real=path.join(root,'real'),alias=path.join(root,'alias');await fs.mkdir(real);
  await fs.symlink(real,alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(readDirectoryIdentity(alias),/identity_unverified/);
});
