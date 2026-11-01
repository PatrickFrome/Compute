import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RELEASE_PROOF_FILES_W77, RELEASE_PROOF_SIGNER_BLOCK_W77,
  probeProductionReleaseProofW77, validateSlsaEvidenceBytesW77,
  validateExistingProducerReceiptW77, serializeReleaseManifestW77,
  createExternalReleaseProofHandoffW77, emitStagingReleaseProofW77, buildPinnedGhVerifyArgsW77, prepareIndependentlyVerifiedReleaseInputsW77,
  parseUntrustedReleaseSignerResultW77,
} from '../scripts/release-proof-producer-w77.mjs';
import {
  INSTALLED_RELEASE_SIGNATURE_DOMAIN_W68,
  verifyStagingInstalledExecutableW68,
} from '../src/installed-executable-provenance-w68.mjs';

import { capturePackageCodeW68 } from '../src/installed-package-code-w68.mjs';

const VERSION = '0.7.0-dev.999900003.1';
const SHA = 'a'.repeat(40);
const THUMB = 'b'.repeat(40);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const ROOT_SCHEMA = 'metaengine.emergency-maintenance-trust-root.v1';
async function fixture() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'metaengine-w77-SOURCE-STAGING-')));
  const exe = path.join(dir, 'METAENGINE Browser Test.exe');
  const installer = path.join(dir, 'METAENGINE-Browser-Test-Setup-' + VERSION + '-x64.exe');
  const bundle = path.join(dir, RELEASE_PROOF_FILES_W77.bundle);
  const evidence = path.join(dir, RELEASE_PROOF_FILES_W77.evidence);
  const pair = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(exe, crypto.randomBytes(1047));
  fs.writeFileSync(installer, crypto.randomBytes(2031));
  fs.mkdirSync(path.join(dir, 'resources'), {recursive:true});
  fs.writeFileSync(path.join(dir, 'resources/app.asar'), 'fixture packaged JS');
  const packageCode = await capturePackageCodeW68(dir, {sourceSha:SHA,version:VERSION,exeName:path.basename(exe)});
  fs.writeFileSync(path.join(dir, RELEASE_PROOF_FILES_W77.packageCode), packageCode.bytes);
  fs.writeFileSync(bundle, JSON.stringify({
    mediaType:'application/vnd.dev.sigstore.bundle.v0.3+json',
    dsseEnvelope: { signatures: [{ sig: 'synthetic-stage-not-cryptographic-SLSA' }] },
  }));
  fs.writeFileSync(evidence, JSON.stringify({
    schema:'metaengine.browser-fabric.provenance-evidence.v1',
    verified:true, builder_trusted:true, authority_effect:false,
    source_sha:SHA, predicate_type:'https://slsa.dev/provenance/v1',
    subject_name:path.basename(installer), subject_sha256:hash(fs.readFileSync(installer)),
  }));
  const root = {
    schema: ROOT_SCHEMA, build_sha: SHA,
    ed25519_public_key_pem:pair.publicKey.export({type:'spki',format:'pem'}).toString(),
    public_key_spki_sha256:hash(pair.publicKey.export({type:'spki',format:'der'})),
  };
  const args = { outputDir:dir, exePath:exe, installerPath:installer,
    bundlePath:bundle, evidencePath:evidence, sourceSha:SHA, version:VERSION,
    signerThumbprint:THUMB, testPrivateKey:pair.privateKey };
  const native = async () => ({native_signature_verified:true,exact_bytes_verified:true,
    installed_exe_sha256:hash(fs.readFileSync(exe)), signer_thumbprint:THUMB});
  return { dir,exe,installer,bundle,evidence,root,args,native,
    emit() { return emitStagingReleaseProofW77(args); },
    verify() { return verifyStagingInstalledExecutableW68({
      executable:exe,version:VERSION,testTrustRoot:root,testNativeRead:native,
    }); },
    dispose() { fs.rmSync(dir,{recursive:true,force:true}); } };
}
async function withFixture(fn) {
  const f = await fixture();
  try { await fn(f); } finally { f.dispose(); }
}

