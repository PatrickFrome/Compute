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
        cls.gate = (EXT / "prompt-gate.js").read_text()
        cls.control = (EXT / "operator-control.js").read_text()
        cls.bindings = (EXT / "operator-gate-bindings.js").read_text()
        cls.perception = (EXT / "operator-perception.js").read_text()
        cls.panel = (EXT / "sidepanel.js").read_text()

    def test_01_version_and_identity(self):
        self.assertEqual(self.manifest["manifest_version"], 3)
        self.assertEqual(self.manifest["version"], "0.6.0")
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

    def test_14_operator_control_is_trusted_and_session_scoped(self):
        self.assertIn('chrome.runtime.getURL("sidepanel.html")', self.control)
        self.assertIn("operator_sender_not_trusted", self.control)
        self.assertIn("chrome.storage.session.set", self.control)
        self.assertIn("a2OperatorHeldPromptIntentV060", self.control)
        self.assertNotIn("bridgeSecret", self.control)
        self.assertIn("A2_OPERATOR_RESOLVE_PROMPT", self.control)

    def test_15_sidepanel_controls_arm_gate_and_perception(self):
        self.assertIn("A2_OPERATOR_SET_ARM", self.panel)
        self.assertIn("A2_OPERATOR_SET_MODE", self.panel)
        self.assertIn("REWRITE_ALLOW_ONCE", self.panel)
        self.assertIn("CANCEL", self.panel)
        self.assertIn("A2_OPERATOR_CAPTURE_PERCEPTION", self.panel)
        self.assertIn("capturePerception", self.panel)

    def test_16_glm_gate_capability_is_cleared_in_finally(self):
        self.assertIn("const originalGlm", self.bindings)
        self.assertIn("A2_PROMPT_GATE_BRIDGE_BYPASS", self.bindings)
        self.assertIn("A2_PROMPT_GATE_BRIDGE_BYPASS_CLEAR", self.bindings)
        self.assertIn("finally", self.bindings)

    def test_17_perception_uses_hybrid_cdp_sensors(self):
        self.assertIn("Accessibility.getFullAXTree", self.perception)
        self.assertIn("DOMSnapshot.captureSnapshot", self.perception)
        self.assertIn("Page.captureScreenshot", self.perception)
        self.assertIn("Page.getLayoutMetrics", self.perception)
        self.assertIn("document.body?.innerText", self.perception)
        self.assertIn("operator-perception.js", self.entry)

    def test_18_perception_is_tainted_bounded_and_session_metadata_only(self):
        self.assertIn("tainted_page_data: true", self.perception)
        self.assertIn("boundedPreview", self.perception)
        self.assertIn("A2_OPERATOR_PERCEPTION_PREVIEW", self.perception)
        self.assertIn("chrome.storage.session.set", self.perception)
        self.assertIn("screenshot_sha256", self.perception)
        self.assertNotIn("chrome.storage.local.set", self.perception)
        self.assertIn("perception_debugger_target_busy", self.perception)
        self.assertIn("perception_duplicate_target_tabs", self.perception)

    def test_19_behavioral_labs_are_present(self):
        for name in ["a2_v060_prompt_gate_browser_lab.mjs", "a2_v060_operator_control_lab.mjs", "a2_v060_perception_lab.mjs"]:
            self.assertTrue((ROOT / "tests" / name).exists())


if __name__ == "__main__":
    unittest.main()
