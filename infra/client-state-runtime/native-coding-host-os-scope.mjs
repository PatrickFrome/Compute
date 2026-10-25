import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readDirectoryIdentity} from './native-coding-fs-identity.mjs';
import {nativeCodingCanonicalJson} from './native-coding-task-context.mjs';
import {readNativeCodingGitProof} from '../../apps/metaengine-browser/src/native-coding-git-proof.mjs';
import {readNativeCodingWindowsProcess,readNativeCodingProtectedJson,readNativeCodingSandboxEvidence}
  from '../../apps/metaengine-browser/src/native-coding-host-observers.mjs';
import {readNativeCodingOperatorPaths} from '../../apps/metaengine-browser/src/native-coding-operator-paths.mjs';
export {readNativeCodingOperatorPaths};

const run=promisify(execFile);
const fail=reason=>{throw new Error('native_coding_host_os_'+reason);};
const samePath=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const publicProcess=x=>({pid:x.pid,created_at:x.created_at,process_incarnation_id:x.process_incarnation_id});
async function fileHash(file) {
  const actual=await fs.realpath(file),before=await fs.lstat(file);
  if(!samePath(file,actual)||!before.isFile()||before.isSymbolicLink()||before.nlink!==1
      ||before.size<1||before.size>1024*1024*1024) fail('file_unverified');
  const hash=createHash('sha256');for await(const bytes of createReadStream(actual)) hash.update(bytes);
  const after=await fs.lstat(file);
  if(before.dev!==after.dev||before.ino!==after.ino||before.mtimeMs!==after.mtimeMs||before.size!==after.size) fail('file_changed');
  return hash.digest('hex');
}

// This private descriptor contains paths and canary digest pins, never DB
// credentials or execution permissions. The own-PG permit remains authority.

