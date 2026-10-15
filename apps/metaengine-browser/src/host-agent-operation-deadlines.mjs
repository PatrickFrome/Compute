// A read-only native ACL witness has two independently bounded OS samples.
// Its IPC envelope must outlive those samples; effectful requests retain the
// existing short deadline and never gain retry permission from this policy.
export const NATIVE_BACKUP_ACL_SAMPLE_TIMEOUT_MS = 120000;
export const HOST_BACKUP_ACL_READ_TIMEOUT_MS = 2 * NATIVE_BACKUP_ACL_SAMPLE_TIMEOUT_MS + 5000;

export function hostAgentOperationDeadlineMs(op, requested) {
  const maximum = String(op).toUpperCase() === 'BACKUP_ACL_READBACK'
    ? HOST_BACKUP_ACL_READ_TIMEOUT_MS : 60000;
  const fallback = maximum === HOST_BACKUP_ACL_READ_TIMEOUT_MS ? maximum : 5000;
  return Math.max(100,Math.min(maximum,Number(requested) || fallback));
}
