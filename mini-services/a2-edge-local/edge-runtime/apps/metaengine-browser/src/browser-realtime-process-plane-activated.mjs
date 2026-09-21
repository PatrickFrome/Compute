import { BrowserRealtimeProcessPlane as ProvenBrowserRealtimeProcessPlane } from './browser-realtime-process-plane.mjs';

export * from './browser-realtime-process-plane.mjs';

// The proven process plane already exposes the exact Browser-incarnation cognitive
// bus `sequence`, but its cognitiveSnapshot projection omitted the read contract's
// `latest_sequence` alias consumed by BrowserCognitiveDeltaTransport gap recovery.
// Preserve the proven plane and restore only that observation field. No scheduler,
// command authority, process observer, or execution effect is added here.
export class BrowserRealtimeProcessPlane extends ProvenBrowserRealtimeProcessPlane {
  cognitiveSnapshot(options = {}) {
    const snapshot = super.cognitiveSnapshot(options);
    const latest = Number(snapshot?.latest_sequence ?? snapshot?.sequence);
    if (!Number.isSafeInteger(latest) || latest < 0) {
      throw new Error('activated_cognitive_latest_sequence_invalid');
    }
    return Object.freeze({
      ...snapshot,
      latest_sequence: latest,
      cognitive_gap_recovery_cursor_complete: true,
      second_scheduler: false,
      command_leasing: false,
      control_authority: false,
      authority_effect: false,
    });
  }
}
