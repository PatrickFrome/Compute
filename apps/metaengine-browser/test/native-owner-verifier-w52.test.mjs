import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeOwnerVerifierW52, missingNativeOwnerProtocolsW52 } from '../src/native-owner-verifier-w52.mjs';
import { createOperatorCanonicalNativeBindingReadback } from '../src/operator-canonical-native-w44.mjs';
import { createBrowserGuardianStatusObserver } from '../src/browser-guardian-status-observer.mjs';

// No OS/Guardian/Owner is touched: generated disposable source-only observations.
const at = () => new Date().toISOString();
const born = new Date(Date.now() - 60000).toISOString();
const owner = () => ({ schema:'metaengine.host.owner-incarnation.v1',
  source:'LOCAL_HOST_OWNER', owner_id:'owner-w52',device_id:'device-w52',
  project_id:'project-w52',pid:76543,generation:11,epoch:7,
  process_incarnation_id:'incarnation-w52',created_at:born,observed_at:at(),authority_effect:false });
const kernel = () => ({ source:'OS_PROCESS_INVENTORY',state:'PRESENT',
  pid:76543,process_incarnation_id:'incarnation-w52',created_at:born,
  observed_at:at(),authority_effect:false });
const guardian = () => ({schema:'metaengine.browser-guardian.machine-bootstrap-launcher.v1',
  state:'READY',owner_binding_proven:true,device_binding_proven:true,
  owner_id:'owner-w52',device_id:'device-w52',owner_epoch:7,owner_pid:76543,owner_generation:11,
  owner_created_at:born,owner_process_incarnation_id:'incarnation-w52',
  observed_at:at(),authority_effect:false});
const installed = () => ({source:'INSTALLED_EXE_NATIVE_VERIFIER',native_signature_verified:true,
  release_root_signature_verified:true,slsa_evidence_digest_bound:true,
  package_code_verified:true,package_code_sha256:'d'.repeat(64),
  exact_bytes_verified:true,owner_id:'owner-w52',owner_epoch:7,owner_generation:11,
  process_incarnation_id:'incarnation-w52',source_sha:'a'.repeat(40),installed_exe_sha256:'b'.repeat(64),
  proof_identity:'c'.repeat(64),observed_at:at(),authority_effect:false});
const credential = () => ({source:'NATIVE_OWNER_SECRET_STORE',owner_id:'owner-w52',
  owner_generation:11,api_key:'K'.repeat(64),gateway_base_url:'http://127.0.0.1:15432',authority_effect:false});
const pg = () => ({source:'OWN_PG_POSTMASTER_READBACK',owner_id:'owner-w52',
  owner_epoch:7,postgres_started_at:born,observed_at:at(),authority_effect:false});
