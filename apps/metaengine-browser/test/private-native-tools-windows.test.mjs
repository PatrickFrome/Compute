import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {stagePrivateNativeTools,assertPrivateNativeToolsManifestPins} from '../scripts/stage-private-native-tools.mjs';
import {resolvePrivateNativeTools,privateNativeToolsBinding} from '../src/private-native-tools.mjs';
import {createShellFreeGitExecutor} from '../src/managed-task-project-runtime.mjs';
const run=promisify(execFile);

// This is a disposable Windows payload-startup check. Node is the CI harness;
// it is not a client prerequisite. It does not install, enroll, log in, qualify
// a signer/loaded-image chain, or claim a clean operating-system image.
test('actual pinned private Windows Git/Codex start without inherited tools and fixed Git plans work',
  {skip:process.platform!=='win32'||process.arch!=='x64'||!process.env.METAENGINE_PRIVATE_TOOL_TEST_ARCHIVES},async t=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'me-private-tools-win-'));
    t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100}));
    const toolsRoot=path.join(root,'tools');
    await stagePrivateNativeTools({archiveDirectory:path.resolve(process.env.METAENGINE_PRIVATE_TOOL_TEST_ARCHIVES),outputDirectory:toolsRoot});
    const manifestBytes=await fs.readFile(path.join(toolsRoot,'manifest.json'));
    await assertPrivateNativeToolsManifestPins(JSON.parse(manifestBytes));
    const tools=await resolvePrivateNativeTools({toolsRoot,binding:privateNativeToolsBinding(manifestBytes)});
    const privateTemp=path.join(root,'temp');await fs.mkdir(privateTemp);
    const env={...tools.environment,TEMP:privateTemp,TMP:privateTemp,USERPROFILE:privateTemp,LOCALAPPDATA:privateTemp,APPDATA:privateTemp,CODEX_HOME:path.join(privateTemp,'codex')};
    const options={env,cwd:root,shell:false,windowsHide:true,timeout:30000,maxBuffer:1024*1024};
    // Supply a deliberately unusable ambient search path. Only private child
    // directories and the fixed OS roots may reach the actual process.
    const decoy=path.join(root,'decoy');await fs.mkdir(decoy);
    await fs.writeFile(path.join(decoy,'git.exe'),'invalid decoy');await fs.writeFile(path.join(decoy,'codex.exe'),'invalid decoy');
    const inherited=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toUpperCase()==='PATH'));
    for(const key of Object.keys(inherited))delete process.env[key];process.env.PATH=decoy;
    try{
      await tools.revalidate();
      assert.match((await run(tools.gitExecutable,['--version'],options)).stdout,/git version 2\.56\.0\.windows\.4/);
      assert.match((await run(tools.cliExecutable,['--version'],options)).stdout,/0\.166\.0/);
      // MinGit's optional GCM is Framework-based; a successful Git version
      // alone does not qualify this shipped dependency. Version is read-only.
      const gcm=await run(path.join(toolsRoot,'git','ucrt64','bin','git-credential-manager.exe'),['--version'],options);
      assert.match(gcm.stdout+gcm.stderr,/2\.9\.1/);
      const repo=path.join(root,'repo');await fs.mkdir(repo);
      await run(tools.gitExecutable,['init','--quiet',repo],options);
      const repoOptions={...options,cwd:repo};
      await run(tools.gitExecutable,['-c','user.name=METAENGINE fixture','-c','user.email=fixture@example.invalid',
        '-c','core.hooksPath=','commit','--allow-empty','--quiet','-m','Private tool fixture'],repoOptions);
      const head=(await run(tools.gitExecutable,['rev-parse','HEAD'],repoOptions)).stdout.trim();
      assert.match(head,/^[a-f0-9]{40}$/);
      const workspace=randomUUID(),task=randomUUID(),target=path.join(root,'worktree');
      const base={schema:'metaengine.devos.workspace-git-plan.v1',executable:'git',shell:false,cwd:repo,
        workspace_id:workspace,task_id:task,lease_generation:1,authority_effect:false,automatic_retry_allowed:false};
      const executor=createShellFreeGitExecutor({privateTools:tools});
      await executor.execute({...base,effect:'WORKTREE_CREATE_LOCKED',expected_initial_head_sha:head,
        argv:['worktree','add','--lock','--reason',`METAENGINE:${workspace}:task:${task}:lease:1`,'-b','me-fixture',target,head]});
      const inventory=await executor.execute({...base,effect:'WORKTREE_INVENTORY_READ',argv:['worktree','list','--porcelain','-z']});
      assert.ok(inventory.stdout.includes('me-fixture'));assert.ok(inventory.stdout.includes('locked'));
      // Dependency drift refuses a subsequent fixed operation before spawn.
      await fs.unlink(path.join(toolsRoot,'git','ucrt64','bin','libcurl-4.dll'));let spawned=0;
      const blocked=createShellFreeGitExecutor({privateTools:tools,spawnProcess:()=>{spawned++;throw Error('decoy_spawn');}});
      await assert.rejects(blocked.execute({...base,effect:'WORKTREE_INVENTORY_READ',argv:['worktree','list','--porcelain','-z']}),/private_native_tools_/);
      assert.equal(spawned,0);
    }finally{
      for(const key of Object.keys(process.env))if(key.toUpperCase()==='PATH')delete process.env[key];
      Object.assign(process.env,inherited);
    }
  });
