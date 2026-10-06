import crypto from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  verifyClientC5LiveDevelopmentEvidence,
  verifyClientC5LiveEvidence,
} from './client-c5-live-evidence-consumer.mjs';
import { stableClientC5Json } from './client-c5-live-readiness.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] == null) {
      throw new Error('client_c5_live_evidence_verify_args_invalid');
    }
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

function inside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function json(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

const args = parseArgs(process.argv.slice(2));
const bundleDir = path.resolve(args.bundle || '');
const outPath = path.resolve(args.out || '');
const trustRootKind = String(args['trust-root-kind'] || '');

if (!args.bundle || !args.out || !trustRootKind) {
  throw new Error('client_c5_live_evidence_verify_args_missing');
}
if (!['CONTROLLED_TEST_VECTOR', 'LIVE_DEVELOPMENT_TRUST'].includes(trustRootKind)) {
  throw new Error('client_c5_live_trust_root_kind_invalid');
}

const [
  capsule,
  dispatchAuthorization,
  submissionReceipt,
  executionProof,
  usefulWorkProof,
  provenance,
  artifactVerificationReceipt,
  reviewReceipt,
  supervisorEnvelope,
  artifactBytes,
] = await Promise.all([
  json(path.join(bundleDir, 'client-c5-live-readiness-capsule.json')),
  json(path.join(bundleDir, 'dispatch-authorization.json')),
  json(path.join(bundleDir, 'submission-receipt.json')),
  json(path.join(bundleDir, 'execution-proof.json')),
  json(path.join(bundleDir, 'useful-work-proof.json')),
  json(path.join(bundleDir, 'provenance.json')),
  json(path.join(bundleDir, 'artifact-verification-receipt.json')),
  json(path.join(bundleDir, 'review-receipt.json')),
  json(path.join(bundleDir, 'supervisor-envelope.json')),
  readFile(path.join(bundleDir, 'live-artifact.json')),
]);

const evidence = {
  capsule,
  dispatch_authorization: dispatchAuthorization,
  submission_receipt: submissionReceipt,
  execution_proof: executionProof,
  useful_work_proof: usefulWorkProof,
  artifact_bytes: artifactBytes,
  provenance,
  artifact_verification_receipt: artifactVerificationReceipt,
  review_receipt: reviewReceipt,
  supervisor_envelope: supervisorEnvelope,
};

let receipt;

if (trustRootKind === 'CONTROLLED_TEST_VECTOR') {
  const trustedKeyPath = path.resolve(args['trusted-key'] || '');
  if (!args['trusted-key']) throw new Error('client_c5_controlled_trusted_key_missing');
  const trustedKeyPem = await readFile(trustedKeyPath, 'utf8');
  const publicKey = crypto.createPublicKey(trustedKeyPem);
  const keyId = String(supervisorEnvelope?.key_id || '');
  if (!keyId) throw new Error('client_c5_live_supervisor_key_id_missing');

  receipt = verifyClientC5LiveEvidence({
    ...evidence,
    trusted_supervisor_public_keys: { [keyId]: publicKey },
  });

  if (
    receipt.verification_state !== 'CONTROLLED_TEST_VECTOR_VERIFIED'
    || receipt.signed_supervisor_readback_verified !== true
    || receipt.trusted_supervisor_key_verified !== false
    || receipt.client_c5_live_useful_work_verified !== false
    || receipt.production_trust_root_verified !== false
    || receipt.canonical_c2_promotion_authorized !== false
    || receipt.authority_effect !== false
  ) {
    throw new Error('client_c5_controlled_vector_claim_escalation');
  }
} else {
  const trustRootBundle = path.resolve(args['trust-root-bundle'] || '');
  const bootstrapKeyPath = path.resolve(args['bootstrap-key'] || '');
  const expectedBootstrapSpkiSha256 = String(args['expected-bootstrap-spki-sha256'] || '');
  const nowValue = String(args.now || '');

  if (
    !args['trust-root-bundle']
    || !args['bootstrap-key']
    || !/^[0-9a-f]{64}$/.test(expectedBootstrapSpkiSha256)
    || !nowValue
  ) {
    throw new Error('client_c5_live_development_trust_args_missing');
  }
  if (inside(trustRootBundle, bootstrapKeyPath)) {
    throw new Error('client_c5_live_development_bootstrap_key_must_be_external_to_trust_bundle');
  }

  const [
    bootstrapManifest,
    bootstrapSignature,
    candidateManifest,
    candidateSignature,
    bootstrapPem,
  ] = await Promise.all([
    json(path.join(trustRootBundle, 'trust-root-v1.json')),
    json(path.join(trustRootBundle, 'trust-root-v1-signature.json')),
    json(path.join(trustRootBundle, 'trust-root-v2.json')),
    json(path.join(trustRootBundle, 'trust-root-v2-signature.json')),
    readFile(bootstrapKeyPath, 'utf8'),
  ]);

  const bootstrapKey = crypto.createPublicKey(bootstrapPem);
  if (bootstrapKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('client_c5_live_development_bootstrap_key_not_ed25519');
  }
  const bootstrapKeyId = String(bootstrapSignature?.signatures?.[0]?.key_id || '');
  if (!bootstrapKeyId) throw new Error('client_c5_live_development_bootstrap_key_id_missing');

  const now = new Date(nowValue);
  if (!Number.isFinite(now.getTime())) throw new Error('client_c5_live_development_now_invalid');

  receipt = verifyClientC5LiveDevelopmentEvidence({
    ...evidence,
    trust_root_bootstrap_manifest: bootstrapManifest,
    trust_root_bootstrap_signature_envelope: bootstrapSignature,
    trust_root_candidate_manifest: candidateManifest,
    trust_root_candidate_signature_envelope: candidateSignature,
    pinned_root_public_keys: { [bootstrapKeyId]: bootstrapKey },
    expected_pinned_root_spki_sha256: { [bootstrapKeyId]: expectedBootstrapSpkiSha256 },
    now,
  });

  if (
    receipt.verification_state !== 'LIVE_DEVELOPMENT_EVIDENCE_VERIFIED'
    || receipt.signed_supervisor_readback_verified !== true
    || receipt.trusted_supervisor_key_verified !== true
    || receipt.live_development_trust_verified !== true
    || receipt.production_trust_root_verified !== false
    || receipt.client_c5_live_useful_work_verified !== true
    || receipt.canonical_c2_promotion_authorized !== false
    || receipt.authority_effect !== false
  ) {
    throw new Error('client_c5_live_development_evidence_receipt_invalid');
  }
}

if (receipt.verification_state === 'REJECTED') {
  process.stderr.write(stableClientC5Json(receipt));
  process.exitCode = 1;
} else {
  await writeFile(outPath, stableClientC5Json(receipt), 'utf8');
  process.stdout.write(stableClientC5Json(receipt));
}
