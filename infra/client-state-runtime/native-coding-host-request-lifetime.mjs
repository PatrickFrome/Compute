// Private IPC context is supplied by the Host, never by the signed payload.
// Cancellation blocks new effects; it does not prove an earlier effect absent.
export function assertNativeCodingHostRequestOpen(context) {
  if (context?.signal?.aborted === true) throw new Error('native_coding_host_request_cancelled');
  if (context?.deadlineAt !== undefined) {
    if (!Number.isSafeInteger(context.deadlineAt) || context.deadlineAt <= Date.now()) {
      throw new Error('native_coding_host_request_deadline_exceeded');
    }
  }
}
