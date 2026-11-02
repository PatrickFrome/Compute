import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {captureOfflineRuntimeInventory,stageOfflineRuntimeBundle,verifyOfflineRuntimeBundle,readVerifiedOfflineRuntimePackage} from './offline-runtime-bundle.mjs';
import {sourceClosure} from './startup-source-manifest.mjs';
import {PRIVATE_NATIVE_TOOL_REQUIRED_FILES,privateNativeToolsBinding,resolvePrivateNativeTools,assertPrivateNativeToolsCapability} from '../../apps/metaengine-browser/src/private-native-tools-core.mjs';

// Generated inert inventories and simulated OS/ACL/SQL observations only.
// No fixture EXE, PowerShell, Git, PostgreSQL, network or model is executed.
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const repo=await fs.realpath(fileURLToPath(new URL('../../',import.meta.url)));
const {buildOfflineRuntimeBinding}=createRequire(import.meta.url)('../../apps/metaengine-browser/scripts/offline-runtime-package-binding.cjs');
const origins={
  node:{version:'24.21.0',url:'https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip',archive_sha256:'a'.repeat(64)},
  deno:{version:'2.9.7',url:'https://github.com/denoland/deno/releases/download/v2.9.7/deno-x86_64-pc-windows-msvc.zip',archive_sha256:'b'.repeat(64)},
  postgresql:{version:'17.11.0',url:'https://get.enterprisedb.com/postgresql/postgresql-17.11-1-windows-x64-binaries.zip',archive_sha256:'c'.repeat(64)},
};
const head='1'.repeat(40);
async function fixture(t,{bound=true}={}){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'generated-native-binding-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const put=async(name,bytes)=>{const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);return file;};
  const resources=path.join(root,'install/resources'),toolsRoot=path.join(resources,'private-native-tools');
  const components=[];
  for(const [id,entrypoint]of [['git','ucrt64/bin/git.exe'],['codex','bin/codex.exe']]){
    const extra=id==='git'?['ucrt64/libexec/git-core/git-helper','ucrt64/etc/ssl/cert.pem','ucrt64/etc/ssl/openssl.cnf','ucrt64/lib/ossl-modules/legacy.dll']:[];
    const files=[];
    for(const name of [...PRIVATE_NATIVE_TOOL_REQUIRED_FILES[id],...extra].sort()){
      const bytes=Buffer.from('generated inert '+id+'/'+name+'\n');
      await put('install/resources/private-native-tools/'+id+'/'+name,bytes);
      files.push({path:name,bytes:bytes.length,sha256:sha(bytes)});
    }
    components.push({id,version:id==='git'?'2.56.0.4':'0.166.0',repository:id==='git'?'git-for-windows/git':'openai/codex',
      tag:'generated',release_id:1,asset_id:2,archive_name:id+'.zip',archive_sha256:'d'.repeat(64),archive_bytes:1,entrypoint,files});
  }
  const toolsBytes=Buffer.from(JSON.stringify({schema:'metaengine.private-native-tools.v1',platform:'win32',arch:'x64',components}));
  await put('install/resources/private-native-tools/manifest.json',toolsBytes);
  const toolsBinding=privateNativeToolsBinding(toolsBytes);
  const entries=['infra/client-state-runtime/runtime-host.mjs','infra/client-state-runtime/fresh-pg17-initdb.mjs','apps/metaengine-browser/src/remote-support-mcp.mjs'];
  const files=[];
  // Copy project source as data for the real checkout-byte agreement test.
  for(const name of [...entries,'apps/metaengine-browser/src/private-native-tools-core.mjs']){
    const bytes=await fs.readFile(path.join(repo,name));await put('inputs/source/'+name,bytes);
    files.push({path:name,kind:'source',bytes:bytes.length,sha256:sha(bytes)});
  }
  const sourceBody={schema:'compute.runtime-source-bundle.v1',reviewed_startup_source_sha256:'e'.repeat(64),
    reviewed_startup_files_sha256:'f'.repeat(64),entry_points:entries,files,
    policy:{database_included:false,private_config_included:false,credentials_included:false}};
  const sourceManifest={...sourceBody,bundle_sha256:sha(JSON.stringify(sourceBody))};
  await put('inputs/source/runtime-source-bundle.json',JSON.stringify(sourceManifest));
  await put('inputs/node/node.exe','generated inert Node bytes');
  await put('inputs/node/LICENSE','Copyright Node.js generated fixture\n'.repeat(30));
  const denoExecutable=await put('inputs/deno/deno.exe','generated inert Deno bytes');
  await put('inputs/licenses/deno-LICENSE.txt','Copyright Deno generated fixture\n'.repeat(30));
  await put('inputs/licenses/postgresql-COPYRIGHT.txt','Copyright PostgreSQL generated fixture\n'.repeat(30));
  for(const name of ['postgres','psql','initdb','pg_ctl','pg_config'])await put('inputs/pg/bin/'+name+'.exe','generated inert '+name);
  await put('inputs/pg/share/postgres.bki','generated inert schema placeholder');
  await put('inputs/pg/lib/plpgsql.dll','generated inert extension bytes');
  await put('inputs/cache/npm/registry.npmjs.org/postgres/3.4.7/package.json',JSON.stringify({name:'postgres',version:'3.4.7'}));
  const sources={sourceBundleDirectory:path.join(root,'inputs/source'),nodeDirectory:path.join(root,'inputs/node'),
    postgresDirectory:path.join(root,'inputs/pg'),denoExecutable,denoNpmDirectory:path.join(root,'inputs/cache/npm'),licenseDirectory:path.join(root,'inputs/licenses')};
  const options={sources,sourceBundleDigest:sourceManifest.bundle_sha256,componentOrigins:origins};
  const inventory=await captureOfflineRuntimeInventory({...options,...(bound?{privateNativeToolsBinding:toolsBinding}:{})});
  const bundle=path.join(resources,'client-state-runtime');await fs.mkdir(bundle);
  const manifest=await stageOfflineRuntimeBundle({stagingDirectory:bundle,sources,inventory,expectedInventoryDigest:inventory.inventory_sha256});
  const verified=await verifyOfflineRuntimeBundle({bundleDirectory:bundle,expectedBundleDigest:manifest.bundle_sha256});
  const exeBytes=Buffer.from('generated inert Browser bytes'),asarBytes=Buffer.from('generated inert ASAR bytes');
  const exe=await put('install/METAENGINE Browser Test.exe',exeBytes);await put('install/resources/app.asar',asarBytes);
  const state=path.join(root,'state'),pgData=path.join(state,'pgdata');
  const config={bundle_directory:bundle,expected_bundle_sha256:manifest.bundle_sha256,state_directory:state,pg_data_directory:pgData,
    inspect_database_url:'postgres://generated@127.0.0.1:5541/generated',expected_cluster_system_identifier:'123456789'};
  await put('state/pgdata/postmaster.pid','71\n'+pgData+'\n1700000000\n5541\n');
  const pin=role=>({path:path.join(state,'sandbox',role+'.json'),sha256:'a'.repeat(64)});
  const operator={schema:'metaengine.native-coding.operator-paths.v1',cli_executable:path.join(toolsRoot,'codex/bin/codex.exe'),
    git_executable:path.join(toolsRoot,'git/ucrt64/bin/git.exe'),codex_home:path.join(state,'codex-home'),journal_root:path.join(state,'journal'),
    worker_temp_root:path.join(state,'worker-temp'),result_index_root:path.join(state,'result-index'),sandbox_receipts:{IMPLEMENTER:pin('IMPLEMENTER'),CRITIC:pin('CRITIC')}};
  await put('state/native-coding-operator-v1.json',JSON.stringify(operator));
  await fs.mkdir(operator.codex_home);await fs.mkdir(path.join(state,'worktree'));
  await put('state/sandbox/IMPLEMENTER.json','{"generated":true}');await put('state/sandbox/CRITIC.json','{"generated":true}');
  const permit={role:'IMPLEMENTER',provider_id:'00000000-0000-4000-8000-000000000002',worktree:{path:path.join(state,'worktree'),base_sha:head},
    artifact:{installed_exe_sha256:sha(exeBytes),installed_asar_sha256:sha(asarBytes),runtime_bundle_sha256:manifest.bundle_sha256,
      source_sha:head,cli_executable_sha256:components.find(c=>c.id==='codex').files.find(row=>row.path==='bin/codex.exe').sha256}};
  const scope={task_id:'00000000-0000-4000-8000-000000000001',lease_generation:1};
  const key=sha(JSON.stringify({...scope,role:permit.role})),result={generated:'retained diagnostic only'},resultBytes=Buffer.from(JSON.stringify(result));
  const receipt={...scope,role:permit.role,worktree_path:permit.worktree.path,base_sha:head,executable_sha256:permit.artifact.cli_executable_sha256,
    result,result_sha256:sha(resultBytes)};
  await put('state/journal/'+key+'/result.json',resultBytes);await put('state/journal/'+key+'/receipt.json',JSON.stringify(receipt));
  const sql={unsafe:async()=>[{data_directory:pgData,version:170000,address:'127.0.0.1',port:5541,system_identifier:'123456789'}]};
  return {root,put,resources,toolsRoot,toolsBytes,toolsBinding,sources,options,bundle,manifest,verified,exe,config,operator,permit,scope,receipt,sql};
}

