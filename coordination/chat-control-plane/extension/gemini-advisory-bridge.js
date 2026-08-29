(() => {
  "use strict";

  const PLATFORM = "GEMINI_GOOGLE";
  const SNAPSHOT_KEY = "snapshot:GEMINI_GOOGLE";
  const STATE_KEY = "a2GeminiAdvisoryStateV1";

  function trustedGeminiSender(sender) {
    try {
      if (!Number.isInteger(sender?.tab?.id)) return false;
      const url = new URL(String(sender?.tab?.url || ""));
      return url.protocol === "https:" && url.hostname.toLowerCase() === "gemini.google.com";
    } catch (_) {
      return false;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "A2_GEMINI_ADVISORY_SNAPSHOT") return false;
    if (!trustedGeminiSender(sender)) {
      sendResponse({ ok: false, error: "gemini_sender_untrusted", authority_effect: false });
      return false;
    }

    const snapshot = message?.snapshot;
    if (snapshot?.platform !== PLATFORM || snapshot?.authority_effect !== false || snapshot?.advisory_only !== true) {
      sendResponse({ ok: false, error: "gemini_snapshot_contract_invalid", authority_effect: false });
      return false;
    }

    const envelope = {
      schema: "metaengine.a2-browser.gemini-advisory-envelope.v1",
      platform: PLATFORM,
      tab_id: sender.tab.id,
      observed_at: new Date().toISOString(),
      advisory_only: true,
      authority_effect: false,
      snapshot
    };

    chrome.storage.local.set({
      [SNAPSHOT_KEY]: envelope,
      [STATE_KEY]: {
        platform: PLATFORM,
        tab_id: sender.tab.id,
        url: snapshot.url || sender.tab.url || null,
        observed_at: envelope.observed_at,
        message_count: Number(snapshot.message_count || 0),
        generating: snapshot.generating === true,
        composer_present: snapshot.composer_present === true,
        advisory_only: true,
        authority_effect: false,
        actuation_enabled: false,
        remote_dispatch_enabled: false
      }
    }).then(
      () => sendResponse({ ok: true, stored: true, authority_effect: false }),
      (error) => sendResponse({ ok: false, error: String(error?.message || error), authority_effect: false })
    );
    return true;
  });

  globalThis.A2_GEMINI_ADVISORY = Object.freeze({
    platform: PLATFORM,
    snapshotKey: SNAPSHOT_KEY,
    stateKey: STATE_KEY,
    advisoryOnly: true,
    authorityEffect: false,
    actuationEnabled: false,
    remoteDispatchEnabled: false
  });
})();
