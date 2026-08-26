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
        cls.options = (EXT / "options.js").read_text()
        cls.options_html = (EXT / "options.html").read_text()
        cls.server = (DAEMON / "server.mjs").read_text()
        cls.secure_entry = (DAEMON / "secure-entry.mjs").read_text()
        cls.manifest = json.loads((EXT / "manifest.json").read_text())

    def test_manifest_and_worker_entrypoints(self):
        self.assertEqual(self.manifest["manifest_version"], 3)
        self.assertEqual(self.manifest["version"], "0.5.9")
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
        self.assertIn("bridge_pairing_secret_missing_or_short", self.auth_fetch)
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

    def test_chatgpt_path_is_synchronous_cdp_not_dom_input(self):
        execute = self.content.split("async function executeSend(command)", 1)[1].split("async function emitSnapshot", 1)[0]
        self.assertIn('if (platform() === "CHATGPT")', execute)
        self.assertIn('composerText(composer) !== ""', execute)
        self.assertIn('await callTrustedChatgpt("A2_CHATGPT_TRUSTED_PRIME", text);', execute)
        self.assertIn('const sendButton = await waitForEnabledSend(text);', execute)
        self.assertIn('await callTrustedChatgpt("A2_CHATGPT_TRUSTED_CLICK", text);', execute)
        chatgpt_block = execute.split('if (platform() === "CHATGPT")', 1)[1].split("} else {", 1)[0]
        self.assertNotIn("writeComposerExact", chatgpt_block)
        self.assertNotIn("sendButton.click", chatgpt_block)
        glm_block = execute.split("} else {", 1)[1]
        self.assertIn("await writeComposerExact(text);", glm_block)
        self.assertIn("sendButton.click();", glm_block)

    def test_chatgpt_trusted_prime_accepts_full_bridge_prompt_and_verifies_readback(self):
        self.assertIn("const MAX_PROMPT_CHARS = 120000;", self.trusted)
        self.assertNotIn("const MAX_PROMPT_CHARS = 42000;", self.trusted)
        self.assertIn('"A2_CHATGPT_TRUSTED_PRIME"', self.trusted)
        self.assertIn('"A2_CHATGPT_TRUSTED_CLICK"', self.trusted)
        self.assertIn('beforeText !== "" && beforeText !== normalize(text)', self.trusted)
        self.assertIn("chatgpt_cdp_composer_not_empty", self.trusted)
        self.assertIn('"Input.insertText"', self.trusted)
        self.assertIn("chatgpt_cdp_prime_readback_mismatch", self.trusted)
        self.assertIn('"Input.dispatchMouseEvent"', self.trusted)
        self.assertIn("chrome.debugger.attach", self.trusted)
        self.assertIn("chrome.debugger.detach", self.trusted)
        self.assertIn('chrome.storage.local.get("armed")', self.trusted)
        self.assertIn("chatgpt_cdp_not_armed", self.trusted)
        self.assertIn('url.pathname.startsWith("/c/")', self.trusted)
        self.assertNotIn("chat.z.ai", self.trusted)

    def test_chatgpt_long_prompt_uses_single_atomic_editor_insertion(self):
        self.assertIn("const ATOMIC_LONG_PROMPT_THRESHOLD = 32000;", self.trusted)
        self.assertIn("async function insertComposerAtomic", self.trusted)
        self.assertIn("document.execCommand('insertText', false, text)", self.trusted)
        self.assertIn("if (text.length > ATOMIC_LONG_PROMPT_THRESHOLD)", self.trusted)
        self.assertIn('return "ATOMIC_EXEC_COMMAND";', self.trusted)
        self.assertIn('return "CDP_INPUT_INSERT_TEXT";', self.trusted)
        self.assertNotIn("for (const chunk", self.trusted)
        self.assertNotIn("slice(offset", self.trusted)
        self.assertIn("insertion_mode: insertionMode", self.trusted)
        self.assertIn("chatgpt_cdp_prime_readback_mismatch", self.trusted)

    def test_compat_is_selector_only_no_async_transport(self):
        self.assertIn('markExactSendButton("#composer-submit-button")', self.compat)
        self.assertIn('markBoundSubmitFallback("#prompt-textarea")', self.compat)
        self.assertIn('markExactSendButton("#send-message-button")', self.compat)
        self.assertIn('markBoundSubmitFallback("#chat-input")', self.compat)
        self.assertNotIn("A2_CHATGPT_TRUSTED_PRIME", self.compat)
        self.assertNotIn("A2_CHATGPT_TRUSTED_CLICK", self.compat)
        self.assertNotIn("runtime.sendMessage", self.compat)
        self.assertNotIn(".click(", self.compat)

    def test_dom_readback_fail_closed_and_verification_remain(self):
        for needle in [
            "function extractMessages()", "function resolveComposer()", "function resolveComposerSendPair()",
            "composer_ambiguous", "composer_send_pair_ambiguous", "composer_send_pair_not_found",
            "send_button_not_enabled_or_pair_unresolved", "send_click_not_observed_in_dom",
            "SENT_AND_DOM_VERIFIED", "SENT_WEAK_DOM_VERIFIED"
        ]:
            self.assertIn(needle, self.content)
        self.assertIn("composerText(pair.composer) === expected", self.content)
        self.assertIn('semanticButtonCandidates("stop").length > 0', self.content)

    def test_arming_idempotency_visibility_and_non_authority_remain(self):
        self.assertIn("if (!settings.armed)", self.background)
        self.assertIn("BLOCKED_NOT_ARMED", self.background)
        self.assertIn("armed: false", self.background)
        self.assertIn("a2-chat-bridge:seen-commands", self.content)
        self.assertIn("a2BridgeCompletedCommandsV1", self.durable)
        self.assertIn("a2BridgeLeasedCommandsV1", self.durable)
        self.assertIn("authority_effect: false", self.background)
        self.assertIn("browser text as transport/context, never as authority", self.server)
        self.assertIn("OTHER PEER CHAT: REDACTED BY A2 VISIBILITY FENCE", self.server)
        self.assertNotIn("worker_admitted=true", self.server.lower())
        self.assertNotIn("w1_verified=true", self.server.lower())

    def test_local_daemon_still_fails_closed(self):
        self.assertIn("A2_BRIDGE_SHARED_SECRET", self.secure_entry)
        self.assertIn("timingSafeEqual", self.secure_entry)
        self.assertIn("Refusing direct daemon start", (DAEMON / "run.mjs").read_text())


if __name__ == "__main__":
    unittest.main()
