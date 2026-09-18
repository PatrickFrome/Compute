"use strict";

// Public source contains only non-secret routing. Personalized release packaging
// injects two independent scoped credentials:
// - bridgeSecret: long-lived bridge-plane pairing token;
// - supervisorBootstrapSecret: single-use P-256 enrollment token, rotated
//   server-side to a device-only grant after successful enrollment.
// Never place Supabase service_role or a private device key here.
globalThis.A2_BRIDGE_BOOTSTRAP = Object.freeze({
  daemonUrl: "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-chat-bridge-remote",
  supervisorUrl: "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v4",
  workspaceId: "2de9f84b-7c0a-4091-911c-894ff1d6eaf4",
  deviceProfile: "A2_DEVICE_HTTP_SIGNATURE_V1",
  pairingEpoch: "",
  bridgeSecret: "",
  supervisorBootstrapSecret: ""
});
