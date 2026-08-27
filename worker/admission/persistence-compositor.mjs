// Persisted-readback admission compositor for H205F22 W1.
//
// This is an ADDITIVE, FAIL-CLOSED, PURE Node.js implementation of the
// persistence compositor slice of the W1 worker-admission contract
// (C1 - First Real Linux Worker). It turns a cryptographically verified
// off-host identity plus a reboot receipt into a NON-EPHEMERAL backend
// binding decision.
//
// It composes the two primitives from ./offhost-iid-verify.mjs:
//   - verifyInstanceIdentityDocument(pkcs7Pem, opts)
//   - bindRebootReceipt(identity, rebootReceipt, preProbe, postProbe)
//
// Security invariants (do not relax):
//  - Identity is never taken from caller claims. It is the output of
//    verifyInstanceIdentityDocument, which authenticates an AWS-signed IID.
//  - Reboot completion is never asserted by the worker. It is proven by a
//    CHANGED boot_id across ordered pre/post probes via bindRebootReceipt.
//  - Ephemeral backends (spot/ephemeral/request lifecycles) are REJECTED.
//    A persistent worker requires a non-ephemeral, off-host-verified binding.
//  - Idempotency: an already-active binding for the same instanceId is a
//    duplicate and rejected unless an explicit allowRebind opt-in supersedes
//    the prior active entry.
//  - The module NEVER throws on bad input; every failure is fail-closed.
//
// This module is explicitly NON-AUTHORITY. It produces an admission decision
// object only. It performs NO persisted write, NO synthetic proof rows, and
// sets NO canonical/worker_admitted/w1_verified flags. authority_effect=false.

import crypto from 'node:crypto';
import {
  verifyInstanceIdentityDocument,
  bindRebootReceipt,
} from './offhost-iid-verify.mjs';

// Lifecycle values that, by definition, are NOT a persistent backend.
const EPHEMERAL_LIFECYCLES = ['spot', 'ephemeral', 'request'];

function activeBindingForInstance(existingBindings, instanceId) {
  if (!Array.isArray(existingBindings)) return null;
  // Return the most recent still-active binding for this instanceId.
  let found = null;
  for (const b of existingBindings) {
    if (!b || typeof b !== 'object') continue;
    if (b.instanceId !== instanceId) continue;
    if (b.revokedAt !== undefined && b.revokedAt !== null) continue; // superseded/revoked
    found = b;
  }
  return found;
}

// Compose a non-ephemeral backend admission decision.
//
// input:
//   pkcs7Pem, opts        -> forwarded verbatim to verifyInstanceIdentityDocument
//   rebootReceipt, preProbe, postProbe -> forwarded to bindRebootReceipt
//   existingBindings      -> array of prior binding objects (read-only; never mutated)
//   metadata              -> { nonEphemeral?, lifecycle?, backend?, allowRebind? }
//
// Returns { admit:true, binding } or { admit:false, reason }.
// NEVER throws on bad input; any unexpected error -> { admit:false, reason:'compositor_error' }.
export function composeAdmission(input = {}) {
  try {
    const {
      pkcs7Pem,
      opts,
      rebootReceipt,
      preProbe,
      postProbe,
      existingBindings,
      metadata,
    } = input || {};

    // 1. Verify off-host identity. Never trust worker claims.
    const identity = verifyInstanceIdentityDocument(pkcs7Pem, opts);
    if (!identity || identity.ok !== true) {
      return { admit: false, reason: 'identity_unverified' };
    }

    // 2. Bind the verified identity to a reboot receipt with changed boot_id.
    const bind = bindRebootReceipt(identity, rebootReceipt, preProbe, postProbe);
    if (!bind || bind.ok !== true) {
      return { admit: false, reason: 'reboot_binding_failed:' + (bind && bind.reason ? bind.reason : 'unknown') };
    }

    // 3. Require a non-ephemeral backend. Fail-closed on any ambiguity.
    const md = metadata && typeof metadata === 'object' ? metadata : {};
    const lifecycle = md.lifecycle;
    const lifecycleIsNonEphemeral =
      typeof lifecycle === 'string' && !EPHEMERAL_LIFECYCLES.includes(lifecycle);
    const nonEphemeral = md.nonEphemeral === true || lifecycleIsNonEphemeral;
    if (!nonEphemeral) {
      return { admit: false, reason: 'ephemeral_backend_rejected' };
    }

    // 4. Idempotency / uniqueness. Reject duplicate active bindings unless rebind.
    const prior = activeBindingForInstance(existingBindings, identity.instanceId);
    const allowRebind = md.allowRebind === true;
    if (prior && !allowRebind) {
      return { admit: false, reason: 'duplicate_active_binding' };
    }

    // 5. Emit the non-ephemeral binding decision (no side effects / no writes).
    const supersedes = prior ? (prior.id !== undefined ? prior.id : prior.instanceId) : undefined;
    const binding = {
      instanceId: identity.instanceId,
      region: identity.region,
      accountId: identity.accountId,
      backend: md.backend,
      nonEphemeral: true,
      persistedAt: new Date().toISOString(),
      nonce: crypto.randomBytes(16).toString('hex'),
      supersedes,
    };

    return { admit: true, binding };
  } catch {
    return { admit: false, reason: 'compositor_error' };
  }
}

// Pure revocation: returns a NEW bindings array with the matching entry marked
// revokedAt / revokedReason. Does NOT mutate the input array or its entries.
export function revokeBinding(bindings, instanceId, reason) {
  try {
    if (!Array.isArray(bindings)) return [];
    const revokedAt = new Date().toISOString();
    return bindings.map((b) => {
      if (b && typeof b === 'object' && b.instanceId === instanceId) {
        return { ...b, revokedAt, revokedReason: reason };
      }
      return b;
    });
  } catch {
    return Array.isArray(bindings) ? bindings.slice() : [];
  }
}