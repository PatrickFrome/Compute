import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { HostAgentRuntime } from '../src/host-agent-runtime.mjs';
import { HostAgentClient, hostAgentEndpoint } from '../src/host-agent-ipc.mjs';
import { HOST_AGENT_ALLOWED_OPS, HostAgentNonceWindow, createHostAgentNonce,
  signHostAgentFrame, verifyHostAgentFrame, HOST_AGENT_PROTOCOL_SCHEMA } from '../src/host-agent-protocol.mjs';

test('W60: production Host Runtime emits fixed process census across authenticated private IPC',async()=>{
  assert.ok(HOST_AGENT_ALLOWED_OPS.includes('OWNER_NATIVE_READBACK'));
  const endpoint=hostAgentEndpoint({userDataPath:path.join(os.tmpdir(), 'w60-'+crypto.randomUUID())});
  const sessionKey=crypto.randomBytes(32).toString('base64url');
  const host=new HostAgentRuntime({endpoint,sessionKey,
    developmentPlane:{request:async()=>{throw Error('no work');}},
    fastControl:{invoke:async()=>{throw Error('no control');}},
    browserStatus:async()=>({authority_effect:false}),
    browserPlanExecute:async()=>{throw Error('no execution');},
    browserPlanCancel:async()=>{throw Error('no effect');},
  });
  const client=new HostAgentClient({endpoint,sessionKey});
  await host.start();
  try {
    const receipt=await client.request('OWNER_NATIVE_READBACK',{}, {timeoutMs:5000});
    assert.equal(receipt.schema,'metaengine.host.owner-native-readback.w60.v1');
    assert.equal(receipt.owner_binding_proven,false);
    assert.equal(receipt.signed_installed_exe_proven,false);
    assert.equal(receipt.credential_exposed,false);
    assert.equal(receipt.authority_effect,false);
    assert.ok(['UNKNOWN','KERNEL_PROCESS_OBSERVED'].includes(receipt.state));
    if(receipt.kernel){
      assert.equal(receipt.kernel.pid,process.pid);
      assert.equal(receipt.kernel.source,'OS_PROCESS_INVENTORY');
      assert.equal(receipt.kernel.authority_effect,false);
      assert.ok(!('api_key' in receipt.kernel));
      assert.ok(!('exe_path' in receipt.kernel));
    }
    await assert.rejects(client.request('OWNER_NATIVE_READBACK',
      {pid:process.pid,exe_path:'C:\\untrusted.exe'},{timeoutMs:5000}),
      /host_owner_native_payload_denied/);
    await assert.rejects(client.request('OWNER_NATIVE_READBACK',
      {owner_id:'spoof'},{timeoutMs:5000}),/host_owner_native_payload_denied/);
  } finally {client.close();await host.close();}
});
test('W60: existing HMAC challenge refuses replay, wrong secret and changed op',()=>{
  const key=crypto.randomBytes(32).toString('base64url');
  const window=new HostAgentNonceWindow();
  const frame=signHostAgentFrame({schema:HOST_AGENT_PROTOCOL_SCHEMA,kind:'REQUEST',
    request_id:'w60:request:0001',nonce:createHostAgentNonce(),
    op:'OWNER_NATIVE_READBACK',payload:{}},key);
  const verify=f=>verifyHostAgentFrame(f,key,{consumeNonce:n=>window.consume(n)});
  assert.equal(verify(frame).authenticated,true);
  assert.throws(()=>verify(frame),/nonce_replayed/);
  assert.throws(()=>verifyHostAgentFrame(frame,crypto.randomBytes(32).toString('base64url')),
    /host_agent_auth_failed/);
  assert.throws(()=>verifyHostAgentFrame({...frame,op:'HOST_STATUS'},key),/host_agent_auth_failed/);
});
