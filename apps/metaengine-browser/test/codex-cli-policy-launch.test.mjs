import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCodexCliLaunch,validateCodexCliLaunch,codexCliLaunchIdentity,codexCliLaunchWire,validateCodexCliJoinedSettlement,CODEX_CLI_JOB_PROTOCOL} from '../src/codex-cli-physical-settlement.mjs';
import {nativeCodingCanonicalJson as canonical} from '../src/native-coding-task-context.mjs';
import {joinedSettlementFixture} from './fixtures/codex-cli-joined-settlement-fixture.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
const requestId='11111111-1111-4111-8111-111111111111';
const fixture=()=>({runId:'22222222-2222-4222-8222-222222222222',executablePath:'/fixture/codex.exe',args:['exec','-'],
 cwd:'/fixture/worktree',timeoutMs:1000,expectedExecutableSha256:'a'.repeat(64),promptSha256:hash('original private prompt'),binding:{role:'IMPLEMENTER'}});
const phased=()=>({...fixture(),inputProtocol:'EFFECTIVE_POLICY_ACK_V1',policyNonce:'b'.repeat(64)});
const wrap=body=>{const canonical_body=canonical(body);return {schema:body.schema,canonical_body,request_sha256:hash(canonical_body)};};

test('legacy launch remains byte-compatible and readback does not acquire phased execution',()=>{
 const spec=fixture(),launch=createCodexCliLaunch(spec,{requestId});
 const body={schema:'metaengine.codex-cli.launch.v2',request_id:requestId,run_id:spec.runId,executable_path:spec.executablePath,args:spec.args,cwd:spec.cwd,
  timeout_ms:spec.timeoutMs,expected_sha256:spec.expectedExecutableSha256,deadline_ms:'',prompt_sha256:spec.promptSha256,binding_sha256:hash(canonical(spec.binding))};
 assert.deepEqual(launch,wrap(body));assert.deepEqual(validateCodexCliLaunch(launch,spec),body);
 assert.throws(()=>validateCodexCliLaunch(launch,phased()),/launch_spec_changed/);
});

test('phase mode and nonce bind the launch request without changing original prompt identity',()=>{
 const spec=phased(),launch=createCodexCliLaunch(spec,{requestId}),body=validateCodexCliLaunch(launch,spec);
 assert.equal(launch.schema,'metaengine.codex-cli.launch.v3');assert.equal(body.schema,launch.schema);
 assert.equal(body.input_protocol,spec.inputProtocol);assert.equal(body.policy_nonce,spec.policyNonce);
 assert.equal(body.prompt_sha256,hash('original private prompt'));
 assert.deepEqual(Object.keys(codexCliLaunchIdentity(launch)).sort(),['binding_sha256','prompt_sha256','request_id','request_sha256','run_id']);
 assert.equal(codexCliLaunchIdentity(launch).prompt_sha256,spec.promptSha256);
 assert.notEqual(launch.request_sha256,createCodexCliLaunch({...spec,policyNonce:'c'.repeat(64)},{requestId}).request_sha256);
 assert.throws(()=>validateCodexCliLaunch(launch,fixture()),/launch_spec_changed/);
 assert.throws(()=>validateCodexCliLaunch(launch,{...spec,policyNonce:'c'.repeat(64)}),/launch_spec_changed/);
 assert.equal(codexCliLaunchWire(launch).schema,launch.schema);
 assert.equal(CODEX_CLI_JOB_PROTOCOL,'REQUEST_BOUND_POLICY_STDIO_V3');
});

test('v3 launch keeps historical terminal shape and joins only its original request',()=>{
 const spec=phased(),f=joinedSettlementFixture(spec),result=f.complete();
 assert.equal(result.joined_settlement.native_terminal.schema,'metaengine.codex-cli.native-terminal.v2');
 assert.deepEqual(validateCodexCliJoinedSettlement(result.joined_settlement,{proof:f.proof,launch:f.launch}),result.joined_settlement);
 const changed=createCodexCliLaunch({...spec,policyNonce:'c'.repeat(64)},{requestId:codexCliLaunchIdentity(f.launch).request_id});
 assert.throws(()=>validateCodexCliJoinedSettlement(result.joined_settlement,{proof:f.proof,launch:changed}),/joined_binding/);
});

for(const [name,change] of [
 ['missing nonce',s=>{delete s.policyNonce;}],['nonce without mode',s=>{delete s.inputProtocol;}],
 ['unknown mode',s=>{s.inputProtocol='OTHER';}],['null mode',s=>{s.inputProtocol=null;}],
 ['uppercase nonce',s=>{s.policyNonce='A'.repeat(64);}],['short nonce',s=>{s.policyNonce='a'.repeat(63);}],
 ['non-string nonce',s=>{s.policyNonce=1;}],
])test('launch rejects '+name,()=>{const spec=phased();change(spec);assert.throws(()=>createCodexCliLaunch(spec,{requestId}),/launch_input_protocol/);});

for(const [name,change] of [
 ['v2 body carrying phase fields',b=>{b.schema='metaengine.codex-cli.launch.v2';}],
 ['v3 body without phase fields',b=>{delete b.input_protocol;delete b.policy_nonce;}],
 ['unknown input mode',b=>{b.input_protocol='OTHER';}],['malformed nonce',b=>{b.policy_nonce='F'.repeat(64);}],
 ['unexpected field',b=>{b.verified=true;}],
])test('historical validator rejects '+name,()=>{const body=JSON.parse(createCodexCliLaunch(phased(),{requestId}).canonical_body);change(body);assert.throws(()=>validateCodexCliLaunch(wrap(body)),/launch_body/);});
