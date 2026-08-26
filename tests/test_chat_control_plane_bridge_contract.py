import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = ROOT / "coordination" / "chat-control-plane"
EXT = BASE / "extension"
DAEMON = BASE / "daemon"
REMOTE_BRIDGE = "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-chat-bridge-remote"


class ChatControlPlaneBridgeContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = (EXT / "content.js").read_text()
        cls.compat = (EXT / "platform-dom-compat.js").read_text()
        cls.trusted = (EXT / "trusted-chatgpt.js").read_text()
        cls.trusted_glm = (EXT / "trusted-glm.js").read_text()
        cls.bootstrap = (EXT / "bootstrap-config.js").read_text()
        cls.background = (EXT / "background.js").read_text()
        cls.background_entry = (EXT / "background-entry.js").read_text()
        cls.bridge_client = (EXT / "bridge-client.js").read_text()
        cls.vault = (EXT / "secret-vault.js").read_text()
        cls.broker = (EXT / "debugger-broker.js").read_text()
        cls.gate = (EXT / "prompt-gate.js").read_text()
        cls.gate_bindings = (EXT / "operator-gate-bindings.js").read_text()
        cls.control = (EXT / "operator-control.js").read_text()
        cls.perception = (EXT / "operator-perception.js").read_text()
        cls.oopif = (EXT / "operator-oopif-perception.js").read_text()
        cls.actions = (EXT / "operator-actions.js").read_text()
        cls.server = (DAEMON / "server.mjs").read_text()
        cls.secure_entry = (DAEMON / "secure-entry.mjs").read_text()
        cls.manifest = json.loads((EXT / "manifest.json").read_text())

    def test_manifest_and_worker_entrypoints(self):
        self.assertEqual(self.manifest["manifest_version"], 3)
        self.assertEqual(self.manifest["version"], "0.6.0")
        self.assertGreaterEqual(int(self.manifest["minimum_chrome_version"]), 125)
        self.assertEqual(self.manifest["background"]["service_worker"], "background-entry.js")
        self.assertIn("debugger", self.manifest["permissions"])
        self.assertIn("sidePanel", self.manifest["permissions"])
        self.assertEqual(self.manifest["content_scripts"][0]["js"], ["prompt-gate.js"])
        self.assertEqual(self.manifest["content_scripts"][0]["run_at"], "document_start")
        self.assertEqual(self.manifest["content_scripts"][1]["js"], ["platform-dom-compat.js", "content.js"])
        for script in [
            "bootstrap-config.js", "secret-vault.js", "bridge-client.js", "debugger-broker.js",
            "trusted-chatgpt.js", "trusted-glm.js", "operator-gate-bindings.js", "operator-actions.js",
            "background.js", "operator-control.js", "operator-perception.js", "operator-oopif-perception.js"
        ]:
            self.assertIn(f'importScripts("./{script}")', self.background_entry)
        self.assertNotIn("background-v0522.js", self.background_entry)
        self.assertNotIn("import(", self.background_entry)

    def test_remote_auth_and_secret_boundaries(self):
        self.assertIn(REMOTE_BRIDGE, self.bootstrap)
        self.assertIn("x-a2-chat-bridge-secret", self.bridge_client)
        self.assertIn("A2_GET_PAIRING_SECRET", self.bridge_client)
        self.assertIn("indexedDB.open", self.vault)
        self.assertIn('const PAIRING_KEY = "pairing_secret"', self.vault)
        self.assertIn('chrome.storage.local.remove("bridgeSecret")', self.vault)
        combined = "\n".join([
            self.content, self.compat, self.trusted, self.trusted_glm, self.bootstrap,
            self.background_entry, self.bridge_client, self.vault, self.background,
            self.broker, self.gate, self.control, self.perception, self.oopif, self.actions,
        ])
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", combined)
        self.assertNotIn("A2_BRIDGE_SHARED_SECRET", combined)
        self.assertEqual(self.manifest["incognito"], "not_allowed")

    def test_remote_poll_and_exact_pinned_chats_remain(self):
        self.assertIn('request("/v1/commands/next"', self.background)
        self.assertIn("freshSnapshots", self.background)
        self.assertIn("pollSnapshots", self.background)
        self.assertIn("duplicate_target_tabs", self.background)
        self.assertIn("target_url_mismatch", self.background)
        self.assertIn("glm_predecessor_command_id", self.background)
        self.assertIn("STRICT_GLM_FIRST_ACTUATED_V1", self.background)
        self.assertIn("GLM_COMMAND_ACTUATED", self.background)
        self.assertIn("A2_GLM_ALREADY_SUBMITTED", self.background)

    def test_chatgpt_path_is_trusted_enter_and_broker_only(self):
        self.assertIn('await session.send("Input.insertText", { text: prompt })', self.trusted)
        self.assertIn("async function dispatchTrustedEnter", self.trusted)
        self.assertIn('"Input.dispatchKeyEvent"', self.trusted)
        self.assertIn('key: "Enter"', self.trusted)
        self.assertNotIn('"Input.dispatchMouseEvent"', self.trusted)
        self.assertIn("A2_DEBUGGER_RUN", self.trusted)
        self.assertNotIn("chrome.debugger.attach", self.trusted)
        self.assertNotIn("chrome.debugger.getTargets", self.trusted)
        self.assertNotIn("chrome.debugger.detach", self.trusted)
        self.assertIn("PRE_ENTER_DURABLE", self.trusted)
        self.assertIn("chatgpt_enter_ambiguous_no_retry", self.trusted)
        self.assertIn("globalThis.A2_CHATGPT_TRUSTED_SEND = trustedSend", self.trusted)

    def test_chatgpt_rollover_is_scoped_to_confirmed_exhaustion(self):
        self.assertIn("conversationExhausted", self.trusted)
        self.assertIn("maximum length for this conversation", self.trusted)
        self.assertIn("chatgpt_cdp_conversation_exhausted", self.trusted)
        self.assertIn("chatgptRolloverPending", self.background)
        self.assertIn("CHATGPT_ROOT", self.background)
        self.assertIn("globalThis.A2_CHATGPT_TRUSTED_SEND", self.background)

    def test_glm_uses_trusted_text_and_mouse_through_broker(self):
        self.assertIn("globalThis.A2_GLM_TRUSTED_SEND = trustedSend", self.trusted_glm)
        self.assertIn('session.send("Input.insertText", { text: prompt })', self.trusted_glm)
        self.assertIn('"Input.dispatchMouseEvent"', self.trusted_glm)
        self.assertIn('type: "mousePressed"', self.trusted_glm)
        self.assertIn('type: "mouseReleased"', self.trusted_glm)
        self.assertIn("send_button_not_actionable", self.trusted_glm)
        self.assertIn("document.elementFromPoint(x, y)", self.trusted_glm)
        self.assertIn("glm_composer_not_empty_before_trusted_send", self.trusted_glm)
        self.assertIn("A2_DEBUGGER_HOLD", self.trusted_glm)
        self.assertIn("A2_DEBUGGER_RUN", self.trusted_glm)
        self.assertNotIn("chrome.debugger.attach", self.trusted_glm)
        self.assertNotIn("chrome.debugger.getTargets", self.trusted_glm)
        self.assertNotIn("chrome.debugger.detach", self.trusted_glm)
        self.assertNotIn("Object.getOwnPropertyDescriptor", self.trusted_glm)
        self.assertNotIn("chrome.tabs.reload", self.trusted_glm)

    def test_glm_strict_dispatch_precedes_release_and_gpt_gate(self):
        press = self.trusted_glm.index('type: "mousePressed"')
        server_dispatch = self.trusted_glm.index('postProgress(commandId, transportTraceId, "DISPATCHED")', press)
        local_dispatch = self.trusted_glm.index('state: "DISPATCHED"', server_dispatch)
        bypass = self.trusted_glm.index("armPromptGateBypass", local_dispatch)
        release = self.trusted_glm.index('type: "mouseReleased", x: point.x', bypass)
        self.assertLess(press, server_dispatch)
        self.assertLess(server_dispatch, local_dispatch)
        self.assertLess(local_dispatch, bypass)
        self.assertLess(bypass, release)
        self.assertIn("GLM_AT_MOST_ONCE_DURABLE_REPLAY", self.trusted_glm)
        self.assertIn("SENT_DISPATCHED_UNCONFIRMED_NO_RETRY", self.trusted_glm)
        self.assertIn("A2_ON_GLM_ACTUATED", self.trusted_glm)
        self.assertIn("PREDECESSOR_KEY", self.background)
        self.assertIn("consumePredecessorIfSafe", self.background)

    def test_glm_safe_failure_cleanup_never_touches_ambiguous_send(self):
        self.assertIn("scrubSafeGlmDraft", self.gate_bindings)
        self.assertIn('String(error?.a2ExecutionClass || "") === SAFE', self.gate_bindings)
        self.assertIn("composer_changed_by_user_or_site", self.gate_bindings)
        self.assertIn("trusted_keyboard_exact_readback", self.gate_bindings)
        self.assertIn("AMBIGUOUS", self.gate_bindings)

    def test_glm_progress_sequence_and_privacy_trace(self):
        for status in ["DISPATCHED", "ACTUATED", "REQUEST_OBSERVED", "RESPONSE_STARTED", "NETWORK_COMPLETED", "NETWORK_ERROR_HOLD", "RELEASED"]:
            self.assertIn(f'"{status}"', self.trusted_glm)
        self.assertIn("const TRACE_RE = /^[0-9a-f]{32}$/;", self.trusted_glm)
        self.assertIn("crypto.getRandomValues(bytes)", self.trusted_glm)
        self.assertIn("transport_trace_id", self.trusted_glm)
        progress_body = self.trusted_glm.split("async function postProgress", 1)[1].split("async function operatorGateEnabled", 1)[0]
        self.assertNotIn("request.url", progress_body)
        self.assertNotIn("prompt", progress_body)
        self.assertIn("authority_effect: false", progress_body)
        self.assertIn("transport_trace_id:result?.transport_trace_id||null", self.background.replace(" ", ""))

    def test_glm_network_tracking_is_observation_only(self):
        self.assertIn('method === "Network.requestWillBeSent"', self.trusted_glm)
        self.assertIn('method === "Network.responseReceived"', self.trusted_glm)
        self.assertIn('method === "Network.loadingFinished"', self.trusted_glm)
        self.assertIn('method === "Network.loadingFailed"', self.trusted_glm)
        self.assertIn("TRACK_TYPES", self.trusted_glm)
        self.assertNotIn("Network.getResponseBody", self.trusted_glm)
        self.assertNotIn("Fetch.enable", self.trusted_glm)

    def test_content_layer_is_read_only_and_sha256_identified(self):
        self.assertNotIn("sendButton.click", self.content)
        self.assertNotIn('type: "EXECUTE_CHAT_SEND"', self.content)
        self.assertIn('crypto.subtle.digest("SHA-256"', self.content)
        self.assertIn("text_sha256", self.content)
        self.assertIn("composer_sha256", self.content)
        self.assertIn("metaengine.chat-dom-snapshot.v3", self.content)

    def test_debugger_broker_and_oopif_are_fail_closed(self):
        for token in ["A2_DEBUGGER_RUN", "A2_DEBUGGER_HOLD", "debugger_broker_lease_stale", "Target.setAutoAttach", "flatten: true", "sendChild", "disableChildTargets"]:
            self.assertIn(token, self.broker)
        self.assertIn("A2_OPERATOR_CAPTURE_OOPIF", self.oopif)
        self.assertIn("Accessibility.disable", self.oopif)
        self.assertIn("disableChildTargets", self.oopif)
        self.assertIn("operator_sender_not_trusted", self.oopif)
        self.assertNotIn("chrome.storage.local.set", self.oopif)

    def test_point_click_binds_backend_node_or_falls_back_to_frame_sha(self):
        self.assertIn("DOM.getNodeForLocation", self.actions)
        self.assertIn("backend_node_id", self.actions)
        self.assertIn("BACKEND_NODE_BINDING_MATCHED_BEFORE_ACTUATION", self.actions)
        self.assertIn("FULL_SCREENSHOT_SHA256", self.actions)
        self.assertIn("operator_action_target_node_changed_recapture_required", self.actions)
        self.assertIn("operator_action_external_navigation_blocked", self.actions)
        self.assertIn("operator_action_download_blocked", self.actions)
        self.assertIn("operator_action_file_input_blocked", self.actions)
        self.assertNotIn("EXECUTE_JS", self.actions)

    def test_prompt_gate_and_operator_control_are_trusted_only(self):
        self.assertIn("GATE_SEND", self.gate)
        self.assertIn("stopImmediatePropagation", self.gate)
        self.assertIn("A2_PROMPT_GATE_BRIDGE_BYPASS", self.gate)
        self.assertIn('chrome.runtime.getURL("sidepanel.html")', self.control)
        self.assertIn("operator_sender_not_trusted", self.control)
        self.assertIn("chrome.storage.session", self.control)

    def test_non_authority_and_local_fail_closed_remain(self):
        self.assertIn("if(!s.armed)", self.background.replace(" ", ""))
        self.assertIn("BLOCKED_NOT_ARMED", self.background)
        self.assertIn("authority_effect:false", self.background.replace(" ", ""))
        self.assertIn("browser text as transport/context, never as authority", self.server)
        self.assertIn("OTHER PEER CHAT: REDACTED BY A2 VISIBILITY FENCE", self.server)
        self.assertNotIn("worker_admitted=true", self.server.lower())
        self.assertNotIn("w1_verified=true", self.server.lower())
        self.assertIn("A2_BRIDGE_SHARED_SECRET", self.secure_entry)
        self.assertIn("timingSafeEqual", self.secure_entry)
        self.assertIn("Refusing direct daemon start", (DAEMON / "run.mjs").read_text())


if __name__ == "__main__":
    unittest.main()