test('producer emits exact W68 external domain/manifests; actual consumer Ed25519 roundtrip is STAGING only', async () => {
  await withFixture(async f => {
    const stage = await f.emit();
    assert.equal(stage.fixture_classification, 'STAGING');
    assert.equal(stage.release_authorized, false);
    assert.equal(stage.installed_authority, false);
    assert.equal(stage.handoff.never_embed_installer_self_digest, true);
    assert.equal(stage.handoff.installed_placement_verified, false);
    const proof = await f.verify();
    assert.equal(proof?.fixture_classification, 'STAGING');
    assert.equal(proof?.release_root_signature_verified, true);
    assert.equal(proof?.independent_slsa_crypto_verified_at_runtime, false);
    assert.equal(proof?.source_sha, SHA);
    assert.equal(proof?.package_version, VERSION);
    assert.equal(proof?.installed_exe_sha256, hash(fs.readFileSync(f.exe)));
    assert.equal(proof?.signer_thumbprint, THUMB);
    const envelope = JSON.parse(fs.readFileSync(stage.envelope_path, 'utf8'));
    const canonical = serializeReleaseManifestW77(envelope.manifest);
    assert.ok(canonical.subarray(0, Buffer.byteLength(INSTALLED_RELEASE_SIGNATURE_DOMAIN_W68))
      .equals(Buffer.from(INSTALLED_RELEASE_SIGNATURE_DOMAIN_W68)));
    assert.ok(crypto.verify(null, canonical,
      crypto.createPublicKey(f.root.ed25519_public_key_pem),
      Buffer.from(envelope.signature_base64,'base64')));
    assert.equal(stage.handoff.final_installer_sha256,hash(fs.readFileSync(f.installer)));
    assert.equal(stage.handoff.detached_sidecar_files.length,4);
  });
});

test('production stays BLOCKED absent existing protected signing and external install placement custody', () => {
  const proof = probeProductionReleaseProofW77();
  assert.equal(proof.production_sidecars_emitted,false);
  assert.equal(proof.release_authorized,false);
  assert.ok(proof.missing_capabilities.includes(RELEASE_PROOF_SIGNER_BLOCK_W77));
  assert.ok(proof.missing_capabilities.includes('EXTERNAL_SIDECAR_INSTALLED_PLACEMENT_UNPROVEN'));
});

test('two historical reserved versions cannot sign even staging manifests', async () => {
  for (const bad of ['0.7.0-dev.842024784850.1','0.7.0-dev.37781000062.1']) {
    await withFixture(async f => {
      await assert.rejects(() => emitStagingReleaseProofW77({...f.args,version:bad}),/source_or_version|reserved_or_invalid_version/);
    });
  }
});

test('source, signer, subject, SLSA fields and wrong domain do not pass production-reader roundtrip', async () => {
  await withFixture(async f => {
    const st=await f.emit();
    const original = fs.readFileSync(st.envelope_path,'utf8');
    assert.ok(await f.verify());
    const changes = [
      file => { const b=fs.readFileSync(file);b[0]^=1;fs.writeFileSync(file,b); },
    ];
    changes[0](f.exe);
    assert.equal(await f.verify(),null,'EXE tamper');
    fs.writeFileSync(f.exe, crypto.randomBytes(1047));
    assert.equal(await f.verify(),null,'different EXE digest still fails');
    fs.writeFileSync(st.envelope_path, original);
    let doc=JSON.parse(original);
    doc.manifest.source_sha='c'.repeat(40);
    fs.writeFileSync(st.envelope_path,JSON.stringify(doc));
    assert.equal(await f.verify(),null,'source mutation');
    doc=JSON.parse(original);
    doc.manifest.signer_thumbprint='c'.repeat(40);
    fs.writeFileSync(st.envelope_path,JSON.stringify(doc));
    assert.equal(await f.verify(),null,'signer mutation');
    doc=JSON.parse(original);
    doc.signature_base64='a'.repeat(86)+'==';
    fs.writeFileSync(st.envelope_path,JSON.stringify(doc));
    assert.equal(await f.verify(),null,'signature mutation');
  });
});

