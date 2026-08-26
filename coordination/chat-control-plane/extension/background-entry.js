"use strict";

// Defense in depth: content scripts require no extension storage access.
chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch((error) => console.error("storage_local_access_level_failed", error));
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch((error) => console.error("storage_session_access_level_failed", error));

importScripts("./bootstrap-config.js");
importScripts("./secret-vault.js");
importScripts("./bridge-client.js");
importScripts("./trusted-chatgpt.js");
importScripts("./trusted-glm.js");
importScripts("./operator-gate-bindings.js");
importScripts("./background.js");
importScripts("./operator-control.js");
importScripts("./operator-perception.js");
