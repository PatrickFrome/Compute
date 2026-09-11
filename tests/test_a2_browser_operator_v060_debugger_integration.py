import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / "coordination" / "chat-control-plane" / "extension"


class BrowserOperatorDebuggerIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((EXT / "manifest.json").read_text())
        cls.entry = (EXT / "background-entry.js").read_text()
        cls.broker = (EXT / "debugger-broker.js").read_text()
        cls.gpt = (EXT / "trusted-chatgpt.js").read_text()
        cls.glm = (EXT / "trusted-glm.js").read_text()
        cls.bindings = (EXT / "operator-gate-bindings.js").read_text()
        cls.oopif = (EXT / "operator-oopif-perception.js").read_text()

    def test_chrome_125_flat_session_floor(self):
        self.assertGreaterEqual(int(self.manifest["minimum_chrome_version"]), 125)

    def test_broker_loads_before_trusted_transports(self):
        broker = self.entry.index('importScripts("./debugger-broker.js")')
        gpt = self.entry.index('importScripts("./trusted-chatgpt.js")')
        glm = self.entry.index('importScripts("./trusted-glm.js")')
        self.assertLess(broker, gpt)
        self.assertLess(broker, glm)

    def test_trusted_chatgpt_is_broker_only(self):
        self.assertIn("A2_DEBUGGER_RUN", self.gpt)
        self.assertNotIn("chrome.debugger.attach", self.gpt)
        self.assertNotIn("chrome.debugger.getTargets", self.gpt)
        self.assertNotIn("chrome.debugger.detach", self.gpt)

    def test_trusted_glm_is_brokered_and_uses_trusted_text_input(self):
        self.assertIn("A2_DEBUGGER_HOLD", self.glm)
        self.assertIn("A2_DEBUGGER_RUN", self.glm)
        self.assertIn('Input.insertText', self.glm)
        self.assertNotIn("chrome.debugger.attach", self.glm)
        self.assertNotIn("chrome.debugger.getTargets", self.glm)
        self.assertNotIn("chrome.debugger.detach", self.glm)
        self.assertNotIn("Object.getOwnPropertyDescriptor(proto, 'value')", self.glm)

    def test_glm_bypass_is_after_durable_dispatch_and_before_release(self):
        durable = self.glm.index('state: "DISPATCHED"')
        bypass = self.glm.index("armPromptGateBypass", durable)
        release = self.glm.index('type: "mouseReleased", x: point.x', bypass)
        self.assertLess(durable, bypass)
        self.assertLess(bypass, release)

    def test_safe_glm_failures_scrub_only_exact_bridge_draft(self):
        self.assertIn("scrubSafeGlmDraft", self.bindings)
        self.assertIn('String(error?.a2ExecutionClass || "") === SAFE', self.bindings)
        self.assertIn("composer_changed_by_user_or_site", self.bindings)
        self.assertIn("trusted_keyboard_exact_readback", self.bindings)
        ambiguous_clause = self.bindings.index('!== AMBIGUOUS')
        cleanup = self.bindings.index("scrubSafeGlmDraft")
        self.assertGreater(ambiguous_clause, cleanup)

    def test_broker_has_shared_holds_generation_and_flat_children(self):
        for token in [
            "A2_DEBUGGER_HOLD",
            "debugger_broker_lease_stale",
            "hold_count",
            "Target.setAutoAttach",
            "flatten: true",
            "sendChild",
            "disableChildTargets",
        ]:
            self.assertIn(token, self.broker)

    def test_oopif_capture_is_bounded_and_cleanup_scoped(self):
        self.assertIn("MAX_CHILD_FRAMES = 24", self.oopif)
        self.assertIn("Accessibility.disable", self.oopif)
        self.assertIn("disableChildTargets", self.oopif)
        self.assertIn("chrome.storage.session.set", self.oopif)
        self.assertIn("child_frame_count", self.oopif)
        self.assertNotIn("chrome.storage.local.set", self.oopif)
        self.assertIn("operator_sender_not_trusted", self.oopif)


if __name__ == "__main__":
    unittest.main()
