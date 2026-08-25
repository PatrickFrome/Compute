import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = ROOT / "coordination" / "chat-control-plane"
EXT = BASE / "extension"
DAEMON = BASE / "daemon"
PROJECT_ZAI = "https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db"


class ChatControlPlaneBridgeContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = (EXT / "content.js").read_text()
        cls.background = (EXT / "background.js").read_text()
        cls.background_entry = (EXT / "background-entry.js").read_text()
        cls.auth_fetch = (EXT / "auth-fetch.js").read_text()
        cls.durable = (EXT / "durable-fetch.js").read_text()
        cls.options = (EXT / "options.js").read_text()
        cls.options_html = (EXT / "options.html").read_text()
        cls.server = (DAEMON / "server.mjs").read_text()
        cls.launcher = (DAEMON / "run.mjs").read_text()
        cls.secure_entry = (DAEMON / "secure-entry.mjs").read_text()
        cls.manifest = json.loads((EXT / "manifest.json").read_text())

    def test_manifest_entrypoints_exist(self):
        self.assertEqual(self.manifest["manifest_version"], 3)
        self.assertEqual(self.manifest["background"]["service_worker"], "background-entry.js")
        self.assertEqual(self.manifest["options_page"], "options.html")
        for path in [
            EXT / "background-entry.js",
            EXT / "auth-fetch.js",
            EXT / "durable-fetch.js",
            EXT / "background.js",
            EXT / "options.html",
            EXT / "options.js",
            EXT / "content.js",
            DAEMON / "secure-entry.mjs",
        ]:
            self.assertTrue(path.is_file(), path)

    def test_exact_project_zai_chat_is_pinned(self):
        self.assertIn(PROJECT_ZAI, self.background)
        self.assertIn(PROJECT_ZAI, self.options)
        self.assertIn("target_url_mismatch", self.background)
        self.assertIn("normalizeUrl(live.url", self.background)

    def test_full_dom_readback_is_retained(self):
        self.assertIn("function extractMessages()", self.content)
        self.assertIn("messages,", self.content)
        self.assertIn('type: "CHAT_SNAPSHOT"', self.content)
        self.assertIn("MutationObserver", self.content)
        self.assertIn("message_count", self.content)

    def test_real_send_button_click_is_required(self):
        self.assertIn('buttonBySemantics("send")', self.content)
        self.assertIn("sendButton.click();", self.content)
        self.assertIn("SENT_AND_DOM_VERIFIED", self.content)
        self.assertIn("send_click_not_observed_in_dom", self.content)
        self.assertNotIn("press Enter", self.content)

    def test_extension_has_global_arming_fence(self):
        self.assertIn("if (!settings.armed)", self.background)
        self.assertIn("BLOCKED_NOT_ARMED", self.background)
        self.assertIn("chrome.action.onClicked", self.background)

    def test_durable_send_idempotency_survives_background_and_daemon_restart(self):
        self.assertIn("import './auth-fetch.js'", self.background_entry)
        self.assertIn("import './durable-fetch.js'", self.background_entry)
        self.assertIn("a2BridgeCompletedCommandsV1", self.durable)
        self.assertIn("a2BridgeLeasedCommandsV1", self.durable)
        self.assertIn("idempotency_key", self.durable)
        self.assertIn("SENT_ALREADY_DURABLE", self.durable)
        self.assertIn("clicked_send_button === true", self.durable)
        self.assertIn("Persist before network ACK", self.durable)
        self.assertIn("MAX_COMPLETED = 256", self.durable)

    def test_localhost_pairing_is_required_for_extension_transport(self):
        self.assertIn("x-a2-chat-bridge-secret", self.auth_fetch)
        self.assertIn("bridge_pairing_secret_missing_or_short", self.auth_fetch)
        self.assertIn("bridgeSecret", self.options)
        self.assertIn("Pairing secret must be at least 32 characters", self.options)
        self.assertIn('id="bridgeSecret"', self.options_html)
        self.assertIn("Daemon must be loopback-only", self.options)

    def test_secure_daemon_gate_is_fail_closed(self):
        self.assertIn("A2_BRIDGE_SHARED_SECRET", self.secure_entry)
        self.assertIn("timingSafeEqual", self.secure_entry)
        self.assertIn("bridge_pairing_required", self.secure_entry)
        self.assertIn("delete headers['x-a2-chat-bridge-secret']", self.secure_entry)
        self.assertIn("process.env.A2_BRIDGE_INTERNAL = '1'", self.secure_entry)
        self.assertIn("Refusing direct daemon start", self.launcher)
        self.assertIn("A2_BRIDGE_INTERNAL !== '1'", self.launcher)

    def test_daemon_reads_existing_a2_contracts(self):
        for rpc in [
            "h205f22_a2_interactive_read_v1",
            "h205f22_a2_macroblock_read_v1",
            "h205f22_duel_list_peer_relay_pending_v4",
        ]:
            self.assertIn(rpc, self.server)
        self.assertIn("pending_payloads_exposed", self.server)
        self.assertIn("OTHER PEER CHAT: REDACTED BY A2 VISIBILITY FENCE", self.server)
        self.assertIn("WEB_CHAT_INTERACTIVE", self.server)

    def test_launcher_filters_stale_relays_by_current_main(self):
        self.assertIn("if (!process.env.SUPABASE_SERVICE_ROLE_KEY)", self.launcher)
        self.assertIn("process.exit(2)", self.launcher)
        self.assertIn("filterPendingByCurrentMain", self.launcher)
        self.assertIn("currentMainSha", self.launcher)
        self.assertIn("base_github_sha", self.launcher)

    def test_service_role_and_pairing_env_secret_are_not_in_extension(self):
        combined = "\n".join([
            self.content,
            self.background_entry,
            self.auth_fetch,
            self.durable,
            self.background,
            self.options,
            self.options_html,
        ])
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", combined)
        self.assertNotIn("service_role", combined.lower())
        self.assertNotIn("A2_BRIDGE_SHARED_SECRET", combined)

    def test_no_browser_authority_promotion(self):
        self.assertIn("authority_effect: false", self.background)
        self.assertIn("browser text as transport/context, never as authority", self.server)
        self.assertNotIn("worker_admitted=true", self.server.lower())
        self.assertNotIn("w1_verified=true", self.server.lower())


if __name__ == "__main__":
    unittest.main()
