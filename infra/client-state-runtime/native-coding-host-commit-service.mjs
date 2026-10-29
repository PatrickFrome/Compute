import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readNativeCodingGitProof} from '../../apps/metaengine-browser/src/native-coding-git-proof.mjs';
import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {readDirectoryIdentity} from './native-coding-fs-identity.mjs';
import {createNativeCodingGitCommitter} from './native-coding-git-commit.mjs';
import {readNativeCodingGitCommitOperator} from './native-coding-git-commit-operator.mjs';
import {readNativeCodingProtectedJson} from '../../apps/metaengine-browser/src/native-coding-host-observers.mjs';
import {protectOwnerOnlyWindowsDirectory,verifyOwnerOnlyWindowsStorage} from '../../apps/metaengine-browser/src/private-windows-storage-acl.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH=/^[0-9a-f]{64}$/,SHA=/^[0-9a-f]{40}$/;
const fail=reason=>{throw Error('native_coding_host_commit_'+reason);};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join('\0')===[...keys].sort().join('\0');
const same=(a,b)=>json(a)===json(b);
const shaText=text=>createHash('sha256').update(text,'utf8').digest('hex');
const selectors=['project_id','checkpoint_sha256'];
function select(value){if(!exact(value,selectors)||!UUID.test(value.project_id||'')||!HASH.test(value.checkpoint_sha256||''))fail('selectors_invalid');return structuredClone(value);}
const flags={production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
const checkpointSql=`select to_jsonb(k) as checkpoint_record
 from destruktion_meta.native_coding_checkpoint_h205f22 k where k.project_id=$1::uuid and k.checkpoint_sha256=$2::text`;
const bundleSql=`select to_jsonb(k) as checkpoint_record,to_jsonb(j) as writer_registration,to_jsonb(cj) as critic_registration,
 to_jsonb(p) as permit_record,to_jsonb(cp) as critic_permit_record,to_jsonb(we) as writer_execution,to_jsonb(ce) as critic_execution,
 to_jsonb(w) as writer_task,to_jsonb(c) as critic_task,to_jsonb(f) as fence,to_jsonb(r) as project,
 (d.active and d.revoked_at is null and d.access_tier='ADMIN' and d.admin_revoked_at is null
   and d.admin_grant_epoch=p.admin_grant_epoch and d.profile='A2_DEVICE_HTTP_SIGNATURE_V1'
   and d.key_fingerprint_sha256=p.permit->>'device_key_fingerprint_sha256'
   and d.admin_scopes @> '["CONTROL_PLANE","DEVOS"]'::jsonb) as device_valid,
 not exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 claim
   join destruktion_meta.devos_fleet_task_h205f22 claimed on claimed.task_id=claim.task_id
   join destruktion_meta.native_coding_operator_permit_h205f22 active_permit on active_permit.permit_id=(claimed.task_spec#>>'{native_coding,permit_id}')::uuid
   where claim.state='ACTIVE' and claim.expires_at>clock_timestamp()
     and active_permit.permit#>>'{worktree,root_identity_sha256}'=k.root_identity_sha256) as root_idle
 from destruktion_meta.native_coding_checkpoint_h205f22 k
 join destruktion_meta.native_coding_job_registration_h205f22 j on j.task_id=k.writer_task_id and j.lease_generation=k.writer_lease_generation
 join destruktion_meta.native_coding_job_registration_h205f22 cj on cj.task_id=k.critic_task_id and cj.lease_generation=k.critic_lease_generation
 join destruktion_meta.native_coding_operator_permit_h205f22 p on p.permit_id=j.permit_id
 join destruktion_meta.native_coding_operator_permit_h205f22 cp on cp.permit_id=cj.permit_id
 join destruktion_meta.native_coding_execution_h205f22 we on we.task_id=k.writer_task_id and we.lease_generation=k.writer_lease_generation
 join destruktion_meta.native_coding_execution_h205f22 ce on ce.task_id=k.critic_task_id and ce.lease_generation=k.critic_lease_generation
 join destruktion_meta.devos_fleet_task_h205f22 w on w.task_id=k.writer_task_id
 join destruktion_meta.devos_fleet_task_h205f22 c on c.task_id=k.critic_task_id
 join destruktion_meta.native_coding_worktree_fence_h205f22 f on f.workspace_id=k.workspace_id and f.root_identity_sha256=k.root_identity_sha256
 join destruktion_meta.project_run_h205f22 r on r.project_id=k.project_id
 join public.compute_fabric_a2_browser_device_h205f22 d on d.device_id=p.device_id and d.client_id=p.client_id
 where k.project_id=$1::uuid and k.checkpoint_sha256=$2::text`;
async function durable(file,value){
  const handle=await fs.open(file,'wx',0o600);
  try{await handle.writeFile(json(value)+'\n');await handle.sync();}finally{await handle.close();}
  // File sync is required on every platform. POSIX also permits syncing the
  // new directory entry. Windows power-loss durability is a separate proof;
  // the process-crash contract never treats a partially written file as absent.
  if(process.platform!=='win32'){
    const parent=await fs.open(path.dirname(file),'r');try{await parent.sync();}finally{await parent.close();}
  }
}

// Read-only physical verifier for the first-SQL boundary. In particular, no
// write-tree/index refresh, directory initialization or Git reconciliation is
// part of an observer READ or the separate SQL-only operation.
async function readCheckpointGitPhysical({context,gitExecutable,gitExecutableSha256,journalRoot,readProtectedJson,verifyStorage}){
  const deny=reason=>{throw Error('native_coding_host_commit_git_readback_'+reason);};
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),oid=(kind,bytes)=>createHash('sha1').update(kind+' '+bytes.length+'\0').update(bytes).digest('hex');
  const equal=(a,b)=>json(a)===json(b),samePath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
  const inside=(a,b)=>{const r=path.relative(a,b);return !!r&&r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
  const overlap=(a,b)=>samePath(a,b)||inside(a,b)||inside(b,a),hash64=value=>/^[a-f0-9]{64}$/.test(value||''),head40=value=>/^[a-f0-9]{40}$/.test(value||'');
  const k=context?.checkpoint,m=context?.managed_worktree,g=context?.reviewed_git,root=m?.path;
  if(context?.schema!=='metaengine.native-coding.git-commit-context.v1'||context.state!=='CHECKPOINTED_PENDING_COMMIT'
    ||!k||sha(k)!==context.checkpoint_sha256||!path.isAbsolute(root||'')||!path.isAbsolute(journalRoot||'')||overlap(root,journalRoot)
    ||!path.isAbsolute(gitExecutable||'')||!hash64(gitExecutableSha256)||!head40(k.source_head)||g?.head!==k.source_head
    ||g.artifact_sha256!==k.git_artifact_sha256||g.clean!==false||!Array.isArray(g.changed_files)||g.changed_files.length<1||g.changed_files.length>128
    ||m.root_identity_sha256!==k.root_identity_sha256||k.worktree?.path!==root||k.worktree.root_identity_sha256!==k.root_identity_sha256
    ||!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]{0,160}$/.test(m.branch_ref||''))deny('context_changed');
  const query={project_id:k.project_id,checkpoint_id:k.checkpoint_id,checkpoint_sha256:context.checkpoint_sha256};
  const answer=(state,extra={})=>({schema:'metaengine.native-coding.git-commit-receipt.v1',...query,state,
    production_qualified:false,successor_admitted:false,automatic_retry_allowed:false,authority_effect:false,...extra});
  const stat=file=>fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  async function regular(file,limit=16*1024*1024,allowHardlinks=false){
    const before=await fs.lstat(file);
    if(!before.isFile()||before.isSymbolicLink()||before.nlink<1||!allowHardlinks&&before.nlink!==1||before.size>limit||!samePath(await fs.realpath(file),file))deny('file_unverified');
    const handle=await fs.open(file,'r');try{
      const opened=await handle.stat(),bytes=await handle.readFile(),after=await handle.stat(),named=await fs.lstat(file);
      for(const s of [opened,after,named])if(!s.isFile()||s.isSymbolicLink()||s.dev!==before.dev||s.ino!==before.ino||s.size!==before.size||s.mtimeMs!==before.mtimeMs||s.nlink!==before.nlink)deny('file_changed');
      if(bytes.length!==before.size)deny('file_changed');return {bytes,sha256:hash(bytes),identity:[String(before.dev),String(before.ino),before.birthtimeMs]};
    }finally{await handle.close();}
  }
  const directories=new Map(),files=new Map(),gitRoot=path.join(journalRoot,'git'),directory=path.join(gitRoot,query.checkpoint_sha256);
  async function directoryPin(file,required=true){
    if(!await stat(file)){if(required)deny('journal_unknown');directories.set(file,null);return false;}
    await verifyStorage(file,{operation:'VERIFY_DIRECTORY'});directories.set(file,await readDirectoryIdentity(file));return true;
  }
  const hasJournal=await directoryPin(journalRoot,false),hasGit=hasJournal&&await directoryPin(gitRoot,false);
  const hasDirectory=hasGit&&await directoryPin(directory,false);
  async function protectedFile(name){
    if(!hasDirectory)return null;const file=path.join(directory,name);if(!await stat(file))return null;
    const stored=await readProtectedJson(file,{maximumBytes:512*1024,verifyStorage}),physical=await regular(file,512*1024);
    if(stored.sha256!==physical.sha256||!equal(JSON.parse(physical.bytes),stored.value))deny('journal_changed');files.set(file,physical);return stored.value;
  }
  async function executable(){if((await regular(gitExecutable,512*1024*1024,true)).sha256!==gitExecutableSha256)deny('executable_changed');}
  await executable();
  const env={SystemRoot:process.env.SystemRoot||process.env.SYSTEMROOT,PATH:path.dirname(gitExecutable),TEMP:journalRoot,TMP:journalRoot,
    GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_ATTR_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',
    GIT_OPTIONAL_LOCKS:'0',GIT_NO_REPLACE_OBJECTS:'1',GIT_NO_LAZY_FETCH:'1',GIT_ALLOW_PROTOCOL:'',LC_ALL:'C'};
  const overrides=[['core.fsmonitor','false'],['core.untrackedCache','false'],['core.hooksPath',''],['core.splitIndex','false'],
    ['core.sparseCheckout','false'],['diff.external',''],['diff.autoRefreshIndex','false'],['commit.gpgSign','false'],['submodule.recurse','false']];
  const configure=()=>{env.GIT_CONFIG_COUNT=String(overrides.length);overrides.forEach(([key,value],i)=>{env['GIT_CONFIG_KEY_'+i]=key;env['GIT_CONFIG_VALUE_'+i]=value;});};configure();
  const git=(args,{input=null,allowed=[0],index=null}={})=>new Promise((resolve,reject)=>{
    const child=spawn(gitExecutable,['--no-pager',...args],{cwd:root,env:{...env,...(index?{GIT_INDEX_FILE:index}:{})},windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    const chunks=[];let size=0,expired=false;const timer=setTimeout(()=>{expired=true;child.kill();},30000);
    child.stdout.on('data',bytes=>{size+=bytes.length;if(size>4*1024*1024){expired=true;child.kill();}else chunks.push(bytes);});
    child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
    child.once('error',()=>{clearTimeout(timer);reject(Error('native_coding_host_commit_git_readback_spawn_failed'));});
    child.once('close',code=>{clearTimeout(timer);allowed.includes(code)&&!expired?resolve(Buffer.concat(chunks)):reject(Error('native_coding_host_commit_git_readback_command_unconfirmed'));});child.stdin.end(input);
  });
  const configured=(await git(['config','--null','--get-regexp','^filter\\..*\\.(clean|smudge|process|required)$'],{allowed:[0,1]})).toString(),drivers=new Set();
  for(const row of configured.split('\0').filter(Boolean)){const match=/^filter\.(.+)\.(?:clean|smudge|process|required)\n/.exec(row);
    if(!match||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(match[1]))deny('filter_config_unverified');drivers.add(match[1]);}
  if(drivers.size>32)deny('filter_budget');for(const driver of drivers)for(const field of ['clean','smudge','process','required'])overrides.push(['filter.'+driver+'.'+field,field==='required'?'false':'']);configure();
  async function binding(){
    if(await readDirectoryIdentity(root)!==m.root_identity_sha256)deny('workspace_changed');
    const pointer=await regular(path.join(root,'.git'),8192);
    if(!samePath((await git(['rev-parse','--show-toplevel'])).toString().trim(),root))deny('workspace_changed');
    const gitDir=path.resolve((await git(['rev-parse','--absolute-git-dir'])).toString().trim()),commonDir=path.resolve(root,(await git(['rev-parse','--git-common-dir'])).toString().trim());
    if(overlap(root,gitDir)||overlap(root,commonDir)||!inside(path.join(commonDir,'worktrees'),gitDir)
      ||overlap(journalRoot,gitDir)||overlap(journalRoot,commonDir)
      ||await readDirectoryIdentity(gitDir)!==m.git_dir_identity_sha256||await readDirectoryIdentity(commonDir)!==m.common_dir_identity_sha256)deny('git_directory_changed');
    const lock=await regular(path.join(gitDir,'locked'),8192),branch=(await git(['symbolic-ref','--quiet','HEAD'])).toString().trim();
    if(branch!==m.branch_ref)deny('branch_changed');await git(['check-ref-format',branch]);
    const rows=(await git(['worktree','list','--porcelain','-z'])).toString().split('\0\0').filter(Boolean).map(block=>Object.fromEntries(block.split('\0').filter(Boolean).map(row=>{
      const i=row.indexOf(' ');return i<0?[row,'']:[row.slice(0,i),row.slice(i+1)];}))),matches=rows.filter(row=>row.branch===branch);
    if(matches.length!==1||!samePath(matches[0].worktree,root)||!Object.hasOwn(matches[0],'locked'))deny('worktree_lock_changed');
    if((await git(['rev-parse','--show-object-format'])).toString().trim()!=='sha1')deny('object_format_unverified');
    return {gitDir,commonDir,index:path.join(gitDir,'index'),lock:path.join(gitDir,'index.lock'),branch,
      pointer:{sha256:pointer.sha256,identity:pointer.identity},worktreeLock:{sha256:lock.sha256,identity:lock.identity}};
  }
  const pinned=await binding();
  if((await git(['ls-files','--stage','-z'])).toString().split('\0').some(row=>row.startsWith('160000 ')))deny('submodule_unverified');
  const names=Buffer.concat([await git(['ls-files','-z']),Buffer.from(g.changed_files.map(file=>file.path+'\0').join(''))]);
  const attrs=(await git(['check-attr','-z','--stdin','filter'],{input:names})).toString().split('\0');
  for(let i=0;i+2<attrs.length;i+=3)if(!['unspecified','unset'].includes(attrs[i+2]))deny('active_filter');
  const reviewedFiles=[];let reviewedSize=0;
  for(const row of g.changed_files){
    const name=row.path;if(typeof name!=='string'||!name||name.length>1024||/[\x00-\x1f\\<>:"|?*]/.test(name)||path.isAbsolute(name)
      ||name.split('/').some(p=>!p||p==='.'||p==='..'||p.toLowerCase()==='.git'||/[. ]$/.test(p)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))
      ||!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>512*1024||row.sha256!==null&&!hash64(row.sha256))deny('reviewed_path_unverified');
    let current=root,bytes=null;try{for(const part of name.split('/')){current=path.join(current,part);if((await fs.lstat(current)).isSymbolicLink())deny('reviewed_alias');}
      bytes=(await regular(current,512*1024)).bytes;}catch(error){if(error.code!=='ENOENT')throw error;}
    if((bytes===null?null:hash(bytes))!==row.sha256||(bytes?.length??0)!==row.bytes)deny('reviewed_bytes_changed');
    reviewedSize+=row.bytes;reviewedFiles.push({path:row.path,status:row.status,sha256:row.sha256,bytes:row.bytes});
  }
  if(reviewedSize>4*1024*1024||hash(JSON.stringify({head:g.head,files:reviewedFiles,diff_sha256:g.diff_sha256}))!==g.artifact_sha256)deny('reviewed_proof_changed');
  const intent=await protectedFile('intent.json'),indexBefore=await regular(pinned.index);
  async function unchanged(){
    if(!equal(await binding(),pinned)||await stat(pinned.lock))deny('physical_binding_changed');
    for(const [file,identity] of directories){const exists=await stat(file);if(identity===null){if(exists)deny('journal_changed');}
      else{await verifyStorage(file,{operation:'VERIFY_DIRECTORY'});if(!exists||await readDirectoryIdentity(file)!==identity)deny('journal_changed');}}
    for(const [file,original] of files){await verifyStorage(file,{operation:'VERIFY_FILE'});const current=await regular(file);
      if(current.sha256!==original.sha256||!equal(current.identity,original.identity))deny('journal_changed');}
    const indexAfter=await regular(pinned.index);if(indexAfter.sha256!==indexBefore.sha256||!equal(indexAfter.identity,indexBefore.identity))deny('index_changed');await executable();
  }
  if(!intent){
    if(hasDirectory&&(await fs.readdir(directory)).length)deny('orphan_git_journal');
    const proof=await readNativeCodingGitProof(root,{env,gitExecutable});
    if(!equal(proof,g)||(await git(['rev-parse','--verify',pinned.branch])).toString().trim()!==k.source_head)deny('not_attempted_unverified');
    await unchanged();return answer('NOT_ATTEMPTED');
  }
  const plan=await protectedFile('plan.json'),ref=await protectedFile('ref-intent.json'),completed=await protectedFile('completed.json');
  if(intent.schema!=='metaengine.native-coding.git-commit-intent.v1'||!equal(intent.selectors,query)||intent.context_sha256!==sha(context)
    ||intent.previous_head!==k.source_head||!hash64(intent.original_index_sha256)||!plan||!ref||!completed
    ||plan.schema!=='metaengine.native-coding.git-commit-plan.v1'||plan.checkpoint_sha256!==query.checkpoint_sha256
    ||plan.previous_head!==k.source_head||plan.branch_ref!==pinned.branch||!head40(plan.head)||!head40(plan.tree)||plan.head===plan.previous_head
    ||!hash64(plan.index_sha256)||!hash64(plan.commit_bytes_sha256)||ref.schema!=='metaengine.native-coding.git-ref-intent.v1'||ref.plan_sha256!==sha(plan))deny('committed_journal_unverified');
  const at=Math.floor(Date.parse(k.verified_at)/1000),identity='METAENGINE Host <native-checkpoint@metaengine.invalid> '+at+' +0000';
  const expected=`tree ${plan.tree}\nparent ${k.source_head}\nauthor ${identity}\ncommitter ${identity}\n\nMETAENGINE reviewed checkpoint ${query.checkpoint_sha256}\n\nProject: ${query.project_id}\nCheckpoint: ${query.checkpoint_id}\nReviewed-Git-Artifact: ${k.git_artifact_sha256}\n`;
  const commit=await git(['cat-file','commit',plan.head]),tree=await git(['cat-file','tree',plan.tree]);
  if(!Number.isFinite(at)||commit.toString()!==expected||plan.commit_bytes!==expected||hash(commit)!==plan.commit_bytes_sha256||oid('commit',commit)!==plan.head
    ||oid('tree',tree)!==plan.tree||(await git(['rev-parse',plan.head+'^{tree}'])).toString().trim()!==plan.tree
    ||(await git(['rev-parse','--verify',pinned.branch])).toString().trim()!==plan.head)deny('git_object_or_ref_changed');
  // A matching index/tree name alone does not read blob bytes. Verify the
  // actual reviewed payload objects and their containing trees independently.
  const entries=new Map((await git(['ls-tree','-r','-t','-z',plan.tree])).toString().split('\0').filter(Boolean).map(row=>{
    const match=/^([0-9]{6}) (blob|tree|commit) ([a-f0-9]{40})\t([\s\S]+)$/.exec(row);
    if(!match)deny('tree_entry_unverified');return [match[4],{mode:match[1],kind:match[2],oid:match[3]}];
  }));
  const readTrees=new Set();
  for(const reviewed of reviewedFiles){
    const entry=entries.get(reviewed.path);
    if(reviewed.sha256===null){if(entry)deny('reviewed_deletion_changed');continue;}
    if(!entry||entry.kind!=='blob'||!['100644','100755'].includes(entry.mode))deny('reviewed_blob_unverified');
    const bytes=await git(['cat-file','blob',entry.oid]);
    if(oid('blob',bytes)!==entry.oid||hash(bytes)!==reviewed.sha256||bytes.length!==reviewed.bytes)deny('reviewed_blob_changed');
    const parts=reviewed.path.split('/');
    for(let depth=1;depth<parts.length;depth++){
      const name=parts.slice(0,depth).join('/');if(readTrees.has(name))continue;readTrees.add(name);
      const parent=entries.get(name);if(parent?.kind!=='tree')deny('reviewed_tree_unverified');
      if(oid('tree',await git(['cat-file','tree',parent.oid]))!==parent.oid)deny('reviewed_tree_changed');
    }
  }
  const reviewedIndexPath=path.join(directory,'reviewed.index');await verifyStorage(reviewedIndexPath,{operation:'VERIFY_FILE'});
  const reviewedIndex=await regular(reviewedIndexPath);files.set(reviewedIndexPath,reviewedIndex);
  if(reviewedIndex.sha256!==plan.index_sha256||indexBefore.sha256!==plan.index_sha256)deny('live_index_changed');
  // A read-only index/tree comparison replaces write-tree; exact raw bytes tie
  // the actual live index to the protected reviewed index and recorded plan.
  await git(['diff','--cached','--quiet','--no-ext-diff','--no-textconv',plan.head,'--']);
  // Without index auto-refresh, --quiet can report a stat-only change without
  // hashing equal file content. Read the actual diff while keeping the index
  // immutable; equal bytes with a different mtime remain a legitimate read.
  if((await git(['diff','--no-ext-diff','--no-textconv','--binary','--'])).length)deny('worktree_changed');
  const proof=await readNativeCodingGitProof(root,{env,gitExecutable});
  if(proof.head!==plan.head||!proof.clean||(await git(['ls-files','--others','--exclude-standard','-z'])).length)deny('worktree_changed');
  await unchanged();
  const receipt=answer('COMMITTED',{previous_head:plan.previous_head,head:plan.head,tree:plan.tree,branch_ref:plan.branch_ref,
    root_identity_sha256:k.root_identity_sha256,reviewed_git_artifact_sha256:k.git_artifact_sha256,intent_sha256:sha(intent),
    working_tree_preserved:true,index_clean:true,ref_update_cas_verified:true,commit_object_readback_verified:true});
  if(!equal(completed,receipt))deny('receipt_changed');return receipt;
}

// Mount only in the existing trusted runtime Host. sql is the already-open
// state_owner connection; physical/protected readers are private dependencies.
// Caller input never supplies SQL, a receipt, registry content, paths or Git args.
export async function createNativeCodingHostCommitService({sql,stateDirectory,readNativeScope,readProtectedReceipt,
  readOperator=readNativeCodingGitCommitOperator,readProtectedJson=readNativeCodingProtectedJson,
  protectStorage=protectOwnerOnlyWindowsDirectory,verifyStorage=verifyOwnerOnlyWindowsStorage}={}){
  if(typeof sql?.unsafe!=='function'||typeof sql?.begin!=='function'
    ||![readNativeScope,readProtectedReceipt,readOperator,readProtectedJson,protectStorage,verifyStorage].every(fn=>typeof fn==='function'))fail('private_dependencies_required');
  let closed=false;const open=()=>{if(closed)fail('closed');};
  async function owner(db=sql){open();const rows=await db.unsafe('select current_user::text as current_user,session_user::text as session_user');
    if(rows.length!==1||rows[0].current_user!=='state_owner'||rows[0].session_user!=='state_owner')fail('state_owner_required');}
  await owner();const operator=await readOperator(stateDirectory),pins=operator.value;
  // Construction and READ never initialize or repair journals. The first
  // ordinary FINISH pins their physical identities before any Git effect.
  const stateIdentity=await readDirectoryIdentity(stateDirectory);
  await verifyStorage(stateDirectory,{operation:'VERIFY_DIRECTORY'});
  async function managedBinding(k,{requireActive=false}={}){
    const direct=pins.bindings.filter(row=>row.project_id===k.project_id&&row.workspace_id===k.workspace_id
      &&row.root_identity_sha256===k.root_identity_sha256&&row.path===k.worktree.path);
    if(direct.length===1)return direct[0];
    if(direct.length||!pins.profile_bindings?.length)fail('managed_registry_unavailable');
    const rows=await sql.unsafe(`select to_jsonb(s) as seed_record,s.body::text as canonical_body_text,to_jsonb(p) as profile_record,
      to_jsonb(r) as seed_project from destruktion_meta.native_coding_seed_h205f22 s
      join destruktion_meta.native_coding_seed_profile_h205f22 p using(profile_id)
      join destruktion_meta.project_run_h205f22 r on r.project_id=s.project_id and r.workspace_id=s.workspace_id
      where s.project_id=$1::uuid and s.workspace_id=$2::uuid`,[k.project_id,k.workspace_id]);
    const row=rows[0],s=row?.seed_record,pr=row?.profile_record,p=pr?.profile,r=row?.seed_project;
    const candidates=pins.profile_bindings.filter(pin=>pin.profile_id===s?.profile_id&&pin.profile_sha256===s?.profile_sha256
      &&pin.workspace_id===k.workspace_id&&pin.path===k.worktree.path&&pin.root_identity_sha256===k.root_identity_sha256);
    if(rows.length!==1||candidates.length!==1||!s||!pr||!p||!r)fail('seed_profile_binding_unavailable');
    const pin=candidates[0],parse=(text,expected,digest)=>{
      if(typeof text!=='string'||Buffer.byteLength(text)>256*1024||!HASH.test(digest||'')||shaText(text)!==digest)fail('seed_canonical_changed');
      let value;try{value=JSON.parse(text);}catch{fail('seed_canonical_changed');}
      if(!same(value,expected))fail('seed_canonical_changed');
    };
    parse(pr.canonical_profile,p,pin.profile_sha256);
    parse(s.canonical_goal,s.goal,s.goal_sha256);parse(s.canonical_receipt,s.receipt,s.receipt_sha256);
    parse(row.canonical_body_text,s.body,s.body_sha256);
    const receipt=s.receipt,goal=s.goal;
    if(pr.profile_id!==pin.profile_id||pr.profile_sha256!==pin.profile_sha256||requireActive&&pr.revoked_at!==null
      ||!(p.schema==='metaengine.native-coding.seed-profile.v1'||(p.schema==='metaengine.native-coding.seed-profile.v2'&&p.coordination_mode==='CHAT_LED'))||p.profile_id!==pin.profile_id||p.workspace_id!==k.workspace_id
      ||p.trust_namespace!=='LOCAL_OPERATOR_QA'||p.owner_epoch!==k.owner_epoch||!same(p.artifact,k.artifact)
      ||p.postgres?.system_identifier!==k.postgres?.system_identifier
      ||p.postgres?.data_directory_identity_sha256!==k.postgres?.data_directory_identity_sha256
      ||['production_qualified','automatic_retry_allowed','authority_effect'].some(key=>p[key]!==false)
      ||!Array.isArray(p.agents)||!p.agents.some(a=>a.worktree?.path===pin.path&&a.worktree?.root_identity_sha256===pin.root_identity_sha256)
      ||s.workspace_id!==k.workspace_id||s.project_id!==k.project_id||s.profile_sha256!==pin.profile_sha256
      ||s.goal_id!==k.goal_id||s.goal_sha256!==k.goal_sha256
      ||!exact(s.body,['request_id','objective'])||s.body.request_id!==s.request_id||s.body.objective!==s.objective
      ||goal?.schema!=='metaengine.native-coding.goal.v1'||goal.project_id!==s.project_id||goal.workspace_id!==s.workspace_id
      ||goal.profile_id!==pin.profile_id||goal.profile_sha256!==pin.profile_sha256||goal.request_id!==s.request_id
      ||goal.goal_id!==s.goal_id||goal.objective!==s.objective
      ||r.root_task_id!==s.root_task_id||r.request_id!==s.request_id||r.goal!==s.objective
      ||r.device_id!==p.device_id||r.client_id!==p.client_id||Number(r.admin_grant_epoch)!==p.admin_grant_epoch
      ||receipt?.schema!=='metaengine.native-coding.goal-admission.v1'||receipt.state!=='ADMITTED'
      ||receipt.request_id!==s.request_id||receipt.objective!==s.objective||receipt.profile_id!==pin.profile_id
      ||receipt.profile_sha256!==pin.profile_sha256||receipt.workspace_id!==s.workspace_id||receipt.project_id!==s.project_id
      ||receipt.root_task_id!==s.root_task_id||receipt.goal_id!==s.goal_id||receipt.goal_sha256!==s.goal_sha256
      ||receipt.task_spec_sha256!==s.task_spec_sha256||!same(receipt.permit_ids,s.permit_ids)||!same(receipt.logical_policy,p.policy)
      ||['physical_execution_proven','global_actuation_granted','production_qualified','automatic_retry_allowed','authority_effect'].some(key=>receipt[key]!==false))fail('seed_profile_binding_changed');
    const {profile_id,profile_sha256,...physical}=pin;
    return {...physical,project_id:k.project_id};
  }
  async function unchangedOperator(){open();const current=await readOperator(stateDirectory);if(current.sha256!==operator.sha256||!same(current.value,pins))fail('operator_changed');}
  async function checkpoint(query){
    await owner();const rows=await sql.unsafe(checkpointSql,[query.project_id,query.checkpoint_sha256]);
    const row=rows[0]?.checkpoint_record,k=row?.checkpoint;
    if(rows.length!==1||!UUID.test(k?.checkpoint_id||'')||k.schema!=='metaengine.native-coding.checkpoint.v1'
      ||k.project_id!==query.project_id||row.checkpoint_sha256!==query.checkpoint_sha256||sha(k)!==query.checkpoint_sha256
      ||row.canonical_checkpoint!==json(k)||row.checkpoint_id!==k.checkpoint_id||row.project_id!==k.project_id
      ||k.trust_namespace!=='LOCAL_OPERATOR_QA'||!SHA.test(k.source_head||'')||!HASH.test(k.root_identity_sha256||'')
      ||['production_qualified','automatic_retry_allowed','successor_admitted','authority_effect'].some(key=>k[key]!==false))fail('checkpoint_unverified');
    for(const field of ['workspace_id','writer_task_id','critic_task_id','writer_run_id','critic_run_id','writer_receipt_sha256','critic_receipt_sha256',
      'result_sha256','git_artifact_sha256','source_head','root_identity_sha256'])if(row[field]!==k[field])fail('checkpoint_column_changed');
    for(const field of ['writer_lease_generation','critic_lease_generation'])if(Number(row[field])!==k[field])fail('checkpoint_generation_changed');
    await unchangedOperator();return structuredClone(k);
  }
  const queryFor=k=>({project_id:k.project_id,checkpoint_id:k.checkpoint_id,checkpoint_sha256:sha(k)});
  async function protectedContext(request,{captureAuthority=false}={}){
    const query={project_id:request.project_id,checkpoint_sha256:request.checkpoint_sha256},k=await checkpoint(query);
    if(request.checkpoint_id!==k.checkpoint_id)fail('checkpoint_selector_changed');
    const rows=await sql.unsafe(bundleSql,[query.project_id,query.checkpoint_sha256]),b=rows[0],p=b?.permit_record?.permit,cp=b?.critic_permit_record?.permit;
    if(rows.length!==1||!same(b.checkpoint_record.checkpoint,k)||b.device_valid!==true||b.root_idle!==true||b.project?.state!=='ACTIVE'
      ||b.project.project_id!==k.project_id||b.project.workspace_id!==k.workspace_id||!p||p.role!=='IMPLEMENTER'
      ||p.trust_namespace!=='LOCAL_OPERATOR_QA'||p.project_id!==k.project_id||p.workspace_id!==k.workspace_id
      ||p.goal_id!==k.goal_id||p.goal_sha256!==k.goal_sha256||p.owner_epoch!==k.owner_epoch||p.revoked!==false
      ||b.permit_record.revoked_at!==null||Date.parse(p.expires_at)<=Date.now()||!Number.isFinite(Date.parse(p.expires_at))
      ||b.fence?.state!=='CHECKPOINTED_PENDING_COMMIT'||b.fence.checkpoint_sha256!==query.checkpoint_sha256
      ||b.fence.project_id!==k.project_id||b.fence.workspace_id!==k.workspace_id||b.fence.root_identity_sha256!==k.root_identity_sha256
      ||b.fence.writer_task_id!==k.writer_task_id||Number(b.fence.writer_lease_generation)!==k.writer_lease_generation)fail('pending_checkpoint_unavailable');
    if(!cp||cp.role!=='CRITIC'||cp.project_id!==k.project_id||cp.workspace_id!==k.workspace_id||cp.goal_id!==p.goal_id
      ||cp.goal_sha256!==p.goal_sha256||cp.owner_epoch!==p.owner_epoch||cp.user_sid!==p.user_sid
      ||cp.revoked!==false||b.critic_permit_record.revoked_at!==null||!Number.isFinite(Date.parse(cp.expires_at))
      ||Date.parse(cp.expires_at)<=Date.now()||cp.worktree?.path!==p.worktree?.path
      ||cp.worktree?.root_identity_sha256!==p.worktree?.root_identity_sha256||cp.worktree?.base_sha!==k.source_head
      ||!same(cp.artifact,p.artifact))fail('critic_permit_unavailable');
    for(const role of ['writer','critic']){
      const j=b[role+'_registration'],e=b[role+'_execution'],t=b[role+'_task'],generation=k[role+'_lease_generation'];
      if(j?.task_id!==k[role+'_task_id']||j.run_id!==k[role+'_run_id']||Number(j.lease_generation)!==generation
        ||j.canonical_result_receipt!==json(j.result_receipt)||j.result_receipt_sha256!==sha(j.result_receipt)
        ||j.result_receipt_sha256!==k[role+'_receipt_sha256']||e?.state!=='CHECKPOINTED'||e.checkpoint_sha256!==query.checkpoint_sha256
        ||e.task_id!==j.task_id||Number(e.lease_generation)!==generation||t?.task_id!==j.task_id||t.state!=='COMPLETED'
        ||Number(t.lease_generation)!==generation)fail('registered_pair_changed');
    }
    const j=b.writer_registration,receipt=j.result_receipt;
    if(j.permit_id!==p.permit_id||receipt.schema!=='metaengine.codex-cli.run-receipt.v1'||receipt.state!=='RESULT_READY'
      ||receipt.project_id!==k.project_id||receipt.workspace_id!==k.workspace_id||receipt.permit_id!==p.permit_id
      ||receipt.task_id!==k.writer_task_id||receipt.run_id!==k.writer_run_id||receipt.role!=='IMPLEMENTER'
      ||receipt.result_sha256!==k.result_sha256||receipt.git_after?.head!==k.source_head
      ||receipt.git_after?.artifact_sha256!==k.git_artifact_sha256||p.worktree?.path!==k.worktree.path
      ||p.worktree?.root_identity_sha256!==k.worktree.root_identity_sha256
      ||!same(p.artifact,k.artifact)||p.postgres?.system_identifier!==k.postgres?.system_identifier
      ||p.postgres.data_directory_identity_sha256!==k.postgres.data_directory_identity_sha256)fail('writer_receipt_changed');
    const physicalReceipt=await readProtectedReceipt({scope:k.writer_execution_scope,permit:p,job:j.job_envelope});
    if(!same(physicalReceipt,receipt))fail('protected_writer_changed');
    const current=await readNativeScope(p,false);
    if(!current||!same(current.artifact,k.artifact)||!same(current.postgres,k.postgres)||current.user_sid!==p.user_sid
      ||current.worktree?.path!==k.worktree.path||current.worktree.root_identity_sha256!==k.root_identity_sha256
      ||!Number.isSafeInteger(current.host_process?.pid)||current.host_process.pid<1
      ||typeof current.host_process.process_incarnation_id!=='string'||!current.host_process.process_incarnation_id
      ||current.host_process.process_incarnation_id.length>512)fail('physical_scope_changed');
    const managed=await managedBinding(k,{requireActive:true});
    const gates=await sql.unsafe('select destruktion_meta.native_coding_commit_gate_v1($1::uuid) as value',[k.checkpoint_id]),gate=gates[0]?.value;
    if(gates.length!==1||gate?.schema!=='metaengine.native-coding.commit-gate.v1'||gate.checkpoint_id!==k.checkpoint_id
      ||gate.checkpoint_sha256!==query.checkpoint_sha256||gate.project_id!==k.project_id||gate.workspace_id!==k.workspace_id
      ||gate.root_identity_sha256!==k.root_identity_sha256||gate.writer_permit_id!==p.permit_id||gate.critic_permit_id!==cp.permit_id
      ||gate.admitted!==true||gate.authority_effect!==false)fail('sql_commit_gate_unavailable');
    const {project_id,workspace_id,...managed_worktree}=managed;
    await unchangedOperator();const context={schema:'metaengine.native-coding.git-commit-context.v1',state:'CHECKPOINTED_PENDING_COMMIT',
      checkpoint:k,checkpoint_sha256:query.checkpoint_sha256,reviewed_git:receipt.git_after,managed_worktree};
    const authority={host_process:current.host_process,user_sid:current.user_sid,artifact:current.artifact,postgres:current.postgres,
      worktree:{path:current.worktree.path,root_identity_sha256:current.worktree.root_identity_sha256}};
    return captureAuthority?{context,authority:structuredClone(authority)}:context;
  }
  const committer=createNativeCodingGitCommitter({gitExecutable:pins.git_executable,expectedGitExecutableSha256:pins.git_executable_sha256,
    journalRoot:path.join(pins.journal_root,'git'),readCheckpoint:protectedContext,protectStorage,verifyStorage});
  async function verifiedGit(receipt,k){
    if(!receipt||receipt.schema!=='metaengine.native-coding.git-commit-receipt.v1'||receipt.state!=='COMMITTED'
      ||receipt.project_id!==k.project_id||receipt.checkpoint_id!==k.checkpoint_id||receipt.checkpoint_sha256!==sha(k)
      ||receipt.previous_head!==k.source_head||!SHA.test(receipt.head||'')||!SHA.test(receipt.tree||'')||receipt.head===receipt.previous_head
      ||receipt.root_identity_sha256!==k.root_identity_sha256||receipt.reviewed_git_artifact_sha256!==k.git_artifact_sha256
      ||!HASH.test(receipt.intent_sha256||'')||['working_tree_preserved','index_clean','ref_update_cas_verified','commit_object_readback_verified'].some(key=>receipt[key]!==true)
      ||['production_qualified','automatic_retry_allowed','successor_admitted','authority_effect'].some(key=>receipt[key]!==false))fail('git_receipt_unverified');
    const managed=await managedBinding(k);
    if(receipt.branch_ref!==managed.branch_ref)fail('git_branch_unverified');return receipt;
  }
  async function sqlReadback(k){
    await owner();const rows=await sql.unsafe('select destruktion_meta.native_coding_read_commit_v1($1::uuid) as value',[k.checkpoint_id]);
    if(rows.length!==1)fail('sql_readback_unavailable');const value=rows[0].value;if(value===null)return null;
    const receipt=await verifiedGit(value.receipt,k);
    if(value.schema!=='metaengine.native-coding.commit-checkpoint.v1'||value.project_id!==k.project_id||value.checkpoint_id!==k.checkpoint_id
      ||value.checkpoint_sha256!==sha(k)||value.canonical_receipt!==json(receipt)||value.commit_receipt_sha256!==sha(receipt)
      ||!['SUCCESSOR_ADMITTED','COMMITTED_NO_SUCCESSOR','COMMITTED_PENDING_SUCCESSOR'].includes(value.state)
      ||value.previous_head!==receipt.previous_head||value.head!==receipt.head||value.tree!==receipt.tree
      ||value.root_fence_released!==true||['production_qualified','automatic_retry_allowed','authority_effect'].some(key=>value[key]!==false)
      ||value.successor_admitted!==(value.state==='SUCCESSOR_ADMITTED')
      ||![value.next_writer_permit_id,value.next_critic_permit_id].every(id=>UUID.test(id||''))
      ||value.successor_task_id!==null&&!UUID.test(value.successor_task_id||'')
      ||value.successor_admitted!==(value.successor_task_id!==null))fail('sql_commit_record_unverified');
    // A self-consistent SQL JSON row cannot substitute another receipt for
    // the protected Git completion or the sole admitted SQL intent.
    const state=await journal(k);
    if(state.present&&!same(state.intent.receipt,receipt))fail('sql_receipt_changed');
    const completed=(await readProtectedJson(path.join(pins.journal_root,'git',sha(k),'completed.json'))).value;
    if(!same(completed,receipt))fail('sql_receipt_changed');
    await unchangedOperator();return structuredClone(value);
  }
  const result=(query,state,extra={})=>({schema:'metaengine.native-coding.host-commit-service.v1',...query,state,...flags,successor_admitted:false,...extra});
  const journalPaths=k=>({state:stateDirectory,journal:pins.journal_root,
    sql_root:path.join(pins.journal_root,'sql-finalize'),sql_checkpoint:path.join(pins.journal_root,'sql-finalize',sha(k)),
    git_root:path.join(pins.journal_root,'git'),git_checkpoint:path.join(pins.journal_root,'git',sha(k)),
    hooks:path.join(pins.journal_root,'git','empty-hooks')});
  const anchorFile=k=>path.join(stateDirectory,'native-coding-checkpoint-reconciliation-'+sha(k)+'.json');
  async function privateState(){
    await unchangedOperator();await verifyStorage(stateDirectory,{operation:'VERIFY_DIRECTORY'});
    if(await readDirectoryIdentity(stateDirectory)!==stateIdentity)fail('state_directory_changed');
  }
  async function optionalJson(file){
    // File presence and its parsed value are deliberately separate: existing
    // null/false/empty/malformed intents are UNKNOWN, never NOT_ATTEMPTED.
    let stat;try{stat=await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return {present:false,value:null};throw error;}
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)fail('journal_file_unverified');
    return {present:true,value:(await readProtectedJson(file)).value};
  }
  async function verifyAnchor(k,anchor){
    const paths=journalPaths(k);
    if(!exact(anchor,['schema','project_id','checkpoint_id','checkpoint_sha256','operator_sha256','identities'])
      ||anchor.schema!=='metaengine.native-coding.checkpoint-reconciliation-journal.v1'
      ||anchor.project_id!==k.project_id||anchor.checkpoint_id!==k.checkpoint_id||anchor.checkpoint_sha256!==sha(k)
      ||anchor.operator_sha256!==operator.sha256||!exact(anchor.identities,Object.keys(paths))
      ||anchor.identities.state!==stateIdentity)fail('sql_journal_anchor_changed');
    await privateState();
    for(const [key,directory] of Object.entries(paths)){
      if(!HASH.test(anchor.identities[key]||'')||await readDirectoryIdentity(directory)!==anchor.identities[key])fail('sql_journal_identity_changed');
      await verifyStorage(directory,{operation:'VERIFY_DIRECTORY'});
    }
    return anchor;
  }
  async function journal(k){
    await privateState();
    const saved=await optionalJson(anchorFile(k)),anchor=saved.present?await verifyAnchor(k,saved.value):null;
    const file=path.join(journalPaths(k).sql_checkpoint,'intent.json'),stored=await optionalJson(file),intent=stored.value;
    if(stored.present){
      if(!exact(intent,['schema','checkpoint_sha256','operator_sha256','receipt','canonical_receipt','receipt_sha256'])
        ||intent.schema!=='metaengine.native-coding.sql-commit-intent.v1'||intent.checkpoint_sha256!==sha(k)
        ||intent.operator_sha256!==operator.sha256||intent.canonical_receipt!==json(intent.receipt)
        ||intent.receipt_sha256!==sha(intent.receipt))fail('sql_intent_changed');
      await verifiedGit(intent.receipt,k);
    }
    if(anchor)await verifyAnchor(k,anchor);await privateState();
    return {file,intent,present:stored.present,anchor};
  }
  async function prepareJournal(k){
    const prior=await journal(k);if(prior.present||prior.anchor)return prior;
    // Called only after an independent physical NOT_ATTEMPTED proof. No
    // reconciliation/READ request may synthesize a missing historical anchor.
    const paths=journalPaths(k);
    for(const name of [paths.sql_checkpoint,paths.git_checkpoint]){
      try{if((await fs.readdir(name)).length)fail('unanchored_journal_not_empty');}
      catch(error){if(error.code!=='ENOENT')throw error;}
    }
    // Validate existing ancestors before mkdir/ACL work. A redirected path
    // must not cause even preparatory writes in another directory.
    for(const directory of Object.values(paths)){
      let ancestor=directory;
      for(;;){
        try{await fs.lstat(ancestor);await readDirectoryIdentity(ancestor);break;}
        catch(error){if(error.code!=='ENOENT')throw error;const parent=path.dirname(ancestor);if(parent===ancestor)throw error;ancestor=parent;}
      }
    }
    const identities={state:stateIdentity};
    for(const [key,directory] of Object.entries(paths))if(key!=='state'){
      await fs.mkdir(directory,{recursive:true,mode:0o700});await readDirectoryIdentity(directory);await protectStorage(directory);
      await verifyStorage(directory,{operation:'VERIFY_DIRECTORY'});identities[key]=await readDirectoryIdentity(directory);
    }
    if((await fs.readdir(paths.hooks)).length)fail('hooks_directory_not_empty');
    const anchor={schema:'metaengine.native-coding.checkpoint-reconciliation-journal.v1',project_id:k.project_id,
      checkpoint_id:k.checkpoint_id,checkpoint_sha256:sha(k),operator_sha256:operator.sha256,identities};
    await privateState();
    try{await durable(anchorFile(k),anchor);}catch(error){if(error.code!=='EEXIST')throw error;}
    return journal(k);
  }
  async function physical(k){
    const before=await protectedContext(queryFor(k),{captureAuthority:true});
    const receipt=await readCheckpointGitPhysical({context:before.context,gitExecutable:pins.git_executable,
      gitExecutableSha256:pins.git_executable_sha256,journalRoot:pins.journal_root,readProtectedJson,verifyStorage});
    const after=await protectedContext(queryFor(k),{captureAuthority:true});
    if(!same(before,after))fail('reconciliation_authority_changed');
    return {receipt,authority:before.authority,context:before.context};
  }
  const unknown=(query,k,state)=>result(query,'SQL_FINALIZE_UNKNOWN',{checkpoint_id:k.checkpoint_id,
    ...(state.intent?{git_receipt:state.intent.receipt}:{})});
  const committed=(query,stored)=>result(query,stored.state,{commit:stored,successor_admitted:stored.successor_admitted});
  function eligibility(query,k,proof,state){
    const receipt=proof.receipt;
    return result(query,'GIT_COMMITTED_SQL_NOT_ATTEMPTED',{checkpoint_id:k.checkpoint_id,git_readback:receipt,
      reconciliation:{schema:'metaengine.native-coding.checkpoint-reconciliation.v1',state:'FIRST_SQL_FINALIZATION_ELIGIBLE',
        operation:'RECONCILE_FINISH_CHECKPOINT',...query,checkpoint_id:k.checkpoint_id,
        writer_task_id:k.writer_task_id,writer_lease_generation:k.writer_lease_generation,
        critic_task_id:k.critic_task_id,critic_lease_generation:k.critic_lease_generation,
        git_receipt_sha256:sha(receipt),operator_sha256:operator.sha256,
        sql_journal_identity_sha256:state.anchor.identities.sql_checkpoint,
        sql_intent_state:'ABSENT',sql_commit_state:'ABSENT',physical_git_readback_verified:true,current_authority_verified:true,
        observation_only:true,git_effect_allowed:false,sql_retry_allowed:false,successor_admitted:false,...flags}});
  }
  async function read(query){
    const k=await checkpoint(query),stored=await sqlReadback(k);if(stored)return committed(query,stored);
    const state=await journal(k);if(state.present)return unknown(query,k,state);
    const proof=await physical(k),git=proof.receipt;
    if(git.state==='COMMITTED'){
      if(!state.anchor)return result(query,'GIT_READBACK_REQUIRED',{checkpoint_id:k.checkpoint_id,reason:'SQL_JOURNAL_PROVENANCE_UNKNOWN',git_readback:git});
      await verifiedGit(git,k);const current=await journal(k);if(current.present)return unknown(query,k,current);
      const completed=await sqlReadback(k);if(completed)return committed(query,completed);
      return eligibility(query,k,proof,current);
    }
    return result(query,'PENDING_COMMIT',{checkpoint_id:k.checkpoint_id,git_readback:git});
  }
  async function firstSql(query,k,proof){
    const state=await journal(k);if(state.present)return unknown(query,k,state);
    if(!state.anchor)fail('sql_journal_provenance_unknown');
    const stored=await sqlReadback(k);if(stored)return committed(query,stored);
    const current=await physical(k);
    if(current.receipt.state!=='COMMITTED'||!same(current,proof))fail('reconciliation_proof_changed');
    await verifiedGit(current.receipt,k);await verifyAnchor(k,state.anchor);await unchangedOperator();
    const gitReceipt=current.receipt,intent={schema:'metaengine.native-coding.sql-commit-intent.v1',
      checkpoint_sha256:sha(k),operator_sha256:operator.sha256,receipt:gitReceipt,
      canonical_receipt:json(gitReceipt),receipt_sha256:sha(gitReceipt)};
    try{await durable(state.file,intent);}catch(error){if(error.code==='EEXIST')return read(query);throw error;}
    // Only the live winner of exclusive creation may invoke SQL, and only
    // after intent durability and a final physical/authority check. Neither a
    // matching existing intent nor an absent SQL row authorizes a second call.
    let acknowledged=false;
    try{
      const saved=await journal(k);if(!same(saved.intent,intent)||!same(saved.anchor,state.anchor))fail('sql_intent_changed');
      const finalProof=await physical(k);if(!same(finalProof,current))fail('reconciliation_proof_changed');
      await sql.begin('isolation level serializable',async tx=>{
        await owner(tx);await tx.unsafe('set local synchronous_commit=on');await unchangedOperator();
        await tx.unsafe('select destruktion_meta.native_coding_finish_checkpoint_v1($1::uuid,$2::text::jsonb,$2::text,$3::text) as value',
          [k.checkpoint_id,intent.canonical_receipt,intent.receipt_sha256]);
      });acknowledged=true;
    }catch{}
    let confirmed=null;try{confirmed=await sqlReadback(k);}catch{}
    if(!confirmed)return result(query,'SQL_FINALIZE_UNKNOWN',{checkpoint_id:k.checkpoint_id,git_receipt:gitReceipt,sql_acknowledged:acknowledged});
    if(!same(confirmed.receipt,gitReceipt))fail('sql_receipt_changed');
    return committed(query,confirmed);
  }
  async function reconcile(query){
    const k=await checkpoint(query),stored=await sqlReadback(k);if(stored)return committed(query,stored);
    const state=await journal(k);if(state.present)return unknown(query,k,state);
    if(!state.anchor)return result(query,'GIT_READBACK_REQUIRED',{checkpoint_id:k.checkpoint_id,reason:'SQL_JOURNAL_PROVENANCE_UNKNOWN'});
    const proof=await physical(k);
    if(proof.receipt.state!=='COMMITTED')return result(query,'GIT_READBACK_REQUIRED',{checkpoint_id:k.checkpoint_id,git_readback:proof.receipt});
    return firstSql(query,k,proof);
  }
  return Object.freeze({
    async READ_FINISH_CHECKPOINT(request){open();return read(select(request));},
    async RECONCILE_FINISH_CHECKPOINT(request){open();return reconcile(select(request));},
    async FINISH_CHECKPOINT(request){
      const query=select(request),k=await checkpoint(query),stored=await sqlReadback(k);if(stored)return committed(query,stored);
      let state=await journal(k);if(state.present)return unknown(query,k,state);
      if(!state.anchor){
        const initial=await physical(k);
        if(initial.receipt.state!=='NOT_ATTEMPTED')return result(query,'GIT_READBACK_REQUIRED',{
          checkpoint_id:k.checkpoint_id,reason:'SQL_JOURNAL_PROVENANCE_UNKNOWN',git_readback:initial.receipt});
        state=await prepareJournal(k);if(state.present)return unknown(query,k,state);
      }
      // An ordinary FINISH racing the narrow reconciliation must also avoid
      // the older Git finalizer once a completion file exists. Even malformed
      // completion evidence is a readback failure, never a Git repair grant.
      if((await optionalJson(path.join(journalPaths(k).git_checkpoint,'completed.json'))).present){
        const proof=await physical(k);
        if(proof.receipt.state!=='COMMITTED')fail('git_receipt_unverified');
        return firstSql(query,k,proof);
      }
      let gitReceipt=await committer.COMMIT_CHECKPOINT(queryFor(k));
      if(['COMMITTED_INDEX_PENDING','COMMITTED_RECEIPT_PENDING'].includes(gitReceipt.state))gitReceipt=await committer.RECONCILE_COMMIT(queryFor(k));
      if(gitReceipt.state!=='COMMITTED')return result(query,'GIT_READBACK_REQUIRED',{checkpoint_id:k.checkpoint_id,git_readback:gitReceipt});
      await verifiedGit(gitReceipt,k);
      const proof=await physical(k);if(!same(proof.receipt,gitReceipt))fail('git_receipt_changed');
      return firstSql(query,k,proof);
    },
    close(){closed=true;committer.close();},
  });
}
