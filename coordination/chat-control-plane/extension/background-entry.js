import './bootstrap-config.js';
import './auth-fetch.js';
import './durable-fetch.js';
// The pairing secret and durable Send journal belong to trusted extension
// contexts only. Content scripts communicate through runtime messages and do
// not need direct access to chrome.storage.local.
await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
await import('./background.js');
