"use strict";

// Defense in depth: content scripts require no extension storage access in v0.5.23.
chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch((error) => console.error("storage_local_access_level_failed", error));
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch((error) => console.error("storage_session_access_level_failed", error));

importScripts("./bootstrap-config.js");
importScripts("./secret-vault.js");
importScripts("./bridge-client.js");
importScripts("./trusted-chatgpt.js");
importScripts("./trusted-glm.js");
importScripts("./background.js");
