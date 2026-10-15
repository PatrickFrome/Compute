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
  emitStagingReleaseProofW77, buildPinnedGhVerifyArgsW77, prepareIndependentlyVerifiedReleaseInputsW77,
} from '../scripts/release-proof-producer-w77.mjs';
import {
  INSTALLED_RELEASE_SIGNATURE_DOMAIN_W68,
  verifyStagingInstalledExecutableW68,
} from '../src/installed-executable-provenance-w68.mjs';

const VERSION = '0.7.0-dev.999900003.1';
const SHA = 'a'.repeat(40);
const THUMB = 'b'.repeat(40);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const ROOT_SCHEMA = 'metaengine.emergency-maintenance-trust-root.v1';
function fixture() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'metaengine-w77-SOURCE-STAGING-')));
  const exe = path.join(dir, 'METAENGINE Browser Test.exe');
  const installer = path.join(dir, 'METAENGINE-Browser-Test-Setup-' + VERSION + '-x64.exe');
  const bundle = path.join(dir, RELEASE_PROOF_FILES_W77.bundle);
  const evidence = path.join(dir, RELEASE_PROOF_FILES_W77.evidence);
  const pair = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(exe, crypto.randomBytes(1047));
  fs.writeFileSync(installer, crypto.randomBytes(2031));
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
  const f = fixture();
  try { await fn(f); } finally { f.dispose(); }
}

test('producer emits exact W68 external domain/manifests; actual consumer Ed25519 roundtrip is STAGING only', async () => {
  await withFixture(async f => {
    const stage = f.emit();
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
    assert.equal(stage.handoff.detached_sidecar_files.length,3);
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
      assert.throws(() => emitStagingReleaseProofW77({...f.args,version:bad}),/source_or_version|reserved_or_invalid_version/);
    });
  }
});

test('source, signer, subject, SLSA fields and wrong domain do not pass production-reader roundtrip', async () => {
  await withFixture(async f => {
    const st=f.emit();
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
    await withFixture(async f => { f.emit();action(f);assert.equal(await f.verify(),null); });
  }
  await withFixture(async f => {
    fs.appendFileSync(f.installer,'different artifact');
    assert.throws(()=>f.emit(),/slsa_semantics/);
  });
  await withFixture(async f => {
    assert.throws(()=>emitStagingReleaseProofW77({...f.args,signerThumbprint:'f'.repeat(39)}),
      /signer_thumbprint/);
  });
});

test('non-canonical file path, symlink/reparse and pre-existing envelope fail closed', async t => {
  await withFixture(async f => {
    f.emit();
    assert.throws(()=>f.emit(),/staging_output_already_exists/);
    assert.throws(()=>emitStagingReleaseProofW77({
      ...f.args,exePath:path.join(f.dir,'..','METAENGINE Browser Test.exe'),
    }),/file_path/);
  });
  await withFixture(async f => {
    const outside=path.join(f.dir,'real-bundle.json');
    fs.renameSync(f.bundle,outside);
    try {fs.symlinkSync(outside,f.bundle,'file');}
    catch(e) {if(['EPERM','EACCES'].includes(e?.code)) return t.skip('symlink creation unavailable');throw e;}
    assert.throws(()=>f.emit(),/unsafe_artifact_path/);
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
    '--source-digest','--source-ref','refs/heads/physical/build-slsa-provenance-v1',
    '--cert-oidc-issuer','https://token.actions.githubusercontent.com',
    '--deny-self-hosted-runners','--predicate-type','https://slsa.dev/provenance/v1',
  ]) assert.ok(args.includes(term), term);
  assert.equal(args[args.indexOf('--source-digest')+1],SHA);
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
