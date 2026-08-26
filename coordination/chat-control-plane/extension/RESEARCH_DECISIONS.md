# A2 Chat Bridge research decisions

Review-only note for v0.5.22. Primary transport reliability is non-invasive `chrome.webRequest` + durable `chrome.storage` + server-side busy leases. MAIN-world fetch/XHR monkey-patching remains rejected by default because it can perturb the target application; DOM/MAIN-world signals may be explored only as shadow telemetry. ChatGPT trusted Enter remains unchanged. Browser evidence is non-authority.