test('SLSA bundle, evidence, installer, source, package and signer tampering is refused', async () => {
  for (const action of [
    f => fs.appendFileSync(f.bundle,' '),
    f => fs.appendFileSync(f.evidence,' '),
    f => { const e=JSON.parse(fs.readFileSync(f.evidence));e.source_sha='f'.repeat(40);
      fs.writeFileSync(f.evidence,JSON.stringify(e)); },
    f => { const e=JSON.parse(fs.readFileSync(f.evidence));e.subject_sha256='f'.repeat(64);
      fs.writeFileSync(f.evidence,JSON.stringify(e)); },
  ]) {
    await withFixture(async f => { await f.emit();action(f);assert.equal(await f.verify(),null); });
  }
  await withFixture(async f => {
    fs.appendFileSync(f.installer,'different artifact');
    await assert.rejects(()=>f.emit(),/slsa_semantics/);
  });
  await withFixture(async f => {
    await assert.rejects(()=>emitStagingReleaseProofW77({...f.args,signerThumbprint:'f'.repeat(39)}),
      /signer_thumbprint/);
  });
});

test('non-canonical file path, symlink/reparse and pre-existing envelope fail closed', async t => {
  await withFixture(async f => {
    await f.emit();
    await assert.rejects(()=>f.emit(),/staging_output_already_exists/);
    await assert.rejects(()=>emitStagingReleaseProofW77({
      ...f.args,exePath:path.join(f.dir,'..','METAENGINE Browser Test.exe'),
    }),/file_path/);
  });
  await withFixture(async f => {
    const outside=path.join(f.dir,'real-bundle.json');
    fs.renameSync(f.bundle,outside);
    try {fs.symlinkSync(outside,f.bundle,'file');}
    catch(e) {if(['EPERM','EACCES'].includes(e?.code)) return t.skip('symlink creation unavailable');throw e;}
    await assert.rejects(()=>f.emit(),/unsafe_artifact_path/);
  });
});

test('existing immutable SLSA producer receipt binds exact source/ref/workflow/run/artifact', async () => {
  await withFixture(async f => {
    const name=path.basename(f.installer);
    const receipt={
      schema:'metaengine.browser.package-slsa-provenance-receipt.v1',
      source_head:SHA, source_ref:'refs/heads/physical/build-slsa-provenance-v1',
      event:'push',workflow:'.github/workflows/browser-windows-package-smoke.yml',
      run_id: 123,run_number:4,run_attempt:2,package_version:VERSION,
      installer_name:name, installer_sha256:hash(fs.readFileSync(f.installer)),
      attestation_id:'fixture',attestation_url:'fixture',
      bundle_name:RELEASE_PROOF_FILES_W77.bundle,
      promotion_authorized:false,release_published:false,authority_effect:false,
    };
    const call=(row,expectId=123,expectAttempt=2)=>validateExistingProducerReceiptW77({
      receipt:row,sourceSha:SHA,version:VERSION,installerName:name,
      installerSha:receipt.installer_sha256,
      expectedRunId:expectId,expectedAttempt:expectAttempt,
    });
    assert.equal(call(receipt),true);
    for (const [k,v] of [
      ['source_head','f'.repeat(40)],['source_ref','refs/heads/main'],
      ['workflow','.github/workflows/malicious.yml'],['run_id',124],
      ['installer_sha256','f'.repeat(64)],['package_version','0.7.0-dev.99.1'],
      ['promotion_authorized',true],['authority_effect',true]
    ]) {
      assert.throws(()=>call({...receipt,[k]:v}),/producer_receipt/,k);
    }
    assert.throws(()=>call(receipt,124),/producer_receipt/);
    assert.throws(()=>call(receipt,123,3),/producer_receipt/);
  });
});

test('semantic JSON verified:true is explicitly not independent GH SLSA cryptographic proof', async () => {
  await withFixture(async f => {
    const s=validateSlsaEvidenceBytesW77({
      evidenceBytes:fs.readFileSync(f.evidence),bundleBytes:fs.readFileSync(f.bundle),
      installerBytes:fs.readFileSync(f.installer),sourceSha:SHA,version:VERSION,
      installerName:path.basename(f.installer),
    });
    assert.equal(s.semantic_shape_checked_only,true);
    assert.equal(s.cryptographic_verification_claimed,false);
  });
});


