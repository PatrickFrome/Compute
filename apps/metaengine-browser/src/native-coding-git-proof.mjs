import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=reason=>{throw new Error('native_coding_git_'+reason);};
const inside=(root,target)=>{const relative=path.relative(root,target);return relative!==''&&relative!=='..'
  &&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
async function git(root,args,env,executable) {
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,['--no-pager','-c','core.fsmonitor=false','-c','core.hooksPath=',...args],
      {cwd:root,env,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const chunks=[];let size=0,overflow=false;
    const timer=setTimeout(()=>{overflow=true;child.kill();},10000);
    child.stdout.on('data',bytes=>{size+=bytes.length;if(size>1024*1024){overflow=true;child.kill();}else chunks.push(bytes);});
    child.stderr.on('data',()=>{});
    child.once('error',()=>{clearTimeout(timer);reject(Error('native_coding_git_spawn_failed'));});
    child.once('close',code=>{clearTimeout(timer);code===0&&!overflow?resolve(Buffer.concat(chunks)):reject(Error('native_coding_git_read_failed'));});
  });
}
async function readChangedFile(file) {
  const before=await fs.lstat(file);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>512*1024)fail('changed_file_invalid');
  const handle=await fs.open(file,'r');
  try {
    const opened=await handle.stat();
    if(opened.dev!==before.dev||opened.ino!==before.ino||opened.size!==before.size||opened.mtimeMs!==before.mtimeMs)fail('changed_file_raced');
    const bytes=await handle.readFile(),after=await handle.stat(),named=await fs.lstat(file);
    for(const current of [after,named])if(current.dev!==before.dev||current.ino!==before.ino||current.size!==before.size
      ||current.mtimeMs!==before.mtimeMs||current.nlink!==1||current.isSymbolicLink())fail('changed_file_raced');
    if(bytes.length>512*1024)fail('changed_file_budget');return bytes;
  }finally{await handle.close();}
}

// Same artifact encoding as the native runner: HEAD + changed file hashes +
// binary diff. This read-only helper grants no lease/launch/acceptance rights.
export async function readNativeCodingGitProof(root,{env,gitExecutable='git'}={}) {
  if(!path.isAbsolute(root||'')||typeof gitExecutable!=='string'||!env||typeof env!=='object')fail('private_configuration_required');
  const head=(await git(root,['rev-parse','HEAD'],env,gitExecutable)).toString().trim();
  if(!/^[a-f0-9]{40}$/.test(head))fail('head_invalid');
  const status=await git(root,['status','--porcelain=v1','-z','--untracked-files=all','--no-renames'],env,gitExecutable);
  const rows=status.toString('utf8').split('\0').filter(Boolean);
  if(rows.length>128)fail('changed_file_budget');
  const files=[];let total=0;
  for(const row of rows) {
    const relative=row.slice(3),target=path.resolve(root,relative);
    if(row.length<4||!inside(root,target)||relative.split(/[\\/]/).includes('.git'))fail('path_invalid');
    let bytes=null;
    try {
      if(!inside(root,await fs.realpath(target)))fail('changed_file_escape');
      let current=root;
      for(const part of path.relative(root,target).split(path.sep)){current=path.join(current,part);if((await fs.lstat(current)).isSymbolicLink())fail('changed_file_symlink');}
      bytes=await readChangedFile(target);total+=bytes.length;if(total>4*1024*1024)fail('changed_byte_budget');
    }catch(error){if(error.code!=='ENOENT')throw error;}
    files.push({path:relative.replaceAll('\\','/'),status:row.slice(0,2),sha256:bytes===null?null:hash(bytes),bytes:bytes?.length??0});
  }
  const diff=await git(root,['diff','--no-ext-diff','--no-textconv','--binary','HEAD','--'],env,gitExecutable);
  const afterHead=(await git(root,['rev-parse','HEAD'],env,gitExecutable)).toString().trim();
  const afterStatus=await git(root,['status','--porcelain=v1','-z','--untracked-files=all','--no-renames'],env,gitExecutable);
  if(afterHead!==head||!status.equals(afterStatus))fail('workspace_changed_during_read');
  return {head,status_sha256:hash(status),diff_sha256:hash(diff),changed_files:files,
    artifact_sha256:hash(JSON.stringify({head,files,diff_sha256:hash(diff)})),clean:rows.length===0};
}
