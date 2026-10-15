// W68: all fixtures are uniquely disposable, explicit STAGING and never launch
// Electron, Owner bootstrap, installed Host, Guardian or user profiles.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  INSTALLED_RELEASE_ENVELOPE_W68, INSTALLED_RELEASE_MANIFEST_W68,
  readVerifiedInstalledExecutableW68, verifyStagingInstalledExecutableW68,
} from '../src/installed-executable-provenance-w68.mjs';

const SHA = 'a'.repeat(40);
const VERSION = '0.7.0-dev.999900001.1';
const SIGNER = 'b'.repeat(40);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const pem = key => key.export({ type: 'spki', format: 'pem' }).toString();
const rootFor = key => ({
  schema: 'metaengine.emergency-maintenance-trust-root.v1',
  build_sha: SHA,
  ed25519_public_key_pem: pem(key),
  public_key_spki_sha256: digest(key.export({ type: 'spki', format: 'der' })),
});
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'me2-w68-release-staging-'));
  const exe = path.join(dir, 'METAENGINE-Browser.exe');
  const exeBytes = crypto.randomBytes(2048);
  fs.writeFileSync(exe, exeBytes);
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const slsaBundle = { mediaType:'application/vnd.dev.sigstore.bundle.v0.3+json',
    dsseEnvelope: { signatures:[{sig:'staging-not-a-real-slsa-signature'}] } };
  const evidence = {
    schema: 'metaengine.browser-fabric.provenance-evidence.v1',
    verified:true, builder_trusted:true, authority_effect:false, source_sha:SHA,
    subject_sha256: digest(Buffer.from('independent-installer-staging-bytes')),
    subject_name:'METAENGINE-Browser-Test-Setup-' + VERSION + '-x64.exe',
    predicate_type:'https://slsa.dev/provenance/v1',
  };
  const files = {
    bundle: path.join(dir,'installer-slsa-provenance.bundle.json'),
    evidence: path.join(dir,'browser-package-slsa-provenance-evidence.json'),
    manifest: path.join(dir,'metaengine-installed-release-proof.v1.json'),
  };
  fs.writeFileSync(files.bundle, JSON.stringify(slsaBundle));
  fs.writeFileSync(files.evidence, JSON.stringify(evidence));
  const m = {
    schema: INSTALLED_RELEASE_MANIFEST_W68, source_sha: SHA, package_version: VERSION,
    exe_name: path.basename(exe), exe_sha256: digest(exeBytes),
    signer_thumbprint: SIGNER, installer_sha256: evidence.subject_sha256,
    slsa_bundle_sha256: digest(fs.readFileSync(files.bundle)),
    slsa_evidence_sha256: digest(fs.readFileSync(files.evidence)),
  };
  function sign(manifest = m, key = privateKey) {
    const signature = crypto.sign(null, Buffer.from(JSON.stringify(manifest)), key).toString('base64');
    fs.writeFileSync(files.manifest, JSON.stringify({
      schema: INSTALLED_RELEASE_ENVELOPE_W68, manifest, signature_base64:signature,
    }));
  }
  sign();
  const root = rootFor(publicKey);
  let signer = SIGNER;
  let callbackCalls = 0;
  const native = async () => {
    callbackCalls++;
    return {
      native_signature_verified:true, exact_bytes_verified:true,
      installed_exe_sha256:digest(fs.readFileSync(exe)), signer_thumbprint:signer,
    };
  };
  return {
    dir, exe, files, m, root, publicKey, privateKey, sign, native,
    setSigner(x) { signer=x; }, calls() {return callbackCalls;},
    verify() {return verifyStagingInstalledExecutableW68({
      executable:exe, version:VERSION, testTrustRoot:root, testNativeRead:native,
    });},
    remove() { fs.rmSync(dir,{recursive:true,force:true}); },
  };
}
async function withFixture(fn) {
  const f=makeFixture();try {await fn(f);} finally {f.remove();}
}

test('real Ed25519 verification binds EXE digest, signer, source, version and two external proof byte digests; result remains STAGING', async () => {
  await withFixture(async f => {
    const proof=await f.verify();
    assert.equal(proof?.source,'INSTALLED_EXE_NATIVE_VERIFIER');
    assert.equal(proof?.source_sha,SHA);
    assert.equal(proof?.installed_exe_sha256,f.m.exe_sha256);
    assert.equal(proof?.package_version,VERSION);
    assert.equal(proof?.fixture_classification,'STAGING');
    assert.equal(proof?.independent_slsa_crypto_verified_at_runtime,false);
    assert.equal(proof?.release_root_signature_verified,true);
    assert.equal(proof?.authority_effect,false);
    assert.match(proof?.proof_identity,/^[a-f0-9]{64}$/);
    assert.equal(f.calls(),2,'kernel/AuthentiCode observations bracket disk reads');
  });
});

test('arbitrary valid OS Authenticode signer never substitutes for release-root signer binding', async () => {
  await withFixture(async f => { f.setSigner('c'.repeat(40)); assert.equal(await f.verify(),null); });
});