test('actual production GH verifier command pins repo, workflow, source, issuer, runner and SLSA predicate', () => {
  const args=buildPinnedGhVerifyArgsW77({
    installer:path.resolve('generated-temp-installer.exe'),
    bundle:path.resolve('generated-temp-bundle.json'),
    sourceSha:SHA,
  });
  assert.equal(args[0],'attestation');
  assert.equal(args[1],'verify');
  for (const term of [
    'PatrickFrome/Compute',
    'PatrickFrome/Compute/.github/workflows/browser-windows-package-smoke.yml',
    '--signer-digest','--source-digest','--source-ref','refs/heads/physical/build-slsa-provenance-v1',
    '--cert-oidc-issuer','https://token.actions.githubusercontent.com',
    '--deny-self-hosted-runners','--predicate-type','https://slsa.dev/provenance/v1',
  ]) assert.ok(args.includes(term), term);
  assert.equal(args[args.indexOf('--source-digest')+1],SHA);
  assert.equal(args[args.indexOf('--signer-digest')+1],SHA);
  assert.throws(()=>buildPinnedGhVerifyArgsW77({
    installer:'relative.exe',bundle:path.resolve('bundle.json'),sourceSha:SHA,
  }),/gh_cli_arguments/);
});

test('production GH path cannot be reached through synthetic fixture on unsupported hosts or reserved versions', async () => {
  if (process.platform !== 'win32') {
    await assert.rejects(()=>prepareIndependentlyVerifiedReleaseInputsW77({}),/windows_only/);
  } else {
    await assert.rejects(()=>prepareIndependentlyVerifiedReleaseInputsW77({
      sourceSha:SHA,version:'0.7.0-dev.37781000062.1',
      packagedTrustRoot:{build_sha:SHA},
    }),/trusted_source_binding/);
  }
});

test('producer refuses missing or stale code inventory before it can emit even a fixture signature', async () => {
  await withFixture(async f => {
    fs.writeFileSync(path.join(f.dir,'resources/app.asar'),'changed packaged JS');
    await assert.rejects(()=>f.emit(),/tree_mismatch/);
    assert.equal(fs.existsSync(path.join(f.dir,RELEASE_PROOF_FILES_W77.envelope)),false);
  });
  await withFixture(async f => {
    fs.rmSync(path.join(f.dir,RELEASE_PROOF_FILES_W77.packageCode));
    await assert.rejects(()=>f.emit(),/ENOENT/);
    assert.equal(fs.existsSync(path.join(f.dir,RELEASE_PROOF_FILES_W77.envelope)),false);
  });
});

test('canonical release signing bytes reject accessor drift and hidden fields', () => {
  const good = {
    schema:'metaengine.browser.installed-release-manifest.v2',
    source_sha:SHA, package_version:VERSION, exe_name:'METAENGINE Browser Test.exe',
    exe_sha256:'1'.repeat(64), signer_thumbprint:THUMB,
    installer_sha256:'2'.repeat(64), slsa_bundle_sha256:'3'.repeat(64),
    slsa_evidence_sha256:'4'.repeat(64), package_code_sha256:'5'.repeat(64),
  };
  const canonical = serializeReleaseManifestW77(good);
  assert.equal(canonical.toString('utf8'),
    INSTALLED_RELEASE_SIGNATURE_DOMAIN_W68 + JSON.stringify(good));
  let reads=0;
  const swapping={...good};
  Object.defineProperty(swapping,'source_sha',{enumerable:true, configurable:true,
    get() { return ++reads===1 ? SHA : 'f'.repeat(40); }});
  assert.throws(()=>serializeReleaseManifestW77(swapping),/w77_release_proof_manifest_/,
    'an accessor may return valid data for validation and different bytes for signature');
  const hidden={...good};
  Object.defineProperty(hidden,'extra_authority',{value:true,enumerable:false});
  assert.throws(()=>serializeReleaseManifestW77(hidden),/w77_release_proof_manifest_/);
  const symbol={...good,[Symbol('hidden-signing-claim')]:true};
  assert.throws(()=>serializeReleaseManifestW77(symbol),/w77_release_proof_manifest_/);
});

