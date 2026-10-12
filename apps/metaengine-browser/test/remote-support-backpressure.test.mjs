import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { createRemoteSupportMcp } from '../src/remote-support-mcp.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
const call = (id,name,args={}) => Buffer.from(JSON.stringify({
  jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args},
})+'\n');
const rpc = (service,name,args={}) => service.request({
  jsonrpc:'2.0',id:0,method:'tools/call',params:{name,arguments:args},
});
const action = {action:'UIA_INVOKE',target:{process_id:42},args:{runtime_id:[9]},
  agent_id:'agent_queue-v1',task_id:'task_queue-v1'};

function transport(t) {
  const input=new PassThrough(),output=new PassThrough(),replies=[];
  output.on('data',chunk=>replies.push(JSON.parse(String(chunk))));
  let finish,observations=0,effects=0;
  const held=new Promise(resolve=>{finish=resolve;});
  const service=createRemoteSupportMcp({input,output,platform:'win32',approve:async()=>true,
    resolveControlLease:async({request})=>({schema:'metaengine.remote-support-control-lease.v1',
      verified:true,request_binding:request,context:{command_id:'trusted-fixture'}}),
    executor:{observe:async()=>{observations++;return held;},act:async()=>{effects++;return {};}}});
  t.after(()=>{service.close();finish({result:{}});input.destroy();output.destroy();});
  return {input,replies,service,finish,
    observations:()=>observations,effects:()=>effects,
    async hold() {
      await rpc(service,'support_start_session',{scope:'CONTROL'});
      input.write(call(1,'support_observe',{action:'OBSERVE_WINDOWS'}));
      await settle();
      assert.equal(observations,1);
    }};
}

test('framed request count overflow closes and revokes a held handler before queued effects',async t=>{
  const h=transport(t);
  await h.hold();
  h.input.write(Buffer.concat(Array.from({length:65},(_,n)=>call(n+2,'support_control',action))));
  await settle();
  assert.equal(h.replies.length,1);
  assert.equal(h.replies[0].error.message,'Pending request limit exceeded');
  assert.equal(h.input.isPaused(),true);
  await assert.rejects(rpc(h.service,'support_status'),/remote_support_session_closed/);
  h.finish({result:{private_title:'must_not_publish'}});
  await settle();
  assert.equal(h.effects(),0);
  assert.equal(h.observations(),1);
  assert.equal(h.replies.length,1);
});

test('pending byte budget counts UTF-8 across individually valid frames and closes without effects',async t=>{
  const h=transport(t);
  await h.hold();
  const frames=Array.from({length:9},(_,n)=>call(n+2,'support_status',{padding:'я'.repeat(60000)}));
  assert.ok(frames.every(frame=>frame.length<128*1024));
  assert.ok(frames.reduce((sum,frame)=>sum+frame.length,0)>1024*1024);
  h.input.write(Buffer.concat([...frames,call(12,'support_control',action)]));
  await settle();
  assert.equal(h.replies.length,1);
  assert.equal(h.replies[0].error.message,'Pending request limit exceeded');
  await assert.rejects(rpc(h.service,'support_status'),/remote_support_session_closed/);
  h.finish({result:{private_title:'must_not_publish'}});
  await settle();
  assert.equal(h.effects(),0);
  assert.equal(h.replies.length,1);
});

test('emergency stop preempts a full bounded queue without awaiting the held handler',async t=>{
  const h=transport(t);
  await h.hold();
  // The active observation plus 63 queued actions fill the ordinary slots.
  h.input.write(Buffer.concat([
    ...Array.from({length:63},(_,n)=>call(n+2,'support_control',action)),
    call('stop','support_stop'),
  ]));
  await settle();
  assert.equal(h.replies.length,1);
  assert.equal(h.replies[0].id,'stop');
  assert.equal(h.replies[0].result.isError,false);
  const status=JSON.parse((await rpc(h.service,'support_status')).result.content[0].text);
  assert.equal(status.session_revoked,true);
  assert.equal(status.active_control_grant,false);
  assert.equal(h.effects(),0);
  h.finish({result:{private_title:'must_not_publish'}});
  await settle();
  assert.equal(h.effects(),0);
  assert.equal(h.replies.length,65);
  assert.equal(JSON.stringify(h.replies).includes('private_title'),false);
});

test('drained framed requests release count and byte reservations for the next burst',async t=>{
  const h=transport(t);
  for(let batch=0;batch<2;batch++) {
    h.input.write(Buffer.concat(Array.from({length:50},(_,n)=>call(batch*50+n,'support_status'))));
    await settle();
    assert.equal(h.replies.length,(batch+1)*50);
    assert.ok(h.replies.every(reply=>reply.result?.isError===false));
  }
  assert.equal(h.effects(),0);
  assert.equal(h.input.isPaused(),false);
});
