import crypto from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  resolveClientC5SupervisorReadbackKey,
  verifyClientC5SupervisorTrustRootBootstrap,
  verifyClientC5SupervisorTrustRootTransition,
} from './client-c5-supervisor-trust-root.mjs';
import { stableClientC5Json } from './client-c5-live-readiness.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] == null) throw new Error('client_c5_trust_root_verify_args_invalid');
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

function inside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const json = async (file) => JSON.parse(await readFile(file, 'utf8'));

const args = parseArgs(process.argv.slice(2));
const bundleDir = path.resolve(args.bundle || '');
const bootstrapKeyPath = path.resolve(args['bootstrap-key'] || '');
const outDir = path.resolve(args.out || '');
const trustRootKind = String(args['trust-root-kind'] || '');
const supervisorKeyId = String(args['supervisor-key-id'] || '');
const evidenceIssuedAt = String(args['evidence-issued-at'] || '');
const nowValue = String(args.now || '');
const expectedBootstrapSpkiSha256 = String(args['expected-bootstrap-spki-sha256'] || '');

if (
  !args.bundle
  || !args['bootstrap-key']
  || !args.out
  || !trustRootKind
  || !supervisorKeyId
  || !evidenceIssuedAt
  || !nowValue
) throw new Error('client_c5_trust_root_verify_args_missing');

if (!['CONTROLLED_TEST_VECTOR', 'PINNED_PRODUCTION'].includes(trustRootKind)) {
  throw new Error('client_c5_trust_root_kind_invalid');
}
if (trustRootKind === 'PINNED_PRODUCTION') {
  if (inside(bundleDir, bootstrapKeyPath)) {
    throw new Error('client_c5_production_bootstrap_key_must_be_external_to_bundle');
  }
  if (!/^[0-9a-f]{64}$/.test(expectedBootstrapSpkiSha256)) {
    throw new Error('client_c5_production_bootstrap_spki_pin_required');
  }
}

const [v1, v1Signature, v2, v2Signature, bootstrapPem] = await Promise.all([
  json(path.join(bundleDir, 'trust-root-v1.json')),
  json(path.join(bundleDir, 'trust-root-v1-signature.json')),
  json(path.join(bundleDir, 'trust-root-v2.json')),
  json(path.join(bundleDir, 'trust-root-v2-signature.json')),
  readFile(bootstrapKeyPath, 'utf8'),
]);

const bootstrapKey = crypto.createPublicKey(bootstrapPem);
const bootstrapKeyId = String(v1Signature?.signatures?.[0]?.key_id || '');
if (!bootstrapKeyId) throw new Error('client_c5_bootstrap_key_id_missing');

const now = new Date(nowValue);
if (!Number.isFinite(now.getTime())) throw new Error('client_c5_trust_root_now_invalid');

const bootstrap = verifyClientC5SupervisorTrustRootBootstrap({
  manifest: v1,
  signature_envelope: v1Signature,
  pinned_root_public_keys: { [bootstrapKeyId]: bootstrapKey },
  expected_pinned_root_spki_sha256: trustRootKind === 'PINNED_PRODUCTION'
    ? { [bootstrapKeyId]: expectedBootstrapSpkiSha256 }
    : {},
  now,
  production_bootstrap: trustRootKind === 'PINNED_PRODUCTION',
});
if (bootstrap.action !== 'TRUST_ROOT_ACCEPTED') {
  throw new Error(`client_c5_trust_root_bootstrap_rejected:${bootstrap.reason}`);
}

const transition = verifyClientC5SupervisorTrustRootTransition({
  current_manifest: v1,
  candidate_manifest: v2,
  candidate_signature_envelope: v2Signature,
  now,
});
if (transition.action !== 'TRUST_ROOT_ACCEPTED') {
  throw new Error(`client_c5_trust_root_transition_rejected:${transition.reason}`);
}

const resolved = resolveClientC5SupervisorReadbackKey({
  manifest: v2,
  key_id: supervisorKeyId,
  evidence_issued_at: evidenceIssuedAt,
  now,
});
if (!resolved.ok) throw new Error(`client_c5_supervisor_key_resolution_rejected:${resolved.reason}`);

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const publicKeyPem = resolved.key.export({ type: 'spki', format: 'pem' });
await writeFile(path.join(outDir, 'resolved-supervisor-public-key.pem'), publicKeyPem);

const receipt = {
  schema: 'metaengine.client-v1.c5-supervisor-trust-root-resolution.v1',
  trust_root_kind: trustRootKind,
  bootstrap_manifest_sha256: bootstrap.manifest_sha256,
  candidate_manifest_sha256: transition.manifest_sha256,
  bootstrap_generation: bootstrap.generation,
  candidate_generation: transition.generation,
  old_root_threshold_verified: true,
  new_root_threshold_verified: true,
  supervisor_key_id: resolved.key_id,
  supervisor_key_state: resolved.key_state,
  supervisor_key_resolved: true,
  trust_root_manifest_sha256: resolved.trust_root_manifest_sha256,
  trust_root_generation: resolved.trust_root_generation,
  production_bootstrap_proven: trustRootKind === 'PINNED_PRODUCTION' && bootstrap.production_bootstrap_proven === true,
  live_effect_authorized: false,
  client_c5_live_useful_work_verified: false,
  canonical_c2_promotion_authorized: false,
  automatic_retry_allowed: false,
  authority_effect: false,
};
await writeFile(path.join(outDir, 'trust-root-resolution-receipt.json'), stableClientC5Json(receipt), 'utf8');
process.stdout.write(stableClientC5Json(receipt));
