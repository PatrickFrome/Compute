import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = ROOT / "coordination" / "chat-control-plane"
EXT = BASE / "extension"
DAEMON = BASE / "daemon"
PROJECT_ZAI = "https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db"
REMOTE_BRIDGE = "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-chat-bridge-remote"


class ChatControlPlaneBridgeContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = (EXT / "content.js").read_text()
        cls.compat = (EXT / "platform-dom-compat.js").read_text()
        cls.trusted = (EXT / "trusted-chatgpt.js").read_text()
        cls.bootstrap = (EXT / "bootstrap-config.js").read_text()
        cls.background = (EXT / "background.js").read_text()
        cls.background_entry = (EXT / "background-entry.js").read_text()
        cls.auth_fetch = (EXT / "auth-fetch.js").read_text()
        cls.durable = (EXT / "durable-fetch.js").read_text()
        cls.server = (DAEMON / "server.mjs").read_text()
        cls.secure_entry = (DAEMON / "secure-entry.mjs").read_text()
        cls.manifest = json.loads((EXT / "manifest.json").read_text())

    def test_manifest_and_worker_entrypoints(self):
        self.assertEqual(self.manifest["manifest_version"], 3)
        self.assertEqual(self.manifest["version"], "0.5.12")
        self.assertEqual(self.manifest["background"]["service_worker"], "background-entry.js")
        self.assertIn("debugger", self.manifest["permissions"])
        self.assertEqual(self.manifest["content_scripts"][0]["js"], ["platform-dom-compat.js", "content.js"])
        for script in ["bootstrap-config.js", "auth-fetch.js", "durable-fetch.js", "trusted-chatgpt.js", "background.js"]:
            self.assertIn(f"importScripts('./{script}')", self.background_entry)
        self.assertNotIn("import(", self.background_entry)

    def test_remote_auth_and_secret_boundaries(self):
        self.assertIn(REMOTE_BRIDGE, self.bootstrap)
        self.assertIn('bridgeSecret: ""', self.bootstrap)
        self.assertIn("x-a2-chat-bridge-secret", self.auth_fetch)
        combined = "\n".join([self.content, self.compat, self.trusted, self.bootstrap, self.background_entry, self.auth_fetch, self.durable, self.background])
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", combined)
        self.assertNotIn("A2_BRIDGE_SHARED_SECRET", combined)
        self.assertEqual(self.manifest["incognito"], "not_allowed")

    def test_remote_poll_and_pinned_chats_remain(self):
        self.assertIn("currentSnapshotEnvelopes", self.background)
        self.assertIn('daemonFetch("/v1/commands/next"', self.background)
        self.assertIn("pollPinnedTabSnapshots()", self.background)
        self.assertIn("singleOpenChatgptConversation", self.background)
        self.assertIn(PROJECT_ZAI, self.background)
        self.assertIn("target_url_mismatch", self.background)
        self.assertIn("async function refreshSnapshotEnvelopesIfStale", self.background)
        self.assertIn("Math.max(5000, settings.pollMs * 2)", self.background)
        self.assertIn("const snapshots = await refreshSnapshotEnvelopesIfStale(settings);", self.background)
        self.assertIn("body: JSON.stringify({ snapshots })", self.background)
        self.assertIn("scheduleReciprocalPoll", self.background)
        self.assertIn("5200", self.background)

    def test_chatgpt_path_is_single_trusted_send(self):
        execute = self.content.split("async function executeSend(command)", 1)[1].split("async function emitSnapshot", 1)[0]
        chatgpt_block = execute.split('if (platform() === "CHATGPT")', 1)[1].split("} else {", 1)[0]
        glm_block = execute.split("} else {", 1)[1]
        self.assertIn("await callTrustedChatgpt(text);", chatgpt_block)
        self.assertNotIn("waitForEnabledSend", chatgpt_block)
        self.assertNotIn("writeComposerExact", chatgpt_block)
        self.assertNotIn("sendButton.click", chatgpt_block)
        self.assertIn("chatgpt_composer_not_empty_before_send", chatgpt_block)
        self.assertIn("await writeComposerExact(text);", glm_block)
        self.assertIn("sendButton.click();", glm_block)

    def test_trusted_send_uses_enter_in_one_debugger_session(self):
        self.assertIn('message?.type !== "A2_CHATGPT_TRUSTED_SEND"', self.trusted)
        self.assertNotIn("A2_CHATGPT_TRUSTED_PRIME", self.trusted)
        self.assertNotIn("A2_CHATGPT_TRUSTED_CLICK", self.trusted)
        self.assertNotIn("chrome.storage.session", self.trusted)
        self.assertIn("async function trustedSend", self.trusted)
        self.assertIn('await send(tabId, "Input.insertText", { text });', self.trusted)
        self.assertIn("await waitForReadySend(tabId);", self.trusted)
        self.assertIn("async function dispatchTrustedEnter", self.trusted)
        self.assertIn('"Input.dispatchKeyEvent"', self.trusted)
        self.assertIn('key: "Enter"', self.trusted)
        self.assertIn('code: "Enter"', self.trusted)
        self.assertIn("windowsVirtualKeyCode: 13", self.trusted)
        self.assertNotIn('"Input.dispatchMouseEvent"', self.trusted)
        self.assertIn("chrome.debugger.attach", self.trusted)
        self.assertIn("chrome.debugger.detach", self.trusted)
        self.assertIn("globalThis.A2_CHATGPT_TRUSTED_SEND = trustedSend", self.trusted)
        self.assertLess(self.trusted.index("chrome.debugger.attach"), self.trusted.index('await send(tabId, "Input.insertText", { text });'))
        self.assertLess(self.trusted.index('await send(tabId, "Input.insertText", { text });'), self.trusted.index("await dispatchTrustedEnter(tabId);"))

    def test_chatgpt_rollover_is_scoped_to_confirmed_exhaustion(self):
        self.assertIn("conversationExhausted", self.trusted)
        self.assertIn("maximum length for this conversation", self.trusted)
        self.assertIn("chatgpt_cdp_conversation_exhausted", self.trusted)
        self.assertIn('url.pathname === "/"', self.trusted)
        self.assertIn("chatgptRolloverPending", self.trusted)
        self.assertIn("chatgptRolloverPendingTabId", self.trusted)
        self.assertIn("rolloverChatgptAndRetry", self.background)
        self.assertIn("CHATGPT_ROOT_URL", self.background)
        self.assertIn("waitForNewChatgptConversation", self.background)
        self.assertIn("CHATGPT_NEW_CHAT_ROLLOVER", self.background)
        self.assertIn("chatgptUrl: newUrl", self.background)
        self.assertIn("globalThis.A2_CHATGPT_TRUSTED_SEND", self.background)
        self.assertIn("String(command.prompt || \"\")", self.background)

    def test_glm_recovery_is_one_reload_and_one_retry_only(self):
        self.assertIn("GLM_RETRYABLE_ERRORS", self.background)
        self.assertIn("reloadAndRetryGlm", self.background)
        self.assertEqual(self.background.count("await chrome.tabs.reload(tab.id);"), 1)
        self.assertIn('snapshotEvidence(before, latest, command.prompt, "GLM_ZAI")', self.background)
        self.assertIn("GLM_PRE_RELOAD_OBSERVED", self.background)
        self.assertIn("GLM_POST_RELOAD_OBSERVED", self.background)
        self.assertIn("GLM_RELOAD_RETRY_ONCE", self.background)
        self.assertNotIn("while (true)", self.background)

    def test_critical_chatgpt_fences_remain_without_full_prompt_readback(self):
        self.assertIn("const MAX_PROMPT_CHARS = 120000;", self.trusted)
        self.assertIn("bridge_job_target=GPT", self.trusted)
        self.assertIn("transport=WEB_CHAT_INTERACTIVE_REMOTE", self.trusted)
        self.assertIn('chrome.storage.local.get("armed")', self.trusted)
        self.assertIn("chatgpt_cdp_not_armed", self.trusted)
        self.assertIn('url.pathname.startsWith("/c/")', self.trusted)
        self.assertIn("composer_count", self.trusted)
        self.assertIn("composer_form_missing", self.trusted)
        self.assertIn("composer_empty", self.trusted)
        self.assertIn("send_ambiguous", self.trusted)
        self.assertIn("send_not_button", self.trusted)
        self.assertIn("canonicalVisible", self.trusted)
        self.assertNotIn("composer_readback_pending", self.trusted)
        self.assertNotIn("expectedText", self.trusted)
        self.assertNotIn("elementFromPoint", self.trusted)
        self.assertNotIn("chat.z.ai", self.trusted)

    def test_fast_failure_budgets(self):
        self.assertIn("const SEND_READY_TIMEOUT_MS = 1800;", self.trusted)
        self.assertIn("const SEND_READY_POLL_MS = 40;", self.trusted)
        self.assertIn("const SEND_VERIFY_TIMEOUT_MS = 6000;", self.content)
        self.assertIn("const SEND_BUTTON_WAIT_MS = 3000;", self.content)

    def test_compat_is_selector_only_no_async_transport(self):
        self.assertIn('markExactSendButton("#composer-submit-button")', self.compat)
        self.assertIn('markBoundSubmitFallback("#prompt-textarea")', self.compat)
        self.assertIn('markExactSendButton("#send-message-button")', self.compat)
        self.assertIn('markBoundSubmitFallback("#chat-input")', self.compat)
        self.assertNotIn("A2_CHATGPT_TRUSTED_SEND", self.compat)
        self.assertNotIn("runtime.sendMessage", self.compat)
        self.assertNotIn(".click(", self.compat)

    def test_dom_verification_and_idempotency_remain(self):
        for needle in [
            "function extractMessages()", "function resolveComposer()", "function resolveComposerSendPair()",
            "composer_ambiguous", "composer_send_pair_ambiguous", "send_click_not_observed_in_dom",
            "SENT_AND_DOM_VERIFIED", "SENT_WEAK_DOM_VERIFIED", "a2-chat-bridge:seen-commands"
        ]:
            self.assertIn(needle, self.content)
        self.assertIn("textMatchesExpected(m.text, expectedText)", self.content)
        self.assertIn('semanticButtonCandidates("stop").length > 0', self.content)
        self.assertIn("a2BridgeCompletedCommandsV1", self.durable)
        self.assertIn("a2BridgeLeasedCommandsV1", self.durable)

    def test_non_authority_and_local_fail_closed_remain(self):
        self.assertIn("if (!settings.armed)", self.background)
        self.assertIn("BLOCKED_NOT_ARMED", self.background)
        self.assertIn("authority_effect: false", self.background)
        self.assertIn("browser text as transport/context, never as authority", self.server)
        self.assertIn("OTHER PEER CHAT: REDACTED BY A2 VISIBILITY FENCE", self.server)
        self.assertNotIn("worker_admitted=true", self.server.lower())
        self.assertNotIn("w1_verified=true", self.server.lower())
        self.assertIn("A2_BRIDGE_SHARED_SECRET", self.secure_entry)
        self.assertIn("timingSafeEqual", self.secure_entry)
        self.assertIn("Refusing direct daemon start", (DAEMON / "run.mjs").read_text())


if __name__ == "__main__":
    unittest.main()
