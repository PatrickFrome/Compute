// A renderer deadline is not IPC cancellation. This gate outlives a component
// mount and releases only when the actual readonly bridge promise settles.
export function createPhysicalReadGate() {
  let pending = null;
  return Object.freeze({
    run(read) {
      if (pending) return null;
      const flight = Promise.resolve().then(read);
      pending = flight;
      const settled = () => { if (pending === flight) pending = null; };
      void flight.then(settled, settled);
      return flight;
    },
    isBusy: () => pending !== null,
  });
}

export const PRIMARY_ROSTER_FRESH_MS = 6_000;
export function isPrimaryRosterFresh(expiresAt, now = Date.now()) {
  return Number.isFinite(expiresAt) && now < expiresAt && expiresAt - now <= PRIMARY_ROSTER_FRESH_MS;
}

export function primaryChatActivity(actor, state, expiresAt, now = Date.now()) {
  if (state !== 'LIVE' || !isPrimaryRosterFresh(expiresAt, now)) {
    return { label: 'Status stale', tone: 'bg-zinc-500' };
  }
  const value = String(actor.state || '').toUpperCase();
  return {
    label: actor.recovery_required ? 'Check session' : value.toLowerCase().replaceAll('_', ' '),
    tone: value === 'ACTIVE' ? 'bg-emerald-400'
      : ['BOUND_UNVERIFIED', 'PROVISIONING'].includes(value) ? 'bg-amber-400' : 'bg-rose-400',
  };
}
