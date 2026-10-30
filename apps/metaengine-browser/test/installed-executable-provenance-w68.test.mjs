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
  INSTALLED_RELEASE_SIGNATURE_DOMAIN_W68,
  readVerifiedInstalledExecutableW68, verifyStagingInstalledExecutableW68,
} from '../src/installed-executable-provenance-w68.mjs';

import { capturePackageCodeW68, RELEASE_FILES_W68 } from '../src/installed-package-code-w68.mjs';

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
async function makeFixture() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'me2-w68-release-staging-')));
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
    manifest: path.join(dir, RELEASE_FILES_W68.envelope),
    packageCode: path.join(dir, RELEASE_FILES_W68.packageCode),
  };
  fs.mkdirSync(path.join(dir, 'resources/app.asar.unpacked/src'), { recursive:true });
  fs.mkdirSync(path.join(dir, 'resources/client-state-runtime'), { recursive:true });
  fs.writeFileSync(path.join(dir, 'resources/app.asar'), 'staging-asar-bytes');
  fs.writeFileSync(path.join(dir, 'resources/app.asar.unpacked/src/worker.cjs'), 'staging-worker-code');
  fs.writeFileSync(path.join(dir, 'resources/client-state-runtime/runtime.exe'), 'staging-runtime-bytes');
  const packageCode = await capturePackageCodeW68(dir, {sourceSha:SHA, version:VERSION, exeName:path.basename(exe)});
  fs.writeFileSync(files.packageCode, packageCode.bytes);
  fs.writeFileSync(files.bundle, JSON.stringify(slsaBundle));
  fs.writeFileSync(files.evidence, JSON.stringify(evidence));
  const m = {
    schema: INSTALLED_RELEASE_MANIFEST_W68, source_sha: SHA, package_version: VERSION,
    exe_name: path.basename(exe), exe_sha256: digest(exeBytes),
    signer_thumbprint: SIGNER, installer_sha256: evidence.subject_sha256,
    slsa_bundle_sha256: digest(fs.readFileSync(files.bundle)),
    slsa_evidence_sha256: digest(fs.readFileSync(files.evidence)),
    package_code_sha256: packageCode.sha256,
  };
  function sign(manifest = m, key = privateKey) {
    const signedBytes = Buffer.concat([Buffer.from(INSTALLED_RELEASE_SIGNATURE_DOMAIN_W68), Buffer.from(JSON.stringify(manifest))]);
    const signature = crypto.sign(null, signedBytes, key).toString('base64');
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
  const f=await makeFixture();try {await fn(f);} finally {f.remove();}
}

for(const finalRead of [false,true])test('W68 retains exact sibling after first sidecar rejection; final='+finalRead,async t=>{
  await withFixture(async f=>{
    let release,entered;const held=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
    const original=fs.promises.lstat.bind(fs.promises);
    t.mock.method(fs.promises,'lstat',async(file,...args)=>{
      if(finalRead?f.calls()>=2:true){
        if(file===f.files.manifest)throw Error('generated first sidecar rejection');
        if(file===f.files.bundle){entered();await held;throw Error('generated held sibling rejection');}
      }
      return original(file,...args);
    });
    let settled=false;const work=f.verify().then(value=>{settled=true;return value;});
    await started;await new Promise(r=>setImmediate(r));const premature=settled;
    release();assert.equal(await work,null);await new Promise(r=>setImmediate(r));
    assert.equal(premature,false,'failure result is not physical join while original sibling is held');
  });
});

test('real Ed25519 verification binds EXE digest, signer, source, version and two external proof byte digests; result remains STAGING', async () => {
  await withFixture(async f => {
    const proof=await f.verify();
    assert.equal(proof?.source,'INSTALLED_EXE_NATIVE_VERIFIER');
    assert.equal(proof?.source_sha,SHA);
    assert.equal(proof?.installed_exe_sha256,f.m.exe_sha256);
    assert.equal(proof?.installed_asar_sha256,digest(Buffer.from('staging-asar-bytes')));
    assert.equal(proof?.package_version,VERSION);
    assert.equal(proof?.fixture_classification,'STAGING');
    assert.equal(proof?.independent_slsa_crypto_verified_at_runtime,false);
    assert.equal(proof?.release_root_signature_verified,true);
    assert.equal(proof?.package_code_verified,true);
    assert.equal(proof?.package_code_sha256,f.m.package_code_sha256);
    assert.equal(proof?.loaded_runtime_code_attested,false);
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

test('even a same-root signature without release-domain separation is not a release signature', async () => {
  await withFixture(async f => {
    const doc = JSON.parse(fs.readFileSync(f.files.manifest,'utf8'));
    doc.signature_base64=crypto.sign(null,Buffer.from(JSON.stringify(f.m)),f.privateKey).toString('base64');
    fs.writeFileSync(f.files.manifest,JSON.stringify(doc));
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

test('signed v1 EXE-only proof is rejected rather than upgraded to package-code authority', async () => {
  await withFixture(async f => {
    const manifest = { ...f.m, schema:'metaengine.browser.installed-release-manifest.v1' };
    delete manifest.package_code_sha256;
    const bytes = Buffer.concat([Buffer.from('METAENGINE_INSTALLED_RELEASE_MANIFEST_V1\0'), Buffer.from(JSON.stringify(manifest))]);
    const doc = { schema:'metaengine.browser.installed-release-envelope.v1', manifest,
      signature_base64:crypto.sign(null,bytes,f.privateKey).toString('base64') };
    fs.writeFileSync(f.files.manifest, JSON.stringify(doc));
    assert.equal(await f.verify(), null);
  });
});

test('intact signed EXE and release sidecars cannot hide modified app.asar, unpacked worker or runtime', async () => {
  for (const name of ['resources/app.asar', 'resources/app.asar.unpacked/src/worker.cjs',
    'resources/client-state-runtime/runtime.exe']) {
    await withFixture(async f => {
      const target = path.join(f.dir,name), bytes = fs.readFileSync(target); bytes[0] ^= 1;
      fs.writeFileSync(target,bytes);
      assert.equal(await f.verify(),null,name);
    });
  }
  await withFixture(async f => { fs.appendFileSync(f.files.packageCode,' '); assert.equal(await f.verify(),null); });
  await withFixture(async f => {
    fs.writeFileSync(path.join(f.dir,'resources/injected.js'),'extra executable code');
    assert.equal(await f.verify(),null);
  });
});

test('package-code bytes and paths are fenced after the second OS observation', async () => {
  for (const mutate of [
    f => { const target=path.join(f.dir,'resources/app.asar'); const b=fs.readFileSync(target); b[0]^=1; fs.writeFileSync(target,b); },
    f => fs.writeFileSync(path.join(f.dir,'resources/late-worker.cjs'),'late injection'),
    f => fs.renameSync(path.join(f.dir,'resources/app.asar.unpacked'),path.join(f.dir,'resources/moved-unpacked')),
  ]) {
    await withFixture(async f => {
      let count=0;
      const native=async()=>{ if (++count===2) mutate(f); return f.native(); };
      assert.equal(await verifyStagingInstalledExecutableW68({executable:f.exe,version:VERSION,
        testTrustRoot:f.root,testNativeRead:native}),null);
      assert.equal(count,2);
    });
  }
});