function sources(patch = {}) {
  return {readHostOwner:async()=>owner(),readKernelProcess:async()=>kernel(),
    readGuardianOwner:async()=>guardian(),readSignedInstalledExecutable:async()=>installed(),
    readOwnerSecretStore:async()=>credential(),readOwnPostgresBirth:async()=>pg(),...patch};
}
test('W52 real NativeSupervisorClient class exposes no verifier and all six missing native protocols by default', async () => {
  const prior = process.argv;
  let NativeSupervisorClient;
  try {
    process.argv=[...prior,'--metaengine-version-probe'];
    ({NativeSupervisorClient}=await import('../src/native-supervisor-client.mjs'));
  } finally { process.argv=prior; }
  const makeClient = extra => new NativeSupervisorClient({
    identity:{ensure:async()=>({device_id:'device-w52'}),snapshot:()=>({device_id:'device-w52'})},
    fetchImpl:async()=>{throw Error('W52_no_network');},
    getState:async()=>({tabs:[]}),
    executeCommand:async()=>{throw Error('W52_no_effect');},
    ...extra,
  });
  const absent=makeClient();
  assert.equal(absent.getTrustedOperatorOwnerVerifier(),null);
  assert.equal(absent.getTrustedOperatorOwnerProtocolGaps().length,6);
  assert.equal(createOperatorCanonicalNativeBindingReadback({
    nativeVerifier:()=>absent.getTrustedOperatorOwnerVerifier(),
  })().then instanceof Function,true);
  const partial=makeClient({trustedNativeOwnerReaders:{readGuardianOwner:async()=>guardian()}});
  assert.equal(partial.getTrustedOperatorOwnerVerifier(),null);
  assert.equal(partial.getTrustedOperatorOwnerProtocolGaps().length,5);
  const full=makeClient({trustedNativeOwnerReaders:sources()});
  assert.deepEqual(full.getTrustedOperatorOwnerProtocolGaps(),[]);
  assert.equal((await createOperatorCanonicalNativeBindingReadback({
    nativeVerifier:()=>full.getTrustedOperatorOwnerVerifier(),
  })())?.owner_id,'owner-w52');
  // Controlled class injection stays STAGING. These callbacks do not exist in
  // installed Host protocol and cannot substantiate physical LIVE evidence.
});
test('W52 exact kernel birth/generation + Guardian + signed EXE + PG readback are mandatory',async()=>{
  const cases = [
    ['owner invalid', {readHostOwner:async()=>({...owner(),verified:true,pid:0})}],
    ['synthetic owner', {readHostOwner:async()=>({...owner(),fixture_classification:'SYNTHETIC'})}],
    ['kernel pid reused', {readKernelProcess:async()=>({...kernel(),created_at:at()})}],
    ['kernel only claimed incarnation', {readKernelProcess:async()=>{const k=kernel();delete k.process_incarnation_id;return k;}}],
    ['kernel missing', {readKernelProcess:async()=>null}],
    ['guardian shape only', {readGuardianOwner:async()=>({state:'READY',owner_binding_proven:true,device_binding_proven:true,verified:true})}],
    ['guardian epoch mismatch', {readGuardianOwner:async()=>({...guardian(),owner_generation:12})}],
    ['exe digest without native signature', {readSignedInstalledExecutable:async()=>({...installed(),native_signature_verified:false})}],
    ['legacy EXE-only proof', {readSignedInstalledExecutable:async()=>({...installed(),package_code_verified:undefined,package_code_sha256:undefined})}],
    ['package digest changed', {readSignedInstalledExecutable:(()=>{let n=0;return async()=>({...installed(),package_code_sha256:++n===1?'d'.repeat(64):'e'.repeat(64)});})()}],
    ['exe signature flag only', {readSignedInstalledExecutable:async()=>({verified:true,source_sha:'a'.repeat(40)})}],
    ['exe synthetic', {readSignedInstalledExecutable:async()=>({...installed(),fixture_classification:'SYNTHETIC'})}],
    ['exe wrong Owner epoch', {readSignedInstalledExecutable:async()=>({...installed(),owner_epoch:19})}],
    ['EXE changed between receipts', {readSignedInstalledExecutable:(()=>{let n=0;return async()=>({...installed(),installed_exe_sha256:++n===1?'b'.repeat(64):'d'.repeat(64)});})()}],
    ['guardian wrong device', {readGuardianOwner:async()=>({...guardian(),device_id:'another-device'})}],
    ['credential unbound', {readOwnerSecretStore:async()=>({...credential(),owner_generation:12})}],
    ['PG postmaster changed', {readOwnPostgresBirth:(()=>{let n=0;return async()=>({...pg(),postgres_started_at:++n===1?born:at()});})()}],
    ['PG own owner missing', {readOwnPostgresBirth:async()=>({...pg(),owner_id:'other-w52'})}],
    ['Owner generation changed', {readHostOwner:(()=>{let n=0;return async()=>({...owner(),generation:++n===1?11:12});})()}],
  ];
  for(const [name, patch] of cases){
    const binding=await createOperatorCanonicalNativeBindingReadback({
      nativeVerifier: createNativeOwnerVerifierW52(sources(patch)),
    })();
    assert.equal(binding,null,name);
  }
});
test('W52 current production Guardian observer READY is not an Owner PID+birth native receipt',async()=>{
  const status={schema:'metaengine.browser-guardian.machine-bootstrap-launcher.v1',
    state:'READY',ready:true,reason:'GUARDIAN_OWNER_AND_DEVICE_BOUND',
    guardian_service_ready:true,owner_binding_proven:true,device_binding_proven:true,
    explicit_user_action_required:false,uac_consent_required:false,
    fixed_packaged_bootstrap:true,caller_supplied_path_used:false,
    caller_supplied_arguments_used:false,arbitrary_shell_used:false,
    automatic_retry_allowed:false,authority_effect:false};
  const obs=createBrowserGuardianStatusObserver({readStatus:async()=>status});
  // Current native Guardian status intentionally omits canonical Owner process
  // incarnation, PID and birth; a READY flag must never invent them.
  const v=createNativeOwnerVerifierW52(sources({readGuardianOwner:()=>Promise.resolve(status)}));
  assert.equal(await v.readGuardian(),null);
  assert.equal((await createOperatorCanonicalNativeBindingReadback({nativeVerifier:v})()),null);
  assert.equal(missingNativeOwnerProtocolsW52({readGuardianOwner:async()=>obs.snapshot()} ).length,5);
});

test('W52 existing signed Guardian challenge wire proves device binding but exposes no canonical Owner generation',async()=>{
  const {BrowserGuardianUpdateActuatorClient}=await import('../src/browser-guardian-update-actuator-client.mjs');
  let wire=null;
  const client=new BrowserGuardianUpdateActuatorClient({
    identity:{
      guardianOwnerChallenge:async()=>({
        public_jwk:{kty:'EC',crv:'P-256',x:'A'.repeat(43),y:'B'.repeat(43)},
        signature:'C'.repeat(86),key_fingerprint_sha256:'f'.repeat(64),
      }),
      guardianUpdateActuatorProof:async()=>{throw Error('unexpected_mutation_proof');},
    },
    transport:async(value)=>{
      wire=value;
      return {schema:'metaengine.browser-guardian.update-actuator-result.v1',
        state:'OWNER_BOUND',owner_binding_proven:true,device_binding_proven:true,
        effect_absent_proven:true,device_key_fingerprint_sha256:'f'.repeat(64),
        automatic_retry_allowed:false,caller_supplied_path_used:false,
        caller_supplied_url_used:false,caller_supplied_shell_used:false,
        authority_effect:false};
    },
  });
  const result=await client.observeOwner({
    command_id:'00000000-0000-4000-8000-000000000052',
    request_nonce:'N'.repeat(43),
  });
  assert.match(wire,/wire_schema=metaengine.browser-guardian.owner-challenge-request.v1/);
  assert.match(wire,/public_jwk_x=/);
  assert.match(wire,/signature=/);
  assert.equal(result.state,'OWNER_BOUND');
  // This authenticated existing protocol lacks owner_id, epoch, PID, created_at
  // and incarnation; no equivalent Owner-qualified READY may be synthesized.
  const verifier=createNativeOwnerVerifierW52(sources({readGuardianOwner:async()=>result}));
  assert.equal(await verifier.readGuardian(owner()),null);
});
