import crypto from 'node:crypto';
import fs from 'node:fs';

export const EMERGENCY_MAINTENANCE_TRUST_ROOT_SCHEMA = 'metaengine.emergency-maintenance-trust-root.v1';
const BUILD_SHA_RE = /^[0-9a-f]{40}$/;
const PACKAGE_JSON_URL = new URL('../package.json', import.meta.url);

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function parsePublicKey(value) {
  const text = String(value || '');
  if (!text || /PRIVATE KEY/.test(text)) {
    throw new Error('emergency_maintenance_trust_root_public_key_invalid');
  }
  let key;
  try {
    key = crypto.createPublicKey(text);
  } catch {
    throw new Error('emergency_maintenance_trust_root_public_key_invalid');
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('emergency_maintenance_trust_root_public_key_not_ed25519');
  }
  const der = key.export({ type: 'spki', format: 'der' });
  const fingerprint = crypto.createHash('sha256').update(der).digest('hex');
  const pem = key.export({ type: 'spki', format: 'pem' }).toString();
  return { key, fingerprint, pem };
}

export function validateEmergencyMaintenanceTrustRoot(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('emergency_maintenance_trust_root_missing');
  }
  if (input.schema !== EMERGENCY_MAINTENANCE_TRUST_ROOT_SCHEMA) {
    throw new Error('emergency_maintenance_trust_root_schema_invalid');
  }
  const buildSha = String(input.build_sha || '').trim().toLowerCase();
  if (!BUILD_SHA_RE.test(buildSha)) {
    throw new Error('emergency_maintenance_trust_root_build_sha_invalid');
  }
  const parsed = parsePublicKey(input.ed25519_public_key_pem);
  const declaredFingerprint = String(input.public_key_spki_sha256 || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(declaredFingerprint) || declaredFingerprint !== parsed.fingerprint) {
    throw new Error('emergency_maintenance_trust_root_public_key_fingerprint_mismatch');
  }
  return Object.freeze({
    schema: EMERGENCY_MAINTENANCE_TRUST_ROOT_SCHEMA,
    build_sha: buildSha,
    ed25519_public_key_pem: parsed.pem,
    public_key_spki_sha256: parsed.fingerprint,
    public_key: parsed.key,
    immutable_packaged_metadata: true,
    authority_effect: false,
  });
}

export function loadPackagedEmergencyMaintenanceTrustRoot() {
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_URL, 'utf8'));
  } catch {
    throw new Error('emergency_maintenance_trust_root_package_metadata_unreadable');
  }
  return validateEmergencyMaintenanceTrustRoot(packageJson?.metaengineEmergencyTrustRoot);
}

export function publicEmergencyMaintenanceTrustRootSnapshot(trustRoot) {
  const root = validateEmergencyMaintenanceTrustRoot(trustRoot);
  return Object.freeze({
    schema: root.schema,
    build_sha: root.build_sha,
    public_key_spki_sha256: root.public_key_spki_sha256,
    immutable_packaged_metadata: true,
    authority_effect: false,
  });
}

export function cloneEmergencyMaintenanceTrustRootForTests(input) {
  // This helper is deliberately data-only. It does not change the packaged
  // metadata loader and is used by unit tests for fail-close parsing only.
  const root = validateEmergencyMaintenanceTrustRoot(clone(input));
  return root;
}
