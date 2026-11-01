import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import test from 'node:test';
import {createCodexCliWindowsProcessController} from '../src/codex-cli-windows-process-controller.mjs';
import {codexCliLaunchIdentity} from '../src/codex-cli-physical-settlement.mjs';

// Protocol doubles. These exercise real controller stream parsing and commands,
// not Windows kernel cleanup, CLI sandbox policy or model execution.
const sha=x=>createHash('sha256').update(x).digest('hex');
const nonce='a'.repeat(64),context='019a0000-0000-7000-8000-000000000001';
const prompt='Исходное задание 😀';
const policy=()=>({type:'metaengine.effective_policy.v1',nonce,context_id:context,mode:'execute',strict_config:true,thread_start_overrides:{},policy:{fixture:'Привет 😀'}});
const ack=(value=policy())=>Buffer.from(JSON.stringify({type:'metaengine.effective_policy.accept.v1',nonce:value.nonce,context_id:value.context_id})+'\n');
const dateOf=birth=>new Date(Number((BigInt(birth)-116444736000000000n)/10000n)).toISOString();
const helperIdentity={pid:122,created_at:dateOf('133333333333333332'),process_incarnation_id:'pid:122:created_100ns:133333333333333332'};
function fixture(t,overrides={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'metaengine-policy-transport-')),helperPath=path.join(dir,'fixture.ps1'),bytes='protocol double only';fs.writeFileSync(helperPath,bytes);
 const platform=Object.getOwnPropertyDescriptor(process,'platform'),originalSpawn=childProcess.spawn;
 Object.defineProperty(process,'platform',{...platform,value:'win32'});
 const helper=new EventEmitter();helper.pid=122;helper.stdin=new PassThrough();helper.stdout=new PassThrough();helper.stderr=new PassThrough();let input='',kills=0;
 helper.stdin.on('data',c=>{input+=c;});helper.kill=()=>{kills++;return true;};childProcess.spawn=()=>helper;syncBuiltinESMExports();
 t.mock.timers.enable({apis:['setTimeout']});
 t.after(()=>{helper.emit('close',1);childProcess.spawn=originalSpawn;syncBuiltinESMExports();Object.defineProperty(process,'platform',platform);fs.rmSync(dir,{recursive:true,force:true});});
 const spec={executablePath:path.join(dir,'worker.exe'),expectedExecutableSha256:'b'.repeat(64),cwd:dir,args:[],env:{},timeoutMs:10000,runId:'11111111-1111-4111-8111-111111111111',promptSha256:sha(prompt),inputProtocol:'EFFECTIVE_POLICY_ACK_V1',policyNonce:nonce,...overrides};
 const controller=createCodexCliWindowsProcessController({helperPath,expectedHelperSha256:sha(bytes),powershellPath:path.join(dir,'powershell.exe'),readProcess:async()=>({...helperIdentity,user_sid:'S-1-5-21-111-1001',exe_path:path.join(dir,'powershell.exe')})});
 const pending=controller.spawn(spec),wire=JSON.parse(input.split('\n')[0]),launch={schema:wire.schema,canonical_body:Buffer.from(wire.body_b64,'base64').toString(),request_sha256:wire.request_sha256},identity=codexCliLaunchIdentity(launch);
 const frame=value=>helper.stdout.write(JSON.stringify(value)+'\n');
 const ready={type:'ready',launch:identity,helper_process:helperIdentity,pid:123,started_at:dateOf('133333333333333333'),process_incarnation_id:'pid:123:created_100ns:133333333333333333',executable_path:spec.executablePath,executable_sha256:spec.expectedExecutableSha256,user_sid:'S-1-5-21-111-1001',job_id:spec.runId,tree_control_bound:true,started_suspended:true,job_bound_before_resume:true,process_tree_control:'WINDOWS_JOB_OBJECT'};frame(ready);
 const output=(data,channel='stdout')=>{for(let i=0;i<data.length;i+=4096)frame({type:'output',channel,data_b64:Buffer.from(data.subarray(i,i+4096)).toString('base64')});};
 return {helper,spec,launch,identity,frame,output,pending,get input(){return input;},get kills(){return kills;},resumed(){frame({type:'resumed',request_id:identity.request_id,request_sha256:identity.request_sha256});},ackWritten(extra={}){frame({type:'policy_ack_written',request_id:identity.request_id,request_sha256:identity.request_sha256,nonce,context_id:context,...extra});},promptWritten(){frame({type:'prompt_written',request_id:identity.request_id,request_sha256:identity.request_sha256});}};
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function start(f){const h=await f.pending;const boot=h.bootstrap();f.resumed();return {h,boot};}
function close(f){f.helper.emit('close',1);}

