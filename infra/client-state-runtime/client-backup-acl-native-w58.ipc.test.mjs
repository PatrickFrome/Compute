import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {protectOwnerOnlyWindowsDirectory} from '../../apps/metaengine-browser/src/private-windows-storage-acl.mjs';
import {HostAgentRuntime} from '../../apps/metaengine-browser/src/host-agent-runtime.mjs';
import {HostAgentClient,hostAgentEndpoint} from '../../apps/metaengine-browser/src/host-agent-ipc.mjs';
import {createHostAgentSessionKey,HOST_AGENT_ALLOWED_OPS} from '../../apps/metaengine-browser/src/host-agent-protocol.mjs';

test('existing authenticated Host wire protocol enforces zero-input native ACL readback',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-w58-host-ipc-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  assert.ok(HOST_AGENT_ALLOWED_OPS.includes('BACKUP_ACL_READBACK'));
  const sessionKey=createHostAgentSessionKey();
  const endpoint=hostAgentEndpoint({userDataPath:root});
  const host=new HostAgentRuntime({
    endpoint,sessionKey,developmentPlane:{request:async()=>({state:'UNKNOWN'})},
    fastControl:{invoke:async()=>({state:'UNKNOWN'})},
    browserStatus:async()=>({state:'UNKNOWN'}),
    browserPlanExecute:async()=>({accepted:false}),
    browserPlanCancel:async()=>({accepted:false}),
    // No installed Owner-supplied archive root: fail closed even on Windows.
  });
  await host.start();
  const client=new HostAgentClient({endpoint,sessionKey});
  t.after(async()=>{client.close();await host.close();});
  const acl=await client.request('BACKUP_ACL_READBACK',{});
  assert.equal(acl.native_acl_verified,false);
  assert.equal(acl.installed_owner_proven,false);
  assert.equal(acl.upgrade_authorized,false);
  assert.equal(acl.authority_effect,false);
  assert.match(acl.reason,/^NATIVE_/);
  await assert.rejects(client.request('BACKUP_ACL_READBACK',{
    archivePath:'C:\\Windows\\System32\\drivers\\etc\\hosts',verified:true,
  }),/host_backup_acl_payload_forbidden/);
  const pong=await client.request('PING',{});
  assert.equal(pong.pong,true);
});

const run=promisify(execFile);
test('Windows authenticated Host wire executes real fixed-root ACL provider, never installed Owner approval',{
  skip:process.platform!=='win32',
},async t=>{
  const generatedRoot=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-w58-ipc-native-'));
  const root=process.platform==='win32'?await fs.realpath(generatedRoot):generatedRoot;
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await protectOwnerOnlyWindowsDirectory(root);
  const file=path.join(root,'postgresql-17-snapshot.dump');
  await fs.writeFile(file,Buffer.concat([Buffer.from('PGDMP'),Buffer.alloc(2048,42)]));
  const script=`$a=Get-Acl -LiteralPath $env:METAENGINE_W58_TEST_FILE
$a.SetAccessRuleProtection($true,$true)
Set-Acl -LiteralPath $env:METAENGINE_W58_TEST_FILE -AclObject $a`;
  await run(path.win32.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),
    ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
    {env:{...process.env,METAENGINE_W58_TEST_FILE:file},windowsHide:true,timeout:120000});
  const sessionKey=createHostAgentSessionKey(),endpoint=hostAgentEndpoint({userDataPath:root});
  const host=new HostAgentRuntime({endpoint,sessionKey,backupDirectory:root,
    developmentPlane:{request:async()=>({state:'UNKNOWN'})},
    fastControl:{invoke:async()=>({state:'UNKNOWN'})},
    browserStatus:async()=>({state:'UNKNOWN'}),
    browserPlanExecute:async()=>({accepted:false}),browserPlanCancel:async()=>({accepted:false})});
  await host.start();
  const client=new HostAgentClient({endpoint,sessionKey});
  t.after(async()=>{client.close();await host.close();});
  const result=await client.request('BACKUP_ACL_READBACK',{});
  assert.equal(result.state,'NATIVE_ACL_VERIFIED',JSON.stringify(result));
  assert.equal(result.native_acl_verified,true);
  assert.equal(result.installed_owner_proven,false);
  assert.equal(result.backup_verified,false);
  assert.equal(result.upgrade_authorized,false);
  await assert.rejects(client.request('BACKUP_ACL_READBACK',{path:file}),/payload_forbidden/);
});
