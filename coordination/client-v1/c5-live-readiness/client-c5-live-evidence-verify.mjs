import crypto from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
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
const trustedKeyPath = path.resolve(args['trusted-key'] || '');
const outPath = path.resolve(args.out || '');
const trustRootKind = String(args['trust-root-kind'] || '');

if (!args.bundle || !args['trusted-key'] || !args.out || !trustRootKind) {
  throw new Error('client_c5_live_evidence_verify_args_missing');
}

if (trustRootKind === 'PINNED_SUPERVISOR' && inside(bundleDir, trustedKeyPath)) {
  throw new Error('client_c5_live_pinned_trust_key_must_be_external_to_bundle');
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
  trustedKeyPem,
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
  readFile(trustedKeyPath, 'utf8'),
]);

const publicKey = crypto.createPublicKey(trustedKeyPem);
const keyId = String(supervisorEnvelope?.key_id || '');
if (!keyId) throw new Error('client_c5_live_supervisor_key_id_missing');

const receipt = verifyClientC5LiveEvidence({
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
  trusted_supervisor_public_keys: { [keyId]: publicKey },
  trust_root_kind: trustRootKind,
});

if (receipt.verification_state === 'REJECTED') {
  process.stderr.write(stableClientC5Json(receipt));
  process.exitCode = 1;
} else if (trustRootKind === 'CONTROLLED_TEST_VECTOR') {
  if (
    receipt.verification_state !== 'CONTROLLED_TEST_VECTOR_VERIFIED'
    || receipt.signed_supervisor_readback_verified !== true
    || receipt.trusted_supervisor_key_verified !== false
    || receipt.client_c5_live_useful_work_verified !== false
    || receipt.canonical_c2_promotion_authorized !== false
    || receipt.authority_effect !== false
  ) {
    throw new Error('client_c5_controlled_vector_claim_escalation');
  }
} else if (trustRootKind === 'PINNED_SUPERVISOR') {
  if (
    receipt.verification_state !== 'LIVE_EVIDENCE_VERIFIED'
    || receipt.signed_supervisor_readback_verified !== true
    || receipt.trusted_supervisor_key_verified !== true
    || receipt.client_c5_live_useful_work_verified !== true
    || receipt.canonical_c2_promotion_authorized !== false
    || receipt.authority_effect !== false
  ) {
    throw new Error('client_c5_live_evidence_receipt_invalid');
  }
} else {
  throw new Error('client_c5_live_trust_root_kind_invalid');
}

await writeFile(outPath, stableClientC5Json(receipt), 'utf8');
process.stdout.write(stableClientC5Json(receipt));
