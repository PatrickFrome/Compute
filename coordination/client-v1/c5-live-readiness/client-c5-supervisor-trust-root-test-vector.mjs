import crypto from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  CLIENT_C5_SUPERVISOR_TRUST_ROOT_SCHEMA,
  CLIENT_C5_SUPERVISOR_TRUST_ROOT_SIGNATURE_SCHEMA,
  clientC5SupervisorTrustRootDigest,
  clientC5SupervisorTrustRootSigningBytes,
} from './client-c5-supervisor-trust-root.mjs';
import {
  sha256ClientC5,
  stableClientC5Json,
} from './client-c5-live-readiness.mjs';

const NOW = '2026-10-06T03:00:00Z';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] == null) throw new Error('client_c5_trust_root_vector_args_invalid');
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

function keyEntry(pairOrPublicKey, {
  key_id,
  role,
  valid_from = '2026-10-01T00:00:00Z',
  valid_until = '2027-10-01T00:00:00Z',
} = {}) {
  const publicKey = pairOrPublicKey?.type === 'public' ? pairOrPublicKey : pairOrPublicKey?.publicKey;
  if (!publicKey || publicKey.asymmetricKeyType !== 'ed25519') throw new Error('client_c5_trust_root_vector_public_key_invalid');
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return {
    key_id,
    role,
    alg: 'EdDSA',
    public_key_spki_base64: der.toString('base64'),
    public_key_spki_sha256: sha256ClientC5(der),
    state: 'ACTIVE',
    valid_from,
    valid_until,
    retired_at: null,
    revoked_at: null,
    invalid_since: null,
  };
}

function manifest({ generation, previous, issued_at, keys }) {
  return {
    schema: CLIENT_C5_SUPERVISOR_TRUST_ROOT_SCHEMA,
    version: '2.0.0',
    generation,
    issued_at,
    expires_at: '2027-01-01T00:00:00Z',
    previous_manifest_sha256: previous,
    root_signature_threshold: 1,
    usage: 'CLIENT_C5_SUPERVISOR_READBACK',
    keys: [...keys].sort((a, b) => a.key_id.localeCompare(b.key_id)),
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

function signatureEnvelope(target, signers) {
  return {
    schema: CLIENT_C5_SUPERVISOR_TRUST_ROOT_SIGNATURE_SCHEMA,
    manifest_sha256: clientC5SupervisorTrustRootDigest(target),
    signatures: signers.map(({ key_id, privateKey }) => ({
      key_id,
      alg: 'EdDSA',
      signature: crypto.sign(
        null,
        clientC5SupervisorTrustRootSigningBytes(target),
        privateKey,
      ).toString('base64url'),
    })).sort((a, b) => a.key_id.localeCompare(b.key_id)),
  };
}

const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(args.out || '');
if (!args.out) throw new Error('client_c5_trust_root_vector_out_missing');

let suppliedSupervisorPublicKey = null;
let suppliedSupervisorKeyId = null;
if (args['supervisor-public-key'] || args['supervisor-key-id']) {
  if (!args['supervisor-public-key'] || !args['supervisor-key-id']) {
    throw new Error('client_c5_trust_root_vector_supervisor_args_incomplete');
  }
  suppliedSupervisorPublicKey = crypto.createPublicKey(
    await import('node:fs/promises').then(({ readFile }) => readFile(path.resolve(args['supervisor-public-key']), 'utf8')),
  );
  if (suppliedSupervisorPublicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('client_c5_trust_root_vector_supervisor_key_not_ed25519');
  }
  suppliedSupervisorKeyId = String(args['supervisor-key-id']);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,191}$/.test(suppliedSupervisorKeyId)) {
    throw new Error('client_c5_trust_root_vector_supervisor_key_id_invalid');
  }
}

const rootA = crypto.generateKeyPairSync('ed25519');
const rootB = crypto.generateKeyPairSync('ed25519');
const supervisorA = crypto.generateKeyPairSync('ed25519');
const supervisorB = crypto.generateKeyPairSync('ed25519');
const candidateSupervisorPublicKey = suppliedSupervisorPublicKey || supervisorB.publicKey;
const candidateSupervisorKeyId = suppliedSupervisorKeyId || 'supervisor:test-b';

const v1 = manifest({
  generation: 1,
  previous: null,
  issued_at: '2026-10-06T01:00:00Z',
  keys: [
    keyEntry(rootA, { key_id: 'root:test-a', role: 'ROOT' }),
    keyEntry(supervisorA, { key_id: 'supervisor:test-a', role: 'SUPERVISOR_READBACK' }),
  ],
});
const v1Signature = signatureEnvelope(v1, [
  { key_id: 'root:test-a', privateKey: rootA.privateKey },
]);

const v2 = manifest({
  generation: 2,
  previous: clientC5SupervisorTrustRootDigest(v1),
  issued_at: '2026-10-06T02:00:00Z',
  keys: [
    keyEntry(rootB, { key_id: 'root:test-b', role: 'ROOT' }),
    keyEntry(candidateSupervisorPublicKey, { key_id: candidateSupervisorKeyId, role: 'SUPERVISOR_READBACK' }),
  ],
});
const v2Signature = signatureEnvelope(v2, [
  { key_id: 'root:test-a', privateKey: rootA.privateKey },
  { key_id: 'root:test-b', privateKey: rootB.privateKey },
]);

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await Promise.all([
  writeFile(path.join(outDir, 'trust-root-v1.json'), stableClientC5Json(v1), 'utf8'),
  writeFile(path.join(outDir, 'trust-root-v1-signature.json'), stableClientC5Json(v1Signature), 'utf8'),
  writeFile(path.join(outDir, 'trust-root-v2.json'), stableClientC5Json(v2), 'utf8'),
  writeFile(path.join(outDir, 'trust-root-v2-signature.json'), stableClientC5Json(v2Signature), 'utf8'),
  writeFile(path.join(outDir, 'controlled-bootstrap-root-public-key.pem'), rootA.publicKey.export({ type: 'spki', format: 'pem' })),
]);

const manifestOut = {
  schema: 'metaengine.client-v1.c5-supervisor-trust-root-test-vector.v2',
  evidence_context: 'CONTROLLED_TEST_VECTOR',
  now: NOW,
  bootstrap_generation: 1,
  candidate_generation: 2,
  bootstrap_manifest_sha256: clientC5SupervisorTrustRootDigest(v1),
  candidate_manifest_sha256: clientC5SupervisorTrustRootDigest(v2),
  controlled_bootstrap_spki_sha256: sha256ClientC5(rootA.publicKey.export({ type: 'spki', format: 'der' })),
  expected_supervisor_key_id: candidateSupervisorKeyId,
  expected_evidence_issued_at: '2026-10-06T02:30:00Z',
  bootstrap_key_external_for_live_development: false,
  private_key_persisted: false,
  production_bootstrap_proven: false,
  live_effect_authorized: false,
  client_c5_live_useful_work_verified: false,
  canonical_c2_promotion_authorized: false,
  authority_effect: false,
};
await writeFile(path.join(outDir, 'test-vector-manifest.json'), stableClientC5Json(manifestOut), 'utf8');
process.stdout.write(stableClientC5Json(manifestOut));
