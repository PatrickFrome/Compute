import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {assertNativeCodingHostRequestOpen,joinNativeCodingHostReads} from '../native-coding-host-request-lifetime.mjs';

// Generated SQL/OS observers exercise the real private readers. Neither this
// max:1 pool nor the VM's Windows observations are physical execution proof.
export function createSingleConnectionPool(query) {
  if(typeof query!=='function')throw Error('fixture_query_required');
  const calls=[],waiting=[],stats={active:0,maxActive:0,activeTransactions:0,
    rootAcquisitions:0,nestedRootAcquisitions:0};
  let held=false;
  function release(){
    stats.active=0;held=false;
    const next=waiting.shift();
    if(next){clearTimeout(next.timer);next.grant();}
  }
  function acquire(nested=false){
    return new Promise((resolve,reject)=>{
      const entry={grant(){held=true;stats.active=1;stats.maxActive=Math.max(stats.maxActive,stats.active);resolve(release);},timer:null};
      if(!held)return entry.grant();
      waiting.push(entry);
      if(nested)entry.timer=setTimeout(()=>{
        const index=waiting.indexOf(entry);if(index!==-1)waiting.splice(index,1);
        reject(Error('fixture_nested_root_acquisition_timeout'));
      },100);
    });
  }
  const run=async(text,args=[],route)=>{
    calls.push({text,args,route});return query(text,args,route);
  };
  const sql={
    async unsafe(text,args=[]){
      const nested=stats.activeTransactions>0;
      stats.rootAcquisitions++;if(nested)stats.nestedRootAcquisitions++;
      const done=await acquire(nested);
      try{return await run(text,args,'root');}finally{done();}
    },
    async begin(mode,callback){
      if(typeof mode==='function'){callback=mode;mode='';}
      calls.push({mode});
      const done=await acquire();stats.activeTransactions++;
      const tx={unsafe:(text,args=[])=>run(text,args,'transaction')};
      try{return await callback(tx);}finally{stats.activeTransactions--;done();}
    },
  };
  return {sql,stats,calls,assertIdle(){
    assert.equal(stats.activeTransactions,0);assert.equal(stats.active,0);
    assert.equal(waiting.length,0);assert.equal(stats.maxActive<=1,true);
  }};
}

export async function createPhysicalScopeReaders({sql,permit,host,worktree=permit.worktree,git=null,sandbox=null}) {
  const source=await fs.readFile(new URL('../native-coding-host-os-scope.mjs',import.meta.url),'utf8');
  const start=source.indexOf('  async function postgres('),end=source.indexOf('  function journalPath(');
  assert.ok(start>0&&end>start,'evaluate the exact production physical-reader functions');
  const pg=structuredClone(permit.postgres),artifact=structuredClone(permit.artifact),userSid=permit.user_sid;
  const currentHost=()=>host.current??host;
  const resources=path.resolve('C:/METAENGINE/fixture-install/resources');
  const expectedExe=path.join(path.dirname(resources),'METAENGINE Browser Test.exe');
  const config={bundle_directory:path.join(resources,'client-state-runtime'),state_directory:path.resolve('C:/METAENGINE/fixture-state'),
    pg_data_directory:path.resolve('C:/METAENGINE/fixture-pg'),inspect_database_url:'postgresql://127.0.0.1:55432/fixture',
    expected_cluster_system_identifier:pg.system_identifier,expected_bundle_sha256:artifact.runtime_bundle_sha256};
  const operator={cli_executable:path.resolve('C:/METAENGINE/fixture-cli/codex.exe'),git_executable:path.resolve('C:/METAENGINE/fixture-git/git.exe')};
  const pgRow={data_directory:config.pg_data_directory,version:170006,address:'127.0.0.1',port:55432,system_identifier:pg.system_identifier};
  const pidText=[pg.postmaster.pid,config.pg_data_directory,Math.floor(Date.parse(pg.postmaster.created_at)/1000),55432,'','127.0.0.1','ready',''].join('\n');
  const fileHashes=new Map([[expectedExe,artifact.installed_exe_sha256],[path.join(resources,'app.asar'),artifact.installed_asar_sha256],
    [operator.cli_executable,artifact.cli_executable_sha256]]);
  // vm contexts do not inherit Node's structuredClone host global. Supply the
  // real primitive used by the production reader, without replacing its logic.
  const scope={assertNativeCodingHostRequestOpen,joinNativeCodingHostReads,sql,config,resources,expectedExe,parentPid:currentHost().pid,path,URL,Date,Number,Promise,structuredClone,
    process:{env:{SystemRoot:'C:/Windows'}},fs:{readFile:async()=>pidText},
    fail:reason=>{throw Error('native_coding_host_os_'+reason);},
    samePath:(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase(),
    publicProcess:value=>({pid:value.pid,created_at:value.created_at,process_incarnation_id:value.process_incarnation_id}),
    readNativeCodingWindowsProcess:async pid=>pid===pg.postmaster.pid?{...pg.postmaster,exe_path:path.resolve('C:/METAENGINE/fixture-pg-bin/postgres.exe')}:
      {...currentHost(),exe_path:expectedExe,user_sid:userSid},
    readDirectoryIdentity:async directory=>directory===config.pg_data_directory?pg.data_directory_identity_sha256:worktree.root_identity_sha256,
    readNativeCodingOperatorPaths:async()=>operator,
    image:{prepare:async()=>{},read:async file=>fileHashes.get(file)},
    run:async()=>({stdout:worktree.base_sha}),
    readNativeCodingGitProof:async()=>structuredClone(git?.current??git??{head:worktree.base_sha,artifact_sha256:'a'.repeat(64)}),
    resolveNativeCodingSandboxPin:()=>({}),readNativeCodingSandboxEvidence:async()=>structuredClone(sandbox?.current??sandbox),
  };
  const readers=vm.runInNewContext(source.slice(start,end)+'\n({readNativeScope,readCheckpointScope})',scope);
  // Keep execution and arguments exact; only normalize the returned VM object
  // prototypes for the production canonical-JSON gate in the importing realm.
  const readNativeScope=async(...args)=>structuredClone(await readers.readNativeScope(...args));
  const readCheckpointScope=async(...args)=>structuredClone(await readers.readCheckpointScope(...args));
  if(typeof readers.readNativeScope.prepare==='function')
    Object.defineProperty(readNativeScope,'prepare',{value:(...args)=>readers.readNativeScope.prepare(...args)});
  return {readNativeScope,readCheckpointScope,pgRow};
}