test('generated bundle binds metadata and real build binding requires exact ASAR agreement',async t=>{
  const f=await fixture(t);
  assert.deepEqual(f.manifest.private_native_tools,f.toolsBinding);
  const options={bundleDirectory:f.bundle,repoRoot:repo,sourceHead:head,packageVersion:'1.0.0-dev.1.1'};
  const binding=await buildOfflineRuntimeBinding({...options,privateToolsBinding:f.toolsBinding});
  assert.equal(binding.bundle_sha256,f.manifest.bundle_sha256);
  await assert.rejects(buildOfflineRuntimeBinding(options),/private_native_tools_binding_mismatch/);
  await assert.rejects(buildOfflineRuntimeBinding({...options,privateToolsBinding:{...f.toolsBinding,file_count:f.toolsBinding.file_count+1}}),/private_native_tools_binding_mismatch/);
  const forged={...f.manifest,private_native_tools:{...f.toolsBinding,manifest_sha256:'0'.repeat(64)}};
  await fs.writeFile(path.join(f.bundle,'offline-runtime-bundle.json'),JSON.stringify(forged));
  await assert.rejects(verifyOfflineRuntimeBundle({bundleDirectory:f.bundle,expectedBundleDigest:f.manifest.bundle_sha256}),/offline_bundle_digest_mismatch/);
});

