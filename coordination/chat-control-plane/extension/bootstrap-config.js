"use strict";

// Public repository bootstrap contains no pairing secret. Personalized release
// bundles may replace bridgeSecret at packaging time without committing it.
globalThis.A2_BRIDGE_BOOTSTRAP = Object.freeze({
  daemonUrl: "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-chat-bridge-remote",
  bridgeSecret: ""
});
