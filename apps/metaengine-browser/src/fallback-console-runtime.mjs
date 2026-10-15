// Retained import boundary for the retired cloud/local failover console.
// The current Client has one attested own-PostgreSQL endpoint. A health probe
// cannot transfer authority, unlock a reserve, or choose a hosted fallback.
export const FALLBACK_CONSOLE_SCHEMA = 'metaengine.fallback-console.v1';

export function createFallbackConsoleRuntime() {
  throw new Error('fallback_console_retired_local_postgres_only');
}
