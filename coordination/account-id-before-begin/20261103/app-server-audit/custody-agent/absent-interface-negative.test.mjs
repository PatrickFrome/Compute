// Audit-only negative checks of existing production contracts.
// Every record below is GENERATED TEST DATA, never authentication or native proof.
// No account producer, process launch, credentials, filesystem auth, network or DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const sourceRoot=path.resolve(process.env.METAENGINE_SOURCE_ROOT || process.cwd());
const fromSource=relative=>import(pathToFileURL(path.join(sourceRoot,relative)).href);
const {validateNativeSetupInput}=await fromSource('apps/metaengine-browser/src/native-coding-setup-contract.mjs');
const {readCodexCliWindowsProcessCustody}=await fromSource('apps/metaengine-browser/src/codex-cli-windows-process-controller.mjs');
const {createCodexCliLaunch}=await fromSource('apps/metaengine-browser/src/codex-cli-physical-settlement.mjs');
const {validateInitialPrivateFacts,createInitialNativeSetupSelection}=await fromSource('apps/metaengine-browser/src/native-coding-initial-selection-contract.mjs');
const {initialFixture,choice,uuid}=await fromSource('apps/metaengine-browser/test/native-coding-initial-setup-fixture.mjs');

test('existing exact Host BEGIN input refuses added account/home/session records',()=>{
  const base={workspace_id:'10000000-0000-4000-8000-000000000001',operation_id:'10000000-0000-4000-8000-000000000002',
    repository_scope_sha256:'0'.repeat(64),repo_root_identity_sha256:'1'.repeat(64),managed_root_identity_sha256:'2'.repeat(64)};
  assert.doesNotThrow(()=>validateNativeSetupInput('BEGIN_NATIVE_SETUP_V1',base));
  for(const [key,value] of [['account_id',null],['codex_home',null],['auth_session',null],['account_observation',null]])
    assert.throws(()=>validateNativeSetupInput('BEGIN_NATIVE_SETUP_V1',{...base,[key]:value}),/native_setup_input_invalid/);
});

test('public records, copied records and proxies cannot create original process custody',()=>{
  const record=Object.freeze({schema:'metaengine.codex-cli.original-process-custody.v1',environment_scope:'ORIGINAL_HELPER_SPAWN_INPUT'});
  for(const candidate of [record,structuredClone(record),new Proxy(record,{}),null,undefined])
    assert.equal(readCodexCliWindowsProcessCustody(candidate),null);
});

test('existing launch rejects an invented app-server RPC input protocol',()=>{
  assert.throws(()=>createCodexCliLaunch({inputProtocol:'APP_SERVER_JSON_RPC_V1'}),/codex_cli_settlement_launch_input_protocol/);
});

// Minimal GENERATED usage read snapshots, with no email or percentage claims.
// These are data supplied to denial tests, not replies from a real connection.
const usageBase=()=>({rateLimits:{},rateLimitsByLimitId:null,ordinaryUsageAllowed:null,
  rateLimitUpsell:null,rateLimitResetCredits:null});
for(const [name,account] of [
  ['omitted',{}],['null',{accountId:null}],['string',{accountId:'generated-usage-workspace'}],
])test('raw usage snapshot with '+name+' accountId cannot become private codex_auth',()=>{
  const {facts}=initialFixture({authState:'PRODUCER_UNAVAILABLE'});
  const rawUsage={...usageBase(),...account};
  assert.throws(()=>validateInitialPrivateFacts({...facts,codex_auth:rawUsage}),/native_initial_selection_private_facts_invalid/);
});

test('matching claimed usage accountId cannot bypass PRODUCER_UNAVAILABLE before ID allocation',()=>{
  const usage={...usageBase(),accountId:'generated-usage-workspace'};
  const {registered,facts,stateDirectory}=initialFixture({authState:'PRODUCER_UNAVAILABLE'});
  assert.deepEqual(validateInitialPrivateFacts(facts).codex_auth,{state:'PRODUCER_UNAVAILABLE',account_id:null});
  const proposalId=uuid(9001);let allocated=0;
  assert.throws(()=>createInitialNativeSetupSelection({registeredRepository:registered,privateFacts:facts,stateDirectory,
    uiChoice:choice(proposalId,{accountId:usage.accountId}),proposalId,randomUUID:()=>{allocated++;return uuid(9002+allocated);}}),
    /native_initial_selection_codex_account_producer_unavailable/);
  assert.equal(allocated,0);
});
