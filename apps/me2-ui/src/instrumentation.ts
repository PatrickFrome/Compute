// ME2 liveness watchdog (thin entry — see me2-watchdog.ts for logic).
// Follows the Next.js instrumentation pattern: node-only code is loaded
// dynamically only when running in the Node.js runtime.
//
// Browser-owned ME2 must never start a second daemon guardian. The Browser
// process is the sole installed lifecycle owner for both daemon and UI, so a
// hosted UI disables this legacy standalone watchdog fail-closed even if an
// upstream environment forgot to set ME2_WATCHDOG=off.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.ME2_HOSTED_BY_BROWSER === "1") return;
  if (process.env.ME2_WATCHDOG === "off") return;
  const { startWatchdog } = await import("./me2-watchdog");
  startWatchdog();
}