test('bootstrap keeps original prompt sealed; one ACK delivery precedes one original prompt',async t=>{
 const f=fixture(t),h=await f.pending;
 assert.equal(typeof h.bootstrap,'function','the old one-shot resume transport cannot bootstrap with open empty stdin');
 await assert.rejects(h.resume(prompt),/resume_invalid/);
 const boot=h.bootstrap();assert.match(f.input,/\nBOOTSTRAP \S+ \S+ \d+\n$/);assert.ok(!f.input.includes(Buffer.from(prompt).toString('base64')));
 f.resumed();f.output(Buffer.from(JSON.stringify(policy())+'\n'));assert.deepEqual(await boot,Buffer.from(JSON.stringify(policy())));
 let output='';h.stdout.on('data',b=>{output+=b;});const accepted=h.acceptPolicy(ack(),prompt);await turn();
 assert.match(f.input,/\nPOLICY_ACK /);assert.ok(!f.input.includes('\nPROMPT '));
 f.ackWritten();await turn();assert.match(f.input,/\nPROMPT /);assert.equal(f.input.split('\n').filter(x=>x.startsWith('PROMPT ')).length,1);
 f.output(Buffer.from('{"type":"thread.started","thread_id":"fixture"}\n'));assert.equal(output,'');f.promptWritten();await accepted;
 assert.equal(output,'{"type":"thread.started","thread_id":"fixture"}\n');assert.equal(JSON.parse(f.launch.canonical_body).prompt_sha256,sha(prompt));
 await assert.rejects(h.bootstrap(),/bootstrap_invalid/);await assert.rejects(h.acceptPolicy(ack(),prompt),/policy_accept_invalid/);close(f);await h.completion;
});

