// ME2 liveness watchdog (thin entry — see me2-watchdog.ts for logic).
// Follows the Next.js instrumentation pattern: node-only code is loaded
// dynamically only when running in the Node.js runtime.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Desktop owns daemon lifecycle. A standalone host must opt in explicitly.
  if (process.env.ME2_WATCHDOG !== "on") return;
  const { startWatchdog } = await import("./me2-watchdog");
  startWatchdog();
}