test('binding inputs and successful verifier snapshots are captured before caller mutation',async t=>{
  const f=await fixture(t),input={...f.toolsBinding};
  const pending=resolvePrivateNativeTools({toolsRoot:f.toolsRoot,binding:input});input.manifest_sha256='0'.repeat(64);
  const tools=await pending;assertPrivateNativeToolsCapability(tools);
  assert.throws(()=>assertPrivateNativeToolsCapability({...tools}),/capability_required/);
  const metadata={...f.toolsBinding};
  const inventoryPending=captureOfflineRuntimeInventory({...f.options,privateNativeToolsBinding:metadata});metadata.file_count++;
  assert.deepEqual((await inventoryPending).private_native_tools,f.toolsBinding);
  const captured=readVerifiedOfflineRuntimePackage(f.verified);
  f.verified.manifest.private_native_tools.manifest_sha256='0'.repeat(64);
  assert.deepEqual(captured.privateNativeToolsBinding,f.toolsBinding);
  assert.ok(Object.isFrozen(captured));assert.ok(Object.isFrozen(captured.privateNativeToolsBinding));
  assert.throws(()=>readVerifiedOfflineRuntimePackage(structuredClone(f.verified)),/verified_result_required/);
});

test('actual Host source closure includes only the Node-safe tools implementation',async t=>{
  const closure=await sourceClosure([path.join(repo,'infra/client-state-runtime/runtime-host.mjs')],repo);
  assert.ok(closure.files.includes(path.join(repo,'apps/metaengine-browser/src/private-native-tools-core.mjs')));
  assert.ok(!closure.files.includes(path.join(repo,'apps/metaengine-browser/src/private-native-tools.mjs')));
  const catalog=await fs.readFile(path.join(repo,'infra/client-state-runtime/package-runtime-resources.mjs'),'utf8');
  const native=catalog.slice(catalog.indexOf('const NATIVE_CODING_HOST_SOURCE_CLOSURE'),catalog.indexOf('function sourcePathAllowed'));
  assert.ok(native.includes("'apps/metaengine-browser/src/private-native-tools-core.mjs'"));
  assert.ok(!native.includes("'apps/metaengine-browser/src/private-native-tools.mjs'"));
  const f=await fixture(t);
  await f.put('inputs/source/apps/metaengine-browser/src/private-native-tools-neighbor.mjs','export {};\n');
  await assert.rejects(captureOfflineRuntimeInventory(f.options),/offline_bundle_private_path_forbidden/);
});

