import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readDirectoryIdentity} from '../native-coding-fs-identity.mjs';
import {readNativeCodingGitProof} from '../../../apps/metaengine-browser/src/native-coding-git-proof.mjs';
import {readNativeCodingGitCommitOperator,NATIVE_CODING_GIT_COMMIT_OPERATOR_FILE} from '../native-coding-git-commit-operator.mjs';

const execute=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
// Generated test workspace only. This helper supplies REAL Git objects/ref/
// index and physical directory identity; it makes no installed/OS/ACL claim.
export async function createNativeCodingCommitGitFixture(t){
  const parent=await fs.realpath(os.tmpdir()),directory=await fs.mkdtemp(path.join(parent,'native-git-pg-commit-'));
  t.after(async()=>{const actual=await fs.realpath(directory),relative=path.relative(parent,actual);
    assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(actual).startsWith('native-git-pg-commit-'));
    await fs.rm(actual,{recursive:true,force:false});});
  const root=path.join(directory,'managed-writer'),repository=path.join(directory,'repository'),journalRoot=path.join(directory,'private-journal');
  const executable=path.resolve(process.env.METAENGINE_GIT_TEST_EXECUTABLE||(process.platform==='win32'?'C:/Program Files/Git/bin/git.exe':'/usr/bin/git'));
  const executableSha256=hash(await fs.readFile(executable));
  const env={SystemRoot:process.env.SystemRoot,PATH:path.dirname(executable),GIT_CONFIG_NOSYSTEM:'1',
    GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'};
  const git=async(args,{cwd=root,encoding='utf8'}={})=>(await execute(executable,['-c','core.fsmonitor=false','-C',cwd,...args],
    {env,encoding,windowsHide:true,timeout:30000,maxBuffer:4*1024*1024})).stdout;
  await fs.mkdir(repository);await git(['init','--quiet','--initial-branch=main'],{cwd:repository});
  for(const [key,value] of [['user.name','Disposable Git-PG fixture'],['user.email','fixture@example.invalid'],['core.autocrlf','false'],['core.filemode','false']])
    await git(['config',key,value],{cwd:repository});
  await fs.writeFile(path.join(repository,'reviewed.txt'),'baseline\n');await fs.writeFile(path.join(repository,'removed.txt'),'old\n');
  await git(['add','--all'],{cwd:repository});await git(['commit','--quiet','-m','Generated baseline'],{cwd:repository});
  await git(['worktree','add','--quiet','-b','managed-checkpoint',root],{cwd:repository});await git(['worktree','lock',root],{cwd:repository});
  const before=await readNativeCodingGitProof(root,{env,gitExecutable:executable});assert.equal(before.clean,true);
  await fs.writeFile(path.join(root,'reviewed.txt'),'exact reviewed current bytes\n');await fs.unlink(path.join(root,'removed.txt'));
  await fs.writeFile(path.join(root,'binary.bin'),Buffer.from([0,255,14,10]));
  const proof=await readNativeCodingGitProof(root,{env,gitExecutable:executable});assert.equal(proof.clean,false);
  const gitDir=path.resolve((await git(['rev-parse','--absolute-git-dir'])).trim()),commonDir=path.resolve(root,(await git(['rev-parse','--git-common-dir'])).trim());
  const managed_worktree={path:root,root_identity_sha256:await readDirectoryIdentity(root),branch_ref:'refs/heads/managed-checkpoint',
    git_dir_identity_sha256:await readDirectoryIdentity(gitDir),common_dir_identity_sha256:await readDirectoryIdentity(commonDir)};
  const readProtectedJson=async file=>{
    const stat=await fs.lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1);
    assert.equal(path.resolve(await fs.realpath(file)).toLowerCase(),path.resolve(file).toLowerCase());
    const bytes=await fs.readFile(file);return{value:JSON.parse(bytes),sha256:hash(bytes)};
  };
  const storageAdapters={readProtectedJson,
    readOperator:directory=>readNativeCodingGitCommitOperator(directory,{readProtectedJson}),
    protectStorage:async directory=>fs.chmod(directory,0o700),verifyStorage:async()=>({owner_dacl_verified:false})};
  async function registerOperator({stateDirectory,project_id,workspace_id}){
    await fs.mkdir(stateDirectory,{recursive:true,mode:0o700});
    const descriptor={schema:'metaengine.native-coding.git-commit-operator.v1',registry_id:randomUUID(),generation:1,
      git_executable:executable,git_executable_sha256:executableSha256,journal_root:journalRoot,
      bindings:[{project_id,workspace_id,...managed_worktree}],model_paths_allowed:false,production_qualified:false,authority_effect:false};
    await fs.writeFile(path.join(stateDirectory,NATIVE_CODING_GIT_COMMIT_OPERATOR_FILE),JSON.stringify(descriptor),{flag:'wx',mode:0o600});
    return descriptor;
  }
  return{directory,root,repository,journalRoot,gitDir,commonDir,gitExecutable:executable,gitExecutableSha256:executableSha256,
    before,proof,managed_worktree,git,registerOperator,storageAdapters,
    readProof:()=>readNativeCodingGitProof(root,{env,gitExecutable:executable})};
}