for(const chunkSize of [1,2,3,7,4096])test('policy raw UTF-8 survives byte chunks '+chunkSize,async t=>{
 const f=fixture(t),{h,boot}=await start(f),record=Buffer.from(JSON.stringify(policy())+'\n');
 for(let i=0;i<record.length;i+=chunkSize)f.output(record.subarray(i,i+chunkSize));
 assert.deepEqual(await boot,record.subarray(0,-1));close(f);await h.completion;
});
for(const [name,data] of [
 ['wrong nonce',()=>Buffer.from(JSON.stringify({...policy(),nonce:'b'.repeat(64)})+'\n')],
 ['wrong context version',()=>Buffer.from(JSON.stringify({...policy(),context_id:context.replace('-7000-','-4000-')})+'\n')],
 ['model event before policy',()=>Buffer.from('{"type":"thread.started"}\n')],
 ['invalid UTF8',()=>Buffer.from([0xc3,0x28,10])],
 ['blank line',()=>Buffer.from('\n')],['CRLF',()=>Buffer.from(JSON.stringify(policy())+'\r\n')],
 ['overflow without LF',()=>Buffer.alloc(65537,32)],['overflow with LF',()=>Buffer.from(' '.repeat(65537)+'\n')],
 ['two policy records',()=>Buffer.from(JSON.stringify(policy())+'\n'+JSON.stringify(policy())+'\n')],
 ['policy plus partial output',()=>Buffer.from(JSON.stringify(policy())+'\nx')],
])test('bootstrap rejects '+name+' and joins original close',async t=>{
 const f=fixture(t),{h,boot}=await start(f);let settled=false;boot.then(()=>{settled=true;},()=>{settled=true;});f.output(data());
 const rejected=assert.rejects(boot,/CONTROLLER_POLICY_PROTOCOL_INVALID/);assert.equal(f.kills,1);close(f);await rejected;assert.equal((await h.completion).tree_cleanup_confirmed,false);
});
test('65536 bytes excluding LF is accepted, raw policy is never task output',async t=>{
 const f=fixture(t),{h,boot}=await start(f),p=policy();p.policy.padding='';const size=Buffer.byteLength(JSON.stringify(p));p.policy.padding='x'.repeat(65536-size);
 let received=0;h.stdout.on('data',c=>{received+=c.length;});f.output(Buffer.from(JSON.stringify(p)+'\n'));assert.equal((await boot).length,65536);assert.equal(received,0);close(f);await h.completion;
});
for(const [name,mutate] of [['wrong nonce',a=>a.nonce='b'.repeat(64)],['wrong context',a=>a.context_id=context.slice(0,-1)+'2'],['extra field',a=>a.authorized=true],['wrong type',a=>a.type='accepted']])test('invalid ACK '+name+' never writes input',async t=>{
 const f=fixture(t),{h,boot}=await start(f);f.output(Buffer.from(JSON.stringify(policy())+'\n'));await boot;const a=JSON.parse(ack());mutate(a);await assert.rejects(h.acceptPolicy(Buffer.from(JSON.stringify(a)+'\n'),prompt),/policy_accept_invalid/);assert.ok(!f.input.includes('POLICY_ACK'));close(f);await h.completion;
});
test('changed prompt digest rejects before ACK write and cannot consume the original prompt scope',async t=>{
 const f=fixture(t),{h,boot}=await start(f);f.output(Buffer.from(JSON.stringify(policy())+'\n'));await boot;
 await assert.rejects(h.acceptPolicy(ack(),'changed'),/policy_accept_invalid/);assert.ok(!f.input.includes('POLICY_ACK'));close(f);await h.completion;
});
test('lost ACK is never retransmitted; cancellation waits for helper close',async t=>{
 const f=fixture(t),{h,boot}=await start(f);f.output(Buffer.from(JSON.stringify(policy())+'\n'));await boot;const accepted=h.acceptPolicy(ack(),prompt);await turn();
 const rejected=assert.rejects(accepted,/CONTROLLER_POLICY_ACK_UNCONFIRMED/);const stopping=h.terminate('CANCELLED');await assert.rejects(h.acceptPolicy(ack(),prompt),/policy_accept_invalid/);
 assert.ok(!f.input.includes('PROMPT '));assert.equal(f.input.split('\n').filter(x=>x.startsWith('POLICY_ACK ')).length,1);close(f);await stopping;await rejected;assert.equal((await h.completion).reason,'CONTROLLER_POLICY_ACK_UNCONFIRMED');
});
for(const phase of ['bootstrap','policy','ack','prompt'])test('deadline fences '+phase+' without replay',async t=>{
 const f=fixture(t),{h,boot}=await start(f);let wait=boot;
 if(phase!=='bootstrap'){f.output(Buffer.from(JSON.stringify(policy())+'\n'));await boot;}
 if(['ack','prompt'].includes(phase)){wait=h.acceptPolicy(ack(),prompt);await turn();}
 if(phase==='prompt'){f.ackWritten();await turn();}
 const rejected=phase==='policy'?null:assert.rejects(wait,/CONTROLLER_(POLICY_ACK_UNCONFIRMED|POLICY_PROMPT_UNCONFIRMED|EXECUTION_TIMEOUT)/);
 t.mock.timers.tick(10000);assert.equal(f.kills,0,'native watchdog owns the deadline and gets bounded join time');t.mock.timers.tick(11000);assert.equal(f.kills,1);close(f);if(rejected)await rejected;assert.equal((await h.completion).tree_cleanup_confirmed,false);
});
for(const event of ['policy_ack_written','prompt_written'])test('unsolicited '+event+' is rejected',async t=>{
 const f=fixture(t),h=await f.pending;f.frame({type:event,request_id:f.identity.request_id,request_sha256:f.identity.request_sha256,nonce,context_id:context});close(f);assert.equal((await h.completion).reason,'CONTROLLER_PROTOCOL_INVALID');
});

