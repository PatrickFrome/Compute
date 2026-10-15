// W67 pure FILETIME decoder: NO Guardian/bootstrap/import side effects.
// The signed native challenge returns an authenticated pipe-client birth as
// decimal text. Avoid floating-point rounding of Windows 100ns FILETIME.
export function guardianClientKernelBirthW67(result) {
  try {
    // This boolean is set only after the native Guardian independently
    // reopened the authenticated pipe client process following its challenge.
    if (result?.client_kernel_birth_rechecked !== true) return null;
    const ticksText = result?.client_creation_time_100ns;
    const pid = result?.client_pid;
    if (typeof ticksText !== 'string' || !/^[1-9][0-9]{16,18}$/.test(ticksText) ||
        !Number.isSafeInteger(pid) || pid < 1 || pid > 0x7fffffff) return null;
    const incarnation = `pid:${pid}:created_100ns:${ticksText}`;
    if (result?.client_process_incarnation_id !== incarnation) return null;
    const millis = (BigInt(ticksText) - 116444736000000000n) / 10000n;
    if (millis <= 0n || millis > BigInt(8640000000000000)) return null;
    return Object.freeze({ pid, created_at: new Date(Number(millis)).toISOString(),
      process_incarnation_id: incarnation });
  } catch { return null; }
}
