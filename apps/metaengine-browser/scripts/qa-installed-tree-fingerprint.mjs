#!/usr/bin/env node
// Source-trusted, read-only SHA256 inventory of an *entire* installed QA
// application directory. This is a fence, not a backup or reinstall mechanism.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const INSTALLED_TREE_SCHEMA='metaengine.browser.qa-installed-tree-fingerprint.v1';
const MAX_FILES=25000, MAX_BYTES=12*1024**3, MAX_DEPTH=40;
const fail=code=>{throw new Error('qa_tree_'+code);};
const validRelative=name=> typeof name==='string'&&name.length>0&&name!=='.'&&name!=='..'
  &&!/[\\/:\0]/.test(name)&&!name.endsWith('.')&&!name.endsWith(' ');
const sameInfo=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size
  &&a.mtimeMs===b.mtimeMs&&a.birthtimeMs===b.birthtimeMs
  &&a.nlink===b.nlink;
async function stableFileHash(file,before) {
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file,{highWaterMark:256*1024}))hash.update(chunk);
  const after=await fs.lstat(file);
  if(!after.isFile()||after.isSymbolicLink()||after.nlink!==1||!sameInfo(before,after))
    fail('file_changed_during_capture');
  return hash.digest('hex');
}
export async function captureInstalledTreeFingerprint(root) {
  if(typeof root!=='string'||!path.isAbsolute(root)||root.startsWith('\\\\'))fail('absolute_local_root_required');
  const base=path.resolve(root), baseStat=await fs.lstat(base);
  if(!baseStat.isDirectory()||baseStat.isSymbolicLink())fail('root_not_physical_directory');
  const real=await fs.realpath(base);
  if(real.toLowerCase()!==base.toLowerCase())fail('root_alias_or_reparse');
  const rows=[], folded=new Set();
  let totalBytes=0;
  async function visit(dir,relative,depth) {
    if(depth>MAX_DEPTH)fail('tree_depth_limit');
    const info=await fs.lstat(dir);
    if(!info.isDirectory()||info.isSymbolicLink())fail('reparse_directory_forbidden');
    const entries=await fs.readdir(dir,{withFileTypes:true});
    entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
    for(const entry of entries) {
      if(!validRelative(entry.name))fail('invalid_filename');
      const rel=relative?relative+'/'+entry.name:entry.name;
      const key=rel.toLowerCase();
      if(folded.has(key))fail('casefold_alias_collision');
      folded.add(key);
      const absolute=path.join(dir,entry.name);
      const stat=await fs.lstat(absolute);
      if(stat.isSymbolicLink())fail('reparse_path_forbidden');
      if(stat.isDirectory()) {
        rows.push([rel,'DIRECTORY']);
        await visit(absolute,rel,depth+1);
        continue;
      }
      if(!stat.isFile()||stat.nlink!==1)fail('nonregular_or_hardlinked_file');
      if(++totalFiles>MAX_FILES)fail('file_count_limit');
      if(stat.size<0||!Number.isSafeInteger(stat.size))fail('file_size_invalid');
      totalBytes+=stat.size;
      if(!Number.isSafeInteger(totalBytes)||totalBytes>MAX_BYTES)fail('total_bytes_limit');
      const digest=await stableFileHash(absolute,stat);
      rows.push([rel,stat.size,digest]);
    }
    const after=await fs.lstat(dir);
    if(!after.isDirectory()||after.isSymbolicLink()||!sameInfo(info,after))
      fail('directory_changed_during_capture');
  }
  let totalFiles=0;
  await visit(base,'',0);
  if(!totalFiles)fail('empty_installed_tree');
  // Canonical sorting avoids platform/readdir enumeration order drift.
  rows.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
  const sha=createHash('sha256').update(JSON.stringify({schema:INSTALLED_TREE_SCHEMA,files:rows})).digest('hex');
  return Object.freeze({schema:INSTALLED_TREE_SCHEMA,tree_sha256:sha,file_count:totalFiles,total_bytes:totalBytes});
}