// Created only by the verified runtime Host, from its protected config and
// already-open state_owner connection. No caller-selected DSN/path enters it.
export function createNativeCodingHostOsScope({config,sql,parentPid=process.ppid}={}) {
  if(!config||typeof sql?.unsafe!=='function'||!Number.isSafeInteger(parentPid)||parentPid<1) fail('private_dependencies_required');
  async function postgres() {
    const before=(await fs.readFile(path.join(config.pg_data_directory,'postmaster.pid'),'utf8')).split(/\r?\n/);
    const rows=await sql.unsafe(`select current_setting('data_directory') as data_directory,
      current_setting('server_version_num')::int as version,host(inet_server_addr()) as address,inet_server_port() as port,
      (select system_identifier::text from pg_catalog.pg_control_system()) as system_identifier`);
    const row=rows[0],native=await readNativeCodingWindowsProcess(Number(before[0]));
    if(rows.length!==1||row.version<170000||row.version>=180000||row.address!=='127.0.0.1'
        ||row.port!==Number(new URL(config.inspect_database_url).port)
        ||!samePath(row.data_directory,config.pg_data_directory)||!samePath(before[1],config.pg_data_directory)
        ||row.system_identifier!==config.expected_cluster_system_identifier
        ||path.basename(native.exe_path).toLowerCase()!=='postgres.exe'
        ||Math.abs(Date.parse(native.created_at)-Number(before[2])*1000)>1000) fail('postgres_incarnation_unverified');
    const data_directory_identity_sha256=await readDirectoryIdentity(config.pg_data_directory);
    if((await fs.readFile(path.join(config.pg_data_directory,'postmaster.pid'),'utf8')).split(/\r?\n/).slice(0,4).join('\n')!==before.slice(0,4).join('\n')) fail('postgres_changed');
    return {system_identifier:row.system_identifier,postmaster:publicProcess(native),data_directory_identity_sha256};
  }
  async function readNativeScope(permit,includeSandbox=true) {
    const pg=await postgres(),host=await readNativeCodingWindowsProcess(parentPid);
    const base={postgres:pg,host_process:publicProcess(host),user_sid:host.user_sid};
    if(permit===null) return base;
    const operator=await readNativeCodingOperatorPaths(config.state_directory);
    if(path.basename(host.exe_path)!=='METAENGINE Browser Test.exe') fail('browser_parent_unverified');
    const resources=path.join(path.dirname(host.exe_path),'resources');
    const expectedBundle=path.join(resources,'client-state-runtime');
    if(!samePath(config.bundle_directory,expectedBundle)) fail('installed_runtime_path_mismatch');
    const artifact={installed_exe_sha256:await fileHash(host.exe_path),
      installed_asar_sha256:await fileHash(path.join(resources,'app.asar')),
      runtime_bundle_sha256:config.expected_bundle_sha256,source_sha:permit.artifact.source_sha,
      cli_executable_sha256:await fileHash(operator.cli_executable)};
    // Source SHA is meaningful only together with the exact protected ASAR
    // hash and verified runtime bundle; it is never accepted on its own.
    if(Object.keys(artifact).some(key=>artifact[key]!==permit.artifact[key])) fail('installed_artifact_mismatch');
    const root_identity_sha256=await readDirectoryIdentity(permit.worktree.path);
    const pending=run(operator.git_executable,['-c','core.fsmonitor=false','-C',permit.worktree.path,'rev-parse','--verify','HEAD'],
      {windowsHide:true,shell:false,timeout:10000,maxBuffer:4096,env:{SystemRoot:process.env.SystemRoot,PATH:path.dirname(operator.git_executable),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'NUL',GIT_TERMINAL_PROMPT:'0'}});
    pending.child?.stdin?.end();const head=(await pending).stdout.trim();
    const worktree={path:permit.worktree.path,root_identity_sha256,base_sha:head};
    if(!includeSandbox)return {...base,artifact,worktree};
    const sandbox=await readNativeCodingSandboxEvidence({pin:operator.sandbox_receipts[permit.role],cliPath:operator.cli_executable,
      worktreePath:permit.worktree.path,role:permit.role,hostProcessId:parentPid});
    return {...base,artifact,worktree,sandbox};
  }
  // Acceptance reads physical current bytes and current Host identity without
  // manufacturing a fresh launch proof for a historical worker/canary.
  async function readCheckpointScope(permit) {
    const current=await readNativeScope(permit,false);
    const operator=await readNativeCodingOperatorPaths(config.state_directory);
    const env={SystemRoot:process.env.SystemRoot,PATH:path.dirname(operator.git_executable),
      GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'NUL',GIT_TERMINAL_PROMPT:'0'};
    const git=await readNativeCodingGitProof(permit.worktree.path,{env,gitExecutable:operator.git_executable});
    if(git.head!==current.worktree.base_sha)fail('checkpoint_worktree_changed');
    return {...current,git};
  }
  function journalPath(operator,scope,permit,name) {
    const key=createHash('sha256').update(JSON.stringify({task_id:scope.task_id,lease_generation:scope.lease_generation,role:permit.role})).digest('hex');
    return path.join(operator.journal_root,key,name);
  }
  async function readNativeWorker(pid,{scope,permit,job}) {
    const operator=await readNativeCodingOperatorPaths(config.state_directory),worker=await readNativeCodingWindowsProcess(pid);
    if(!samePath(worker.exe_path,operator.cli_executable)||await fileHash(worker.exe_path)!==permit.artifact.cli_executable_sha256) fail('worker_executable_mismatch');
    const {value:receipt}=await readNativeCodingProtectedJson(journalPath(operator,scope,permit,'process.json'));
    if(receipt.task_id!==scope.task_id||receipt.lease_generation!==scope.lease_generation||receipt.agent_id!==scope.agent_id
      ||receipt.process_incarnation_id!==worker.process_incarnation_id||receipt.pid!==pid||receipt.run_id!==job.payload.run_id
      ||receipt.process?.started_suspended!==true||receipt.process?.tree_control_bound!==true
      ||receipt.process?.job_bound_before_resume!==true||receipt.process?.process_tree_control!=='WINDOWS_JOB_OBJECT'
      ||receipt.executable_sha256!==permit.artifact.cli_executable_sha256) fail('suspended_worker_unverified');
    const after=await readNativeCodingWindowsProcess(pid);
    if(after.process_incarnation_id!==worker.process_incarnation_id||after.user_sid!==worker.user_sid||!samePath(after.exe_path,worker.exe_path)) fail('worker_changed');
    return {...worker,job_id:receipt.process.job_id,run_id:receipt.run_id,prompt_sha256:receipt.prompt_sha256};
  }
  async function readProtectedReceipt({scope,permit}) {
    const operator=await readNativeCodingOperatorPaths(config.state_directory);
    const receipt=(await readNativeCodingProtectedJson(journalPath(operator,scope,permit,'receipt.json'))).value;
    const result=await readNativeCodingProtectedJson(journalPath(operator,scope,permit,'result.json'),{maximumBytes:128*1024});
    if(result.sha256!==receipt.result_sha256||nativeCodingCanonicalJson(result.value)!==nativeCodingCanonicalJson(receipt.result)) fail('result_bytes_mismatch');
    return receipt;
  }
  return Object.freeze({readNativeScope,readNativeWorker,readProtectedReceipt,readCheckpointScope});
}
