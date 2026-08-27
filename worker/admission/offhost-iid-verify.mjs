// Off-host AWS EC2 Instance-Identity Document (IID) verifier for H205F22 W1.
//
// This is an ADDITIVE, FAIL-CLOSED, PURE Node.js implementation of the
// off-host instance-identity verification slice of the W1 worker-admission
// contract (C1 - First Real Linux Worker). It mirrors the trust root of the
// existing Python verifier (controller/w1/aws_instance_identity_verifier.py)
// but operates on the AWS PKCS#7 / S/MIME signed form of the IID and relies
// ONLY on Node built-ins (no OpenSSL subprocess, no network, no AWS).
//
// Security invariants (do not relax):
//  - The signer certificate is NEVER taken from the PKCS#7 object. Only the
//    independently supplied/pinned certificate (opts.certificatePem) may
//    resolve the signer. This is the equivalent of OpenSSL `-nointern`.
//  - The pinned certificate's DER SHA-256 must equal the expected fingerprint.
//  - The signature is verified against the pinned certificate's public key.
//  - The worker's own claims are never trusted; identifiers are extracted from
//    the cryptographically authenticated document, then fenced against optional
//    expected values.
//
// This module is explicitly NON-AUTHORITY. It proves nothing about reboot
// completion, worker persistence, W1 verification, canonical status, or runtime
// admission. Those gates live in the persisted-readback admission compositor
// (see research/W1_DEV_CYCLE_001_PERSISTENCE_COMPOSITOR.md).

import crypto from 'node:crypto';

// SHA-256 (DER) of the AWS RSA-2048 certificate used for EC2 IID signatures in
// us-east-2 (US East / Ohio), rechecked 2026-08-23. This is the only pinned
// trust root known to this module. Unknown regions fail closed.
export const AWS_USEAST2_RSA2048_CERT_DER_SHA256 =
  'aa6f3e8afcd5e477501fbaf9d19f0945c7d94548f5a2de6375d8bfbab744cae0';

function normalizeHex(value) {
  return String(value).toLowerCase().replace(/[^0-9a-f]/g, '');
}

function pemToDer(pem) {
  if (typeof pem !== 'string') throw new Error('pem_not_string');
  const match = pem.match(/-----BEGIN [^-]+-----([\s\S]+?)-----END [^-]+-----/);
  if (!match) throw new Error('pem_no_block');
  const b64 = match[1].replace(/\s+/g, '');
  return Buffer.from(b64, 'base64');
}

// --- Minimal DER TLV reader (enough for CMS SignedData navigation) ---

function tlv(buf, off) {
  const tag = buf[off];
  let len = buf[off + 1];
  let p = off + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[p + i];
    p += n;
  }
  return { tag, vstart: p, vend: p + len };
}

function seqChildren(buf, start, end) {
  const out = [];
  let p = start;
  while (p < end) {
    const t = tlv(buf, p);
    out.push(t);
    p = t.vend;
  }
  return out;
}

// Extract { content, signature } from an AWS pkcs7/SignedData DER blob.
// Returns null if the structure is not a recognizable SignedData.
function parseSignedData(der) {
  try {
    const root = tlv(der, 0);
    if (root.tag !== 0x30) return null; // SEQUENCE (ContentInfo)
    const ci = seqChildren(der, root.vstart, root.vend);
    if (ci.length < 2) return null;
    const explicit = ci[1];
    if ((explicit.tag & 0xbf) !== 0xa0) return null; // [0] EXPLICIT SignedData
    const sd = tlv(der, explicit.vstart);
    if (sd.tag !== 0x30) return null;
    const sdChildren = seqChildren(der, sd.vstart, sd.vend);
    if (sdChildren.length < 4) return null;

    // SignedData children, in order:
    //   INTEGER version, SET OF digestAlgorithms, SEQUENCE encapContentInfo,
    //   [SET OF certificates], [SET OF crls], SET OF signerInfos.
    // encapContentInfo is the first SEQUENCE; signerInfos is the LAST SET.
    let encap = null;
    let signerSet = null;
    for (const c of sdChildren) {
      if (c.tag === 0x30 && encap === null) encap = c; // encapContentInfo
      if (c.tag === 0x31) signerSet = c; // last SET wins -> signerInfos
    }
    if (!encap || !signerSet) return null;

    const encChildren = seqChildren(der, encap.vstart, encap.vend);
    if (encChildren.length < 2) return null;
    const contentExplicit = encChildren[1];
    if ((contentExplicit.tag & 0xbf) !== 0xa0) return null;
    const octet = tlv(der, contentExplicit.vstart);
    if (octet.tag !== 0x04) return null;
    const content = der.subarray(octet.vstart, octet.vend);

    const signerSeq = seqChildren(der, signerSet.vstart, signerSet.vend);
    if (signerSeq.length < 1) return null;
    const signerInfo = signerSeq[0]; // TLV of SignerInfo (SEQUENCE)
    if (signerInfo.tag !== 0x30) return null;
    const siChildren = seqChildren(der, signerInfo.vstart, signerInfo.vend);
    let signature = null;
    for (const c of siChildren) {
      if (c.tag === 0x04) signature = der.subarray(c.vstart, c.vend);
    }
    if (!signature) return null;
    return { content, signature };
  } catch {
    return null;
  }
}

