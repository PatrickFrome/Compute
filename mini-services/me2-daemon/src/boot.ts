// Boot clock kept outside version.ts so hot reloads don't reset the epoch.
import { BOOT_SPAN_MS } from "./version";

export const STARTED_VERSION = {
  started_at_ms: Date.now(),
  boot_span_ms: BOOT_SPAN_MS,
};
export { BOOT_SPAN_MS };
