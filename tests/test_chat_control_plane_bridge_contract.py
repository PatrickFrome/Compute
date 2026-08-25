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
        cls.bootstrap = (EXT / "bootstrap-config.js").read_text()
        cls.background = (EXT / "background.js").read_text()
        cls.background_entry = (EXT / "background-entry.js").read_text()
        cls.auth_fetch = (EXT / "auth-fetch.js").read_text()
        cls.durable = (EXT / "durable-fetch.js").read_text()
        cls.options = (EXT / "options.js").read_text()
        cls.options_html = (EXT / "options.html").read_text()
        cls.windows_launcher = (BASE / "start-windows.ps1").read_text()
        cls.windows_cmd = (BASE / "START_A2_BRIDGE_WINDOWS.cmd").read_text()
        cls.server = (DAEMON / "server.mjs").read_text()
        cls.launcher = (DAEMON / "run.mjs").read_text()
        cls.secure_entry = (DAEMON / "secure-entry.mjs").read_text()
        cls.supabase_auth = (DAEMON / "supabase-auth.mjs").read_text()
        cls.dashboard = (DAEMON / "dashboard.html").read_text()
        cls.manifest = json.loads((EXT / "manifest.json").read_text())

    def test_manifest_and_entrypoints(self):
        self.assertEqual(self.manifest["manifest_version"], 3)
        self.assertEqual(self.manifest["version"], "0.5.3")
        self.assertEqual(self.manifest["background"]["service_worker"], "background-entry.js")
        self.assertNotIn("type", self.manifest["background"])
        for path in [
            EXT / "bootstrap-config.js", EXT / "background-entry.js", EXT / "auth-fetch.js",
            EXT / "durable-fetch.js", EXT / "background.js", EXT / "options.html",
            EXT / "options.js", EXT / "content.js", DAEMON / "secure-entry.mjs",
            DAEMON / "supabase-auth.mjs", DAEMON / "dashboard.html",
        ]:
            self.assertTrue(path.is_file(), path)

    def test_service_worker_uses_chrome_supported_classic_imports(self):
        self.assertIn("importScripts('./bootstrap-config.js')", self.background_entry)
        self.assertIn("importScripts('./auth-fetch.js')", self.background_entry)
        self.assertIn("importScripts('./durable-fetch.js')", self.background_entry)
        self.assertIn("importScripts('./background.js')", self.background_entry)
        self.assertNotIn("import(", self.background_entry)
        self.assertNotIn("await import", self.background_entry)
        for script in [self.auth_fetch, self.durable, self.background]:
            self.assertTrue(script.lstrip().startswith("(() => {"))
            self.assertTrue(script.rstrip().endswith("})();"))

    def test_remote_bootstrap_has_no_repository_pairing_secret(self):
        self.assertIn(REMOTE_BRIDGE, self.bootstrap)
        self.assertIn('bridgeSecret: ""', self.bootstrap)
        self.assertIn("bootstrap-config.js", self.background_entry)
        self.assertIn('src="bootstrap-config.js"', self.options_html)

    def test_remote_endpoint_is_exactly_scoped(self):
        hosts = set(self.manifest["host_permissions"])
        self.assertIn("https://xpeibufgzjknrhbhpffp.supabase.co/*", hosts)
        self.assertNotIn("https://*.supabase.co/*", hosts)
        self.assertIn("url.origin === remote.origin", self.auth_fetch)
        self.assertIn("url.pathname.startsWith", self.auth_fetch)
        self.assertIn("exact METAENGINE remote HTTPS endpoint", self.options)
        self.assertIn("x-a2-chat-bridge-secret", self.auth_fetch)
        self.assertIn("bridge_pairing_secret_missing_or_short", self.auth_fetch)

    def test_remote_poll_sends_snapshots_transiently(self):
        self.assertIn("currentSnapshotEnvelopes", self.background)
        self.assertIn('daemonFetch("/v1/commands/next"', self.background)
        self.assertIn('method: "POST"', self.background)
        self.assertIn("snapshots: await currentSnapshotEnvelopes()", self.background)
        self.assertIn("pollPinnedTabSnapshots()", self.background)
        self.assertIn("singleOpenChatgptConversation", self.background)
        self.assertIn("if (!existing.chatgptUrl)", self.background)

    def test_remote_durable_idempotency_preserves_function_base_path(self):
        self.assertIn("bridgeBaseFromNextUrl", self.durable)
        self.assertIn("SENT_ALREADY_DURABLE", self.durable)
        self.assertIn('method === "POST"', self.durable)
        self.assertIn("commands\\/next", self.durable)
        self.assertIn("idempotency_key", self.durable)
        self.assertIn("Persist before network ACK", self.durable)

    def test_pairing_secret_is_trusted_context_only(self):
        self.assertIn("setAccessLevel", self.background_entry)
        self.assertIn("TRUSTED_CONTEXTS", self.background_entry)
        self.assertEqual(self.manifest["incognito"], "not_allowed")
        combined = "\n".join([
            self.content, self.bootstrap, self.background_entry, self.auth_fetch,
            self.durable, self.background, self.options, self.options_html,
        ])
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", combined)
        self.assertNotIn("A2_BRIDGE_SHARED_SECRET", combined)

    def test_exact_project_zai_chat_is_pinned(self):
        self.assertIn(PROJECT_ZAI, self.background)
        self.assertIn(PROJECT_ZAI, self.options)
        self.assertIn("target_url_mismatch", self.background)
        self.assertIn("normalizeUrl(live.url", self.background)

    def test_full_dom_readback_and_real_send_are_retained(self):
        self.assertIn("function extractMessages()", self.content)
        self.assertIn("MutationObserver", self.content)
        self.assertIn("function resolveComposerSendPair()", self.content)
        self.assertIn("sendButton.click();", self.content)
        self.assertIn("SENT_AND_DOM_VERIFIED", self.content)
        self.assertIn("send_click_not_observed_in_dom", self.content)
        self.assertNotIn("press Enter", self.content)

    def test_idle_composer_presence_does_not_require_send_button(self):
        self.assertIn("function resolveComposer()", self.content)
        self.assertIn("const composerResolution = resolveComposer();", self.content)
        self.assertIn("composer_present: Boolean(composer)", self.content)
        self.assertIn("dom_pair_error: composerResolution.error", self.content)
        self.assertIn("async function writeComposerExact(text)", self.content)
        self.assertIn("if (composerResolution.error) throw new Error(composerResolution.error)", self.content)
        self.assertIn('if (!sendButtons.length) return { composer, send: null, error: "send_button_not_found" }', self.content)

    def test_arming_and_duplicate_send_fences_remain(self):
        self.assertIn("if (!settings.armed)", self.background)
        self.assertIn("BLOCKED_NOT_ARMED", self.background)
        self.assertIn("chrome.action.onClicked", self.background)
        self.assertIn("a2-chat-bridge:seen-commands", self.content)
        self.assertIn("function rememberCommand(", self.content)
        self.assertIn("a2BridgeCompletedCommandsV1", self.durable)
        self.assertIn("a2BridgeLeasedCommandsV1", self.durable)
        self.assertIn("armed: false", self.background)

    def test_visibility_and_non_authority_invariants_remain(self):
        self.assertIn("authority_effect: false", self.background)
        self.assertIn("browser text as transport/context, never as authority", self.server)
        self.assertIn("const blind = a2.peerPayloadsExposed !== true;", self.server)
        self.assertIn("OTHER PEER CHAT: REDACTED BY A2 VISIBILITY FENCE", self.server)
        self.assertNotIn("worker_admitted=true", self.server.lower())
        self.assertNotIn("w1_verified=true", self.server.lower())

    def test_local_daemon_remains_safe_fallback_not_requirement(self):
        self.assertIn("A2_BRIDGE_SHARED_SECRET", self.secure_entry)
        self.assertIn("timingSafeEqual", self.secure_entry)
        self.assertIn("Refusing direct daemon start", self.launcher)
        self.assertIn("ConvertFrom-SecureString", self.windows_launcher)
        self.assertIn('A2_BRIDGE_RECEIPTS_MODE = "OFF"', self.windows_launcher)
        self.assertIn("sb_secret_", self.supabase_auth)
        self.assertIn("sb_publishable_", self.supabase_auth)

    def test_dashboard_control_posts_use_tab_scoped_pairing(self):
        self.assertIn("sessionStorage.setItem(PAIRING_KEY, secret)", self.dashboard)
        self.assertIn("sessionStorage.getItem(PAIRING_KEY)", self.dashboard)
        self.assertIn("sessionStorage.removeItem(PAIRING_KEY)", self.dashboard)
        self.assertIn("'x-a2-chat-bridge-secret': secret", self.dashboard)
        self.assertNotIn("?secret=", self.dashboard)

    def test_zai_selector_fails_closed_on_ambiguity(self):
        self.assertIn("function sharedContainer(", self.content)
        self.assertIn('error: "composer_ambiguous"', self.content)
        self.assertIn('error: "composer_send_pair_ambiguous"', self.content)
        self.assertIn('error: "composer_send_pair_not_found"', self.content)
        self.assertIn("/^(send|send message|send prompt|submit)$/i", self.content)


if __name__ == "__main__":
    unittest.main()
