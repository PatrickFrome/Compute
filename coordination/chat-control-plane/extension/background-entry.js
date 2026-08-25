"use strict";

// Chrome extension service workers support static imports for module workers
// and importScripts() for classic workers, but they do not support dynamic
// import(). Keep this entrypoint classic so startup can synchronously load the
// packaged bridge runtime without a dynamic-import registration failure.
importScripts('./bootstrap-config.js');
importScripts('./auth-fetch.js');
importScripts('./durable-fetch.js');

// Restrict chrome.storage.local to trusted extension contexts as early as
// possible on every worker start. The call is intentionally kicked off before
// background.js is evaluated; listeners are still registered synchronously.
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch((error) => {
  console.error('storage_access_level_failed', error);
});

importScripts('./background.js');
