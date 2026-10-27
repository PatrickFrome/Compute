// Observability only. These fixed categories cannot grant Owner admission or
// transfer paths, secrets or renderer-originated strings to a status surface.
const PHASES = new Set([
  'BOOTSTRAP_IMPORT', 'OWNER_BOOTSTRAP_OBSERVED',
  'ATTACHED_DESCRIPTOR_READBACK', 'ATTACHED_OWNER_REVALIDATION',
  'PACKAGED_OWNER_ADMISSION', 'FRESH_LOCAL_PROVIDER_SETUP',
]);
const BOOT_STATES = new Set([
  'NO_OWNER_CONFIG', 'READY', 'BLOCKED', 'ATTACH_REVALIDATING',
  'OFFLINE_DIAGNOSTIC',
]);
const ATTACH_STATES = new Set(['NOT_ATTEMPTED', 'NO_DESCRIPTOR', 'CONFIGURED', 'NOT_APPLICABLE']);

function fixedCode(value, permitted) {
  return typeof value === 'string' && permitted.has(value) ? value : 'UNKNOWN';
}

export function projectPackagedOwnerAdmissionDiagnostic({
  phase = null, bootstrapState = null, attachmentState = 'NOT_ATTEMPTED',
} = {}) {
  return Object.freeze({
    phase: fixedCode(phase, PHASES),
    bootstrap_state: fixedCode(bootstrapState, BOOT_STATES),
    attachment_state: fixedCode(attachmentState, ATTACH_STATES),
    authority_effect: false,
  });
}
