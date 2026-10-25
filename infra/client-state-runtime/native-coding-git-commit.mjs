import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readDirectoryIdentity} from './native-coding-fs-identity.mjs';
import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as digest} from './native-coding-task-context.mjs';
import {readNativeCodingGitProof} from '../../apps/metaengine-browser/src/native-coding-git-proof.mjs';
import {protectOwnerOnlyWindowsDirectory,verifyOwnerOnlyWindowsStorage} from '../../apps/metaengine-browser/src/private-windows-storage-acl.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{40}$/,HASH=/^[0-9a-f]{64}$/;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=reason=>{throw Error('native_coding_git_commit_'+reason);};
const same=(a,b)=>json(a)===json(b);
const samePath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
const inside=(root,target)=>{const relative=path.relative(root,target);return !!relative&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const overlap=(a,b)=>samePath(a,b)||inside(a,b)||inside(b,a);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join('\0')===[...keys].sort().join('\0');
const selectors=['project_id','checkpoint_id','checkpoint_sha256'];
function select(value){
  if(!exact(value,selectors)||!UUID.test(value.project_id)||!UUID.test(value.checkpoint_id)||!HASH.test(value.checkpoint_sha256))fail('selectors_invalid');
  return structuredClone(value);
}
async function regular(file,limit=16*1024*1024,{allowHardlinks=false}={}){
  const before=await fs.lstat(file);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink<1||!allowHardlinks&&before.nlink!==1||before.size>limit||!samePath(await fs.realpath(file),file))fail('private_file_unverified');
  const handle=await fs.open(file,'r');
  try{
    const opened=await handle.stat(),bytes=await handle.readFile(),after=await handle.stat(),named=await fs.lstat(file);
    for(const item of [opened,after,named])if(item.dev!==before.dev||item.ino!==before.ino||item.size!==before.size||item.mtimeMs!==before.mtimeMs||item.nlink!==before.nlink||item.isSymbolicLink())fail('private_file_changed');
    return {bytes,identity:{dev:String(before.dev),ino:String(before.ino),birthtime:before.birthtimeMs},sha256:hash(bytes)};
  }finally{await handle.close();}
}
const maybeRead=async file=>{try{return JSON.parse((await regular(file,512*1024)).bytes);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
async function durable(file,value){
  const handle=await fs.open(file,'wx',0o600);
  try{await handle.writeFile(json(value)+'\n');await handle.sync();}finally{await handle.close();}
}
function relativeFile(value){
  if(typeof value!=='string'||!value||value.length>1024||/[\x00-\x1f\\<>:"|?*]/.test(value)||path.isAbsolute(value)
    ||value.split('/').some(part=>!part||part==='.'||part==='..'||part.toLowerCase()==='.git'||/[. ]$/.test(part)
      ||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))fail('reviewed_path_invalid');
  return value;
}
function checkpointContext(value,query){
  if(!exact(value,['schema','state','checkpoint','checkpoint_sha256','reviewed_git','managed_worktree'])
    ||value.schema!=='metaengine.native-coding.git-commit-context.v1'||value.state!=='CHECKPOINTED_PENDING_COMMIT')fail('protected_checkpoint_unavailable');
  const c=value.checkpoint,g=value.reviewed_git,m=value.managed_worktree;
  if(!c||c.schema!=='metaengine.native-coding.checkpoint.v1'||c.trust_namespace!=='LOCAL_OPERATOR_QA'
    ||c.project_id!==query.project_id||c.checkpoint_id!==query.checkpoint_id||digest(c)!==query.checkpoint_sha256
    ||value.checkpoint_sha256!==query.checkpoint_sha256||c.production_qualified!==false||c.authority_effect!==false
    ||c.automatic_retry_allowed!==false||c.successor_admitted!==false||!UUID.test(c.workspace_id||'')
    ||!SHA.test(c.source_head||'')||!HASH.test(c.root_identity_sha256||'')||!HASH.test(c.git_artifact_sha256||'')
    ||!Number.isFinite(Date.parse(c.verified_at))||new Date(c.verified_at).toISOString()!==c.verified_at)fail('checkpoint_binding_invalid');
  if(!exact(m,['path','root_identity_sha256','branch_ref','git_dir_identity_sha256','common_dir_identity_sha256'])
    ||!path.isAbsolute(m.path||'')||c.worktree?.path!==m.path||c.worktree.root_identity_sha256!==c.root_identity_sha256
    ||m.root_identity_sha256!==c.root_identity_sha256||c.worktree.base_sha!==c.source_head
    ||![m.git_dir_identity_sha256,m.common_dir_identity_sha256].every(x=>HASH.test(x||''))
    ||!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]{0,160}$/.test(m.branch_ref||''))fail('managed_binding_invalid');
  if(!exact(g,['head','status_sha256','diff_sha256','changed_files','artifact_sha256','clean'])||g.head!==c.source_head
    ||g.artifact_sha256!==c.git_artifact_sha256||![g.status_sha256,g.diff_sha256,g.artifact_sha256].every(x=>HASH.test(x||''))
    ||g.clean!==false||!Array.isArray(g.changed_files)||g.changed_files.length<1||g.changed_files.length>128)fail('reviewed_proof_invalid');
  const seen=new Set();let bytes=0;
  for(const file of g.changed_files){
    if(!exact(file,['path','status','sha256','bytes'])||typeof file.status!=='string'||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>512*1024
      ||file.sha256!==null&&!HASH.test(file.sha256)||file.sha256===null&&(file.bytes!==0||!file.status.includes('D'))
      ||!(/^[ MAD]{2}$/.test(file.status)||file.status==='??'))fail('reviewed_file_invalid');
    const name=relativeFile(file.path),key=process.platform==='win32'?name.toLowerCase():name;
    if(seen.has(key))fail('reviewed_path_collision');seen.add(key);bytes+=file.bytes;
  }
  // PostgreSQL jsonb changes object-key order. Rehydrate the original proof's
  // field order before checking its historical JSON.stringify hash; do not
  // replace that established hash encoding with canonical JSON.
  const proofFiles=g.changed_files.map(file=>({path:file.path,status:file.status,sha256:file.sha256,bytes:file.bytes}));
  if(hash(JSON.stringify({head:g.head,files:proofFiles,diff_sha256:g.diff_sha256}))!==g.artifact_sha256)fail('reviewed_proof_invalid');
  if(bytes>4*1024*1024)fail('reviewed_byte_budget');return structuredClone(value);
}

// Private Host capability. The only request fields are protected checkpoint
// selectors. No model command, repository path, author, message or Git argument
// enters this interface. It neither allocates worktrees nor pushes remotes.
export function createNativeCodingGitCommitter({gitExecutable,expectedGitExecutableSha256,journalRoot,readCheckpoint,
  protectStorage=protectOwnerOnlyWindowsDirectory,verifyStorage=verifyOwnerOnlyWindowsStorage}={}){
  if(!path.isAbsolute(gitExecutable||'')||!HASH.test(expectedGitExecutableSha256||'')||!path.isAbsolute(journalRoot||'')
    ||![readCheckpoint,protectStorage,verifyStorage].every(fn=>typeof fn==='function'))fail('private_dependencies_required');
  let closed=false;const open=()=>{if(closed)fail('closed');};
  const baseEnv=()=>({SystemRoot:process.env.SystemRoot||process.env.SYSTEMROOT,PATH:path.dirname(gitExecutable),
    TEMP:journalRoot,TMP:journalRoot,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',
    GIT_ATTR_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',GIT_NO_REPLACE_OBJECTS:'1',
    GIT_NO_LAZY_FETCH:'1',GIT_ALLOW_PROTOCOL:'',LC_ALL:'C'});
  async function setup(query){
    // Official Git for Windows installs hardlinked entry points. Only this
    // Host-pinned executable permits them; worker/journal files never do.
    open();if((await regular(gitExecutable,512*1024*1024,{allowHardlinks:true})).sha256!==expectedGitExecutableSha256)fail('git_executable_changed');
    const context=checkpointContext(await readCheckpoint(query),query),root=context.managed_worktree.path;
    if(overlap(root,journalRoot))fail('journal_overlaps_workspace');
    await fs.mkdir(journalRoot,{recursive:true,mode:0o700});await protectStorage(journalRoot);
    await verifyStorage(journalRoot,{operation:'VERIFY_DIRECTORY'});await readDirectoryIdentity(journalRoot);
    const directory=path.join(journalRoot,query.checkpoint_sha256),hooks=path.join(journalRoot,'empty-hooks');
    await fs.mkdir(hooks,{recursive:true,mode:0o700});await readDirectoryIdentity(hooks);
    if((await fs.readdir(hooks)).length)fail('hooks_directory_not_empty');
    const env=baseEnv();
    const command=async(args,{input=null,allowed=[0],index=null}={})=>{
      open();return new Promise((resolve,reject)=>{
        const child=spawn(gitExecutable,['--no-pager','-c','core.fsmonitor=false','-c','core.untrackedCache=false',
          '-c','core.hooksPath='+hooks,'-c','core.splitIndex=false','-c','core.sparseCheckout=false',
          '-c','diff.external=','-c','commit.gpgSign=false',...args],{cwd:root,env:{...env,...(index?{GIT_INDEX_FILE:index}:{})},
          windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
        const chunks=[];let length=0,expired=false;
        const timer=setTimeout(()=>{expired=true;child.kill();},30000);
        child.stdout.on('data',bytes=>{length+=bytes.length;if(length>4*1024*1024){expired=true;child.kill();}else chunks.push(bytes);});
        child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
        child.once('error',()=>{clearTimeout(timer);reject(Error('native_coding_git_commit_spawn_failed'));});
        child.once('close',code=>{clearTimeout(timer);allowed.includes(code)&&!expired?resolve({bytes:Buffer.concat(chunks),code}):reject(Object.assign(Error('native_coding_git_commit_git_unconfirmed'),{operation:args[0],exitCode:code}));});
        child.stdin.end(input);
      });
    };
    const git=async(args,options)=>(await command(args,options)).bytes;
    // Config inspection executes no filters. Override every configured driver
    // before status/diff can inspect any worker-controlled attributes.
    const filterConfig=(await git(['config','--null','--get-regexp','^filter\\..*\\.(clean|smudge|process|required)$'],{allowed:[0,1]})).toString();
    const drivers=new Set();for(const row of filterConfig.split('\0').filter(Boolean)){
      const match=/^filter\.(.+)\.(?:clean|smudge|process|required)\n/.exec(row);
      if(!match||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(match[1]))fail('filter_config_unsupported');drivers.add(match[1]);
    }
    if(drivers.size>32)fail('filter_config_budget');const overrides=[];
    for(const driver of drivers)for(const field of ['clean','smudge','process','required'])overrides.push(['filter.'+driver+'.'+field,field==='required'?'false':'']);
    env.GIT_CONFIG_COUNT=String(overrides.length);
    overrides.forEach(([key,value],i)=>{env['GIT_CONFIG_KEY_'+i]=key;env['GIT_CONFIG_VALUE_'+i]=value;});
    const proof=index=>readNativeCodingGitProof(root,{env:{...env,...(index?{GIT_INDEX_FILE:index}:{})},gitExecutable});
    async function identity(){
      open();const m=context.managed_worktree;
      if(await readDirectoryIdentity(root)!==m.root_identity_sha256)fail('root_identity_changed');
      await regular(path.join(root,'.git'),8192);
      if(!samePath((await git(['rev-parse','--show-toplevel'])).toString().trim(),root))fail('managed_root_changed');
      const gitDir=path.resolve((await git(['rev-parse','--absolute-git-dir'])).toString().trim());
      const commonDir=path.resolve(root,(await git(['rev-parse','--git-common-dir'])).toString().trim());
      if(overlap(root,gitDir)||overlap(root,commonDir)||!inside(path.join(commonDir,'worktrees'),gitDir)
        ||await readDirectoryIdentity(gitDir)!==m.git_dir_identity_sha256||await readDirectoryIdentity(commonDir)!==m.common_dir_identity_sha256)fail('git_directory_changed');
      try{await regular(path.join(gitDir,'locked'),8192);}catch{fail('managed_lock_unverified');}
      const branch=(await git(['symbolic-ref','--quiet','HEAD'])).toString().trim();
      if(branch!==m.branch_ref)fail('branch_changed');await git(['check-ref-format',branch]);
      const entries=(await git(['worktree','list','--porcelain','-z'])).toString().split('\0\0').filter(Boolean)
        .map(block=>Object.fromEntries(block.split('\0').filter(Boolean).map(row=>{const space=row.indexOf(' ');return space<0?[row,'']:[row.slice(0,space),row.slice(space+1)];})));
      const matches=entries.filter(row=>row.branch===branch);
      if(matches.length!==1||!samePath(matches[0].worktree,root)||!Object.hasOwn(matches[0],'locked'))fail('managed_lock_unverified');
      if((await git(['rev-parse','--show-object-format'])).toString().trim()!=='sha1')fail('object_format_unsupported');
      return {gitDir,commonDir,index:path.join(gitDir,'index'),lock:path.join(gitDir,'index.lock'),branch};
    }
    const binding=await identity();
    // A recursive status in a submodule would consult a different repository's
    // filter configuration. This narrow finalizer never enters submodules.
    if((await git(['ls-files','--stage','-z'])).toString().split('\0').some(row=>row.startsWith('160000 ')))fail('submodule_unsupported');
    const unchanged=async()=>{
      open();const current=checkpointContext(await readCheckpoint(query),query);
      if(!same(current,context)||!same(await identity(),binding))fail('protected_binding_changed');
    };
    return {query,context,root,directory,env,git,command,proof,binding,unchanged,identity};
  }
  const answer=(s,state,extra={})=>({schema:'metaengine.native-coding.git-commit-receipt.v1',...s.query,state,
    production_qualified:false,successor_admitted:false,automatic_retry_allowed:false,authority_effect:false,...extra});
  async function reviewedBytes(s){
    const files=[];
    for(const row of s.context.reviewed_git.changed_files){
      const name=relativeFile(row.path),file=path.join(s.root,name);let value=null;
      try{
        let current=s.root;for(const part of name.split('/')){current=path.join(current,part);if((await fs.lstat(current)).isSymbolicLink())fail('reviewed_alias');}
        value=(await regular(file,512*1024)).bytes;
      }catch(error){if(error.code!=='ENOENT')throw error;}
      if((value===null?null:hash(value))!==row.sha256||(value?.length??0)!==row.bytes)fail('reviewed_bytes_changed');files.push({...row,content:value});
    }return files;
  }
  async function assertNoFilters(s,index,suppliedNames=null){
    const names=suppliedNames??await s.git(['ls-files','-z'],{index});
    const attrs=(await s.git(['check-attr','-z','--stdin','filter'],{input:names,index})).toString().split('\0');
    for(let i=0;i+2<attrs.length;i+=3)if(!['unspecified','unset'].includes(attrs[i+2]))fail('active_filter_forbidden');
  }
  async function indexMatches(s,index){
    await assertNoFilters(s,index);await reviewedBytes(s);
    // diff-files alone trusts empty stat-cache entries inserted by plumbing.
    // Porcelain diff refreshes its in-memory cache and hashes actual content;
    // GIT_OPTIONAL_LOCKS=0 prevents it rewriting this protected index.
    await s.git(['diff','--quiet','--no-ext-diff','--no-textconv','--'],{index});
    if((await s.git(['ls-files','--others','--exclude-standard','-z'],{index})).length)fail('unreviewed_files_present');
  }
  async function objectReadback(s,plan){
    if(!SHA.test(plan.head||'')||!SHA.test(plan.tree||'')||plan.previous_head!==s.context.checkpoint.source_head
      ||plan.checkpoint_sha256!==s.query.checkpoint_sha256||plan.branch_ref!==s.binding.branch)fail('plan_changed');
    const commit=await s.git(['cat-file','commit',plan.head]);
    if(hash(commit)!==plan.commit_bytes_sha256||commit.toString()!==plan.commit_bytes
      ||(await s.git(['rev-parse',plan.head+'^{tree}'])).toString().trim()!==plan.tree)fail('commit_object_changed');
    const index=await regular(path.join(s.directory,'reviewed.index'));
    if(index.sha256!==plan.index_sha256||(await s.git(['write-tree'],{index:path.join(s.directory,'reviewed.index')})).toString().trim()!==plan.tree)fail('planned_index_changed');
    await indexMatches(s,path.join(s.directory,'reviewed.index'));
    return index.bytes;
  }
  async function readState(s){
    try{
      const intent=await maybeRead(path.join(s.directory,'intent.json'));if(!intent)return answer(s,'NOT_ATTEMPTED');
      if(intent.context_sha256!==digest(s.context)||!same(intent.selectors,s.query)||!HASH.test(intent.original_index_sha256||''))fail('intent_changed');
      const plan=await maybeRead(path.join(s.directory,'plan.json')),refIntent=await maybeRead(path.join(s.directory,'ref-intent.json'));
      if(!plan||!refIntent)return answer(s,'READBACK_REQUIRED',{reason:'INTENT_WITHOUT_CONFIRMED_REF',phase:plan?'PLANNED':'INTENT'});
      if(refIntent.plan_sha256!==digest(plan))fail('ref_intent_changed');
      const current=(await s.git(['rev-parse','--verify',s.binding.branch])).toString().trim();
      if(current!==plan.head)return answer(s,'AMBIGUOUS',{reason:'REF_NOT_AT_RECORDED_COMMIT',previous_head:plan.previous_head,head:plan.head});
      await objectReadback(s,plan);await s.unchanged();
      const currentProof=await s.proof(),completed=await maybeRead(path.join(s.directory,'completed.json'));
      const lockExists=await fs.lstat(s.binding.lock).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
      if(currentProof.head!==plan.head||!currentProof.clean||lockExists)return answer(s,'COMMITTED_INDEX_PENDING',{previous_head:plan.previous_head,head:plan.head,tree:plan.tree});
      const receipt=answer(s,'COMMITTED',{previous_head:plan.previous_head,head:plan.head,tree:plan.tree,branch_ref:plan.branch_ref,
        root_identity_sha256:s.context.checkpoint.root_identity_sha256,reviewed_git_artifact_sha256:s.context.checkpoint.git_artifact_sha256,
        intent_sha256:digest(intent),working_tree_preserved:true,index_clean:true,ref_update_cas_verified:true,commit_object_readback_verified:true});
      if(completed&&!same(completed,receipt))fail('completion_changed');
      return completed?receipt:answer(s,'COMMITTED_RECEIPT_PENDING',{...receipt,state:'COMMITTED_RECEIPT_PENDING'});
    }catch{return answer(s,'READBACK_REQUIRED',{reason:'PHYSICAL_READBACK_UNCONFIRMED'});}
  }
  async function finishIndex(s){
    const intent=await maybeRead(path.join(s.directory,'intent.json')),plan=await maybeRead(path.join(s.directory,'plan.json'));
    const refIntent=await maybeRead(path.join(s.directory,'ref-intent.json'));
    if(!intent||!plan||!refIntent||intent.context_sha256!==digest(s.context)||refIntent.plan_sha256!==digest(plan))fail('finish_intent_unverified');
    if((await s.git(['rev-parse','--verify',s.binding.branch])).toString().trim()!==plan.head)fail('finish_ref_unverified');
    const indexBytes=await objectReadback(s,plan);await s.unchanged();
    const proof=await s.proof();
    const lockExists=await fs.lstat(s.binding.lock).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
    if(!proof.clean||lockExists){
      const original=await regular(s.binding.index),lockRecord=await maybeRead(path.join(s.directory,'index-lock.json'));
      const lock=await regular(s.binding.lock);
      if(original.sha256!==intent.original_index_sha256||!lockRecord||!same(lock.identity,lockRecord.identity)
        ||lockRecord.token_sha256!==hash(Buffer.from(intent.lock_token)))fail('owned_index_lock_unverified');
      const handle=await fs.open(s.binding.lock,'r+');
      try{
        const physical=await handle.stat();if(String(physical.dev)!==lock.identity.dev||String(physical.ino)!==lock.identity.ino)fail('index_lock_replaced');
        await handle.truncate(0);await handle.writeFile(indexBytes);await handle.sync();
      }finally{await handle.close();}
      if((await regular(s.binding.index)).sha256!==intent.original_index_sha256||(await regular(s.binding.lock)).sha256!==plan.index_sha256)fail('index_cas_changed');
      await s.unchanged();await fs.rename(s.binding.lock,s.binding.index);
    }
    const after=await s.proof();await s.unchanged();
    if(after.head!==plan.head||!after.clean)fail('final_worktree_unconfirmed');
    await indexMatches(s,path.join(s.directory,'reviewed.index'));
    const receipt=answer(s,'COMMITTED',{previous_head:plan.previous_head,head:plan.head,tree:plan.tree,branch_ref:plan.branch_ref,
      root_identity_sha256:s.context.checkpoint.root_identity_sha256,reviewed_git_artifact_sha256:s.context.checkpoint.git_artifact_sha256,
      intent_sha256:digest(intent),working_tree_preserved:true,index_clean:true,ref_update_cas_verified:true,commit_object_readback_verified:true});
    const prior=await maybeRead(path.join(s.directory,'completed.json'));if(prior){if(!same(prior,receipt))fail('completion_changed');}
    else await durable(path.join(s.directory,'completed.json'),receipt);
    return receipt;
  }
  return Object.freeze({
    async COMMIT_CHECKPOINT(request){
      const query=select(request),s=await setup(query);
      await fs.mkdir(s.directory,{recursive:true,mode:0o700});await readDirectoryIdentity(s.directory);
      if(await maybeRead(path.join(s.directory,'intent.json')))return readState(s);
      await assertNoFilters(s,null,Buffer.concat([await s.git(['ls-files','-z']),
        Buffer.from(s.context.reviewed_git.changed_files.map(file=>file.path+'\0').join(''))]));
      // Readback is from the protected writer receipt, never model result text.
      if(!same(await s.proof(),s.context.reviewed_git))fail('checkpoint_git_changed');
      const files=await reviewedBytes(s),original=await regular(s.binding.index);
      const intent={schema:'metaengine.native-coding.git-commit-intent.v1',selectors:query,context_sha256:digest(s.context),
        previous_head:s.context.checkpoint.source_head,original_index_sha256:original.sha256,lock_token:'METAENGINE_INDEX_LOCK_V1:'+randomBytes(32).toString('hex')};
      try{await durable(path.join(s.directory,'intent.json'),intent);}catch(error){if(error.code==='EEXIST')return readState(s);throw error;}
      let phase='ACQUIRE_INDEX_LOCK';
      try{
        const lockHandle=await fs.open(s.binding.lock,'wx',0o600);
        try{await lockHandle.writeFile(intent.lock_token);await lockHandle.sync();}finally{await lockHandle.close();}
        const lock=await regular(s.binding.lock);await durable(path.join(s.directory,'index-lock.json'),{identity:lock.identity,token_sha256:lock.sha256});
        phase='BUILD_REVIEWED_INDEX';const index=path.join(s.directory,'reviewed.index');await s.git(['read-tree',intent.previous_head],{index});
        const treeRows=(await s.git(['ls-tree','-r','-z',intent.previous_head])).toString().split('\0').filter(Boolean);
        const modes=new Map(treeRows.map(row=>{const match=/^(100644|100755|120000|160000) [a-z]+ ([a-f0-9]{40})\t(.+)$/.exec(row);if(!match)fail('base_tree_unsupported');return[match[3],match[1]];}));
        const changes=[];
        for(const file of files){
          const mode=modes.get(file.path)||'100644';if(!['100644','100755'].includes(mode))fail('changed_mode_forbidden');
          if(file.content===null)changes.push(Buffer.from('0 '+'0'.repeat(40)+'\t'+file.path+'\0'));
          else{
            const blob=(await s.git(['hash-object','-w','--no-filters','--stdin'],{input:file.content})).toString().trim();
            if(!SHA.test(blob))fail('blob_unverified');changes.push(Buffer.from(mode+' '+blob+'\t'+file.path+'\0'));
          }
        }
        await s.git(['update-index','-z','--index-info'],{input:Buffer.concat(changes),index});
        phase='VERIFY_REVIEWED_INDEX';await indexMatches(s,index);
        const tree=(await s.git(['write-tree'],{index})).toString().trim();
        if(!SHA.test(tree)||tree===(await s.git(['rev-parse',intent.previous_head+'^{tree}'])).toString().trim())fail('reviewed_tree_unchanged');
        phase='BUILD_COMMIT_OBJECT';const at=Math.floor(Date.parse(s.context.checkpoint.verified_at)/1000),identity='METAENGINE Host <native-checkpoint@metaengine.invalid> '+at+' +0000';
        const commitBytes=`tree ${tree}\nparent ${intent.previous_head}\nauthor ${identity}\ncommitter ${identity}\n\nMETAENGINE reviewed checkpoint ${query.checkpoint_sha256}\n\nProject: ${query.project_id}\nCheckpoint: ${query.checkpoint_id}\nReviewed-Git-Artifact: ${s.context.checkpoint.git_artifact_sha256}\n`;
        const head=(await s.git(['hash-object','-t','commit','--stdin'],{input:Buffer.from(commitBytes)})).toString().trim();
        const plan={schema:'metaengine.native-coding.git-commit-plan.v1',checkpoint_sha256:query.checkpoint_sha256,previous_head:intent.previous_head,
          branch_ref:s.binding.branch,tree,head,commit_bytes:commitBytes,commit_bytes_sha256:hash(Buffer.from(commitBytes)),index_sha256:(await regular(index)).sha256};
        if(!SHA.test(head))fail('commit_hash_unverified');await durable(path.join(s.directory,'plan.json'),plan);
        if((await s.git(['hash-object','-w','-t','commit','--stdin'],{input:Buffer.from(commitBytes)})).toString().trim()!==head)fail('commit_object_unverified');
        phase='PRE_REF_READBACK';await objectReadback(s,plan);await s.unchanged();
        if(!same(await s.proof(),s.context.reviewed_git)||(await regular(s.binding.index)).sha256!==original.sha256)fail('pre_ref_candidate_changed');
        await durable(path.join(s.directory,'ref-intent.json'),{schema:'metaengine.native-coding.git-ref-intent.v1',plan_sha256:digest(plan)});
        // After this barrier an absent/failed ACK is UNKNOWN, never permission
        // to dispatch another update-ref. Recovery reads this exact object/ref.
        phase='REF_CAS';await s.git(['update-ref','--no-deref','-m','METAENGINE reviewed checkpoint',s.binding.branch,head,intent.previous_head]);
        phase='FINALIZE_INDEX';
        return await finishIndex(s);
      }catch(error){return answer(s,'READBACK_REQUIRED',{reason:'EFFECT_UNCONFIRMED',phase,
        diagnostic:/^native_coding_git_commit_[a-z_]+$/.test(error.message)?error.message:'native_coding_git_commit_io_unconfirmed',
        ...(error.operation?{git_operation:error.operation,git_exit_code:error.exitCode}:{})});}
    },
    async READ_COMMIT(request){return readState(await setup(select(request)));},
    async RECONCILE_COMMIT(request){
      const s=await setup(select(request)),state=await readState(s);
      if(!['COMMITTED_INDEX_PENDING','COMMITTED_RECEIPT_PENDING'].includes(state.state))return state;
      try{return await finishIndex(s);}catch{return answer(s,'READBACK_REQUIRED',{reason:'INDEX_OR_RECEIPT_UNCONFIRMED'});}
    },
    close(){closed=true;},
  });
}