// Verify a PKCS#7 / S/MIME AWS instance-identity document OFF-HOST.
//
// pkcs7Pem: string, "-----BEGIN PKCS7----- ... -----END PKCS7-----"
// opts:
//   certificatePem     {string}  independently supplied/pinned AWS cert (REQUIRED)
//   expectedFingerprint{string}  DER SHA-256 of the pinned cert (default us-east-2)
//   expectedInstanceId {string}  optional aliasing fence
//   expectedAccountId  {string}  optional aliasing fence
//   expectedRegion     {string}  optional aliasing fence
//
// Returns { ok:true, instanceId, region, accountId, fingerprint } or
// { ok:false, reason }. NEVER throws on bad input; always fail-closed.
export function verifyInstanceIdentityDocument(pkcs7Pem, opts = {}) {
  try {
    const o = opts || {};
    const certPem = o.certificatePem;
    if (typeof certPem !== 'string' || !certPem) {
      return { ok: false, reason: 'pinned_certificate_missing' };
    }

    let pinnedDer;
    try {
      pinnedDer = pemToDer(certPem);
    } catch {
      return { ok: false, reason: 'pinned_certificate_pem_invalid' };
    }
    const fingerprint = crypto.createHash('sha256').update(pinnedDer).digest('hex');
    const expectedFp = o.expectedFingerprint || AWS_USEAST2_RSA2048_CERT_DER_SHA256;
    if (normalizeHex(fingerprint) !== normalizeHex(expectedFp)) {
      return { ok: false, reason: 'certificate_pin_mismatch' };
    }

    let der;
    try {
      der = pemToDer(pkcs7Pem);
    } catch {
      return { ok: false, reason: 'pkcs7_pem_invalid' };
    }

    const parsed = parseSignedData(der);
    if (!parsed || !Buffer.isBuffer(parsed.content) || !Buffer.isBuffer(parsed.signature)) {
      return { ok: false, reason: 'pkcs7_structure_invalid' };
    }

    // The only usable signer is the independently pinned certificate.
    // Embedded PKCS#7 certificates are deliberately ignored (-nointern).
    let pubKey;
    try {
      pubKey = crypto.createPublicKey({ key: certPem, format: 'pem' });
    } catch {
      return { ok: false, reason: 'pinned_certificate_key_unusable' };
    }

    const sigOk = crypto.verify('sha256', parsed.content, pubKey, parsed.signature);
    if (!sigOk) return { ok: false, reason: 'pkcs7_signature_verification_failed' };

    let doc;
    try {
      doc = JSON.parse(parsed.content.toString('utf8'));
    } catch {
      return { ok: false, reason: 'instance_identity_document_invalid_json' };
    }
    if (!doc || typeof doc !== 'object') {
      return { ok: false, reason: 'instance_identity_document_not_object' };
    }

    const { instanceId, region, accountId } = doc;
    if (
      typeof instanceId !== 'string' || !instanceId ||
      typeof region !== 'string' || !region ||
      typeof accountId !== 'string' || !accountId
    ) {
      return { ok: false, reason: 'instance_identity_fields_missing' };
    }

    if (o.expectedInstanceId !== undefined && o.expectedInstanceId !== instanceId) {
      return { ok: false, reason: 'instance_identity_mismatch' };
    }
    if (o.expectedAccountId !== undefined && o.expectedAccountId !== accountId) {
      return { ok: false, reason: 'account_identity_mismatch' };
    }
    if (o.expectedRegion !== undefined && o.expectedRegion !== region) {
      return { ok: false, reason: 'region_identity_mismatch' };
    }

    return { ok: true, instanceId, region, accountId, fingerprint };
  } catch {
    return { ok: false, reason: 'verify_internal_error' };
  }
}

// Bind a verified identity to a reboot receipt + ordered pre/post boot probes.
//
// A changed boot_id across ordered pre/post probes proves a REAL reboot of a
// persistent host (an ephemeral instance would not carry a prior boot_id into a
// new boot). The receipt must reference the same instance as the verified
// identity.
//
// Returns { ok:true, binding } or { ok:false, reason }. NEVER throws.
export function bindRebootReceipt(identity, rebootReceipt, preProbe, postProbe) {
  try {
    if (
      !identity || identity.ok !== true ||
      typeof identity.instanceId !== 'string' || !identity.instanceId
    ) {
      return { ok: false, reason: 'identity_not_verified' };
    }
    if (!rebootReceipt || typeof rebootReceipt !== 'object') {
      return { ok: false, reason: 'reboot_receipt_invalid' };
    }
    const receiptInstanceId = rebootReceipt.instanceId;
    if (typeof receiptInstanceId !== 'string' || receiptInstanceId !== identity.instanceId) {
      return { ok: false, reason: 'receipt_instance_mismatch' };
    }
    if (!preProbe || !postProbe || typeof preProbe !== 'object' || typeof postProbe !== 'object') {
      return { ok: false, reason: 'probe_missing' };
    }
    const preBoot = preProbe.boot_id;
    const postBoot = postProbe.boot_id;
    if (
      typeof preBoot !== 'string' || !preBoot ||
      typeof postBoot !== 'string' || !postBoot
    ) {
      return { ok: false, reason: 'boot_id_invalid' };
    }
    // Changed boot_id is the core proof of a real reboot of a persistent host.
    if (postBoot === preBoot) {
      return { ok: false, reason: 'boot_id_unchanged' };
    }
    return {
      ok: true,
      binding: {
        instanceId: identity.instanceId,
        receiptInstanceId,
        bootIdChanged: true,
        preBootId: preBoot,
        postBootId: postBoot,
      },
    };
  } catch {
    return { ok: false, reason: 'bind_internal_error' };
  }
}
