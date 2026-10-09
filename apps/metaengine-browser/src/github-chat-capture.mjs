import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertPhysicalDirectory } from './github-chat-relay-journal.mjs';

export async function readGithubChatCapture(filename,sha256) {
  if(typeof filename!=='string'||!path.isAbsolute(filename)||!/^[0-9a-f]{64}$/.test(sha256||''))throw new Error('github_chat_capture_unverified');
  const root=await assertPhysicalDirectory(path.join(os.tmpdir(),'metaengine-computer-captures'));
  await assertPhysicalDirectory(path.dirname(filename));
  const actual=await fs.realpath(filename);
  const relative=path.relative(root,actual);
  if(!/^(?:window|capture)-[a-f0-9-]+\.png$/i.test(relative))throw new Error('github_chat_capture_boundary_invalid');
  const before=await fs.lstat(filename);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size<16||before.size>8*1024*1024)throw new Error('github_chat_capture_invalid');
  const bytes=await fs.readFile(filename);
  const after=await fs.lstat(filename);
  if(before.ino!==after.ino||before.mtimeMs!==after.mtimeMs||bytes.length!==before.size
      ||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'
      ||createHash('sha256').update(bytes).digest('hex')!==sha256)throw new Error('github_chat_capture_unverified');
  return bytes;
}
