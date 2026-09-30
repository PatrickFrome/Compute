// Enrollment metadata is untrusted. Copy only the bounded correlation fields;
// approval remains owned by the signed GitHub OIDC qualifier and SQL readback.
export function normalizeEnrollmentMetadata(body) {
  const input = body?.metadata;
  const metadata = {
    client_kind: 'METAENGINE_BROWSER_ELECTRON_NATIVE',
    shell_version: String(input?.shell_version || '').slice(0, 32),
  };
  const kind = String(input?.qualification_kind || '').trim().toUpperCase();
  const runId = String(input?.qualification_run_id || '').trim();
  const runAttempt = String(input?.qualification_run_attempt || '').trim();
  const sourceHead = String(input?.source_head || '').trim().toLowerCase();
  const nonceSha256 = String(input?.qualification_nonce_sha256 || '').trim().toLowerCase();
  if (kind === 'INSTALLED_ELECTRON'
    && /^[0-9]{1,20}$/.test(runId)
    && /^[1-9][0-9]{0,5}$/.test(runAttempt)
    && /^[0-9a-f]{40}$/.test(sourceHead)) {
    metadata.qualification_kind = kind;
    metadata.qualification_run_id = runId;
    metadata.qualification_run_attempt = runAttempt;
    metadata.source_head = sourceHead;
    // Older requests may lack a nonce, but cannot pass nonce-bound approval.
    if (/^[0-9a-f]{64}$/.test(nonceSha256)) {
      metadata.qualification_nonce_sha256 = nonceSha256;
    }
  }
  return metadata;
}
