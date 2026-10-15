import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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
