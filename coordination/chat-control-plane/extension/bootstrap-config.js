"use strict";

// Public repository bootstrap contains no pairing secret. Personalized release
// bundles replace only pairingEpoch/bridgeSecret at packaging time; executable
// logic stays identical to the runtime-verified source package.
globalThis.A2_BRIDGE_BOOTSTRAP = Object.freeze({
  daemonUrl: "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-chat-bridge-remote",
  pairingEpoch: "",
  bridgeSecret: ""
});