test('default installed Host consumers with generated OS boundaries, never fixture execution',async t=>{
  let active,gitBytes=Buffer.from(head+'\n'),onGit=null,onProof=null,processReads=0;
  const gitCalls=[],proofCalls=[];
  const blocked=()=>{throw Error('generated_test_forbids_process_execution');};
  function inertExec(){blocked();}
  inertExec[promisify.custom]=(file,args,options)=>{
    gitCalls.push({file,args,options:{...options,env:{...options.env}}});
    const pending=Promise.resolve().then(async()=>{await onGit?.();return {stdout:gitBytes,stderr:Buffer.alloc(0)};});
    pending.child={stdin:{end(){}}};return pending;
  };
  const processes={...childProcess,execFile:inertExec,spawn:blocked,spawnSync:blocked,exec:blocked,execSync:blocked,execFileSync:blocked,fork:blocked};
  t.mock.module('node:child_process',{namedExports:processes,defaultExport:processes});
  t.mock.module(new URL('../../apps/metaengine-browser/src/native-coding-host-observers.mjs',import.meta.url),{namedExports:{
    readNativeCodingProtectedJson:async file=>{const bytes=await fs.readFile(file);return {value:JSON.parse(bytes.toString('utf8')),sha256:sha(bytes)};},
    readNativeCodingWindowsProcess:async pid=>{
      processReads++;assert.ok(pid===71||pid===72);
      return {pid,created_at:new Date(1700000000000).toISOString(),process_incarnation_id:'generated-'+pid,user_sid:'generated-sid',
        exe_path:pid===72?active.exe:path.join(active.bundle,'runtime/postgresql/bin/postgres.exe')};
    },
    readNativeCodingSandboxEvidence:async()=>{throw Error('generated_sandbox_not_qualified');},
  }});
  t.mock.module(new URL('../../apps/metaengine-browser/src/private-windows-storage-acl.mjs',import.meta.url),{namedExports:{
    verifyOwnerOnlyWindowsStorage:async()=>({owner_dacl_verified:true}),protectOwnerOnlyWindowsDirectory:blocked,
  }});
  t.mock.module(new URL('./native-coding-fs-identity.mjs',import.meta.url),{namedExports:{readDirectoryIdentity:async file=>{
    const stat=await fs.lstat(file,{bigint:true});assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());
    return sha((await fs.realpath(file))+':'+stat.dev+':'+stat.ino+':'+stat.birthtimeNs);
  }}});
  t.mock.module(new URL('../../apps/metaengine-browser/src/codex-cli-sandbox-probe.mjs',import.meta.url),{namedExports:{readWindowsSandboxHostBoot:blocked}});
  t.mock.module(new URL('../../apps/metaengine-browser/src/native-coding-git-proof.mjs',import.meta.url),{namedExports:{readNativeCodingGitProof:async(root,options)=>{
    proofCalls.push({root,options:{...options,env:{...options.env}}});await onProof?.();return {head};
  }}});
  const {createNativeCodingInstalledTools,createNativeCodingHostOsScope}=await import('./native-coding-host-os-scope.mjs');
  const paths=await import('../../apps/metaengine-browser/src/native-coding-operator-paths.mjs');
  const select=f=>{active=f;gitBytes=Buffer.from(head+'\n');onGit=null;onProof=null;gitCalls.length=0;proofCalls.length=0;};
  const host=f=>createNativeCodingHostOsScope({config:f.config,sql:f.sql,parentPid:72,installedBundle:f.verified});

  await t.test('ordinary Node consumes the original verified bundle, not serialized or changed config claims',async t=>{
    assert.equal(process.versions.electron,undefined);
    const f=await fixture(t),config={...f.config};
    const read=createNativeCodingInstalledTools({config,installedBundle:f.verified});
    config.expected_bundle_sha256='0'.repeat(64);config.bundle_directory=path.join(f.root,'elsewhere');
    const tools=await read();assert.equal(tools.cliExecutable,f.operator.cli_executable);
    const forged=createNativeCodingInstalledTools({config:f.config,installedBundle:structuredClone(f.verified)});
    await assert.rejects(forged(),/verified_result_required/);
    const wrong=createNativeCodingInstalledTools({config:{...f.config,expected_bundle_sha256:'0'.repeat(64)},installedBundle:f.verified});
    await assert.rejects(wrong(),/installed_runtime_binding_mismatch/);
    assert.throws(()=>paths.validateNativeCodingInstalledPathScope(f.operator,{resourcesPath:f.resources,stateDirectory:f.config.state_directory}),/tools_capability_required/);
    assert.throws(()=>paths.validateNativeCodingInstalledPathScope(f.operator,{resourcesPath:f.resources,stateDirectory:f.config.state_directory,privateTools:{...tools}}),/tools_capability_required/);
    for(const target of [path.join(f.bundle,'runtime/codex/codex.exe'),path.join(f.toolsRoot,'codex/codex-path/rg.exe'),path.dirname(tools.cliExecutable)+path.sep+'.'+path.sep+'codex.exe']){
      assert.throws(()=>paths.validateNativeCodingInstalledPathScope({...f.operator,cli_executable:target},
        {resourcesPath:f.resources,stateDirectory:f.config.state_directory,privateTools:tools}),/tool_not_owned/);
    }
  });

  await t.test('missing binding and removed current tools leave non-execution and retained readers available',async t=>{
    const f=await fixture(t,{bound:false});select(f);await fs.rm(f.toolsRoot,{recursive:true});
    const native=host(f);
    assert.equal((await native.readNativeScope(null)).postgres.system_identifier,'123456789');
    assert.deepEqual(await native.readProtectedReceipt({scope:f.scope,permit:f.permit}),f.receipt);
    await assert.rejects(native.prepareNativeScopes(),/private_native_tools_binding_invalid/);
    assert.deepEqual(await native.readProtectedReceipt({scope:f.scope,permit:f.permit}),f.receipt);
  });

  await t.test('first missing or mismatched tree failure is retained rather than requalified',async t=>{
    const f=await fixture(t),saved=f.toolsRoot+'-removed';
    await fs.rename(f.toolsRoot,saved);
    const read=createNativeCodingInstalledTools({config:f.config,installedBundle:f.verified});
    await assert.rejects(read(),{code:'ENOENT'});await fs.rename(saved,f.toolsRoot);
    await assert.rejects(read(),{code:'ENOENT'});
    const mismatch=createNativeCodingInstalledTools({config:f.config,installedBundle:f.verified});
    await fs.appendFile(path.join(f.toolsRoot,'manifest.json'),'\n');
    await assert.rejects(mismatch(),/manifest_binding_mismatch/);
    await fs.writeFile(path.join(f.toolsRoot,'manifest.json'),f.toolsBytes);
    await assert.rejects(mismatch(),/manifest_binding_mismatch/);
  });

  await t.test('HEAD and checkpoint receive canonical complete private environments despite hostile ambient values',async t=>{
    const f=await fixture(t);select(f);
    const names=['PATH','SYSTEMROOT','GIT_EXEC_PATH','GIT_SSL_CAINFO','SSL_CERT_FILE','OPENSSL_CONF','OPENSSL_MODULES','GIT_CONFIG_COUNT','GIT_SSH_COMMAND','NODE_OPTIONS'];
    const prior=new Map(names.map(name=>[name,process.env[name]]));
    try{
      for(const name of names)process.env[name]='GENERATED_HOSTILE_VALUE';
      const native=host(f);await native.readCheckpointScope(f.permit);
      assert.equal(gitCalls.length,1);assert.equal(proofCalls.length,1);
      const tools=await createNativeCodingInstalledTools({config:f.config,installedBundle:f.verified})();
      for(const call of [gitCalls[0],proofCalls[0]])assert.deepEqual(call.options.env,tools.environment);
      assert.equal(gitCalls[0].file,tools.gitExecutable);assert.equal(proofCalls[0].options.gitExecutable,tools.gitExecutable);
      assert.equal(gitCalls[0].options.encoding,'buffer');assert.equal(gitCalls[0].options.shell,false);
      assert.equal(tools.environment.GIT_EXEC_PATH,path.join(f.toolsRoot,'git/ucrt64/libexec/git-core'));
      assert.equal(tools.environment.OPENSSL_MODULES,path.join(f.toolsRoot,'git/ucrt64/lib/ossl-modules'));
      assert.ok(!Object.hasOwn(tools.environment,'NODE_OPTIONS'));
    }finally{for(const [name,value]of prior){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
  });

  await t.test('HEAD rejects invalid raw UTF-8',async t=>{
    const f=await fixture(t);select(f);gitBytes=Buffer.from([0xff]);
    await assert.rejects(host(f).readNativeScope(f.permit,false),error=>error.code==='ERR_ENCODING_INVALID_ENCODED_DATA');
  });

  for(const [target,checkpoint]of [
    ['git/ucrt64/bin/libcurl-4.dll',false],['git/ucrt64/etc/ssl/certs/ca-bundle.crt',true],
    ['git/ucrt64/libexec/git-core/git-helper',false],['git/ucrt64/lib/ossl-modules/legacy.dll',true],
    ['codex/codex-resources/codex-command-runner.exe',false],
  ])await t.test('post-read mutation permanently fences '+target,async t=>{
    const f=await fixture(t);select(f);const native=host(f),file=path.join(f.toolsRoot,target),before=await fs.readFile(file);
    const mutate=()=>fs.writeFile(file,'generated mutation');if(checkpoint)onProof=mutate;else onGit=mutate;
    await assert.rejects(checkpoint?native.readCheckpointScope(f.permit):native.readNativeScope(f.permit,false),/private_native_tools_inventory_changed/);
    onProof=null;onGit=null;await fs.writeFile(file,before);
    await assert.rejects(native.readNativeScope(f.permit,false),/private_native_tools_invalidated/);
  });

  await t.test('retained receipt still reads after admitted tools, home and canaries are removed',async t=>{
    const f=await fixture(t);select(f);const native=host(f);
    await native.readNativeScope(f.permit,false);
    await fs.rm(f.toolsRoot,{recursive:true});await fs.rm(f.operator.codex_home,{recursive:true});await fs.rm(path.join(f.config.state_directory,'sandbox'),{recursive:true});
    const count=processReads,calls=gitCalls.length;
    assert.deepEqual(await native.readProtectedReceipt({scope:f.scope,permit:f.permit}),f.receipt);
    assert.equal(processReads,count);assert.equal(gitCalls.length,calls);
    await assert.rejects(native.readCheckpointScope(f.permit));
    assert.deepEqual(await native.readProtectedReceipt({scope:f.scope,permit:f.permit}),f.receipt);
  });
});