test('ACK-written and output in one helper chunk preserves native notification ordering',async t=>{
 const f=fixture(t),{h,boot}=await start(f);f.output(Buffer.from(JSON.stringify(policy())+'\n'));await boot;
 const accepted=h.acceptPolicy(ack(),prompt);await turn();let output='';h.stdout.on('data',b=>{output+=b;});
 const notification={type:'policy_ack_written',request_id:f.identity.request_id,request_sha256:f.identity.request_sha256,nonce,context_id:context};
 const event={type:'output',channel:'stdout',data_b64:Buffer.from('{"type":"thread.started"}\n').toString('base64')};
 f.helper.stdout.write(JSON.stringify(notification)+'\n'+JSON.stringify(event)+'\n');
 assert.equal(f.kills,0);assert.equal(output,'');await turn();assert.match(f.input,/\nPROMPT /);f.promptWritten();await accepted;assert.equal(output,'{"type":"thread.started"}\n');close(f);await h.completion;
});
for(const phase of ['suspended','bootstrap','policy','ack','ack-written','prompt','executing'])test('stop synchronously fences '+phase+' and joins helper close',async t=>{
 const f=fixture(t),h=await f.pending;let pending=null,rejected=null;
 if(phase!=='suspended'){pending=h.bootstrap();f.resumed();}
 if(!['suspended','bootstrap'].includes(phase)){f.output(Buffer.from(JSON.stringify(policy())+'\n'));await pending;pending=null;}
 if(['ack','ack-written','prompt','executing'].includes(phase)){pending=h.acceptPolicy(ack(),prompt);await turn();}
 if(phase==='ack-written')f.ackWritten();
 if(['prompt','executing'].includes(phase)){f.ackWritten();await turn();}
 if(phase==='executing'){f.promptWritten();await pending;pending=null;}
 if(pending)rejected=assert.rejects(pending,/CONTROLLER_|policy_accept_cancelled/);
 let settled=false;const stopping=h.terminate('CANCELLED');stopping.then(()=>{settled=true;});
 await assert.rejects(h.bootstrap(),/bootstrap_invalid/);await assert.rejects(h.acceptPolicy(ack(),prompt),/policy_accept_invalid/);
 await turn();assert.equal(settled,false);close(f);await stopping;if(rejected)await rejected;assert.equal(f.input.split('\n').filter(x=>x.startsWith('POLICY_ACK ')).length,['ack','ack-written','prompt','executing'].includes(phase)?1:0);
});
for(const phase of ['bootstrap','policy','ack','prompt'])test('EOF during '+phase+' never supplies a successful settlement',async t=>{
 const f=fixture(t),{h,boot}=await start(f);let pending=boot;
 if(phase!=='bootstrap'){f.output(Buffer.from(JSON.stringify(policy())+'\n'));await pending;pending=null;}
 if(['ack','prompt'].includes(phase)){pending=h.acceptPolicy(ack(),prompt);await turn();}
 if(phase==='prompt'){f.ackWritten();await turn();}
 const rejected=pending?assert.rejects(pending,/CONTROLLER_POLICY_(EOF|ACK_UNCONFIRMED|PROMPT_UNCONFIRMED)/):null;close(f);if(rejected)await rejected;
 assert.equal((await h.completion).tree_cleanup_confirmed,false);assert.ok(!h.joined_settlement);
});
for(const extra of [{request_id:'22222222-2222-4222-8222-222222222222'},{request_sha256:'f'.repeat(64)},{nonce:'b'.repeat(64)},{context_id:context.slice(0,-1)+'2'}])test('ACK notification cannot be forged with '+Object.keys(extra)[0],async t=>{
 const f=fixture(t),{h,boot}=await start(f);f.output(Buffer.from(JSON.stringify(policy())+'\n'));await boot;const accepted=h.acceptPolicy(ack(),prompt),rejected=assert.rejects(accepted,/CONTROLLER_PROTOCOL_INVALID/);await turn();f.ackWritten(extra);assert.equal(f.kills,1);close(f);await rejected;assert.ok(!f.input.includes('\nPROMPT '));await h.completion;
});
for(const phase of ['policy','executing'])test('replayed policy during '+phase+' never reaches model output',async t=>{
 const f=fixture(t),{h,boot}=await start(f);f.output(Buffer.from(JSON.stringify(policy())+'\n'));await boot;let output='';h.stdout.on('data',c=>{output+=c;});
 if(phase==='executing'){const accepted=h.acceptPolicy(ack(),prompt);await turn();f.ackWritten();await turn();f.promptWritten();await accepted;}
 f.output(Buffer.from(JSON.stringify(policy())+'\n'));assert.equal(f.kills,1);assert.equal(output,'');close(f);assert.equal((await h.completion).reason,'CONTROLLER_POLICY_PROTOCOL_INVALID');
});
test('model output after policy but before ACK is rejected without sending the prompt',async t=>{
 const f=fixture(t),{h,boot}=await start(f);f.output(Buffer.from(JSON.stringify(policy())+'\n'));await boot;f.output(Buffer.from('{"type":"thread.started"}\n'));
 assert.equal(f.kills,1);await assert.rejects(h.acceptPolicy(ack(),prompt),/policy_accept_invalid/);close(f);assert.equal((await h.completion).tree_cleanup_confirmed,false);
});
test('old v2 launch remains unable to use phased API',async t=>{
 const f=fixture(t,{inputProtocol:undefined,policyNonce:undefined}),h=await f.pending;await assert.rejects(h.bootstrap(),/bootstrap_invalid/);await assert.rejects(h.acceptPolicy(ack(),prompt),/policy_accept_invalid/);assert.ok(!f.input.includes('BOOTSTRAP'));close(f);await h.completion;
});
test('ACK stdin error remains uncertain until close and cannot trigger prompt/retry',async t=>{
 const f=fixture(t),{h,boot}=await start(f);f.output(Buffer.from(JSON.stringify(policy())+'\n'));await boot;const accepted=h.acceptPolicy(ack(),prompt);await turn();const rejected=assert.rejects(accepted,/CONTROLLER_POLICY_ACK_UNCONFIRMED/);
 f.helper.stdin.emit('error',Error('fixture lost input'));assert.equal(f.kills,1);assert.ok(!f.input.includes('\nPROMPT '));await assert.rejects(h.acceptPolicy(ack(),prompt),/policy_accept_invalid/);close(f);await rejected;assert.equal((await h.completion).reason,'CONTROLLER_POLICY_ACK_UNCONFIRMED');
});

test('replayed policy while ACK is pending fences the original prompt before delivery',async t=>{
 const f=fixture(t),{h,boot}=await start(f);f.output(Buffer.from(JSON.stringify(policy())+'\n'));await boot;
 const accepted=h.acceptPolicy(ack(),prompt),rejected=assert.rejects(accepted,/CONTROLLER_POLICY_PROTOCOL_INVALID/);await turn();
 f.output(Buffer.from(JSON.stringify(policy())+'\n'));f.ackWritten();await turn();assert.equal(f.kills,1);assert.ok(!f.input.includes('\nPROMPT '));close(f);await rejected;await h.completion;
});
