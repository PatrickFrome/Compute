import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash,randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { GithubChatRelayJournal,readPrivateRelayFile } from '../src/github-chat-relay-journal.mjs';
import { readGithubChatCapture } from '../src/github-chat-capture.mjs';

test('credential reader refuses symlinks, hardlinks and publicly readable files',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'github-chat-files-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const original=path.join(root,'token.bin');await fs.writeFile(original,'test-encrypted',{mode:0o600});
  assert.equal((await readPrivateRelayFile(original)).toString(),'test-encrypted');
  const alias=path.join(root,'alias.bin');
  if(process.platform!=='win32'){
    await fs.symlink(original,alias);
    await assert.rejects(readPrivateRelayFile(alias),/journal_unverified/);
    await fs.unlink(alias);
  }else{
    const junction=path.join(root,'junction');await fs.symlink(root,junction,'junction');
    await assert.rejects(readPrivateRelayFile(path.join(junction,'token.bin')),/journal_unverified/);
    await fs.unlink(junction);
  }
  await fs.link(original,alias);
  await assert.rejects(readPrivateRelayFile(original),/journal_unverified/);
  await fs.unlink(alias);
  if(process.platform!=='win32'){
    await fs.chmod(original,0o644);await assert.rejects(readPrivateRelayFile(original),/journal_unverified/);
  }
});

test('exclusive delivery claim survives process reconstruction and rejects changed body',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'github-chat-journal-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const directory=path.join(root,'journal'),id=randomUUID(),digest='a'.repeat(64);
  const first=await new GithubChatRelayJournal(directory).initialize();
  const claims=await Promise.allSettled([first.claim(id,digest),first.claim(id,digest)]);
  // The competing reader may see an incomplete claim while its writer flushes;
  // it must fail closed, never become another winner.
  assert.equal(claims.filter(c=>c.status==='fulfilled'&&c.value.claimed).length,1);
  const next=await new GithubChatRelayJournal(directory).initialize();
  assert.deepEqual(await next.claim(id,digest),{claimed:false,outcome:null});
  await assert.rejects(next.claim(id,'b'.repeat(64)),/journal_unverified/);
  await next.complete(id,digest,{state:'ACCEPTED'});
  assert.deepEqual((await first.claim(id,digest)).outcome,{state:'ACCEPTED'});
  await first.revoke(id);assert.equal(await next.revoked(id),true);
});

test('capture export verifies actual bytes and cannot leave the executor-owned image directory',async t=>{
  const root=path.join(os.tmpdir(),'metaengine-computer-captures');await fs.mkdir(root,{recursive:true});
  const filename=path.join(root,'capture-'+randomUUID()+'.png');
  const bytes=Buffer.from('89504e470d0a1a0a0000000049454e44','hex');
  await fs.writeFile(filename,bytes);t.after(()=>fs.unlink(filename));
  const hash=createHash('sha256').update(bytes).digest('hex');
  assert.deepEqual(await readGithubChatCapture(filename,hash),bytes);
  await assert.rejects(readGithubChatCapture(filename,'a'.repeat(64)),/capture_unverified/);
  const outside=path.join(os.tmpdir(),'capture-'+randomUUID()+'.png');
  await fs.writeFile(outside,bytes);t.after(()=>fs.unlink(outside));
  await assert.rejects(readGithubChatCapture(outside,hash),/capture_boundary_invalid/);
  const alias=path.join(root,'window-'+randomUUID()+'.png');await fs.link(filename,alias);t.after(()=>fs.unlink(alias));
  await assert.rejects(readGithubChatCapture(alias,hash),/capture_invalid/);
});
