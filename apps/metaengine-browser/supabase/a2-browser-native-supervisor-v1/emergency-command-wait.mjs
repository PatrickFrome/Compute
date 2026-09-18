export const EMERGENCY_COMMAND_WAIT_SCHEMA = 'metaengine.native-supervisor.emergency-wait.v1';

function validLease(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const command = value.command && typeof value.command === 'object' && !Array.isArray(value.command)
    ? value.command
    : null;
  if (!command) return null;
  const action = String(command.action || '').trim().toUpperCase();
  if (action === 'DISARM') return command;
  if (action === 'SET_SUPERVISOR_MODE' && String(command?.payload?.mode || '').trim().toUpperCase() === 'OFF') return command;
  throw new Error('emergency_wait_non_emergency_lease_rejected');
}

function response(command, reason, dbReads) {
  return Object.freeze({
    schema: EMERGENCY_COMMAND_WAIT_SCHEMA,
    command: command ? structuredClone(command) : null,
    leased_count: command ? 1 : 0,
    wake_reason: reason,
    authoritative_db_reads: dbReads,
    polling_loop: false,
    transport_delivery_is_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

/**
 * Race-safe server-side composition for a dedicated emergency endpoint.
 * Authority comes only from leaseEmergency(), never from Broadcast delivery.
 * The algorithm is bounded to initial lease + subscribe recheck + final read.
 */
export async function waitForEmergencyCommand({
  leaseEmergency,
  openWake,
  waitMs = 4000,
} = {}) {
  if (typeof leaseEmergency !== 'function') throw new Error('emergency_wait_lease_required');
  if (typeof openWake !== 'function') throw new Error('emergency_wait_transport_required');

  let dbReads = 0;
  const lease = async () => {
    dbReads += 1;
    return validLease(await leaseEmergency());
  };

  const initial = await lease();
  if (initial) return response(initial, 'IMMEDIATE', dbReads);

  const waiter = openWake({ waitMs: Math.max(250, Math.min(15000, Number(waitMs) || 4000)) });
  if (!waiter || typeof waiter.close !== 'function' || !waiter.subscribed || !waiter.wake) {
    throw new Error('emergency_wait_transport_invalid');
  }

  try {
    const subscribed = await waiter.subscribed;
    if (subscribed?.ok !== true) {
      const fallback = await lease();
      return response(fallback, `SUBSCRIBE_${String(subscribed?.reason || 'FAILED').slice(0, 80)}`, dbReads);
    }

    // Close the lease-before-subscribe race. If the command committed while the
    // socket was joining, this read finds it without needing a Broadcast.
    const afterSubscribe = await lease();
    if (afterSubscribe) return response(afterSubscribe, 'AFTER_SUBSCRIBE_RECHECK', dbReads);

    const wake = await waiter.wake;
    const final = await lease();
    return response(final, `WAKE_${String(wake?.reason || 'UNKNOWN').slice(0, 80)}`, dbReads);
  } finally {
    waiter.close();
  }
}
