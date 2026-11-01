import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const repository=path.resolve(here,'../..');
const buildRoot=path.join(repository,'.codex-effective-policy-build');
const fail=message=>{throw new Error(`codex_effective_policy_${message}`);};
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function git(cwd,args,{allowFailure=false}={}) {
  const result=spawnSync('git',['-c','core.hooksPath=','-c','core.fsmonitor=false',...args],{
    cwd,encoding:'utf8',shell:false,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0'},maxBuffer:4*1024*1024,
  });
  if(result.error)throw result.error;
  if(result.status!==0&&!allowFailure)fail(`git_failed:${args[0]}:${result.stderr.slice(0,1500)}`);
  return result;
}

export async function prepare({sourceDir=path.join(buildRoot,'source'),check=false}={}) {
  const manifest=JSON.parse(await fs.readFile(path.join(here,'source-pin.json'),'utf8'));
  const files=new Map();
  for(const [relative,expected]of Object.entries(manifest.inputs)) {
    if(!/^[a-f0-9]{64}$/.test(expected)||relative.includes('..')||path.isAbsolute(relative))fail('manifest_invalid');
    const bytes=await fs.readFile(path.join(here,relative));
    if(sha256(bytes)!==expected)fail(`input_digest_mismatch:${relative}`);
    files.set(relative,bytes);
  }
  const source=path.resolve(sourceDir);
  const relative=path.relative(buildRoot,source);
  if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))fail('source_outside_build_root');
  await fs.mkdir(buildRoot,{recursive:true,mode:0o700});
  const exists=await fs.lstat(source).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(!exists) {
    if(check)fail('source_missing');
    await fs.mkdir(source,{recursive:true,mode:0o700});
    git(source,['init','--quiet']);
    git(source,['fetch','--depth=1',manifest.repository,manifest.commit]);
    git(source,['checkout','--detach','--quiet','FETCH_HEAD']);
  }
  if((await fs.lstat(source)).isSymbolicLink()||await fs.realpath(source)!==source)fail('source_path_invalid');
  const identities=git(source,['rev-parse','HEAD','HEAD^{tree}']).stdout.trim().split(/\r?\n/);
  if(identities[0]!==manifest.commit||identities[1]!==manifest.tree)fail('source_pin_mismatch');
  const lockPath=path.join(source,'codex-rs/Cargo.lock');
  const lockBytes=await fs.readFile(lockPath);
  const lockHash=sha256(lockBytes);
  const lock=manifest.workspace_lock;
  if(lockHash===lock.original_sha256) {
    if(check)fail('workspace_lock_not_normalized');
    const original=lockBytes.toString('utf8');
    const pattern=/^version = "0\.0\.0"$/gm;
    if([...original.matchAll(pattern)].length!==lock.workspace_package_count)fail('workspace_lock_count_mismatch');
    const normalized=Buffer.from(original.replace(pattern,`version = "${lock.workspace_version}"`));
    if(sha256(normalized)!==lock.normalized_sha256)fail('workspace_lock_normalization_mismatch');
    await fs.writeFile(lockPath,normalized);
  } else if(lockHash!==lock.normalized_sha256)fail('workspace_lock_drift');
  const sourceDiff=()=>git(source,['diff','--binary','--','.',':(exclude)codex-rs/Cargo.lock']).stdout;
  const patch=path.join(here,'upstream.patch');
  const untracked=git(source,['ls-files','--others','--exclude-standard']).stdout.trim().split(/\r?\n/).filter(Boolean);
  const overlays=Object.keys(manifest.overlays);
  if(untracked.some(name=>!overlays.includes(name)))fail('unexpected_source_files');
  const forward=git(source,['apply','--check',patch],{allowFailure:true});
  if(forward.status===0) {
    if(check)fail('patch_not_applied');
    if(sourceDiff()!=='')fail('source_dirty');
    git(source,['apply',patch]);
  } else if(git(source,['apply','--reverse','--check',patch],{allowFailure:true}).status!==0)fail('patch_drift');
  // Exact diff also rejects unrelated edits in a previously prepared checkout.
  if(sha256(Buffer.from(sourceDiff()))!==manifest.inputs['upstream.patch'])fail('patched_source_drift');
  for(const [target,input]of Object.entries(manifest.overlays)) {
    if(!files.has(input)||target.includes('..')||path.isAbsolute(target))fail('overlay_invalid');
    const file=path.join(source,target);
    const existing=await fs.readFile(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(check) {
      if(!existing||!existing.equals(files.get(input)))fail(`overlay_drift:${target}`);
    } else if(existing&&!existing.equals(files.get(input))) {
      fail(`overlay_drift:${target}`);
    } else if(!existing) {
      await fs.writeFile(file,files.get(input),{mode:0o600});
    }
  }
  return {status:'SOURCE_PREPARED',source_dir:source,upstream_commit:manifest.commit,upstream_tree:manifest.tree,
    inputs_sha256:sha256(Buffer.from(JSON.stringify(manifest.inputs))),binary_built:false,windows_qualified:false};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);let sourceDir,check=false;
  while(args.length){const flag=args.shift();if(flag==='--check')check=true;else if(flag==='--source-dir')sourceDir=args.shift();else fail('argument_invalid');}
  try{console.log(JSON.stringify(await prepare({sourceDir,check})));}catch(error){console.error(error.message);process.exitCode=1;}
}
