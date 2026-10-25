// Presentation colors only; no daemon transport or effect authority.
export const STATUS_BADGE: Record<string, string> = {
  READY: "bg-zinc-700 text-zinc-200", RUNNING: "bg-amber-500/90 text-black",
  COMPLETED: "bg-emerald-600 text-white", FAILED: "bg-rose-600 text-white",
  CANCELLED: "bg-zinc-600 text-zinc-300", PENDING: "bg-zinc-700 text-zinc-300",
  LEASED: "bg-amber-500/80 text-black", REJECTED: "bg-rose-800 text-rose-200",
  HANDED_OFF: "bg-violet-700 text-violet-100", PARKED: "bg-amber-800 text-amber-100",
  BUSY: "bg-amber-500/90 text-black", IDLE: "bg-emerald-700 text-emerald-100",
  OFFLINE: "bg-zinc-800 text-zinc-500", PAUSED: "bg-amber-700 text-amber-100",
  ARCHIVED: "bg-zinc-800 text-zinc-400", THINKING: "bg-violet-600 text-violet-50",
  ACTIVE: "bg-emerald-700 text-emerald-100", CLOSED: "bg-zinc-700 text-zinc-300",
};
