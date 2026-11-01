import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {createCodexCliWindowsProcessController} from '../src/codex-cli-windows-process-controller.mjs';
import {codexCliEnvironment} from '../src/codex-cli-runner.mjs';
import {withOwnedCodexCliProcess} from './fixtures/with-owned-codex-cli-process.mjs';

// A real Node worker stands in for the CLI producer. This checks native pipe,
// phase and Job lifetime mechanics only, never policy qualification/model work.
const native={skip:process.platform!=='win32',timeout:60000};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const nonce='a'.repeat(64),context='019a4d12-1234-7abc-8def-0123456789ab';
const policy={type:'metaengine.effective_policy.v1',nonce,context_id:context,mode:'execute',
  strict_config:true,thread_start_overrides:[],policy:{description:'split UTF-8: привет'}};
const ack=Buffer.from(JSON.stringify({type:'metaengine.effective_policy.accept.v1',nonce,context_id:context})+'\n');

async function fixture(t,prompt,timeoutMs=10000) {
  const temporary=await fs.realpath(os.tmpdir());
  const directory=await fs.realpath(await fs.mkdtemp(path.join(temporary,'metaengine-policy-native-')));
  t.after(async()=>{
    assert.equal(await fs.realpath(directory),directory);
    assert.equal(path.dirname(directory),temporary);
    assert.ok(path.basename(directory).startsWith('metaengine-policy-native-'));
    await fs.rm(directory,{recursive:true,force:false});
  });
  const marker=path.join(directory,'activity-after-ack.txt');
  const spec={executablePath:process.execPath,expectedExecutableSha256:hash(await fs.readFile(process.execPath)),
    cwd:directory,env:codexCliEnvironment(path.join(directory,'unused-auth')),timeoutMs,runId:randomUUID(),
    promptSha256:hash(prompt),inputProtocol:'EFFECTIVE_POLICY_ACK_V1',policyNonce:nonce};
  return {spec,marker};
}

function producer(marker,{consume=true,emit=true}={}) {
  return `const fs=require('node:fs'),crypto=require('node:crypto');`
    + (emit?`const policy=Buffer.from(${JSON.stringify(JSON.stringify(policy)+'\n')});`
      // Keep an actual split UTF-8 code point without multiplying the Windows
      // timer quantum by every byte and consuming the prompt test's deadline.
      + `const cut=policy.findIndex(b=>b>=0x80)+1;const chunks=[policy.subarray(0,cut),policy.subarray(cut,cut+1),policy.subarray(cut+1)];`
      + `let i=0;const emit=()=>{if(i<chunks.length){fs.writeSync(1,chunks[i++]);setImmediate(emit);}};emit();`:'')
    + (consume?`let pending=Buffer.alloc(0),accepted=false;process.stdin.on('data',b=>{pending=Buffer.concat([pending,b]);`
      + `if(!accepted){const n=pending.indexOf(10);if(n<0)return;const ack=JSON.parse(pending.subarray(0,n).toString('utf8'));`
      + `if(ack.type!=='metaengine.effective_policy.accept.v1'||ack.nonce!==${JSON.stringify(nonce)}||ack.context_id!==${JSON.stringify(context)})process.exit(45);`
      + `pending=pending.subarray(n+1);accepted=true;}});process.stdin.on('end',()=>{if(!accepted)process.exit(46);`
      + `const digest=crypto.createHash('sha256').update(pending).digest('hex');fs.writeFileSync(${JSON.stringify(marker)},digest);`
      + `fs.writeSync(1,JSON.stringify({type:'done',prompt_sha256:digest})+'\\n');`
      + `const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});`
      + `child.once('spawn',()=>process.exit(0));});`:`setInterval(()=>{},1000);`);
}

