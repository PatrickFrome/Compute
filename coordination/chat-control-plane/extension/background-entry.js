"use strict";

// Defense in depth: content scripts require no extension storage access.
chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch((error) => console.error("storage_local_access_level_failed", error));
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch((error) => console.error("storage_session_access_level_failed", error));

// Phase 0  immutable config, secrets and device identity.
importScripts("./bootstrap-config.js");
importScripts("./secret-vault.js");
importScripts("./device-identity.js");

// Phase 1  bridge transport, runtime identity and persistent logical targets.
importScripts("./bridge-client.js");
importScripts("./runtime-marker.js");
importScripts("./target-registry.js");
importScripts("./target-observability.js");
importScripts("./bridge-runtime.js");
importScripts("./supervisor-device-transport.js");

// Phase 2  compatibility, debugger ownership and trusted platform actuators.
importScripts("./compat-root-key.js");
importScripts("./compat-config.js");
importScripts("./update-manager.js");
importScripts("./debugger-broker.js");
importScripts("./debugger-watchdog.js");
importScripts("./trusted-chatgpt.js");
importScripts("./chatgpt-rollover.js");
importScripts("./trusted-glm.js");
importScripts("./operator-gate-bindings.js");
// B5 lease gate: must load BEFORE operator-actions.js so that
// assertLeaseValid() can validate action leases through
// globalThis.A2_OPERATOR_LEASE_GATE. Without this importScripts line the
// gate global never exists in the MV3 service worker and lease enforcement
// silently no-ops (fail-open).
importScripts("./operator-lease-gate.js");
importScripts("./operator-actions.js");
importScripts("./operator-compute-bridge.js");

// Phase 3  bridge core, perception and typed action execution.
importScripts("./runtime-core.js");
importScripts("./operator-control.js");
importScripts("./operator-perception.js");
importScripts("./operator-oopf-perception.js");
importScripts("./operator-semantic-actions.js");

// Phase 4  signed supervisor authority and self-healing supervisor chat.
importScripts("./supervisor-authority.js");
importScripts("./supervisor-chat-session.js");
importScripts("./trusted-supervisor-chat.js");
importScripts("./supervisor-chat-action.js");
importScripts("./supervisor-chat-guard.js");
importScripts("./supervisor-chat-action-monitor.js");
importScripts("./supervisor-incident-router.js");
importScripts("./supervisor-chat-ui-bridge.js");