test('external handoff fields match the same validated manifest snapshot, not later proxy reads', () => {
  const good = {
    schema:'metaengine.browser.installed-release-manifest.v2',
    source_sha:SHA, package_version:VERSION, exe_name:'METAENGINE Browser Test.exe',
    exe_sha256:'1'.repeat(64), signer_thumbprint:THUMB,
    installer_sha256:'2'.repeat(64), slsa_bundle_sha256:'3'.repeat(64),
    slsa_evidence_sha256:'4'.repeat(64), package_code_sha256:'5'.repeat(64),
  };
  const untrusted = new Proxy(good, {
    get(target, prop, receiver) {
      if (prop === 'source_sha') return 'f'.repeat(40);
      if (prop === 'installer_sha256') return '0'.repeat(64);
      return Reflect.get(target, prop, receiver);
    },
  });
  const stable = createExternalReleaseProofHandoffW77(untrusted);
  assert.equal(stable.source_sha, SHA);
  assert.equal(stable.final_installer_sha256, good.installer_sha256);
  assert.equal(stable.installed_placement_verified, false);
  assert.equal(stable.release_authorized, false);
});

test('external signer result v1 has an exact canonical parse boundary without custody authority', () => {
  const fixtureResult = {
    schema:'metaengine.browser.release-proof-sign-result-w77.v1',
    operation:'sign_installed_release_manifest_v2',
    request_sha256:'1'.repeat(64), signing_input_sha256:'2'.repeat(64),
    public_key_spki_sha256:'3'.repeat(64),
    signature_algorithm:'Ed25519', signature_base64:Buffer.alloc(64,7).toString('base64'),
    invocation_id:'fixture-only-not-authenticated',
    implementation_revision:'4'.repeat(40),
    release_authorized:false, authority_effect:false,
  };
  const bytes=Buffer.from(JSON.stringify(fixtureResult),'utf8');
  const parsed=parseUntrustedReleaseSignerResultW77(bytes);
  assert.equal(parsed.classification,'SOURCE_PARSE_ONLY');
  assert.equal(parsed.request_sha256,fixtureResult.request_sha256);
  assert.equal(parsed.signature_bytes_sha256,hash(Buffer.alloc(64,7)));
  assert.equal(parsed.cryptographic_signature_verified,false);
  assert.equal(parsed.signer_invocation_authenticated,false);
  assert.equal(parsed.installed_placement_verified,false);
  assert.equal(parsed.release_authorized,false);
  const tampered = [
    Buffer.from(' '+bytes.toString('utf8')),
    Buffer.concat([bytes,Buffer.from('\n')]),
    Buffer.from(bytes.toString('utf8').replace('"request_sha256":',
      '"request_sha256":"9'.concat('9'.repeat(63),'","request_sha256":'))),
    Buffer.from(JSON.stringify({...fixtureResult, verified:true})),
    Buffer.from(JSON.stringify({...fixtureResult, release_authorized:true})),
    Buffer.from(JSON.stringify({...fixtureResult, authority_effect:true})),
    Buffer.from(JSON.stringify({...fixtureResult, signature_base64:'a'.repeat(88)})),
    Buffer.from(JSON.stringify({...fixtureResult, signature_base64:Buffer.alloc(63,7).toString('base64')})),
    Buffer.from(JSON.stringify({...fixtureResult, signature_algorithm:'RSA'})),
    Buffer.from(JSON.stringify({...fixtureResult, request_sha256:'A'.repeat(64)})),
    Buffer.from(JSON.stringify({...fixtureResult, implementation_revision:'caller-claims-verified'})),
    Buffer.from(JSON.stringify({...fixtureResult, invocation_id:'\u0000fixture'})),
    Buffer.from(JSON.stringify({...fixtureResult, invocation_id:' '.repeat(3)})),
    Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(fixtureResult).reverse()))),
  ];
  for (const [i,b] of tampered.entries()) {
    assert.throws(()=>parseUntrustedReleaseSignerResultW77(b),/w77_release_proof_sign_result_/,String(i));
  }
  assert.throws(()=>parseUntrustedReleaseSignerResultW77(fixtureResult),/w77_release_proof_sign_result_/);
});