test('tamper exact EXE bytes without changing length fails even when synthetic OS observation re-hashes it', async () => {
  await withFixture(async f => {
    const bytes=fs.readFileSync(f.exe);bytes[0]^=1;fs.writeFileSync(f.exe,bytes);
    assert.equal(await f.verify(),null);
  });
});

test('tamper SLSA bundle or evidence bytes fails even with verified:true JSON', async () => {
  await withFixture(async f => {
    fs.appendFileSync(f.files.bundle,' ');
    assert.equal(await f.verify(),null);
  });
  await withFixture(async f => {
    const evidence=JSON.parse(fs.readFileSync(f.files.evidence));
    evidence.source_sha='c'.repeat(40);
    fs.writeFileSync(f.files.evidence,JSON.stringify(evidence));
    assert.equal(await f.verify(),null);
  });
});

test('different release root cannot validate existing detached signature', async () => {
  await withFixture(async f => {
    const other=crypto.generateKeyPairSync('ed25519');
    assert.equal(await verifyStagingInstalledExecutableW68({
      executable:f.exe,version:VERSION,testTrustRoot:rootFor(other.publicKey),testNativeRead:f.native,
    }),null);
  });
});

test('source, package version, signer and EXE bytes can only change with a new root-signed manifest', async () => {
  for (const [field, value] of [
    ['source_sha','c'.repeat(40)], ['package_version','0.7.0-dev.999900002.1'],
    ['signer_thumbprint','c'.repeat(40)], ['exe_sha256','0'.repeat(64)],
    ['slsa_bundle_sha256','0'.repeat(64)],
  ]) {
    await withFixture(async f => {
      const edited={...f.m,[field]:value};
      // Former valid signature remains, forged metadata must fail.
      const doc=JSON.parse(fs.readFileSync(f.files.manifest,'utf8'));
      doc.manifest=edited;
      fs.writeFileSync(f.files.manifest,JSON.stringify(doc));
      assert.equal(await f.verify(),null,field);
    });
  }
});

test('freshly signed wrong source/version/attestation cannot bypass comparison to packaged root and native release', async () => {
  for (const [field, value] of [
    ['source_sha','c'.repeat(40)], ['package_version','0.7.0-dev.999900002.1'],
    ['installer_sha256','0'.repeat(64)],
  ]) {
    await withFixture(async f => {
      f.sign({...f.m,[field]:value});
      assert.equal(await f.verify(),null,field);
    });
  }
});

test('public JSON verified:true without release signature and all missing sidecars stay UNKNOWN', async () => {
  await withFixture(async f => {
    fs.writeFileSync(f.files.manifest,JSON.stringify({
      schema: INSTALLED_RELEASE_ENVELOPE_W68,manifest:{...f.m,verified:true},signature_base64:'a'.repeat(86)+'==',
    }));
    assert.equal(await f.verify(),null);
    fs.rmSync(f.files.manifest);
    assert.equal(await f.verify(),null);
  });
});

test('symlink/reparse-like sidecar and executable path aliases are rejected', async t => {
  await withFixture(async f => {
    try {
      const real=f.files.manifest+'.real';
      fs.renameSync(f.files.manifest,real);
      fs.symlinkSync(real,f.files.manifest,'file');
    } catch (e) {
      if (['EPERM','EACCES'].includes(e?.code)) return t.skip('symlinks require privilege');
      throw e;
    }
    assert.equal(await f.verify(),null);
  });
});

test('changed native signer between before and after readback is a TOCTOU refusal', async () => {
  await withFixture(async f => {
    let count=0;
    const native = async () => {
      count++;
      return {native_signature_verified:true,exact_bytes_verified:true,
        installed_exe_sha256:f.m.exe_sha256,
        signer_thumbprint:count===1 ? SIGNER : 'c'.repeat(40)};
    };
    assert.equal(await verifyStagingInstalledExecutableW68({
      executable:f.exe,version:VERSION,testTrustRoot:f.root,testNativeRead:native,
    }),null);
    assert.equal(count,2);
  });
});

test('sidecar digest/path drift during second native observation is refused', async () => {
  await withFixture(async f => {
    let count=0;
    const native = async () => {
      count++;
      if (count === 2) fs.appendFileSync(f.files.evidence,' ');
      return { native_signature_verified:true,exact_bytes_verified:true,
        installed_exe_sha256:f.m.exe_sha256,signer_thumbprint:SIGNER };
    };
    assert.equal(await verifyStagingInstalledExecutableW68({
      executable:f.exe,version:VERSION,testTrustRoot:f.root,testNativeRead:native,
    }),null);
    assert.equal(count,2);
  });
});

test('production reader has no caller-supplied signer/root/path and returns null without native packaged evidence', async () => {
  assert.equal(await readVerifiedInstalledExecutableW68({
    isPackaged:true,getVersion:()=>VERSION,
  }),null);
  assert.equal(await verifyStagingInstalledExecutableW68({}),null);
});
