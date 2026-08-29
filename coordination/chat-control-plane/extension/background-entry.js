"use strict";

chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .catch((error) => console.error("storage_local_access_level_failed", error));
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .catch((error) => console.error("storage_session_access_level_failed", error));

// Phase 0 — durable install identity.
importScripts("./bootstrap-config.js");
importScripts("./secret-vault.js");
importScripts("./device-identity.js");
importScripts("./bridge-client.js");
importScripts("./runtime-marker.js");

// Phase 1 — provider-neutral target/fleet control. Browser provider policy is ChatGPT-only.
importScripts("./target-registry.js");
importScripts("./fleet-runtime.js");
importScripts("./supervisor-device-transport.js");

// Phase 2 — compatibility, update drain and the single trusted browser actuator.
importScripts("./compat-root-key.js");
importScripts("./compat-config.js");
importScripts("./update-manager.js");
importScripts("./debugger-broker.js");
importScripts("./debugger-watchdog.js");
importScripts("./trusted-chatgpt.js");

// Phase 3 — local operator controls and perception/action stack for the selected fleet agent.
importScripts("./operator-actions.js");
importScripts("./operator-control.js");
importScripts("./operator-perception.js");
importScripts("./semantic-perception-compiler.js");
importScripts("./operator-semantic-perception.js");
importScripts("./operator-oopif-perception.js");
importScripts("./operator-semantic-actions.js");
importScripts("./operator-typed-click-outcome.js");

// Phase 4 — signed supervisor authority and self-healing supervisor chat.
importScripts("./supervisor-authority.js");
importScripts("./supervisor-chat-session.js");
importScripts("./trusted-supervisor-chat.js");
importScripts("./supervisor-chat-action.js");
importScripts("./supervisor-chat-guard.js");
importScripts("./supervisor-chat-action-monitor.js");
importScripts("./supervisor-incident-router.js");
importScripts("./supervisor-chat-ui-bridge.js");
