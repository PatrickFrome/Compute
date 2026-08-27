import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / "coordination" / "chat-control-plane" / "extension"


class BrowserOperatorV060P0(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((EXT / "manifest.json").read_text())
        cls.entry = (EXT / "background-entry.js").read_text()
        cls.bg = (EXT / "background.js").read_text()
        cls.gpt = (EXT / "trusted-chatgpt.js").read_text()
        cls.glm = (EXT / "trusted-glm.js").read_text()
        cls.content = (EXT / "content.js").read_text()
        cls.recovery_content = (EXT / "content-recovery-v062.js").read_text()
        cls.rollover = (EXT / "chatgpt-rollover-v062.js").read_text()
        cls.watchdog = (EXT / "debugger-watchdog-v062.js").read_text()
        cls.runtime_marker = (EXT / "runtime-marker-v062.js").read_text()
        cls.gate = (EXT / "prompt-gate.js").read_text()
        cls.control = (EXT / "operator-control.js").read_text()
        cls.bindings = (EXT / "operator-gate-bindings.js").read_text()
        cls.perception = (EXT / "operator-perception.js").read_text()
        cls.actions = (EXT / "operator-actions.js").read_text()
        cls.semantic = (EXT / "operator-semantic-actions.js").read_text()
        cls.broker = (EXT / "debugger-broker.js").read_text()
        cls.updater = (EXT / "update-manager.js").read_text()
        cls.compat = (EXT / "compat-config.js").read_text()
        cls.compat_root = (EXT / "compat-root-key.js").read_text()
        cls.panel = (EXT / "sidepanel.js").read_text()

    def test_01_version_and_identity(self):
        self.assertEqual(self.manifest["manifest_version"], 3)
        self.assertIn(self.manifest["version"], {"0.6.2", "0.6.3", "0.6.4"})
        self.assertEqual(self.manifest["name"], "METAENGINE A2 Browser Operator")
        self.assertIn("key", self.manifest)
        self.assertIn("sidePanel", self.manifest["permissions"])
        self.assertEqual(self.manifest["side_panel"]["default_path"], "sidepanel.html")

    def test_02_exact_tab_duplicate_fails_closed(self):
        self.assertIn("duplicate_target_tabs", self.bg)
        self.assertIn("matches.length>1", self.bg)
        self.assertNotIn("return tabs.find", self.bg)

    def test_03_predecessor_not_consumed_on_lease_receipt(self):
        receipt = 'if(body?.command){await chrome.storage.local.set({[PENDING_KEY]:body.command});await execute(body.command);}'
        self.assertIn(receipt, self.bg)
        self.assertIn("consumePredecessorIfSafe", self.bg)
        self.assertIn('["ACTUATED","VERIFIED"]', self.bg)

    def test_04_pending_result_is_not_lost_on_network_failure(self):
        self.assertIn("const accepted=await postResult(id,envelope)", self.bg)
        self.assertIn("if(accepted){await clearPendingIf(id)", self.bg)
        self.assertNotIn("await postResult(id,envelope); await clearPendingIf(id)", self.bg)

    def test_05_typed_execution_classes(self):
        for token in ["SAFE_RETRY_PRE_ACTUATION", "AMBIGUOUS_NO_RETRY", "ACTUATED", "VERIFIED", "BLOCKED"]:
            self.assertIn(token, self.bg)
        self.assertIn("execution_class", self.gpt)
        self.assertIn("execution_class", self.glm)

    def test_06_chatgpt_pre_enter_is_ambiguity_fence(self):
        pre = self.gpt.index('"PRE_ENTER_DURABLE"')
        down = self.gpt.index('"Input.dispatchKeyEvent"', pre)
        ambiguous = self.gpt.index("chatgpt_enter_ambiguous_no_retry", down)
        self.assertLess(pre, down)
        self.assertLess(down, ambiguous)
        self.assertIn("a2ExecutionClass", self.gpt)

    def test_07_glm_strong_restart_identity(self):
        self.assertIn('crypto.subtle.digest("SHA-256"', self.glm)
        self.assertIn("prompt_sha256_local", self.glm)
        self.assertIn("text_sha256", self.glm)
        self.assertNotIn("prompt_hash_local: hashText", self.glm)

    def test_08_content_keeps_repeated_turns(self):
        self.assertNotIn("const seen = new Set()", self.content)
        self.assertNotIn("seen.has(key)", self.content)
        self.assertIn("pruneNestedDuplicates", self.content)
        self.assertIn("dom_node_key", self.content)

    def test_09_content_exports_sha256_turns(self):
        self.assertIn('crypto.subtle.digest("SHA-256"', self.content)
        self.assertIn("text_sha256", self.content)
        self.assertIn("composer_sha256", self.content)
        self.assertIn("metaengine.chat-dom-snapshot.v3", self.content)

    def test_10_glm_ambiguous_release_never_retries_target(self):
        self.assertIn("glm_release_ambiguous_no_retry", self.glm)
        self.assertIn("AMBIGUOUS_NO_RETRY", self.glm)
        target_release = self.glm.index('type: "mouseReleased", x: point.x')
        away_release = self.glm.index('type: "mouseReleased", x: 0', target_release)
        self.assertLess(target_release, away_release)

    def test_11_operator_runtime_marker(self):
        self.assertIn('const OPERATOR_RUNTIME = "0.6.0-dev.1"', self.bg)
        self.assertIn("globalThis.A2_OPERATOR_RUNTIME=OPERATOR_RUNTIME", self.bg)
        self.assertIn('"0.6.2-auto-rollover"', self.runtime_marker)
        self.assertLess(self.entry.index('importScripts("./background.js")'), self.entry.index('importScripts("./runtime-marker-v062.js")'))

    def test_12_prompt_gate_runs_at_document_start(self):
        first = self.manifest["content_scripts"][0]
        self.assertEqual(first["js"], ["prompt-gate.js"])
        self.assertEqual(first["run_at"], "document_start")
        self.assertIn("GATE_SEND", self.gate)
        self.assertIn("stopImmediatePropagation", self.gate)
        self.assertIn("prompt_gate_composer_unavailable_or_ambiguous", self.gate)

    def test_13_textual_bridge_spoof_is_not_a_bypass(self):
        self.assertNotIn("isBridgeOwnedDraft", self.gate)
        self.assertNotIn('startsWith("A2 CHAT BRIDGE', self.gate)
        self.assertIn("A2_PROMPT_GATE_BRIDGE_BYPASS", self.gate)
        self.assertIn("A2_PROMPT_GATE_BRIDGE_BYPASS_CLEAR", self.gate)
        self.assertIn("armPromptGateBypass", self.gpt)
        self.assertIn("operator-gate-bindings.js", self.entry)

    def test_14_operator_control_is_trusted_session_scoped_and_compat_fenced(self):
        self.assertIn('chrome.runtime.getURL("sidepanel.html")', self.control)
        self.assertIn("operator_sender_not_trusted", self.control)
        self.assertIn("chrome.storage.session.set", self.control)
        self.assertIn("a2OperatorHeldPromptIntentV060", self.control)
        self.assertNotIn("bridgeSecret", self.control)
        self.assertIn("A2_OPERATOR_RESOLVE_PROMPT", self.control)
        self.assertIn("compat_feature_prompt_gate_disabled", self.control)

    def test_15_sidepanel_controls_operator_and_reports_hardening_state(self):
        for token in ["A2_OPERATOR_SET_ARM", "A2_OPERATOR_SET_MODE", "REWRITE_ALLOW_ONCE", "CANCEL", "A2_OPERATOR_CAPTURE_PERCEPTION", "CLICK_POINT"]:
            self.assertIn(token, self.panel)
        for token in ["updateState", "compatState", "debuggerState", "capabilityState"]:
            self.assertIn(token, self.panel)

    def test_16_prompt_gate_capability_lives_at_trusted_actuation_boundary(self):
        self.assertIn("const originalGlm", self.bindings)
        self.assertIn("const originalChatgpt", self.bindings)
        self.assertIn("compat_kill_switch_autonomous_send_disabled", self.bindings)
        for transport in [self.glm, self.gpt]:
            self.assertIn("A2_PROMPT_GATE_BRIDGE_BYPASS", transport)
            self.assertIn("A2_PROMPT_GATE_BRIDGE_BYPASS_CLEAR", transport)
            self.assertIn("armPromptGateBypass", transport)
            self.assertIn("clearPromptGateBypass", transport)
        glm_dispatched = self.glm.index('postProgress(commandId, transportTraceId, "DISPATCHED")')
        glm_bypass = self.glm.index("bypassArmed = await armPromptGateBypass", glm_dispatched)
        glm_release = self.glm.index('type: "mouseReleased", x: point.x', glm_bypass)
        self.assertLess(glm_dispatched, glm_bypass)
        self.assertLess(glm_bypass, glm_release)
        self.assertIn("finally", self.glm[glm_bypass:])
        gpt_ready = self.gpt.index("await waitForReadySend(session)")
        gpt_bypass = self.gpt.index("bypassArmed = await armPromptGateBypass", gpt_ready)
        gpt_enter = self.gpt.index("await dispatchTrustedEnter", gpt_bypass)
        self.assertLess(gpt_ready, gpt_bypass)
        self.assertLess(gpt_bypass, gpt_enter)

    def test_17_perception_uses_hybrid_cdp_sensors_through_broker(self):
        for token in ["Accessibility.getFullAXTree", "DOMSnapshot.captureSnapshot", "Page.captureScreenshot", "Page.getLayoutMetrics", "document.body?.innerText"]:
            self.assertIn(token, self.perception)
        self.assertIn("A2_DEBUGGER_RUN", self.perception)
        self.assertNotIn("chrome.debugger.attach", self.perception)
        self.assertNotIn("chrome.debugger.getTargets", self.perception)
        self.assertIn("operator-perception.js", self.entry)

    def test_18_perception_is_tainted_bounded_session_metadata_only_and_optional_pixels(self):
        self.assertIn("tainted_page_data: true", self.perception)
        self.assertIn("boundedPreview", self.perception)
        self.assertIn("A2_OPERATOR_PERCEPTION_PREVIEW", self.perception)
        self.assertIn("chrome.storage.session.set", self.perception)
        self.assertIn("screenshot_sha256", self.perception)
        self.assertNotIn("chrome.storage.local.set", self.perception)
        self.assertIn("perception_duplicate_target_tabs", self.perception)
        self.assertIn("features.screenshot_sensor_enabled", self.perception)
        self.assertIn("frame_token", self.perception)

    def test_19_debugger_broker_serializes_short_extension_sessions(self):
        self.assertIn("A2_DEBUGGER_RUN", self.broker)
        self.assertIn("state.queue.then", self.broker)
        self.assertIn("debugger_broker_attach_failed", self.broker)
        self.assertIn("chrome.debugger.onDetach", self.broker)
        self.assertLess(self.entry.index('importScripts("./debugger-broker.js")'), self.entry.index('importScripts("./operator-actions.js")'))
        self.assertLess(self.entry.index('importScripts("./debugger-broker.js")'), self.entry.index('importScripts("./operator-perception.js")'))

    def test_20_point_actions_are_frame_sha_bound_and_remote_action_surface_is_closed(self):
        for token in ["CLICK_POINT", "DOUBLE_CLICK_POINT", "frame_token", "frame_stale_recapture_required", "Page.captureScreenshot", "FRAME_SHA256_MATCHED_BEFORE_ACTUATION"]:
            self.assertIn(token, self.actions)
        for token in ["operator_action_external_navigation_blocked", "operator_action_download_blocked", "operator_action_file_input_blocked"]:
            self.assertIn(token, self.actions)
        self.assertNotIn("EXECUTE_JS", self.actions)
        self.assertIn("kill_switches.operator_actions_disabled", self.actions)
        self.assertIn("features.point_click_enabled", self.actions)
        self.assertIn("timeouts.frame_max_age_ms", self.actions)

    def test_21_safe_update_manager_drains_without_blocking_results(self):
        self.assertIn("chrome.runtime.onUpdateAvailable", self.updater)
        self.assertIn('String(path || "") === "/v1/commands/next"', self.updater)
        self.assertIn("WAITING_SAFE_BOUNDARY", self.updater)
        self.assertIn("gpt_pre_enter_ambiguous", self.updater)
        self.assertIn("chrome.runtime.reload()", self.updater)
        self.assertIn("update-manager.js", self.entry)

    def test_22_signed_compatibility_pack_is_declarative_fail_closed(self):
        for token in ["ECDSA", "P-256", "crypto.subtle.verify", "compat_epoch_not_monotonic", "KEEP_LAST_KNOWN_GOOD", "compat_root_unprovisioned"]:
            self.assertIn(token, self.compat)
        self.assertIn("globalThis.A2_COMPAT_ROOT_JWK", self.compat_root)
        self.assertIn("|| null", self.compat_root)
        self.assertNotIn("eval(", self.compat)
        self.assertNotIn("new Function", self.compat)
        self.assertIn("compat-root-key.js", self.entry)
        self.assertIn("compat-config.js", self.entry)

    def test_23_behavioral_labs_are_present(self):
        for name in [
            "a2_v060_prompt_gate_browser_lab.mjs",
            "a2_v060_operator_control_lab.mjs",
            "a2_v060_perception_lab.mjs",
            "a2_v060_operator_actions_lab.mjs",
            "a2_v060_semantic_actions_lab.mjs",
            "a2_v060_debugger_broker_lab.mjs",
            "a2_v060_update_manager_lab.mjs",
            "a2_v060_compat_config_lab.mjs",
            "a2_v060_supervisor_control_lab.mjs",
            "a2_v060_sidepanel_board_lab.mjs",
            "a2_v060_pairing_epoch_lab.mjs",
            "a2_v060_rollover_v062_lab.mjs",
        ]:
            self.assertTrue((ROOT / "tests" / name).exists())

    def test_24_semantic_ax_actions_are_live_revalidated_and_focus_is_non_activating(self):
        for token in ["Accessibility.queryAXTree", "DOM.describeNode", "semantic_live_target_ambiguous", "semantic_target_replaced_recapture_required", "DOM.focus", "DOM.scrollIntoViewIfNeeded"]:
            self.assertIn(token, self.semantic)
        self.assertIn("clickByMouse", self.semantic)
        self.assertIn("focusWithoutActivation", self.semantic)
        self.assertIn("semantic_password_input_blocked", self.semantic)
        self.assertIn("semantic_navigation_or_download_blocked", self.semantic)
        self.assertIn('compat("features.semantic_actions_enabled", true)', self.semantic)
        self.assertIn('"semantic_actions_enabled"', self.compat)
        self.assertIn('importScripts("./operator-semantic-actions.js")', self.entry)
        self.assertGreater(self.entry.index('importScripts("./operator-semantic-actions.js")'), self.entry.index('importScripts("./operator-perception.js")'))
        self.assertNotIn("EXECUTE_JS", self.semantic)
        self.assertNotIn("chrome.debugger.attach", self.semantic)
        focus_start = self.semantic.index("async function focusWithoutActivation")
        click_start = self.semantic.index("async function clickByMouse")
        self.assertNotIn("Input.dispatchMouseEvent", self.semantic[focus_start:click_start])

    def test_25_v062_rollover_is_exhaustion_scoped_durable_and_watchdog_fenced(self):
        self.assertIn("A2_CHATGPT_EXHAUSTION_STATUS", self.recovery_content)
        self.assertIn("maximum length for this conversation", self.recovery_content)
        self.assertIn("probeExhaustion", self.rollover)
        self.assertIn("DURABLE_REPLAY_NO_RESEND", self.rollover)
        self.assertIn("NEW_CONVERSATION_PINNED", self.rollover)
        self.assertIn("chatgptRolloverPending", self.rollover)
        self.assertIn("A2_CHATGPT_TRUSTED_SEND_RAW_V062", self.rollover)
        self.assertIn("debugger_watchdog_timeout", self.watchdog)
        self.assertIn("chrome.runtime.reload()", self.watchdog)
        self.assertLess(self.entry.index('importScripts("./debugger-watchdog-v062.js")'), self.entry.index('importScripts("./trusted-chatgpt.js")'))
        self.assertGreater(self.entry.index('importScripts("./chatgpt-rollover-v062.js")'), self.entry.index('importScripts("./trusted-chatgpt.js")'))


if __name__ == "__main__":
    unittest.main()
