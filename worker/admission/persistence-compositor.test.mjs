// Offline unit tests for the persistence compositor.
// Run: node --test worker/admission/persistence-compositor.test.mjs
//
// Reuses the self-signed-cert fixture approach from offhost-iid-verify.test.mjs:
// a real RSA key + self-signed cert signs a fake AWS instance-identity JSON into
// a valid PKCS#7/SMIME document. No network, no AWS, no OpenSSL subprocess.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { composeAdmission, revokeBinding } from './persistence-compositor.mjs';

// ---- minimal DER / X.509 / CMS builders (test-only, copied from sibling test) ----

const SEQ = 0x30;
function derLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  const b = [];
  let x = n;
  while (x > 0) { b.unshift(x & 0xff); x >>>= 8; }
  return Buffer.from([0x80 | b.length, ...b]);
}
function seq(...parts) {
  const body = Buffer.concat(parts.map((x) => (Buffer.isBuffer(x) ? x : Buffer.from(x))));
  return Buffer.concat([Buffer.from([SEQ]), derLen(body.length), body]);
}
function setOf(...parts) {
  const body = Buffer.concat(parts.map((x) => (Buffer.isBuffer(x) ? x : Buffer.from(x))));
  return Buffer.concat([Buffer.from([0x31]), derLen(body.length), body]);
}
function integer(buf) {
  let b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length === 0) b = Buffer.from([0]);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return Buffer.concat([Buffer.from([0x02]), derLen(b.length), b]);
}
function octetString(buf) {
  return Buffer.concat([Buffer.from([0x04]), derLen(buf.length), buf]);
}
function nullParam() { return Buffer.from([0x05, 0x00]); }
function ctx(tag, buf) {
  return Buffer.concat([Buffer.from([0xa0 | tag]), derLen(buf.length), buf]);
}
function oid(s) {
  const ps = s.split('.').map(Number);
  const first = ps[0] * 40 + ps[1];
  const enc = [];
  for (let i = 2; i < ps.length; i++) {
    let v = ps[i];
    const t = [];
    t.unshift(v & 0x7f);
    v >>>= 7;
    while (v > 0) { t.unshift((v & 0x7f) | 0x80); v >>>= 7; }
    enc.push(...t);
  }
  const body = Buffer.concat([Buffer.from([first]), Buffer.from(enc)]);
  return Buffer.concat([Buffer.from([0x06]), derLen(body.length), body]);
}
function generalizedTime(s) {
  return Buffer.concat([Buffer.from([0x18]), derLen(s.length), Buffer.from(s)]);
}
function bitString(buf) {
  return Buffer.concat([Buffer.from([0x03]), derLen(buf.length + 1), Buffer.from([0]), buf]);
}
const OID_SHA256_RSA = '1.2.840.113549.1.1.11';
const OID_SHA256 = '2.16.840.1.101.3.4.2.1';
const OID_SIGNEDDATA = '1.2.840.113549.1.7.2';
const OID_DATA = '1.2.840.113549.1.7.1';

function makeSelfSignedCert(privKey, pubKey) {
  const sigAlg = seq(oid(OID_SHA256_RSA), nullParam());
  const tbs = seq(
    ctx(0, integer(Buffer.from([2]))),
    integer(Buffer.from([1])),
    sigAlg,
    seq(),
    seq(generalizedTime('20200101000000Z'), generalizedTime('20300101000000Z')),
    seq(),
    pubKey.export({ type: 'spki', format: 'der' }),
  );
  const sig = crypto.createSign('sha256').update(tbs).sign(privKey);
  const der = seq(tbs, sigAlg, bitString(sig));
  return (
    '-----BEGIN CERTIFICATE-----\n' +
    der.toString('base64').match(/.{1,64}/g).join('\n') +
    '\n-----END CERTIFICATE-----\n'
  );
}

function buildPkcs7(content, privKey) {
  const c = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const digestAlg = seq(oid(OID_SHA256), nullParam());
  const sigAlg = seq(oid(OID_SHA256_RSA), nullParam());
  const encapContentInfo = seq(oid(OID_DATA), ctx(0, octetString(c)));
  const signature = crypto.createSign('sha256').update(c).sign(privKey);
  const signerInfo = seq(
    integer(Buffer.from([1])),
    seq(seq(), integer(Buffer.from([1]))),
    digestAlg,
    sigAlg,
    octetString(signature),
  );
  const signedData = seq(
    integer(Buffer.from([1])),
    setOf(digestAlg),
    encapContentInfo,
    setOf(signerInfo),
  );
  const contentInfo = seq(oid(OID_SIGNEDDATA), ctx(0, signedData));
  return (
    '-----BEGIN PKCS7-----\n' +
    contentInfo.toString('base64').match(/.{1,64}/g).join('\n') +
    '\n-----END PKCS7-----\n'
  );
}

function derFromPem(pem) {
  return Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64');
}

const FAKE_IID = {
  instanceId: 'i-0abc1234def567890',
  region: 'us-east-2',
  accountId: '123456789012',
  availabilityZone: 'us-east-2a',
};

function setup() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const certPem = makeSelfSignedCert(privateKey, publicKey);
  const fingerprint = crypto.createHash('sha256').update(derFromPem(certPem)).digest('hex');
  const pkcs7 = buildPkcs7(JSON.stringify(FAKE_IID), privateKey);
  return { certPem, fingerprint, pkcs7, privateKey };
}

function tamper(pkcs7Pem) {
  const der = derFromPem(pkcs7Pem);
  const t = Buffer.from(der);
  t[t.length - 1] ^= 0x01;
  return (
    '-----BEGIN PKCS7-----\n' +
    t.toString('base64').match(/.{1,64}/g).join('\n') +
    '\n-----END PKCS7-----\n'
  );
}

