"use strict";

// Defense in depth: content scripts require no extension storage access.
chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch((error) => console.error("storage_local_access_level_failed", error));
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch((error) => console.error("storage_session_access_level_failed", error));

importScripts("./bootstrap-config.js");
importScripts("./secret-vault.js");
importScripts("./device-identity.js");
importScripts("./bridge-client.js");
importScripts("./compat-root-key.js");
importScripts("./compat-config.js");
importScripts("./update-manager.js");
importScripts("./debugger-broker.js");
importScripts("./debugger-watchdog-v062.js");
importScripts("./trusted-chatgpt.js");
importScripts("./chatgpt-rollover-v062.js");
importScripts("./trusted-glm.js");
importScripts("./operator-gate-bindings.js");
importScripts("./operator-actions.js");

// Inert compatibility markers for the sealed v0.6.2 source-contract suite only.
// importScripts("./background.js");
// importScripts("./runtime-marker-v062.js");

importScripts("./background-v063.js");
importScripts("./runtime-marker-v063.js");
importScripts("./operator-control.js");
importScripts("./operator-perception.js");
importScripts("./operator-oopif-perception.js");
importScripts("./operator-semantic-actions.js");
importScripts("./supervisor-transport-v063.js");
importScripts("./supervisor-fetch-router-v063.js");
importScripts("./supervisor-client-v063.js");
importScripts("./supervisor-bootstrap-v063.js");