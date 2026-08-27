"use strict";

// Public source contains only non-secret routing. Personalized release packaging
// injects a single-use bootstrap credential that is rotated server-side after
// the first successful P-256 device enrollment. Never place service_role here.
globalThis.A2_BRIDGE_BOOTSTRAP = Object.freeze({
  daemonUrl: "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-chat-bridge-remote",
  supervisorUrl: "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v4",
  workspaceId: "2de9f84b-7c0a-4091-911c-894ff1d6eaf4",
  deviceProfile: "A2_DEVICE_HTTP_SIGNATURE_V1",
  pairingEpoch: "",
  bridgeSecret: ""
});