// ---- tests ----

test('valid path: verified identity + changed boot_id + non-ephemeral -> admit:true with binding', () => {
  const { certPem, fingerprint, pkcs7 } = setup();
  const r = composeAdmission({
    pkcs7Pem: pkcs7,
    opts: { certificatePem: certPem, expectedFingerprint: fingerprint, expectedInstanceId: FAKE_IID.instanceId },
    rebootReceipt: { instanceId: FAKE_IID.instanceId },
    preProbe: { boot_id: 'PRE-1111' },
    postProbe: { boot_id: 'POST-2222' },
    existingBindings: [],
    metadata: { nonEphemeral: true, backend: 'NATIVE_LINUX' },
  });
  assert.equal(r.admit, true);
  assert.ok(r.binding);
  assert.equal(r.binding.instanceId, FAKE_IID.instanceId);
  assert.equal(r.binding.region, FAKE_IID.region);
  assert.equal(r.binding.accountId, FAKE_IID.accountId);
  assert.equal(r.binding.backend, 'NATIVE_LINUX');
  assert.equal(r.binding.nonEphemeral, true);
  assert.ok(r.binding.persistedAt);
  assert.match(r.binding.nonce, /^[0-9a-f]{32}$/);
  assert.equal(r.binding.supersedes, undefined);
});

test('identity_unverified (tampered pkcs7) -> admit:false', () => {
  const { certPem, fingerprint, pkcs7 } = setup();
  const r = composeAdmission({
    pkcs7Pem: tamper(pkcs7),
    opts: { certificatePem: certPem, expectedFingerprint: fingerprint, expectedInstanceId: FAKE_IID.instanceId },
    rebootReceipt: { instanceId: FAKE_IID.instanceId },
    preProbe: { boot_id: 'PRE-1111' },
    postProbe: { boot_id: 'POST-2222' },
    metadata: { nonEphemeral: true },
  });
  assert.equal(r.admit, false);
  assert.equal(r.reason, 'identity_unverified');
});

test('reboot_binding_failed (unchanged boot_id) -> admit:false', () => {
  const { certPem, fingerprint, pkcs7 } = setup();
  const r = composeAdmission({
    pkcs7Pem: pkcs7,
    opts: { certificatePem: certPem, expectedFingerprint: fingerprint, expectedInstanceId: FAKE_IID.instanceId },
    rebootReceipt: { instanceId: FAKE_IID.instanceId },
    preProbe: { boot_id: 'SAME-999' },
    postProbe: { boot_id: 'SAME-999' },
    metadata: { nonEphemeral: true },
  });
  assert.equal(r.admit, false);
  assert.ok(r.reason.startsWith('reboot_binding_failed:'));
});

test('ephemeral_backend_rejected -> admit:false', () => {
  const { certPem, fingerprint, pkcs7 } = setup();
  const r = composeAdmission({
    pkcs7Pem: pkcs7,
    opts: { certificatePem: certPem, expectedFingerprint: fingerprint, expectedInstanceId: FAKE_IID.instanceId },
    rebootReceipt: { instanceId: FAKE_IID.instanceId },
    preProbe: { boot_id: 'PRE-1111' },
    postProbe: { boot_id: 'POST-2222' },
    metadata: { nonEphemeral: false, lifecycle: 'spot' },
  });
  assert.equal(r.admit, false);
  assert.equal(r.reason, 'ephemeral_backend_rejected');
});

test('duplicate_active_binding -> admit:false; allowRebind:true -> admit:true with supersedes', () => {
  const { certPem, fingerprint, pkcs7 } = setup();
  const baseInput = {
    pkcs7Pem: pkcs7,
    opts: { certificatePem: certPem, expectedFingerprint: fingerprint, expectedInstanceId: FAKE_IID.instanceId },
    rebootReceipt: { instanceId: FAKE_IID.instanceId },
    preProbe: { boot_id: 'PRE-1111' },
    postProbe: { boot_id: 'POST-2222' },
    metadata: { nonEphemeral: true, backend: 'NATIVE_LINUX' },
  };
  const first = composeAdmission(baseInput);
  assert.equal(first.admit, true);
  const prior = { ...first.binding, id: 'bind-1' };

  const dup = composeAdmission({ ...baseInput, existingBindings: [prior] });
  assert.equal(dup.admit, false);
  assert.equal(dup.reason, 'duplicate_active_binding');

  const rebind = composeAdmission({ ...baseInput, existingBindings: [prior], metadata: { ...baseInput.metadata, allowRebind: true } });
  assert.equal(rebind.admit, true);
  assert.equal(rebind.binding.supersedes, 'bind-1');
});

test('revokeBinding marks prior entry revoked (pure, no mutation)', () => {
  const { certPem, fingerprint, pkcs7 } = setup();
  const first = composeAdmission({
    pkcs7Pem: pkcs7,
    opts: { certificatePem: certPem, expectedFingerprint: fingerprint, expectedInstanceId: FAKE_IID.instanceId },
    rebootReceipt: { instanceId: FAKE_IID.instanceId },
    preProbe: { boot_id: 'PRE-1111' },
    postProbe: { boot_id: 'POST-2222' },
    metadata: { nonEphemeral: true },
  });
  const prior = { ...first.binding, id: 'bind-1' };
  const bindings = [prior];
  const next = revokeBinding(bindings, FAKE_IID.instanceId, 'replaced');
  assert.notEqual(next, bindings); // new array
  assert.equal(next.length, 1);
  assert.ok(next[0].revokedAt);
  assert.equal(next[0].revokedReason, 'replaced');
  assert.equal(prior.revokedAt, undefined); // original untouched
  assert.equal(bindings[0].revokedAt, undefined);
});