"use strict";

// Generic source contains routing and provisioning policy only. A personalized
// install may inject two narrowly scoped bootstrap values:
// - bridgeSecret: long-lived bridge-plane credential, migrated once into the
//   extension-origin IndexedDB vault and then used from trusted extension code;
// - supervisorBootstrapSecret: enrollment-only seed. It is intentionally NOT
//   a long-lived bearer credential: successful enrollment replaces it with a
//   durable, non-extractable P-256 device identity and server-side device grant.
//
// Never place Supabase service_role, database credentials, provider API keys,
// or a reusable privileged master secret in this file or any extension bundle.
globalThis.A2_BRIDGE_BOOTSTRAP = Object.freeze({
  daemonUrl: "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-chat-bridge-remote",
  supervisorUrl: "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-supervisor-v4",
  workspaceId: "2de9f84b-7c0a-4091-911c-894ff1d6eaf4",
  deviceProfile: "A2_DEVICE_HTTP_SIGNATURE_V1",
  provisioningMode: "DURABLE_DEVICE_BOUND_V1",
  pairingEpoch: "",
  bridgeSecret: "",
  supervisorBootstrapSecret: ""
});
