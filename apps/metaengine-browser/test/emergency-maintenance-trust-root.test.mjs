import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

import {
  EMERGENCY_MAINTENANCE_TRUST_ROOT_SCHEMA,
  loadPackagedEmergencyMaintenanceTrustRoot,
  validateEmergencyMaintenanceTrustRoot,
} from '../src/emergency-maintenance-trust-root.mjs';

function rootFor(publicKey, buildSha = '8bb729ce2c1a623749517ab0ba0db3f5959b1256') {
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return {
    schema: EMERGENCY_MAINTENANCE_TRUST_ROOT_SCHEMA,
    build_sha: buildSha,
    ed25519_public_key_pem: pem,
    public_key_spki_sha256: crypto.createHash('sha256').update(der).digest('hex'),
  };
}

test('trust root accepts exact build SHA plus Ed25519 SPKI and exposes no private material', () => {
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const parsed = validateEmergencyMaintenanceTrustRoot(rootFor(publicKey));
  assert.equal(parsed.build_sha, '8bb729ce2c1a623749517ab0ba0db3f5959b1256');
  assert.equal(parsed.public_key.asymmetricKeyType, 'ed25519');
  assert.match(parsed.public_key_spki_sha256, /^[0-9a-f]{64}$/);
  assert.equal(parsed.ed25519_public_key_pem.includes('PRIVATE KEY'), false);
  assert.equal(parsed.immutable_packaged_metadata, true);
});

test('missing, malformed, wrong-type and fingerprint-mismatched trust roots fail closed', () => {
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  const valid = rootFor(publicKey);
  assert.throws(() => validateEmergencyMaintenanceTrustRoot(null), /trust_root_missing/);
  assert.throws(() => validateEmergencyMaintenanceTrustRoot({ ...valid, build_sha: 'not-a-sha' }), /build_sha_invalid/);
  assert.throws(() => validateEmergencyMaintenanceTrustRoot({ ...valid, public_key_spki_sha256: '0'.repeat(64) }), /fingerprint_mismatch/);

  const { publicKey: rsaPublicKey, privateKey: rsaPrivateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rsaPem = rsaPublicKey.export({ type: 'spki', format: 'pem' }).toString();
  assert.throws(() => validateEmergencyMaintenanceTrustRoot({
    ...valid,
    ed25519_public_key_pem: rsaPem,
  }), /not_ed25519/);
  assert.throws(() => validateEmergencyMaintenanceTrustRoot({
    ...valid,
    ed25519_public_key_pem: rsaPrivateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }), /public_key_invalid/);
});

test('unpackaged source package has no runtime trust metadata fallback', () => {
  assert.throws(() => loadPackagedEmergencyMaintenanceTrustRoot(), /trust_root_missing/);
});

test('packaging enables ASAR plus integrity and ASAR-only fuses while excluding source public-key file from app files', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../electron-builder.test.json', import.meta.url), 'utf8'));
  assert.equal(config.asar, true);
  assert.equal(config.electronFuses?.enableEmbeddedAsarIntegrityValidation, true);
  assert.equal(config.electronFuses?.onlyLoadAppFromAsar, true);
  assert.deepEqual(config.files, ['src/**/*', 'ui/**/*', 'package.json']);

  const publicKeyPem = fs.readFileSync(new URL('../build/emergency-maintenance-public-key.pem', import.meta.url), 'utf8');
  assert.match(publicKeyPem, /^-----BEGIN PUBLIC KEY-----/);
  assert.equal(publicKeyPem.includes('PRIVATE KEY'), false);
});
