// Offline unit tests for the off-host IID verifier.
// Run: node --test worker/admission/offhost-iid-verify.test.mjs
//
// These tests build a real RSA key pair and a self-signed certificate at test
// time, then produce a valid AWS-style PKCS#7 / S/MIME SignedData around a fake
// instance-identity JSON. No network, no AWS, no OpenSSL subprocess.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  verifyInstanceIdentityDocument,
  bindRebootReceipt,
} from './offhost-iid-verify.mjs';

// ---- minimal DER / X.509 / CMS builders (test-only) ----

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
    ctx(0, integer(Buffer.from([2]))), // version v3
    integer(Buffer.from([1])), // serial
    sigAlg,
    seq(), // issuer (empty)
    seq(generalizedTime('20200101000000Z'), generalizedTime('20300101000000Z')), // validity
    seq(), // subject (empty)
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
    seq(seq(), integer(Buffer.from([1]))), // issuerAndSerial placeholder
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

// ---- fixtures ----

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

// ---- tests ----

test('valid signature verifies and extracts identity fields', () => {
  const { certPem, fingerprint, pkcs7 } = setup();
  const r = verifyInstanceIdentityDocument(pkcs7, {
    certificatePem: certPem,
    expectedFingerprint: fingerprint,
    expectedInstanceId: FAKE_IID.instanceId,
    expectedAccountId: FAKE_IID.accountId,
    expectedRegion: FAKE_IID.region,
  });
  assert.equal(r.ok, true);
  assert.equal(r.instanceId, FAKE_IID.instanceId);
  assert.equal(r.region, FAKE_IID.region);
  assert.equal(r.accountId, FAKE_IID.accountId);
  assert.equal(r.fingerprint, fingerprint);
});

test('tampered signature fails closed (ok:false)', () => {
  const { certPem, fingerprint, pkcs7 } = setup();
  const der = derFromPem(pkcs7);
  const tampered = Buffer.from(der);
  tampered[tampered.length - 1] ^= 0x01; // corrupt last byte of signature
  const tamperedPem =
    '-----BEGIN PKCS7-----\n' +
    tampered.toString('base64').match(/.{1,64}/g).join('\n') +
    '\n-----END PKCS7-----\n';
  const r = verifyInstanceIdentityDocument(tamperedPem, {
    certificatePem: certPem,
    expectedFingerprint: fingerprint,
    expectedInstanceId: FAKE_IID.instanceId,
    expectedAccountId: FAKE_IID.accountId,
    expectedRegion: FAKE_IID.region,
  });
  assert.equal(r.ok, false);
  assert.ok(r.reason, 'expected a failure reason');
});

test('certificate fingerprint mismatch fails closed (ok:false)', () => {
  const { certPem, pkcs7 } = setup();
  const r = verifyInstanceIdentityDocument(pkcs7, {
    certificatePem: certPem,
    expectedFingerprint: 'aa6f3e8a' + '0'.repeat(56), // wrong pin
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'certificate_pin_mismatch');
});

test('wrong-key / wrong pinned cert fails signature (ok:false)', () => {
  const a = setup(); // signs
  const b = setup(); // different key, used as pinned cert
  const r = verifyInstanceIdentityDocument(a.pkcs7, {
    certificatePem: b.certPem,
    expectedFingerprint: b.fingerprint,
    expectedInstanceId: FAKE_IID.instanceId,
  });
  assert.equal(r.ok, false);
});

test('instance/account/region aliasing fences reject mismatch', () => {
  const { certPem, fingerprint, pkcs7 } = setup();
  const r = verifyInstanceIdentityDocument(pkcs7, {
    certificatePem: certPem,
    expectedFingerprint: fingerprint,
    expectedInstanceId: 'i-different',
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'instance_identity_mismatch');
});

test('garbage / missing input fails closed and never throws', () => {
  const r1 = verifyInstanceIdentityDocument('not a pem', { certificatePem: 'x' });
  assert.equal(r1.ok, false);
  const r2 = verifyInstanceIdentityDocument(null, {});
  assert.equal(r2.ok, false);
  const r3 = verifyInstanceIdentityDocument('-----BEGIN PKCS7-----\nZg==\n-----END PKCS7-----', {
    certificatePem: '-----BEGIN CERTIFICATE-----\nZg==\n-----END CERTIFICATE-----',
  });
  assert.equal(r3.ok, false);
});

test('bindRebootReceipt accepts a changed boot_id', () => {
  const { certPem, fingerprint, pkcs7 } = setup();
  const identity = verifyInstanceIdentityDocument(pkcs7, {
    certificatePem: certPem,
    expectedFingerprint: fingerprint,
    expectedInstanceId: FAKE_IID.instanceId,
  });
  assert.equal(identity.ok, true);
  const r = bindRebootReceipt(
    identity,
    { instanceId: FAKE_IID.instanceId },
    { boot_id: 'PRE-1111' },
    { boot_id: 'POST-2222' },
  );
  assert.equal(r.ok, true);
  assert.equal(r.binding.bootIdChanged, true);
  assert.equal(r.binding.preBootId, 'PRE-1111');
  assert.equal(r.binding.postBootId, 'POST-2222');
});

test('bindRebootReceipt rejects unchanged boot_id', () => {
  const { certPem, fingerprint, pkcs7 } = setup();
  const identity = verifyInstanceIdentityDocument(pkcs7, {
    certificatePem: certPem,
    expectedFingerprint: fingerprint,
    expectedInstanceId: FAKE_IID.instanceId,
  });
  const r = bindRebootReceipt(
    identity,
    { instanceId: FAKE_IID.instanceId },
    { boot_id: 'SAME-999' },
    { boot_id: 'SAME-999' },
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'boot_id_unchanged');
});

test('bindRebootReceipt rejects mismatched receipt instanceId', () => {
  const { certPem, fingerprint, pkcs7 } = setup();
  const identity = verifyInstanceIdentityDocument(pkcs7, {
    certificatePem: certPem,
    expectedFingerprint: fingerprint,
    expectedInstanceId: FAKE_IID.instanceId,
  });
  const r = bindRebootReceipt(
    identity,
    { instanceId: 'i-other' },
    { boot_id: 'PRE' },
    { boot_id: 'POST' },
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'receipt_instance_mismatch');
});