test('real Windows bootstrap leaves stdin open and empty, then writes one ACK and the unchanged original prompt before joining descendants',native,async t=>{
  const prompt='original prompt: Привет\n'+'p'.repeat(8192),{spec,marker}=await fixture(t,prompt);
  await withOwnedCodexCliProcess(createCodexCliWindowsProcessController(),{...spec,args:['-e',producer(marker)]},async handle=>{
    let output='';handle.stdout.on('data',b=>{output+=b.toString()});handle.stderr.resume();
    const event=await handle.bootstrap();
    assert.equal(event.toString('utf8'),JSON.stringify(policy));
    assert.equal(output,'','policy producer frame is not ordinary task output');
    await assert.rejects(fs.stat(marker),{code:'ENOENT'});
    await handle.acceptPolicy(ack,prompt);
    const terminal=await handle.completion;
    assert.equal(terminal.exit_code,0);assert.equal(terminal.reason,null);
    assert.equal(terminal.tree_cleanup_confirmed,true);assert.equal(terminal.pipes_drained,true);
    assert.equal(terminal.job_accounting.active_processes,0);
    assert.ok(terminal.job_accounting.total_processes>=2);
    assert.equal(terminal.joined_settlement.parent_join.transport,'STDIO_CLOSE_DRAINED');
    assert.equal(await fs.readFile(marker,'utf8'),hash(prompt));
    assert.equal(output,JSON.stringify({type:'done',prompt_sha256:hash(prompt)})+'\n');
    await assert.rejects(handle.acceptPolicy(ack,prompt));
  });
});

test('real Windows stop after policy joins the job without delivering ACK or prompt',native,async t=>{
  const {spec,marker}=await fixture(t,'do not deliver');
  await withOwnedCodexCliProcess(createCodexCliWindowsProcessController(),{...spec,args:['-e',producer(marker)]},async handle=>{
    handle.stdout.resume();handle.stderr.resume();await handle.bootstrap();
    await handle.terminate('CANCELLED');const terminal=await handle.completion;
    assert.equal(terminal.reason,'CANCELLED');assert.equal(terminal.tree_cleanup_confirmed,true);
    assert.equal(terminal.job_accounting.active_processes,0);
    await assert.rejects(fs.stat(marker),{code:'ENOENT'});
  });
});

test('real Windows missing policy hits the original native execution deadline and joins the empty-input writer',native,async t=>{
  const {spec,marker}=await fixture(t,'never delivered',1000);
  await withOwnedCodexCliProcess(createCodexCliWindowsProcessController(),{...spec,args:['-e',producer(marker,{emit:false,consume:false})]},async handle=>{
    handle.stdout.resume();handle.stderr.resume();
    await assert.rejects(handle.bootstrap());const terminal=await handle.completion;
    assert.equal(terminal.reason,'TIMEOUT');assert.equal(terminal.tree_cleanup_confirmed,true);
    assert.equal(terminal.job_accounting.active_processes,0);
    await assert.rejects(fs.stat(marker),{code:'ENOENT'});
  });
});

test('real Windows an unconsumed prompt remains deadline bounded and cannot claim confirmed delivery',native,async t=>{
  const prompt='p'.repeat(65536),{spec,marker}=await fixture(t,prompt,2500);
  await withOwnedCodexCliProcess(createCodexCliWindowsProcessController(),{...spec,args:['-e',producer(marker,{consume:false})]},async handle=>{
    handle.stdout.resume();handle.stderr.resume();await handle.bootstrap();
    await assert.rejects(handle.acceptPolicy(ack,prompt));const terminal=await handle.completion;
    assert.equal(terminal.tree_cleanup_confirmed,false);assert.equal(terminal.joined_settlement,undefined);
    await assert.rejects(fs.stat(marker),{code:'ENOENT'});
  });
});

for(const options of [{},{emit:false,consume:false},{consume:false}])test('generated physical producer parses '+JSON.stringify(options),()=>{
  new vm.Script(producer('/fixture/activity-after-ack.txt',options));
});

test('generated split UTF8 producer uses a fixed number of immediate turns, not per-byte Windows timers',()=>{
  const writes=[],immediates=[],intervals=[];
  const fakeFs={writeSync(fd,bytes){assert.equal(fd,1);writes.push(Buffer.from(bytes));}};
  vm.runInNewContext(producer('/fixture/never-written.txt',{consume:false}),{
    Buffer,require:name=>{if(name==='node:fs')return fakeFs;if(name==='node:crypto')return {};throw Error('unexpected fixture dependency');},
    setImmediate:fn=>immediates.push(fn),setInterval:(_fn,delay)=>{intervals.push(delay);return 1;},
  });
  for(let n=0;immediates.length&&n<5;n++)immediates.shift()();
  assert.equal(immediates.length,0);assert.equal(writes.length,3);
  assert.deepEqual(Buffer.concat(writes),Buffer.from(JSON.stringify(policy)+'\n'));
  assert(writes[0].at(-1)>=0xc0&&writes[1][0]>=0x80&&writes[1][0]<0xc0,'actual UTF8 code point is split across writes');
  assert.deepEqual(intervals,[1000],'only the idle worker keepalive uses a timer');
});
