"use strict";

importScripts('./bootstrap-config.js');
importScripts('./auth-fetch.js');
importScripts('./durable-fetch.js');
importScripts('./trusted-chatgpt.js');
if (chrome.debugger?.onEvent?.addListener) importScripts('./trusted-glm.js');

chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch((error) => {
  console.error('storage_access_level_failed', error);
});

importScripts('./background.js');
