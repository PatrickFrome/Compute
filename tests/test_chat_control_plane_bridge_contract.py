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
        cls.trusted_glm = (EXT / "trusted-glm.js").read_text()
        cls.bootstrap = (EXT / "bootstrap-config.js").read_text()
        cls.background_wrapper = (EXT / "background.js").read_text()
        cls.background = (EXT / "background-v0522.js").read_text()
        cls.background_entry = (EXT / "background-entry.js").read_text()
        cls.auth_fetch = (EXT / "auth-fetch.js").read_text()
        cls.durable = (EXT / "durable-fetch.js").read_text()
        cls.server = (DAEMON / "server.mjs").read_text()
        cls.secure_entry = (DAEMON / "secure-entry.mjs").read_text()
        cls.manifest = json.loads((EXT / "manifest.json").read_text())

    def test_manifest_and_worker_entrypoints(self):
        self.assertEqual(self.manifest["manifest_version"], 3)
        self.assertEqual(self.manifest["version"], "0.5.22")
        self.assertEqual(self.manifest["background"]["service_worker"], "background-entry.js")
        self.assertIn("debugger", self.manifest["permissions"])
        self.assertEqual(self.manifest["content_scripts"][0]["js"], ["platform-dom-compat.js", "content.js"])
        for script in ["bootstrap-config.js", "auth-fetch.js", "durable-fetch.js", "trusted-chatgpt.js", "trusted-glm.js", "background.js"]:
            self.assertIn(f"importScripts('./{script}')", self.background_entry)
        self.assertIn("background-v0522.js", self.background_wrapper)
        self.assertNotIn("chrome.tabs.reload", self.background_wrapper)
        self.assertNotIn("chrome.tabs.reload", self.background)
        self.assertNotIn("import(", self.background_entry)

    def test_remote_auth_and_secret_boundaries(self):
        self.assertIn(REMOTE_BRIDGE, self.bootstrap)
        self.assertIn('bridgeSecret: ""', self.bootstrap)
        self.assertIn("x-a2-chat-bridge-secret", self.auth_fetch)
        combined = "\n".join([self.content, self.compat, self.trusted, self.trusted_glm, self.bootstrap, self.background_entry, self.auth_fetch, self.durable, self.background])
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

    def test_chatgpt_path_is_single_trusted_enter_send(self):
        execute = self.content.split("async function executeSend(command)", 1)[1].split("async function emitSnapshot", 1)[0]
        chatgpt_block = execute.split('if (platform() === "CHATGPT")', 1)[1].split("} else {", 1)[0]
        self.assertIn("await callTrustedChatgpt(text);", chatgpt_block)
        self.assertNotIn("sendButton.click", chatgpt_block)
        self.assertIn("chatgpt_composer_not_empty_before_send", chatgpt_block)
        self.assertIn('await send(tabId, "Input.insertText", { text });', self.trusted)
        self.assertIn("async function dispatchTrustedEnter", self.trusted)
        self.assertIn('"Input.dispatchKeyEvent"', self.trusted)
        self.assertIn('key: "Enter"', self.trusted)
        self.assertNotIn('"Input.dispatchMouseEvent"', self.trusted)
        self.assertIn("globalThis.A2_CHATGPT_TRUSTED_SEND = trustedSend", self.trusted)

    def test_chatgpt_rollover_is_scoped_to_confirmed_exhaustion(self):
        self.assertIn("conversationExhausted", self.trusted)
        self.assertIn("maximum length for this conversation", self.trusted)
        self.assertIn("chatgpt_cdp_conversation_exhausted", self.trusted)
        self.assertIn("rolloverChatgptAndRetry", self.background)
        self.assertIn("CHATGPT_NEW_CHAT_ROLLOVER", self.background)
        self.assertIn("globalThis.A2_CHATGPT_TRUSTED_SEND", self.background)

    def test_glm_uses_trusted_cdp_mouse_and_no_reload_retry(self):
        self.assertIn("globalThis.A2_GLM_TRUSTED_SEND = trustedSend", self.trusted_glm)
        self.assertIn('"Input.dispatchMouseEvent"', self.trusted_glm)
        self.assertIn('type: "mousePressed"', self.trusted_glm)
        self.assertIn('type: "mouseReleased"', self.trusted_glm)
        self.assertIn("send_button_not_actionable", self.trusted_glm)
        self.assertIn("document.elementFromPoint(x, y)", self.trusted_glm)
        self.assertIn("glm_composer_not_empty_before_trusted_send", self.trusted_glm)
        self.assertNotIn("chrome.tabs.reload", self.trusted_glm)
        self.assertNotIn("reloadAndRetryGlm", self.background)
        self.assertIn("A2_GLM_TRUSTED_SEND", self.background)
        self.assertNotIn("sendButton.click", self.background)

    def test_glm_durable_dispatch_precedes_release(self):
        press = self.trusted_glm.index('type: "mousePressed"')
        durable = self.trusted_glm.index('await postProgress(commandId, transportTraceId, "DISPATCHED")')
        release = self.trusted_glm.index('type: "mouseReleased"', durable)
        self.assertLess(press, durable)
        self.assertLess(durable, release)
        self.assertIn("await rememberDispatched(command, transportTraceId);", self.trusted_glm)
        self.assertIn("GLM_AT_MOST_ONCE_DURABLE_REPLAY", self.trusted_glm)
        self.assertIn("SENT_DISPATCHED_UNCONFIRMED_NO_RETRY", self.trusted_glm)
        self.assertIn("GLM_AT_MOST_ONCE_NO_RELOAD", self.trusted_glm)

    def test_glm_progress_sequence_and_privacy_trace(self):
        for status in ["DISPATCHED", "REQUEST_OBSERVED", "RESPONSE_STARTED", "NETWORK_COMPLETED", "NETWORK_ERROR_HOLD", "RELEASED"]:
            self.assertIn(f'"{status}"', self.trusted_glm)
        self.assertIn("const TRACE_RE = /^[0-9a-f]{32}$/;", self.trusted_glm)
        self.assertIn("crypto.getRandomValues(bytes)", self.trusted_glm)
        self.assertIn("transport_trace_id", self.trusted_glm)
        progress_body = self.trusted_glm.split("async function postProgress", 1)[1].split("async function debuggerCommand", 1)[0]
        self.assertNotIn("requestId", progress_body)
        self.assertNotIn("request.url", progress_body)
        self.assertNotIn("prompt", progress_body)
        self.assertIn("authority_effect: false", progress_body)
        self.assertIn("transport_trace_id: result?.transport_trace_id || null", self.background)

    def test_glm_network_tracking_is_observation_only(self):
        self.assertIn('method === "Network.requestWillBeSent"', self.trusted_glm)
        self.assertIn('method === "Network.responseReceived"', self.trusted_glm)
        self.assertIn('method === "Network.loadingFinished"', self.trusted_glm)
        self.assertIn('method === "Network.loadingFailed"', self.trusted_glm)
        self.assertIn("TRACK_TYPES", self.trusted_glm)
        self.assertNotIn("Network.getResponseBody", self.trusted_glm)
        self.assertNotIn("Fetch.enable", self.trusted_glm)

    def test_legacy_synthetic_glm_send_is_not_reachable_from_active_worker(self):
        self.assertIn("sendButton.click();", self.content)
        self.assertNotIn('type: "EXECUTE_CHAT_SEND"', self.trusted_glm)
        execute = self.background.split("async function executeCommand(command)", 1)[1].split("async function pollCommands", 1)[0]
        glm_branch = execute.split('if (command.target_platform === "GLM_ZAI")', 1)[1].split('} else if (command.target_platform === "CHATGPT")', 1)[0]
        self.assertIn("A2_GLM_TRUSTED_SEND", glm_branch)
        self.assertNotIn("EXECUTE_CHAT_SEND", glm_branch)
        self.assertNotIn("sendChatgptViaContent", glm_branch)

    def test_glm_processing_fallback_still_supports_readback(self):
        self.assertIn("const GLM_PROCESSING_MUTATION_WINDOW_MS = 1800;", self.content)
        self.assertIn('document.querySelectorAll("#chat-input")', self.content)
        self.assertIn('"button.sendMessageButton"', self.content)
        self.assertIn("function glmProcessingActive()", self.content)
        self.assertIn("lastGlmAppMutationAt", self.content)
        self.assertIn("lastGlmStreamMutationAt", self.content)
        self.assertIn('"GLM_PROCESSING_ACTIVE_ACCEPTED"', self.content)
        self.assertNotIn("svelte-", self.content)

    def test_compat_is_selector_only_no_async_transport(self):
        self.assertIn('markExactSendButton("#composer-submit-button")', self.compat)
        self.assertIn('markExactSendButton("#send-message-button")', self.compat)
        self.assertIn('markExactSendButton("button.sendMessageButton")', self.compat)
        self.assertNotIn("runtime.sendMessage", self.compat)
        self.assertNotIn(".click(", self.compat)

    def test_dom_verification_and_idempotency_remain(self):
        for needle in ["function extractMessages()", "function resolveComposer()", "composer_ambiguous", "SENT_AND_DOM_VERIFIED", "a2-chat-bridge:seen-commands"]:
            self.assertIn(needle, self.content)
        self.assertIn("a2BridgeCompletedCommandsV1", self.durable)
        self.assertIn("a2BridgeLeasedCommandsV1", self.durable)
        self.assertIn("a2GlmDispatchedV0522", self.trusted_glm)

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
